# M2.3 建造系统 (Building System)

> 5+ 建筑可造;快捷栏切建筑 → 实时预览红/绿 → LMB 放置 → 校验地形 → 扣材料

## 验收

| # | 条目 | 状态 |
|---|------|------|
| ① | 5+ 建筑可造(7 建筑:营火/箱子/工作台/烹饪锅/帐篷/火坑/火把架) | ✓ |
| ② | 红/绿三判据(距离/地形/占用) | ✓ |
| ③ | 放置对全队可见(BUILD_DONE 事件广播) | ✓ |

## 架构 — 跨 A/B 通用层 + 引擎薄包装

```
core/abstract/building/           ← Python 3 stdlib 通用层(零引擎依赖)
  ├── schemas.py                  ← BuildingType / PlacementResult / 协议常量
  ├── building_types.py           ← 7 建筑定义 + footprint
  ├── placement.py                ← 三判据 PlacementValidator
  ├── placement_engine.py         ← 落地引擎(扣材料 + 产出 WorldEvent)
  └── examples/m23_demo.py        ← 5 步端到端 demo

core/abstract/network/go/room/    ← Go 1.22 房间服务(Go WebSocket 协议)
  ├── build.go                    ← Hub.HandleBuildPlace + 广播 BUILD_DONE
  └── m23_build_test.go           ← 15 个 Go 单元测试(全过)

scripts/building/                 ← Godot 4.3 GDScript 镜像(A 线客户端)
  ├── placement_validator.gd      ← 红/绿预览公式镜像(对齐 Python 端)
  └── placement_demo.gd           ← demo scene 节点
```

## 协议对齐

| 字段 | 值 | 备注 |
|------|----|------|
| `WorldEventKind.BUILD_DONE` | `2` | M1.5 已预埋,无需改 .proto |
| `WorldEvent.amount` | `building_type_id` (1-7) | zigzag 自动编码 |
| `WorldEvent.target_entity_id` | 新分配 building entity id | 单调递增 |
| `WorldEvent.source_entity_id` | 玩家 entity id(FNV-1a 32-bit) | Python / Go / GDScript 三端一致 |
| `WorldEvent.position` | `(x, y)` 米 | 32px = 1m |

## BuildingType 协议 id

| id | 名称 | footprint | recipe(对齐 M2.9) |
|----|------|-----------|------------------|
| 1 | 营火 (campfire) | 1×1 | wood×3, grass×2 |
| 2 | 箱子 (chest) | 1×1 | wood×4 |
| 3 | 工作台 (workbench) | 2×1 | wood×4, flint×2 |
| 4 | 烹饪锅 (cookpot) | 1×1 | stone×3, rope×2 |
| 5 | 帐篷 (tent) | 2×2 | rope×4, grass×6, wood×4 |
| 6 | 火坑 (fire_pit) | 2×2 | stone×6, wood×4 |
| 7 | 火把架 (torch_stand) | 1×1 | wood×1, rope×1 |

## 三判据(顺序固定)

1. **距离** — `||player → candidate|| ≤ 4.0m`(默认)
2. **地形** — `footprint cells` 在地形探针返回 true(M2.7 biomes 集成)
3. **占用** — `footprint cells` 不在 OccupancyGrid 已占用集合

## 性能基线

- Python 端:200 次三判据校验(tent 2x2,200 已放置建筑)≈ 0.82ms(p99 = 0.0041ms)
- Go 端:每条 BUILD_DONE 处理 < 1ms(纯内存栅格)

## 关键路径意义

解锁 M2.6(世界持久化已就绪,BuildingEntry 可序列化)+ M2.7(合成栏 UI 联动)+ M2.13(UI 设计师接入建筑按钮)
