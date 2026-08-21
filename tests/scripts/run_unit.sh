#!/usr/bin/env bash
# 跑 GUT 单元测试
# 用法:bash tests/scripts/run_unit.sh
# 退出码:0 全部通过;非 0 至少 1 个失败
#
# 优先级:
# 1) $GODOT_BIN 环境变量指定的 Godot 可执行文件
# 2) PATH 里 godot / godot4 二选一
# 3) 退出 1 + 提示

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

# 找 Godot
GODOT_BIN="${GODOT_BIN:-}"
if [ -z "${GODOT_BIN}" ]; then
  if command -v godot >/dev/null 2>&1; then
    GODOT_BIN="godot"
  elif command -v godot4 >/dev/null 2>&1; then
    GODOT_BIN="godot4"
  else
    echo "[run_unit] ERROR: godot / godot4 not found in PATH" >&2
    echo "[run_unit] 安装 Godot 4.3+ 并加入 PATH,或设置 GODOT_BIN=/path/to/godot" >&2
    exit 1
  fi
fi

# 装 GUT(若缺)
if [ ! -d "addons/gut" ] || [ ! -f "addons/gut/plugin.cfg" ] && [ ! -f "addons/gut/addons/gut/plugin.cfg" ]; then
  echo "[run_unit] GUT not found, running install_gut.sh"
  bash tests/scripts/install_gut.sh
fi

echo "[run_unit] running GUT via ${GODOT_BIN}"
# 优先用 GUT 自带 cmdln(GUT 9.x 标准方式)
GUT_CMDLN="addons/gut/gut_cmdln.gd"
if [ -f "addons/gut/addons/gut/gut_cmdln.gd" ]; then
  GUT_CMDLN="addons/gut/addons/gut/gut_cmdln.gd"
fi

# 跑 GUT:扫描 tests/unit/ 下所有 test_*.gd
exec "${GODOT_BIN}" --headless --path "${PROJECT_ROOT}" \
  -s "${GUT_CMDLN}" \
  -gdir=res://tests/unit \
  -gprefix=test_ \
  -gexit
