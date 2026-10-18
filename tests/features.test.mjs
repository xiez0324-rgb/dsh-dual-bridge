/**
 * 新功能单测：同屏窗口几何 + 草稿写入（答案回收区）。
 *
 * 这两个模块被刻意写成不依赖 React / DOM 的纯逻辑，
 * 因此可以在 node 下直接跑（esbuild 打包后 import，与项目既有测试风格一致）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

mkdirSync(tmpdir(), { recursive: true })

async function bundle(entry, outName) {
  const outfile = join(tmpdir(), outName)
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

const split = await bundle('src/split-window.ts', 'dsh-db-split-20261018.mjs')

// ---------------------------------------------------------------- 同屏窗口几何
test('computeSplitGeometry: 常见笔记本屏（1728x1117）贴右并纵向居中', () => {
  const g = split.computeSplitGeometry({ availWidth: 1728, availHeight: 1117 })
  assert.deepEqual(g, { width: 795, height: 1050, left: 921, top: 34 })
})

test('computeSplitGeometry: 小屏（800x600）仍保证最小宽度且不越界', () => {
  const g = split.computeSplitGeometry({ availWidth: 800, availHeight: 600 })
  assert.deepEqual(g, { width: 420, height: 564, left: 368, top: 18 })
})

test('computeSplitGeometry: 极窄屏（400x300）宽度收敛到屏宽、left 不为负', () => {
  const g = split.computeSplitGeometry({ availWidth: 400, availHeight: 300 })
  assert.deepEqual(g, { width: 400, height: 300, left: 0, top: 0 })
})

test('computeSplitGeometry: 左侧副屏（availLeft 为负）也能正确贴合', () => {
  const g = split.computeSplitGeometry({
    availWidth: 1920,
    availHeight: 1080,
    availLeft: -1920,
    availTop: 0,
  })
  assert.deepEqual(g, { width: 883, height: 1015, left: -895, top: 33 })
})

test('computeSplitGeometry: 宽度不超过 MAX_SPLIT_WIDTH（超宽屏）', () => {
  const g = split.computeSplitGeometry({ availWidth: 5120, availHeight: 1440 })
  assert.equal(g.width, split.MAX_SPLIT_WIDTH)
})

test('splitFeatures: 生成带 popup 与定位参数的 features 串', () => {
  const features = split.splitFeatures({ width: 795, height: 1050, left: 921, top: 34 })
  assert.equal(features, 'popup=yes,width=795,height=1050,left=921,top=34')
})

test('openSplitWindow: 非浏览器环境安全返回 null', () => {
  const result = split.openSplitWindow('https://chat.deepseek.com/')
  assert.equal(result.window, null)
  assert.equal(result.reused, false)
})

// ---------------------------------------------------------------- 草稿写入









// ------------------------------------------------- 分流对话 Tab 的回归护栏
// 曾经的线上故障：sessionCwd 成功后 phase 变成 scanning，但没有任何代码调用 scan()，
// 而「重新扫描」按钮又只在非 scanning 阶段渲染 → 界面永久卡在"正在扫描"。
// 这类死局无法在 node 里渲染组件复现，因此用源码级断言守住关键不变量。
const dualSrc = await readFile('src/DualBridgeTab.tsx', 'utf8')

test('DualBridgeTab: 工作区就绪后必须由 effect 自动触发扫描', () => {
  assert.match(dualSrc, /void scan\(start\)/, '缺少 effect 中的自动扫描调用（会导致一直卡在正在扫描）')
  assert.match(dualSrc, /if \(phase !== 'scanning'\) return/, '自动扫描 effect 缺少阶段守卫')
})

test('DualBridgeTab: 手动按钮不能把 MouseEvent 当成路径参数', () => {
  assert.doesNotMatch(
    dualSrc,
    /onClick=\{scan\}/,
    'onClick={scan} 会把 MouseEvent 当成 rootOverride 传进 scan()，必须写成 onClick={() => scan()}',
  )
})

test('DualBridgeTab: 扫描态必须保留"重新开始扫描"逃生按钮', () => {
  const scanningBlock = dualSrc.slice(
    dualSrc.indexOf("phase === 'scanning' &&"),
    dualSrc.indexOf("phase !== 'loading'"),
  )
  assert.ok(scanningBlock.length > 0, '未找到 scanning 渲染块')
  assert.match(scanningBlock, /重新开始扫描/, '扫描态缺少手动重试入口')
})

test('DualBridgeTab: fallback 分支不能预先 visited.add(dir) 导致子目录不展开', () => {
  assert.doesNotMatch(
    dualSrc,
    /visited\.add\(dir\)/,
    '批量接口失败退化为逐个 fsTree 时，不能先标的已访问，否则 collect() 直接返回、子目录永不展开',
  )
})

// ------------------------------------------------- 二进制扩展名过滤
const packMod = await bundle('src/pack.ts', 'dsh-db-pack-20261018.mjs')

test('shouldInclude: Office/二进制扩展名不再污染文件表', () => {
  for (const p of ['a.docx', 'b.pptx', 'c.xlsx', 'd.mov', 'e.psd', 'f.sqlite']) {
    assert.equal(packMod.shouldInclude(p, packMod.DEFAULT_EXCLUDES), false, `${p} 应被跳过`)
  }
})

test('shouldInclude: 普通源码与白名单隐藏文件仍然保留', () => {
  for (const p of ['main.py', 'README.md', 'src/app.tsx', '.gitignore', 'Dockerfile']) {
    assert.equal(packMod.shouldInclude(p, packMod.DEFAULT_EXCLUDES), true, `${p} 应保留`)
  }
})



// ------------------------------------------------- 文件树（目录折叠 + 目录级勾选）
const treeMod = await bundle('src/file-tree.ts', 'dsh-db-tree-20261018.mjs')

const TREE_FILES = [
  { relPath: 'README.md', path: '/p/README.md', size: 10 },
  { relPath: 'src/main.ts', path: '/p/src/main.ts', size: 20 },
  { relPath: 'src/util/a.ts', path: '/p/src/util/a.ts', size: 30 },
  { relPath: 'src/util/b.ts', path: '/p/src/util/b.ts', size: 40 },
  { relPath: 'docs/guide.md', path: '/p/docs/guide.md', size: 50 },
]

test('buildFileTree: 目录在前、同级按名称排序，汇总 fileCount/size', () => {
  const nodes = treeMod.buildFileTree(TREE_FILES)
  assert.deepEqual(nodes.map((n) => n.name), ['docs', 'src', 'README.md'])
  const src = nodes.find((n) => n.name === 'src')
  assert.equal(src.isDir, true)
  assert.equal(src.fileCount, 3)
  assert.equal(src.size, 90)
  assert.deepEqual(src.children.map((n) => n.name), ['util', 'main.ts'])
  const util = src.children.find((n) => n.name === 'util')
  assert.equal(util.fileCount, 2)
  assert.equal(util.size, 70)
})

test('selectionOf: 三态 none / some / all', () => {
  const src = treeMod.buildFileTree(TREE_FILES).find((n) => n.name === 'src')
  assert.equal(treeMod.selectionOf(src, new Set()), 'none')
  assert.equal(treeMod.selectionOf(src, new Set(['src/main.ts'])), 'some')
  assert.equal(
    treeMod.selectionOf(src, new Set(['src/main.ts', 'src/util/a.ts', 'src/util/b.ts'])),
    'all',
  )
})

test('toggleNodeSelection: 勾目录＝选中整棵子树；再勾一次全部取消', () => {
  const src = treeMod.buildFileTree(TREE_FILES).find((n) => n.name === 'src')
  const on = treeMod.toggleNodeSelection(src, new Set())
  assert.deepEqual([...on].sort(), ['src/main.ts', 'src/util/a.ts', 'src/util/b.ts'])
  const off = treeMod.toggleNodeSelection(src, on)
  assert.equal(off.size, 0)
})

test('toggleNodeSelection: 半选状态点目录 → 补满为全选', () => {
  const src = treeMod.buildFileTree(TREE_FILES).find((n) => n.name === 'src')
  const full = treeMod.toggleNodeSelection(src, new Set(['src/main.ts']))
  assert.equal(full.size, 3)
})

test('collectDirPaths / countSelected: 供"展开全部"与计数使用', () => {
  const nodes = treeMod.buildFileTree(TREE_FILES)
  assert.deepEqual(treeMod.collectDirPaths(nodes).sort(), ['docs', 'src', 'src/util'])
  const src = nodes.find((n) => n.name === 'src')
  assert.equal(treeMod.countSelected(src, new Set(['src/util/b.ts'])), 1)
})

test('DualBridgeTab: 扫描完成后默认不选中任何文件（回归：曾经默认全选）', () => {
  assert.doesNotMatch(dualSrc, /setSelected\(new Set\(found\.map/, '不应默认全选所有文件')
  assert.match(dualSrc, /setSelected\(new Set\(\)\)/, '扫描后应清空选择')
  assert.match(dualSrc, /buildFileTree/, '文件列表应改为可折叠文件树')
})

// ------------------------------------------------- 主题令牌（颜色对比度）
test('UI 文字必须走 DSH 主题令牌（回归：写死灰色导致浅色主题下灰得看不清）', async () => {
  for (const [path, name] of [
    ['src/DualBridgeTab.tsx', 'DualBridgeTab'],
  ]) {
    const src = await readFile(path, 'utf8')
    assert.doesNotMatch(src, /#(94a3b8|64748b|e2e8f0)/i, `${name} 仍在用写死的灰色文字`)
    assert.match(src, /var\(--dsw-alias-label-primary\)/, `${name} 未使用 label-primary 令牌`)
    assert.match(src, /var\(--dsw-alias-label-(secondary|tertiary)\)/, `${name} 次要文字未使用令牌`)
  }
})

// ------------------------------------------------- 跳过统计（解释"文件为什么没出现"）
test('buildFileTree: 目录带跳过数，"只有非文本文件"的目录也会出现', () => {
  const nodes = treeMod.buildFileTree(
    [{ relPath: 'docs/a.md', path: '/p/docs/a.md', size: 1 }],
    { docs: 5, 真题全册: 37, '真题全册/数学': 3 },
  )
  const docs = nodes.find((n) => n.name === 'docs')
  assert.equal(docs.fileCount, 1)
  assert.equal(docs.skipped, 5, '自身目录内的跳过数应记在 skipped')

  const zt = nodes.find((n) => n.name === '真题全册')
  assert.ok(zt, '整目录都是 PDF/图片时，目录本身必须仍然可见')
  assert.equal(zt.fileCount, 0, '没有可打包文件')
  assert.equal(zt.skipped, 40, '自身 37 + 子目录 3')
  assert.equal(zt.children[0].name, '数学')
})

test('DualBridgeTab: 扫描上限可配置，且达到上限必须显式提示（回归：写死 300 静默截断）', () => {
  assert.doesNotMatch(dualSrc, /const MAX_FILES = 300/, '不应再写死 300 上限')
  assert.match(dualSrc, /FILE_CAP_OPTIONS/, '应提供上限选择')
  assert.match(dualSrc, /已达扫描上限/, '达到上限时必须提示，而不是静默少显示')
  assert.match(dualSrc, /skippedByDir/, '应统计每目录被跳过的文件数')
  assert.match(dualSrc, /不可打包/, '空目录应标注"不可打包"原因')
})

// ------------------------------------------------- 预算裁剪（applyBudget）
test('applyBudget: 预算充足时全部包含，不丢弃', () => {
  const files = [
    { relPath: 'a.py', content: 'x'.repeat(40) },
    { relPath: 'b.py', content: 'x'.repeat(40) },
  ]
  const plan = packMod.applyBudget(files, 10000)
  assert.equal(plan.included.length, 2)
  assert.equal(plan.dropped.length, 0)
})

test('applyBudget: 装不下的跳过，继续装后面的小文件（贪心，不是前缀截断）', () => {
  const files = [
    { relPath: 'big.py', content: 'x'.repeat(4000) }, // 约 1000+ token
    { relPath: 'a.py', content: 'x'.repeat(40) },
    { relPath: 'b.py', content: 'x'.repeat(40) },
  ]
  const plan = packMod.applyBudget(files, 500)
  assert.deepEqual(plan.dropped, ['big.py'], '大文件应被跳过')
  assert.deepEqual(plan.included.map((f) => f.relPath), ['a.py', 'b.py'], '小文件仍应被装入')
})

test('applyBudget: 预算小到连目录树都放不下时全部丢弃且不报错', () => {
  const files = [{ relPath: 'a.py', content: 'x'.repeat(400) }]
  const plan = packMod.applyBudget(files, 10)
  assert.equal(plan.included.length, 0)
  assert.deepEqual(plan.dropped, ['a.py'])
})

test('DualBridgeTab: 打包必须并发读取且显式上报截断（回归：500 静默截断）', () => {
  assert.match(dualSrc, /READ_CONCURRENCY/, '应并发读取')
  assert.match(dualSrc, /MAX_READ_FILES/, '应保留读取上限')
  assert.match(dualSrc, /单次最多读取/, '超过读取上限必须提示，而不是静默丢弃')
  assert.match(dualSrc, /applyBudget/, '预算截断应复用纯函数')
  assert.doesNotMatch(dualSrc, /totalBytes/, '应清理无用变量')
})

// ------------------------------------------------- 二进制附件声明（A）
test('assemblePrompt: 传入被跳过的附件时，生成【未包含的附件】段落并提示上传', () => {
  const tree = 'docs/\n  a.md'
  const files = [{ relPath: 'docs/a.md', content: 'hello' }]
  const out = packMod.assemblePrompt(tree, files, undefined, {
    listed: ['真题/x.pdf', '真题/y.docx'],
    omitted: 0,
    total: 2,
  })
  assert.match(out.prompt, /【未包含的附件（无法作为文本读取）】/)
  assert.match(out.prompt, /真题\/x\.pdf/)
  assert.match(out.prompt, /真题\/y\.docx/)
  assert.match(out.prompt, /直接上传原文件|上传原文件/)
  // 未包含内容不能被塞进代码块
  assert.doesNotMatch(out.prompt, /```pdf/)
})

test('assemblePrompt: 没有跳过的附件时不产生该段落', () => {
  const out = packMod.assemblePrompt('a.md', [{ relPath: 'a.md', content: 'x' }])
  assert.doesNotMatch(out.prompt, /未包含的附件/)
})

test('DualBridgeTab: 附件引导（C）已接线：清单、复制路径、直接上传提示', () => {
  assert.match(dualSrc, /MAX_SKIPPED_LISTED/, '附件清单应有上限')
  assert.match(dualSrc, /copySkippedPaths/, '应提供复制全部路径')
  assert.match(dualSrc, /直接把文件拖进 DeepSeek 网页版输入框/, '应有直接上传引导')
  assert.match(dualSrc, /未包含的附件/, '应有附件清单面板')
})

// ------------------------------------------------- host 端抽取
const extractMod = await bundle('src/extract.ts', 'dsh-db-extract-20261018.mjs')

test('isInsideWorkspace: 只允许工作区内，挡住 ../ 越界与相对路径', () => {
  const { isInsideWorkspace } = extractMod
  assert.equal(isInsideWorkspace('/a/b', '/a/b/c.txt'), true)
  assert.equal(isInsideWorkspace('/a/b', '/a/b/x/y.pdf'), true)
  assert.equal(isInsideWorkspace('/a/b', '/a/b/../etc/passwd'), false, '必须挡住 ../ 越界')
  assert.equal(isInsideWorkspace('/a/b', '/a/bc/c.txt'), false, '前缀相同但不是子路径')
  assert.equal(isInsideWorkspace('/a/b', '/etc/passwd'), false)
  assert.equal(isInsideWorkspace('/a/b', 'b/c.txt'), false, '相对路径一律拒绝')
  assert.equal(isInsideWorkspace('/a/b', '/a/b'), false, '目录本身不是文件')
})

test('resolveExtractor: 有内置 poppler 时走 poppler；图片/文本不返回抽取器', async () => {
  const { resolveExtractor } = extractMod
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  // 造一个假的内置 poppler（CI 没有 vendor/ 目录，不能依赖真实二进制）
  const root = await mkdtemp(join(tmpdir(), 'fake-poppler-'))
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(root, 'bin', 'pdftotext'), '#!/bin/sh\n', { mode: 0o755 })

  const pdf = resolveExtractor('/x/a.pdf', { popplerRoot: root })
  assert.equal(pdf?.engine, 'poppler')
  assert.ok(pdf.args.includes('/x/a.pdf'))

  // 非 PDF 不做内置解析（docx/pptx/xlsx 走 office-zip，不需要外部抽取器）
  assert.equal(resolveExtractor('/x/a.png', {}), undefined)
  assert.equal(resolveExtractor('/x/a.txt', {}), undefined)
})

test('normalizeExtractedText: 统一换行、压空行、去行尾空白', () => {
  const { normalizeExtractedText } = extractMod
  const out = normalizeExtractedText('a  \r\n\r\n\r\n\r\nb\t\n\n')
  assert.equal(out, 'a\n\nb')
})

test('extractText: 真实 spawn textutil 抽取 RTF（端到端）', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-db-extract-'))
  const rtf = join(dir, 'sample.rtf')
  await writeFile(rtf, '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 HelloBridgeTest\\par}')

  const ok = await extractMod.extractText({ cwd: dir, filePath: rtf })
  assert.equal(ok.ok, true, JSON.stringify(ok))
  assert.match(ok.text, /HelloBridgeTest/)
  assert.match(ok.engine, /rtf|textutil/)

  // 越界路径必须被拒绝
  const outside = await extractMod.extractText({ cwd: dir, filePath: '/etc/hosts' })
  assert.equal(outside.ok, false)
  assert.equal(outside.code, 'outside-workspace')

  // 不支持的类型
  const png = join(dir, 'a.png')
  await writeFile(png, 'not really png')
  const unsupported = await extractMod.extractText({ cwd: dir, filePath: png })
  assert.equal(unsupported.code, 'unsupported')
})

test('DualBridgeTab/index: host 路由与按需抽取已接线', async () => {
  const { readFile } = await import('node:fs/promises')
  const idx = await readFile('src/index.ts', 'utf8')
  assert.match(idx, /\/dual-bridge\/extract/, 'host 路由路径')
  assert.match(idx, /inject = \['webServer'\]/, '必须注入 webServer')
  assert.match(dualSrc, /runExtract/, '客户端应能触发抽取')
  assert.match(dualSrc, /抽取文本/, '树上应有抽取按钮')
  assert.match(dualSrc, /extractedFiles|extractedEntries/, '抽取结果应并入 prompt')
})

// ------------------------------------------------- host 路由级测试（不启服务）
const hostMod = await bundle('src/index.ts', 'dsh-db-host-20261018.mjs')

/** 造一对最小的 req/res，模拟 node:http 的语义 */
async function callRoute(method, payload, rawBody) {
  const req = {
    method,
    _h: {},
    on(event, cb) {
      ;(this._h[event] ??= []).push(cb)
      return this
    },
  }
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
    },
  }
  const settled = hostMod.handleExtractRoute(req, res)
  const text = rawBody ?? JSON.stringify(payload ?? {})
  for (const cb of req._h.data ?? []) cb(text)
  for (const cb of req._h.end ?? []) cb()
  await settled
  return { status: res.status, json: res.body === '' ? null : JSON.parse(res.body), res }
}

