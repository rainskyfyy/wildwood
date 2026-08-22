#!/bin/bash
# Demo 2: 模拟 v0.7.1a 期间 "只覆盖一半" 状态
# 演示脚本能精准报告缺失条目

set -e
DEMO_DIR=$(mktemp -d)
echo "=== Demo 2: 部分覆盖状态 ==="
echo "测试目录: $DEMO_DIR"
echo ""

# 只覆盖部分必需条目
cat > "$DEMO_DIR/.gitignore" <<'GITIGNORE'
# 只覆盖了一半 (v0.7 真实情况)
__pycache__/
*.pyc
.DS_Store
GITIGNORE

python3 tools/check-palette-gitignore.py --root "$DEMO_DIR" 2>&1 || true
echo ""
echo "→ 退出码 = 1 (8 项缺失)"
rm -rf "$DEMO_DIR"
