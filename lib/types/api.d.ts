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
import type { TabComponentProps } from 'dsh-better-sidebar';
export interface SessionScope {
    sessionId: string;
    cwd?: string;
    repoRoot?: string;
}
export interface FsEntry {
    name: string;
    path: string;
    isDir: boolean;
    hidden: boolean;
    isSymlink: boolean;
    broken: boolean;
}
export interface FsReadResult {
    kind: 'text';
    content: string;
    size: number;
}
/** 取 scope（TabComponentProps 自带）。 */
export declare function scopeOf(props: TabComponentProps): SessionScope;
export declare const api: {
    sessionCwd: (scope: SessionScope) => Promise<{
        sessionId: string;
        cwd: string;
        root: string;
        parent: string | null;
    }>;
    fsTree: (scope: SessionScope, path: string, exclude?: readonly string[]) => Promise<{
        path: string;
        entries: FsEntry[];
        truncated: boolean;
    }>;
    fsRead: (scope: SessionScope, path: string) => Promise<FsReadResult>;
};
