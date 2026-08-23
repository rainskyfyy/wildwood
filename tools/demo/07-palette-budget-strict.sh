#!/usr/bin/env bash
# demo 07 · v0.8.1a 调色板预算 严格模式（warm% 也 fail）
# 期望：FAIL（24 色 5/5 通过；marsh/volcano/forest warm% 不达 70%）
set -e
cd "$(dirname "$0")/../.."

echo "=== demo 07: 调色板预算 严格模式 ==="
echo "期望：5 群系 24 色全过；marsh/volcano/forest warm% 不达 70% → FAIL"
echo "（用于在 main 上定期审计 3 群系暖色 gap）"
echo ""

python3 tools/check-palette-budget.py --strict
status=$?

echo ""
echo "实际退出码：$status（0=PASS / 1=FAIL）"

if [ "$status" = "1" ]; then
  echo "✅ 严格模式正确 FAIL（暴露暖色 gap）"
  exit 0
elif [ "$status" = "0" ]; then
  echo "⚠️  严格模式意外 PASS（3 群系暖色 gap 可能已修复）"
  exit 0
else
  echo "❌ 严格模式异常退出"
  exit 1
fi
