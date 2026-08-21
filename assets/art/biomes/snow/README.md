# Snow Biome（雪山生物群系）

M3.13 v2 交付的雪山群系美术资产。沿用 4 群系共享元素库（森林 → 雪山），只换主色调与构图比例。

## 调色板

- 7 色冷色调色板：雪白 / 冰蓝 / 岩灰 / 深蓝 / 霜银 / 冷松绿 / 极夜黑
- 冷色占比 100%（蓝白灰系）
- 共用 `night_black` 极暗锚点（与熔岩群系共用）

## 资产清单

### Tiles（地形 32×32，4 边对称无缝）
| 文件名 | 用途 |
|---|---|
| `tiles/snow_base.png` | 雪地基础，64×64 平铺测试通过 |
| `tiles/ice_crack.png` | 冰裂，4 边对称接缝 |
| `tiles/snow_powder.png` | 粉雪，松软表雪 |
| `tiles/rocky_snow.png` | 岩雪混合，裸岩露出 |
| `tiles/permafrost.png` | 冻土，深色硬化 |

### Elements（地物 32×32 / 32×64，4 方向侧视）
| 文件名 | 用途 |
|---|---|
| `elements/pine_tree_snow.png` | 雪松，枝挂雪 |
| `elements/ice_crystal.png` | 冰晶 |
| `elements/snow_pile.png` | 雪堆 |
| `elements/frozen_remains.png` | 冻骸 |
| `elements/snow_boulder.png` | 雪岩 |

## 硬约束自检

- ✅ 32px 基础 / 16px 细节网格
- ✅ ≤24 色暖色调色板（实际 7 色子集）
- ✅ 冷色系 100%
- ✅ 哥特暗黑 × 明亮卡通（高冷色调）
- ✅ 硬边缘 / 禁抗锯齿（PIL 直写整数坐标）
- ✅ 地形 tile 4 边对称接缝

## backfill

- 2026-08-22：M3.13 v2 首批 10 张入库
- 来源：飞书云文档 `ZTkpdJOWvovHihxBsOocyVhMnjh`（AI 画师交付）