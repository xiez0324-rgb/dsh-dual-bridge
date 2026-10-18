/**
 * 本地实现的 better-sidebar 文件 API。
 *
 * 背景：better-sidebar 的 `api` 对象是 client-registry 内部实现，未作为
 * 模块导出给外部插件（官方 client bundle 只导出 apply/inject）。
 * 但它的机制是公开的：`POST /sidebar/api/<method>`，payload 携带
 * sessionId/cwd，响应为 `{ok:true, value}` envelope（见 client-registry.js
 * 的 call()/scopePayload()/readEnvelope()，语义完全一致）。
 *
 * 本模块用 fetch 复刻官方行为，零外部依赖，仅用于只读工作区文件
 * （sessionCwd / fsTree / fsRead），完全符合插件的合规边界。
 */
import type { TabComponentProps } from 'dsh-better-sidebar'

export interface SessionScope {
  sessionId: string
  cwd?: string
  repoRoot?: string
}

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

export type FsReadResult =
  | {
      kind: 'text'
      content: string
      size: number
    }
  | {
      kind: 'binary' | 'too-large'
      size: number
      head: string
    }

export interface FsLevel {
  path: string
  entries: FsEntry[]
  truncated: boolean
  /** Present only when THIS level failed (the batch itself succeeded). */
  error?: string
}

/** 从页面基址解析 /sidebar 路由（与 hostRouteUrl 语义一致）。 */
function routeUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : undefined
  const origin = base && base !== '' ? base : 'http://dsh.internal/'
  return new URL(path.replace(/^\/+/, ''), origin).href
}

class SidebarApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 解析 {ok:true,value} envelope；失败抛 SidebarApiError（与官方 readEnvelope 一致）。 */
async function readEnvelope(response: Response): Promise<any> {
  const parsed = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value
}

async function call(method: string, payload: Record<string, unknown>): Promise<any> {
  let response: Response
  try {
    response = await fetch(routeUrl(`sidebar/api/${method}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  return readEnvelope(response)
}

function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {},
    ...scope.repoRoot !== undefined && scope.repoRoot !== '' ? { repoRoot: scope.repoRoot } : {},
    ...extra,
  }
}

/** 取 scope（TabComponentProps 自带）。 */
export function scopeOf(props: TabComponentProps): SessionScope {
  return props.scope as SessionScope
}

/** host 端抽取/OCR 路由的返回体（裸 JSON，不是 sidebar 的 {ok,value} 信封） */
export interface ExtractResponse {
  ok: boolean
  text?: string
  chars?: number
  truncated?: boolean
  engine?: string
  code?: string
  message?: string
}

/** 本机能力（客户端据此决定哪些按钮可用，避免"点了才报不支持"） */
export interface HostCapabilitiesResponse {
  ok: boolean
  hostBuild?: string
  capabilities?: Capabilities
}

export interface Capabilities {
  pdf: boolean
  pdfEngine: 'poppler' | 'system-pdftotext' | null
  office: boolean
  officeEngine?: 'zip-xml' | 'textutil'
  ocr: 'vision' | 'tesseract' | 'wasm' | null
  platform: string
}

/** 导出包结果 */
export interface BundleResponse {
  ok: boolean
  dir?: string
  zipPath?: string
  fileCount?: number
  bytes?: number
  manifestPath?: string
  code?: string
  message?: string
}

/** 通用 JSON 调用（我们自己的 host 路由都是裸 JSON 响应） */
async function callJson<T>(path: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(routeUrl(path), {
    method: payload === undefined ? 'GET' : 'POST',
    ...(payload === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  })
  return (await response.json().catch(() => ({ ok: false, code: 'http', message: `HTTP ${response.status}` }))) as T
}

/** 调用 host 抽取/OCR：POST /dual-bridge/{extract|ocr} */
async function callExtract(
  cwd: string,
  path: string,
  endpoint: 'extract' | 'ocr' = 'extract',
): Promise<ExtractResponse> {
  return callJson<ExtractResponse>(`dual-bridge/${endpoint}`, { cwd, path })
}

export const api = {
  sessionCwd: (scope: SessionScope): Promise<{
    sessionId: string
    cwd: string
    root: string
    parent: string | null
  }> => call('session.cwd', scopePayload(scope, {})),

  fsTree: (scope: SessionScope, path: string, exclude?: readonly string[]): Promise<{
    path: string
    entries: FsEntry[]
    truncated: boolean
  }> => call('fs.tree', scopePayload(scope, { path, exclude })),

  /** 批量列出多个目录（一次请求，减少串行往返）。 */
  fsTrees: (scope: SessionScope, paths: readonly string[], exclude?: readonly string[]): Promise<{
    levels: FsLevel[]
  }> => call('fs.trees', scopePayload(scope, { paths, exclude })),

  fsRead: (scope: SessionScope, path: string): Promise<FsReadResult> =>
    call('fs.read', scopePayload(scope, { path })),

  /** 按需抽取 PDF / Office 文本（host 端本地路由） */
  extract: (cwd: string, path: string): Promise<ExtractResponse> => callExtract(cwd, path),

  /** 图片 OCR（macOS Vision / tesseract） */
  ocr: (cwd: string, path: string): Promise<ExtractResponse> => callExtract(cwd, path, 'ocr'),

  /** 本机能力探测（同时带回 host 构建版本，用于发现"host 未重启"） */
  capabilities: async (): Promise<{ caps: Capabilities; hostBuild?: string }> => {
    const parsed = await callJson<HostCapabilitiesResponse>('dual-bridge/capabilities')
    return {
      caps:
        parsed.capabilities ?? {
          pdf: false,
          pdfEngine: null,
          office: false,
          ocr: null,
          platform: 'unknown',
        },
      hostBuild: parsed.hostBuild,
    }
  },

  /** 把无法文本化的文件导出成可拖拽上传的目录（+清单/可选 zip） */
  bundle: (
    cwd: string,
    entries: { relPath: string; absPath: string }[],
    makeZip: boolean,
  ): Promise<BundleResponse> => callJson<BundleResponse>('dual-bridge/bundle', { cwd, entries, makeZip }),

  /** 在访达中显示 */
  reveal: (cwd: string, path: string): Promise<{ ok: boolean }> =>
    callJson<{ ok: boolean }>('dual-bridge/reveal', { cwd, path }),
}
