#!/usr/bin/env bash
# 跑 Playwright E2E 测试
# 用法:bash tests/scripts/run_e2e.sh
# 退出码:0 全部通过;非 0 至少 1 个失败
#
# 设计:
# - 沙箱/CI 里自动用 mock web export(零依赖 Node 静态服务器)
# - 若环境变量 WILDEWOOD_E2E_BASE_URL 已设置,优先用真实 Godot web build
# - 第一次跑会装 @playwright/test 依赖(已在 package.json 锁定 1.62.1)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}/tests/e2e"

# 1) 装 Node 依赖(若缺)
if [ ! -d "node_modules/@playwright/test" ]; then
  echo "[run_e2e] installing npm dependencies"
  npm install --no-audit --no-fund --silent
fi

# 2) 装 Playwright 浏览器(若缺)
if [ ! -d "${HOME}/.cache/ms-playwright" ]; then
  echo "[run_e2e] installing Playwright browsers"
  npx playwright install --with-deps chromium
fi

# 3) 跑测试(config.ts 里 webServer 自动启 mock 静态服务)
echo "[run_e2e] running Playwright"
exec npx playwright test "$@"
