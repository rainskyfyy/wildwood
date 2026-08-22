# palette gitignore CI · v0.8.0c

> 防止 v0.7 那种 `__pycache__/`、`.DS_Store`、`*.pyc` 污染仓库的 CI 校验。

## 为什么需要

v0.7 期间多次出现以下文件被意外提交到 `rainskyfyy/wildwood`：

- `__pycache__/` 目录
- `*.pyc` 编译产物
- `.DS_Store`（macOS Finder 残留）
- `*.egg-info/`（Python 包元数据）
- `Thumbs.db`（Windows 缩略图）

每次都要手动清理 + 改写历史，浪费 token 也增加风险。
v0.8 起，CI 强制校验 `.gitignore` 必须覆盖这些污染源，**未通过则 block merge**。

## 三个交付物

1. **`.gitignore`** — 仓库根目录的完整忽略规则
2. **`tools/check-palette-gitignore.py`** — 校验脚本（REQUIRED_ENTRIES 14 项）
3. **`.github/workflows/check-palette-gitignore.yml`** — CI workflow

## REQUIRED_ENTRIES

| 类别 | 条目 | 说明 |
|---|---|---|
| Python 编译 | `__pycache__/`, `*.pyc`, `*.py[cod]`, `*.egg-info/`, `*.so` | v0.7 主要污染源 |
| OS 残留 | `.DS_Store`, `Thumbs.db` | macOS / Windows |
| 编辑器 | `.vscode/`, `.idea/`, `*.swp` | VSCode / JetBrains / Vim |
| Node | `node_modules/` | v0.6 inventory-svc 残留 |

严格模式额外覆盖：`venv/`、`.env/`、`build/`、`dist/`、`.coverage`、lock 文件等。

## 本地运行

```bash
# 基础模式
python3 tools/check-palette-gitignore.py

# 严格模式
python3 tools/check-palette-gitignore.py --strict

# JSON 输出 (CI 集成)
python3 tools/check-palette-gitignore.py --json

# 打印当前必需条目列表 (供 setup 阶段生成)
python3 tools/check-palette-gitignore.py --print-required
```

## 退出码

| Code | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 缺失必需条目 |
| 2 | 找不到 .gitignore |
| 3 | 调用错误 |

## CI 行为

- **PR 触发**：push / PR 涉及 `.gitignore`、校验脚本、workflow 自身时跑
- **main 分支额外跑严格模式**：扫描已跟踪的污染源
- **手动触发**（workflow_dispatch）：审计现有仓库用
- **失败后果**：CI 红色 → 必须补齐缺失项才能 merge

## 维护

新增常见污染源时，编辑 `tools/check-palette-gitignore.py` 顶部的：

```python
REQUIRED_ENTRIES: List[str] = [
    ...
]
```

并同步补到 `.gitignore` 里。
