/**
 * capabilities.ts —— 本机能力探测（纯本地检查，不联网）
 *
 * 客户端在**渲染按钮之前**先问一次这里，避免"点了才报不支持"的误导性交互。
 */
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { chooseOcrEngines, wasmOcrAvailable, visionSwiftAvailable } from './ocr'

export interface Capabilities {
  /** PDF 文本抽取可用 */
  pdf: boolean
  pdfEngine: 'poppler' | 'system-pdftotext' | null
  /** docx/pptx/xlsx/rtf 抽取：纯 Node 实现，**全平台可用** */
  office: boolean
  /** 走哪条路：内置 zip-xml（全平台）或 macOS textutil（仅 .doc/富文本加速） */
  officeEngine: 'zip-xml' | 'textutil'
  /** 图片 OCR：首选引擎（vision / tesseract / wasm），null 表示完全不可用 */
  ocr: 'vision' | 'tesseract' | 'wasm' | null
  platform: string
}

function findOnPath(name: string, pathEnv = process.env.PATH ?? ''): string | undefined {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export function detectCapabilities(popplerRoot?: string): Capabilities {
  const bundled = popplerRoot === undefined ? undefined : join(popplerRoot, 'bin', 'pdftotext')
  const system = findOnPath('pdftotext')

  let pdfEngine: Capabilities['pdfEngine'] = null
  if (bundled !== undefined && existsSync(bundled)) pdfEngine = 'poppler'
  else if (system !== undefined) pdfEngine = 'system-pdftotext'

  // OCR 引擎链：vision(mac) → 系统 tesseract → 内置 WASM（随包，全平台保底）
  const ocrChain = chooseOcrEngines({
    vision: visionSwiftAvailable(),
    systemTesseract: findOnPath('tesseract') !== undefined,
    wasm: wasmOcrAvailable(),
  })
  const ocr: Capabilities['ocr'] = ocrChain[0] ?? null

  // docx/pptx/xlsx/rtf 由内置 zip-xml 解析器处理，任何平台都可用；
  // macOS 额外有 textutil，可覆盖旧版 .doc / 富文本。
  const hasTextutil = process.platform === 'darwin' && existsSync('/usr/bin/textutil')

  return {
    pdf: pdfEngine !== null,
    pdfEngine,
    office: true,
    officeEngine: hasTextutil ? 'textutil' : 'zip-xml',
    ocr,
    platform: process.platform,
  }
}
