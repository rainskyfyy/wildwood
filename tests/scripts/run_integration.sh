#!/usr/bin/env bash
# 跑 Godot 集成测试
# 用法:bash tests/scripts/run_integration.sh [--filter <substring>]
# 退出码:0 全部通过;非 0 至少 1 个失败

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

GODOT_BIN="${GODOT_BIN:-}"
if [ -z "${GODOT_BIN}" ]; then
  if command -v godot >/dev/null 2>&1; then
    GODOT_BIN="godot"
  elif command -v godot4 >/dev/null 2>&1; then
    GODOT_BIN="godot4"
  else
    echo "[run_integration] ERROR: godot / godot4 not found in PATH" >&2
    exit 1
  fi
fi

echo "[run_integration] running via ${GODOT_BIN}"
exec "${GODOT_BIN}" --headless --path "${PROJECT_ROOT}" \
  -s "res://tests/integration/run_integration.gd" \
  "$@"