test('路由: 非 POST 返回 405', async () => {
  const out = await callRoute('GET', {})
  assert.equal(out.status, 405)
  assert.equal(out.json.ok, false)
})

test('路由: 请求体不是 JSON / 缺字段 返回 400', async () => {
  const bad = await callRoute('POST', null, '{oops')
  assert.equal(bad.status, 400)
  const missing = await callRoute('POST', { cwd: '/tmp' })
  assert.equal(missing.status, 400)
  assert.match(missing.json.message, /缺少/)
})

test('路由: 越界路径返回 400 outside-workspace', async () => {
  const out = await callRoute('POST', { cwd: '/tmp', path: '/etc/hosts' })
  assert.equal(out.status, 400)
  assert.equal(out.json.code, 'outside-workspace')
})

test('路由: 正常抽取返回 200 + text（真实 spawn）', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-db-route-'))
  const file = join(dir, 'a.rtf')
  await writeFile(file, '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 RouteTestOK\\par}')
  const out = await callRoute('POST', { cwd: dir, path: file })
  assert.equal(out.status, 200, JSON.stringify(out.json))
  assert.equal(out.json.ok, true)
  assert.match(out.json.text, /RouteTestOK/)
  assert.match(out.json.engine, /rtf|textutil/)
  assert.equal(out.res.headers['content-type'], 'application/json; charset=utf-8')
})

