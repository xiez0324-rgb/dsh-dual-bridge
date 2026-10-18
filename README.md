# dsh-dual-bridge

> DeepSeek Harness（DSH）侧边栏插件：把项目上下文**打包成结构化 prompt** → 复制到剪贴板 → **同屏打开** DeepSeek 网页版粘贴提问。
>
> 定位是「双入口分流」：**读项目/答疑走网页版（免费），复杂推理/改码仍走 Harness API（计费）**。
>
> 纯本地：不联网、不爬虫、不操控浏览器、不调用网页版任何接口，也不上传任何文件。

[![npm](https://img.shields.io/npm/v/dsh-dual-bridge.svg)](https://www.npmjs.com/package/dsh-dual-bridge)
[![license](https://img.shields.io/npm/l/dsh-dual-bridge.svg)](LICENSE)
[![CI](https://github.com/xiez0324-rgb/dsh-dual-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/xiez0324-rgb/dsh-dual-bridge/actions)

## 安装

在 DSH 的 **插件市场（Discover）** 里搜索 `dsh-dual-bridge` 一键安装，或手动：

```bash
# 方式一：npm
dsh plugin add dsh-dual-bridge

# 方式二：直连本仓库（无需发布）
dsh plugin add git+https://github.com/xiez0324-rgb/dsh-dual-bridge.git
```

安装后**重启一次** `dsh web`（host 端路由需要加载），再刷新页面；侧边栏会出现「⇄ 分流对话」Tab。
**前置依赖**：`dsh-better-sidebar`（本插件依赖它的侧边栏注册与本地文件 API，版本已锁定在 `package.json`）。

## 30 秒上手

1. 在 DSH 里打开一个会话（需要有工作区），侧边栏点「⇄ 分流对话」
2. 展开目录，勾选要问的文件（勾目录 = 整棵子树；默认什么都不选）
3. 点「📦 打包选中文件」→「📋 复制到剪贴板」
4. 点「🚀 同屏打开网页版」→ 在网页版输入框 `Cmd/Ctrl+V` 粘贴 → 提问
5. 需要改代码/复杂推理时，回 Harness 走 API

> PDF/Word/PPT/Excel/RTF 先点「提取文字」，图片点「OCR 文字」——提取结果也会进剪贴板。
> 无法转文本的文件（视频/压缩包等）会自动打包到 `~/Desktop/dsh-pack-<时间戳>/`，拖进网页版上传即可。

---

## 它解决什么问题

在 Harness 里读代码、解释项目、回答"这个功能怎么实现的"，每次都要消耗 API token。
这类**上下文密集型**任务其实是免费的网页版最擅长的。本插件负责把"上下文搬运"这半件事做到顺手：

```
① 扫描工作区 → 目录树勾选 → 设 token 预算 → 打包并复制
② 一键同屏打开 DeepSeek 网页版（右侧并排窗口，不占用当前标签页）
③ Cmd/Ctrl + V 粘贴 → 提问（免费）
④ 需要改代码/复杂推理 → 回到 Harness 走 API
```

## 功能

| 能力 | 说明 |
|---|---|
| 项目扫描 | 解析 `.gitignore` + 内置 30+ 排除规则（`node_modules`、`.git`、`build`、`__pycache__`、`.env` …）；扫描上限可调（500 / 2000 / 10000 / 不限，默认 2000）并**显式报告截断** |
| 目录树选择 | 可折叠；勾选目录 = 选中整棵子树（三态含半选）；默认不选任何文件；「全选 / 仅代码 / 全不选」 |
| 二进制可见 | PDF/Office/图片不出现"凭空消失"：目录标注「不可打包 N」，文件行置灰 |
| token 预算 | 按 1 token ≈ 4 字符估算；「超预算时」可选**只提示 / 按预算截断**（贪心填充，被丢文件逐条列出） |
| prompt 组装 | 项目结构树 + 逐文件代码块（语言标注、反引号自适应） |
| 附件声明（可选） | 勾选后把**同目录**下未包含的附件列进 prompt（上限 20 条），默认关闭 |
| 按需文本抽取 | 对单个 PDF/Office 文件点「抽取文本」，抽出的正文并入 prompt（见下方平台支持） |
| 同屏打开网页版 | 贴在屏幕右侧的独立窗口 + 自动聚焦；重复点击只聚焦、不刷新已有对话 |
| 复制到剪贴板 | 一步写入系统剪贴板 |

## 架构

```
┌──────────────────────────────┐        ┌──────────────────────────────────┐
│ 浏览器：侧边栏 UI            │        │ DSH 的 Node 进程（host）          │
│ lib/client.js                │ fetch  │ lib/index.js                     │
│ · 目录树 / 勾选 / token 预算 │ ─────▶ │ 本地路由（仅 127.0.0.1 可达）     │
│ · 组装 prompt / 剪贴板       │        │  /dual-bridge/capabilities       │
│ · 同屏窗口（window.open）    │        │  /dual-bridge/extract            │
│                              │        │  /dual-bridge/ocr                │
│ 读不到二进制原文、不能起进程 │        │  /dual-bridge/bundle             │
└──────────────────────────────┘        │  /dual-bridge/reveal             │
                                        └──────────────────────────────────┘
```

| 设计点 | 原因 |
|---|---|
| **UI / host 分离** | 浏览器侧读不到二进制原文（`fs.read` 只回文本），也不能启动子进程；解析与写文件必须落到 host |
| **能力探测** | UI 先问 `/capabilities`（PDF/Office/OCR 是否可用），**只显示真正能用的按钮**，杜绝"点了才报不支持" |
| **纯函数内核** | 目录树、预算裁剪、OOXML/RTF 解析、OCR 引擎链都是无副作用函数，可单测（**83 个测试**） |
| **路径围栏** | host 端所有文件操作都校验"必须在本会话工作区内"；子进程一律 `argv` 数组，不拼 shell |
| **显式截断** | 扫描上限、读取上限、预算截断、超大文件全部**明说**，不静默少文件 |
| **失败降级** | 缺 poppler 就不显示 PDF 按钮；host 版本落后会提示重启，而不是行为错位 |
| **跨平台** | docx/pptx/xlsx/rtf 用内置 ZIP+XML 解析（不依赖 macOS `textutil`）；OCR 三级链 Vision → tesseract → 内置 WASM；`reveal`/`zip` 按平台分支 |

## 平台支持

| 能力 | macOS | Linux | Windows |
|---|---|---|---|
| 扫描 / 打包 / 复制 / 同屏打开 | ✅ | ✅ | ✅ |
| **docx / pptx / xlsx / rtf 抽取** | ✅ 内置解析器 | ✅ 内置解析器 | ✅ 内置解析器 |
| 旧版二进制 `.doc` | ✅ textutil | ❌ 建议另存为 docx | ❌ 建议另存为 docx |
| PDF 抽取 | ✅ 需 poppler | ✅ 需 poppler | ✅ 需 poppler |
| **图片 OCR** | ✅ Vision（最快）→ 内置 WASM | ✅ 内置 WASM | ✅ 内置 WASM |
| 导出包打 zip | ✅ `zip` | ✅ `zip` | ✅ `Compress-Archive` |
| 在文件管理器中显示 | ✅ `open -R` | ✅ `xdg-open` | ✅ `explorer /select,` |

**OCR 开箱可用**：内置 `tesseract.js`(WASM) + 中文训练数据，Windows/Linux/macOS 都**无需安装**。
macOS 若可用会优先走系统 Vision（更快更准），否则自动退回 WASM。
代价：相关依赖安装后约 **+80MB**（`tesseract.js-core` 49MB + `chi_sim` 22MB + `eng` 14MB）。

**poppler 不在 npm 包里**（它约 200MB，仅 PDF 抽取需要）。装法任选：

```bash
brew install poppler                                      # 简单，但装到系统
# 或：装到任意目录（推荐，隔离）
conda create -y -p ~/.local/poppler -c conda-forge --override-channels poppler
export DSH_DUAL_BRIDGE_POPPLER=~/.local/poppler           # 指给插件
```

没有 poppler 时：点 PDF 会提示「未找到 PDF 抽取器」，DOCX 仍可用（macOS）。**扫描件/图片型 PDF 抽不出文字**——这类请直接把文件拖进网页版上传。

## 安装

### 前置

1. DSH ≥ 0.2.1-rc.2
2. **`dsh-better-sidebar`（必需）**：本插件的 Tab 由它提供宿主，未安装则插件不显示任何界面

### 从 npm 安装（推荐）

```bash
# 在 DSH web 的 Settings → Plugins → 从 npm 安装：
dsh-dual-bridge
```

或手动加入 profile：

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-dual-bridge dsh-better-sidebar
# 并把两者加入 package.json 的 dsh.profile.bundles
```

重启 `dsh web` 后生效（**host 端代码只在启动时加载**）。

### 本地开发安装

```bash
cd ~/.dsh/profiles/web
pnpm add link:/path/to/dsh-dual-bridge
```

## 使用

1. 打开侧边栏 **「⇄ 分流对话」**
2. 等扫描完成（顶部显示 `N 个可打包文件 · M 个目录`）
3. 展开目录、勾选要带的文件（勾目录 = 整棵子树）
4. 设 token 预算、选「超预算时」的策略
5. 点 **📦 打包选中文件** → 看预览 → **📋 复制到剪贴板**
6. 点 **🚀 同屏打开网页版** → 在网页版输入框 Cmd/Ctrl+V 粘贴 → 提问

### 关于 PDF / Office

- 二进制文件**不会**被当成代码打包；它们在树里置灰显示，可点「抽取文本」
- 抽取是**按需、逐个**的：不会因为选了七个 PDF 就把预算打爆
- 抽取结果带「已抽取 N 字 / 移除」，进入 prompt 的【抽取的附件文本】段
- 排版损失不可避免（双栏会串行、公式可能变乱码）。**保真度要求高就直接上传原文件**

### 为什么不能把网页版内嵌在页面里？

DeepSeek 网页版响应头声明：

```
content-security-policy: frame-ancestors 'none'
```

`'none'` 表示**任何站点都不允许 iframe 内嵌它**（Harness 自带的「内嵌浏览器」也会显示"拒绝了嵌入请求"）。
这是站点安全策略、由浏览器强制执行，前端无法绕过；唯一能绕过的办法是本地代理改响应头或浏览器扩展去 CSP —— 那既越界也不合理。

所以本插件用**同屏独立窗口**（贴在侧边栏右侧、自动聚焦）达到"并排、不用切标签"的效果。

## 隐私与合规

- **不联网**：扫描、打包、复制、抽取全部在本机完成；插件没有任何出站请求
- **不上传**：文件内容只进你的剪贴板，由你自己决定粘贴到哪里
- **不自动化**：不操控浏览器、不模拟点击、不调用网页版接口
- **抽取路由只在 localhost**：`POST /dual-bridge/extract` 挂在 DSH 已有的本地 web 服务上（不额外开端口），并限制只能抽取**当前会话工作区之内**的文件；`execFile` + argv 数组（路径不作为 shell 片段）
- 唯一的网络行为是「打开一个新的浏览器窗口指向 chat.deepseek.com」——由你的浏览器自己发起

## 已知限制

1. **依赖 `dsh-better-sidebar` 的内部路由**（`POST /sidebar/api/{session.cwd, fs.tree, fs.trees, fs.read}`）。
   这些接口不是公开 API，上游改字段本插件就会失效——已在 `dependencies` 中锁定版本。
2. **host 端改动需重启 `dsh web`**；client 改动刷新页面即可。
3. 子目录里嵌套的 `.gitignore` 不解析（只读项目根）。
4. 不跟随目录软链。
5. 扫描上限默认 2000 个文件（可在界面调整）；超大仓库建议把扫描范围收窄到子目录。
6. 抽取为纯文本，**丢失排版/表格/图片/公式结构**。
7. OCR 质量：macOS Vision > 系统 tesseract > 内置 WASM。WASM 对**排版规范的文档截图**较准，
   对**艺术字/宣传海报**容易出噪声——这类图建议直接上传原图让 AI 看图。
8. 首次 OCR 需初始化 WASM worker（约 0.3–1s），之后复用。

## 开发

```bash
npm install
npm run typecheck     # tsc --noEmit (strict)
npm run test          # node --test（59 个用例）
npm run build         # esbuild -> lib/index.js + lib/client.js
npm run verify        # 三条一起跑
npm run pack:check    # 检查 npm 包内容（确认不含 vendor/）
```

工程结构：

```
src/
  client.tsx        # client 入口：注册「分流对话」Tab
  DualBridgeTab.tsx # Tab UI：扫描/树/预算/打包/复制/抽取/同屏打开
  file-tree.ts      # 目录树纯逻辑（三态勾选、跳过统计）
  pack.ts           # 过滤规则、prompt 组装、预算裁剪、附件筛选
  split-window.ts   # 同屏窗口几何（纯函数 + 打开逻辑）
  api.ts            # 复刻 better-sidebar 的文件 API（fs.tree/fs.read 等）
  extract.ts        # host：PDF/Office 文本抽取（poppler / textutil）
  index.ts          # host 入口：注册 POST /dual-bridge/extract
scripts/build.mjs   # host ESM + client ModuleLoader(CJS) 双产物
```

> 本地调试 PDF 抽取时可以把 poppler 放在 `<repo>/vendor/poppler`（插件会自动探测），
> 但它**不会**被打包发布（`files` 白名单已排除）。

## License

MIT
