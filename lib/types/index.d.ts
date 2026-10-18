/**
 * dsh-dual-bridge —— host 端占位
 *
 * 本插件所有逻辑都在 client 端（better-sidebar 注册 Tab + 打包 + 复制）。
 * host 端仅保留一个空 apply，供 cordis 在 node 侧挂载 bundle，
 * 否则 profile boot 会因找不到 host 入口而报错。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-dual-bridge";
export declare function apply(_ctx: Context): void;
