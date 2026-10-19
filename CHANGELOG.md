# 变更记录

## 0.13.0 — 2026-10-19

### 一个包装完即用

- `cordis.patch.yml` 现在同时挂载 `dsh-better-sidebar`（独立 id `dual-bridge-sidebar`）：用户不再需要单独安装或启用 sidebar。
- 已单独启用旧条目（id `better-sidebar`）的 profile 不会双挂：better-sidebar 自带的 `disabled` 表达式会检测到同名条目并自动停用旧条目。
- 安装命令收敛为一条：`dsh plugin --profile desktop add dsh-dual-bridge --allow-build=tesseract.js`。
- README 安装段重写，移除“先装 sidebar”的前置步骤。

### PDF 引擎自动发现

- 新增 `findPopplerBinary()`：探测顺序为 `DSH_DUAL_BRIDGE_POPPLER` → `PATH` → Homebrew → `/usr/local/bin` → conda 常见目录 → Windows `%LOCALAPPDATA%\poppler`。
- `capabilities` 与 `resolveExtractor` 共用同一探测逻辑；装完 poppler 即可用，不再需要手动 `export` 环境变量。
- Windows 的 `PATH` 查找同时尝试 `pdftotext.exe`。

### 兼容性

- DSH ≥ 0.2.1-rc.2；`dsh-better-sidebar` 固定 0.28.0。
- `--allow-build=tesseract.js` 仍建议保留：它只放行 OCR 引擎的 opencollective postinstall。

## 0.12.1 — 2026-10-19

### 修复「一条命令装不上」的静默失败：前置依赖必须显式安装

用户提了个好问题：只跑 `dsh plugin add dsh-dual-bridge`，别人会不会用不了？
查 DSH 的 `plugin-manager` 源码（从 app.asar 里读出 `reconcile()`）确认：**会**。

```js
const dependencies = Object.keys(after.dependencies ?? {})   // 只看 profile 的直接依赖
for (const name of dependencies) {
  const metadata = bundleManifest(name, dir, anchor)
  if (metadata?.dsh?.bundle === void 0) { /* 装了但不挂载 */ continue }
  if (!bundles.includes(name)) bundles.push(name)
}
```

- `dsh-better-sidebar` 是我们的 npm `dependencies`，会被装进 `node_modules`
- 但它**不在 profile 的直接依赖里** → 不进 `dsh.profile.bundles` → 它的 patch 不挂载
- 结果：**侧边栏整个不存在**，我们的 Tab 无处注册；且**不报错**

### 改动

1. **README 安装章节重写**：明确「先装 `dsh-better-sidebar`」，给出合并成一条的命令：
   ```bash
   dsh plugin add dsh-better-sidebar && dsh plugin add dsh-dual-bridge
   ```
   并解释为什么传递依赖不生效。
2. **host 启动诊断**：`apply()` 检测 `ctx.betterSidebar`，缺失时提前 `return` 并向 stderr 打印
   可操作提示（含要执行的命令），不再静默失败。
3. 版本三处同步到 `0.12.1`；`package.json` 描述注明安装前置。

### 验证

- `tsc` 0 错误；`node --test` **84 个**全过（新增 1 条：缺侧边栏时的提示与提前返回；
  并更新 host 路由注册测试：缺侧边栏时注册数为 0）


## 0.12.0 — 2026-10-18

### 针对 v0.11.0 验收日志的修复

豆包反馈 5 个问题。逐条核对后：**P0 的三条里，两条是"host 未重启导致新旧混跑"**，
另一条是真实缺陷（卡片渲染阶段）。已全部处理，并加了防再犯的机制。

| 编号 | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| BUG-1 (P0) | 导出包写到工作区而非桌面 | **运行中的 host 是 11:14 启动的，而 lib 是 14:10 构建的**（host 落后 3 小时），执行的是 0.10.0 的旧路径逻辑 | 代码本身已是 0.11.0 的"桌面"逻辑（实测 `lib` 新代码正确）；**新增 host 版本上报 + 客户端不一致提示**，同类问题下次会被立刻发现 |
| BUG-2 (P0) | 勾 clip.zip 却导出 pic_plain.png | 客户端 `binarySelected` 只取"被勾选且未抽取"的不可识别文件，逻辑正确；旧 host 不影响筛选（entries 由客户端计算） | 无法在当前代码复现；**卡片新增「本次导出：a、b、c」清单**，用户可直接核对，便于下次定位 |
| BUG-3 (P0) | 预览阶段看不到导出包卡片 | 卡片只写在"已复制"阶段，预览阶段确实没有 | **抽出 `bundleCard`，预览 + 已复制两个阶段都渲染** |
| BUG-4 (P2) | 再点"同屏打开"新开窗口 | 插件只追踪"自己打开的"窗口；手动开的窗口无名字可复用 | 行为符合预期；已在测试文档 J2 写明预期（只复用插件自己开的窗口） |
| BUG-5 (P2) | 4MB 的 big.txt 被跳过但没单独提示 | 该文件排在 500 个读取上限之外，根本没被读取，所以不计入"超 3MB" | 上限提示补充「其中可能含超大文件；建议缩小勾选范围或分批打包」 |

### 防再犯机制

1. **`HOST_BUILD` 版本上报**：`GET /dual-bridge/capabilities` 现在返回 `hostBuild`；
   客户端与自身 `BUILD_VERSION` 比对，不一致就在顶部显示琥珀提示
   「host 端为 vX、界面为 vY…请重启 dsh web 后再测」。
   单测强制三处版本一致（`package.json` = `HOST_BUILD` = `BUILD_VERSION`），漂移会直接红。
2. **`dsh-pack-*` 加入忽略列表**：导出目录永远不会被扫回文件树，杜绝"自污染循环"。
3. **卡片列出导出清单**：「本次导出：clip.zip、pic.png…」最多 8 个，错包一眼可见。

### P3 一并修掉

- **提示残留**：新增 `backToSelect()`，返回选择态时清空 `packNotice` / `bundleInfo` / `error`。
- **预览"（超预算）"误显示**：改用 `result.overBudget` 布尔量，不再依赖可能残留的 `error` 文本。
- **计数口径**：显示改为 `已选 X / Y 文本 · Z 个附件`，二进制勾选不再"分子分母都不动"。
- **搜索范围**：搜索现在覆盖不可识别附件（右侧标「附件」），`t.docx` / `pic.png` 都能搜到。

### 验证

- `tsc` 0 错误；`node --test` **82 个**全过（新增 5 条：三处版本一致、`dsh-pack-*` 排除、
  卡片两阶段渲染、搜索覆盖附件、host 版本提示）
- 构建：`lib/index.js` 39KB（含 HOST_BUILD）、`lib/client.js` 含 `0.12.0` / 「本次导出：」/ 重启提示

