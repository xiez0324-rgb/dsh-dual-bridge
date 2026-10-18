/**
 * 可抽取判定 —— host 与 client 共用的唯一事实来源。
 *
 * 为什么单独成文件：抽取能力由 host 实现（extract.ts），但"该不该显示抽取按钮"
 * 由 client 决定。如果两处各写一份扩展名清单，迟早漂移，出现"按钮点了才报不支持"
 * 的误导性交互。所以两边都从这里取。
 *
 * 注意：这里只放**纯判定**，不 import 任何 node 模块，client bundle 才能安全引用。
 */

/** macOS 自带 textutil 可转纯文本的扩展名 */
export const TEXTUTIL_EXTS: readonly string[] = [
  '.doc',
  '.docx',
  '.rtf',
  '.rtfd',
  '.html',
  '.htm',
  '.odt',
  '.wordml',
  '.webarchive',
]

/** PDF：需要 poppler（或系统 pdftotext） */
export const PDF_EXTS: readonly string[] = ['.pdf']

function extOf(relPath: string): string {
  const base = relPath.toLowerCase()
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i)
}

/** 抽取类型：pdf / textutil / none */
export type ExtractKind = 'pdf' | 'office' | 'none'

export function extractKindOf(relPath: string): ExtractKind {
  const ext = extOf(relPath)
  if (PDF_EXTS.includes(ext)) return 'pdf'
  if (TEXTUTIL_EXTS.includes(ext)) return 'office'
  return 'none'
}

/**
 * 该文件是否支持本地文本抽取。
 * 图片（png/jpg）、音视频（mov/mp4）、压缩包（zip）等一律 false ——
 * 它们没有文字层，只能靠 OCR，而本插件不做 OCR，因此**不应显示抽取按钮**。
 */
export function isExtractablePath(relPath: string): boolean {
  return extractKindOf(relPath) !== 'none'
}

/** 图片扩展名（可尝试 OCR） */
export const IMAGE_EXTS: readonly string[] = [
  '.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif', '.bmp', '.gif', '.heic',
]

/** 是否为图片（客户端据此显示 OCR 按钮，宿主据此选择 OCR 引擎） */
export function isImagePath(relPath: string): boolean {
  const ext = extOf(relPath)
  return IMAGE_EXTS.includes(ext)
}

/** 该文件能否被"变成文本"：PDF / Office 抽取，或图片 OCR */
export function isTextConvertible(relPath: string): boolean {
  return isExtractablePath(relPath) || isImagePath(relPath)
}
