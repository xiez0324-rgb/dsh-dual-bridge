# 发布清单（GitHub + npm + 插件市场）

> 本文件是给维护者的操作手册，不随 npm 包发布。

## 0. 一次性准备

```bash
# 确认三处版本一致（单测会强制）
node -e "console.log(require('./package.json').version)"

# 把仓库地址里的 OWNER 换成你的 GitHub 用户名（package.json / README.md / docs/marketplace-entry.json）
sed -i '' 's/OWNER/<你的GitHub用户名>/g' package.json README.md docs/marketplace-entry.json
```

## 1. 上传 GitHub

```bash
gh auth login                     # 只需一次（浏览器授权）
gh repo create dsh-dual-bridge --public --source=. --remote=origin --push

# 给仓库加 topic，便于 GitHub 侧被搜到 / 被 registry 的发现任务扫到
gh repo edit --add-topic dsh-plugin --add-topic dsh --add-topic deepseek-harness --add-topic cordis
```

> `.gitignore` 已排除 `node_modules/`（440MB）与 `vendor/`（183MB poppler），仓库只有 ~700KB。
> `lib/` 会提交，方便 `dsh plugin add git+https://…` 直接安装而无需本地构建。

## 2. 发布 npm

```bash
npm login          # 浏览器授权（一次性）
npm publish        # prepublishOnly 会自动跑 typecheck + 83 个测试 + 构建
```

发布后核对：<https://www.npmjs.com/package/dsh-dual-bridge>

## 3. 进插件市场

市场**不是**靠 npm 搜索，而是读一份「格式 1」索引（本机配置：
`https://dsh.works/awesome-dsh-plugins/market/index.json`）。该索引由
[`dshworks/awesome-dsh-plugins`](https://github.com/dshworks/awesome-dsh-plugins) 的
`data/plugins.json` 渲染而来。

出现方式有两种：

1. **自动**：仓库定时扫 npm / GitHub topic，新发现先进 `data/candidates.json` 队列，人工审核后入库。
2. **主动（更快）**：向该仓库提 PR，只改 `data/plugins.json`：

```bash
git clone https://github.com/dshworks/awesome-dsh-plugins && cd awesome-dsh-plugins
# 把 docs/marketplace-entry.json 的内容插到 plugins 数组里（按 name 字母序）
node scripts/validate.mjs
node scripts/render.mjs
# 提交两个文件并开 PR
```

条目要点：
- `category`: `plugin`（有 `dsh.bundle` 清单 + npm 包）
- `tags`: `["ui", "capabilities"]`（侧边栏 UI + 本地能力）
- `verifiedAgainst`: 实际测过的 dsh 版本（`0.2.1-rc.2`）
- `status`: 诚实填 `unverified`；要升 `verified` 必须给 `evidence`（指向仓库里能复现安装的文件）
- `engines.dsh` 必须覆盖 `verifiedAgainst`，否则 registry 的 prover 会拒（本包已声明 `>=0.2.1-rc.1 <0.3.0`）

## 4. 发布后自查

```bash
npm pack --dry-run        # 必须不含 vendor/ 与 node_modules
dsh plugin add dsh-dual-bridge   # 在干净 profile 里装一次
dsh web                   # 重启后侧边栏出现「⇄ 分流对话」，徽章 = package.json 版本
```
