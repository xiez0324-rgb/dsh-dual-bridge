/**
 * extract.ts —— host 端文本抽取（PDF / Office / 富文本 → 纯文本）
 *
 * 为什么必须在 host 端做：
 *   浏览器侧（lib/client.js）拿不到文件原始字节（sidebar 的 fs.read 只返回文本，
 *   二进制只给前 4096 字节 base64），也不能启动子进程。只有 DSH 的 node 进程
 *   （lib/index.js 的 apply）能用 node:child_process。
 *
 * 设计约束：
 *   - **纯本地**：只 spawn 本机已有的命令，不联任何网络
 *   - **不注入 shell**：execFile + argv 数组，路径永远作为一个参数传递
 *   - **路径围栏**：只允许抽取「调用方声明的会话工作区」内的文件
 *   - **有界**：单次超时、输出字符上限、输入体积上限
 *   - **失败可降级**：返回结构化错误码，由 UI 显示原因，不抛穿
 *
 * 抽取引擎优先级：
 *   .pdf                → 插件内置 vendor/poppler/bin/pdftotext → 系统 PATH 上的 pdftotext
 *   .doc/.docx/.rtf/…   → macOS 自带 /usr/bin/textutil
 * 其它扩展名一律 unsupported。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path'

/** 单次抽取允许的输入文件体积上限（字节） */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024
/** 单次抽取输出字符上限（超出截断并标记 truncated） */
export const MAX_OUTPUT_CHARS = 200_000
/** 子进程超时（毫秒） */
export const EXTRACT_TIMEOUT_MS = 20_000

export type ExtractErrorCode =
  | 'bad-request'
  | 'outside-workspace'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'unsupported'
  | 'no-extractor'
  | 'empty'
  | 'timeout'
  | 'failed'

export interface ExtractOk {
  ok: true
  text: string
  chars: number
  truncated: boolean
  /** 实际使用的引擎，便于界面显示（poppler / system-pdftotext / textutil） */
  engine: string
}

export interface ExtractErr {
  ok: false
  code: ExtractErrorCode
  message: string
}

export type ExtractResult = ExtractOk | ExtractErr

// 可抽取判定统一走共享模块，避免 host / client 两套规则漂移
import { extractKindOf, isExtractablePath } from './extractable'
import { extractOfficeText, rtfToText } from './office-zip'

/** 该文件是否支持抽取（转发共享判定，保留旧导出名） */
export function isExtractable(relPath: string): boolean {
  return isExtractablePath(relPath)
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i).toLowerCase()
}

/**
 * 判断 `filePath` 是否严格位于 `cwd` 之内。
 * 用 resolve 归一化（消掉 `..`、`.`、重复斜杠）后再比较前缀，
 * 避免 `../` 或符号式绕过。
 */
export function isInsideWorkspace(cwd: string, filePath: string): boolean {
  if (!isAbsolute(cwd) || !isAbsolute(filePath)) return false
  const root = resolve(cwd)
  const target = resolve(filePath)
  // Windows 路径大小写不敏感，比较时统一小写
  const ci = process.platform === 'win32' ? (v: string): string => v.toLowerCase() : (v: string): string => v
  if (ci(target) === ci(root)) return false // 目录本身不是可抽取的文件
  const prefix = root.endsWith(sep) ? root : root + sep
  return ci(target).startsWith(ci(prefix))
}

export interface ExtractorPlan {
  command: string
  args: string[]
  engine: string
}

/**
 * 解析出该文件应该用哪个命令抽取。
 * `popplerRoot` 是插件内置 poppler 前缀（vendor/poppler），可缺省；
 * 缺省或不可执行时回退到系统 PATH 上的 pdftotext。
 */
export function resolveExtractor(
  filePath: string,
  options: { popplerRoot?: string; pathEnv?: string } = {},
): ExtractorPlan | undefined {
  if (extractKindOf(filePath) === 'pdf') {
    if (options.popplerRoot !== undefined) {
      const bundled = join(options.popplerRoot, 'bin', 'pdftotext')
      if (existsSync(bundled)) {
        return { command: bundled, args: pdfArgs(filePath), engine: 'poppler' }
      }
    }
    const system = findOnPath('pdftotext', options.pathEnv)
    if (system !== undefined) {
      return { command: system, args: pdfArgs(filePath), engine: 'system-pdftotext' }
    }
    return undefined
  }

  if (extractKindOf(filePath) === 'office') {
    const textutil = '/usr/bin/textutil'
    if (existsSync(textutil)) {
      return { command: textutil, args: ['-convert', 'txt', '-stdout', filePath], engine: 'textutil' }
    }
    return undefined
  }

  return undefined
}

/** pdftotext 参数：保留版面（-layout 对题目/表格更友好），UTF-8，输出到 stdout */
function pdfArgs(filePath: string): string[] {
  return ['-layout', '-enc', 'UTF-8', filePath, '-']
}

/** 在 PATH 中查找可执行文件（不依赖 which，避免多一次 spawn） */
function findOnPath(name: string, pathEnv = process.env.PATH ?? ''): string | undefined {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** 清洗抽取结果：统一换行、压掉 3 个以上连续空行、去尾部空白 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

interface RunOptions {
  timeoutMs?: number
  maxChars?: number
}

/** 执行抽取命令并把 stdout 收成字符串（有界） */
function runExtractor(plan: ExtractorPlan, options: RunOptions = {}): Promise<{ text: string; timedOut: boolean }> {
  const timeout = options.timeoutMs ?? EXTRACT_TIMEOUT_MS
  return new Promise((resolvePromise, reject) => {
    execFile(
      plan.command,
      plan.args,
      {
        timeout,
        // 输出上限：留一倍余量，具体截断在 normalize 之后按字符数做
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          // 超时被 timeout 杀掉：error.killed 为 true
          const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true
          if (killed) {
            resolvePromise({ text: stdout ?? '', timedOut: true })
            return
          }
          reject(error)
          return
        }
        resolvePromise({ text: stdout ?? '', timedOut: false })
      },
    )
  })
}

