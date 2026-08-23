#!/usr/bin/env bash
# demo 06 · v0.8.1a 调色板预算 基础模式（默认 warn）
# 期望：PASS with WARN（24 色 5/5 通过；warm% 仅 advisory）
set -e
cd "$(dirname "$0")/../.."

echo "=== demo 06: 调色板预算 基础模式 ==="
echo "期望：5 群系 24 色全过；desert/snow warm% 达标；marsh/volcano/forest warm% advisory"
echo ""

python3 tools/check-palette-budget.py
status=$?

echo ""
echo "实际退出码：$status（0=PASS / 2=PASS with WARN / 1=FAIL）"

if [ "$status" = "0" ] || [ "$status" = "2" ]; then
  echo "✅ 基础模式 PASS"
  exit 0
else
  echo "❌ 基础模式 FAIL"
  exit 1
fi
