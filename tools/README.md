# tools/ · palette 工具链总览

> v0.8.0c 起的 palette CI 工具集合。覆盖 gitignore 污染源审计 + 调色板预算回归。

## 工具清单

| 工具 | 版本 | 用途 |
|---|---|---|
| `check-palette-gitignore.py` | v0.8.0c | 校验 `.gitignore` 覆盖污染源（__pycache__、.DS_Store 等） |
| `check-palette-budget.py` | v0.8.1a | 校验 5 群系调色板预算（24 色硬约束 + 暖冷色占比） |

---

## v0.8.0c · palette gitignore CI

> 防止 v0.7 那种 `__pycache__/`、`.DS_Store`、`*.pyc` 污染仓库的 CI 校验。

### 为什么需要

v0.7 期间多次出现以下文件被意外提交到 `rainskyfyy/wildwood`：

- `__pycache__/` 目录
- `*.pyc` 编译产物
- `.DS_Store`（macOS Finder 残留）
- `*.egg-info/`（Python 包元数据）
- `Thumbs.db`（Windows 缩略图）

每次都要手动清理 + 改写历史，浪费 token 也增加风险。
v0.8 起，CI 强制校验 `.gitignore` 必须覆盖这些污染源，**未通过则 block merge**。

### 三个交付物

1. **`.gitignore`** — 仓库根目录的完整忽略规则
2. **`tools/check-palette-gitignore.py`** — 校验脚本（REQUIRED_ENTRIES 14 项）
3. **`.github/workflows/check-palette-gitignore.yml`** — CI workflow

### REQUIRED_ENTRIES

| 类别 | 条目 | 说明 |
|---|---|---|
| Python 编译 | `__pycache__/`, `*.pyc`, `*.py[cod]`, `*.egg-info/`, `*.so` | v0.7 主要污染源 |
| OS 残留 | `.DS_Store`, `Thumbs.db` | macOS / Windows |
| 编辑器 | `.vscode/`, `.idea/`, `*.swp` | VSCode / JetBrains / Vim |
| Node | `node_modules/` | v0.6 inventory-svc 残留 |

严格模式额外覆盖：`venv/`、`.env/`、`build/`、`dist/`、`.coverage`、lock 文件等。

### 本地运行

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

### 退出码

| Code | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 缺失必需条目 |
| 2 | 找不到 .gitignore |
| 3 | 调用错误 |

### CI 行为

- **PR 触发**：push / PR 涉及 `.gitignore`、校验脚本、workflow 自身时跑
- **main 分支额外跑严格模式**：扫描已跟踪的污染源
- **手动触发**（workflow_dispatch）：审计现有仓库用
- **失败后果**：CI 红色 → 必须补齐缺失项才能 merge

### 维护

新增常见污染源时，编辑 `tools/check-palette-gitignore.py` 顶部的：

```python
REQUIRED_ENTRIES: List[str] = [
    ...
]
```

并同步补到 `.gitignore` 里。

---

## v0.8.1a · palette budget regression CI

> 5 群系调色板预算回归测试，确保每个群系 PNG 真实调色板用量在 24 色预算内。

### 为什么需要

v0.8.0c 解决了"开发工具污染仓库"问题。v0.8.1a 解决"调色板超预算"问题：

- M3.13 沿用 24 色锁版色板，PR 硬约束自检里"色板 0 违例"靠人工核对
- 实际 PNG 调色板用量 = 手写调色板 + 抗锯齿过渡色 + 锚点色，**常超过声明的 8 色**
- 暖色群系 (desert/marsh/volcano) 规范暖色 ≥70%，但实际冷色元素（蓝灰水迹、深蓝熔渣）让真实暖色占比降到 60-67%
- 没有 CI 校验，每次新增群系都得手动数 PNG 调色板

### 三个交付物

1. **`tools/check-palette-budget.py`** — 校验脚本（扫 5 群系 PNG + 真实调色板分析 + 24 色硬约束 + 暖冷色占比）
2. **`.github/workflows/check-palette-budget.yml`** — CI workflow
3. **`tools/demo/06-07-palette-budget-*.sh`** — demo 脚本

### 5 群系预算

