/**
 * office-zip.ts —— 纯 Node 实现的 Office 文本抽取（跨平台、零依赖）
 *
 * 为什么需要它：macOS 的 `textutil` 只在 mac 上有，Windows/Linux 用户原本
 * 完全无法抽取 docx/pptx/xlsx —— 这与"插件跨平台通用"直接冲突。
 *
 * 事实：docx/pptx/xlsx 本质都是 **ZIP 容器 + XML**，用 Node 内置 `zlib` 就能解，
 * 不需要任何第三方库、也不需要系统工具。
 *
 * 覆盖范围：
 *   - docx  → word/document.xml 的 <w:t> 文本（按段落换行）
 *   - pptx  → ppt/slides/slideN.xml 的 <a:t> 文本（按幻灯片分节）
 *   - xlsx  → xl/sharedStrings.xml 共享字符串 + 各 sheet 的单元格
 *   - rtf   → 纯文本格式，用控制字剥离（同样跨平台）
 * 不覆盖：旧版二进制 .doc（需要 textutil 或 LibreOffice，只能作为可选加速路径）。
 */
import { inflateRawSync } from 'node:zlib'

// ---------------------------------------------------------------- ZIP 读取
const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/** 找到 End of Central Directory 并返回中央目录位置 */
function findEocd(buf: Buffer): number {
  const min = 22
  const max = Math.min(buf.length, 66_000)
  for (let i = buf.length - min; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/** 列出 ZIP 内的条目（不读取内容） */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 ZIP（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) break
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 读取单个条目的内容（支持 store 与 deflate） */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset
  if (buf.readUInt32LE(at) !== LOC_SIG) throw new Error(`本地头损坏：${entry.name}`)
  const nameLen = buf.readUInt16LE(at + 26)
  const extraLen = buf.readUInt16LE(at + 28)
  const start = at + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) return inflateRawSync(data)
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`)
}

/** 便捷读法：按名字取内容，找不到返回 undefined */
export function readZipFile(buf: Buffer, name: string): Buffer | undefined {
  const entry = listZipEntries(buf).find((e) => e.name === name)
  return entry === undefined ? undefined : readZipEntry(buf, entry)
}

// ---------------------------------------------------------------- XML 文本
const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    const known = XML_ENTITIES[m]
    if (known !== undefined) return known
    if (m.startsWith('&#x')) return String.fromCodePoint(Number.parseInt(m.slice(3, -1), 16))
    if (m.startsWith('&#')) return String.fromCodePoint(Number.parseInt(m.slice(2, -1), 10))
    return m
  })
}

/** 抽 WordprocessingML（docx）正文：<w:t> 文本 + 段落换行 */
function docxText(xml: string): string {
  const withBreaks = xml.replace(/<w:p[ >]/g, '\n<w:p ').replace(/<\/w:p>/g, '\n')
  const texts: string[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(withBreaks)) !== null) {
    // 统计两次 <w:t> 之间出现过几个换行（段落数）
    const between = withBreaks.slice(last, m.index)
    const breaks = (between.match(/\n/g) ?? []).length
    if (breaks > 0 && texts.length > 0) texts.push('\n'.repeat(breaks))
    texts.push(decodeXmlEntities(m[1]))
    last = re.lastIndex
  }
  return texts.join('')
}

/** 抽 PresentationML（pptx）文本：<a:t> */
function pptxText(xml: string): string {
  const texts: string[] = []
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) texts.push(decodeXmlEntities(m[1]))
  return texts.join('\n')
}

/** 抽 SpreadsheetML（xlsx）：共享字符串 + 各 sheet 单元格 */
function xlsxText(buf: Buffer): string {
  const shared: string[] = []
  const sharedBuf = readZipFile(buf, 'xl/sharedStrings.xml')
  if (sharedBuf !== undefined) {
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
    const xml = sharedBuf.toString('utf8')
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) shared.push(decodeXmlEntities(m[1]))
  }

  const entries = listZipEntries(buf)
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const out: string[] = []
  for (const entry of entries) {
    const xml = readZipEntry(buf, entry).toString('utf8')
    out.push(`## ${entry.name}`)
    const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g
    let row: RegExpExecArray | null
    while ((row = rowRe.exec(xml)) !== null) {
      const cells: string[] = []
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
      let cell: RegExpExecArray | null
      while ((cell = cellRe.exec(row[1])) !== null) {
        const attrs = cell[1]
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]
        const inline = /<is>([\s\S]*?)<\/is>/.exec(cell[2])?.[1]
        if (inline !== undefined) {
          const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inline)?.[1]
          cells.push(t === undefined ? '' : decodeXmlEntities(t))
          continue
        }
        if (value === undefined) {
          cells.push('')
          continue
        }
        if (/\bt="s"/.test(attrs)) {
          const idx = Number.parseInt(value, 10)
          cells.push(shared[idx] ?? '')
        } else {
          cells.push(value)
        }
      }
      if (cells.some((c) => c !== '')) out.push(cells.join('\t'))
    }
  }
  return out.join('\n')
}