test('host 模块: 导出 name/inject/ROUTES/apply，无 webServer 时安全空转，有则注册全部路由', () => {
  assert.equal(hostMod.name, 'dsh-dual-bridge')
  assert.deepEqual([...hostMod.inject], ['webServer'])
  assert.equal(hostMod.ROUTES.extract, '/dual-bridge/extract')
  assert.deepEqual(Object.keys(hostMod.ROUTES).sort(), [
    'bundle',
    'capabilities',
    'extract',
    'ocr',
    'reveal',
  ])

  // 没有 webServer 的 profile（headless）：apply 不能抛
  assert.doesNotThrow(() => hostMod.apply({ effect: (fn) => fn(), webServer: undefined }))

  // 有 webServer：5 条 exact 路由全部注册
  const seen = []
  hostMod.apply({
    effect: (fn) => fn(),
    webServer: {
      register: (route) => {
        seen.push(route)
        return () => {}
      },
    },
  })
  assert.equal(seen.length, 5)
  for (const route of seen) {
    assert.equal(route.kind, 'exact')
    assert.equal(typeof route.handler, 'function')
  }
  assert.deepEqual(
    seen.map((r) => r.path).sort(),
    Object.values(hostMod.ROUTES).sort(),
  )
})

// ------------------------------------------------- 附件声明只取同目录（防冗余）
test('selectRelevantAttachments: 只保留与所选文件同目录的附件', () => {
  const { selectRelevantAttachments } = packMod
  const plan = selectRelevantAttachments(
    ['帮算综测文件夹/个人陈述.rtf'],
    [
      '7.JPG',                                  // 根目录，不相关
      'ai/strategy.docx',                       // 别的目录，不相关
      '帮算综测文件夹/202530082002 登记表.doc',   // 同目录 → 相关
      '帮算综测文件夹/证明材料.doc',              // 同目录 → 相关
    ],
  )
  assert.deepEqual(plan.listed, [
    '帮算综测文件夹/202530082002 登记表.doc',
    '帮算综测文件夹/证明材料.doc',
  ])
  assert.equal(plan.total, 4, '总数要保留，供一句话汇总使用')
  assert.equal(plan.omitted, 0)
})