| 群系 | 路径 | 暖色目标 | 24 色预算 | 当前真实 |
|---|---|---|---|---|
| desert | `assets/art/biomes/desert/{tiles,elements}/*.png` | ≥70% | ≤24 | 11 / 77.8% ✅ |
| marsh | `assets/art/biomes/marsh/{tiles,elements}/*.png` | ≥70% | ≤24 | 14 / 63.6% ⚠️ |
| volcano | `assets/art/biomes/volcano/{tiles,elements}/*.png` | ≥70% | ≤24 | 8 / 66.7% ⚠️ |
| snow | `assets/biomes/snow/{tile,elem}_*.png` | ≤40% | ≤24 | 13 / 22.2% ✅ |
| forest | `assets/art/biomes/_shared/decorations/forest/*.png` | ≥70% | ≤24 | 6 / 50.0% ⚠️ |

> 当前真实数据基于 2026-08-22 v0.8.1a 回归测试快照（commit ac1e6183）

### 本地运行

```bash
# 基础模式 (24 色硬约束 fail, warm% advisory)
python3 tools/check-palette-budget.py

# 严格模式 (24 色 + warm% 都 fail, 用于审计暖色 gap)
python3 tools/check-palette-budget.py --strict

# 自定义预算上限
python3 tools/check-palette-budget.py --budget 16

# JSON 输出 (CI 集成)
python3 tools/check-palette-budget.py --json
```

### 退出码

| Code | 含义 |
|---|---|
| 0 | 全部 PASS（24 色 + warm% 都达标） |
| 1 | FAIL（24 色超限 / --strict 模式下 warm% 不达） |
| 2 | PASS with WARN（24 色通过；warm% 仅 advisory，提示不达） |

### CI 行为

- **PR 触发**：涉及群系 PNG / 校验脚本 / workflow 自身时跑基础模式
- **main 分支额外跑严格模式**：审计 3 群系暖色 gap 状态
- **手动触发**：日常审计用
- **失败后果**：
  - 基础模式 FAIL → 必须修群系 PNG 才能 merge
  - WARN 不阻止 merge，但建议在 PR 评论里说明暖色 gap 原因

### 暖色占比判定口径

- **warm**: hue ∈ [0°, 60°] ∪ (300°, 360°]，saturation ≥ 20%
- **cool**: hue ∈ (60°, 300°]，saturation ≥ 20%
- **neutral**: 灰度差 < 24 / 极暗 (max<32) / 极亮 (min>240) / 低饱和 (sat<20%)

暖色占比 = `warm_count / (warm_count + cool_count)` × 100%
neutral 不计入分母，符合 M3.13 调色板规范口径。

### 已知 gap（warm% 不达 70%）

| 群系 | warm% | 差距 | 冷色来源 | 建议 v0.8.2 跟进 |
|---|---|---|---|---|
| marsh | 63.6% | -6.4% | mud_puddle 蓝灰水迹 (474px) / fog_patch 青灰雾 (162px) | 重画 mud_puddle 改暖灰反光 |
| volcano | 66.7% | -3.3% | magma_crack 深蓝熔渣 (1766px) / lava_pool 浅蓝反光 (274px) | magma_crack 改深橙灰 |
| forest | 50.0% | -20.0% | flower_bush 蓝花 (35px) / mushroom 绿叶 (12px) | flower_bush 改暖色花 |

### 维护

新增群系时：
1. 在 `tools/check-palette-budget.py` 顶部的 `REPO_TREE` 加群系配置（路径 pattern + 暖色目标）
2. 在 README 上面"5 群系预算"表加一行
3. 在 `tools/demo/` 加 demo 脚本

调整暖色占比判定时：
1. 编辑 `check-palette-budget.py` 的 `classify_warm()` 函数
2. 同时更新 master.md / 飞书云文档里的判定口径说明

---

## 版本

| 版本 | 日期 | 关键变更 |
|---|---|---|
| v0.8.0c | 2026-08-22 | palette gitignore CI 14 项 REQUIRED_ENTRIES |
| v0.8.1a | 2026-08-22 | palette budget regression CI 5 群系 24 色预算 + 暖冷色占比 advisory |
