#!/bin/bash
# Demo 5: 扫描已跟踪的污染文件
# 用 git init 模拟 v0.7 状态: 已经有 .gitignore, 但历史已污染

set -e
DEMO_DIR=$(mktemp -d)
echo "=== Demo 5: 已跟踪污染源扫描 ==="
echo "测试目录: $DEMO_DIR"
echo ""

# 在子 shell 里初始化污染 git 仓库, 避免影响 cwd
(
    cd "$DEMO_DIR"
    git init -q
    git config user.email demo@example.com
    git config user.name "Demo"

    # 完整的 .gitignore (本次修复后的版本)
    cat > .gitignore <<'GITIGNORE'
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

    # 假装 v0.7 时代已经被跟踪的污染文件
    # 用 -f 强制 add (当时 .gitignore 不完整, 这些文件被意外提交)
    mkdir -p src/__pycache__ scripts/__pycache__ .vscode node_modules/.bin
    touch src/__pycache__/foo.cpython-311.pyc
    touch scripts/__pycache__/bar.cpython-310.pyc
    touch .DS_Store
    touch .vscode/settings.json
    touch node_modules/.bin/jest

    git add -f -A
    git commit -q -m "v0.7 demo: 污染文件被跟踪"
)

# 跑 check (在仓库根目录运行, 把 DEMO_DIR 作为 --root 传入)
python3 tools/check-palette-gitignore.py --root "$DEMO_DIR" 2>&1 || true
echo ""
echo "→ 退出码 = 1 (发现已跟踪的污染文件, 需 git rm -r --cached)"
echo "→ 修复方式: git rm -r --cached <file> + 加 .gitignore 条目"

rm -rf "$DEMO_DIR"
