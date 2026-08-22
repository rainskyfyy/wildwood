# v0.7.1a 调色板字典升级

升级 24 色锁版调色板字典，从"纯 hex 字典"升级为"warm/cold/neutral 三档 + biome_affinity 标签 + 暖色预算规则"。**核心收益：generate 阶段就能预算暖色占比，不再后置试错**。

## 目录结构

```
v0_7_1a_palette/
├── palette/
│   ├── palette_v2.py            # 29 色新字典（24 锁版 + 5 扩展）
│   └── palette_v1_legacy.py     # v0.5/v0.6 旧字典（兼容保留）
├── generate/
│   └── generate_v2.py           # 新生成器（PaletteBudget 暖色预算）
├── validate/
│   └── validate_v2.py           # 新校验器（5 项 PR + 暖色占比）
├── demo/
│   └── output/                  # 4 张 snow 群系 demo PNG
├── push_to_github_v2.py         # 支持 --branch 的 push 脚本
└── README.md                    # 本文件
```

## 字典结构（v0.7.1a）

```python
# palette_v2.py 简化版
WARM_COLORS = {
    "forest_green": {"hex": "#2d5a1e", "category": "warm",
                     "biome_affinity": ["forest", "plains"], "role_hint": "树冠深色"},
    "desert_gold":  {"hex": "#c4a03a", "category": "warm",
                     "biome_affinity": ["desert", "plains"], "role_hint": "沙金"},
    # ... 18 暖色
}

COLD_COLORS = {
    "snow_white":   {"hex": "#e8f0f8", "category": "cold",
                     "biome_affinity": ["snow", "tundra"], "role_hint": "雪白主色"},
    # ... 5 冷色
}

NEUTRAL_COLORS = {
    "ash_grey":     {"hex": "#888888", "category": "neutral", ...},
    # 1 中性
}

LOCKED_24 = {**WARM_COLORS, **COLD_COLORS, **NEUTRAL_COLORS}  # 24 锁版
EXTENDED_5 = {basalt_black, charcoal, night_black, highlight_white, poison_orange}
NEW_PALETTE_29 = {**LOCKED_24, **EXTENDED_5}  # 29 总色

BIOME_WARM_BUDGET = {
    "forest":  {"max_warm_pct": 100, "min_warm_pct": 70},
    "desert":  {"max_warm_pct": 100, "min_warm_pct": 60},
    "snow":    {"max_warm_pct": 40,  "min_warm_pct": 0},   # v0.6 新规
    "volcano": {"max_warm_pct": 90,  "min_warm_pct": 50},
    # ...
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `hex` | str | 是 | 色值 `#RRGGBB`，与旧字典 100% 兼容 |
| `category` | str | 是 | `warm` / `cold` / `neutral` 三档 |
| `biome_affinity` | list | 是 | 群系亲缘度，可属于多群系 |
| `role_hint` | str | 否 | 用途提示（开发参考） |

## 核心收益：generate 阶段预算暖色占比

### 旧版流程（v0.5/v0.6）

```
1. 用 PALETTE_LEGACY_24.get("dark_green") 查色 → 写代码生成
2. PR 阶段：validate.py 跑色板违例检查 → 发现暖色 75% 超 snow 预算 40% → 返工
```

### 新版流程（v0.7.1a）

```
1. 创建 PaletteBudget(biome="snow")
2. p.pick("dark_green") → 自动校验暖色预算 → 超预算自动换冷色 → 立即修正
3. 输出 PNG 时 palette.summary() 打印暖色占比 → 已 PASS
4. PR 阶段：validate_v2.py 校验 → 一次过
```

### 实证：elem_pine pine 测试

```
原始需求: 树冠 dark_green (暖) + 中色 forest_green (暖) + 树干 mud_brown (暖) + 雪盖 snow_white (冷)
= 3 暖 + 1 冷 = 75% 暖色 ❌ snow 预算 ≤ 40%

PaletteBudget 自动修正:
  - p.pick("mud_brown") → 模拟后 100% 暖色 → 自动替换为 snow_white
  - p.pick("dark_green") → 模拟后 50% 暖色 → 自动替换为 frost_silver
  - p.pick("forest_green") → 模拟后 33% 暖色 → PASS
最终色板: snow_white + frost_silver + forest_green = 33% 暖色 ✓
```

## 兼容性策略

| 群系 | 字典 | 状态 |
|------|------|------|
| v0.5 沙漠/沼泽/熔岩 | PALETTE_LEGACY_24 | 已上线资产沿用，不强制迁移 |
| v0.6.2a 雪山 | PALETTE_LEGACY_24 + PALETTE_V062A_SNOW_EXT | 已上线资产沿用 |
| v0.7.1a+ 新群系 | NEW_PALETTE_29 | 强制使用，warm/cold 预算校验 |

**设计取舍**：v0.7.1a 字典与 v0.5/v0.6 旧字典**共存**，新群系用新字典，旧资产不返工。

## 5 项 PR 硬约束自检（v0.7.1a 升级版）

| 项 | 检查内容 | 工具 |
|----|---------|------|
| 1. 调色板违例 | 所有颜色 ∈ NEW_PALETTE_29 (29 = 24 锁版 + 5 扩展) | `validate_v2.py` |
| 2. 暖色预算 | 群系 + 已用色 → 实际暖色占比 ∈ 预算区间 | `validate_v2.py` + `PaletteBudget` |
| 3. 网格 | 整数像素坐标 | PIL `putpixel` 保证 |
| 4. 抗锯齿 | 无中间灰阶像素 | palette-only `putpixel` 保证 |
| 5. 尺寸 | 16×16 / 32×32 / 32×64 (按文件名前缀) | `validate_v2.py` |

## 跑 demo

```bash
# 1. 生成 4 张 snow 群系 demo PNG
cd generate
python3 generate_v2.py

# 2. 校验 demo
cd ../validate
python3 validate_v2.py ../demo/output --biome snow
# 期望: PASS 4/4
```

## 推送 GitHub

```bash
python3 push_to_github_v2.py \
  --token $GH_TOKEN \
  --repo rainskyfyy/wildwood \
  --source . \
  --target assets/tools/palette/v0.7.1a \
  --branch feat/v0.7.1a-palette \
  --message "v0.7.1a: 调色板字典升级 — warm/cold 标签 + biome_affinity 字段"
```

## 设计局限 & 后续 v0.7.2 扩展点

1. **elem_pine pine 树冠变灰**：PaletteBudget 严格按预算替换暖色，导致树冠变灰（视觉变差）。
   解决方向：v0.7.2 引入 `essential_warm` / `optional_warm` 子分类，essential 色（如树冠深色）允许破例。
2. **biome_affinity 字典维护**：新增群系需要手动维护 biome_affinity 字段，未来可用规则生成（如 `warm + desert → 自动归属 desert`）。
3. **生成器对 PIL 依赖较强**：demo 是 32×32/16×16 硬编码，未来可参数化为通用形状库。

## 模板沉淀

`generate_v2.py` + `validate_v2.py` + `palette_v2.py` 已沉淀到 `pixel-art-production` skill 的 `references/` 目录，作为新群系开发的默认模板。