/** 统一收尾：清洗 → 空判断 → 按字符上限截断 → 成功结果 */
/** 空结果时按文件类型给出**准确**的下一步建议（不要一律说"扫描件"） */
export function emptyMessage(filePath: string): string {
  const ext = extOf(filePath)
  if (ext === '.pdf') {
    return '该 PDF 没有文字层（可能是扫描件/图片型 PDF）。请直接把原文件上传到网页版，让 AI 看图。'
  }
  if (ext === '.doc') {
    return '这个 .doc 无法转出文字（常见于 WPS 等非标准旧格式）。建议用 Word/WPS 另存为 .docx 后重试，或直接上传原文件。'
  }
  if (['.docx', '.pptx', '.xlsx', '.odt', '.wordml'].includes(ext)) {
    return '这个文档里没有可提取的文字（可能是纯图片内容或空文档）。建议直接上传原文件。'
  }
  if (['.rtf', '.rtfd', '.html', '.htm', '.webarchive'].includes(ext)) {
    return '这个文件里没有可提取的文字。'
  }
  return '没有提取到文字，请直接上传原文件。'
}

function finalize(
  raw: string,
  engine: string,
  maxChars?: number,
  filePath?: string,
): ExtractResult {
  const normalized = normalizeExtractedText(raw)
  if (normalized === '') {
    return {
      ok: false,
      code: 'empty',
      message: emptyMessage(filePath ?? ''),
    }
  }
  const limit = maxChars ?? MAX_OUTPUT_CHARS
  const truncated = normalized.length > limit
  const text = truncated ? normalized.slice(0, limit) : normalized
  return { ok: true, text, chars: text.length, truncated, engine }
}

export interface ExtractRequest {
  /** 调用方声明的会话工作区（绝对路径） */
  cwd: string
  /** 待抽取的文件绝对路径，必须位于 cwd 内 */
  filePath: string
  /** 插件内置 poppler 前缀，缺省回退系统 pdftotext */
  popplerRoot?: string
  timeoutMs?: number
  maxChars?: number
}

/**
 * 抽取入口：校验 → 选引擎 → 执行 → 清洗 → 截断。
 * 任何失败都返回结构化错误，绝不让异常穿到路由层。
 */
export async function extractText(request: ExtractRequest): Promise<ExtractResult> {
  const { cwd, filePath } = request
  if (typeof cwd !== 'string' || typeof filePath !== 'string' || cwd === '' || filePath === '') {
    return { ok: false, code: 'bad-request', message: '缺少 cwd 或 path' }
  }
  if (!isInsideWorkspace(cwd, filePath)) {
    return { ok: false, code: 'outside-workspace', message: '只允许抽取当前工作区内的文件' }
  }

  let info
  try {
    info = await stat(filePath)
  } catch {
    return { ok: false, code: 'not-found', message: '文件不存在或无法访问' }
  }
  if (!info.isFile()) return { ok: false, code: 'not-a-file', message: '目标不是文件' }
  if (info.size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `文件超过 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB，拒绝抽取`,
    }
  }

  const ext = extOf(filePath)

  // ① 纯 Node 路径（跨平台、零依赖）：rtf / docx / pptx / xlsx
  if (ext === '.rtf' || ext === '.rtfd') {
    try {
      const raw = await readFile(filePath, 'utf8')
      return finalize(rtfToText(raw), 'rtf', request.maxChars, filePath)
    } catch (error) {
      return { ok: false, code: 'failed', message: `RTF 解析失败：${String(error)}` }
    }
  }
  if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') {
    try {
      const raw = extractOfficeText(await readFile(filePath), filePath)
      if (raw !== undefined && raw.trim() !== '') {
        return finalize(normalizeExtractedText(raw), 'zip-xml', request.maxChars, filePath)
      }
    } catch {
      // 落到系统工具路径（macOS textutil）兜底
    }
  }

  if (!isExtractable(filePath)) {
    return { ok: false, code: 'unsupported', message: '该文件类型不支持文本抽取（仅 PDF / Office / RTF / HTML）' }
  }

  const plan = resolveExtractor(filePath, { popplerRoot: request.popplerRoot })
  if (plan === undefined) {
    return {
      ok: false,
      code: 'no-extractor',
      message:
        extOf(filePath) === '.pdf'
          ? '未找到 PDF 抽取器：请安装 poppler（brew install poppler / apt install poppler-utils / winget install poppler），'
            + '或用 conda 装到任意目录后设置 DSH_DUAL_BRIDGE_POPPLER 指向它'
          : extOf(filePath) === '.doc'
            ? '旧版 .doc（二进制）需要 macOS 的 textutil 或 LibreOffice；建议先另存为 .docx（跨平台可直接抽取）'
            : '未找到可用的抽取器',
    }
  }

  let output: { text: string; timedOut: boolean }
  try {
    output = await runExtractor(plan, {
      timeoutMs: request.timeoutMs,
      maxChars: request.maxChars,
    })
  } catch (error) {
    return {
      ok: false,
      code: 'failed',
      message: `抽取失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (output.timedOut) {
    return { ok: false, code: 'timeout', message: `抽取超时（${(request.timeoutMs ?? EXTRACT_TIMEOUT_MS) / 1000}s）` }
  }

  return finalize(output.text, plan.engine, request.maxChars, filePath)
}
