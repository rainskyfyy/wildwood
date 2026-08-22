#!/bin/bash
# Demo 4: 严格模式审计
# 演示 --strict 能捕获 venv/、lock 文件、IDE 缓存等额外污染

set -e
DEMO_DIR=$(mktemp -d)
echo "=== Demo 4: 严格模式 (--strict) ==="
echo "测试目录: $DEMO_DIR"
echo ""

# 只有基础 11 项, 缺严格模式要求的 20 项
cat > "$DEMO_DIR/.gitignore" <<'GITIGNORE'
__pycache__/
*.pyc
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

python3 tools/check-palette-gitignore.py --strict --root "$DEMO_DIR" 2>&1 | tail -20 || true
echo ""
echo "→ 退出码 = 1 (严格模式额外要求多项覆盖)"
rm -rf "$DEMO_DIR"
