# core/abstract/data/ — 数据层抽象(A/B 通用层 1)

按方案 §3.3.1,本目录在 A 线(Godot) / B 线(Unity)切换时**保留**,
只重写引擎层。这意味着这里的代码必须满足:

- **JSON-friendly**:只使用基础类型 + 字符串 + 字典 + 数组
- **无引擎依赖**:不引用 Node / SceneTree / 资源
- **版本契约**:每次写都带 `schema_version`,读时校验

## 当前内容

| 文件 | 任务 | 备注 |
|---|---|---|
| `save_metadata.gd` | M1.3 占位 → M1.4 完整 → M2.6 落盘 | 存档元数据 v1 schema |

## 后续(M1.4 完整 + M2.6 落盘)

- `inventory_item.gd` — 物品条目(物品 ID + 数量 + 耐久)
- `world_chunk.gd` — 区块数据(地形 / 建筑 / 实体引用)
- `player_state.gd` — 玩家状态(HP / 饱腹 / 精神 / 温度 / 位置)
- `migrations.gd` — 版本迁移链 v1→v2→...
- `validator.gd` — 通用字段合法性校验(枚举值 / 数值范围)