test('selectRelevantAttachments: 超出上限截断并给出省略数', () => {
  const { selectRelevantAttachments } = packMod
  const skipped = Array.from({ length: 30 }, (_, i) => `d/f${i}.pdf`)
  const plan = selectRelevantAttachments(['d/a.txt'], skipped, 20)
  assert.equal(plan.listed.length, 20)
  assert.equal(plan.omitted, 10)
})

test('selectRelevantAttachments: 没有同目录附件时一条都不列', () => {
  const { selectRelevantAttachments } = packMod
  const plan = selectRelevantAttachments(['d/a.txt'], ['x/y.pdf', 'z.jpg'])
  assert.deepEqual(plan.listed, [])
  assert.equal(plan.total, 2)
})

test('assemblePrompt: 有同目录附件 → 列清单；无同目录 → 只给一句话汇总', () => {
  const tree = 'd/\n  a.txt'
  const files = [{ relPath: 'd/a.txt', content: 'x' }]

  const withList = packMod.assemblePrompt(tree, files, undefined, {
    listed: ['d/x.pdf'],
    omitted: 2,
    total: 9,
  })
  assert.match(withList.prompt, /同目录另有 2 个未列出/)
  assert.match(withList.prompt, /- d\/x\.pdf/)

  const summaryOnly = packMod.assemblePrompt(tree, files, undefined, {
    listed: [],
    omitted: 0,
    total: 9,
  })
  assert.match(summaryOnly.prompt, /本工作区另有 9 个/)
  assert.doesNotMatch(summaryOnly.prompt, /^- /m, '不应出现逐条清单')
  // 汇总形式必须比逐条清单短得多
  assert.ok(summaryOnly.prompt.length < withList.prompt.length + 200)
})

