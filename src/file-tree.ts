/**
 * 文件树：把扁平的扫描结果聚合成可折叠的目录树。
 *
 * 为什么需要它：扁平列表在几百上千个文件时无法使用（用户反馈："文件分得太细"）。
 * 常规设计是**目录树 + 目录级勾选**：
 *   - 目录可展开/折叠，默认折叠，避免一屏几百行
 *   - 勾选目录 = 选中整棵子树（三态：全选 / 半选 / 未选）
 *   - 默认不选任何文件，让用户主动挑选，而不是默认把整个工作区都打包
 *
 * 本模块是纯函数（不依赖 React / DOM），便于单测。
 */
export interface FlatFile {
  relPath: string
  path: string
  size: number
}

export interface TreeNode {
  /** 展示用的名字（路径最后一段） */
  name: string
  /** 相对工作区的路径；目录不带结尾斜杠 */
  relPath: string
  isDir: boolean
  children: TreeNode[]
  /** 文件为自身字节数；目录为其子树内文件字节合计 */
  size: number
  /** 目录内**可打包**的文件总数；可打包文件为 1，二进制文件为 0 */
  fileCount: number
  /**
   * 该节点是二进制文件（PDF/Office/图片等）。
   * 不可勾选打包，但可以按需「抽取文本」。
   */
  binary: boolean
  /**
   * 该目录下被类型过滤跳过的文件数（PDF/图片/Office 等二进制）。
   * 用来解释"为什么这个文件夹里几乎看不到文件"，而不是让目录直接消失。
   */
  skipped: number
}

/** 三态勾选状态 */
export type NodeSelection = 'all' | 'some' | 'none'

/**
 * 由扁平文件列表构建目录树。
 * 排序规则与常见文件管理器一致：同级目录在前，再按名称做本地化排序。
 */
export function buildFileTree(
  files: readonly FlatFile[],
  skippedByDir: Readonly<Record<string, number>> = {},
  skippedFiles: readonly { relPath: string }[] = [],
): TreeNode[] {
  const root: TreeNode = {
    name: '',
    relPath: '',
    isDir: true,
    children: [],
    size: 0,
    fileCount: 0,
    binary: false,
    skipped: 0,
  }
  const dirIndex = new Map<string, TreeNode>([['', root]])

  const ensureDir = (relPath: string): TreeNode => {
    const known = dirIndex.get(relPath)
    if (known !== undefined) return known
    const slash = relPath.lastIndexOf('/')
    const parentPath = slash < 0 ? '' : relPath.slice(0, slash)
    const parent = ensureDir(parentPath)
    const node: TreeNode = {
      name: slash < 0 ? relPath : relPath.slice(slash + 1),
      relPath,
      isDir: true,
      children: [],
      size: 0,
      fileCount: 0,
      binary: false,
      skipped: 0,
    }
    parent.children.push(node)
    dirIndex.set(relPath, node)
    return node
  }

  for (const file of files) {
    const slash = file.relPath.lastIndexOf('/')
    const parentPath = slash < 0 ? '' : file.relPath.slice(0, slash)
    const name = slash < 0 ? file.relPath : file.relPath.slice(slash + 1)
    ensureDir(parentPath).children.push({
      name,
      relPath: file.relPath,
      isDir: false,
      children: [],
      size: file.size,
      fileCount: 1,
      binary: false,
      skipped: 0,
    })
  }

  // 二进制文件也建出节点：UI 上要能对它点「抽取文本」，
  // 而不是只剩一个笼统的"跳过 N 个"。
  for (const file of skippedFiles) {
    const slash = file.relPath.lastIndexOf('/')
    const parentPath = slash < 0 ? '' : file.relPath.slice(0, slash)
    const name = slash < 0 ? file.relPath : file.relPath.slice(slash + 1)
    ensureDir(parentPath).children.push({
      name,
      relPath: file.relPath,
      isDir: false,
      children: [],
      size: 0,
      fileCount: 0,
      binary: true,
      skipped: 0,
    })
  }

  // 仅为跳过计数而存在的目录（例如整个文件夹都是 PDF）也要建出来，
  // 否则用户会觉得"这个目录根本没被扫到"。
  for (const [dirPath, skipped] of Object.entries(skippedByDir)) {
    const node = ensureDir(dirPath)
    node.skipped += skipped
  }

  const finalize = (node: TreeNode): void => {
    if (!node.isDir) return
    node.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    let size = 0
    let count = 0
    let skipped = node.skipped
    for (const child of node.children) {
      finalize(child)
      size += child.size
      count += child.fileCount
      skipped += child.skipped
    }
    node.size = size
    node.fileCount = count
    node.skipped = skipped
  }
  finalize(root)

  return root.children
}

/** 该节点覆盖的全部文件相对路径（目录=整棵子树；文件=自身）。 */
export function collectFilePaths(node: TreeNode, out: string[] = []): string[] {
  if (!node.isDir) {
    if (!node.binary) out.push(node.relPath) // 二进制文件不可打包
    return out
  }
  for (const child of node.children) collectFilePaths(child, out)
  return out
}

/** 该节点下已选中的文件数量。 */
export function countSelected(node: TreeNode, selected: ReadonlySet<string>): number {
  if (!node.isDir) return !node.binary && selected.has(node.relPath) ? 1 : 0
  let hit = 0
  for (const child of node.children) hit += countSelected(child, selected)
  return hit
}

/** 该节点的三态勾选状态。 */
export function selectionOf(node: TreeNode, selected: ReadonlySet<string>): NodeSelection {
  if (!node.isDir) return !node.binary && selected.has(node.relPath) ? 'all' : 'none'
  if (node.fileCount === 0) return 'none'
  const hit = countSelected(node, selected)
  if (hit === 0) return 'none'
  return hit === node.fileCount ? 'all' : 'some'
}

/**
 * 切换一个节点的选中状态，返回新的选中集合。
 * 目录的语义：未全选（none/some）→ 全选；已全选 → 全部取消。
 */
export function toggleNodeSelection(
  node: TreeNode,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected)
  const selectAll = selectionOf(node, selected) !== 'all'
  for (const filePath of collectFilePaths(node)) {
    if (selectAll) next.add(filePath)
    else next.delete(filePath)
  }
  return next
}

/** 收集整棵树里的目录相对路径（用于「展开全部」）。 */
export function collectDirPaths(nodes: readonly TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.isDir) continue
    out.push(node.relPath)
    collectDirPaths(node.children, out)
  }
  return out
}
