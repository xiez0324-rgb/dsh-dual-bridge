window.__ModuleLoader__.load({
  id: 'dsh-dual-bridge',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/DualBridgeTab.tsx
var import_react = require("react");

// src/api.ts
function routeUrl(path) {
  const base = typeof document !== "undefined" ? document.baseURI : void 0;
  const origin = base && base !== "" ? base : "http://dsh.internal/";
  return new URL(path.replace(/^\/+/, ""), origin).href;
}
var SidebarApiError = class extends Error {
  constructor(code, message) {
    super(message);
    __publicField(this, "code");
    this.code = code;
  }
};
async function readEnvelope(response) {
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) {
    throw new SidebarApiError(
      parsed?.error?.code ?? "http",
      parsed?.error?.message ?? `HTTP ${response.status}`
    );
  }
  return parsed.value;
}
async function call(method, payload) {
  let response;
  try {
    response = await fetch(routeUrl(`sidebar/api/${method}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new SidebarApiError("network", error instanceof Error ? error.message : String(error));
  }
  return readEnvelope(response);
}
function scopePayload(scope, extra) {
  return {
    sessionId: scope.sessionId,
    ...scope.cwd !== void 0 && scope.cwd !== "" ? { cwd: scope.cwd } : {},
    ...scope.repoRoot !== void 0 && scope.repoRoot !== "" ? { repoRoot: scope.repoRoot } : {},
    ...extra
  };
}
async function callJson(path, payload) {
  const response = await fetch(routeUrl(path), {
    method: payload === void 0 ? "GET" : "POST",
    ...payload === void 0 ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
  });
  return await response.json().catch(() => ({ ok: false, code: "http", message: `HTTP ${response.status}` }));
}
async function callExtract(cwd, path, endpoint = "extract") {
  return callJson(`dual-bridge/${endpoint}`, { cwd, path });
}
var api = {
  sessionCwd: (scope) => call("session.cwd", scopePayload(scope, {})),
  fsTree: (scope, path, exclude) => call("fs.tree", scopePayload(scope, { path, exclude })),
  /** 批量列出多个目录（一次请求，减少串行往返）。 */
  fsTrees: (scope, paths, exclude) => call("fs.trees", scopePayload(scope, { paths, exclude })),
  fsRead: (scope, path) => call("fs.read", scopePayload(scope, { path })),
  /** 按需抽取 PDF / Office 文本（host 端本地路由） */
  extract: (cwd, path) => callExtract(cwd, path),
  /** 图片 OCR（macOS Vision / tesseract） */
  ocr: (cwd, path) => callExtract(cwd, path, "ocr"),
  /** 本机能力探测（同时带回 host 构建版本，用于发现"host 未重启"） */
  capabilities: async () => {
    const parsed = await callJson("dual-bridge/capabilities");
    return {
      caps: parsed.capabilities ?? {
        pdf: false,
        pdfEngine: null,
        office: false,
        ocr: null,
        platform: "unknown"
      },
      hostBuild: parsed.hostBuild
    };
  },
  /** 把无法文本化的文件导出成可拖拽上传的目录（+清单/可选 zip） */
  bundle: (cwd, entries, makeZip) => callJson("dual-bridge/bundle", { cwd, entries, makeZip }),
  /** 在访达中显示 */
  reveal: (cwd, path) => callJson("dual-bridge/reveal", { cwd, path })
};

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
var IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tiff",
  ".tif",
  ".bmp",
  ".gif",
  ".heic"
];
function isImagePath(relPath) {
  const ext = extOf(relPath);
  return IMAGE_EXTS.includes(ext);
}

// src/split-window.ts
var SPLIT_WIDTH_RATIO = 0.46;
var MIN_SPLIT_WIDTH = 420;
var MAX_SPLIT_WIDTH = 1400;
var SPLIT_EDGE_GAP = 12;
var MIN_SPLIT_HEIGHT = 360;
function computeSplitGeometry(screen) {
  const availWidth = Math.max(1, Math.floor(screen.availWidth) || 0);
  const availHeight = Math.max(1, Math.floor(screen.availHeight) || 0);
  const availLeft = Math.floor(screen.availLeft ?? 0) || 0;
  const availTop = Math.floor(screen.availTop ?? 0) || 0;
  const wanted = Math.round(availWidth * SPLIT_WIDTH_RATIO);
  const width = Math.min(availWidth, Math.min(MAX_SPLIT_WIDTH, Math.max(MIN_SPLIT_WIDTH, wanted)));
  const height = Math.min(availHeight, Math.max(MIN_SPLIT_HEIGHT, Math.round(availHeight * 0.94)));
  const left = Math.max(availLeft, availLeft + availWidth - width - SPLIT_EDGE_GAP);
  const top = Math.max(availTop, availTop + Math.round((availHeight - height) / 2));
  return { width, height, left, top };
}
function splitFeatures(geometry) {
  return [
    "popup=yes",
    `width=${geometry.width}`,
    `height=${geometry.height}`,
    `left=${geometry.left}`,
    `top=${geometry.top}`
  ].join(",");
}
var SPLIT_WINDOW_NAME = "dsh-dual-bridge-web";
var splitWindow = null;
function openSplitWindow(url, screenLike, name = SPLIT_WINDOW_NAME) {
  if (typeof window === "undefined") return { window: null, reused: false };
  if (splitWindow !== null && !splitWindow.closed) {
    try {
      splitWindow.focus();
    } catch {
    }
    return { window: splitWindow, reused: true };
  }
  const screen = screenLike ?? {
    availWidth: window.screen?.availWidth ?? 1280,
    availHeight: window.screen?.availHeight ?? 800,
    availLeft: window.screen?.availLeft ?? 0,
    availTop: window.screen?.availTop ?? 0
  };
  const win = window.open(url, name, splitFeatures(computeSplitGeometry(screen)));
  splitWindow = win;
  if (win !== null) {
    try {
      win.opener = null;
    } catch {
    }
    try {
      win.focus();
    } catch {
    }
  }
  return { window: win, reused: false };
}

// src/pack.ts
var DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
  ".DS_Store",
  "*.pyc",
  "*.o",
  "*.so",
  "*.dylib",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
  ".parcel-cache",
  // 本插件自己的导出包目录，绝不能被扫回文件树（否则形成自污染循环）
  "dsh-pack-*"
];
var SKIP_EXT = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".mp4",
  ".mp3",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
  // Office / 文档 / 设计稿：进文件表只会污染列表，host 读取时也一律判为 binary
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pages",
  ".numbers",
  ".key",
  ".rtf",
  ".odt",
  // 音视频与其它容器格式
  ".mov",
  ".avi",
  ".mkv",
  ".wav",
  ".flac",
  ".m4a",
  ".webm",
  ".jar",
  ".class",
  ".o",
  ".a",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".dmg",
  ".iso",
  ".psd",
  ".sketch",
  ".fig",
  ".ai"
]);
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}
var EXT_LANG = {
  ".py": "python",
  ".js": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".html": "html",
  ".css": "css",
  ".sql": "sql",
  ".xml": "xml",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".txt": "text",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro"
};
function extLang(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = path.slice(dot).toLowerCase();
  return EXT_LANG[ext] ?? "text";
}
function shouldSkipByExt(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SKIP_EXT.has(path.slice(dot).toLowerCase());
}
function matchesPattern(relPath, pattern) {
  const p = relPath.replace(/\\/g, "/");
  const norm = pattern.replace(/\\/g, "/");
  if (norm.endsWith("/")) {
    return p === norm.slice(0, -1) || p.startsWith(norm);
  }
  if (norm.startsWith("*.")) {
    return p.endsWith(norm.slice(1));
  }
  return p === norm;
}
function shouldInclude(relPath, exclude) {
  const p = relPath.replace(/\\/g, "/");
  const name = p.split("/").pop() ?? p;
  for (const rule of exclude) {
    if (matchesPattern(p, rule)) return false;
    if (p.split("/").includes(rule)) return false;
  }
  if (p.split("/").some((segment) => segment.startsWith("dsh-pack-"))) return false;
  if (shouldSkipByExt(p)) return false;
  if (name.startsWith(".") && name !== ".gitignore" && name !== ".env.example") return false;
  return true;
}
function buildFileBlock(relPath, content) {
  const lang = extLang(relPath);
  const safeContent = content.replace(/```/g, "````");
  return `
### \`${relPath}\`
\`\`\`${lang}
${safeContent}
\`\`\`
`;
}
function buildTreeText(files) {
  const root = { children: /* @__PURE__ */ new Map(), isDir: true };
  for (const f of files) {
    const parts = f.relPath.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { children: /* @__PURE__ */ new Map(), isDir: !isLast };
        node.children.set(part, child);
      }
      node = child;
    }
  }
  const lines = [];
  const walk = (node, depth) => {
    const entries = [...node.children.entries()].sort(([a, na], [b, nb]) => {
      if (na.isDir !== nb.isDir) return na.isDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const [name, child] of entries) {
      const indent = "  ".repeat(depth);
      lines.push(`${indent}${name}${child.isDir ? "/" : ""}`);
      if (child.isDir) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n");
}
var TEMPLATE_OVERHEAD_TOKENS = 40;
var MAX_ATTACHMENT_LINES = 20;
function attachDirOf(relPath) {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}
function selectRelevantAttachments(includedPaths, skippedPaths, limit = MAX_ATTACHMENT_LINES, excludePaths = []) {
  const excluded = new Set(excludePaths);
  const candidates = skippedPaths.filter((path) => !excluded.has(path));
  const total = candidates.length;
  if (includedPaths.length === 0 || total === 0) return { listed: [], omitted: 0, total };
  const dirs = new Set(includedPaths.map(attachDirOf));
  const relevant = candidates.filter((path) => dirs.has(attachDirOf(path)));
  const listed = relevant.slice(0, limit);
  return { listed, omitted: Math.max(0, relevant.length - listed.length), total };
}
function applyBudget(entries, tokenBudget) {
  const reserve = estimateTokens(buildTreeText(entries)) + TEMPLATE_OVERHEAD_TOKENS;
  const included = [];
  const dropped = [];
  let used = reserve;
  for (const entry of entries) {
    const cost = estimateTokens(buildFileBlock(entry.relPath, entry.content));
    if (used + cost > tokenBudget) {
      dropped.push(entry.relPath);
      continue;
    }
    included.push(entry);
    used += cost;
  }
  return { included, dropped, usedTokens: used };
}
function assemblePrompt(treeText, files, note, attachments, extractedFiles) {
  const head = [
    "\u4E0B\u9762\u662F\u6211\u7684\u9879\u76EE\u7ED3\u6784\u548C\u5173\u952E\u6587\u4EF6\uFF0C\u8BF7\u5E2E\u52A9\u6211\u7406\u89E3\u9879\u76EE\u5E76\u56DE\u7B54\u6211\u7684\u95EE\u9898\u3002",
    "",
    "\u3010\u9879\u76EE\u7ED3\u6784\u3011",
    treeText,
    "",
    "\u3010\u5173\u952E\u6587\u4EF6\u5185\u5BB9\u3011"
  ].join("\n");
  const blocks = files.map((f) => buildFileBlock(f.relPath, f.content)).join("");
  let skippedSection = "";
  if (attachments !== void 0 && attachments.listed.length > 0) {
    skippedSection = [
      "",
      "\u3010\u672A\u5305\u542B\u7684\u9644\u4EF6\uFF08\u65E0\u6CD5\u4F5C\u4E3A\u6587\u672C\u8BFB\u53D6\uFF09\u3011",
      "\u4EE5\u4E0B\u6587\u4EF6\u4E0E\u672C\u6B21\u6240\u9009\u6587\u4EF6\u540C\u76EE\u5F55\uFF0C\u4F46\u5C5E\u4E8E PDF / Office / \u56FE\u7247\u7B49\u4E8C\u8FDB\u5236\u683C\u5F0F\uFF0C\u5185\u5BB9\u672A\u5305\u542B\uFF1A",
      ...attachments.listed.map((path) => `- ${path}`),
      ...attachments.omitted > 0 ? [`- \u2026\u540C\u76EE\u5F55\u53E6\u6709 ${attachments.omitted} \u4E2A\u672A\u5217\u51FA`] : [],
      "\u5982\u9700\u5206\u6790\u8FD9\u4E9B\u6587\u4EF6\uFF0C\u8BF7\u63D0\u793A\u7528\u6237\u5728\u5BF9\u8BDD\u4E2D\u76F4\u63A5\u4E0A\u4F20\u539F\u6587\u4EF6\u3002",
      ""
    ].join("\n");
  } else if (attachments !== void 0 && attachments.total > 0) {
    skippedSection = [
      "",
      "\u3010\u672A\u5305\u542B\u7684\u9644\u4EF6\u3011",
      `\u672C\u5DE5\u4F5C\u533A\u53E6\u6709 ${attachments.total} \u4E2A PDF / Office / \u56FE\u7247\u7B49\u4E8C\u8FDB\u5236\u6587\u4EF6\u672A\u5305\u542B\u5728\u4E0A\u4E0B\u6587\u4E2D`,
      "\uFF08\u4E0E\u6240\u9009\u6587\u4EF6\u4E0D\u540C\u76EE\u5F55\uFF0C\u6545\u672A\u9010\u4E00\u5217\u51FA\uFF09\u3002\u5982\u9700\u5206\u6790\u5177\u4F53\u6587\u4EF6\uFF0C\u8BF7\u63D0\u793A\u7528\u6237\u5355\u72EC\u4E0A\u4F20\u3002",
      ""
    ].join("\n");
  }
  const extractedSection = extractedFiles !== void 0 && extractedFiles.length > 0 ? [
    "",
    "\u3010\u62BD\u53D6\u7684\u9644\u4EF6\u6587\u672C\uFF08\u672C\u5730\u62BD\u53D6\uFF0C\u53EF\u80FD\u6709\u6392\u7248\u635F\u5931\uFF09\u3011",
    ...extractedFiles.map((f) => buildFileBlock(f.relPath, f.content))
  ].join("\n") : "";
  const tail = note ? `
\u3010\u8865\u5145\u8BF4\u660E\u3011
${note}
` : "";
  const prompt = `${head}${blocks}${skippedSection}${extractedSection}${tail}`;
  return { prompt, tokens: estimateTokens(prompt), fileCount: files.length, treeText };
}

// src/file-tree.ts
function buildFileTree(files, skippedByDir = {}, skippedFiles = []) {
  const root = {
    name: "",
    relPath: "",
    isDir: true,
    children: [],
    size: 0,
    fileCount: 0,
    binary: false,
    skipped: 0
  };
  const dirIndex = /* @__PURE__ */ new Map([["", root]]);
  const ensureDir = (relPath) => {
    const known = dirIndex.get(relPath);
    if (known !== void 0) return known;
    const slash = relPath.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : relPath.slice(0, slash);
    const parent = ensureDir(parentPath);
    const node = {
      name: slash < 0 ? relPath : relPath.slice(slash + 1),
      relPath,
      isDir: true,
      children: [],
      size: 0,
      fileCount: 0,
      binary: false,
      skipped: 0
    };
    parent.children.push(node);
    dirIndex.set(relPath, node);
    return node;
  };
  for (const file of files) {
    const slash = file.relPath.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : file.relPath.slice(0, slash);
    const name = slash < 0 ? file.relPath : file.relPath.slice(slash + 1);
    ensureDir(parentPath).children.push({
      name,
      relPath: file.relPath,
      isDir: false,
      children: [],
      size: file.size,
      fileCount: 1,
      binary: false,
      skipped: 0
    });
  }
  for (const file of skippedFiles) {
    const slash = file.relPath.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : file.relPath.slice(0, slash);
    const name = slash < 0 ? file.relPath : file.relPath.slice(slash + 1);
    ensureDir(parentPath).children.push({
      name,
      relPath: file.relPath,
      isDir: false,
      children: [],
      size: 0,
      fileCount: 0,
      binary: true,
      skipped: 0
    });
  }
  for (const [dirPath, skipped] of Object.entries(skippedByDir)) {
    const node = ensureDir(dirPath);
    node.skipped += skipped;
  }
  const finalize = (node) => {
    if (!node.isDir) return;
    node.children.sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);
    let size = 0;
    let count = 0;
    let skipped = node.skipped;
    for (const child of node.children) {
      finalize(child);
      size += child.size;
      count += child.fileCount;
      skipped += child.skipped;
    }
    node.size = size;
    node.fileCount = count;
    node.skipped = skipped;
  };
  finalize(root);
  return root.children;
}
function collectFilePaths(node, out = []) {
  if (!node.isDir) {
    if (!node.binary) out.push(node.relPath);
    return out;
  }
  for (const child of node.children) collectFilePaths(child, out);
  return out;
}
function countSelected(node, selected) {
  if (!node.isDir) return !node.binary && selected.has(node.relPath) ? 1 : 0;
  let hit = 0;
  for (const child of node.children) hit += countSelected(child, selected);
  return hit;
}
function selectionOf(node, selected) {
  if (!node.isDir) return !node.binary && selected.has(node.relPath) ? "all" : "none";
  if (node.fileCount === 0) return "none";
  const hit = countSelected(node, selected);
  if (hit === 0) return "none";
  return hit === node.fileCount ? "all" : "some";
}
function toggleNodeSelection(node, selected) {
  const next = new Set(selected);
  const selectAll = selectionOf(node, selected) !== "all";
  for (const filePath of collectFilePaths(node)) {
    if (selectAll) next.add(filePath);
    else next.delete(filePath);
  }
  return next;
}
function collectDirPaths(nodes, out = []) {
  for (const node of nodes) {
    if (!node.isDir) continue;
    out.push(node.relPath);
    collectDirPaths(node.children, out);
  }
  return out;
}

// src/DualBridgeTab.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var FILE_CAP_OPTIONS = [500, 2e3, 1e4, 0];
var DEFAULT_FILE_CAP = 2e3;
var MAX_BYTES = 3 * 1024 * 1024;
var MAX_READ_FILES = 500;
var READ_CONCURRENCY = 8;
var MAX_SKIPPED_LISTED = 300;
var BUILD_VERSION = "0.13.2";
function DualBridgeTab(props) {
  const { scope } = props;
  const [cwd, setCwd] = (0, import_react.useState)("");
  const [root, setRoot] = (0, import_react.useState)("");
  const [allFiles, setAllFiles] = (0, import_react.useState)([]);
  const [selected, setSelected] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [expanded, setExpanded] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [tokenBudget, setTokenBudget] = (0, import_react.useState)(8e3);
  const [phase, setPhase] = (0, import_react.useState)("loading");
  const [error, setError] = (0, import_react.useState)("");
  const [result, setResult] = (0, import_react.useState)(null);
  const [budgetMode, setBudgetMode] = (0, import_react.useState)("warn");
  const [includeAttachments, setIncludeAttachments] = (0, import_react.useState)(false);
  const [packNotice, setPackNotice] = (0, import_react.useState)("");
  const [extracting, setExtracting] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [extracted, setExtracted] = (0, import_react.useState)({});
  const [extractError, setExtractError] = (0, import_react.useState)("");
  const [openNotice, setOpenNotice] = (0, import_react.useState)("");
  const [caps, setCaps] = (0, import_react.useState)(null);
  const [hostBuild, setHostBuild] = (0, import_react.useState)(null);
  const [makeZip, setMakeZip] = (0, import_react.useState)(false);
  const [bundling, setBundling] = (0, import_react.useState)(false);
  const [bundleInfo, setBundleInfo] = (0, import_react.useState)(null);
  const [search, setSearch] = (0, import_react.useState)("");
  const [scanProgress, setScanProgress] = (0, import_react.useState)(null);
  const [fileCap, setFileCap] = (0, import_react.useState)(DEFAULT_FILE_CAP);
  const [skippedStats, setSkippedStats] = (0, import_react.useState)({});
  const [skippedFiles, setSkippedFiles] = (0, import_react.useState)([]);
  const [scanNotice, setScanNotice] = (0, import_react.useState)("");
  const disposedRef = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => () => {
    disposedRef.current = true;
  }, []);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    void api.capabilities().then(({ caps: c, hostBuild: build }) => {
      if (cancelled) return;
      setCaps(c);
      setHostBuild(build ?? null);
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    setError("");
    if (!scope.sessionId) {
      setPhase("loading");
      setError("\u5F53\u524D\u4F1A\u8BDD\u5C1A\u672A\u6FC0\u6D3B\uFF08sessionId \u4E3A\u7A7A\uFF09\uFF1A\u8BF7\u5148\u65B0\u5EFA\u6216\u8FDB\u5165\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u5207\u56DE\u672C Tab\u3002");
      return () => {
        cancelled = true;
      };
    }
    ;
    (async () => {
      try {
        const info = await api.sessionCwd(scope);
        if (cancelled) return;
        setCwd(info.cwd);
        setRoot(info.root);
        setPhase("scanning");
      } catch (e) {
        if (!cancelled) {
          setPhase("select");
          setError(`\u8BFB\u53D6\u5DE5\u4F5C\u533A\u5931\u8D25\uFF1A${e.message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope.sessionId]);
  const scanTokenRef = (0, import_react.useRef)(0);
  const scan = (0, import_react.useCallback)(async (rootOverride, capOverride) => {
    const startPath = rootOverride ?? (cwd || root);
    if (!startPath) {
      setError("\u5DE5\u4F5C\u533A\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
      return;
    }
    const token = ++scanTokenRef.current;
    const stale = () => token !== scanTokenRef.current || disposedRef.current;
    setPhase("scanning");
    setError("");
    setScanNotice("");
    setScanProgress({ dirs: 0, files: 0 });
    try {
      const rootPath = startPath.length > 1 ? startPath.replace(/\/+$/, "") : startPath;
      const norm = (p) => p.length > 1 ? p.replace(/\/+$/, "") : p;
      const found = [];
      const queue = [rootPath];
      const visited = /* @__PURE__ */ new Set();
      const excludeArr = [...DEFAULT_EXCLUDES];
      const capValue = capOverride ?? fileCap;
      const cap = capValue > 0 ? capValue : Number.POSITIVE_INFINITY;
      const skippedByDir = {};
      const skippedList = [];
      let truncatedDirs = 0;
      let reachedLimit = false;
      let dirCount = 0;
      let lastProgressAt = 0;
      const collect = (dirPath, entries) => {
        const dirKey = norm(dirPath);
        if (reachedLimit || visited.has(dirKey)) return;
        visited.add(dirKey);
        dirCount++;
        const dirRel = dirKey === rootPath ? "" : dirKey.startsWith(rootPath + "/") ? dirKey.slice(rootPath.length + 1) : dirKey;
        for (const entry of entries) {
          const entryPath = norm(entry.path);
          const relPath = entryPath.startsWith(rootPath + "/") ? entryPath.slice(rootPath.length + 1) : entryPath;
          if (entry.isDir) {
            if (shouldInclude(relPath + "/", excludeArr)) queue.push(entryPath);
          } else if (shouldInclude(relPath, excludeArr)) {
            found.push({ relPath, path: entryPath, size: 0 });
          } else {
            skippedByDir[dirRel] = (skippedByDir[dirRel] ?? 0) + 1;
            if (skippedList.length < MAX_SKIPPED_LISTED) {
              skippedList.push({ relPath, path: entryPath });
            }
          }
          if (found.length >= cap) {
            reachedLimit = true;
            return;
          }
        }
      };
      const BATCH = 16;
      while (queue.length > 0 && !reachedLimit) {
        if (stale()) return;
        const batch = queue.splice(0, BATCH);
        let levels;
        try {
          const result2 = await api.fsTrees(scope, batch, excludeArr);
          levels = result2.levels;
        } catch {
          levels = void 0;
        }
        if (levels === void 0) {
          for (const dir of batch) {
            if (stale()) return;
            if (visited.has(norm(dir))) continue;
            try {
              const tree2 = await api.fsTree(scope, dir, excludeArr);
              collect(tree2.path, tree2.entries);
            } catch {
              continue;
            }
          }
        } else {
          for (const level of levels) {
            if (!level || level.error) continue;
            if (level.truncated) truncatedDirs++;
            collect(level.path, level.entries);
          }
        }
        const now = Date.now();
        if (now - lastProgressAt > 100) {
          lastProgressAt = now;
          if (stale()) return;
          setScanProgress({ dirs: dirCount, files: found.length });
        }
      }
      if (stale()) return;
      found.sort((a, b) => a.relPath.localeCompare(b.relPath));
      setAllFiles(found);
      setSkippedStats(skippedByDir);
      setSkippedFiles(skippedList);
      setExtracted({});
      setExtractError("");
      setSelected(/* @__PURE__ */ new Set());
      setExpanded(/* @__PURE__ */ new Set());
      const notices = [];
      if (reachedLimit && cap !== Number.POSITIVE_INFINITY) {
        notices.push(`\u5DF2\u8FBE\u626B\u63CF\u4E0A\u9650 ${cap.toLocaleString()} \u4E2A\u6587\u4EF6\uFF0C\u4EC5\u5217\u51FA\u524D ${found.length} \u4E2A\uFF1B\u63D0\u9AD8\u4E0A\u9650\u540E\u53EF\u91CD\u65B0\u626B\u63CF`);
      }
      if (truncatedDirs > 0) {
        notices.push(`${truncatedDirs} \u4E2A\u76EE\u5F55\u7684\u6761\u76EE\u88AB\u5BBF\u4E3B\u622A\u65AD\uFF0C\u5176\u4E2D\u53EF\u80FD\u6709\u6587\u4EF6\u672A\u5217\u51FA`);
      }
      setScanNotice(notices.join("\uFF1B"));
      setScanProgress(null);
      setPhase("select");
      if (found.length === 0) {
        setError(`\u5728 ${rootPath} \u4E0B\u6CA1\u6709\u627E\u5230\u53EF\u6253\u5305\u7684\u6587\u4EF6\uFF08\u53EF\u80FD\u88AB\u6392\u9664\u89C4\u5219\u5168\u90E8\u8FC7\u6EE4\uFF09\u3002`);
      }
    } catch (e) {
      if (stale()) return;
      setError(`\u626B\u63CF\u5931\u8D25\uFF1A${e.message}`);
      setScanProgress(null);
      setPhase("select");
    }
  }, [cwd, root, scope, fileCap]);
  const autoScanKey = (0, import_react.useRef)("");
  (0, import_react.useEffect)(() => {
    if (phase !== "scanning") return;
    const start = cwd || root;
    if (!start) return;
    const key = `${scope.sessionId}|${start}`;
    if (autoScanKey.current === key) return;
    autoScanKey.current = key;
    void scan(start);
  }, [phase, cwd, root, scope.sessionId, scan]);
  const tree = (0, import_react.useMemo)(
    () => buildFileTree(allFiles, skippedStats, skippedFiles),
    [allFiles, skippedStats, skippedFiles]
  );
  const skippedPathMap = (0, import_react.useMemo)(
    () => new Map(skippedFiles.map((f) => [f.relPath, f.path])),
    [skippedFiles]
  );
  const extractedEntries = (0, import_react.useMemo)(
    () => Object.entries(extracted).map(([relPath, v]) => ({ relPath, content: v.text })),
    [extracted]
  );
  const packAndCopy = (0, import_react.useCallback)(async () => {
    setError("");
    setPackNotice("");
    setBundleInfo(null);
    setPhase("preview");
    try {
      const picked = allFiles.filter((f) => selected.has(f.relPath));
      const candidates = picked.slice(0, MAX_READ_FILES);
      const overCap = picked.length - candidates.length;
      const slots = new Array(
        candidates.length
      ).fill(null);
      let skippedLarge = 0;
      let skippedBinary = 0;
      let readFailed = 0;
      for (let start = 0; start < candidates.length; start += READ_CONCURRENCY) {
        const chunk = candidates.slice(start, start + READ_CONCURRENCY);
        const reads = await Promise.all(
          chunk.map(async (file) => {
            try {
              return await api.fsRead(scope, file.path);
            } catch {
              return null;
            }
          })
        );
        reads.forEach((read, offset) => {
          const index = start + offset;
          if (read === null) {
            readFailed++;
            return;
          }
          if (read.kind === "text") {
            if (read.size > MAX_BYTES) {
              skippedLarge++;
              return;
            }
            slots[index] = { relPath: candidates[index].relPath, content: read.content, size: read.size };
            return;
          }
          skippedBinary++;
        });
      }
      const entries = slots.filter((e) => e !== null);
      let included = entries;
      const dropped = [];
      if (budgetMode === "truncate") {
        const plan = applyBudget(entries, tokenBudget);
        included = plan.included;
        dropped.push(...plan.dropped);
      }
      const selectedExtracted = extractedEntries.filter((e) => selected.has(e.relPath));
      const treeText = buildTreeText([...included, ...selectedExtracted]);
      const attachmentPlan = includeAttachments ? selectRelevantAttachments(
        [...included.map((f) => f.relPath), ...extractedEntries.map((e) => e.relPath)],
        skippedFiles.map((f) => f.relPath),
        void 0,
        extractedEntries.map((e) => e.relPath)
        // 已抽取的不再算"未包含"
      ) : void 0;
      const pack = assemblePrompt(treeText, included, void 0, attachmentPlan, selectedExtracted);
      setResult({ ...pack, fileCount: included.length, dropped, overBudget: pack.tokens > tokenBudget });
      const notes = [];
      if (overCap > 0) {
        notes.push(
          `\u5DF2\u9009 ${picked.length} \u4E2A\uFF0C\u5355\u6B21\u6700\u591A\u8BFB\u53D6 ${MAX_READ_FILES} \u4E2A\uFF0C\u5176\u4F59 ${overCap} \u4E2A\u672A\u5904\u7406\uFF08\u5176\u4E2D\u53EF\u80FD\u542B\u8D85\u5927\u6587\u4EF6\uFF1B\u5EFA\u8BAE\u7F29\u5C0F\u52FE\u9009\u8303\u56F4\u6216\u5206\u6279\u6253\u5305\uFF09`
        );
      }
      if (dropped.length > 0) notes.push(`\u6309\u9884\u7B97\u622A\u65AD\u6389 ${dropped.length} \u4E2A\u6587\u4EF6`);
      if (skippedLarge > 0) notes.push(`\u8DF3\u8FC7 ${skippedLarge} \u4E2A\u8D85\u8FC7 ${Math.round(MAX_BYTES / 1024 / 1024)}MB \u7684\u6587\u4EF6`);
      if (skippedBinary > 0) notes.push(`\u8DF3\u8FC7 ${skippedBinary} \u4E2A\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF08PDF/Office/\u56FE\u7247\u7B49\uFF09`);
      if (readFailed > 0) notes.push(`${readFailed} \u4E2A\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25`);
      if (attachmentPlan !== void 0 && attachmentPlan.listed.length > 0) {
        notes.push(`prompt \u5185\u9644 ${attachmentPlan.listed.length} \u6761\u540C\u76EE\u5F55\u9644\u4EF6\u58F0\u660E`);
      }
      const extractedSet = new Set(Object.keys(extracted));
      const binarySelected = skippedFiles.filter(
        (f) => selected.has(f.relPath) && !extractedSet.has(f.relPath)
      );
      setBundleInfo(null);
      if (binarySelected.length > 0) {
        setBundling(true);
        try {
          const res = await api.bundle(
            cwd,
            binarySelected.map((f) => ({ relPath: f.relPath, absPath: f.path })),
            makeZip
          );
          if (res.ok && typeof res.dir === "string") {
            setBundleInfo({
              dir: res.dir,
              zipPath: res.zipPath,
              fileCount: res.fileCount ?? binarySelected.length,
              bytes: res.bytes ?? 0,
              // 明确记录"这一包到底装了什么"，便于用户核对（也便于定位错包问题）
              files: binarySelected.map((f) => f.relPath)
            });
            notes.push(`\u5DF2\u628A ${binarySelected.length} \u4E2A\u4E0D\u53EF\u8BC6\u522B\u6587\u4EF6\u6253\u5305\u5230\u684C\u9762 dsh-pack \u76EE\u5F55`);
          } else {
            notes.push(`\u5BFC\u51FA\u5305\u5931\u8D25\uFF1A${res.message ?? "\u672A\u77E5\u539F\u56E0"}`);
          }
        } catch (e) {
          notes.push(`\u5BFC\u51FA\u5305\u5931\u8D25\uFF1A${e.message}`);
        } finally {
          setBundling(false);
        }
      }
      setPackNotice(notes.join("\uFF1B"));
      if (pack.tokens > tokenBudget) {
        setError(
          budgetMode === "warn" ? `\u26A0\uFE0F \u6253\u5305\u540E\u7EA6 ${pack.tokens.toLocaleString()} token\uFF0C\u8D85\u8FC7\u9884\u7B97 ${tokenBudget.toLocaleString()}\u3002\u8BF7\u51CF\u5C11\u6587\u4EF6\u3001\u8C03\u5927\u9884\u7B97\uFF0C\u6216\u628A\u300C\u8D85\u9884\u7B97\u65F6\u300D\u6539\u6210\u6309\u9884\u7B97\u622A\u65AD\u3002` : `\u26A0\uFE0F \u5373\u4F7F\u6309\u9884\u7B97\u622A\u65AD\u540E\u4ECD\u7EA6 ${pack.tokens.toLocaleString()} token\uFF08\u76EE\u5F55\u6811\u4E0E\u6A21\u677F\u672C\u8EAB\u5360\u7528\uFF09\uFF0C\u8BF7\u8C03\u5927\u9884\u7B97\u3002`
        );
      }
    } catch (e) {
      setError(`\u6253\u5305\u5931\u8D25\uFF1A${e.message}`);
      setPhase("select");
    }
  }, [allFiles, selected, scope, tokenBudget, budgetMode, skippedFiles, extractedEntries, includeAttachments]);
  const doCopy = (0, import_react.useCallback)(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
      setPhase("copied");
      setError("");
    } catch (e) {
      setError(`\u590D\u5236\u5931\u8D25\uFF1A${e.message}\uFF0C\u53EF\u624B\u52A8\u9009\u4E2D\u6587\u672C\u590D\u5236`);
    }
  }, [result]);
  const backToSelect = (0, import_react.useCallback)(() => {
    setPackNotice("");
    setBundleInfo(null);
    setError("");
    setPhase("select");
  }, []);
  const openWebChat = (0, import_react.useCallback)(() => {
    const { window: win, reused } = openSplitWindow("https://chat.deepseek.com/");
    if (win === null) {
      setOpenNotice("\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u5F39\u7A97\uFF1A\u8BF7\u5141\u8BB8\u672C\u7AD9\u5F39\u7A97\u540E\u91CD\u8BD5\uFF0C\u6216\u624B\u52A8\u8BBF\u95EE chat.deepseek.com");
      return;
    }
    setOpenNotice(
      reused ? "\u5DF2\u805A\u7126\u53F3\u4FA7\u7F51\u9875\u7248\u7A97\u53E3\uFF08\u4E0D\u4F1A\u6253\u65AD\u6B63\u5728\u8FDB\u884C\u7684\u5BF9\u8BDD\uFF09" : "\u5DF2\u5728\u53F3\u4FA7\u6253\u5F00\u7F51\u9875\u7248\u7A97\u53E3\uFF1A\u540C\u5C4F\u5E76\u6392\uFF0C\u4E0D\u5360\u7528\u5F53\u524D\u6807\u7B7E\u9875"
    );
  }, []);
  const toggleFile = (relPath) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };
  const skippedTotal = (0, import_react.useMemo)(
    () => Object.values(skippedStats).reduce((sum, n) => sum + n, 0),
    [skippedStats]
  );
  const allDirPaths = (0, import_react.useMemo)(() => collectDirPaths(tree), [tree]);
  const toggleExpand = (0, import_react.useCallback)((relPath) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);
  const expandAll = () => setExpanded(new Set(allDirPaths));
  const collapseAll = () => setExpanded(/* @__PURE__ */ new Set());
  const selectAll = () => setSelected(/* @__PURE__ */ new Set([...allFiles.map((f) => f.relPath), ...Object.keys(extracted)]));
  const clearAll = () => setSelected(/* @__PURE__ */ new Set());
  const selectTextOnly = () => setSelected(new Set(allFiles.filter((f) => extLang(f.relPath) !== "text").map((f) => f.relPath)));
  const searchResults = (0, import_react.useMemo)(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return [];
    const hit = (relPath) => relPath.toLowerCase().includes(q);
    return [
      ...allFiles.filter((f) => hit(f.relPath)).map((f) => ({ relPath: f.relPath, binary: false })),
      ...skippedFiles.filter((f) => hit(f.relPath)).map((f) => ({ relPath: f.relPath, binary: true }))
    ];
  }, [allFiles, skippedFiles, search]);
  const selectedCount = selected.size;
  const selectedBinaryCount = skippedFiles.filter((f) => selected.has(f.relPath)).length;
  const searching = search.trim() !== "";
  const extractedEntryCount = Object.keys(extracted).filter((p) => selected.has(p)).length;
  const runExtract = (0, import_react.useCallback)(
    async (relPath) => {
      const absPath = skippedPathMap.get(relPath);
      if (absPath === void 0) return;
      setExtractError("");
      setExtracting((prev) => new Set(prev).add(relPath));
      try {
        const result2 = isImagePath(relPath) ? await api.ocr(cwd, absPath) : await api.extract(cwd, absPath);
        if (result2.ok && typeof result2.text === "string") {
          setSelected((prev) => new Set(prev).add(relPath));
          setExtracted((prev) => ({
            ...prev,
            [relPath]: {
              text: result2.text,
              chars: result2.chars ?? result2.text.length,
              truncated: result2.truncated === true,
              engine: result2.engine ?? ""
            }
          }));
        } else {
          setExtractError(`${relPath}\uFF1A${result2.message ?? "\u62BD\u53D6\u5931\u8D25"}`);
        }
      } catch (e) {
        setExtractError(`${relPath}\uFF1A${e.message}`);
      } finally {
        setExtracting((prev) => {
          const next = new Set(prev);
          next.delete(relPath);
          return next;
        });
      }
    },
    [cwd, skippedPathMap]
  );
  const removeExtracted = (0, import_react.useCallback)((relPath) => {
    setExtracted((prev) => {
      const next = { ...prev };
      delete next[relPath];
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(relPath);
      return next;
    });
  }, []);
  const copySkippedPaths = (0, import_react.useCallback)(async () => {
    const text = skippedFiles.map((f) => f.path).join("\n");
    if (text === "") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
    }
  }, [skippedFiles]);
  const convertAction = (relPath) => {
    const kind = extractKindOf(relPath);
    const unknown = caps === null;
    if (kind === "pdf") {
      return caps?.pdf === true || unknown ? { ok: true, label: "\u63D0\u53D6\u6587\u5B57", title: "PDF \u63D0\u53D6\u6587\u5B57\uFF08poppler\uFF09" } : { ok: false, label: "", title: "\u672C\u673A\u672A\u88C5 poppler\uFF0C\u65E0\u6CD5\u63D0\u53D6 PDF \u6587\u5B57\uFF08\u53EF\u6539\u7528\u5BFC\u51FA\u5305\u4E0A\u4F20\u539F\u6587\u4EF6\uFF09" };
    }
    if (kind === "office") {
      return caps?.office === true || unknown ? {
        ok: true,
        label: "\u63D0\u53D6\u6587\u5B57",
        title: "Word / PPT / Excel / RTF \u63D0\u53D6\u6587\u5B57\uFF08\u5185\u7F6E\u89E3\u6790\u5668\uFF0C\u4E09\u5E73\u53F0\u901A\u7528\uFF09"
      } : { ok: false, label: "", title: "\u672C\u673A\u4E0D\u652F\u6301\u8BE5\u683C\u5F0F\uFF08\u53EF\u6539\u7528\u5BFC\u51FA\u5305\u4E0A\u4F20\u539F\u6587\u4EF6\uFF09" };
    }
    if (isImagePath(relPath)) {
      return caps?.ocr != null || unknown ? {
        ok: true,
        label: "OCR \u6587\u5B57",
        title: `\u56FE\u7247 OCR${caps?.ocr === void 0 ? "" : `\uFF08${caps.ocr}\uFF09`}\uFF1A\u628A\u56FE\u91CC\u7684\u6587\u5B57\u53D8\u6210\u7EAF\u6587\u672C`
      } : { ok: false, label: "", title: "\u672C\u673A\u6CA1\u6709 OCR \u80FD\u529B\uFF08\u53EF\u6539\u7528\u5BFC\u51FA\u5305\u4E0A\u4F20\u539F\u56FE\uFF09" };
    }
    return { ok: false, label: "", title: "\u8BE5\u7C7B\u578B\u65E0\u6CD5\u8F6C\u6587\u672C\uFF0C\u8BF7\u7528\u5BFC\u51FA\u5305\u4E0A\u4F20\u539F\u6587\u4EF6" };
  };
  const renderNode = (node, depth) => {
    const state = selectionOf(node, selected);
    const open = expanded.has(node.relPath);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.treeRow, paddingLeft: 4 + depth * 14 }, children: [
        node.isDir ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            style: styles.caret,
            onClick: () => toggleExpand(node.relPath),
            title: open ? "\u6298\u53E0" : "\u5C55\u5F00",
            children: open ? "\u25BE" : "\u25B8"
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.caretSpacer }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: node.isDir ? state === "all" : selected.has(node.relPath),
            ref: (el) => {
              if (el !== null) el.indeterminate = node.isDir && state === "some";
            },
            onChange: () => node.isDir ? setSelected((prev) => toggleNodeSelection(node, prev)) : toggleFile(node.relPath),
            disabled: node.isDir && node.fileCount === 0,
            style: styles.checkbox
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "span",
          {
            style: node.isDir ? node.fileCount === 0 ? styles.dirNameEmpty : styles.dirName : styles.fileName,
            onClick: () => {
              if (node.isDir) toggleExpand(node.relPath);
            },
            title: node.binary && extracted[node.relPath] === void 0 && !convertAction(node.relPath).ok ? `${node.relPath}\uFF08${convertAction(node.relPath).title}\uFF09` : node.relPath,
            children: [
              node.name,
              node.isDir ? "/" : ""
            ]
          }
        ),
        node.isDir ? node.fileCount === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.dirMetaEmpty, title: "\u8BE5\u76EE\u5F55\u4E0B\u7684\u6587\u4EF6\u90FD\u662F PDF / \u56FE\u7247 / Office \u7B49\u4E8C\u8FDB\u5236", children: [
          "\u4E0D\u53EF\u6253\u5305 ",
          node.skipped
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "span",
          {
            style: styles.dirMeta,
            title: node.skipped > 0 ? `\u53E6\u6709 ${node.skipped} \u4E2A\u6587\u4EF6\u56E0\u7C7B\u578B\u88AB\u8DF3\u8FC7` : void 0,
            children: [
              countSelected(node, selected),
              "/",
              node.fileCount
            ]
          }
        ) : node.binary ? extracted[node.relPath] !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.binaryActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.extractedTag, children: [
            "\u5DF2\u62BD\u53D6 ",
            extracted[node.relPath].chars.toLocaleString(),
            " \u5B57",
            extracted[node.relPath].truncated ? "\uFF08\u5DF2\u622A\u65AD\uFF09" : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnMini, onClick: () => removeExtracted(node.relPath), children: "\u79FB\u9664" })
        ] }) : convertAction(node.relPath).ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            style: styles.btnMini,
            disabled: extracting.has(node.relPath),
            onClick: () => void runExtract(node.relPath),
            title: convertAction(node.relPath).title,
            children: extracting.has(node.relPath) ? "\u5904\u7406\u4E2D\u2026" : convertAction(node.relPath).label
          }
        ) : (
          // 本机不具备该类型的能力：不显示按钮，避免误导（走导出包上传原文件）
          null
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fileLang, children: extLang(node.relPath) })
      ] }),
      node.isDir && open && node.children.map((child) => renderNode(child, depth + 1))
    ] }, node.relPath);
  };
  const bundleCard = bundleInfo === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.bundleBox, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.infoTitle, children: [
      "\u{1F4CE} \u5BFC\u51FA\u5305\uFF1A",
      bundleInfo.fileCount,
      " \u4E2A\u9644\u4EF6\uFF08",
      (bundleInfo.bytes / 1024 / 1024).toFixed(1),
      " MB\uFF09"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
      "\u8FD9\u4E9B\u6587\u4EF6\u65E0\u6CD5\u8F6C\u6210\u6587\u672C\uFF0C\u5DF2\u590D\u5236\u5230",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u684C\u9762" }),
      "\u7684\u4E0B\u9762\u76EE\u5F55\uFF08\u91CC\u9762\u53EA\u6709\u8FD9\u4E9B\u4E0D\u53EF\u8BC6\u522B\u7684\u6587\u4EF6\uFF09\u3002 \u8BF7\u628A\u6587\u4EF6",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u62D6\u8FDB\u7F51\u9875\u7248\u8F93\u5165\u6846" }),
      "\u4E00\u5E76\u4E0A\u4F20\uFF1B`\u9644\u4EF6\u6E05\u5355.md` \u5199\u660E\u4E86\u6BCF\u4E2A\u6587\u4EF6\u8BE5\u600E\u4E48\u7ED9 AI \u770B\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.bundleFiles, children: [
      "\u672C\u6B21\u5BFC\u51FA\uFF1A",
      bundleInfo.files.slice(0, 8).join("\u3001"),
      bundleInfo.files.length > 8 ? ` \u7B49 ${bundleInfo.files.length} \u4E2A` : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.bundlePath, title: bundleInfo.dir, children: bundleInfo.dir }),
    bundleInfo.zipPath !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.bundlePath, title: bundleInfo.zipPath, children: [
      "zip\uFF1A",
      bundleInfo.zipPath
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnMini, onClick: () => void api.reveal(cwd, bundleInfo.dir), children: "\u5728\u8BBF\u8FBE\u4E2D\u663E\u793A" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          style: styles.btnMini,
          onClick: () => void navigator.clipboard.writeText(bundleInfo.dir),
          children: "\u590D\u5236\u76EE\u5F55\u8DEF\u5F84"
        }
      )
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.headerRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.header, children: "\u21C4 \u5206\u6D41\u5BF9\u8BDD" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badgeVersion, children: BUILD_VERSION })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.rulesBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.rulesTitle, children: "\u4F7F\u7528\u89C4\u5219" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { style: styles.rulesList, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u52FE\u9009\u6587\u4EF6/\u76EE\u5F55 \u2192\u300C\u{1F4E6} \u6253\u5305\u9009\u4E2D\u6587\u4EF6\u300D= \u628A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u53EF\u8BFB\u6587\u672C" }),
          "\u63D0\u53D6\u5230\u526A\u8D34\u677F\uFF08\u7EAF\u672C\u5730\uFF0C\u4E0D\u4E0A\u4F20\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "Word/PPT/Excel/RTF/PDF \u70B9",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u300C\u63D0\u53D6\u6587\u5B57\u300D" }),
          "\u3001\u56FE\u7247\u70B9",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u300COCR \u6587\u5B57\u300D" }),
          "\uFF0C \u63D0\u53D6\u7ED3\u679C\u4E5F\u4F1A\u8FDB\u526A\u8D34\u677F"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u300C\u{1F680} \u540C\u5C4F\u6253\u5F00\u7F51\u9875\u7248\u300D\u2192 \u5728\u7F51\u9875\u7248\u8F93\u5165\u6846 ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Cmd/Ctrl+V" }),
          " \u7C98\u8D34\u5E76\u63D0\u95EE\uFF08\u514D\u8D39\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u65E0\u6CD5\u8BC6\u522B\u7684\u6587\u4EF6\uFF08\u89C6\u9891/\u538B\u7F29\u5305\u7B49\uFF09\u81EA\u52A8\u6253\u5305\u5230",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u684C\u9762 dsh-pack-\u65F6\u95F4\u6233/" }),
          "\uFF0C \u91CC\u9762\u53EA\u6709\u8FD9\u4E9B\u4E0D\u53EF\u8BC6\u522B\u7684\u6587\u4EF6 + \u8BF4\u660E\u6E05\u5355\uFF0C\u62D6\u8FDB\u7F51\u9875\u7248\u4E0A\u4F20\u5373\u53EF"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u9700\u8981\u6539\u4EE3\u7801 / \u590D\u6742\u63A8\u7406\u65F6\uFF0C\u56DE Harness \u8D70 API\uFF08\u8BA1\u8D39\uFF09" })
      ] })
    ] }),
    hostBuild !== null && hostBuild !== BUILD_VERSION && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.notice, children: [
      "\u26A0\uFE0F host \u7AEF\u4E3A v",
      hostBuild,
      "\u3001\u754C\u9762\u4E3A v",
      BUILD_VERSION,
      "\uFF1A\u4E24\u8005\u4E0D\u4E00\u81F4\u8BF4\u660E",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: " dsh web \u6CA1\u6709\u91CD\u542F" }),
      "\uFF0C\u4F1A\u51FA\u73B0\u65E7\u7684\u5BFC\u51FA\u8DEF\u5F84\u7B49\u9519\u4F4D\u884C\u4E3A\u3002\u8BF7\u91CD\u542F dsh web \u540E\u518D\u6D4B\u3002"
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.error, children: error }),
    scanNotice !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.notice, children: scanNotice }),
    packNotice !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.notice, children: packNotice }),
    extractError !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.error, children: extractError }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.infoBox, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u5DE5\u4F5C\u533A\uFF1A" }),
      cwd || "\u8BFB\u53D6\u4E2D\u2026"
    ] }) }),
    phase === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.status, children: "\u23F3 \u6B63\u5728\u52A0\u8F7D\u5DE5\u4F5C\u533A\u2026" }),
    phase === "scanning" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.status, children: [
      "\u{1F50D} \u6B63\u5728\u626B\u63CF\u9879\u76EE\u6587\u4EF6\u2026",
      scanProgress && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.progressText, children: [
        "\u5DF2\u626B ",
        scanProgress.dirs,
        " \u4E2A\u76EE\u5F55 \xB7 \u53D1\u73B0 ",
        scanProgress.files,
        " \u4E2A\u6587\u4EF6"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 6 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: () => scan(), children: "\u21BB \u91CD\u65B0\u5F00\u59CB\u626B\u63CF" }) })
    ] }),
    phase !== "loading" && phase !== "scanning" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.controls, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: () => scan(), children: "\u21BB \u91CD\u65B0\u626B\u63CF" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: selectAll, disabled: allFiles.length === 0, children: "\u5168\u9009" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: selectTextOnly, disabled: allFiles.length === 0, children: "\u4EC5\u4EE3\u7801" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: clearAll, disabled: allFiles.length === 0, children: "\u5168\u4E0D\u9009" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.label, children: [
          "token \u9884\u7B97\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "number",
              value: tokenBudget,
              min: 1e3,
              max: 1e5,
              step: 1e3,
              onChange: (e) => setTokenBudget(Number(e.target.value) || 8e3),
              style: styles.input
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.label, children: [
          "\u626B\u63CF\u4E0A\u9650\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              value: fileCap,
              onChange: (e) => {
                const next = Number(e.target.value);
                setFileCap(next);
                void scan(void 0, next);
              },
              style: styles.select,
              children: FILE_CAP_OPTIONS.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: n, children: n === 0 ? "\u4E0D\u9650\uFF08\u8F83\u6162\uFF09" : `${n} \u4E2A\u6587\u4EF6` }, n))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.label, children: [
          "\u8D85\u9884\u7B97\u65F6\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "select",
            {
              value: budgetMode,
              onChange: (e) => setBudgetMode(e.target.value),
              style: styles.select,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "warn", children: "\u53EA\u63D0\u793A" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "truncate", children: "\u6309\u9884\u7B97\u622A\u65AD" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "label",
          {
            style: styles.label,
            title: "\u52FE\u9009\u540E\uFF0Cprompt \u91CC\u4F1A\u8BF4\u660E\u540C\u76EE\u5F55\u4E0B\u6709\u54EA\u4E9B PDF/Office \u7B49\u9644\u4EF6\u672A\u5305\u542B\uFF1B\u9ED8\u8BA4\u5173\u95ED\u4EE5\u4FDD\u6301 prompt \u5E72\u51C0",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "checkbox",
                  style: styles.checkbox,
                  checked: includeAttachments,
                  onChange: (e) => setIncludeAttachments(e.target.checked)
                }
              ),
              "\u542B\u9644\u4EF6\u58F0\u660E"
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.label, title: "\u9009\u4E2D\u4E8C\u8FDB\u5236\u6587\u4EF6\u65F6\u4F1A\u751F\u6210\u5BFC\u51FA\u76EE\u5F55\uFF1B\u52FE\u9009\u6B64\u9879\u518D\u6253\u4E00\u4E2A zip\uFF08\u4EC5\u4FBF\u4E8E\u4F20\u8F93\uFF09", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              style: styles.checkbox,
              checked: makeZip,
              onChange: (e) => setMakeZip(e.target.checked)
            }
          ),
          "\u5BFC\u51FA zip"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.count, children: [
          "\u5DF2\u9009 ",
          selectedCount,
          " / ",
          allFiles.length,
          " \u6587\u672C",
          selectedBinaryCount > 0 && ` \xB7 ${selectedBinaryCount} \u4E2A\u9644\u4EF6`
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          style: styles.btnPrimary,
          onClick: packAndCopy,
          disabled: selectedCount === 0,
          children: "\u{1F4E6} \u6253\u5305\u9009\u4E2D\u6587\u4EF6"
        }
      ) }),
      allFiles.length > 0 && selectedCount === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: "\u9ED8\u8BA4\u672A\u9009\u4E2D\u4EFB\u4F55\u6587\u4EF6\uFF1A\u5728\u4E0B\u65B9\u5C55\u5F00\u76EE\u5F55\u540E\u52FE\u9009\uFF08\u52FE\u76EE\u5F55\uFF1D\u9009\u4E2D\u6574\u68F5\u5B50\u6811\uFF09\uFF0C\u6216\u70B9\u300C\u5168\u9009\u300D\u300C\u4EC5\u4EE3\u7801\u300D\u3002" }),
      allFiles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "text",
          placeholder: "\u{1F50E} \u641C\u7D22\u6587\u4EF6\u2026",
          value: search,
          onChange: (e) => setSearch(e.target.value),
          style: styles.search
        }
      )
    ] }),
    phase === "select" && !searching && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.fileList, children: [
      allFiles.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.status, children: "\u672A\u627E\u5230\u53EF\u6253\u5305\u7684\u6587\u4EF6\uFF08\u5DF2\u6309\u6392\u9664\u89C4\u5219\u8FC7\u6EE4\uFF09" }),
      allFiles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.treeHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.treeMeta, children: [
          allFiles.length,
          " \u4E2A\u53EF\u6253\u5305\u6587\u4EF6 \xB7 ",
          allDirPaths.length,
          " \u4E2A\u76EE\u5F55\uFF08\u9ED8\u8BA4\u6298\u53E0\uFF09",
          skippedTotal > 0 && ` \xB7 \u8DF3\u8FC7 ${skippedTotal} \u4E2A\u975E\u6587\u672C\u6587\u4EF6`
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.treeActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnMini, onClick: expandAll, children: "\u5C55\u5F00\u5168\u90E8" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnMini, onClick: collapseAll, children: "\u6298\u53E0\u5168\u90E8" })
        ] })
      ] }),
      tree.map((node) => renderNode(node, 0))
    ] }),
    phase === "select" && searching && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.fileList, children: [
      searchResults.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.status, children: [
        '\u6CA1\u6709\u5339\u914D "',
        search,
        '" \u7684\u6587\u4EF6\u6216\u9644\u4EF6'
      ] }),
      searchResults.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.fileRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: selected.has(f.relPath),
            onChange: () => toggleFile(f.relPath)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fileName, children: f.relPath }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fileLang, children: f.binary ? "\u9644\u4EF6" : extLang(f.relPath) })
      ] }, f.relPath))
    ] }),
    phase === "select" && skippedFiles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.attachBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.attachHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.infoTitle, children: [
          "\u{1F4CE} \u672A\u5305\u542B\u7684\u9644\u4EF6\uFF1A",
          skippedTotal,
          " \u4E2A"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnMini, onClick: copySkippedPaths, children: "\u590D\u5236\u5168\u90E8\u8DEF\u5F84" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
        includeAttachments ? "\u5DF2\u52FE\u9009\u300C\u542B\u9644\u4EF6\u58F0\u660E\u300D\uFF1A\u6253\u5305\u65F6\u4F1A\u628A\u540C\u76EE\u5F55\u4E0B\u7684\u9644\u4EF6\u5217\u8FDB prompt\u3002" : "\u672A\u5199\u5165 prompt\uFF08\u5982\u9700\u8BA9\u6A21\u578B\u77E5\u9053\u8FD9\u4E9B\u9644\u4EF6\uFF0C\u8BF7\u5728\u4E0A\u65B9\u52FE\u9009\u300C\u542B\u9644\u4EF6\u58F0\u660E\u300D\uFF09\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
        "PDF / Office / \u56FE\u7247\u65E0\u6CD5\u4F5C\u4E3A\u6587\u672C\u6253\u5305\u3002\u9700\u8981\u6A21\u578B\u8BFB\u5B83\u4EEC\u65F6\uFF0C",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u76F4\u63A5\u628A\u6587\u4EF6\u62D6\u8FDB DeepSeek \u7F51\u9875\u7248\u8F93\u5165\u6846" }),
        "\u2014\u2014\u539F\u751F\u89E3\u6790\u6BD4\u62BD\u6587\u672C\u66F4\u51C6 \uFF08\u516C\u5F0F\u3001\u8868\u683C\u3001\u6392\u7248\u90FD\u80FD\u4FDD\u7559\uFF09\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.attachList, children: [
        skippedFiles.slice(0, 12).map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.attachItem, title: f.path, children: f.relPath }, f.relPath)),
        skippedFiles.length > 12 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.attachItem, children: [
          "\u2026\u53E6\u6709 ",
          skippedFiles.length - 12,
          " \u4E2A\uFF08\u70B9\u300C\u590D\u5236\u5168\u90E8\u8DEF\u5F84\u300D\u83B7\u53D6\uFF09"
        ] })
      ] })
    ] }),
    phase === "preview" && result && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.previewBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.previewTitle, children: [
        "\u6253\u5305\u9884\u89C8\uFF1A",
        result.fileCount,
        " \u4E2A\u6587\u4EF6",
        extractedEntryCount > 0 && ` + ${extractedEntryCount} \u4E2A\u62BD\u53D6\u9644\u4EF6`,
        " \xB7 \u7EA6",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: result.tokens.toLocaleString() }),
        " token",
        result.overBudget && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.warn, children: "\uFF08\u8D85\u9884\u7B97\uFF09" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("pre", { style: styles.previewText, children: [
        result.prompt.slice(0, 600),
        result.prompt.length > 600 ? "\n\u2026\uFF08\u5DF2\u622A\u65AD\u9884\u89C8\uFF09" : ""
      ] }),
      result.dropped.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
        "\u672A\u5305\u542B\uFF08\u6309\u9884\u7B97\u622A\u65AD\uFF09\uFF1A",
        result.dropped.slice(0, 8).join("\u3001"),
        result.dropped.length > 8 ? ` \u7B49 ${result.dropped.length} \u4E2A` : ""
      ] }),
      bundleCard,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnPrimary, onClick: doCopy, children: "\u{1F4CB} \u590D\u5236\u5230\u526A\u8D34\u677F" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: backToSelect, children: "\u2190 \u8FD4\u56DE\u8C03\u6574" })
      ] })
    ] }),
    phase === "copied" && result && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.copiedBox, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.copiedTitle, children: [
        "\u2705 \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\uFF08",
        result.tokens.toLocaleString(),
        " token\uFF0C",
        result.fileCount,
        " \u4E2A\u6587\u4EF6\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { style: styles.steps, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u70B9\u4E0B\u65B9\u6309\u94AE",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u540C\u5C4F\u6253\u5F00\u7F51\u9875\u7248" }),
          "\uFF08\u53F3\u4FA7\u5E76\u6392\u7A97\u53E3\uFF0C\u4E0D\u5360\u7528\u5F53\u524D\u6807\u7B7E\u9875\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u5728\u7F51\u9875\u7248\u8F93\u5165\u6846 ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Cmd/Ctrl + V" }),
          " \u7C98\u8D34"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          "\u8F93\u5165\u4F60\u7684\u95EE\u9898\uFF0C\u4F7F\u7528",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u514D\u8D39" }),
          "\u5BF9\u8BDD\u5B8C\u6210\u9879\u76EE\u9605\u8BFB/\u7B54\u7591"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u5982\u9700\u590D\u6742\u63A8\u7406 / \u6539\u4EE3\u7801\uFF0C\u56DE\u5230 Harness \u8D70 API\uFF08\u8BA1\u8D39\uFF09" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btnPrimary, onClick: openWebChat, children: "\u{1F680} \u540C\u5C4F\u6253\u5F00\u7F51\u9875\u7248" }) }),
      openNotice !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.notice, children: openNotice }),
      bundling && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: "\u{1F4E6} \u6B63\u5728\u751F\u6210\u5BFC\u51FA\u5305\u2026" }),
      bundleCard,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: backToSelect, children: "\u2190 \u8FD4\u56DE\u9009\u62E9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.btn, onClick: doCopy, children: "\u21BB \u91CD\u65B0\u590D\u5236" })
      ] })
    ] })
  ] });
}
var styles = {
  // 统一使用 DSH 设计令牌：--dsw-alias-label-* 在深色主题取近白、浅色主题取近黑，
  // 因此文字在两种主题下都是「最高对比度」，不会再出现灰蒙蒙看不清的情况。
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    fontFamily: '-apple-system, "PingFang SC", sans-serif',
    fontSize: 13,
    color: "var(--dsw-alias-label-primary)",
    boxSizing: "border-box",
    height: "100%",
    overflowY: "auto"
  },
  headerRow: { flexShrink: 0, display: "flex", alignItems: "center", gap: 8 },
  header: { fontSize: 15, fontWeight: 700, color: "var(--dsw-alias-label-primary)" },
  rulesBox: {
    flexShrink: 0,
    background: "var(--dsw-alias-interactive-bg-hover)",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: 6,
    padding: "6px 8px"
  },
  rulesTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 4,
    color: "var(--dsw-alias-label-primary)"
  },
  rulesList: {
    margin: 0,
    paddingLeft: 16,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 11,
    lineHeight: "16px",
    color: "var(--dsw-alias-label-secondary)"
  },
  badgeVersion: {
    fontSize: 10,
    background: "var(--dsw-alias-interactive-bg-hover)",
    color: "var(--dsw-alias-label-secondary)",
    padding: "2px 6px",
    borderRadius: 4,
    fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)"
  },
  error: { flexShrink: 0, background: "#7f1d1d", color: "#fecaca", padding: 8, borderRadius: 6, fontSize: 12 },
  warn: { color: "var(--dsw-alias-state-warn-primary)", fontSize: 11, marginLeft: 4, fontWeight: 600 },
  infoBox: {
    flexShrink: 0,
    background: "var(--dsw-alias-interactive-bg-hover)",
    padding: 8,
    borderRadius: 6,
    fontSize: 12,
    wordBreak: "break-all",
    color: "var(--dsw-alias-label-primary)"
  },
  status: { flexShrink: 0, color: "var(--dsw-alias-label-secondary)", padding: 8, fontSize: 12 },
  progressText: {
    display: "block",
    color: "var(--dsw-alias-state-business-primary)",
    marginTop: 4,
    fontSize: 11
  },
  controls: { flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  btn: {
    background: "var(--dsw-alias-interactive-bg-hover)",
    color: "var(--dsw-alias-label-primary)",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer"
  },
  btnPrimary: {
    background: "var(--dsw-alias-state-business-primary)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600
  },
  label: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--dsw-alias-label-primary)" },
  input: {
    width: 80,
    background: "var(--dsw-alias-bg-layer-1)",
    color: "var(--dsw-alias-label-primary)",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 4,
    padding: "2px 4px"
  },
  search: {
    background: "var(--dsw-alias-bg-layer-1)",
    color: "var(--dsw-alias-label-primary)",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box"
  },
  count: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
  select: {
    background: "var(--dsw-alias-bg-layer-1)",
    color: "var(--dsw-alias-label-primary)",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 4,
    padding: "2px 4px",
    fontSize: 12
  },
  notice: {
    flexShrink: 0,
    fontSize: 11,
    color: "var(--dsw-alias-state-warn-primary)",
    lineHeight: 1.5,
    background: "var(--dsw-alias-interactive-bg-hover)",
    padding: 6,
    borderRadius: 4,
    border: "1px solid var(--dsw-alias-border-l1)"
  },
  fileList: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxHeight: 260,
    overflowY: "auto",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: 6,
    padding: 4
  },
  fileRow: {
    flexShrink: 0,
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: 12,
    cursor: "pointer",
    color: "var(--dsw-alias-label-primary)"
  },
  treeHead: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    padding: "2px 2px 6px",
    borderBottom: "1px solid var(--dsw-alias-border-l1)",
    marginBottom: 2
  },
  treeMeta: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" },
  treeActions: { display: "flex", gap: 4 },
  btnMini: {
    background: "var(--dsw-alias-interactive-bg-hover)",
    color: "var(--dsw-alias-label-secondary)",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 10,
    cursor: "pointer"
  },
  treeRow: { flexShrink: 0, display: "flex", gap: 4, alignItems: "center", fontSize: 12, lineHeight: "18px" },
  caret: {
    background: "transparent",
    border: "none",
    color: "var(--dsw-alias-label-secondary)",
    cursor: "pointer",
    fontSize: 11,
    width: 14,
    padding: 0
  },
  caretSpacer: { width: 14, display: "inline-block" },
  checkbox: { margin: 0, flex: "0 0 auto", accentColor: "var(--dsw-alias-state-business-primary)" },
  dirName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    color: "var(--dsw-alias-label-primary)",
    fontWeight: 600
  },
  dirMeta: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: 10,
    minWidth: 40,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums"
  },
  dirNameEmpty: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    color: "var(--dsw-alias-label-tertiary)",
    fontWeight: 400
  },
  dirMetaEmpty: {
    color: "var(--dsw-alias-label-tertiary)",
    fontSize: 10,
    textAlign: "right"
  },
  hint: {
    flexShrink: 0,
    fontSize: 11,
    color: "var(--dsw-alias-label-secondary)",
    lineHeight: 1.5,
    background: "var(--dsw-alias-interactive-bg-hover)",
    padding: 6,
    borderRadius: 4
  },
  fileName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--dsw-alias-label-primary)",
    fontWeight: 500
  },
  fileLang: {
    color: "var(--dsw-alias-label-tertiary)",
    fontSize: 11,
    minWidth: 40,
    textAlign: "right"
  },
  previewBox: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 8,
    background: "var(--dsw-alias-interactive-bg-hover)",
    borderRadius: 6,
    color: "var(--dsw-alias-label-primary)"
  },
  previewTitle: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
  previewText: {
    flexShrink: 0,
    background: "var(--dsw-alias-bg-layer-1)",
    padding: 8,
    borderRadius: 4,
    fontSize: 11,
    maxHeight: 180,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    margin: 0,
    color: "var(--dsw-alias-label-primary)",
    fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)"
  },
  bundleBox: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    borderRadius: 6,
    background: "var(--dsw-alias-interactive-bg-hover)",
    border: "1px solid var(--dsw-alias-border-l1)"
  },
  bundleFiles: {
    fontSize: 11,
    lineHeight: "16px",
    color: "var(--dsw-alias-label-secondary)"
  },
  bundlePath: {
    fontSize: 10,
    lineHeight: "15px",
    color: "var(--dsw-alias-label-secondary)",
    fontFamily: "var(--ds-font-family-code, ui-monospace, monospace)",
    wordBreak: "break-all"
  },
  binaryActions: { display: "flex", alignItems: "center", gap: 4 },
  extractedTag: { fontSize: 10, color: "var(--dsw-alias-state-success-primary)" },
  attachBox: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    borderRadius: 6,
    background: "var(--dsw-alias-interactive-bg-hover)",
    border: "1px solid var(--dsw-alias-border-l1)"
  },
  attachHead: { flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  attachList: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    maxHeight: 160,
    overflowY: "auto",
    paddingRight: 4
  },
  attachItem: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: "16px",
    color: "var(--dsw-alias-label-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  // 完成态：不再整块填充深绿（深底浅字观感差），改为细边框 + 主题文字色
  copiedBox: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "transparent",
    border: "1px solid var(--dsw-alias-state-success-primary)",
    borderLeft: "3px solid var(--dsw-alias-state-success-primary)",
    borderRadius: 6
  },
  copiedTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--dsw-alias-state-success-primary)"
  },
  steps: { flexShrink: 0, margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--dsw-alias-label-primary)", display: "flex", flexDirection: "column", gap: 4 }
};

// src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["betterSidebar"];
function apply(ctx) {
  ctx.effect(
    () => ctx.betterSidebar.registerTab({
      id: "dual-bridge",
      title: "\u5206\u6D41\u5BF9\u8BDD",
      description: "\u6253\u5305\u9879\u76EE\u4E0A\u4E0B\u6587\u5E76\u590D\u5236\uFF0C\u4E00\u952E\u540C\u5C4F\u6253\u5F00 DeepSeek \u7F51\u9875\u7248\u7C98\u8D34\u63D0\u95EE\uFF08\u63A8\u7406\u4ECD\u8D70 Harness API\uFF09",
      icon: (size) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: size * 0.7, lineHeight: 1, fontWeight: 700 }, children: "\u21C4" }),
      order: 80,
      single: true,
      component: (props) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DualBridgeTab, { ...props })
    })
  );
}

    return module.exports;
  },
});
