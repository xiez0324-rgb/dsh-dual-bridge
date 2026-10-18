/**
 * bundle.ts —— 把「无法文本化」的文件打包成一个可直接拖拽上传的导出包
 *
 * 为什么需要它：图片/PDF/视频没法变成文本，但网页 AI 能直接读**上传的图片和文档**。
 * 本插件不能替你上传（不操控浏览器），所以退一步：
 *   把选中的二进制文件**复制到一个干净目录**，并生成一份 `附件清单.md`，
 *   你把这个目录里的文件一起拖进网页版输入框即可，不用再去原位置一个个找。
 *
 * 设计要点：
 *   - 全部文件名/路径都经过 `isInsideWorkspace` 围栏，只允许工作区内的文件
 *   - 保持相对目录结构，避免同名文件互相覆盖
 *   - 清单是**纯文本**，本身就是"一个便于 AI 读取的文件"
 *   - zip 可选：只解决"一次搬运"，网页 AI 不会解析 zip 内部（清单里会写明）
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { isInsideWorkspace } from './extract'

export interface BundleEntry {
  /** 相对工作区的路径，用于还原目录结构 */
  relPath: string
  /** 绝对路径 */
  absPath: string
}

export interface BundleRequest {
  cwd: string
  entries: readonly BundleEntry[]
  /** 是否再打一个 zip（仅便于传输/归档） */
  makeZip?: boolean
  /** 目录名后缀（默认时间戳） */
  stamp?: string
  /** 导出到哪里（默认桌面）；用于测试与自定义 */
  destRoot?: string
}

export type BundleFailureCode =
  | 'bad-request'
  | 'outside-workspace'
  | 'not-found'
  | 'empty'
  | 'copy-failed'
  | 'zip-failed'

export interface BundleOk {
  ok: true
  dir: string
  zipPath?: string
  fileCount: number
  bytes: number
  manifestPath: string
}

export interface BundleErr {
  ok: false
  code: BundleFailureCode
  message: string
}

export type BundleResult = BundleOk | BundleErr

/** 按扩展名给出"该怎么给 AI 看"的建议（写进清单） */
export function suggestionFor(relPath: string): string {
  const lower = relPath.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.'))
  if (['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif', '.bmp', '.gif', '.heic'].includes(ext)) {
    return '图片：直接作为图片上传，AI 才能看到内容'
  }
  if (ext === '.pdf') return 'PDF：直接上传原文件；若文字可选中，也可先用「抽取文本」'
  if (['.doc', '.docx', '.rtf', '.odt', '.pages', '.html', '.htm'].includes(ext)) {
    return '文档：直接上传原文件（或先用「抽取文本」）'
  }
  if (['.ppt', '.pptx', '.key', '.xls', '.xlsx', '.numbers', '.csv'].includes(ext)) {
    return '表格/演示：可上传原文件；结构化内容建议先用「抽取文本」'
  }
  if (['.mov', '.mp4', '.avi', '.mkv', '.wav', '.mp3', '.m4a', '.webm'].includes(ext)) {
    return '音视频：AI 无法直接解析，建议截图关键画面或文字描述'
  }
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) {
    return '压缩包：AI 不解析压缩包内部，建议先解压再上传需要的文件'
  }
  return '按需上传'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 生成 `附件清单.md` 的正文（纯函数，可单测） */