> ⚠️ 本次改了 host（capabilities 增加 hostBuild），**必须重启 `dsh web`**；
> 重启后徽章与 `hostBuild` 都应是 `0.12.0`，若不出现琥珀提示即说明版本已对齐。


## 0.11.0 — 2026-10-18

### UI：完成态从"深绿填充"改为"绿色细边框"

旧样式是整块 `#14532d` 深绿底 + 浅绿字，在侧边栏里非常刺眼、对比度也差。
现在：

- 背景透明，`1px` 绿色边框 + `3px` 左侧强调条（`--dsw-alias-state-success-primary`）
- 标题用主题的 success 色，正文恢复 `label-primary`（跟随深浅主题）
- 内部「导出包」块保留自己的浅底，不再被绿底压住

### 修复：「提取文字」按钮消失

**根因**：客户端挂载时请求 `GET /dual-bridge/capabilities` 决定按钮显隐；
当 host 还没加载新路由（未重启）时该请求 405 → `caps` 保持 `null` →
`convertAction().ok` 全为 false → **PDF/Office/图片的按钮集体消失**。

**修法**：`caps === null`（未探测到/探测失败）时**乐观显示按钮**，
等能力探测成功后再按真实能力收敛。这样 host 版本落后时也不会"功能凭空不见"。

同时按钮文案统一为 **「提取文字」**（PDF / Word / PPT / Excel / RTF），
图片仍叫「OCR 文字」，tooltip 说明各自用的引擎。

### 变更：不可识别文件导出到**桌面**，目录内只含这些文件

- `defaultBundleRoot()` = `~/Desktop`（不存在则退回 `~`）
- 导出目录 `~/Desktop/dsh-pack-<时间戳>/` 内含：**仅被选中的不可识别文件**（保持相对目录结构）+ `附件清单.md`
- 不再污染会话工作区；`open -R` 放行 `dsh-pack-*`（因为它在工作区之外）
- 实测：传入 1 个 png → 目录内 `img.png` + `附件清单.md`，未传入的文件不会出现

### 使用规则同步重写（5 条）

