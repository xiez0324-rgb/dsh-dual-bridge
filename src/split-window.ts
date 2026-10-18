/**
 * 同屏双窗 —— 把 DeepSeek 网页版开在 Harness 窗口**右侧的独立窗口**里。
 *
 * 为什么不用 iframe（决定性事实，勿再尝试）：
 *   chat.deepseek.com 的响应头声明 `content-security-policy: frame-ancestors 'none'`，
 *   任何站点（含 Harness 自己、含 better-sidebar 内置的内嵌浏览器）都无法用 iframe
 *   加载它。better-sidebar 对此内置了兜底文案「{host} 拒绝了嵌入请求」。
 *   CSP 由浏览器强制执行，前端代码无法干预；唯一能"强行内嵌"的手段是本地代理改写
 *   响应头或浏览器扩展去 CSP —— 两者都越界（插件的合规边界禁止代理/中转/自动化），
 *   且属于绕过站点安全策略，本插件不做。
 *
 * 因此采用本文件的方案：独立窗口 + 精确几何定位，让它**贴着侧边栏右侧**出现，
 * 达到"同屏并排、不用来回切标签页"的体验，同时完全不触碰浏览器自动化。
 *
 * 纯函数（computeSplitGeometry / splitFeatures）与副作用（openSplitWindow）分离，
 * 前者可在 node 下直接单测。
 */

/** 只取用到的字段，便于测试时传假对象。 */
export interface ScreenLike {
  availWidth: number
  availHeight: number
  availLeft?: number
  availTop?: number
}

export interface SplitGeometry {
  width: number
  height: number
  left: number
  top: number
}

/** 占可用宽度的比例：留出左侧 Harness + 侧边栏的空间。 */
export const SPLIT_WIDTH_RATIO = 0.46
export const MIN_SPLIT_WIDTH = 420
export const MAX_SPLIT_WIDTH = 1400
/** 与屏幕右边缘的留白，避免贴着 Dock/滚动条。 */
export const SPLIT_EDGE_GAP = 12
export const MIN_SPLIT_HEIGHT = 360

/**
 * 计算同屏窗口的几何位置：贴右、纵向居中、宽度限制在合理区间。
 * 小屏时优先保证能完整放下（宽度/高度都不超过可用区域）。
 */
export function computeSplitGeometry(screen: ScreenLike): SplitGeometry {
  const availWidth = Math.max(1, Math.floor(screen.availWidth) || 0)
  const availHeight = Math.max(1, Math.floor(screen.availHeight) || 0)
  const availLeft = Math.floor(screen.availLeft ?? 0) || 0
  const availTop = Math.floor(screen.availTop ?? 0) || 0

  const wanted = Math.round(availWidth * SPLIT_WIDTH_RATIO)
  const width = Math.min(availWidth, Math.min(MAX_SPLIT_WIDTH, Math.max(MIN_SPLIT_WIDTH, wanted)))
  const height = Math.min(availHeight, Math.max(MIN_SPLIT_HEIGHT, Math.round(availHeight * 0.94)))

  // 贴右：右边缘留 SPLIT_EDGE_GAP；不足时退化为左对齐
  const left = Math.max(availLeft, availLeft + availWidth - width - SPLIT_EDGE_GAP)
  const top = Math.max(availTop, availTop + Math.round((availHeight - height) / 2))

  return { width, height, left, top }
}

/** 生成 window.open 的 features 字符串。 */
export function splitFeatures(geometry: SplitGeometry): string {
  return [
    'popup=yes',
    `width=${geometry.width}`,
    `height=${geometry.height}`,
    `left=${geometry.left}`,
    `top=${geometry.top}`,
  ].join(',')
}

/** 默认窗口名：同名窗口会被复用，不会越点越多。 */
export const SPLIT_WINDOW_NAME = 'dsh-dual-bridge-web'

export interface OpenSplitResult {
  window: Window | null
  /** true 表示复用了已存在的窗口（只聚焦，不重新导航，避免打断已有对话）。 */
  reused: boolean
}

/** 模块级引用：记住我们开过哪个窗口，用来判断"复用"还是"新建"。 */
let splitWindow: Window | null = null

/**
 * 打开（或聚焦）同屏网页版窗口。
 *
 * 注意：复用时刻意**不重新导航**。若每次都 window.open(同一个名字)，
 * 浏览器会把已存在的窗口重新导航到该 URL —— 那会丢掉用户已经进行中的对话。
 * 因此这里只 focus()；只有窗口被关闭后才新建。
 */
export function openSplitWindow(
  url: string,
  screenLike?: ScreenLike,
  name: string = SPLIT_WINDOW_NAME,
): OpenSplitResult {
  if (typeof window === 'undefined') return { window: null, reused: false }

  if (splitWindow !== null && !splitWindow.closed) {
    try {
      splitWindow.focus()
    } catch {
      /* 跨源窗口 focus 可能抛错，忽略即可 */
    }
    return { window: splitWindow, reused: true }
  }

  const screen = screenLike ?? {
    availWidth: window.screen?.availWidth ?? 1280,
    availHeight: window.screen?.availHeight ?? 800,
    availLeft: (window.screen as ScreenLike | undefined)?.availLeft ?? 0,
    availTop: (window.screen as ScreenLike | undefined)?.availTop ?? 0,
  }

  const win = window.open(url, name, splitFeatures(computeSplitGeometry(screen)))
  splitWindow = win

  if (win !== null) {
    // 断开被打开页面对本站的 window.opener 反向引用（安全习惯），
    // 我们自己的 win 句柄仍然可用（focus/closed 不受跨源限制）。
    try {
      win.opener = null
    } catch {
      /* 某些浏览器在此处抛错，忽略 */
    }
    try {
      win.focus()
    } catch {
      /* 忽略 */
    }
  }

  return { window: win, reused: false }
}

/** 测试用：清掉记住的窗口引用。 */
export function forgetSplitWindow(): void {
  splitWindow = null
}
