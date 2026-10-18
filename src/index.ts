/**
 * index.ts —— host 端入口（运行在 DSH 的 node 进程内）
 *
 * 注册一组**本地**路由，供 client 在用户操作时调用：
 *   GET  /dual-bridge/capabilities  → 本机能做什么（pdf / office / ocr）
 *   POST /dual-bridge/extract       → PDF / Office 文本抽取
 *   POST /dual-bridge/ocr           → 图片 OCR（macOS Vision / tesseract）
 *   POST /dual-bridge/bundle        → 把不可文本化的文件导出成可拖拽上传的目录（+清单/可选 zip）
 *   POST /dual-bridge/reveal        → 在访达中显示某个文件/目录
 *
 * 为什么这些必须在 host 端：浏览器侧拿不到二进制原文（sidebar 的 fs.read 只回文本，
 * 二进制只给前 4096 字节 base64），也不能启动子进程或写文件。
 *
 * 安全边界：
 *   - 不额外开端口：全部挂在 DSH 已有的本地 web 服务上（127.0.0.1）
 *   - 所有路径都经过「会话工作区前缀围栏」（isInsideWorkspace）
 *   - execFile / spawn + argv 数组：路径永远不作为 shell 片段
 *   - 请求体有上限；不访问网络，只调用本机命令
 */
import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBundle } from './bundle'
import { detectCapabilities } from './capabilities'
import { extractText, isInsideWorkspace } from './extract'
import { ocrImage } from './ocr'

export const name = 'dsh-dual-bridge'

/** 需要 DSH 的本地 web 服务器服务；没有它的 profile（如 headless）插件不激活 */
export const inject = ['webServer']

/** 请求体上限（bundle 会带一批路径，放宽到 256KB） */
const MAX_BODY_BYTES = 256 * 1024

/**
 * host 端构建版本：与 package.json / 客户端的 BUILD_VERSION 必须一致。
 * 客户端拿它和自己比对——不一致就说明「host 没有重启」，此时会出现
 * 旧路径/旧行为，必须提示用户重启而不是让人以为功能坏了。
 */
export const HOST_BUILD = '0.12.0'

/** 所有路由路径（导出以便测试断言） */
export const ROUTES = {
  capabilities: '/dual-bridge/capabilities',
  extract: '/dual-bridge/extract',
  ocr: '/dual-bridge/ocr',
  bundle: '/dual-bridge/bundle',
  reveal: '/dual-bridge/reveal',
} as const

/** 只声明用到的结构，避免把 dsh-host-webserver 变成插件的类型依赖 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: NodeReqLike, res: HttpResponseLike) => void | Promise<void>
  }): () => void
}
interface NodeReqLike {
  method?: string
  on(event: string, listener: (...args: unknown[]) => void): void
}
interface HttpResponseLike {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

/**
 * 插件内置 poppler 前缀：`<pkg>/lib/index.js` 的上一级是包根。
 * 可用 DSH_DUAL_BRIDGE_POPPLER 覆盖。发布版不含 vendor/，此时自动回退系统 pdftotext。
 */
function bundledPopplerRoot(): string | undefined {
  const override = process.env.DSH_DUAL_BRIDGE_POPPLER
  if (override !== undefined && override.trim() !== '') return override.trim()
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // <pkg>/lib
    return join(here, '..', 'vendor', 'poppler')
  } catch {
    return undefined
  }
}

function sendJson(res: HttpResponseLike, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 读取请求体，超限直接失败 */
function readBody(req: NodeReqLike): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks: string[] = []
    req.on('data', (...args) => {
      const chunk = args[0]
      const text =
        typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
      total += text.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(text)
    })
    req.on('end', () => resolve(chunks.join('')))
    req.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

/** 读 JSON 请求体并做最小校验 */
async function readJson(
  req: NodeReqLike,
  res: HttpResponseLike,
): Promise<Record<string, unknown> | undefined> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'bad-request', message: '只支持 POST' })
    return undefined
  }
  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    sendJson(res, 413, { ok: false, code: 'bad-request', message: '请求体过大' })
    return undefined
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: '请求体不是合法 JSON' })
    return undefined
  }
  return (payload ?? {}) as Record<string, unknown>
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

/** 抽取/OCR/导出的错误码 → HTTP 状态码 */
function statusFor(code: string): number {
  if (code === 'bad-request' || code === 'outside-workspace') return 400
  if (code === 'not-found') return 404
  return 422
}

/** GET /dual-bridge/capabilities */
export async function handleCapabilities(
  req: NodeReqLike,
  res: HttpResponseLike,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'bad-request', message: '只支持 GET' })
    return
  }
  sendJson(res, 200, {
    ok: true,
    hostBuild: HOST_BUILD,
    capabilities: detectCapabilities(bundledPopplerRoot()),
  })
}

