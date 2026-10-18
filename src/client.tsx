/**
 * dsh-dual-bridge —— client 端入口
 *
 * 在 better-sidebar 右侧栏注册一个「分流对话」Tab。
 * 合规边界：只做本地文本处理 + 复制剪贴板，绝不操控浏览器、绝不调网页后端。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-better-sidebar'
import { DualBridgeTab } from './DualBridgeTab'

export const inject = ['betterSidebar']

export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'dual-bridge',
      title: '分流对话',
      description: '打包项目上下文并复制，一键同屏打开 DeepSeek 网页版粘贴提问（推理仍走 Harness API）',
      icon: (size) => (
        <span style={{ fontSize: size * 0.7, lineHeight: 1, fontWeight: 700 }}>⇄</span>
      ),
      order: 80,
      single: true,
      component: (props) => <DualBridgeTab {...props} />,
    }),
  )
}
