# Desert Biome（沙漠生物群系）

M3.13 交付的沙漠群系美术资产。沿用 4 群系共享元素库（森林 → 沙漠），只换主色调与构图比例。

## 调色板

- 6 色暖色锁定色板：沙岩金 / 沙岩浅 / 沙岩中 / 沙岩深 / 琥珀 / 沙漠橙
- 暖色占比 100%
- 高饱和点缀：沙漠琥珀（cactus 仙人掌果）

## 资产清单

### Tiles（地形 32×32，4 边对称无缝）
| 文件名 | 用途 |
|---|---|
| `tiles/sand_base.png` | 沙地基础，64×64 平铺测试通过 |
| `tiles/sand_cracked.png` | 干裂沙地，4 边对称接缝 |
| `tiles/sand_pebbles.png` | 沙砾地，石头与沙地混合 |
| `tiles/dunes.png` | 沙丘，高低落差 |
| `tiles/sand_dry_grass.png` | 沙地干草，绿色点缀 |

### Elements（地物 32×32 / 32×64，4 方向侧视）
| 文件名 | 用途 |
|---|---|
| `elements/cactus.png` | 仙人掌，沙漠标志性 |
| `elements/dead_tree.png` | 枯木，无叶 |
| `elements/rock_outcrop.png` | 岩石露头 |
| `elements/animal_bones.png` | 动物骸骨 |
| `elements/dry_shrub.png` | 干灌木 |

## 硬约束自检

- ✅ 32px 基础 / 16px 细节网格
- ✅ ≤24 色暖色调色板（实际 6 色）
- ✅ 暖色占比 100%
- ✅ 哥特暗黑 × 明亮卡通（高饱和点缀）
- ✅ 硬边缘 / 禁抗锯齿（PIL 直写整数坐标）
- ✅ 地形 tile 4 边对称接缝

## backfill

- 2026-08-22：M3.13 首批 10 张入库
- 来源：飞书云文档 `V0f2dsXDOo1L7CxKsd2cPcDsnGc`（AI 画师交付）
