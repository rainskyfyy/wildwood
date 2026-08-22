#!/bin/bash
# Demo 1: 模拟 v0.7 时期"无 .gitignore"状态
# 演示 check-palette-gitignore.py 正确报告

set -e
DEMO_DIR=$(mktemp -d)
echo "=== Demo 1: 模拟 v0.7 时期 (无 .gitignore) ==="
echo "测试目录: $DEMO_DIR"
echo ""

# 模拟污染文件
mkdir -p "$DEMO_DIR/src/__pycache__"
touch "$DEMO_DIR/src/__pycache__/foo.cpython-311.pyc"
touch "$DEMO_DIR/.DS_Store"

# 没有 .gitignore
python3 tools/check-palette-gitignore.py --root "$DEMO_DIR" 2>&1 || true

echo ""
echo "→ 退出码 = 2 (.gitignore 不存在)"
rm -rf "$DEMO_DIR"
