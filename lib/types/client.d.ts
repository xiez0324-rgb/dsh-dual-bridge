/**
 * dsh-dual-bridge —— client 端入口
 *
 * 在 better-sidebar 右侧栏注册一个「分流对话」Tab。
 * 合规边界：只做本地文本处理 + 复制剪贴板，绝不操控浏览器、绝不调网页后端。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const inject: string[];
export declare function apply(ctx: Context): void;