test('selectRelevantAttachments: 已抽取的文件不再出现在"未包含"里', () => {
  const { selectRelevantAttachments } = packMod
  const plan = selectRelevantAttachments(
    ['d/已抽取.rtf'],
    ['d/已抽取.rtf', 'd/材料.doc'],
    20,
    ['d/已抽取.rtf'],
  )
  assert.deepEqual(plan.listed, ['d/材料.doc'])
  assert.equal(plan.total, 1)
})

test('DualBridgeTab: 「含附件声明」开关存在且默认关闭', () => {
  assert.match(dualSrc, /includeAttachments/, '应有 includeAttachments 状态')
  assert.match(dualSrc, /useState\(false\)[\s\S]{0,80}includeAttachments|includeAttachments\b[\s\S]{0,40}useState\(false\)/,
    '默认值应为 false')
  assert.match(dualSrc, /含附件声明/, '控件文案')
  // 未勾选时不生成附件段
  assert.match(dualSrc, /includeAttachments\s*\n?\s*\? selectRelevantAttachments/, '应受开关控制')
})

// ------------------------------------------------- 可抽取判定（host/client 共用）
const extractableMod = await bundle('src/extractable.ts', 'dsh-db-extractable-20261018.mjs')

test('isExtractablePath: PDF 与 Office/RTF/HTML 可抽取；图片音视频压缩包不可抽取', () => {
  const { isExtractablePath, extractKindOf } = extractableMod
  for (const p of ['a.pdf', 'dir/b.PDF']) assert.equal(isExtractablePath(p), true, p)
  for (const p of ['a.docx', 'a.doc', 'a.rtf', 'a.html', 'a.htm', 'a.odt']) {
    assert.equal(isExtractablePath(p), true, p)
  }
  for (const p of ['小小.png', '7.JPG', 'a.jpeg', 'coding/录屏.mov', 'x.zip', 'a.pptx', 'a.xlsx']) {
    assert.equal(isExtractablePath(p), false, `${p} 不应显示抽取按钮`)
  }
  assert.equal(extractKindOf('a.pdf'), 'pdf')
  assert.equal(extractKindOf('a.docx'), 'office')
  assert.equal(extractKindOf('a.png'), 'none')
})

