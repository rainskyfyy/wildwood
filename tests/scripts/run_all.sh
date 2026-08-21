#!/usr/bin/env bash
# 一键跑全部测试(unit + integration + e2e)
# 用法:bash tests/scripts/run_all.sh
# 退出码:任意一层失败即非 0
#
# 沙箱里若 Godot 不可用,unit 和 integration 会被跳过;E2E 仍跑通。

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

GODOT_BIN="${GODOT_BIN:-}"
GODOT_OK=1
if [ -z "${GODOT_BIN}" ]; then
  if command -v godot >/dev/null 2>&1; then
    GODOT_BIN="godot"
  elif command -v godot4 >/dev/null 2>&1; then
    GODOT_BIN="godot4"
  else
    GODOT_OK=0
  fi
fi

EXIT_UNIT=0
EXIT_INTEG=0
EXIT_E2E=0

if [ "${GODOT_OK}" = "1" ]; then
  echo ""
  echo "================  UNIT (GUT)  ================"
  bash tests/scripts/run_unit.sh || EXIT_UNIT=$?

  echo ""
  echo "================  INTEGRATION (Godot)  ================"
  bash tests/scripts/run_integration.sh || EXIT_INTEG=$?
else
  echo "[run_all] godot not found, skipping unit + integration"
  echo "[run_all] set GODOT_BIN=/path/to/godot to enable them"
fi

echo ""
echo "================  E2E (Playwright)  ================"
bash tests/scripts/run_e2e.sh || EXIT_E2E=$?

echo ""
echo "================  SUMMARY  ================"
echo "unit:        ${EXIT_UNIT}"
echo "integration: ${EXIT_INTEG}"
echo "e2e:         ${EXIT_E2E}"

# 任一失败则非 0
if [ "${EXIT_UNIT}" -ne 0 ] || [ "${EXIT_INTEG}" -ne 0 ] || [ "${EXIT_E2E}" -ne 0 ]; then
  exit 1
fi
echo "ALL GREEN"
