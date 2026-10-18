/**
 * 核心逻辑单元测试：验证 pack.ts 的树构建、过滤、token 估算、代码块转义、prompt 组装。
 * 用 node:test + esbuild 转译，node --test 运行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 直接 import 转译后的模块（esbuild 构建时把 pack.ts 打进 lib；这里用 esbuild 动态转译）
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const outfile = join(tmpdir(), 'pack-test-20261017.mjs')
mkdirSync(tmpdir(), { recursive: true })
await build({
  entryPoints: ['src/pack.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const mod = await import(outfile)
const {
  DEFAULT_EXCLUDES, estimateTokens, extLang, shouldInclude,
  buildFileBlock, buildTreeText, assemblePrompt,
} = mod

// ---------- estimateTokens ----------
test('estimateTokens: 估算 token 数量', () => {
  assert.equal(estimateTokens(''), 1)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcdefgh'), 2)
  assert.equal(estimateTokens('你好世界'), 1) // 4 字符 -> 1 token
})

// ---------- extLang ----------
test('extLang: 扩展名到语言映射', () => {
  assert.equal(extLang('main.py'), 'python')
  assert.equal(extLang('app.tsx'), 'tsx')
  assert.equal(extLang('README.md'), 'markdown')
  assert.equal(extLang('noext'), 'text')
  assert.equal(extLang('file.JSON'), 'json') // 大小写不敏感
})

// ---------- shouldInclude ----------
test('shouldInclude: 排除 node_modules/.git 等', () => {
  assert.equal(shouldInclude('node_modules/pkg/index.js', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('src/main.py', DEFAULT_EXCLUDES), true)
  assert.equal(shouldInclude('.git/config', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('.gitignore', DEFAULT_EXCLUDES), true)
})

test('shouldInclude: 排除二进制/图片/压缩包', () => {
  assert.equal(shouldInclude('img/logo.png', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('dist/app.zip', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('src/lib.so', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('src/util.pyc', DEFAULT_EXCLUDES), false)
})

test('shouldInclude: 隐藏文件默认排除（gitignore/.env.example 除外）', () => {
  assert.equal(shouldInclude('.secret', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('.env', DEFAULT_EXCLUDES), false)
  assert.equal(shouldInclude('.env.example', DEFAULT_EXCLUDES), true)
  assert.equal(shouldInclude('.gitignore', DEFAULT_EXCLUDES), true)
})

// ---------- buildFileBlock ----------
test('buildFileBlock: 正常代码块', () => {
  const block = buildFileBlock('a.py', 'print(1)')
  assert.ok(block.includes('### `a.py`'))
  assert.ok(block.includes('```python'))
  assert.ok(block.includes('print(1)'))
})

test('buildFileBlock: 内容含三反引号会被转义，不破坏结构', () => {
  const content = '```js\nconst x = 1\n```'
  const block = buildFileBlock('a.js', content)
  // 转义后应为四反引号，避免提前闭合
  assert.ok(!block.includes('\n```js\nconst x = 1\n```\n```js\n'))
  assert.ok(block.includes('````js'))
  assert.ok(block.includes('const x = 1'))
})

// ---------- buildTreeText ----------
test('buildTreeText: 多层目录树完整重建（修复中间目录丢失）', () => {
  const files = [
    { relPath: 'src/main.py' },
    { relPath: 'src/utils/helper.py' },
    { relPath: 'src/utils/io.py' },
    { relPath: 'README.md' },
  ]
  const tree = buildTreeText(files)
  assert.ok(tree.includes('README.md'), `README.md 应在树中，实际：\n${tree}`)
  assert.ok(tree.includes('src/'), `src/ 目录应出现，实际：\n${tree}`)
  assert.ok(tree.includes('utils/'), `src/utils/ 目录应出现，实际：\n${tree}`)
  assert.ok(tree.includes('main.py'), `src/main.py 应出现，实际：\n${tree}`)
  assert.ok(tree.includes('helper.py'), `src/utils/helper.py 应出现，实际：\n${tree}`)
})

test('buildTreeText: 目录排在文件前、同级按名称排序', () => {
  const files = [
    { relPath: 'z.txt' },
    { relPath: 'a/b.py' },
    { relPath: 'a/c.py' },
  ]
  const tree = buildTreeText(files)
  const aIdx = tree.indexOf('a/')
  const zIdx = tree.indexOf('z.txt')
  const bIdx = tree.indexOf('b.py')
  const cIdx = tree.indexOf('c.py')
  assert.ok(aIdx >= 0 && zIdx >= 0, '目录 a/ 与文件 z.txt 都应存在')
  assert.ok(aIdx < zIdx, `目录应排在文件前：\n${tree}`)
  assert.ok(bIdx < cIdx, `同级按名称排序：\n${tree}`)
})

test('buildTreeText: 空输入返回空串', () => {
  assert.equal(buildTreeText([]), '')
})

// ---------- assemblePrompt ----------
test('assemblePrompt: 组装完整 prompt 且 token 估算正确', () => {
  const files = [
    { relPath: 'main.py', content: 'print(1)' },
    { relPath: 'README.md', content: 'hello' },
  ]
  const tree = buildTreeText(files)
  const pack = assemblePrompt(tree, files)
  assert.ok(pack.prompt.includes('【项目结构】'))
  assert.ok(pack.prompt.includes('【关键文件内容】'))
  assert.ok(pack.prompt.includes('```python'))
  assert.equal(pack.fileCount, 2)
  assert.ok(pack.tokens > 0)
  assert.equal(pack.tokens, estimateTokens(pack.prompt))
})

test('assemblePrompt: 支持附加说明', () => {
  const pack = assemblePrompt('tree', [{ relPath: 'a.py', content: 'x' }], '这是额外说明')
  assert.ok(pack.prompt.includes('【补充说明】'))
  assert.ok(pack.prompt.includes('这是额外说明'))
})

console.log('✅ 单元测试通过：pack.ts 全部断言 OK')