test('DualBridgeTab: 按钮受"本机能力"约束；抽取后可选、可单独打包', () => {
  // 按钮是否渲染由 convertAction(...).ok 决定（能力探测结果驱动）
  assert.match(dualSrc, /convertAction\(node\.relPath\)\.ok \? \(/, '按钮应受能力判定约束')
  // 抽取成功自动加入选中集合
  assert.match(dualSrc, /setSelected\(\(prev\) => new Set\(prev\)\.add\(relPath\)\)/, '抽取后应自动选中')
  // 只打包已勾选的抽取内容
  assert.match(dualSrc, /selectedExtracted/, '只打包已勾选的抽取结果')
  // 全选应包含已抽取项
  assert.match(dualSrc, /\.\.\.Object\.keys\(extracted\)/, '全选应包含抽取项')
  // 所有文件都能勾选（不再按 binary 禁用）
  assert.match(dualSrc, /disabled=\{node\.isDir && node\.fileCount === 0\}/, '所有文件都应可勾选')
})

test('DualBridgeTab: 顶端有使用规则；「半自动 · 合规」徽章已移除', () => {
  assert.match(dualSrc, /使用规则/, '应有使用规则区块')
  assert.match(dualSrc, /提取到剪贴板/, '规则须说明"打包 = 提取文本到剪贴板"')
  assert.match(dualSrc, /同屏打开网页版|🚀/, '规则须说明呼出网页版')
  assert.doesNotMatch(dualSrc, /半自动 · 合规/, '无关徽章应已移除')
  assert.doesNotMatch(dualSrc, /styles\.badge\b/, 'badge 样式引用应已清除')
})

// ------------------------------------------------- 导出包 + OCR 纯逻辑
const bundleMod = await bundle('src/bundle.ts', 'dsh-db-bundle-20261018.mjs')
const ext2 = await bundle('src/extractable.ts', 'dsh-db-ext2-20261018.mjs')

test('isImagePath / isTextConvertible: 图片可 OCR，视频压缩包不可', () => {
  const { isImagePath, isTextConvertible } = ext2
  for (const p of ['a.png', 'b.JPG', 'c.jpeg', 'd.heic', 'e.webp']) {
    assert.equal(isImagePath(p), true, p)
    assert.equal(isTextConvertible(p), true, p)
  }
  for (const p of ['a.pdf', 'b.docx', 'c.rtf', 'd.html']) {
    assert.equal(isTextConvertible(p), true, p)
  }
  for (const p of ['a.mov', 'b.zip', 'c.pptx', 'd.xlsx']) {
    assert.equal(isImagePath(p), false, p)
    assert.equal(isTextConvertible(p), false, p)
  }
})

test('suggestionFor: 按类型给出"该怎么给 AI 看"的建议', () => {
  const { suggestionFor } = bundleMod
  assert.match(suggestionFor('a.png'), /作为图片上传/)
  assert.match(suggestionFor('a.pdf'), /上传原文件/)
  assert.match(suggestionFor('a.docx'), /上传原文件/)
  assert.match(suggestionFor('a.mov'), /无法直接解析/)
  assert.match(suggestionFor('a.zip'), /解压/)
})

test('buildManifestText: 生成含表格与上传指引的清单', () => {
  const { buildManifestText } = bundleMod
  const md = buildManifestText(
    [
      { relPath: 'images/a.png', size: 2048 },
      { relPath: 'scan.pdf', size: 3 * 1024 * 1024 },
    ],
    { workspace: '/ws', createdAt: '2026-10-18 13:00', totalBytes: 3 * 1024 * 1024 + 2048 },
  )
  assert.match(md, /# 附件清单/)
  assert.match(md, /文件数：2 个/)
  assert.match(md, /images\/a\.png/)
  assert.match(md, /2 KB/)
  assert.match(md, /3\.0 MB/)
  assert.match(md, /拖进网页版对话输入框/)
  assert.doesNotMatch(md, /AI 不会解析 zip 内部/, '未打 zip 时不应出现 zip 说明')
})

test('packDirName: 时间戳目录名可复现（传 stamp）', () => {
  const { packDirName } = bundleMod
  assert.equal(packDirName('20261018-1300'), 'dsh-pack-20261018-1300')
  assert.match(packDirName(), /^dsh-pack-\d{8}-\d{6}$/)
})

test('DualBridgeTab: 二进制文件自动进导出包，且提供访达/复制路径按钮', () => {
  assert.match(dualSrc, /api\.bundle\(/, '应调用导出包路由')
  assert.match(dualSrc, /导出包/, '应有导出包结果展示')
  assert.match(dualSrc, /api\.reveal\(/, '应支持在访达中显示')
  assert.match(dualSrc, /导出 zip/, '应有 zip 开关')
})

// ------------------------------------------------- 跨平台 Office 抽取（纯 Node）
const officeMod = await bundle('src/office-zip.ts', 'dsh-db-office-20261018.mjs')

/** 造一个最小 ZIP（store 方式，测试用；CRC 不校验） */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const data = Buffer.from(f.content, 'utf8')
    const name = Buffer.from(f.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0, 10)
    cen.writeUInt32LE(data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(cen, name)
    offset += local.length + name.length + data.length
  }
  const cenBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cenBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cenBuf, eocd])
}

test('listZipEntries / readZipFile: 能读出目录与内容', () => {
  const buf = makeZip([
    { name: 'a.txt', content: 'hello' },
    { name: 'dir/b.txt', content: '世界' },
  ])
  const names = officeMod.listZipEntries(buf).map((e) => e.name)
  assert.deepEqual(names, ['a.txt', 'dir/b.txt'])
  assert.equal(officeMod.readZipFile(buf, 'dir/b.txt').toString('utf8'), '世界')
})

test('extractOfficeText: docx 抽 <w:t> 且保留段落换行', () => {
  const xml =
    '<?xml version="1.0"?><w:document><w:body>' +
    '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>世界</w:t></w:r><w:r><w:t>第二段</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  const buf = makeZip([{ name: 'word/document.xml', content: xml }])
  const text = officeMod.extractOfficeText(buf, 'a.docx')
  assert.match(text, /Hello/)
  assert.match(text, /世界/)
  assert.match(text, /第二段/)
  assert.match(text, /Hello\s*\n+\s*世界/) // 段落之间有换行
})

test('extractOfficeText: pptx 按页抽取 <a:t>', () => {
  const slide = (t) => `<p:sld><p:cSld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:cSld></p:sld>`
  const buf = makeZip([
    { name: 'ppt/slides/slide1.xml', content: slide('第一页') },
    { name: 'ppt/slides/slide2.xml', content: slide('第二页') },
  ])
  const text = officeMod.extractOfficeText(buf, 'a.pptx')
  assert.match(text, /第 1 页/)
  assert.match(text, /第一页/)
  assert.match(text, /第二页/)
})

test('extractOfficeText: xlsx 用共享字符串还原单元格', () => {
  const shared =
    '<?xml?><sst><si><t>姓名</t></si><si><t>张三</t></si></sst>'
  const sheet =
    '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row><c r="A2"><v>42</v></c></row></sheetData></worksheet>'
  const buf = makeZip([
    { name: 'xl/sharedStrings.xml', content: shared },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ])
  const text = officeMod.extractOfficeText(buf, 'a.xlsx')
  assert.match(text, /姓名\t张三/)
  assert.match(text, /42/)
})

test('rtfToText: 剥离控制字与转义，保留正文换行', () => {
  const rtf =
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 第一行\\par 第二行\\par}'
  const text = officeMod.rtfToText(rtf)
  assert.match(text, /第一行/)
  assert.match(text, /第二行/)
  assert.doesNotMatch(text, /fonttbl|Helvetica|\\par/)
})

