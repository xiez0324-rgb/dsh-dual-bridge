/**
 * 核心打包逻辑：扫描项目 -> 过滤 -> 组装 prompt -> token 预算控制
 * 纯函数模块，不依赖 React，便于测试。
 */
/** 默认排除的目录/文件（配合 gitignore 语义）。 */
export declare const DEFAULT_EXCLUDES: readonly ['node_modules', '.git', 'dist', 'build', 'out', '.cache', '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode', '.DS_Store', '*.pyc', '*.o', '*.so', '*.dylib', '.next', '.nuxt', 'coverage', '.turbo', '.parcel-cache'];
export interface PackableFile {
    path: string;
    /** 相对工作区的路径，如 src/main.py */
    relPath: string;
    /** 从扩展名推测的语言，用于代码块标记。 */
    lang: string;
}
/** 粗略 token 估算：1 token ≈ 4 字符（中文/英文混合取近似）。 */
export declare function estimateTokens(text: string): number;
export declare function extLang(path: string): string;
export declare function shouldSkipByExt(path: string): boolean;
/** 决定文件是否应被包含。exclude 为附加规则（用户勾选 + 默认）。 */
export declare function shouldInclude(relPath: string, exclude: readonly string[]): boolean;
/** 组装单个文件的代码块。内容中的三反引号会被转义，避免破坏 prompt 结构。 */
export declare function buildFileBlock(relPath: string, content: string): string;
/**
 * 组装项目树（缩进式文本）。
 *
 * 修复点：旧版只记录文件的直接父目录，导致中间目录层（如 src/a/b.py 中的 src、src/a）
 * 丢失。新版用嵌套 Map 重建完整目录树，再按深度优先渲染。
 */
export declare function buildTreeText(files: {
    relPath: string;
}[]): string;
/** 组装完整 prompt。返回文本与 token 估算。 */
export interface PackResult {
    prompt: string;
    tokens: number;
    fileCount: number;
    treeText: string;
}
export declare function assemblePrompt(treeText: string, files: {
    relPath: string;
    content: string;
}[], note?: string): PackResult;
