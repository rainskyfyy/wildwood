# M2.7 生物群系抽象层

4 大群系(森林/平原/矿区/雪原) + 9 宫格流式加载,项目总方案 §2.6。

## 文件结构

```
core/abstract/biome/
├── __init__.py        # 包入口,导出全部公共 API
├── palette.py         # 24 暖色调色板
├── elements.py        # 4 共享元素骨架(grass/rock/tree/mushroom)
├── biomes.py          # 4 群系定义
├── biome_map.py       # chunk 坐标 → 群系 ID 映射
├── loader.py          # 9 宫格流式加载器
└── tests/             # 单元测试 + 综合验收(105 个测试,全过)
```

## 核心 API

### palette(色板)

```python
from core.abstract.biome import PALETTE, warm_color_count, validate_no_pure_black_or_white

print(len(PALETTE))         # 24
print(warm_color_count())   # 17(暖色族:基底+自然+警示)
print(validate_no_pure_black_or_white())  # [] (无违例)
```

色板结构:5 暖色基底 + 7 自然色 + 5 警示色 + 3 冷色点缀 + 4 中性色 = 24。

### elements(共享元素)

```python
from core.abstract.biome import SHARED_ELEMENTS, get_element

print(SHARED_ELEMENTS)   # ['grass', 'rock', 'tree', 'mushroom']
g = get_element("grass")
print(g.grid_size)        # 32
print(g.source_ref)       # 'm2.14.element.grass'
```

具体像素由 M2.14 资产清单统一出(2026-08-20 拍板),本层只定义 skeleton_shape(ASCII 描述)。

### biomes(4 群系)

```python
from core.abstract.biome import get_biome, list_biomes, primary_color_of

for b in list_biomes():
    print(b.id, b.primary_color_hex, b.signature_resources)

# 主色查询
print(primary_color_of("forest"))  # #7d8b4d
```

### biome_map(9 宫格映射)

```python
from core.abstract.biome import BiomeMap, MapConfig, ChunkCoord, default_map

m = default_map()
print(m.coord_to_biome(ChunkCoord(0, 0)))   # forest
print(m.coord_to_biome(ChunkCoord(2, 0)))   # mines
print(m.coord_to_biome(ChunkCoord(-2, 0)))  # snow
print(m.coord_to_biome(ChunkCoord(0, 2)))   # plains
```

### loader(9 宫格流式加载)

```python
from core.abstract.biome import new_loader, ChunkCoord, memory_saving_vs_full

loader = new_loader()
loader.update_player_chunk(ChunkCoord(0, 0))
print(loader.loaded_count())               # 9

loaded, full, pct = memory_saving_vs_full(loader)
print(f"内存节省 {pct:.1f}%")  # ≥ 60%(验收 ②)
```

## 验收对照

| 验收 | 实现 | 测试 |
|------|------|------|
| ① 4 群系主色 + 特征资源/怪物 | `biomes.py` | `test_acceptance.py::TestAcceptance01` |
| ② 9 宫格懒加载,内存 -60% | `loader.py` | `test_acceptance.py::TestAcceptance02` |
| ③ 相机过渡 0.5s | GDScript 引擎层常量 | `test_acceptance.py::TestAcceptance03` |
| 微调:复用 M2.14 | `source_ref="m2.14.*"` | `test_acceptance.py::TestAcceptance04` |

## 测试

```bash
# 单元测试(76 个)
python3 -m pytest core/abstract/biome/ -v

# 综合验收(29 个)
python3 -m pytest core/abstract/biome/tests/test_acceptance.py -v

# 全跑
python3 -m pytest core/abstract/biome/ -q
```

## 与 M2.14 资产清单对接

本层所有像素/资源引用都通过 `source_ref="m2.14.*"` 间接指向 M2.14 资产清单,
避免 M2.7 与 M2.14 重复生产(2026-08-20 拍板采纳)。

例如:
- `Biome.signature_resources = ("m2.14.resource.berry_bush", ...)`
- `ElementSpec.source_ref = "m2.14.element.grass"`

M2.14 落地后,只需把 `m2.14.*` 替换为实际资源 ID,本层定义保持稳定。