1. 勾选文件/目录 →「📦 打包选中文件」= 把**可读文本**提取到剪贴板（纯本地，不上传）
2. Word/PPT/Excel/RTF/PDF 点**「提取文字」**、图片点**「OCR 文字」**，提取结果也会进剪贴板
3. 「🚀 同屏打开网页版」→ 网页版输入框 **Cmd/Ctrl+V** 粘贴并提问（免费）
4. 无法识别的文件（视频/压缩包等）自动打包到**桌面 dsh-pack-时间戳/**，里面只有这些文件 + 清单，拖进网页版上传即可
5. 需要改代码 / 复杂推理时，回 Harness 走 API（计费）

### 验证

- `tsc` 0 错误；`node --test` **77 个**全过（新增 2 条：导出包只含传入文件、默认落在桌面）
- **真实 docx 端到端**（走构建后的 host 路由）：
  `综合素质测评计分细则.docx` → engine `zip-xml`，**17,241 字**，首行正确；
  `strategy.docx` → **4,278 字**

> ⚠️ 本次改到 host（导出位置 + reveal 放行），需重启 `dsh web`。


## 0.10.0 — 2026-10-18

### OCR 跨平台化：内置 WASM 引擎（不再依赖 macOS 原生能力）

用户指出「插件要跨平台通用，依赖原生 OCR 不可行」。本轮把 OCR 改成**三级引擎链**：

```
1. vision    macOS 内置 Vision（零安装、最快、质量最好）→ 仅 mac，作为加速
2. tesseract 系统安装的 tesseract（跨平台，若用户已装）
3. wasm      内置 tesseract.js + chi_sim/eng 训练数据（零安装、离线、三平台保底）
```

- 新增依赖：`tesseract.js@7`、`@tesseract.js-data/{chi_sim,eng}`（安装后约 **+80MB**）
- **完全离线**：训练数据随包安装，运行时汇总到
  `~/Library/Caches/dsh-dual-bridge/tessdata`（Windows 用 `%LOCALAPPDATA%`），不走 CDN
- worker 懒加载单例：创建 ~0.3–1s，之后复用
- `chooseOcrEngines()` 抽成纯函数并单测；`capabilities.ocr` 返回链首引擎，
  Windows/Linux 默认 `wasm` → **开箱可用**
- 构建：`tesseract.js` 标记 external（运行时从 node_modules 解析，不打进 38KB host bundle）
- 依赖解析加回退（插件包内 → cwd），兼容 pnpm hoist 与单测打包场景

### 实测（这台 mac）

| 引擎 | 筹备 | 单张耗时 | 质量 |
| --- | --- | --- | --- |
| Vision | 首次编译 Swift 3.3s（缓存后 0） | **300ms** | 最好（宣传图 187 字全对） |
| 内置 WASM | worker 346ms（复用） | **~1.2s** | 文档截图可用；艺术字/宣传图有噪声 |

### 验证

- `tsc` 0 错误；`node --test` **75 个**全过（新增 2 条：引擎链顺序、WASM 依赖可解析）
- WASM 离线实测：worker 346ms → 识别 1.2s，训练数据全部来自本地 langPath
- README 平台矩阵重写：docx/pptx/xlsx/rtf 与 OCR 三平台一致

> ⚠️ 本次修改了 host 端，需重启 `dsh web` 才生效。


## 0.9.0 — 2026-10-18

### 跨平台改造：移除对 macOS 原生能力的依赖

用户指出「插件要跨平台通用，依赖原生 OCR 不可行」——这是对的。本轮把**所有
macOS 独有的依赖**都换成了跨平台实现（OCR 的取舍单独确认，见下）。

| 能力 | 旧实现（mac 专属） | 新实现（跨平台） |
| --- | --- | --- |
| docx 抽取 | macOS `textutil` | **内置 ZIP+XML 解析器**（`node:zlib`，零依赖） |
| pptx 抽取 | macOS `textutil` | 同上，按 slide 分节 |
| xlsx 抽取 | 不支持 | 同上，共享字符串 + 单元格还原 |
| rtf 抽取 | macOS `textutil` | **内置 RTF 分组扫描器**（跨平台） |
| 在文件管理器中显示 | `open -R`（仅 mac） | mac `open -R` / win `explorer /select,` / linux `xdg-open` |
| 导出包打 zip | `/usr/bin/zip` | POSIX `zip` / windows `Compress-Archive` |
| 路径围栏 | 区分大小写 | Windows 下大小写不敏感比较 |

**新增 `src/office-zip.ts`**：手写 ZIP 容器读取（EOCD + 中央目录 + store/deflate）
与 OOXML 文本抽取。这样 Windows/Linux 用户**不装任何东西**就能抽取
docx/pptx/xlsx/rtf；macOS 的 `textutil` 退化为**可选加速**（覆盖旧版二进制 .doc）。

**旧版 `.doc`（二进制）**仍需要 `textutil` 或 LibreOffice，错误提示已改为
「建议先另存为 .docx（跨平台可直接抽取）」。

**能力探测同步更新**：`office` 现在恒为 `true`，并新增 `officeEngine`
（`zip-xml` / `textutil`），客户端据此展示。

### 验证

- `tsc` 0 错误；`node --test` **73 个**全过
  （新增 6 条：ZIP 目录/读取、docx 段落、pptx 分页、xlsx 共享字符串、
  RTF 分组剥离、XML 实体解码）
- 产物核对：`lib/index.js` 内含 Office 解析器、Windows `explorer` 分支、
  `Compress-Archive` 分支
- RTF 解析改为**分组扫描**（旧的正则剥离会把字体表里的 `Helvetica` 当正文输出）

### OCR 仍是待确认项

- 现状：优先 macOS Vision（零安装但**仅 mac**），其次系统 tesseract，都没有则不显示按钮
- 要实现"Windows/Linux 也开箱可用"，只能二选一：
  - **内置 WASM OCR**（tesseract.js + chi_sim 训练数据，约 **+51MB** 包体积，零安装、离线）
  - **依赖系统 tesseract**（0 体积，每个平台各装一次）


## 0.8.0 — 2026-10-18

### 新能力：所有文件可勾选 + 自动导出包 + 图片 OCR

用户希望「保住喂复杂文件的核心竞争力」：全是可抽取内容时直接喂文本；选中图片等
无法文本化的文件时，程序应自动识别并给出一个便于 AI 读取的产物。

**先纠正一个技术前提**：zip 只是运输容器，网页 AI **不会解析 zip 内部**；
而图片要 AI 读懂，必须作为**图片附件上传**（本插件不能替你上传）。
所以最终设计成"两件产物"，而不是"打一个 zip 让 AI 读"。

**① 所有文件都可勾选**

- 文本文件 → 进剪贴板 prompt
- 已抽取/已 OCR 的文件 → 进 prompt 的【抽取的附件文本】段
- 其余二进制（图片/视频/压缩包/未抽取的 PDF）→ **自动进导出包**

**② 导出包（`src/bundle.ts` + `POST /dual-bridge/bundle`）**

- 目录：**会话工作区内** `dsh-pack-YYYYMMDD-HHmmss/`，保持相对目录结构
- 内含 `附件清单.md`（纯文本，本身就是"一个便于 AI 读取的文件"）：
  文件表格 + 每个文件的建议（图片→作图片上传；PDF→上传原文件；视频→无法解析，建议截图）
- 可选再打 `dsh-pack-*.zip`，清单里明确写「AI 不解析 zip 内部，请解压后上传」
- UI：结果块显示目录路径 + 「在访达中显示」（`open -R`）+ 「复制目录路径」
- 围栏：所有路径必须落在会话工作区内（`isInsideWorkspace`）

**③ 图片 OCR（`src/ocr.ts` + `POST /dual-bridge/ocr`）**

用户问"有没有更轻量的 OCR"——有：**macOS 内置 Vision 框架**，
通过一个内嵌 Swift 脚本调用，**零安装、零额外体积**，中文识别质量通常优于 tesseract。

- 首次调用自动 `swiftc` 编译到 `~/Library/Caches/dsh-dual-bridge/ocr-vision`，
  之后直接执行：实测 **300ms/张**（编译期首跑 3.3s）
- 引擎链：Vision → tesseract（若自装）→ 无 OCR（返回结构化错误）
- 实测：`screenshot.png` → 187 字中文，逐行准确
- 图片因此也获得「OCR 文字」按钮，抽出的文字同样进 prompt

**④ 能力探测（`src/capabilities.ts` + `GET /dual-bridge/capabilities`）**

客户端挂载时问一次"这台机器能做什么"，按钮按结果渲染：

| 文件类型 | 按钮 | 条件 |
| --- | --- | --- |
| PDF | 抽取文本 | 有 poppler / 系统 pdftotext |
| doc/docx/rtf/html | 抽取文本 | macOS textutil |
| 图片 | OCR 文字 | Vision 或 tesseract |
| 其它 | 不显示 | 只能走导出包 |

彻底消除"点了才报不支持"的误导（用户此前明确反馈过）。

### 路由总览（host）

```
GET  /dual-bridge/capabilities
POST /dual-bridge/extract
POST /dual-bridge/ocr
POST /dual-bridge/bundle
POST /dual-bridge/reveal
```

### 验证

- `tsc` 0 错误；`node --test` **67 个**全过
  （新增 5 条：图片/可转文本判定、清单生成与 KB/MB 格式化、目录名、导出包接线）
- 实测：能力探测 `{pdf:false, office:true, ocr:'vision'}`；
  OCR 200/vision/187 字，二次调用 **300ms**；
  导出包生成 `dsh-pack-…/`（note.rtf + screenshot.png + 附件清单.md + zip），
  越界路径 `outside-workspace` 被拒
- 产物：5 条 host 路由全部编译进 `lib/index.js`；client 含「OCR 文字/导出包/导出 zip/在访达中显示」

> ⚠️ 本次**新增了 host 路由**，必须重启 `dsh web` 才生效（client 刷新即可）。


## 0.7.2 — 2026-10-18

### UI 优化：移除无关徽章，顶端增加「使用规则」

- **删除**标题旁的「半自动 · 合规」徽章（以及原来的 subheader 一行），
  版本徽章保留（用于确认刷新是否生效）。
- **新增顶端「使用规则」区块**（4 条，贴在标题下第一个位置）：

  1. 勾选文件/目录 →「📦 打包选中文件」= 把内容**提取到剪贴板**（纯本地，不上传）
  2. 「🚀 同屏打开网页版」→ 在网页版输入框 **Cmd/Ctrl+V** 粘贴并提问（免费）
  3. 需要改代码 / 复杂推理时，回 Harness 走 API（计费）
  4. 勾目录 = 含其下所有文本文件；PDF / Office 先点「抽取文本」再打包

  样式沿用 DSH 主题令牌（`label-primary/secondary`、`interactive-bg-hover`、`border-l1`），
  并加 `flexShrink: 0` 防压缩；11px 字号 + 16px 行高，窄侧边栏也不挤。

测试：`tsc` 0 错误；`node --test` **62 个**全过（新增 1 条：规则存在 + 徽章已清除）。


## 0.7.1 — 2026-10-18

### 完善：抽取后的可选状态、单独打包、以及"不给不可抽取的文件显示按钮"

用户反馈三点，全部修掉：

**① 抽取后文件应从灰色（不可选）变为可选**

之前抽取完只是加了个"已抽取"标签，行仍是灰色、勾选框仍禁用。
现在：**抽取成功即自动勾选**，行文字用正常主色，勾选框启用 —— 灰 → 可选。

**② 单一文件抽取后可以直接打包**

根因：`打包选中文件` 按钮的启用条件是 `selectedCount > 0`，而 `selected` 只统计
"可读文本文件"，抽取结果不算在内 → 只抽了一个 PDF 时必须再勾一个普通文件才能点。
现在：

- 抽取成功会把该文件加入 `selected`，按钮立刻可用；
- 打包时只带**被勾选**的抽取结果（`selectedExtracted`），取消勾选则回到"仅缓存"状态；
- 「全选」也包含已抽取项；「移除」会同时取消勾选；
- 目录树用 `included + selectedExtracted` 构建，只打包一个抽取文件时结构段不再为空。

**③ 不再给不可抽取的文件显示「抽取文本」**

图片（png/jpg）、音视频（mov）、压缩包（zip）、Office 表格（xlsx）等**没有文字层**，
本插件不做 OCR，之前仍显示按钮 → 点了才报"不支持"，属于误导。

现在：

- 新增 `src/extractable.ts` 作为 **host / client 共用的唯一判定**
  （`.pdf` + `doc/docx/rtf/rtfd/html/htm/odt/wordml/webarchive`）；
  `extract.ts` 改为引用它，消除两套规则漂移的风险；
- 非可抽取类型**不渲染按钮**，只在文件名 tooltip 说明
  「图片/音视频/压缩包没有文字层，无法抽取；请直接把文件上传到网页版」。

### 验证

- `tsc` 0 错误；`node --test` **61 个**全过
  （新增 2 条：可抽取判定矩阵 png/jpg/mov/zip/pptx/xlsx 为 false；
  按钮受判定约束 + 抽取后自动选中 + 只打包已勾选项 + 全选含抽取项）
- 构建：`lib/client.js` 65,360 bytes，`0.7.1`

> PS：`src/extract.ts` 属于 host，本次改动含"缺 poppler 的提示文案"，
> 需重启 `dsh web` 才生效；其余 UI 行为刷新页面即可。


## 0.7.0 — 2026-10-18

### P1 融合：只保留一个 Tab（同屏打开并入，答案回收下线）

按用户决定：「尽可能把网页对话里简单的功能合并进分流对话，只添加打开网页版同屏窗口的功能，答案回收功能弃掉」。

- **删除** `src/WebChatTab.tsx`、`src/session-input.ts`（答案回收 / 草稿写入整套能力）；
  同步移除 9 个相关测试用例。
- **删除** `web-chat` Tab 注册：侧边栏现在只有 **「⇄ 分流对话」** 一个入口。
- **保留并强化** 同屏窗口：复制成功后，`copied` 阶段直接提供
  **🚀 同屏打开网页版**（`split-window.ts` 不变：贴右侧、自动聚焦、重复点击只聚焦不刷新），
  并给出打开结果提示（成功 / 被弹窗拦截）。
- `client.tsx` 的 Tab 描述更新为"打包并复制，一键同屏打开网页版粘贴提问"。

### P2 发布预备（目标：可 `npm publish`）

| 项 | 处理 |
| --- | --- |
| `private: true` | 移除 |
| `license` | 新增 MIT + `LICENSE` 文件 |
| 包内容 | 新增 `files` 白名单（`lib/ src/ cordis.patch.yml README CHANGELOG LICENSE`），**排除 `vendor/` 与 `node_modules/`** |
| `keywords` | 增加 `dsh` / `dsh-plugin` / `deepseek` 等（便于索引扫描） |
| 脚本 | 新增 `pack:check`（`npm pack --dry-run`）与 `prepublishOnly`（发布前自动 `verify`） |
| poppler 解耦 | 发布版不携带 poppler；`extract.ts` 在缺少抽取器时给出**可操作指引**（brew / conda + `DSH_DUAL_BRIDGE_POPPLER`） |
| README | 全新撰写：功能、平台支持矩阵、安装前置（**必须已装 `dsh-better-sidebar`**）、使用流程、PDF 抽取与 poppler、隐私与合规、已知限制、开发命令 |

### 验证

- `tsc` 0 错误；`node --test` **59 个**全过（68 → 59，删除 9 个回收相关用例）
- 构建产物：`lib/index.js`（host，含 `/dual-bridge/extract`）+ `lib/client.js`
- 包内容核对：**22 个文件 / 84.5 kB（解包 272.6 kB）**，
  含 `cordis.patch.yml`、`lib/client.js`、`lib/index.js`、README/LICENSE/CHANGELOG，
  **不含 `vendor/`**（poppler 183MB 留在本地）

### 发布还差什么

1. `npm login` 后 `npm publish`（需要你的 npm 账号凭据，我无法代做）
2. 想进市场索引：建 GitHub 仓库（**必须提交 `lib/`**，市场安装不跑构建）+ `dsh-plugin` topic
3. 发布后在一个干净 profile 里装一遍验收（扫描 / 打包 / 抽取 / 同屏打开）


## 0.6.3 — 2026-10-18

### 新增：「含附件声明」开关（默认关闭）

上一版把附件声明压到"同目录 6 条"，用户确认还要能**完全关掉**。

- 控件区新增复选框 **含附件声明**，**默认不勾选** = prompt 里完全不出现附件段，最干净。
- 勾选后才走 `selectRelevantAttachments`：只列与所选文件同目录的附件（上限 20 条），
  没有同目录附件时退化为一句汇总。
- 侧边栏 📎 附件面板保留（它是浏览/复制路径用的，与是否写入 prompt 无关），
  并明确提示当前状态：
  「未写入 prompt（如需让模型知道这些附件，请在上方勾选「含附件声明」）」
  / 「已勾选…打包时会把同目录下的附件列进 prompt」。

测试：`tsc` 0 错误；`node --test` **68 个**全过（新增 1 条：开关存在且默认关闭、
必须受开关控制）。


## 0.6.2 — 2026-10-18

### 修复：prompt 里塞进几百条无关附件路径（严重冗余）

**现象**（用户反馈）：只打包了 1 个文件 + 1 个抽取附件，粘到网页版后却发现
【未包含的附件】里有几十上百行路径，各个文件夹的名字全来了。

**根因**：0.5.0 引入附件声明时，把扫描到的**全部**被跳过二进制文件
（上限 300 条）都写进了 prompt，与所选文件数量完全不成比例：
实测你机器上这段清单有 **12,698 字符**。

**修复**：

1. **只列与所选文件同目录的附件**（`pack.ts#selectRelevantAttachments`）：
   打包 `docs/个人陈述.rtf` 时，只列出该目录下的 `.doc/.docx/.pdf`，
   `ai/`、`coding/` 等其它目录的一律不列。
2. **硬上限 20 条**（`MAX_ATTACHMENT_LINES`），超出显示
   `- …同目录另有 N 个未列出`。
3. **没有同目录附件时什么都不列**，只留一句汇总：
   `本工作区另有 N 个 PDF / Office / 图片等二进制文件未包含在上下文中`
   —— 保留信息量，但不再刷屏。
4. **已抽取的文件不再出现在"未包含"里**（`excludePaths`），避免自相矛盾。
5. 打包提示里会说明 `prompt 内附 N 条同目录附件声明`，便于核对。

**实测对比**（真实文件系统）：

| | 旧版 | 新版 |
| --- | --- | --- |
| 附件清单条数 | 300 条（全部） | **6 条**（同目录） |
| 该段字符数 | ≈ 12,698 | ≈ 400（含整份 prompt） |

测试：`tsc` 0 错误；`node --test` **67 个**全过
（新增 5 条：同目录筛选 / 超限截断 / 无同目录不列 / 有清单 vs 仅汇总 /
已抽取排除）。


## 0.6.1 — 2026-10-18

### 修复：附件面板文字重叠挤压

**现象**（用户截图）：`未包含的附件：488 个` 面板下，多条文件名上下重叠、字被压扁。

**根因**：`root` 是 `height: 100%` 的 flex 列容器，子元素默认 `flex-shrink: 1`。
当内容总高超过容器高度时，浏览器**压缩每个子块**而不是让容器滚动 ——
行高被压塌，相邻行文字就叠在一起了。附件面板一出现（多了一整块），
把总高推过了阈值，于是整列开始互相挤压。

**修复**：
- 给 19 个直接子块样式补 `flexShrink: 0`（headerRow / error / notice / infoBox /
  status / controls / fileList / attachBox / attachHead / attachList / attachItem /
  previewBox / previewText / copiedBox / steps / hint / treeHead / treeRow / fileRow /
  previewTitle），让容器**滚动**而不是压缩；
- `attachItem` 显式 `lineHeight: '16px'`（11px 字号不再被压）；
- `attachList` 最大高度 120→160、`paddingRight: 4`（给滚动条留位）、间距 2→3。

### 澄清：之前的 HTTP 405 不是代码 bug

`POST /dual-bridge/extract` 返回 405 是因为 **host 端代码需要重启 dsh web 才加载**
（DSH 官方文案："请重启 DSH 使更改生效 —— 更改涉及 DSH 自身已加载的模块"）。
重启后实测：

| 请求 | 结果 |
| --- | --- |
| `POST /dual-bridge/extract`（空 body） | 400 `缺少 cwd 或 path` ← handler 已生效 |
| 抽取 `docs/个人陈述.rtf` | **200，textutil，1,144 字，首行"个人陈述"** |
| 抽取 `/etc/hosts`（越界） | 400 `outside-workspace`（被围栏拒绝） |


## 0.6.0 — 2026-10-18

### 新增：按需文本抽取（PDF / Office）—— 首个 host 端能力

用户确认：加 host 端抽取 + poppler 装进插件目录 + 树里点按钮按需抽。

**架构变化**：插件从"纯前端"变成"前端 + 本地 host"。

- `src/index.ts`（host）：`inject = ['webServer']`，注册
  `POST /dual-bridge/extract`（`ctx.webServer.register({kind:'exact', ...})`），
  挂在 DSH 已有的本地 web 服务上，**不额外开端口**。
- `src/extract.ts`（host 抽取核心，纯逻辑 + spawn）：
  - `.pdf` → 插件内置 `vendor/poppler/bin/pdftotext -layout -enc UTF-8`
    → 回退系统 PATH 上的 pdftotext
  - `.doc/.docx/.rtf/.html/...` → macOS 自带 `/usr/bin/textutil -convert txt -stdout`
  - 安全：`isInsideWorkspace()` 前缀围栏（挡 `../` 与相对路径）、
    `execFile` + argv 数组（不走 shell）、20s 超时、50MB 输入上限、
    200k 字符输出上限、请求体 16KB
  - 失败结构化返回 10 种错误码（outside-workspace / no-extractor /
    empty / timeout / unsupported …），绝不抛穿
- `src/file-tree.ts`：二进制文件现在**建出节点**（`binary: true`），
  不可勾选打包，但行尾有「抽取文本」按钮
- `src/DualBridgeTab.tsx`：`runExtract` → 调路由 → 显示
  「已抽取 N 字 / 移除」；抽取结果作为
  【抽取的附件文本（本地抽取，可能有排版损失）】段落并入 prompt，
  并计入 token；重新扫描会清空抽取缓存
- `tsconfig.check.json`：`types: ["node"]`；新增 devDependencies
  `@types/node / esbuild / typescript / @types/react`
  （npm 曾把未声明的工具当 extraneous 删掉，现已正式声明）

**poppler 安装位置**（按用户要求，不进系统）：

```bash
conda create -y -p <pkg>/vendor/poppler -c conda-forge --override-channels poppler
```

- 实测 183MB，依赖全部隔离在该前缀内，删目录即卸载
- 可用 `DSH_DUAL_BRIDGE_POPPLER=/path` 覆盖

### 实测

| 文件 | 引擎 | 结果 |
| --- | --- | --- |
| `人工智能程序设计A（2019级）(1).pdf` | poppler 26.09.0 | ✓ 13,160 字 / 118ms |
| `2020年六月真题.docx` | textutil | ✓ 2,472 字 / 81ms |
| `/etc/passwd`（越界） | — | ✓ 被拒绝 outside-workspace |

**路由级测试（不启服务）**：把 handler 导出为 `handleExtractRoute`，用最小的
req/res 假对象覆盖：非 POST→405、坏 JSON/缺字段→400、越界→400 outside-workspace、
正常抽取→200 + text + `content-type`。另验证 host 模块可被 node 直接加载
（`name / inject / ROUTE_PATH / apply` 齐全）、无 `webServer` 时 `apply` 安全空转、
有 `webServer` 时恰好注册一条 `exact /dual-bridge/extract`。

**安全模型**（与宿主对齐后的说明）：DSH 的插件路由统一处于**浏览器信任围栏**
（browser-trust fence）之后，跨源网页无法调用；better-sidebar 已刻意移除工作区
围栏（其 fs 路由可达宿主用户可达的任意路径）。本插件在此之上**额外**保留
`isInsideWorkspace()` 前缀校验，比宿主更严格。

测试：`tsc` 0 错误；`node --test` **62 个**全过（新增 10 条：路径围栏、
引擎解析、文本清洗、真实 spawn textutil 端到端、路由 4 条、模块导出与 apply 行为、
客户端接线护栏）。

> ⚠️ **host 端代码不能被热加载**：本次改动必须重启 `dsh web` 才生效
> （client 部分刷新页面即可）。


## 0.5.0 — 2026-10-18

### 新增：二进制附件的「声明 + 引导上传」（方案 A + C）

**背景**：PDF / Office / 图片无法作为文本打包，之前只是静默跳过数量，模型不知道
"有但没给"，用户也不知道漏了什么。

**A. prompt 增加【未包含的附件】段落**（`pack.ts#assemblePrompt` 第 4 个参数）

```text
【未包含的附件（无法作为文本读取）】
以下文件存在于工作区，但属于 PDF / Office / 图片等二进制格式，内容未包含在本次上下文中：
- 真题全册（自总结）/数字电子技术（人智少学）/2021年六月期末/xxx.pdf
- 真题全册（自总结）/数据结构与算法（专业课）/数据结构刷题册.doc
如需分析这些文件，请提示用户在对话中直接上传原文件。
```

作用：模型知道上下文缺口，不会把"没给"当成"不存在"而瞎猜；也不会把
PDF 误当成可读代码块。

**C. 侧边栏附件清单 + 复制路径 + 上传引导**

- 扫描时额外记录被跳过的**具体文件**（`MAX_SKIPPED_LISTED = 300` 上限）；
- 「⇄ 分流对话」新增 📎 附件面板：显示前 12 个 + 总数，提供「复制全部路径」
  （绝对路径，便于 Finder 定位/拖拽）；
- 面板内直接写明最佳做法：**把文件拖进 DeepSeek 网页版输入框**，原生解析比
  抽文本更准（公式/表格/排版都保留）。

### 下一步（待用户确认后才做）

按需抽取（树里对单个 PDF/DOCX 点「抽取文本」）需要**新增 host 端代码**：
本地 `spawn` 系统命令（`textutil` / `pdftotext`）＋一个本地路由，浏览器端 fetch。
需先确认可接受此架构改动，且 PDF 需要本地 poppler（建议用 conda 前缀装进插件目录）。

### 验证

- `tsc` 0 错误；`node --test` **52 个**全过（新增 3 条：附件段落生成/缺省不生成、
  附件引导接线）
- 版本徽章同步 **0.5.0**


## 0.4.1 — 2026-10-18

### 修复：打包环节的四处缺陷（用户提问「打包选中文件的逻辑是什么」引出）

**① 500 个读取上限静默截断**

`if (contents.length >= MAX_READ_FILES) break` 不计入任何提示 —— 与 0.4.0 修掉的
"300 扫描上限"是同一类问题。现在会明确上报：
`已选 N 个，单次最多读取 500 个，其余 M 个未处理`。

**② 串行读取 → 并发读取**

原来 `for` + `await fs.read` 逐文件串行，500 个文件就是 500 次往返。
现在按 `READ_CONCURRENCY = 8` 分批 `Promise.all`，结果按候选下标回填以保持顺序；
单个文件失败不影响整批（计入 `N 个文件读取失败`）。

**③ token 预算从"只提示"变成可选策略**

新增「超预算时」下拉：`只提示`（原行为，默认）/ `按预算截断`。
截断逻辑抽成纯函数 `pack.ts#applyBudget`：预留目录树与模板开销后**贪心填充**
（装不下的跳过、继续尝试后面更小的文件），被丢弃的文件在预览里逐个列出。
CLI 版（deepseek-bridge-demo）与本插件现在语义一致。

**④ 清理**：删除死变量 `totalBytes`；`setPhase('preview')` 只设一次；
`buildTreeText` 接受只读数组。

### 关于 PDF/Office 等非文本文件

当前仍**只声明跳过数量**（`跳过 N 个二进制文件`），不抽取内容。
是否引入本地文本抽取（PDF/DOCX）需要单独确认依赖与架构改动，见下一版讨论。

### 验证

- `tsc` 0 错误；`node --test` **49 个**全过
  （新增 4 条：applyBudget 预算充足/贪心裁剪/预算过小、以及“并发读取 + 截断必须上报”护栏）
- 版本徽章同步 **0.4.1**


## 0.4.0 — 2026-10-18

### 修复：文件夹里的文件"没显示"（两个独立原因）

**反馈**：「真题全册（自总结）文件没有全部显示，好多文件并没有在侧边栏找到。」

**实测定位（两个原因叠加在一起）**：

**原因 1 — 扫描上限写死 300，静默截断**

- 工作区 `~/Desktop` 实际有 **180,066 个文件 / 21,306 个目录**；
- 而 `MAX_FILES = 300`，扫到 300 个可打包文件就 `reachedLimit = true` 停止遍历，
  **后面的目录根本不会被访问**，且界面不给任何提示 —— 看起来就是"文件凭空消失"。

**原因 2 — 该目录 39 个文件里只有 2 个是文本**

实测该目录的文件构成：

| 类型 | 数量 | 是否可打包 |
| --- | --- | --- |
| png / jpg | 16 | ❌ 二进制 |
| pdf | 7 | ❌ 二进制 |
| doc / docx | 6 | ❌ 二进制 |
| .DS_Store | 8 | ❌ 系统垃圾 |
| txt / html | **2** | ✅ |

也就是说：即便扫描不截断，这个目录也只有
`数字电子技术（人智少学）/简答题汇总.txt` 与
`大学语文（公共课）/助记网页/期末语文必背必记网页.html` 两个文件能进包。
（PDF/Word 是二进制，无法作为文本上下文打包——这是打包器的固有边界。）

### 修复内容

1. **扫描上限可配置**：`500 / 2000 / 10000 / 不限` 下拉选择（默认 **2000**），
   切换后立即用新上限重扫。
2. **上限触发时显式提示**：`已达扫描上限 N 个文件，仅列出前 M 个；提高上限后可重新扫描`。
3. **宿主目录截断也要提示**：`fs.trees` 返回的 `level.truncated` 现在会被统计并提示
   （`N 个目录的条目被宿主截断，其中可能有文件未列出`）。
4. **每目录跳过统计 + 空目录可见**：扫描时按目录统计"因类型被跳过"的文件数，
   - 目录右侧 tooltip 显示 `另有 N 个文件因类型被跳过`；
   - **整目录都是 PDF/图片的文件夹不再消失**，而是置灰显示并标注「不可打包 N」，
     勾选框禁用 —— 用户终于能看见"这个文件夹存在，只是内容不是文本"。
5. **树头汇总**：`X 个可打包文件 · Y 个目录（默认折叠） · 跳过 Z 个非文本文件`。
6. 打包读取上限独立为 `MAX_READ_FILES = 500`（防止误选上千文件时长时间卡读）。

### 验证

- 离线探针（真实文件系统、模拟新扫描逻辑、上限 2000）：
  **536 个目录 / 704 个可打包文件 / 38ms / 未触发上限**，
  目标目录的两个文件均被扫到：
  `真题全册（自总结）/数字电子技术（人智少学/简答题汇总.txt`、
  `真题全册（自总结）/大学语文（公共课）/助记网页/期末语文必背必记网页.html`
  （旧版 300 上限时根本走不到这里）
- `tsc` 0 错误；`node --test` **45 个**全过（新增 2 条：跳过统计与空目录可见、
  禁止再写死 300 上限）
- 版本徽章同步 **0.4.0**


## 0.3.1 — 2026-10-18

### 修复：文字发灰、不够显眼（改用 DSH 设计令牌）

**反馈**：「将文件展示目录的文件字颜色加深，目前的文字色彩太灰了，不够显眼。」

**根因**（比"颜色浅"更根本）：插件把颜色**写死成了深色主题的灰**：

| 用途 | 旧值 | 问题 |
| --- | --- | --- |
| 主文字（文件名/目录名/标题） | `#e2e8f0` | 浅灰，深色主题下不够醒目 |
| 次要文字（计数/提示/说明） | `#94a3b8` | 更灰 |
| 语言标签 / 目录计数 | `#64748b` | 最灰，基本看不清 |
| 面板/输入框底色 | `#1e293b` / `#0f172a` | 写死深色 |

而 Harness 侧边栏本身是**跟随主题**的 —— better-sidebar 全程使用 DSH 设计令牌
（`--dsw-alias-label-primary` 142 处、`--dsw-alias-label-tertiary` 110 处等）。
写死颜色意味着：深色主题下偏灰，浅色主题下浅灰字 ≈ 看不见。

**修复**：两个 Tab（`DualBridgeTab` / `WebChatTab`）的颜色全部改为令牌：

| 用途 | 令牌 | 深色主题 | 浅色主题 |
| --- | --- | --- | --- |
| 主文字 | `--dsw-alias-label-primary` | 近白 | 近黑 |
| 次要文字 | `--dsw-alias-label-secondary` | 中亮 | 中深 |
| 语言标签 | `--dsw-alias-label-tertiary` | 稍暗 | 稍浅 |
| 边框 | `--dsw-alias-border-l1 / l2` | 白色 6% | 黑色 4% |
| 输入框/代码块底 | `--dsw-alias-bg-layer-1` | 深 | 浅 |
| 面板/hover 底 | `--dsw-alias-interactive-bg-hover` | 白色 8% | 蓝色 6% |
| 警告文字 | `--dsw-alias-state-warn-primary` | 亮黄 | 深琥珀 |
| 主按钮/徽章 | `--dsw-alias-state-business-primary` | 品牌蓝 | 品牌蓝 |
| 等宽字体 | `--ds-font-family-code` | 跟随宿主 | 跟随宿主 |

同时把复选框着色（`accent-color`）与数字计数（`tabular-nums`）一并统一。

**验证**：

- `tsc` 0 错误
- `node --test` **43 个**全过（新增 1 条护栏：禁止再出现 `#94a3b8/#64748b/#e2e8f0`
  这类写死灰色，且必须使用 `label-primary`）
- 构建产物中 `--dsw-alias-label-primary` 出现 23 次、`--dsw-alias-label-secondary`
  11 次，`#94a3b8` **残留 0**
- 版本徽章同步到 **0.3.1**


## 0.3.0 — 2026-10-18

### 重做文件选择 UI：扁平列表 → 可折叠文件树（用户反馈驱动）

**反馈原话**：「这个文件分的太细了，为什么不能采用点击展开文件的思路去设计？而且初始默认是
几百上千个文件全部选择打包的……严重违背常规设计逻辑。」

**问题确认**（反馈成立）：

1. 旧实现把扫描到的**所有文件平铺**在一个滚动列表里（新版上限 300 个），
   工作区稍大就是一屏几百行，找文件全靠滚动；
2. 扫描完成后 `setSelected(new Set(found.map(...)))` —— **默认全选**，
   一进 Tab 就等同于"把整个工作区都打包"，既反直觉、也容易瞬间打爆 token 预算；
3. 想排除某个目录只能逐个文件点掉。

**新设计**（`src/file-tree.ts` + `DualBridgeTab.tsx`）：

- **可折叠目录树**：目录在前、同级按名称排序；默认全部折叠，只显示顶层，
  展开才渲染子节点（不会一次挂几百个 DOM 节点）。
- **目录级三态勾选**：勾目录 = 选中整棵子树；半选态显示为 indeterminate；
  再点一次全选则整棵取消。目录右侧显示 `已选/总数`（如 `src/ 3/45`）。
- **默认不选任何文件**：扫描后清空选择并折叠整棵树，由用户主动挑选；
  未选时给出明确引导文案。
- **批量快捷**：`全选` / `仅代码` / `全不选`（原"清空"）+ `展开全部` / `折叠全部`。
- **搜索态退化为扁平列表**：搜索时不渲染树（常规做法，避免层级干扰结果命中）。

**纯逻辑抽离与测试**：`buildFileTree` / `collectFilePaths` / `countSelected` /
`selectionOf` / `toggleNodeSelection` / `collectDirPaths` 全部是纯函数，
不依赖 React，新增 **6 个** 单测覆盖：排序与汇总、三态判定、目录全选/取消、
半选点目录补满、目录路径收集、已选计数。

**回归护栏**：新增静态断言，禁止再出现 `setSelected(new Set(found.map(...)))`
这种"默认全选"，并要求文件列表必须走 `buildFileTree`。

### 版本

- `package.json` 与 UI 徽章（`BUILD_VERSION`）同步到 **0.3.0**，便于确认刷新是否生效。
- 验证：`tsc` 0 错误；`node --test` **42 个**全过；构建产物 `lib/client.js` 51.8kb。


## 0.2.1 — 2026-10-18

### 修复：「⇄ 分流对话」永久卡在"正在扫描"

**根因（死锁，不是性能问题）**：

1. 工作区加载成功后 `setPhase('scanning')`；
2. 但 `scan()` 的唯一调用点是「↻ 重新扫描」按钮；
3. 而该按钮的渲染条件是 `phase !== 'loading' && phase !== 'scanning'` —— 也就是说
   **进入 scanning 阶段后按钮就被卸载了**，再没有任何东西启动扫描 → 界面永久停在
   「🔍 正在扫描项目文件…」。

组件里只有两个 `useEffect`（卸载清理、`sessionCwd`），确实没有任何自动扫描触发。
交接文档里"扫描自动触发、进度正常"的验证记录对应的是**会话未激活**的场景
（那时停在 `loading`，看起来像在扫描），掩盖了这个死锁。

### 修复内容

- **`DualBridgeTab.tsx` 新增自动扫描 effect**（第 3 步）：工作区就绪（`cwd || root`）
  且处于 `scanning` 阶段时启动扫描；用 `sessionId|路径` 作 key 去重，
  不会与手动重扫叠加。
- **扫描态提供逃生口**：`🔍 正在扫描…` 下方新增「↻ 重新开始扫描」按钮，
  这类"无声卡死"以后不可能再阻断用户。
- **`onClick={scan}` → `onClick={() => scan()}`**：`scan` 现在接收 `rootOverride` 参数，
  直接把事件对象传进去会把 `MouseEvent` 当成路径。
- **修复 fallback 分支的子目录不展开**：批量 `fs.trees` 失败退化为逐个 `fs.tree` 时，
  旧代码先 `visited.add(dir)` 再 `collect(tree.path, ...)`，而 `collect()` 见"已访问"
  直接返回 → 子目录永不入队。改为不预先标记。
- **路径归一化**：`visited` 比较前去掉末尾斜杠，避免 host 返回形式与队列形式不一致
  导致同一目录被反复入队（潜在无限循环）。
- **扫描令牌**：每次扫描领一个 token，新扫描让旧循环尽快退出；同时用 `stale()`
  取代只判断 `disposedRef`，避免快速点击叠加请求、状态互相覆盖。
- **会话未激活时给出明确提示**：`sessionId` 为空时提示"请先新建或进入一个会话"，
  不再无声等待；`sessionCwd` 失败时也会切出 `loading` 并显示错误。
- **`pack.ts`：`SKIP_EXT` 补全 Office/音视频/设计稿**（`.docx/.pptx/.xlsx/.mov/.psd` 等）。
  实测工作区 `<workspace>` 有大量 `.docx/.pptx`，此前会被列进文件表，
  pack 阶段才被 host 判为 binary 丢掉，列表噪声很大。
- **标题旁新增版本徽章** `v0.2.1`：用于确认浏览器加载的是不是最新构建
  （改 `BUILD_VERSION` 常量，与 `package.json` 同步）。

### 验证

- `tsc -p tsconfig.check.json`：0 错误
- `node --test`：**36 个**测试全过（新增 5 个，其中 3 个是针对本次死锁的
  **静态回归护栏**：必须有 effect 自动扫描、禁止 `onClick={scan}`、
  scanning 态必须有重试入口、禁止 `visited.add(dir)`）
- 离线探针（同一套排除规则 + 真实文件系统）：`<workspace>` →
  254 目录 / 307 文件 / **18ms**，证明扫描本身极快，卡死纯属触发逻辑
- API 契约核对：`session.cwd` / `fs.tree` / `fs.trees` / `fs.read` 与
  better-sidebar 0.28.0 的实现完全一致（`POST /sidebar/api/<method>` + `{ok,value}`）

## 0.2.0 — 2026-10-18

### 背景：需求「在 Harness 本页面内嵌 DeepSeek 网页版」被证伪

用户要求「不跳转新标签、在本页面内打开网页版对话」。核查结论：**在浏览器安全模型下不可实现**。

证据链：

1. `chat.deepseek.com` 响应头实测：`content-security-policy: frame-ancestors 'none'`
   —— `'none'` 表示**任何域**都不允许内嵌它（不存在给 Harness 开白名单的可能）。
2. Harness 侧边栏**本来就有**内嵌浏览器能力（better-sidebar 0.28.0 的 Browser Tab），
   但它对此站点同样失败，并内置了兜底文案：
   `browserEmbedBlocked: "{host} 拒绝了嵌入请求"`（`lib/client.js:2725`）。
3. 唯一能"强行内嵌"的手段是「本地代理改写响应头」或「浏览器扩展去 CSP」，
   两者都属于本插件明令禁止的**代理/中转/自动化**范畴，且属于绕过站点安全策略，故不做。

因此把需求落地为两个**合规且真正有用**的替代能力，并在 UI 里向用户如实说明原因。

### 新增功能

**A. 同屏双窗** — `src/split-window.ts`

- 把网页版开成**贴着屏幕右侧的独立窗口**（`popup=yes` + 精确几何），自动聚焦，
  与 Harness 同屏并排，不用来回切标签页。
- 几何计算抽成纯函数 `computeSplitGeometry()`：按可用宽度的 46% 取宽（420–1400 夹紧）、
  贴右留 12px、纵向居中；小屏自动收敛到不越界；支持负坐标副屏（`availLeft`）。
- **复用而非重开**：模块内记住 Window 引用，重复点击只 `focus()`，
  刻意不重新导航（否则会丢掉用户正在进行的网页版对话）。
- 打开后置 `win.opener = null`，断开被打开页面对本站的反向引用（安全习惯）。

**B. 答案回收区** — `src/session-input.ts`

- 用户在网页版拿到回答后粘贴回侧边栏 → 一键「填入 Harness 输入框」，
  把「读项目/答疑（免费）→ 结论回流 Harness 继续改码」闭成环。
- 调用链完全对齐 better-sidebar 自己的 `appendToDraft`
  （`ctx.sessions.scope(id)` → `ctx.get('conversation').input.for(actx)`
  → `state.getSnapshot().draft` / `setDraft()`），未使用任何私有手段。
- **全链路降级**：会话未激活 / 宿主无 conversation 服务 / 写入抛错时返回
  结构化失败原因（`empty` / `no-session-scope` / `no-conversation-service` /
  `write-failed`），UI 自动回退为「已复制到剪贴板」，插件不会崩。

### UI 变更

- 「🌐 网页对话」Tab 重做：三步闭环说明 + 同屏窗口按钮 + 答案回收区
  （文本框 + 填入/复制/清空 + 状态提示 + 字符计数）+ 「为什么不能内嵌」说明。
- Tab 描述文案更新为「同屏打开…+ 答案回收区」。

### 工程变更

- 新增 `tsconfig.check.json`（strict + noUnusedLocals）与 npm scripts：
  `typecheck` / `test` / `verify`。
- 新增 `tests/features.test.mjs`：**16 个**用例，覆盖窗口几何（常见屏/小屏/极窄屏/
  负坐标副屏/超宽屏）、features 串、非浏览器环境安全返回、草稿拼接与追加、
  四种失败原因降级。项目累计 **30 个**测试全绿。
- host 端未改动（`src/index.ts` 仍为空 apply），不影响已有加载协议。

### 运维

- 清理 `~/.dsh/profiles/web/cordis.patch.yml` 中指向**已卸载**插件
  `plugin-marketplace` 的死配置（含备份 `cordis.patch.yml.bak-<时间戳>`）。
  若将来重装市场插件，需要重新加回 `maxBytes/timeoutMs` 覆盖。

## 0.1.0 — 2026-10-17

- 首个可运行版本：「⇄ 分流对话」Tab（扫描/勾选/打包/复制）+「🌐 网页对话」Tab
  （一键 `window.open` 打开网页版）。