export function buildManifestText(
  rows: readonly { relPath: string; size: number }[],
  options: { workspace: string; createdAt: string; zipName?: string; totalBytes: number },
): string {
  const lines: string[] = [
    '# 附件清单（请把这些文件上传给 AI）',
    '',
    `- 生成时间：${options.createdAt}`,
    `- 来源工作区：\`${options.workspace}\``,
    `- 文件数：${rows.length} 个（合计 ${formatBytes(options.totalBytes)}）`,
    '',
    '> 这些文件无法直接转成文本，所以本工具把它们复制到本目录。',
    '> 请把需要的文件**拖进网页版对话输入框**一并上传，AI 才能读到它们的内容。',
    '',
  ]
  if (options.zipName !== undefined) {
    lines.push(
      `> 旁边的 \`${options.zipName}\` 只是便于传输/归档：**AI 不会解析 zip 内部**，请先解压再上传。`,
      '',
    )
  }
  lines.push('| 文件 | 大小 | 建议 |', '| --- | --- | --- |')
  for (const row of rows) {
    lines.push(`| \`${row.relPath}\` | ${formatBytes(row.size)} | ${suggestionFor(row.relPath)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * 跨平台打 zip：
 *   - macOS / Linux：`zip -r -q -X`
 *   - Windows：PowerShell `Compress-Archive`（系统自带）
 */
function runZip(zipPath: string, cwd: string, target: string): Promise<boolean> {
  const [command, args] =
    process.platform === 'win32'
      ? [
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Compress-Archive -Path '${target}' -DestinationPath '${zipPath}' -Force`,
          ],
        ]
      : ['zip', ['-r', '-q', '-X', zipPath, target]]
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * 导出包默认位置：**桌面**（找不到桌面目录时退回用户主目录）。
 * 放桌面而不是工作区，是为了不污染项目目录，且拖拽上传时更容易找到。
 */
export function defaultBundleRoot(): string {
  const desktop = join(homedir(), 'Desktop')
  return existsSync(desktop) ? desktop : homedir()
}

/** 时间戳目录名：dsh-pack-YYYYMMDD-HHmmss */
export function packDirName(stamp?: string): string {
  if (stamp !== undefined && stamp !== '') return `dsh-pack-${stamp}`
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `dsh-pack-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 创建导出包：复制文件 → 写清单 →（可选）打 zip。
 * 任何失败都返回结构化错误码，不抛穿。
 */
export async function createBundle(request: BundleRequest): Promise<BundleResult> {
  const { cwd, entries } = request
  if (cwd === '' || entries.length === 0) {
    return { ok: false, code: 'empty', message: '没有需要导出的文件' }
  }

  // 围栏：所有路径必须在工作区内
  for (const entry of entries) {
    if (!isInsideWorkspace(cwd, entry.absPath)) {
      return {
        ok: false,
        code: 'outside-workspace',
        message: `只允许导出工作区内的文件：${entry.relPath}`,
      }
    }
  }

  const dirName = packDirName(request.stamp)
  const destRoot = request.destRoot ?? defaultBundleRoot()
  const dir = join(destRoot, dirName)
  const rows: { relPath: string; size: number }[] = []
  let bytes = 0

  try {
    await mkdir(dir, { recursive: true })
    for (const entry of entries) {
      const info = await stat(entry.absPath).catch(() => undefined)
      if (info === undefined || !info.isFile()) {
        return { ok: false, code: 'not-found', message: `文件不存在：${entry.relPath}` }
      }
      // 保持相对目录结构，避免同名覆盖
      const target = join(dir, entry.relPath)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(entry.absPath, target)
      rows.push({ relPath: entry.relPath, size: info.size })
      bytes += info.size
    }
  } catch (error) {
    return {
      ok: false,
      code: 'copy-failed',
      message: `复制失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const manifestPath = join(dir, '附件清单.md')
  let zipPath: string | undefined
  if (request.makeZip === true) {
    zipPath = join(destRoot, `${dirName}.zip`)
  }

  try {
    await writeFile(
      manifestPath,
      buildManifestText(rows, {
        workspace: cwd,
        createdAt: new Date().toLocaleString('zh-CN'),
        zipName: zipPath === undefined ? undefined : basename(zipPath),
        totalBytes: bytes,
      }),
      'utf8',
    )
  } catch (error) {
    return {
      ok: false,
      code: 'copy-failed',
      message: `写清单失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (zipPath !== undefined) {
    const ok = await runZip(zipPath, destRoot, dirName)
    if (!ok) {
      return { ok: false, code: 'zip-failed', message: '创建 zip 失败（目录已生成，可直接使用）' }
    }
  }

  return { ok: true, dir, zipPath, fileCount: rows.length, bytes, manifestPath }
}
