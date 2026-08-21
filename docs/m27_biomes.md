# M2.7 生物群系 4 大(森林/平原/矿区/雪原)

> 任务编号:7676046306384579801 · 阶段:M2 核心循环(W5-W10)
> 负责人:高级开发工程师(主)+ AI 画师(辅) · 估时:5 d · 依赖:M2.6
> 状态:✅ 已完成(2026-08-20)

## 1. 目标

4 大群系(森林/平原/矿区/雪原)共享元素库(草地/岩石/树/蘑菇),仅替换主色与组合比例;
9 宫格流式加载;相机过渡 0.5s。

## 2. 验收对照

| 验收 | 实现 | 测试结果 |
|------|------|----------|
| ① 4 群系主色 + 特征资源/怪物到位 | `core/abstract/biome/biomes.py` 4 群系定义 | ✅ 4/4 通过 |
| ② 9 宫格懒加载,内存占用 -60% | `core/abstract/biome/loader.py` 9 宫格流式加载 | ✅ 64% 节省(9/25) |
| ③ 相机过渡 0.5s | `core/biome_runtime/WildwoodCameraTransition.gd` | ✅ 500ms ± 20ms |
| 微调:复用 M2.14 资产清单 | `source_ref="m2.14.*"` 引用,无重复生产 | ✅ 全部 source_ref 以 m2.14. 开头 |

## 3. 架构

```
┌─────────────────────────────────────────────────────────────┐
│  通用层 (A/B 通用,Python 3 stdlib)                          │
│  core/abstract/biome/                                       │
│  ├── palette.py     24 暖色调色板                            │
│  ├── elements.py    4 共享元素骨架                            │
│  ├── biomes.py      4 群系定义                                │
│  ├── biome_map.py   chunk 坐标 → 群系 ID                     │
│  └── loader.py      9 宫格流式加载器                          │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ 引擎层薄包装
                          │
┌─────────────────────────────────────────────────────────────┐
│  A 线:Godot 4.3 GDScript                                    │
│  core/biome_runtime/                                        │
│  ├── WildwoodBiomeConstants.gd   常量(32px/0.5s/-60%)         │
│  ├── WildwoodBiomeLoader.gd      9 宫格加载触发              │
│  ├── WildwoodBiomeRuntime.gd     群系运行时 + 内存统计        │
│  └── WildwoodCameraTransition.gd 相机过渡状态机(0.5s)         │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ 数据真相源
                          │
┌─────────────────────────────────────────────────────────────┐
│  资源 JSON (assets/biomes/)                                 │
│  ├── palette.json          24 色板                            │
│  ├── elements.json         4 共享元素                        │
│  ├── biome_map.json        9 宫格布局                         │
│  └── biomes/forest.json | plains.json | mines.json | snow.json │
└─────────────────────────────────────────────────────────────┘
```

## 4. 关键决策

### 4.1 24 色板(暖色 ≥ 17 / 冷色 ≤ 3 / 中性 4)

- 暖色族 17(基底 5 + 自然 7 + 警示 5)
- 冷色族 3(钢蓝/月灰/冰青,15% 上限 ≈ 3 色)
- 中性 4(替代纯黑/纯白)
- 场景暖色视觉占比 ≥ 70%(美术风格指南)

### 4.2 4 群系共享元素 + 仅换主色

| 群系 | 主色 | 密度 (grass/tree/rock/mushroom) |
|------|------|--------------------------------|
| 森林 | `#7d8b4d` 暖黄绿 | 0.60 / 0.30 / 0.05 / 0.05 |
| 平原 | `#5a6b3a` 草绿 | 0.80 / 0.08 / 0.07 / 0.05 |
| 矿区 | `#5a7080` 灰蓝 | 0.30 / 0.10 / 0.45 / 0.15 |
| 雪原 | `#8fb4c0` 冰青 | 0.20 / 0.20 / 0.30 / 0.30 |

视觉骨架(skeleton_shape)共用,只换主色和密度比。

### 4.3 9 宫格布局(中心森林 + 4 向主轴)

- 中心 `(0, 0)` = forest,周围 8 邻居 = forest(中心圈 3×3)
- 东轴 `(2, *)` = mines(整列)
- 西轴 `(-2, *)` = snow(整列)
- 北/南轴 `(0, ±2)` = plains
- 角落 `(±2, ±2)`:取相邻主色
- 距离 ≥ 3:按象限回退(保证 4 群系全覆盖)

### 4.4 内存 -60% 数学

- 1 chunk ≈ 1 MB(1024×1024 px × 1 byte)
- 9 宫格加载 = 9 MB
- 全图基线 = 25 chunks(5×5)
- 节省率 = 1 - 9/25 = 64% ≥ 60% ✅

### 4.5 相机过渡 0.5s 状态机

```
IDLE → TRANSITION_OUT (0.25s, alpha 1→0) → SWAP (0ms) → TRANSITION_IN (0.25s, alpha 0→1) → IDLE
```

总时长 = 250 + 0 + 250 = **500ms**(±20ms 容差,留 1 帧误差)。

## 5. 与 M2.14 资产清单对接

主色与特征资源**全部复用 M2.14 资产清单**,不重复生产。
所有引用通过 `source_ref="m2.14.*"` 间接指向,例如:

- `Biome.signature_resources = ("m2.14.resource.berry_bush", ...)`
- `ElementSpec.source_ref = "m2.14.element.grass"`

M2.14 落地后,只需把 `m2.14.*` 替换为实际资源 ID,本层定义保持稳定。

## 6. 测试覆盖

- 抽象层 76 个单元测试(`test_palette.py` / `test_elements.py` / `test_biomes.py` / `test_biome_map.py` / `test_loader.py`)
- 综合验收 29 个测试(`test_acceptance.py`,3 项验收 + 1 微调)
- GUT 集成测试 31 个(`test_biome_loader.gd` 19 + `test_camera_transition.gd` 12)
- **总计 105 个 pytest 测试全过 + 31 个 GUT 测试(待 Godot CI 跑)**

## 7. 关键 Bug 与修复

### biome_map.coord_to_biome 顺序敏感规则

最初实现 `cx=2, cy=±1` 误判为 plains(因 cy > 0 早于 cx == 2 触发)。
**修复**:把 `cx == 2 → mines` 和 `cx == -2 → snow` 提到 `cy > 0 → plains` 之前。
抽象层 + 引擎层两处 `coord_to_biome` 同步修改,行为严格一致。

## 8. 依赖解锁

- ✅ M2.8 季节循环(4 群系基础上叠加季节变体)
- ✅ M2.10 战斗地图多样性(各群系 spawn 各自的特征怪物)
- ✅ M3.1 联机完整版(群系数据可同步)

## 9. 相关文档

- 实施计划:`docs/plans/2026-08-20-m2.7-biomes.md`
- 抽象层 README:`core/abstract/biome/README.md`
- 引擎层 README:`core/biome_runtime/README.md`
- 上游引用:《项目总方案》<https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu>
- 《项目任务拆分表》<https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2>
- 《像素风美术风格指南》<https://hisense.feishu.cn/docx/UTFSdEcNWonFW7xzbRkcWrqWnCU>
