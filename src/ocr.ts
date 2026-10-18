/**
 * ocr.ts —— 图片文字识别（host 端，纯本地、跨平台）
 *
 * 三级引擎链（按顺序尝试，任一成功即返回）：
 *   1. vision    macOS 内置 Vision（零安装、质量最好、最快）—— 仅 macOS，作为加速路径
 *   2. tesseract 系统安装的 tesseract（跨平台，若用户已装）
 *   3. wasm      内置 tesseract.js + 中文训练数据（随包安装，零安装、离线、三平台通用）
 *
 * 因此 Windows / Linux 用户不需要装任何东西也能 OCR；macOS 自动走更快的 Vision。
 * 训练数据来自 npm 依赖 @tesseract.js-data/{chi_sim,eng}，运行时不访问 CDN（离线可用）。
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export { IMAGE_EXTS, isImagePath } from './extractable'

/** OCR 缓存目录：优先用户缓存目录，比 tmpdir 稳定 */
function ocrCacheDir(): string {
  const override = process.env.DSH_DUAL_BRIDGE_OCR_CACHE
  if (override !== undefined && override.trim() !== '') return override.trim()
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'dsh-dual-bridge')
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local !== undefined && local !== '') return join(local, 'dsh-dual-bridge')
  }
  return join(tmpdir(), 'dsh-dual-bridge-ocr')
}

/** 编译后的 Vision OCR 可执行文件缓存路径 */
export const OCR_BINARY_CACHE = join(ocrCacheDir(), 'ocr-vision')
const OCR_SWIFT_SOURCE = join(ocrCacheDir(), 'ocr.swift')

// ---------------------------------------------------------------- 类型
export type OcrEngine = 'vision' | 'tesseract' | 'wasm'

export interface OcrResult {
  ok: boolean
  text?: string
  engine?: OcrEngine
  chars?: number
  message?: string
  code?: 'no-ocr' | 'failed' | 'timeout' | 'empty'
}

/**
 * 决定引擎尝试顺序（纯函数，便于单测）。
 * 跨平台保底是 wasm —— 它随包安装，不需要用户做任何事。
 */
export function chooseOcrEngines(available: {
  vision: boolean
  systemTesseract: boolean
  wasm: boolean
}): OcrEngine[] {
  const chain: OcrEngine[] = []
  if (available.vision) chain.push('vision')
  if (available.systemTesseract) chain.push('tesseract')
  if (available.wasm) chain.push('wasm')
  return chain
}

// ---------------------------------------------------------------- 通用执行
function runFile(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true
          if (killed) {
            resolve({ stdout: stdout ?? '', timedOut: true })
            return
          }
          reject(error)
          return
        }
        resolve({ stdout: stdout ?? '', timedOut: false })
      },
    )
  })
}