/** 从 Office 文件字节抽取纯文本；不支持的容器返回 undefined */
export function extractOfficeText(buf: Buffer, fileName: string): string | undefined {
  const name = fileName.toLowerCase()
  if (name.endsWith('.docx')) {
    const xml = readZipFile(buf, 'word/document.xml')
    return xml === undefined ? undefined : docxText(xml.toString('utf8'))
  }
  if (name.endsWith('.pptx')) {
    const entries = listZipEntries(buf)
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    if (entries.length === 0) return undefined
    return entries
      .map((e, i) => `## 第 ${i + 1} 页\n${pptxText(readZipEntry(buf, e).toString('utf8'))}`)
      .join('\n\n')
  }
  if (name.endsWith('.xlsx')) return xlsxText(buf)
  return undefined
}

/** RTF 里需要整体跳过的"目标组"（字体表/颜色表/图片等，不是正文） */
const RTF_SKIP_DESTS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl',
  'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote',
  'annotation', 'fldinst', 'themedata', 'colorschememapping', 'datastore',
  'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
  'xmlnstbl', 'filetbl', 'revtbl', 'pgptbl', 'pn', 'pntext', 'pntxta', 'pntxtb',
])

/**
 * RTF → 纯文本（跨平台，零依赖）。
 *
 * 用**分组扫描**而不是正则粗暴剥控制字：RTF 是 `{...}` 嵌套结构，
 * 字体表/图片等目标组里的普通单词（如 Helvetica）不是正文，必须整组跳过。
 */
export function rtfToText(rtf: string): string {
  const out: string[] = []
  let depth = 0
  let skipDepth = -1 // 当前被跳过组的深度；-1 表示不在跳过中
  let i = 0

  while (i < rtf.length) {
    const ch = rtf[i]

    if (ch === '{') {
      depth++
      const ahead = rtf.slice(i + 1)
      if (skipDepth < 0) {
        const destWord = /^\\([a-zA-Z]+)/.exec(ahead)
        const isStarDest = ahead.startsWith('\\*')
        if (isStarDest || (destWord !== null && RTF_SKIP_DESTS.has(destWord[1].toLowerCase()))) {
          skipDepth = depth
        }
      }
      i++
      continue
    }

    if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1
      depth--
      i++
      continue
    }

    if (ch === '\\') {
      const rest = rtf.slice(i)
      // 转义字符：\ \{ \}
      if (rest.startsWith('\\\\')) {
        if (skipDepth < 0) out.push('\\')
        i += 2
        continue
      }
      if (rest.startsWith('\\{')) {
        if (skipDepth < 0) out.push('{')
        i += 2
        continue
      }
      if (rest.startsWith('\\}')) {
        if (skipDepth < 0) out.push('}')
        i += 2
        continue
      }
      // 十六进制转义 \'hh
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(rest)
      if (hex !== null) {
        if (skipDepth < 0) out.push(String.fromCharCode(Number.parseInt(hex[1], 16)))
        i += hex[0].length
        continue
      }
      // 控制字 \word[-]N?
      const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rest)
      if (word !== null) {
        if (skipDepth < 0) {
          const name = word[1].toLowerCase()
          if (name === 'par' || name === 'line' || name === 'row') out.push('\n')
          else if (name === 'tab') out.push('\t')
          else if (name === 'u') {
            const code = Number.parseInt(word[2] ?? '0', 10)
            out.push(String.fromCharCode(code < 0 ? code + 65536 : code))
          }
        }
        i += word[0].length
        continue
      }
      i++
      continue
    }

    if (skipDepth < 0 && ch !== '\n' && ch !== '\r') out.push(ch)
    i++
  }

  return out.join('').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
