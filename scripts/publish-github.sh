#!/usr/bin/env bash
# 一键发布到 GitHub：检查授权 → 建仓库（幂等）→ 推送 → 加 topic
# 前提：已 `gh auth login`（浏览器授权，30 秒）
set -euo pipefail

OWNER="xiez0324-rgb"
REPO="dsh-dual-bridge"
TOPICS=(dsh-plugin dsh deepseek-harness cordis)

die() { printf '\n❌ %s\n' "$1" >&2; exit 1; }

command -v gh >/dev/null || die "未安装 gh：brew install gh"
gh auth status >/dev/null 2>&1 || die "还没授权。请先运行：gh auth login（选 GitHub.com → HTTPS → Login with a web browser）"

cd "$(dirname "$0")/.."

printf '▶ 检查远端仓库 %s/%s …\n' "$OWNER" "$REPO"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  printf '  已存在，直接推送\n'
else
  printf '  不存在，创建空仓库\n'
  gh repo create "$REPO" --public \
    --description "分流对话 · Plugins of Conversation Departure — DSH 侧边栏项目上下文打包插件（纯本地，不联网）" >/dev/null
fi

git remote get-url origin >/dev/null 2>&1 || \
  git remote add origin "https://github.com/$OWNER/$REPO.git"

printf '▶ 推送 main …\n'
git push -u origin main

printf '▶ 添加 topics …\n'
for t in "${TOPICS[@]}"; do
  gh repo edit "$OWNER/$REPO" --add-topic "$t" >/dev/null 2>&1 || true
done

printf '\n✅ 完成：https://github.com/%s/%s\n' "$OWNER" "$REPO"
printf '   仓库体积应只有几百 KB（node_modules / vendor 已被 .gitignore 排除）\n\n'
printf '下一步（手动，需要 npm 账号）：\n'
printf '   npm login && npm publish\n'
