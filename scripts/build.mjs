/**
 * 构建脚本：把 src/ 编译成 DSH 可加载的 lib/
 *  - lib/index.js  (host，node，ESM)
 *  - lib/client.js (client，web，DSH ModuleLoader 协议)
 *
 * DSH client 模块协议（对照 dsh-better-sidebar/lib/client.js 与
 * dsh-client-modules 源码注释）：
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory: (require) => exports —— factory 体内定义 module/exports，
 *   external 依赖（react / dsh-better-sidebar 等）经 factory 的 require
 *   同步解析，由运行时提供。
 *
 * 构建方式：esbuild 以 CJS 格式打包（external 保留 require(...)），
 * 再用 ModuleLoader 协议包裹 factory。
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

const external = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  'dsh-better-sidebar', 'dsh-better-sidebar/client',
  '@deepseek-ai/*',
  // OCR：WASM 引擎及其训练数据是运行时依赖，不打进 bundle
  'tesseract.js',
  '@tesseract.js-data/*',
]

async function main() {
  // host 端（node）
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external,
    sourcemap: true,
    logLevel: 'info',
  })

  // client 端：CJS 格式
  await build({
    entryPoints: ['src/client.tsx'],
    outfile: 'lib/_client_cjs.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external,
    jsx: 'automatic',
    sourcemap: false,
    logLevel: 'info',
  })

  // 用 ModuleLoader 协议包裹 factory
  const cjsBody = readFileSync('lib/_client_cjs.js', 'utf8')
  const wrapped = `window.__ModuleLoader__.load({
  id: 'dsh-dual-bridge',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${cjsBody}
    return module.exports;
  },
});
`
  writeFileSync('lib/client.js', wrapped)
  rmSync('lib/_client_cjs.js')
  console.log('✅ 构建完成：lib/index.js (host) + lib/client.js (client, ModuleLoader 协议)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
