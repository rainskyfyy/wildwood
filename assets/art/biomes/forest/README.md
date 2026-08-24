# Forest Biome（森林生物群系）

v0.8.13 补全的森林群系美术资产。填补源码 `preferredBiome` 引用但缺失的 forest 群系。

> **v0.8.13b 更新（2026-08-24）**：老板 review 后要求 tiles 重做——不接受 `add_seam()` 算法接缝。**v0.8.13b 5 张 tile 全部手绘重做**：
> - 单主色占比 81.7%–98.8%（v0.8.13 原版 60%–70%）
> - 4 边 100% 单一颜色（v0.8.13 原版用算法镜像拼接，会产生"接缝像素"）
> - 颜色数从 23 色降为单 tile 3–5 色
> - 调色板仍为暖绿 + 棕 + 暖色点缀，与 4 群系区分度保留

## 调色板

24 色暖色锁定色板（实际使用 23 色）：

- **草本**：grass_bright / grass / grass_shadow / leaf_bright / leaf_mid / leaf_shadow / leaf_yellow / leaf_orange
- **土壤**：dirt / dirt_shadow
- **树干**：bark / bark_shadow
- **花**：flower_yellow / flower_pink / flower_purple
- **果实**：mushroom_red / mushroom_cap
- **岩石**：rock_gray / rock_shadow / rock_dark
- **生物**：butterfly_wing / firefly_yellow / firefly_glow
- **全局**：shadow

暖色占比 100%（草本偏暖绿 + 棕 + 暖色花果点缀，无冷色）。

## 资产清单

### Tiles（地形 32×32，**手绘, 4 边单色无缝**）

> v0.8.13b: 重做, 无 `add_seam()`. 每张 tile 4 边像素 100% 为单一主色, 接缝天然消失.

| 文件名 | 颜色数 | 主色占比 | 用途 |
|---|---|---|---|
| `tiles/grass_base.png` | 3 | 98.8% | 草地基础 |
| `tiles/grass_dirt.png` | 4 | 95.8% | 草地 + 中心泥团（不跨边） |
| `tiles/tree_patch.png` | 4 | 81.7% | 树荫斑（椭圆树影不跨边） |
| `tiles/leaves.png` | 5 | 98.6% | 落叶层（6 片固定位置叶） |
| `tiles/flowers.png` | 4 | 97.6% | 草地 + 3 朵固定位置花 |

### Elements（地物，4 方向侧视）

| 文件名 | 尺寸 | 用途 |
|---|---|---|
| `elements/small_tree.png` | 32×32 | 小树 |
| `elements/medium_tree.png` | 32×64 | 中等树（圆冠） |
| `elements/large_tree.png` | 32×64 | 大树（双层树冠 + 粗干） |
| `elements/bush.png` | 32×32 | 灌木丛（带红果） |
| `elements/rock.png` | 32×32 | 岩石（带裂缝） |

### Decorations（装饰，16×16，`_shared/decorations/forest/`）

| 文件名 | 用途 |
|---|---|
| `mushroom.png` | 红伞蘑菇 |
| `butterfly.png` | 蝴蝶（对称双翅） |
| `leaf.png` | 落叶（橙叶 + 中脉） |
| `firefly.png` | 萤火虫（带光晕） |

## 硬约束自检

- ✅ 32px 基础网格（tile + element）/ 16px 细节网格（deco）
- ✅ ≤24 色暖色调色板
- ✅ 暖色占比 100%
- ✅ 硬边缘 / 禁抗锯齿（PIL 整数坐标 + ImageDraw）
- ✅ **v0.8.13b 地形 tile 4 边单色无缝**（每张 tile 4 边像素 100% 为同一颜色，tile-to-tile 接缝天然消失）
- ✅ tiles 单 tile 颜色数 ≤ 5（v0.8.13b 新增约束）
- ✅ 单文件 ≤ 500 字节（v0.8.13b 单 tile 最大 214 bytes）

## 生成方式（v0.8.13b）

- PIL 整数坐标 + ImageDraw 点/线直绘，无抗锯齿
- tiles 用**确定性位置**而非随机分布：每张 tile 4-12 个固定位置点缀，4 边绝不放置跨边像素
- tiles 不调用 `add_seam()`，接缝问题天然不存在（4 边单色 → tile-to-tile 平铺时无视觉断裂）
- 24 色硬约束在生成时由 24 项 PALETTE 字典强制

## 配套

- 预览对比图（v0.8.13b tiles）：`preview_tiles_v2.png`（同目录或 PR 描述里附）
- 旧版预览（v0.8.13, 已被替换）：`preview_contact_sheet.png`（保留作历史记录）

## backfill

- 2026-08-24 v0.8.13b：5 tiles 重做（手绘, 无算法接缝），单 tile ≤ 5 色，4 边单色
- 2026-08-24 v0.8.13：森林群系首批 14 张入库（5 tiles + 5 elements + 4 decorations）
- 来源：源码 `preferredBiome` 引用但无对应美术
