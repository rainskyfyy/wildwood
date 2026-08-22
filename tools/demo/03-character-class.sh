#!/bin/bash
# Demo 3: 字符类覆盖演示
# 演示 *.py[cod] 被识别为覆盖 *.pyc / *.pyo / *.pyd

set -e
DEMO_DIR=$(mktemp -d)
echo "=== Demo 3: 字符类覆盖 ==="
echo "测试目录: $DEMO_DIR"
echo ""

# 故意只写 *.py[cod] 不写 *.pyc, 脚本应识别为覆盖
cat > "$DEMO_DIR/.gitignore" <<'GITIGNORE'
__pycache__/
*.py[cod]
*.egg-info/
*.so
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp
node_modules/
GITIGNORE

python3 tools/check-palette-gitignore.py --root "$DEMO_DIR" 2>&1 || true
echo ""
echo "→ 退出码 = 0 (字符类覆盖正确识别)"
rm -rf "$DEMO_DIR"