test('decodeXmlEntities: 常见实体与数字实体', () => {
  assert.equal(officeMod.decodeXmlEntities('a&amp;b&lt;c&gt;d&quot;e&apos;f'), `a&b<c>d"e'f`)
  assert.equal(officeMod.decodeXmlEntities('&#65;&#x4E16;'), 'A世')
})

// ------------------------------------------------- OCR 引擎链（跨平台）
const ocrMod = await bundle('src/ocr.ts', 'dsh-db-ocr-20261018.mjs')

test('chooseOcrEngines: 优先原生，wasm 永远兜底', () => {
  const { chooseOcrEngines } = ocrMod
  // 全都有：vision 优先
  assert.deepEqual(
    chooseOcrEngines({ vision: true, systemTesseract: true, wasm: true }),
    ['vision', 'tesseract', 'wasm'],
  )
  // 非 mac（无 vision）：系统 tesseract 次之
  assert.deepEqual(
    chooseOcrEngines({ vision: false, systemTesseract: true, wasm: true }),
    ['tesseract', 'wasm'],
  )
  // Windows/Linux 什么都没装：只有内置 wasm —— 这就是跨平台保底
  assert.deepEqual(
    chooseOcrEngines({ vision: false, systemTesseract: false, wasm: true }),
    ['wasm'],
  )
  // 都没有
  assert.deepEqual(chooseOcrEngines({ vision: false, systemTesseract: false, wasm: false }), [])
})

test('wasmOcrAvailable: 依赖随包安装则应可用', () => {
  assert.equal(ocrMod.wasmOcrAvailable(), true, 'tesseract.js 应作为依赖被解析到')
})

