# Marsh Biome（沼泽生物群系）

M3.13 交付的沼泽群系美术资产。沿用 4 群系共享元素库（森林 → 沼泽），只换主色调与构图比例。

## 调色板

- 8 色暖色锁定色板（含紫黑沼泽色）：泥岩金 / 泥岩浅 / 泥岩中 / 泥岩深 / 毒紫 / 腐叶棕 / 雾灰 / 毒菌橙
- 暖色占比 73%（毒紫 + 雾灰冷色点缀 27%）
- 高饱和点缀：毒菌橙（poison_mushroom 毒蘑菇）

## 资产清单

### Tiles（地形 32×32，4 边对称无缝）
| 文件名 | 用途 |
|---|---|
| `tiles/mud_base.png` | 泥地基础，64×64 平铺测试通过 |
| `tiles/mud_puddle.png` | 泥水坑，反光水迹 |
| `tiles/mud_grass.png` | 湿地草丛，枯黄草 |
| `tiles/dark_mud.png` | 深泥，4 边对称接缝 |
| `tiles/mud_swamp.png` | 沼泽地，水陆混合 |

### Elements（地物 32×32 / 32×64，4 方向侧视）
| 文件名 | 用途 |
|---|---|
| `elements/dead_tree_vine.png` | 缠藤枯木，藤蔓垂挂 |
| `elements/poison_mushroom.png` | 毒蘑菇，紫色伞盖 |
| `elements/water_reflection.png` | 水面倒影 |
| `elements/fog_patch.png` | 雾团补丁 |
| `elements/fallen_log.png` | 倒下朽木 |

## 硬约束自检

- ✅ 32px 基础 / 16px 细节网格
- ✅ ≤24 色暖色调色板（实际 8 色，含紫黑沼泽色）
- ✅ 暖色占比 73%
- ✅ 哥特暗黑 × 明亮卡通（毒菌橙高饱和点缀）
- ✅ 硬边缘 / 禁抗锯齿（PIL 直写整数坐标）
- ✅ 地形 tile 4 边对称接缝

## backfill

- 2026-08-22：M3.13 首批 10 张入库
- 来源：飞书云文档 `V0f2dsXDOo1L7CxKsd2cPcDsnGc`（AI 画师交付）
