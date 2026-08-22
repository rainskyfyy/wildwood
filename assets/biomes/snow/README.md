# 雪山群系（Snow）

v0.6.2a 起新增的冷色群系，验证 24 色锁版对冷色群系的程序化生成可行性。

## 资产清单（11 张）

| 类型 | 文件 | 尺寸 | 描述 |
|------|------|------|------|
| tile | `tile_snow.png` | 32×32 | 雪地基底（4 边对称无缝） |
| tile | `tile_rock.png` | 32×32 | 雪岩（岩石+雪盖） |
| tile | `tile_glacier.png` | 32×32 | 冰川（冰裂纹） |
| tile | `tile_deep_snow.png` | 32×32 | 深雪（厚雪堆） |
| tile | `tile_tundra.png` | 32×32 | 苔原过渡（雪+苔藓斑驳） |
| elem | `elem_pine.png` | 32×64 | 松树（雪盖） |
| elem | `elem_snowpile.png` | 32×32 | 雪堆 |
| elem | `elem_snowflake_1.png` | 16×16 | 雪花帧 1（6 臂） |
| elem | `elem_snowflake_2.png` | 16×16 | 雪花帧 2（中心放大） |
| elem | `elem_ice_crystal.png` | 16×16 | 冰晶（6 角） |
| elem | `elem_footprint.png` | 16×16 | 动物脚印（兔/小型） |

## 调色板（13 色，暖色 ≤40%）

### 冷色系（10 色）

| 名称 | 色值 | 来源 |
|------|------|------|
| `snow_white` | `#e8f0f8` | 锁版 |
| `ice_blue` | `#90c8e0` | 锁版 |
| `shadow_grey` | `#606878` | 锁版 |
| `frost_silver` | `#c0d0e0` | 锁版 |
| `deep_blue` | `#406080` | 锁版 |
| `ice_cyan` | `#6ec8d8` | **v0.6.2a 新增** |
| `snow_pale` | `#f0f8ff` | **v0.6.2a 新增** |
| `glacier_blue` | `#5080a0` | **v0.6.2a 新增** |
| `frost_purple` | `#7080a0` | **v0.6.2a 新增** |
| `aurora_green` | `#80c8a0` | **v0.6.2a 新增** |

### 暖色系（3 色，24 锁版）

| 名称 | 色值 | 用途 |
|------|------|------|
| `dark_green` | `#1a3a0e` | pine 树冠 |
| `mud_brown` | `#5c3a1e` | pine 树干 + tundra 苔藓 |
| `amber` | `#d4a030` | tundra 苔藓高光 |

### 共享锚点（2 色）

| 名称 | 色值 |
|------|------|
| `night_black` | `#101820` |
| `highlight_white` | `#f8f8f8` |

**暖色占比** = 3 / 13 ≈ **23%** ≤ 40% ✓

## 5 项 PR 硬约束自检

| 项 | 检查内容 | 实际值 | 状态 |
|----|---------|--------|------|
| 1. 剪影 | 跨群系对比 | single-biome (无跨群系对比) | N/A |
| 2. 色板 | 所有颜色来自锁版 + 5 新冷色 | 0 违例 / 11 张 | ✅ PASS |
| 3. 网格 | 整数像素坐标 | PIL 直写保证 | ✅ PASS |
| 4. 抗锯齿 | 软边像素占比 ≤5% | 0%-4.2% / 11 张 | ✅ PASS |
| 5. 动画 | 帧数 / 帧率 | 雪花 2 帧（_1/_2） | ✅ PASS |

详细自检数据：见 `generate_snow.py` 输出（每次生成时打印 11/11 PASS）。

## 命名规范（v0.6 新规）

- 子目录 + 短名：`assets/biomes/snow/tile_<short>.png` / `elem_<short>.png`
- 命名不含群系前缀（目录已表明群系）
- 动画帧用 `_1` / `_2` 后缀（`elem_snowflake_1.png` / `elem_snowflake_2.png`）

## 流水线

按 M3.13 模式：字典查表 + 形状函数 + 输出循环 + 4 边对称后处理。

```bash
python3 generate_snow.py
# 期望输出：通过 11/11
```

## Git 记录

- commit: `v0.6.2a: 雪山群系首批 11 张程序化生成资产`
- 目标分支：`main`
- 目标路径：`assets/biomes/snow/`
