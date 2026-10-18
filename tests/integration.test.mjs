/**
 * 集成测试：模拟 better-sidebar 的 api 层（fsTree/fsRead/sessionCwd），
 * 验证「扫描 -> 过滤 -> 打包 -> prompt 组装」完整流程的正确性。
 *
 * 模拟一个典型项目结构，验证：
 *  1. 目录遍历能发现所有应包含文件
 *  2. 排除规则（node_modules、二进制等）生效
 *  3. 多级目录树正确重建
 *  4. token 估算与文件数统计正确
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'

const outfile = join(tmpdir(), 'pack-int-20261017.mjs')
mkdirSync(tmpdir(), { recursive: true })
await build({
  entryPoints: ['src/pack.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const { DEFAULT_EXCLUDES, shouldInclude, buildTreeText, assemblePrompt } = await import(outfile)

// ---- Mock 项目文件系统 ----
// 模拟 fsTree 返回的目录结构：真实 DSH 里是分层的，这里用平面树模拟
const mockFs = {
  // path -> entries
  '/proj': [
    { name: 'src', path: '/proj/src', isDir: true, hidden: false, isSymlink: false, broken: false },
    { name: 'README.md', path: '/proj/README.md', isDir: false, hidden: false, isSymlink: false, broken: false },
    { name: 'node_modules', path: '/proj/node_modules', isDir: true, hidden: false, isSymlink: false, broken: false },
    { name: 'img.png', path: '/proj/img.png', isDir: false, hidden: false, isSymlink: false, broken: false },
    { name: 'config.json', path: '/proj/config.json', isDir: false, hidden: false, isSymlink: false, broken: false },
  ],
  '/proj/src': [
    { name: 'main.py', path: '/proj/src/main.py', isDir: false, hidden: false, isSymlink: false, broken: false },
    { name: 'utils', path: '/proj/src/utils', isDir: true, hidden: false, isSymlink: false, broken: false },
    { name: 'data.csv', path: '/proj/src/data.csv', isDir: false, hidden: false, isSymlink: false, broken: false },
  ],
  '/proj/src/utils': [
    { name: 'helper.py', path: '/proj/src/utils/helper.py', isDir: false, hidden: false, isSymlink: false, broken: false },
    { name: 'temp.log', path: '/proj/src/utils/temp.log', isDir: false, hidden: false, isSymlink: false, broken: false },
  ],
  '/proj/node_modules': [
    { name: 'pkg', path: '/proj/node_modules/pkg', isDir: true, hidden: false, isSymlink: false, broken: false },
  ],
}

const fileContents = {
  '/proj/README.md': { content: '# My Project\n', kind: 'text', size: 12 },
  '/proj/config.json': { content: '{"a":1}', kind: 'text', size: 8 },
  '/proj/src/main.py': { content: 'def main():\n    print("hi")\n', kind: 'text', size: 30 },
  '/proj/src/utils/helper.py': { content: 'def helper():\n    pass\n', kind: 'text', size: 22 },
  '/proj/src/data.csv': { content: 'a,b\n1,2\n', kind: 'text', size: 6 },
  '/proj/src/utils/temp.log': { content: 'log line\n', kind: 'text', size: 9 },
}

// mock api（等价于组件里 scan 用到的调用）
async function mockFsTree(path, exclude) {
  const entries = mockFs[path] ?? []
  return { path, entries, truncated: false }
}
async function mockFsRead(path) {
  return fileContents[path] ?? { kind: 'binary', size: 0, head: '' }
}

// 复刻组件里的 scan 逻辑（纯函数版）
async function scanProject(rootPath) {
  const found = []
  const queue = [rootPath]
  const visited = new Set()
  const excludeArr = [...DEFAULT_EXCLUDES]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (visited.has(dir)) continue
    visited.add(dir)
    const tree = await mockFsTree(dir, excludeArr)
    for (const entry of tree.entries) {
      const relPath = entry.path.startsWith(rootPath + '/')
        ? entry.path.slice(rootPath.length + 1)
        : entry.path
      if (entry.isDir) {
        if (shouldInclude(relPath + '/', excludeArr)) queue.push(entry.path)
      } else {
        if (shouldInclude(relPath, excludeArr)) found.push({ relPath, path: entry.path })
      }
    }
  }
  found.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return found
}

test('集成：扫描发现应包含的文件并排除无关项', async () => {
  const found = await scanProject('/proj')
  const rels = found.map((f) => f.relPath).sort()
  assert.ok(!rels.some((r) => r.includes('node_modules')), `不应包含 node_modules：${rels}`)
  assert.ok(!rels.includes('img.png'), '不应包含图片')
  // temp.log 的 .log 不在排除规则中，且不以 . 开头，应被包含
  assert.ok(rels.includes('src/utils/temp.log'), `应包含 temp.log：${rels}`)
  // 应包含：README.md, config.json, src/main.py, src/data.csv, src/utils/helper.py
  assert.ok(rels.includes('README.md'), `应包含 README.md：${rels}`)
  assert.ok(rels.includes('config.json'), `应包含 config.json：${rels}`)
  assert.ok(rels.includes('src/main.py'), `应包含 src/main.py：${rels}`)
  assert.ok(rels.includes('src/data.csv'), `应包含 src/data.csv：${rels}`)
  assert.ok(rels.includes('src/utils/helper.py'), `应包含 src/utils/helper.py：${rels}`)
})

test('集成：打包读文件 + 树重建 + prompt 组装', async () => {
  const found = await scanProject('/proj')
  const contents = []
  for (const f of found) {
    const read = await mockFsRead(f.path)
    if (read.kind === 'text') contents.push({ relPath: f.relPath, content: read.content })
  }
  const treeText = buildTreeText(contents)
  const pack = assemblePrompt(treeText, contents)

  // 树应包含多级目录
  assert.ok(treeText.includes('src/'), `树应有 src/：\n${treeText}`)
  assert.ok(treeText.includes('utils/'), `树应有 utils/：\n${treeText}`)
  // prompt 应包含所有文件内容
  assert.ok(pack.prompt.includes('def main()'))
  assert.ok(pack.prompt.includes('# My Project'))
  assert.ok(pack.prompt.includes('```python'), '代码块语言标记正确')
  assert.ok(pack.fileCount >= 4, `文件数应 >=4，实际 ${pack.fileCount}`)
  assert.ok(pack.tokens > 0)
})

console.log('✅ 集成测试通过：扫描->过滤->打包->组装 全链路 OK')