export function findOnPath(name: string, pathEnv = process.env.PATH ?? ''): string | undefined {
  const sep = process.platform === 'win32' ? ';' : ':'
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const dir of pathEnv.split(sep)) {
    if (dir === '') continue
    for (const suffix of suffixes) {
      const candidate = join(dir, `${name}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

// ---------------------------------------------------------------- 1. Vision
const VISION_SWIFT = `import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("usage: ocr <image>\\n".data(using: .utf8)!); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image\\n".data(using: .utf8)!)
    exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\\n"))
`

export function visionSwiftAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  if (existsSync(OCR_BINARY_CACHE)) return true
  return existsSync('/usr/bin/swiftc') || existsSync('/usr/bin/swift')
}

async function ensureVisionBinary(timeoutMs: number): Promise<string | undefined> {
  if (existsSync(OCR_BINARY_CACHE)) return OCR_BINARY_CACHE
  if (process.platform !== 'darwin') return undefined
  try {
    mkdirSync(ocrCacheDir(), { recursive: true })
    writeFileSync(OCR_SWIFT_SOURCE, VISION_SWIFT, 'utf8')
    const compiler = existsSync('/usr/bin/swiftc') ? '/usr/bin/swiftc' : '/usr/bin/swift'
    const args = compiler.endsWith('swiftc')
      ? ['-O', '-o', OCR_BINARY_CACHE, OCR_SWIFT_SOURCE]
      : [OCR_SWIFT_SOURCE]
    await runFile(compiler, args, Math.max(timeoutMs, 60_000))
    return existsSync(OCR_BINARY_CACHE) ? OCR_BINARY_CACHE : undefined
  } catch {
    return undefined
  }
}

async function ocrWithVision(filePath: string, timeoutMs: number): Promise<OcrResult> {
  const binary = await ensureVisionBinary(timeoutMs)
  if (binary === undefined) return { ok: false, code: 'no-ocr', message: 'Vision 不可用' }
  try {
    const out = await runFile(binary, [filePath], timeoutMs)
    if (out.timedOut) return { ok: false, code: 'timeout', message: 'OCR 超时' }
    const text = out.stdout.trim()
    if (text === '') return { ok: false, code: 'empty', message: '图片里没有识别到文字' }
    return { ok: true, text, engine: 'vision', chars: text.length }
  } catch (error) {
    return {
      ok: false,
      code: 'failed',
      message: `Vision OCR 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ---------------------------------------------------------- 2. 系统 tesseract
async function ocrWithSystemTesseract(filePath: string, timeoutMs: number): Promise<OcrResult> {
  try {
    const out = await runFile('tesseract', [filePath, 'stdout', '-l', 'chi_sim+eng'], timeoutMs)
    if (out.timedOut) return { ok: false, code: 'timeout', message: 'OCR 超时' }
    const text = out.stdout.trim()
    if (text === '') return { ok: false, code: 'empty', message: '图片里没有识别到文字' }
    return { ok: true, text, engine: 'tesseract', chars: text.length }
  } catch {
    return { ok: false, code: 'no-ocr', message: '系统 tesseract 不可用' }
  }
}

// ---------------------------------------------------------- 3. 内置 WASM 引擎
interface TesseractWorkerLike {
  recognize: (image: string) => Promise<{ data: { text?: string } }>
}

let wasmWorkerPromise: Promise<TesseractWorkerLike> | null = null

/**
 * 解析运行时依赖：优先相对本模块（插件包内 node_modules），
 * 再回退到当前工作目录（pnpm hoist / 单测打包到临时目录的场景）。
 */
function resolveDependency(specifier: string): string | undefined {
  const bases: string[] = [import.meta.url]
  try {
    bases.push(`file://${join(process.cwd(), 'index.js')}`)
  } catch {
    // 忽略
  }
  for (const base of bases) {
    try {
      return createRequire(base).resolve(specifier)
    } catch {
      // 继续尝试下一个基准
    }
  }
  return undefined
}

export function wasmOcrAvailable(): boolean {
  return resolveDependency('tesseract.js') !== undefined
}

/** 把 chi_sim / eng 训练数据汇总到同一个 langPath 目录（tesseract.js 要求） */
function prepareTessdata(): string {
  const dir = join(ocrCacheDir(), 'tessdata')
  mkdirSync(dir, { recursive: true })
  for (const pkg of ['chi_sim', 'eng'] as const) {
    const target = join(dir, `${pkg}.traineddata.gz`)
    if (existsSync(target)) continue
    const pkgJson = resolveDependency(`@tesseract.js-data/${pkg}/package.json`)
    if (pkgJson === undefined) continue // 缺某个语言包时继续，至少能用已有的语言
    const source = join(dirname(pkgJson), '4.0.0', `${pkg}.traineddata.gz`)
    if (existsSync(source)) copyFileSync(source, target)
  }
  return dir
}

async function getWasmWorker(): Promise<TesseractWorkerLike> {
  if (wasmWorkerPromise !== null) return wasmWorkerPromise
  wasmWorkerPromise = (async () => {
    const mod = (await import('tesseract.js')) as unknown as {
      createWorker: (
        langs: string[],
        oem: number,
        options: Record<string, unknown>,
      ) => Promise<TesseractWorkerLike>
    }
    return mod.createWorker(['chi_sim', 'eng'], 1, {
      langPath: prepareTessdata(),
      cachePath: join(ocrCacheDir(), 'tess-cache'),
      gzip: true,
      logger: () => {},
    })
  })()
  return wasmWorkerPromise
}

async function ocrWithWasm(filePath: string): Promise<OcrResult> {
  try {
    const worker = await getWasmWorker()
    const { data } = await worker.recognize(filePath)
    const text = String(data.text ?? '').trim()
    if (text === '') return { ok: false, code: 'empty', message: '图片里没有识别到文字' }
    return { ok: true, text, engine: 'wasm', chars: text.length }
  } catch (error) {
    wasmWorkerPromise = null
    return {
      ok: false,
      code: 'failed',
      message: `内置 OCR 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ---------------------------------------------------------------- 入口
export async function ocrImage(filePath: string, timeoutMs = 30_000): Promise<OcrResult> {
  const chain = chooseOcrEngines({
    vision: visionSwiftAvailable(),
    systemTesseract: findOnPath('tesseract') !== undefined,
    wasm: wasmOcrAvailable(),
  })
  if (chain.length === 0) {
    return {
      ok: false,
      code: 'no-ocr',
      message: '当前环境没有可用的 OCR（内置 WASM 未安装，系统也没有 Vision / tesseract）',
    }
  }

  let last: OcrResult | undefined
  for (const engine of chain) {
    const result =
      engine === 'vision'
        ? await ocrWithVision(filePath, timeoutMs)
        : engine === 'tesseract'
          ? await ocrWithSystemTesseract(filePath, timeoutMs)
          : await ocrWithWasm(filePath)
    if (result.ok) return result
    last = result
  }
  return last ?? { ok: false, code: 'failed', message: 'OCR 失败' }
}
