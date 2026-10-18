// src/index.ts
import { spawn as spawn2 } from "node:child_process";
import { homedir as homedir3 } from "node:os";
import { basename as basename2, dirname as dirname3, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";

// src/bundle.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { copyFile, mkdir, stat as stat2, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join as join2 } from "node:path";

// src/extract.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

// src/extractable.ts
var TEXTUTIL_EXTS = [
  ".doc",
  ".docx",
  ".rtf",
  ".rtfd",
  ".html",
  ".htm",
  ".odt",
  ".wordml",
  ".webarchive"
];
var PDF_EXTS = [".pdf"];
function extOf(relPath) {
  const base = relPath.toLowerCase();
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i);
}
function extractKindOf(relPath) {
  const ext = extOf(relPath);
  if (PDF_EXTS.includes(ext)) return "pdf";
  if (TEXTUTIL_EXTS.includes(ext)) return "office";
  return "none";
}
function isExtractablePath(relPath) {
  return extractKindOf(relPath) !== "none";
}

// src/office-zip.ts
import { inflateRawSync } from "node:zlib";
var EOCD_SIG = 101010256;
var CEN_SIG = 33639248;
var LOC_SIG = 67324752;
function findEocd(buf) {
  const min = 22;
  const max = Math.min(buf.length, 66e3);
  for (let i = buf.length - min; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
function listZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("\u4E0D\u662F\u6709\u6548\u7684 ZIP\uFF08\u627E\u4E0D\u5230 EOCD\uFF09");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name2 = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name: name2, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function readZipEntry(buf, entry) {
  const at = entry.localOffset;
  if (buf.readUInt32LE(at) !== LOC_SIG) throw new Error(`\u672C\u5730\u5934\u635F\u574F\uFF1A${entry.name}`);
  const nameLen = buf.readUInt16LE(at + 26);
  const extraLen = buf.readUInt16LE(at + 28);
  const start = at + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`\u4E0D\u652F\u6301\u7684\u538B\u7F29\u65B9\u5F0F ${entry.method}\uFF1A${entry.name}`);
}
function readZipFile(buf, name2) {
  const entry = listZipEntries(buf).find((e) => e.name === name2);
  return entry === void 0 ? void 0 : readZipEntry(buf, entry);
}
var XML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'"
};
function decodeXmlEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    const known = XML_ENTITIES[m];
    if (known !== void 0) return known;
    if (m.startsWith("&#x")) return String.fromCodePoint(Number.parseInt(m.slice(3, -1), 16));
    if (m.startsWith("&#")) return String.fromCodePoint(Number.parseInt(m.slice(2, -1), 10));
    return m;
  });
}
function docxText(xml) {
  const withBreaks = xml.replace(/<w:p[ >]/g, "\n<w:p ").replace(/<\/w:p>/g, "\n");
  const texts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  let last = 0;
  while ((m = re.exec(withBreaks)) !== null) {
    const between = withBreaks.slice(last, m.index);
    const breaks = (between.match(/\n/g) ?? []).length;
    if (breaks > 0 && texts.length > 0) texts.push("\n".repeat(breaks));
    texts.push(decodeXmlEntities(m[1]));
    last = re.lastIndex;
  }
  return texts.join("");
}
function pptxText(xml) {
  const texts = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) texts.push(decodeXmlEntities(m[1]));
  return texts.join("\n");
}
function xlsxText(buf) {
  const shared = [];
  const sharedBuf = readZipFile(buf, "xl/sharedStrings.xml");
  if (sharedBuf !== void 0) {
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    const xml = sharedBuf.toString("utf8");
    let m;
    while ((m = re.exec(xml)) !== null) shared.push(decodeXmlEntities(m[1]));
  }
  const entries = listZipEntries(buf).filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
  const out = [];
  for (const entry of entries) {
    const xml = readZipEntry(buf, entry).toString("utf8");
    out.push(`## ${entry.name}`);
    const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
    let row;
    while ((row = rowRe.exec(xml)) !== null) {
      const cells = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cell;
      while ((cell = cellRe.exec(row[1])) !== null) {
        const attrs = cell[1];
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
        const inline = /<is>([\s\S]*?)<\/is>/.exec(cell[2])?.[1];
        if (inline !== void 0) {
          const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inline)?.[1];
          cells.push(t === void 0 ? "" : decodeXmlEntities(t));
          continue;
        }
        if (value === void 0) {
          cells.push("");
          continue;
        }
        if (/\bt="s"/.test(attrs)) {
          const idx = Number.parseInt(value, 10);
          cells.push(shared[idx] ?? "");
        } else {
          cells.push(value);
        }
      }
      if (cells.some((c) => c !== "")) out.push(cells.join("	"));
    }
  }
  return out.join("\n");
}
function extractOfficeText(buf, fileName) {
  const name2 = fileName.toLowerCase();
  if (name2.endsWith(".docx")) {
    const xml = readZipFile(buf, "word/document.xml");
    return xml === void 0 ? void 0 : docxText(xml.toString("utf8"));
  }
  if (name2.endsWith(".pptx")) {
    const entries = listZipEntries(buf).filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
    if (entries.length === 0) return void 0;
    return entries.map((e, i) => `## \u7B2C ${i + 1} \u9875
${pptxText(readZipEntry(buf, e).toString("utf8"))}`).join("\n\n");
  }
  if (name2.endsWith(".xlsx")) return xlsxText(buf);
  return void 0;
}
var RTF_SKIP_DESTS = /* @__PURE__ */ new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "headerl",
  "headerr",
  "headerf",
  "footer",
  "footerl",
  "footerr",
  "footerf",
  "footnote",
  "annotation",
  "fldinst",
  "themedata",
  "colorschememapping",
  "datastore",
  "latentstyles",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "filetbl",
  "revtbl",
  "pgptbl",
  "pn",
  "pntext",
  "pntxta",
  "pntxtb"
]);
function rtfToText(rtf) {
  const out = [];
  let depth = 0;
  let skipDepth = -1;
  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      depth++;
      const ahead = rtf.slice(i + 1);
      if (skipDepth < 0) {
        const destWord = /^\\([a-zA-Z]+)/.exec(ahead);
        const isStarDest = ahead.startsWith("\\*");
        if (isStarDest || destWord !== null && RTF_SKIP_DESTS.has(destWord[1].toLowerCase())) {
          skipDepth = depth;
        }
      }
      i++;
      continue;
    }
    if (ch === "}") {
      if (skipDepth === depth) skipDepth = -1;
      depth--;
      i++;
      continue;
    }
    if (ch === "\\") {
      const rest = rtf.slice(i);
      if (rest.startsWith("\\\\")) {
        if (skipDepth < 0) out.push("\\");
        i += 2;
        continue;
      }
      if (rest.startsWith("\\{")) {
        if (skipDepth < 0) out.push("{");
        i += 2;
        continue;
      }
      if (rest.startsWith("\\}")) {
        if (skipDepth < 0) out.push("}");
        i += 2;
        continue;
      }
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(rest);
      if (hex !== null) {
        if (skipDepth < 0) out.push(String.fromCharCode(Number.parseInt(hex[1], 16)));
        i += hex[0].length;
        continue;
      }
      const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rest);
      if (word !== null) {
        if (skipDepth < 0) {
          const name2 = word[1].toLowerCase();
          if (name2 === "par" || name2 === "line" || name2 === "row") out.push("\n");
          else if (name2 === "tab") out.push("	");
          else if (name2 === "u") {
            const code = Number.parseInt(word[2] ?? "0", 10);
            out.push(String.fromCharCode(code < 0 ? code + 65536 : code));
          }
        }
        i += word[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (skipDepth < 0 && ch !== "\n" && ch !== "\r") out.push(ch);
    i++;
  }
  return out.join("").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// src/extract.ts
var MAX_INPUT_BYTES = 50 * 1024 * 1024;
var MAX_OUTPUT_CHARS = 2e5;
var EXTRACT_TIMEOUT_MS = 2e4;
function isExtractable(relPath) {
  return isExtractablePath(relPath);
}
function extOf2(p) {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}
function isInsideWorkspace(cwd, filePath) {
  if (!isAbsolute(cwd) || !isAbsolute(filePath)) return false;
  const root = resolve(cwd);
  const target = resolve(filePath);
  const ci = process.platform === "win32" ? (v) => v.toLowerCase() : (v) => v;
  if (ci(target) === ci(root)) return false;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return ci(target).startsWith(ci(prefix));
}
function resolveExtractor(filePath, options = {}) {
  if (extractKindOf(filePath) === "pdf") {
    if (options.popplerRoot !== void 0) {
      const bundled = join(options.popplerRoot, "bin", "pdftotext");
      if (existsSync(bundled)) {
        return { command: bundled, args: pdfArgs(filePath), engine: "poppler" };
      }
    }
    const system = findOnPath("pdftotext", options.pathEnv);
    if (system !== void 0) {
      return { command: system, args: pdfArgs(filePath), engine: "system-pdftotext" };
    }
    return void 0;
  }
  if (extractKindOf(filePath) === "office") {
    const textutil = "/usr/bin/textutil";
    if (existsSync(textutil)) {
      return { command: textutil, args: ["-convert", "txt", "-stdout", filePath], engine: "textutil" };
    }
    return void 0;
  }
  return void 0;
}
function pdfArgs(filePath) {
  return ["-layout", "-enc", "UTF-8", filePath, "-"];
}
function findOnPath(name2, pathEnv = process.env.PATH ?? "") {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name2);
    if (existsSync(candidate)) return candidate;
  }
  return void 0;
}
function normalizeExtractedText(raw) {
  return raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
}
function runExtractor(plan, options = {}) {
  const timeout = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  return new Promise((resolvePromise, reject) => {
    execFile(
      plan.command,
      plan.args,
      {
        timeout,
        // 输出上限：留一倍余量，具体截断在 normalize 之后按字符数做
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true
      },
      (error, stdout) => {
        if (error !== null) {
          const killed = error.killed === true;
          if (killed) {
            resolvePromise({ text: stdout ?? "", timedOut: true });
            return;
          }
          reject(error);
          return;
        }
        resolvePromise({ text: stdout ?? "", timedOut: false });
      }
    );
  });
}
function emptyMessage(filePath) {
  const ext = extOf2(filePath);
  if (ext === ".pdf") {
    return "\u8BE5 PDF \u6CA1\u6709\u6587\u5B57\u5C42\uFF08\u53EF\u80FD\u662F\u626B\u63CF\u4EF6/\u56FE\u7247\u578B PDF\uFF09\u3002\u8BF7\u76F4\u63A5\u628A\u539F\u6587\u4EF6\u4E0A\u4F20\u5230\u7F51\u9875\u7248\uFF0C\u8BA9 AI \u770B\u56FE\u3002";
  }
  if (ext === ".doc") {
    return "\u8FD9\u4E2A .doc \u65E0\u6CD5\u8F6C\u51FA\u6587\u5B57\uFF08\u5E38\u89C1\u4E8E WPS \u7B49\u975E\u6807\u51C6\u65E7\u683C\u5F0F\uFF09\u3002\u5EFA\u8BAE\u7528 Word/WPS \u53E6\u5B58\u4E3A .docx \u540E\u91CD\u8BD5\uFF0C\u6216\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\u3002";
  }
  if ([".docx", ".pptx", ".xlsx", ".odt", ".wordml"].includes(ext)) {
    return "\u8FD9\u4E2A\u6587\u6863\u91CC\u6CA1\u6709\u53EF\u63D0\u53D6\u7684\u6587\u5B57\uFF08\u53EF\u80FD\u662F\u7EAF\u56FE\u7247\u5185\u5BB9\u6216\u7A7A\u6587\u6863\uFF09\u3002\u5EFA\u8BAE\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\u3002";
  }
  if ([".rtf", ".rtfd", ".html", ".htm", ".webarchive"].includes(ext)) {
    return "\u8FD9\u4E2A\u6587\u4EF6\u91CC\u6CA1\u6709\u53EF\u63D0\u53D6\u7684\u6587\u5B57\u3002";
  }
  return "\u6CA1\u6709\u63D0\u53D6\u5230\u6587\u5B57\uFF0C\u8BF7\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\u3002";
}
function finalize(raw, engine, maxChars, filePath) {
  const normalized = normalizeExtractedText(raw);
  if (normalized === "") {
    return {
      ok: false,
      code: "empty",
      message: emptyMessage(filePath ?? "")
    };
  }
  const limit = maxChars ?? MAX_OUTPUT_CHARS;
  const truncated = normalized.length > limit;
  const text = truncated ? normalized.slice(0, limit) : normalized;
  return { ok: true, text, chars: text.length, truncated, engine };
}
async function extractText(request) {
  const { cwd, filePath } = request;
  if (typeof cwd !== "string" || typeof filePath !== "string" || cwd === "" || filePath === "") {
    return { ok: false, code: "bad-request", message: "\u7F3A\u5C11 cwd \u6216 path" };
  }
  if (!isInsideWorkspace(cwd, filePath)) {
    return { ok: false, code: "outside-workspace", message: "\u53EA\u5141\u8BB8\u62BD\u53D6\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u7684\u6587\u4EF6" };
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return { ok: false, code: "not-found", message: "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u8BBF\u95EE" };
  }
  if (!info.isFile()) return { ok: false, code: "not-a-file", message: "\u76EE\u6807\u4E0D\u662F\u6587\u4EF6" };
  if (info.size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      code: "too-large",
      message: `\u6587\u4EF6\u8D85\u8FC7 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB\uFF0C\u62D2\u7EDD\u62BD\u53D6`
    };
  }
  const ext = extOf2(filePath);
  if (ext === ".rtf" || ext === ".rtfd") {
    try {
      const raw = await readFile(filePath, "utf8");
      return finalize(rtfToText(raw), "rtf", request.maxChars, filePath);
    } catch (error) {
      return { ok: false, code: "failed", message: `RTF \u89E3\u6790\u5931\u8D25\uFF1A${String(error)}` };
    }
  }
  if (ext === ".docx" || ext === ".pptx" || ext === ".xlsx") {
    try {
      const raw = extractOfficeText(await readFile(filePath), filePath);
      if (raw !== void 0 && raw.trim() !== "") {
        return finalize(normalizeExtractedText(raw), "zip-xml", request.maxChars, filePath);
      }
    } catch {
    }
  }
  if (!isExtractable(filePath)) {
    return { ok: false, code: "unsupported", message: "\u8BE5\u6587\u4EF6\u7C7B\u578B\u4E0D\u652F\u6301\u6587\u672C\u62BD\u53D6\uFF08\u4EC5 PDF / Office / RTF / HTML\uFF09" };
  }
  const plan = resolveExtractor(filePath, { popplerRoot: request.popplerRoot });
  if (plan === void 0) {
    return {
      ok: false,
      code: "no-extractor",
      message: extOf2(filePath) === ".pdf" ? "\u672A\u627E\u5230 PDF \u62BD\u53D6\u5668\uFF1A\u8BF7\u5B89\u88C5 poppler\uFF08brew install poppler / apt install poppler-utils / winget install poppler\uFF09\uFF0C\u6216\u7528 conda \u88C5\u5230\u4EFB\u610F\u76EE\u5F55\u540E\u8BBE\u7F6E DSH_DUAL_BRIDGE_POPPLER \u6307\u5411\u5B83" : extOf2(filePath) === ".doc" ? "\u65E7\u7248 .doc\uFF08\u4E8C\u8FDB\u5236\uFF09\u9700\u8981 macOS \u7684 textutil \u6216 LibreOffice\uFF1B\u5EFA\u8BAE\u5148\u53E6\u5B58\u4E3A .docx\uFF08\u8DE8\u5E73\u53F0\u53EF\u76F4\u63A5\u62BD\u53D6\uFF09" : "\u672A\u627E\u5230\u53EF\u7528\u7684\u62BD\u53D6\u5668"
    };
  }
  let output;
  try {
    output = await runExtractor(plan, {
      timeoutMs: request.timeoutMs,
      maxChars: request.maxChars
    });
  } catch (error) {
    return {
      ok: false,
      code: "failed",
      message: `\u62BD\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (output.timedOut) {
    return { ok: false, code: "timeout", message: `\u62BD\u53D6\u8D85\u65F6\uFF08${(request.timeoutMs ?? EXTRACT_TIMEOUT_MS) / 1e3}s\uFF09` };
  }
  return finalize(output.text, plan.engine, request.maxChars, filePath);
}

// src/bundle.ts
function suggestionFor(relPath) {
  const lower = relPath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if ([".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".bmp", ".gif", ".heic"].includes(ext)) {
    return "\u56FE\u7247\uFF1A\u76F4\u63A5\u4F5C\u4E3A\u56FE\u7247\u4E0A\u4F20\uFF0CAI \u624D\u80FD\u770B\u5230\u5185\u5BB9";
  }
  if (ext === ".pdf") return "PDF\uFF1A\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\uFF1B\u82E5\u6587\u5B57\u53EF\u9009\u4E2D\uFF0C\u4E5F\u53EF\u5148\u7528\u300C\u62BD\u53D6\u6587\u672C\u300D";
  if ([".doc", ".docx", ".rtf", ".odt", ".pages", ".html", ".htm"].includes(ext)) {
    return "\u6587\u6863\uFF1A\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\uFF08\u6216\u5148\u7528\u300C\u62BD\u53D6\u6587\u672C\u300D\uFF09";
  }
  if ([".ppt", ".pptx", ".key", ".xls", ".xlsx", ".numbers", ".csv"].includes(ext)) {
    return "\u8868\u683C/\u6F14\u793A\uFF1A\u53EF\u4E0A\u4F20\u539F\u6587\u4EF6\uFF1B\u7ED3\u6784\u5316\u5185\u5BB9\u5EFA\u8BAE\u5148\u7528\u300C\u62BD\u53D6\u6587\u672C\u300D";
  }
  if ([".mov", ".mp4", ".avi", ".mkv", ".wav", ".mp3", ".m4a", ".webm"].includes(ext)) {
    return "\u97F3\u89C6\u9891\uFF1AAI \u65E0\u6CD5\u76F4\u63A5\u89E3\u6790\uFF0C\u5EFA\u8BAE\u622A\u56FE\u5173\u952E\u753B\u9762\u6216\u6587\u5B57\u63CF\u8FF0";
  }
  if ([".zip", ".tar", ".gz", ".7z", ".rar"].includes(ext)) {
    return "\u538B\u7F29\u5305\uFF1AAI \u4E0D\u89E3\u6790\u538B\u7F29\u5305\u5185\u90E8\uFF0C\u5EFA\u8BAE\u5148\u89E3\u538B\u518D\u4E0A\u4F20\u9700\u8981\u7684\u6587\u4EF6";
  }
  return "\u6309\u9700\u4E0A\u4F20";
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function buildManifestText(rows, options) {
  const lines = [
    "# \u9644\u4EF6\u6E05\u5355\uFF08\u8BF7\u628A\u8FD9\u4E9B\u6587\u4EF6\u4E0A\u4F20\u7ED9 AI\uFF09",
    "",
    `- \u751F\u6210\u65F6\u95F4\uFF1A${options.createdAt}`,
    `- \u6765\u6E90\u5DE5\u4F5C\u533A\uFF1A\`${options.workspace}\``,
    `- \u6587\u4EF6\u6570\uFF1A${rows.length} \u4E2A\uFF08\u5408\u8BA1 ${formatBytes(options.totalBytes)}\uFF09`,
    "",
    "> \u8FD9\u4E9B\u6587\u4EF6\u65E0\u6CD5\u76F4\u63A5\u8F6C\u6210\u6587\u672C\uFF0C\u6240\u4EE5\u672C\u5DE5\u5177\u628A\u5B83\u4EEC\u590D\u5236\u5230\u672C\u76EE\u5F55\u3002",
    "> \u8BF7\u628A\u9700\u8981\u7684\u6587\u4EF6**\u62D6\u8FDB\u7F51\u9875\u7248\u5BF9\u8BDD\u8F93\u5165\u6846**\u4E00\u5E76\u4E0A\u4F20\uFF0CAI \u624D\u80FD\u8BFB\u5230\u5B83\u4EEC\u7684\u5185\u5BB9\u3002",
    ""
  ];
  if (options.zipName !== void 0) {
    lines.push(
      `> \u65C1\u8FB9\u7684 \`${options.zipName}\` \u53EA\u662F\u4FBF\u4E8E\u4F20\u8F93/\u5F52\u6863\uFF1A**AI \u4E0D\u4F1A\u89E3\u6790 zip \u5185\u90E8**\uFF0C\u8BF7\u5148\u89E3\u538B\u518D\u4E0A\u4F20\u3002`,
      ""
    );
  }
  lines.push("| \u6587\u4EF6 | \u5927\u5C0F | \u5EFA\u8BAE |", "| --- | --- | --- |");
  for (const row of rows) {
    lines.push(`| \`${row.relPath}\` | ${formatBytes(row.size)} | ${suggestionFor(row.relPath)} |`);
  }
  lines.push("");
  return lines.join("\n");
}
function runZip(zipPath, cwd, target) {
  const [command, args] = process.platform === "win32" ? [
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -Path '${target}' -DestinationPath '${zipPath}' -Force`
    ]
  ] : ["zip", ["-r", "-q", "-X", zipPath, target]];
  return new Promise((resolve2) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    child.on("error", () => resolve2(false));
    child.on("close", (code) => resolve2(code === 0));
  });
}
function defaultBundleRoot() {
  const desktop = join2(homedir(), "Desktop");
  return existsSync2(desktop) ? desktop : homedir();
}
function packDirName(stamp) {
  if (stamp !== void 0 && stamp !== "") return `dsh-pack-${stamp}`;
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `dsh-pack-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
async function createBundle(request) {
  const { cwd, entries } = request;
  if (cwd === "" || entries.length === 0) {
    return { ok: false, code: "empty", message: "\u6CA1\u6709\u9700\u8981\u5BFC\u51FA\u7684\u6587\u4EF6" };
  }
  for (const entry of entries) {
    if (!isInsideWorkspace(cwd, entry.absPath)) {
      return {
        ok: false,
        code: "outside-workspace",
        message: `\u53EA\u5141\u8BB8\u5BFC\u51FA\u5DE5\u4F5C\u533A\u5185\u7684\u6587\u4EF6\uFF1A${entry.relPath}`
      };
    }
  }
  const dirName = packDirName(request.stamp);
  const destRoot = request.destRoot ?? defaultBundleRoot();
  const dir = join2(destRoot, dirName);
  const rows = [];
  let bytes = 0;
  try {
    await mkdir(dir, { recursive: true });
    for (const entry of entries) {
      const info = await stat2(entry.absPath).catch(() => void 0);
      if (info === void 0 || !info.isFile()) {
        return { ok: false, code: "not-found", message: `\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${entry.relPath}` };
      }
      const target = join2(dir, entry.relPath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(entry.absPath, target);
      rows.push({ relPath: entry.relPath, size: info.size });
      bytes += info.size;
    }
  } catch (error) {
    return {
      ok: false,
      code: "copy-failed",
      message: `\u590D\u5236\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
  }
  const manifestPath = join2(dir, "\u9644\u4EF6\u6E05\u5355.md");
  let zipPath;
  if (request.makeZip === true) {
    zipPath = join2(destRoot, `${dirName}.zip`);
  }
  try {
    await writeFile(
      manifestPath,
      buildManifestText(rows, {
        workspace: cwd,
        createdAt: (/* @__PURE__ */ new Date()).toLocaleString("zh-CN"),
        zipName: zipPath === void 0 ? void 0 : basename(zipPath),
        totalBytes: bytes
      }),
      "utf8"
    );
  } catch (error) {
    return {
      ok: false,
      code: "copy-failed",
      message: `\u5199\u6E05\u5355\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (zipPath !== void 0) {
    const ok = await runZip(zipPath, destRoot, dirName);
    if (!ok) {
      return { ok: false, code: "zip-failed", message: "\u521B\u5EFA zip \u5931\u8D25\uFF08\u76EE\u5F55\u5DF2\u751F\u6210\uFF0C\u53EF\u76F4\u63A5\u4F7F\u7528\uFF09" };
    }
  }
  return { ok: true, dir, zipPath, fileCount: rows.length, bytes, manifestPath };
}

// src/capabilities.ts
import { existsSync as existsSync4 } from "node:fs";
import { delimiter as delimiter2, join as join4 } from "node:path";

// src/ocr.ts
import { execFile as execFile2 } from "node:child_process";
import { copyFileSync, existsSync as existsSync3, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir as homedir2, tmpdir } from "node:os";
import { dirname as dirname2, join as join3 } from "node:path";
function ocrCacheDir() {
  const override = process.env.DSH_DUAL_BRIDGE_OCR_CACHE;
  if (override !== void 0 && override.trim() !== "") return override.trim();
  if (process.platform === "darwin") return join3(homedir2(), "Library", "Caches", "dsh-dual-bridge");
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local !== void 0 && local !== "") return join3(local, "dsh-dual-bridge");
  }
  return join3(tmpdir(), "dsh-dual-bridge-ocr");
}
var OCR_BINARY_CACHE = join3(ocrCacheDir(), "ocr-vision");
var OCR_SWIFT_SOURCE = join3(ocrCacheDir(), "ocr.swift");
function chooseOcrEngines(available) {
  const chain = [];
  if (available.vision) chain.push("vision");
  if (available.systemTesseract) chain.push("tesseract");
  if (available.wasm) chain.push("wasm");
  return chain;
}
function runFile(command, args, timeoutMs) {
  return new Promise((resolve2, reject) => {
    execFile2(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          const killed = error.killed === true;
          if (killed) {
            resolve2({ stdout: stdout ?? "", timedOut: true });
            return;
          }
          reject(error);
          return;
        }
        resolve2({ stdout: stdout ?? "", timedOut: false });
      }
    );
  });
}
function findOnPath2(name2, pathEnv = process.env.PATH ?? "") {
  const sep2 = process.platform === "win32" ? ";" : ":";
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of pathEnv.split(sep2)) {
    if (dir === "") continue;
    for (const suffix of suffixes) {
      const candidate = join3(dir, `${name2}${suffix}`);
      if (existsSync3(candidate)) return candidate;
    }
  }
  return void 0;
}
var VISION_SWIFT = `import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("usage: ocr <image>\\n".data(using: .utf8)!); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image\\n".data(using: .utf8)!)
    exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\\n"))
`;
function visionSwiftAvailable() {
  if (process.platform !== "darwin") return false;
  if (existsSync3(OCR_BINARY_CACHE)) return true;
  return existsSync3("/usr/bin/swiftc") || existsSync3("/usr/bin/swift");
}
async function ensureVisionBinary(timeoutMs) {
  if (existsSync3(OCR_BINARY_CACHE)) return OCR_BINARY_CACHE;
  if (process.platform !== "darwin") return void 0;
  try {
    mkdirSync(ocrCacheDir(), { recursive: true });
    writeFileSync(OCR_SWIFT_SOURCE, VISION_SWIFT, "utf8");
    const compiler = existsSync3("/usr/bin/swiftc") ? "/usr/bin/swiftc" : "/usr/bin/swift";
    const args = compiler.endsWith("swiftc") ? ["-O", "-o", OCR_BINARY_CACHE, OCR_SWIFT_SOURCE] : [OCR_SWIFT_SOURCE];
    await runFile(compiler, args, Math.max(timeoutMs, 6e4));
    return existsSync3(OCR_BINARY_CACHE) ? OCR_BINARY_CACHE : void 0;
  } catch {
    return void 0;
  }
}
async function ocrWithVision(filePath, timeoutMs) {
  const binary = await ensureVisionBinary(timeoutMs);
  if (binary === void 0) return { ok: false, code: "no-ocr", message: "Vision \u4E0D\u53EF\u7528" };
  try {
    const out = await runFile(binary, [filePath], timeoutMs);
    if (out.timedOut) return { ok: false, code: "timeout", message: "OCR \u8D85\u65F6" };
    const text = out.stdout.trim();
    if (text === "") return { ok: false, code: "empty", message: "\u56FE\u7247\u91CC\u6CA1\u6709\u8BC6\u522B\u5230\u6587\u5B57" };
    return { ok: true, text, engine: "vision", chars: text.length };
  } catch (error) {
    return {
      ok: false,
      code: "failed",
      message: `Vision OCR \u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function ocrWithSystemTesseract(filePath, timeoutMs) {
  try {
    const out = await runFile("tesseract", [filePath, "stdout", "-l", "chi_sim+eng"], timeoutMs);
    if (out.timedOut) return { ok: false, code: "timeout", message: "OCR \u8D85\u65F6" };
    const text = out.stdout.trim();
    if (text === "") return { ok: false, code: "empty", message: "\u56FE\u7247\u91CC\u6CA1\u6709\u8BC6\u522B\u5230\u6587\u5B57" };
    return { ok: true, text, engine: "tesseract", chars: text.length };
  } catch {
    return { ok: false, code: "no-ocr", message: "\u7CFB\u7EDF tesseract \u4E0D\u53EF\u7528" };
  }
}
var wasmWorkerPromise = null;
function resolveDependency(specifier) {
  const bases = [import.meta.url];
  try {
    bases.push(`file://${join3(process.cwd(), "index.js")}`);
  } catch {
  }
  for (const base of bases) {
    try {
      return createRequire(base).resolve(specifier);
    } catch {
    }
  }
  return void 0;
}
function wasmOcrAvailable() {
  return resolveDependency("tesseract.js") !== void 0;
}
function prepareTessdata() {
  const dir = join3(ocrCacheDir(), "tessdata");
  mkdirSync(dir, { recursive: true });
  for (const pkg of ["chi_sim", "eng"]) {
    const target = join3(dir, `${pkg}.traineddata.gz`);
    if (existsSync3(target)) continue;
    const pkgJson = resolveDependency(`@tesseract.js-data/${pkg}/package.json`);
    if (pkgJson === void 0) continue;
    const source = join3(dirname2(pkgJson), "4.0.0", `${pkg}.traineddata.gz`);
    if (existsSync3(source)) copyFileSync(source, target);
  }
  return dir;
}
async function getWasmWorker() {
  if (wasmWorkerPromise !== null) return wasmWorkerPromise;
  wasmWorkerPromise = (async () => {
    const mod = await import("tesseract.js");
    return mod.createWorker(["chi_sim", "eng"], 1, {
      langPath: prepareTessdata(),
      cachePath: join3(ocrCacheDir(), "tess-cache"),
      gzip: true,
      logger: () => {
      }
    });
  })();
  return wasmWorkerPromise;
}
async function ocrWithWasm(filePath) {
  try {
    const worker = await getWasmWorker();
    const { data } = await worker.recognize(filePath);
    const text = String(data.text ?? "").trim();
    if (text === "") return { ok: false, code: "empty", message: "\u56FE\u7247\u91CC\u6CA1\u6709\u8BC6\u522B\u5230\u6587\u5B57" };
    return { ok: true, text, engine: "wasm", chars: text.length };
  } catch (error) {
    wasmWorkerPromise = null;
    return {
      ok: false,
      code: "failed",
      message: `\u5185\u7F6E OCR \u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function ocrImage(filePath, timeoutMs = 3e4) {
  const chain = chooseOcrEngines({
    vision: visionSwiftAvailable(),
    systemTesseract: findOnPath2("tesseract") !== void 0,
    wasm: wasmOcrAvailable()
  });
  if (chain.length === 0) {
    return {
      ok: false,
      code: "no-ocr",
      message: "\u5F53\u524D\u73AF\u5883\u6CA1\u6709\u53EF\u7528\u7684 OCR\uFF08\u5185\u7F6E WASM \u672A\u5B89\u88C5\uFF0C\u7CFB\u7EDF\u4E5F\u6CA1\u6709 Vision / tesseract\uFF09"
    };
  }
  let last;
  for (const engine of chain) {
    const result = engine === "vision" ? await ocrWithVision(filePath, timeoutMs) : engine === "tesseract" ? await ocrWithSystemTesseract(filePath, timeoutMs) : await ocrWithWasm(filePath);
    if (result.ok) return result;
    last = result;
  }
  return last ?? { ok: false, code: "failed", message: "OCR \u5931\u8D25" };
}

// src/capabilities.ts
function findOnPath3(name2, pathEnv = process.env.PATH ?? "") {
  for (const dir of pathEnv.split(delimiter2)) {
    if (dir === "") continue;
    const candidate = join4(dir, name2);
    if (existsSync4(candidate)) return candidate;
  }
  return void 0;
}
function detectCapabilities(popplerRoot) {
  const bundled = popplerRoot === void 0 ? void 0 : join4(popplerRoot, "bin", "pdftotext");
  const system = findOnPath3("pdftotext");
  let pdfEngine = null;
  if (bundled !== void 0 && existsSync4(bundled)) pdfEngine = "poppler";
  else if (system !== void 0) pdfEngine = "system-pdftotext";
  const ocrChain = chooseOcrEngines({
    vision: visionSwiftAvailable(),
    systemTesseract: findOnPath3("tesseract") !== void 0,
    wasm: wasmOcrAvailable()
  });
  const ocr = ocrChain[0] ?? null;
  const hasTextutil = process.platform === "darwin" && existsSync4("/usr/bin/textutil");
  return {
    pdf: pdfEngine !== null,
    pdfEngine,
    office: true,
    officeEngine: hasTextutil ? "textutil" : "zip-xml",
    ocr,
    platform: process.platform
  };
}

// src/index.ts
var name = "dsh-dual-bridge";
var inject = ["webServer"];
var MAX_BODY_BYTES = 256 * 1024;
var HOST_BUILD = "0.12.0";
var ROUTES = {
  capabilities: "/dual-bridge/capabilities",
  extract: "/dual-bridge/extract",
  ocr: "/dual-bridge/ocr",
  bundle: "/dual-bridge/bundle",
  reveal: "/dual-bridge/reveal"
};
function bundledPopplerRoot() {
  const override = process.env.DSH_DUAL_BRIDGE_POPPLER;
  if (override !== void 0 && override.trim() !== "") return override.trim();
  try {
    const here = dirname3(fileURLToPath(import.meta.url));
    return join5(here, "..", "vendor", "poppler");
  } catch {
    return void 0;
  }
}
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve2, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (...args) => {
      const chunk = args[0];
      const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      total += text.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
        return;
      }
      chunks.push(text);
    });
    req.on("end", () => resolve2(chunks.join("")));
    req.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}
async function readJson(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, code: "bad-request", message: "\u53EA\u652F\u6301 POST" });
    return void 0;
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 413, { ok: false, code: "bad-request", message: "\u8BF7\u6C42\u4F53\u8FC7\u5927" });
    return void 0;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
    return void 0;
  }
  return payload ?? {};
}
function str(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
function statusFor(code) {
  if (code === "bad-request" || code === "outside-workspace") return 400;
  if (code === "not-found") return 404;
  return 422;
}
async function handleCapabilities(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, code: "bad-request", message: "\u53EA\u652F\u6301 GET" });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    hostBuild: HOST_BUILD,
    capabilities: detectCapabilities(bundledPopplerRoot())
  });
}
async function handleExtractRoute(req, res) {
  const payload = await readJson(req, res);
  if (payload === void 0) return;
  const cwd = str(payload, "cwd");
  const filePath = str(payload, "path");
  if (cwd === "" || filePath === "") {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "\u7F3A\u5C11 cwd \u6216 path" });
    return;
  }
  const result = await extractText({ cwd, filePath, popplerRoot: bundledPopplerRoot() });
  if (result.ok) {
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, statusFor(result.code), result);
}
async function handleOcrRoute(req, res) {
  const payload = await readJson(req, res);
  if (payload === void 0) return;
  const cwd = str(payload, "cwd");
  const filePath = str(payload, "path");
  if (cwd === "" || filePath === "") {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "\u7F3A\u5C11 cwd \u6216 path" });
    return;
  }
  if (!isInsideWorkspace(cwd, filePath)) {
    sendJson(res, 400, {
      ok: false,
      code: "outside-workspace",
      message: "\u53EA\u5141\u8BB8\u8BC6\u522B\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u7684\u6587\u4EF6"
    });
    return;
  }
  const result = await ocrImage(filePath);
  if (result.ok) {
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, statusFor(result.code ?? "failed"), result);
}
async function handleBundleRoute(req, res) {
  const payload = await readJson(req, res);
  if (payload === void 0) return;
  const cwd = str(payload, "cwd");
  const rawEntries = payload.entries;
  if (cwd === "" || !Array.isArray(rawEntries) || rawEntries.length === 0) {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "\u7F3A\u5C11 cwd \u6216 entries" });
    return;
  }
  const entries = rawEntries.map((item) => item ?? {}).map((item) => ({ relPath: str(item, "relPath"), absPath: str(item, "absPath") })).filter((item) => item.relPath !== "" && item.absPath !== "");
  if (entries.length === 0) {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "entries \u91CC\u6CA1\u6709\u6709\u6548\u8DEF\u5F84" });
    return;
  }
  const result = await createBundle({ cwd, entries, makeZip: payload.makeZip === true });
  if (result.ok) {
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, statusFor(result.code), result);
}
async function handleRevealRoute(req, res) {
  const payload = await readJson(req, res);
  if (payload === void 0) return;
  const cwd = str(payload, "cwd");
  const target = str(payload, "path");
  if (cwd === "" || target === "") {
    sendJson(res, 400, { ok: false, code: "bad-request", message: "\u7F3A\u5C11 cwd \u6216 path" });
    return;
  }
  const isBundlePath = basename2(target).startsWith("dsh-pack-") && (dirname3(target) === join5(homedir3(), "Desktop") || dirname3(target) === homedir3());
  if (target !== cwd && !isInsideWorkspace(cwd, target) && !isBundlePath) {
    sendJson(res, 400, {
      ok: false,
      code: "outside-workspace",
      message: "\u53EA\u5141\u8BB8\u6253\u5F00\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u7684\u8DEF\u5F84"
    });
    return;
  }
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "/usr/bin/open";
    args = ["-R", target];
  } else if (process.platform === "win32") {
    command = "explorer";
    args = ["/select,", target];
  } else {
    command = "xdg-open";
    args = [target];
  }
  try {
    spawn2(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    sendJson(res, 422, { ok: false, code: "unsupported", message: `\u672C\u5E73\u53F0\u65E0\u6CD5\u81EA\u52A8\u6253\u5F00\uFF1A${command}` });
    return;
  }
  sendJson(res, 200, { ok: true });
}
function apply(ctx) {
  const server = ctx.webServer;
  if (server === void 0) return;
  const registrations = [
    [ROUTES.capabilities, handleCapabilities],
    [ROUTES.extract, handleExtractRoute],
    [ROUTES.ocr, handleOcrRoute],
    [ROUTES.bundle, handleBundleRoute],
    [ROUTES.reveal, handleRevealRoute]
  ];
  for (const [path, handler] of registrations) {
    ctx.effect(() => server.register({ kind: "exact", path, handler }));
  }
}
export {
  HOST_BUILD,
  ROUTES,
  apply,
  handleBundleRoute,
  handleCapabilities,
  handleExtractRoute,
  handleOcrRoute,
  handleRevealRoute,
  inject,
  name
};
//# sourceMappingURL=index.js.map
