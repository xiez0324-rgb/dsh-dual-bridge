/**
 * 核心打包逻辑：扫描项目 -> 过滤 -> 组装 prompt -> token 预算控制
 * 纯函数模块，不依赖 React，便于测试。
 */

/** 默认排除的目录/文件（配合 gitignore 语义）。 */
export const DEFAULT_EXCLUDES = [
  'node_modules', '.git', 'dist', 'build', 'out', '.cache',
  '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode',
  '.DS_Store', '*.pyc', '*.o', '*.so', '*.dylib',
  '.next', '.nuxt', 'coverage', '.turbo', '.parcel-cache',
  // 本插件自己的导出包目录，绝不能被扫回文件树（否则形成自污染循环）
  'dsh-pack-*',
] as const

/** 二进制/不可读扩展名，跳过。 */
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.mp4', '.mp3',
  '.wasm', '.woff', '.woff2', '.ttf', '.eot', '.exe', '.dll', '.so', '.dylib', '.lock',
  // Office / 文档 / 设计稿：进文件表只会污染列表，host 读取时也一律判为 binary
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.pages', '.numbers', '.key', '.rtf', '.odt',
  // 音视频与其它容器格式
  '.mov', '.avi', '.mkv', '.wav', '.flac', '.m4a', '.webm',
  '.jar', '.class', '.o', '.a', '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
  '.dmg', '.iso', '.psd', '.sketch', '.fig', '.ai',
])

export interface PackableFile {
  path: string
  /** 相对工作区的路径，如 src/main.py */
  relPath: string
  /** 从扩展名推测的语言，用于代码块标记。 */
  lang: string
}

/** 粗略 token 估算：1 token ≈ 4 字符（中文/英文混合取近似）。 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** 从路径取扩展名并映射到代码块语言标记。 */
const EXT_LANG: Record<string, string> = {
  '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.tsx': 'tsx',
  '.jsx': 'jsx', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.java': 'java', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.md': 'markdown',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.html': 'html', '.css': 'css', '.sql': 'sql', '.xml': 'xml',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini', '.txt': 'text',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
}

export function extLang(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'text'
  const ext = path.slice(dot).toLowerCase()
  return EXT_LANG[ext] ?? 'text'
}

export function shouldSkipByExt(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return SKIP_EXT.has(path.slice(dot).toLowerCase())
}

/** 判断路径是否命中排除规则（简单 glob 匹配，供 / 结尾目录和 * 通配）。 */
function matchesPattern(relPath: string, pattern: string): boolean {
  const p = relPath.replace(/\\/g, '/')
  const norm = pattern.replace(/\\/g, '/')
  if (norm.endsWith('/')) {
    return p === norm.slice(0, -1) || p.startsWith(norm)
  }
  if (norm.startsWith('*.')) {
    return p.endsWith(norm.slice(1))
  }
  // 无通配时精确匹配相对路径
  return p === norm
}

/** 决定文件是否应被包含。exclude 为附加规则（用户勾选 + 默认）。 */
export function shouldInclude(relPath: string, exclude: readonly string[]): boolean {
  const p = relPath.replace(/\\/g, '/')
  const name = p.split('/').pop() ?? p
  for (const rule of exclude) {
    if (matchesPattern(p, rule)) return false
    // 目录名匹配：任一路径段命中即排除（node_modules 语义）
    if (p.split('/').includes(rule)) return false
  }
  // 导出包目录（dsh-pack-20261018-150610 等）永远排除
  if (p.split('/').some((segment) => segment.startsWith('dsh-pack-'))) return false
  if (shouldSkipByExt(p)) return false
  if (name.startsWith('.') && name !== '.gitignore' && name !== '.env.example') return false
  return true
}