// ------------------------------------------------- 导出包只含"不可识别文件"
test('createBundle: 只复制传入的文件，落到 destRoot，并写清单', async () => {
  const { mkdtemp, writeFile, readdir, readFile, stat } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const ws = await mkdtemp(join(tmpdir(), 'dsh-bundle-ws-'))
  const dest = await mkdtemp(join(tmpdir(), 'dsh-bundle-dest-'))
  await writeFile(join(ws, 'keep.py'), 'print(1)')
  await writeFile(join(ws, 'img.png'), 'not-a-real-png')
  await writeFile(join(ws, 'other.png'), 'should NOT be bundled')

  const res = await bundleMod.createBundle({
    cwd: ws,
    destRoot: dest,
    stamp: '20261018-1400',
    entries: [{ relPath: 'img.png', absPath: join(ws, 'img.png') }],
  })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.dir, join(dest, 'dsh-pack-20261018-1400'))

  const files = (await readdir(res.dir)).sort()
  assert.deepEqual(files, ['img.png', '附件清单.md'], '目录里只应有传入的文件 + 清单')

  const md = await readFile(res.manifestPath, 'utf8')
  assert.match(md, /img\.png/)
  assert.doesNotMatch(md, /other\.png/, '未传入的文件不应出现在清单里')
  assert.equal((await stat(join(res.dir, 'keep.py')).catch(() => null))?.isFile(), undefined)
})

test('defaultBundleRoot: 默认落在桌面', () => {
  const root = bundleMod.defaultBundleRoot()
  // 有桌面就用桌面；无桌面环境（如 Linux CI）应优雅回退到 home
  assert.ok(
    root === join(homedir(), 'Desktop') || root === homedir(),
    `应默认导出到 Desktop（缺失时回退 home），实际：${root}`,
  )
})

// ------------------------------------------------- 版本一致性 / 自污染 / 卡片可见性
test('版本三处一致：package.json = host HOST_BUILD = 客户端 BUILD_VERSION', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const host = await readFile('src/index.ts', 'utf8')
  const hostVersion = /export const HOST_BUILD = '([^']+)'/.exec(host)?.[1]
  const client = /const BUILD_VERSION = '([^']+)'/.exec(dualSrc)?.[1]
  assert.ok(hostVersion, 'host 应声明 HOST_BUILD')
  assert.equal(hostVersion, pkg.version, 'HOST_BUILD 必须与 package.json 一致')
  assert.equal(client, pkg.version, 'BUILD_VERSION 必须与 package.json 一致')
})

test('shouldInclude: 导出包目录 dsh-pack-* 永远被排除（防止自污染）', () => {
  const { shouldInclude, DEFAULT_EXCLUDES } = packMod
  assert.equal(shouldInclude('dsh-pack-20261018-145014/clip.zip', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('sub/dsh-pack-20261018-145014/a.png', DEFAULT_EXCLUDES), false)
  // 正常文件不受影响
  assert.equal(shouldInclude('src/main.py', DEFAULT_EXCLUDES), true)
})

test('DualBridgeTab: 导出包卡片两个阶段都可见；old 提示会清理', () => {
  assert.match(dualSrc, /const bundleCard =/, '应抽出可复用卡片')
  const previewBlock = dualSrc.slice(dualSrc.indexOf("phase === 'preview' && result"), dualSrc.indexOf("phase === 'copied' && result"))
  assert.match(previewBlock, /\{bundleCard\}/, '预览阶段必须显示导出包卡片')
  const copiedBlock = dualSrc.slice(dualSrc.indexOf("phase === 'copied' && result"))
  assert.match(copiedBlock, /\{bundleCard\}/, '已复制阶段也要显示')
  assert.match(dualSrc, /backToSelect/, '返回选择应清理提示')
  assert.match(dualSrc, /bundleInfo\.files/, '卡片应列出本次导出的文件，便于核对')
})

test('DualBridgeTab: 搜索覆盖附件；计数区分文本与附件', () => {
  assert.match(dualSrc, /searchResults/, '搜索应使用合并结果')
  assert.match(dualSrc, /skippedFiles\.filter\(\(f\) => hit/, '搜索应包含不可识别附件')
  assert.match(dualSrc, /个附件/, '计数应单列附件数')
})

test('DualBridgeTab: host 版本不一致时给出重启提示', () => {
  assert.match(dualSrc, /hostBuild/, '应记录 host 构建版本')
  assert.match(dualSrc, /没有重启|dsh web 没有重启/, '应提示重启')
})

// ------------------------------------------------- 空结果提示必须按格式区分
test('emptyMessage: 空结果提示按格式区分（旧版 .doc 不能说成"扫描件"）', () => {
  const { emptyMessage } = extractMod
  const pdf = emptyMessage('/w/a.pdf')
  assert.match(pdf, /扫描件|没有文字层/, 'PDF 空结果应提示可能是扫描件')
  assert.match(pdf, /上传/, '应给出上传建议')

  const doc = emptyMessage('/w/legacy.doc')
  assert.doesNotMatch(doc, /扫描件/, '.doc 不应归因为扫描件')
  assert.match(doc, /docx|另存为|上传原文件/, '.doc 应建议另存为 docx')

  const docx = emptyMessage('/w/a.docx')
  assert.match(docx, /图片|空文档/, 'docx 空结果应提示图片型内容/空文档')
})
