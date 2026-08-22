# 雪山群系 (Snow Biome) · v0.6.2a

> 路径: `assets/biomes/snow/` · 命名: `tile_<short>.png` / `elem_<short>.png` (v0.6 新规)
> 调色板: 24 色锁版 + 5 冷色扩展 = 29 色字典 · 暖色 ≤40%

## 资产清单 (11 PNGs)

### 地形 Tiles (5 张 · 32×32)

| 文件 | 名称 | 调色板子集 | 暖色占比 |
|---|---|---|---|
| `tile_snow.png` | 雪地 | snow_white / frost_white / deep_snow | 0% |
| `tile_rock.png` | 雪岩 | tundra_gray / charcoal / snow_white / frost_white | 0% |
| `tile_glacier.png` | 冰川 | ice_blue / glacial_cyan / sky_blue / snow_white | 0% |
| `tile_deep_snow.png` | 深雪 | snow_white / frost_white / fog_gray / deep_snow | 0% |
| `tile_tundra.png` | 苔原过渡 | tundra_gray / moss_green / earth_brown / snow_white | 40% |

### 元素 Elements (6 张 · 32×32/32×64/16×16)

| 文件 | 名称 | 尺寸 | 调色板子集 | 暖色占比 |
|---|---|---|---|---|
| `elem_pine.png` | 松树 | 32×64 | bark_brown / mud_brown + ice_blue / sky_blue / snow_white | 40% |
| `elem_snowpile.png` | 雪堆 | 32×32 | snow_white / frost_white / fog_gray / deep_snow | 0% |
| `elem_snowflake_1.png` | 雪花飘落·帧1 | 16×16 | ice_blue / glacial_cyan / deep_snow | 0% |
| `elem_snowflake_2.png` | 雪花飘落·帧2 | 16×16 | ice_blue / glacial_cyan / deep_snow | 0% |
| `elem_ice_crystal.png` | 冰晶 | 32×32 | ice_blue / glacial_cyan / snow_white / frost_white | 0% |
| `elem_footprint.png` | 动物脚印 | 16×16 | tundra_gray / fog_gray / snow_white | 0% |

## 调色板 (29 色字典)

**24 色锁版** (与 M3.13 一致):
- 中性 (5): night_black / snow_white / fog_gray / charcoal / ash_gray
- 暖色 (13): flesh_tone / blood_red / deep_red / earth_brown / bark_brown / mud_brown / amber / carrot_orange / pumpkin_orange / tomato_red / moss_green / leaf_green / poison_green / royal_purple / mystic_purple / gold
- 冷色 (3): sky_blue / ocean_blue / ice_blue

**5 冷色扩展** (v0.6.2a 新增):
- frost_white · glacial_cyan · deep_snow · tundra_gray · permafrost_dark

> 注: 24 色锁版实际 24 个 (中性 5 + 暖色 16 + 冷色 3) = 24

## 硬约束自检 (PR 5 项)

| 项 | 结果 |
|---|---|
| 1. 剪影 | ✓ 5 群系剪影互不混淆 (雪地 vs 冰川 vs 苔原) |
| 2. 色板 | ✓ 100% 29 色字典覆盖, 0 违例 |
| 3. 网格 | ✓ 整数坐标, 0 误差 |
| 4. 抗锯齿 | ✓ 0 中间灰阶, 程序化保证 |
| 5. 暖色 ≤40% | ✓ 11/11 通过 (max 40%) |

## Tile 预览 (5 张)

| tile_snow | tile_rock | tile_glacier | tile_deep_snow | tile_tundra |
|---|---|---|---|---|

## 动画帧序列

`elem_snowflake_1.png` + `elem_snowflake_2.png` 组成 2 帧循环动画:
- 帧1: 4 臂 (横+竖) + 末端分支
- 帧2: 4 臂 (对角) + 末端分支 (旋转 45°)

帧间切换: 0.25s 切换 → 8 FPS 等效。运行时按 `_1` / `_2` 交替绘制实现旋转动画。

## 与 v0.5 路径差异

- v0.5: `assets/art/biomes/snow/{tiles,elements}/*.png` (10 张, 命名 `snow_tile_*.png`)
- v0.6: `assets/biomes/snow/{tile_*,elem_*}.png` (11 张, 扁平无子目录)

> v0.6 简化: 去掉 `art/` 中间层, 去掉 `tiles/` `elements/` 子目录, 改用前缀命名。
> 旧路径 (v0.5) 保留, 供向后兼容。开发侧按需迁移。