/** 组装单个文件的代码块。内容中的三反引号会被转义，避免破坏 prompt 结构。 */
export function buildFileBlock(relPath: string, content: string): string {
  const lang = extLang(relPath)
  // 内容中含 ``` 时转义为四反引号边界，保证代码块结构完整
  const safeContent = content.replace(/```/g, '````')
  return `\n### \`${relPath}\`\n\`\`\`${lang}\n${safeContent}\n\`\`\`\n`
}

/**
 * 组装项目树（缩进式文本）。
 *
 * 修复点：旧版只记录文件的直接父目录，导致中间目录层（如 src/a/b.py 中的 src、src/a）
 * 丢失。新版用嵌套 Map 重建完整目录树，再按深度优先渲染。
 */
export function buildTreeText(files: readonly { relPath: string }[]): string {
  // 嵌套目录树：dir -> Map<name, node>；node.isDir 表示是否为目录节点
  interface TreeNode {
    children: Map<string, TreeNode>
    isDir: boolean
  }
  const root: TreeNode = { children: new Map(), isDir: true }

  for (const f of files) {
    const parts = f.relPath.split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      let child = node.children.get(part)
      if (!child) {
        child = { children: new Map(), isDir: !isLast }
        node.children.set(part, child)
      }
      node = child
    }
  }

  const lines: string[] = []
  const walk = (node: TreeNode, depth: number) => {
    const entries = [...node.children.entries()].sort(([a, na], [b, nb]) => {
      // 目录排在文件前面；同级再按名称排序
      if (na.isDir !== nb.isDir) return na.isDir ? -1 : 1
      return a.localeCompare(b)
    })
    for (const [name, child] of entries) {
      const indent = '  '.repeat(depth)
      lines.push(`${indent}${name}${child.isDir ? '/' : ''}`)
      if (child.isDir) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}

/** 组装完整 prompt。返回文本与 token 估算。 */
export interface PackResult {
  prompt: string
  tokens: number
  fileCount: number
  treeText: string
}

/** 预算裁剪的输入单元 */
export interface PackInput {
  relPath: string
  content: string
}

export interface BudgetPlan {
  included: PackInput[]
  /** 因预算装不下而跳过的文件（保持原顺序） */
  dropped: string[]
  /** 估算占用（含目录树与模板预留） */
  usedTokens: number
}

/** prompt 模板（标题/说明/表格）自身的粗略 token 预留 */
const TEMPLATE_OVERHEAD_TOKENS = 40

/**
 * 按 token 预算挑选文件：**贪心填充** —— 装不下的那个跳过，继续尝试后面的小文件，
 * 而不是简单地从第一个装不下就整体截断（同尺寸下能塞进更多内容）。
 * 目录树与模板的固定开销会先被预留，避免"正文刚好装满但整包超限"。
 */
/** 附件声明最多列多少条（防止把整个工作区的二进制文件都塞进 prompt） */
export const MAX_ATTACHMENT_LINES = 20

/** 取相对路径所在目录（根目录返回空串） */
export function attachDirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i < 0 ? '' : relPath.slice(0, i)
}

export interface AttachmentPlan {
  /** 真正写进 prompt 的附件路径 */
  listed: string[]
  /** 同类但超出上限而省略的条数 */
  omitted: number
  /** 被跳过的附件总数（用于"另有 N 个"的一句话说明） */
  total: number
}

/**
 * 只挑「与已打包文件同目录」的附件写进 prompt。
 *
 * 为什么：把扫描到的全部二进制文件（可达数百条）塞进 prompt 会造成大量冗余、
 * 白烧 token，而其中绝大多数与本次所选文件毫无关系。同目录才是真正相关的
 * （例如打包 `帮算综测文件夹/x.txt`，该目录下的 .docx 材料才算相关）。
 *
 * 没有同目录附件时**什么都不列**（宁缺勿滥），只由 total 出一句汇总。
 */
export function selectRelevantAttachments(
  includedPaths: readonly string[],
  skippedPaths: readonly string[],
  limit: number = MAX_ATTACHMENT_LINES,
  /** 已经被"抽取文本"纳入 prompt 的路径：不能再出现在"未包含"里 */
  excludePaths: readonly string[] = [],
): AttachmentPlan {
  const excluded = new Set(excludePaths)
  const candidates = skippedPaths.filter((path) => !excluded.has(path))
  const total = candidates.length
  if (includedPaths.length === 0 || total === 0) return { listed: [], omitted: 0, total }

  const dirs = new Set(includedPaths.map(attachDirOf))
  const relevant = candidates.filter((path) => dirs.has(attachDirOf(path)))
  const listed = relevant.slice(0, limit)
  return { listed, omitted: Math.max(0, relevant.length - listed.length), total }
}

export function applyBudget(
  entries: readonly PackInput[],
  tokenBudget: number,
): BudgetPlan {
  const reserve = estimateTokens(buildTreeText(entries)) + TEMPLATE_OVERHEAD_TOKENS
  const included: PackInput[] = []
  const dropped: string[] = []
  let used = reserve

  for (const entry of entries) {
    const cost = estimateTokens(buildFileBlock(entry.relPath, entry.content))
    if (used + cost > tokenBudget) {
      dropped.push(entry.relPath)
      continue
    }
    included.push(entry)
    used += cost
  }
  return { included, dropped, usedTokens: used }
}

export function assemblePrompt(
  treeText: string,
  files: { relPath: string; content: string }[],
  note?: string,
  attachments?: AttachmentPlan,
  extractedFiles?: readonly { relPath: string; content: string }[],
): PackResult {
  const head = [
    '下面是我的项目结构和关键文件，请帮助我理解项目并回答我的问题。',
    '',
    '【项目结构】',
    treeText,
    '',
    '【关键文件内容】',
  ].join('\n')
  const blocks = files.map((f) => buildFileBlock(f.relPath, f.content)).join('')
  // 二进制附件只声明、不给内容：让模型知道"有但没给"，而不是以为不存在
  // 附件段：仅列与所选文件同目录的附件；其余压成一句话汇总，避免冗余
  let skippedSection = ''
  if (attachments !== undefined && attachments.listed.length > 0) {
    skippedSection = [
      '',
      '【未包含的附件（无法作为文本读取）】',
      '以下文件与本次所选文件同目录，但属于 PDF / Office / 图片等二进制格式，内容未包含：',
      ...attachments.listed.map((path) => `- ${path}`),
      ...(attachments.omitted > 0 ? [`- …同目录另有 ${attachments.omitted} 个未列出`] : []),
      '如需分析这些文件，请提示用户在对话中直接上传原文件。',
      '',
    ].join('\n')
  } else if (attachments !== undefined && attachments.total > 0) {
    skippedSection = [
      '',
      '【未包含的附件】',
      `本工作区另有 ${attachments.total} 个 PDF / Office / 图片等二进制文件未包含在上下文中`,
      '（与所选文件不同目录，故未逐一列出）。如需分析具体文件，请提示用户单独上传。',
      '',
    ].join('\n')
  }
  // 按需抽取出来的附件文本单独成段：来源与"原文文件"不同，格式可能有损失
  const extractedSection =
    extractedFiles !== undefined && extractedFiles.length > 0
      ? [
          '',
          '【抽取的附件文本（本地抽取，可能有排版损失）】',
          ...extractedFiles.map((f) => buildFileBlock(f.relPath, f.content)),
        ].join('\n')
      : ''
  const tail = note ? `\n【补充说明】\n${note}\n` : ''
  const prompt = `${head}${blocks}${skippedSection}${extractedSection}${tail}`
  return { prompt, tokens: estimateTokens(prompt), fileCount: files.length, treeText }
}
