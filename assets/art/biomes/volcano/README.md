# Volcano Biome（熔岩生物群系）

M3.13 v2 交付的熔岩群系美术资产。沿用 4 群系共享元素库（森林 → 熔岩），只换主色调与构图比例。

## 调色板

- 8 色火山暖色调色板：熔岩红 / 岩浆橙 / 玄武黑 / 灰烬灰 / 烈焰黄 / 暗红 / 炭黑 / 极夜黑
- 暖色占比 100%（红橙黄系）
- 共用 `night_black` 极暗锚点（与雪山群系共用）

## 资产清单

### Tiles（地形 32×32，4 边对称无缝）
| 文件名 | 用途 |
|---|---|
| `tiles/lava_flow.png` | 熔岩流，64×64 平铺测试通过 |
| `tiles/basalt.png` | 玄武岩，4 边对称接缝 |
| `tiles/ash_ground.png` | 灰烬地 |
| `tiles/magma_crack.png` | 岩浆裂缝，发光 |
| `tiles/scorched_earth.png` | 焦土，灼烧痕迹 |

### Elements（地物 32×32 / 32×64，4 方向侧视）
| 文件名 | 用途 |
|---|---|
| `elements/lava_pool.png` | 岩浆池 |
| `elements/fire_geyser.png` | 火焰喷泉 |
| `elements/obsidian_shard.png` | 黑曜石碎片 |
| `elements/charred_tree.png` | 焦木 |
| `elements/volcanic_rock.png` | 火山岩 |

## 硬约束自检

- ✅ 32px 基础 / 16px 细节网格
- ✅ ≤24 色暖色调色板（实际 8 色子集）
- ✅ 暖色系 100%
- ✅ 哥特暗黑 × 明亮卡通（炽烈色调）
- ✅ 硬边缘 / 禁抗锯齿（PIL 直写整数坐标）
- ✅ 地形 tile 4 边对称接缝

## backfill

- 2026-08-22：M3.13 v2 首批 10 张入库
- 来源：飞书云文档 `ZTkpdJOWvovHihxBsOocyVhMnjh`（AI 画师交付）