/** POST /dual-bridge/extract  { cwd, path } */
export async function handleExtractRoute(
  req: NodeReqLike,
  res: HttpResponseLike,
): Promise<void> {
  const payload = await readJson(req, res)
  if (payload === undefined) return

  const cwd = str(payload, 'cwd')
  const filePath = str(payload, 'path')
  if (cwd === '' || filePath === '') {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: '缺少 cwd 或 path' })
    return
  }

  const result = await extractText({ cwd, filePath, popplerRoot: bundledPopplerRoot() })
  if (result.ok) {
    sendJson(res, 200, result)
    return
  }
  sendJson(res, statusFor(result.code), result)
}

/** POST /dual-bridge/ocr  { cwd, path } */
export async function handleOcrRoute(req: NodeReqLike, res: HttpResponseLike): Promise<void> {
  const payload = await readJson(req, res)
  if (payload === undefined) return

  const cwd = str(payload, 'cwd')
  const filePath = str(payload, 'path')
  if (cwd === '' || filePath === '') {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: '缺少 cwd 或 path' })
    return
  }
  if (!isInsideWorkspace(cwd, filePath)) {
    sendJson(res, 400, {
      ok: false,
      code: 'outside-workspace',
      message: '只允许识别当前工作区内的文件',
    })
    return
  }

  const result = await ocrImage(filePath)
  if (result.ok) {
    sendJson(res, 200, result)
    return
  }
  sendJson(res, statusFor(result.code ?? 'failed'), result)
}

/** POST /dual-bridge/bundle  { cwd, entries: [{relPath, absPath}], makeZip } */
export async function handleBundleRoute(req: NodeReqLike, res: HttpResponseLike): Promise<void> {
  const payload = await readJson(req, res)
  if (payload === undefined) return

  const cwd = str(payload, 'cwd')
  const rawEntries = payload.entries
  if (cwd === '' || !Array.isArray(rawEntries) || rawEntries.length === 0) {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: '缺少 cwd 或 entries' })
    return
  }

  const entries = rawEntries
    .map((item) => (item ?? {}) as Record<string, unknown>)
    .map((item) => ({ relPath: str(item, 'relPath'), absPath: str(item, 'absPath') }))
    .filter((item) => item.relPath !== '' && item.absPath !== '')

  if (entries.length === 0) {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: 'entries 里没有有效路径' })
    return
  }

  const result = await createBundle({ cwd, entries, makeZip: payload.makeZip === true })
  if (result.ok) {
    sendJson(res, 200, result)
    return
  }
  sendJson(res, statusFor(result.code), result)
}

/** POST /dual-bridge/reveal  { cwd, path } —— 在访达中显示 */
export async function handleRevealRoute(req: NodeReqLike, res: HttpResponseLike): Promise<void> {
  const payload = await readJson(req, res)
  if (payload === undefined) return

  const cwd = str(payload, 'cwd')
  const target = str(payload, 'path')
  if (cwd === '' || target === '') {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: '缺少 cwd 或 path' })
    return
  }
  // 导出包在桌面（工作区之外），单独放行 dsh-pack-* 目录
  const isBundlePath =
    basename(target).startsWith('dsh-pack-') &&
    (dirname(target) === join(homedir(), 'Desktop') || dirname(target) === homedir())
  if (target !== cwd && !isInsideWorkspace(cwd, target) && !isBundlePath) {
    sendJson(res, 400, {
      ok: false,
      code: 'outside-workspace',
      message: '只允许打开当前工作区内的路径',
    })
    return
  }
  // 跨平台"在文件管理器中显示"
  let command: string
  let args: string[]
  if (process.platform === 'darwin') {
    command = '/usr/bin/open'
    args = ['-R', target]
  } else if (process.platform === 'win32') {
    command = 'explorer'
    args = ['/select,', target]
  } else {
    command = 'xdg-open'
    args = [target]
  }
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    sendJson(res, 422, { ok: false, code: 'unsupported', message: `本平台无法自动打开：${command}` })
    return
  }
  sendJson(res, 200, { ok: true })
}

export function apply(ctx: Context): void {
  const server = (ctx as unknown as { webServer?: WebServerLike }).webServer
  if (server === undefined) return // 无 web 服务的 profile：静默不激活

  const registrations: [string, (req: NodeReqLike, res: HttpResponseLike) => Promise<void>][] = [
    [ROUTES.capabilities, handleCapabilities],
    [ROUTES.extract, handleExtractRoute],
    [ROUTES.ocr, handleOcrRoute],
    [ROUTES.bundle, handleBundleRoute],
    [ROUTES.reveal, handleRevealRoute],
  ]
  for (const [path, handler] of registrations) {
    ctx.effect(() => server.register({ kind: 'exact', path, handler }))
  }
}
