# Wildwood 图鉴系统（M2.11）数据 Schema

> **For Agent:** 数据层定义。配套代码：`core/abstract/network/go/room/codex.go` (Go) + `core/abstract/network/gd/wildwood_codex.gd` (GDScript) + Protobuf (`common.proto` / `c2s.proto` / `s2c.proto`)
>
> **关联任务**: M2.11 图鉴系统（W5-W10）· 关键路径下游
> **依赖**: M2.10 战斗系统（提供击杀事件源）· 关联 M2.2 采集系统（提供采集事件源）
> **上游引用**: 方案 §2.5 图鉴 · 方案 §5.3 §4.4 图鉴屏 · 任务拆分表 M2.11

---

## 1. 三层抽象视角

| 层 | 实现位置 | 角色 |
|---|---|---|
| 数据层（静态） | `core/abstract/network/go/room/codex.go` `CodexDatabase` | 编译期 hard-code 30+ 条目（entry 模板） |
| 数据层（动态） | `CodexState` per-room | 解锁字典：`entry_id → unlock_time_ms` |
| 协议层 | `.proto` 新增 4 消息 | `S2C_CodexSync`（join 下发全量） / `S2C_CodexDelta`（5Hz 增量） / `C2S_CodexQuery` / `C2S_CodexView` |
| 服务端 | `room.Hub` 嵌入 codex | 5Hz 独立 ticker 广播 dirty；事件钩子 `Hub.UnlockCodex(playerID, entryID)` |
| 客户端 | `WildwoodCodex` GDScript | 本地缓存 + 渲染 CodexView |

---

## 2. CodexEntry 字段（与 Protobuf `CodexEntry` 1:1）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `entry_id` | string | ✓ | 唯一 ID，格式 `{category}.{slug}` 例如 `creature.tree_sprite` / `item.berries` |
| `category` | enum | ✓ | `CREATURE` / `ITEM`（`BIOME` 留 M2.7） |
| `prefab_id` | uint32 | ✓ | 复用 M2.x `prefab_id` 体系（M2.10/M2.14 落实） |
| `display_name` | string | ✓ | 中文名 ≤ 16 字符 例如 "树精" / "浆果" |
| `scientific_name` | string | ✓ | 拉丁学名 ≤ 32 字符 例如 "Arborea Maledicta" |
| `sprite_key` | string | ✓ | 64px 资源 key（最终由 M2.14 美术出图，placeholder 阶段用 `TBD_64`） |
| `stats` | repeated string ×6 | ✓ | 6 项属性键值对 例如 ["HP: 120", "攻击: 25", "防御: 8", "移速: 2.5", "季节: 秋", "食物: 0"] |
| `behavior` | string | ✓ | 行为模式 ≤ 200 字符 例如 "白天巡逻，黄昏追击，夜间回家" |
| `weakness` | string | ✓ | 克制方法 ≤ 200 字符 例如 "用火把点燃 3 次可击退" |
| `drop_table` | repeated string | × | 采集/击杀产出 entry_id 列表 例如 `["item.log", "item.twig"]` |
| `rarity` | uint32 | ✓ | 0=常见 1=罕见 2=稀有 3=Boss |

> 注：未解锁 entry 客户端只知道 entry_id + category + rarity + display_name="??"；其他字段在 unlock 前不展示。

---

## 3. CodexState per-room

```go
type CodexState struct {
    Unlocked map[string]uint64  // entry_id -> unlock_time_ms
    Dirty    map[string]struct{} // 5Hz ticker 消费后清空
}
```

- 写入：`Hub.UnlockCodex(playerID, entryID, nowMs)` 幂等（已解锁则忽略）
- 5Hz 广播：ticker 扫 Dirty → 序列化 `S2C_CodexDelta { unlocked_full: <整张表> }`
- join 时：`S2C_CodexSync { database: <30+>, unlocked: <已解锁 dict> }`
- 简化版（M2.11）：5Hz 每次广播完整 unlocked 表（典型 4-50 项），字节预算 < 256B；M3.x 优化为仅 delta

---

## 4. CodexDatabase 静态预置 30+ 条目（M2.11 占位）

> **明确**：本表数值（HP/攻击等）为占位，M2.10 战斗系统完成后会覆写。M2.11 只验证"数据可序列化/可广播/可显示"通路。

| entry_id | category | display | scientific | rarity |
|---|---|---|---|---|
| **生物（8，对齐 M2.10 5+ 怪物）** ||||
| creature.tree_sprite | CREATURE | 树精 | Arborea Maledicta | 1 |
| creature.spider | CREATURE | 蜘蛛 | Aranea Venenata | 0 |
| creature.bat | CREATURE | 蝙蝠 | Chiroptera Umbra | 0 |
| creature.hound | CREATURE | 猎犬 | Canis Diripiens | 1 |
| creature.merm | CREATURE | 鱼人 | Piscis Hominis | 1 |
| creature.deerclops | CREATURE | 巨鹿 | Cervus Magnus | 3 |
| creature.tentacle | CREATURE | 触须 | Tentaculus Profundus | 2 |
| creature.lureplant | CREATURE | 食人花 | Planta Carnivora | 2 |
| **资源（10，对齐 M2.2 10+ 资源）** ||||
| item.berry | ITEM | 浆果 | Bacca Sylvestris | 0 |
| item.mushroom | ITEM | 蘑菇 | Fungus Sylvestris | 0 |
| item.reed | ITEM | 芦苇 | Arundo Palustris | 0 |
| item.sapling | ITEM | 树苗 | Arbor Parva | 0 |
| item.flint | ITEM | 燧石 | Silex Nodus | 0 |
| item.bone | ITEM | 骨头 | Os Antiquum | 0 |
| item.grass | ITEM | 草 | Herba Communis | 0 |
| item.twig | ITEM | 木棍 | Ramus Parvus | 0 |
| item.ore_stone | ITEM | 石矿 | Petra Metallum | 0 |
| item.ore_gold | ITEM | 金矿 | Aurum Nidus | 1 |
| **工具（5，对齐 M2.9 工具）** ||||
| item.axe | ITEM | 伐木斧 | Securis Lignum | 0 |
| item.pickaxe | ITEM | 镐 | Dolabra Petra | 0 |
| item.shovel | ITEM | 铲 | Pala Terra | 0 |
| item.hoe | ITEM | 锄 | Sarculum Humus | 0 |
| item.torch | ITEM | 火把 | Fax Lumen | 0 |
| **建筑（5，对齐 M2.3 建筑）** ||||
| item.campfire | ITEM | 营火 | Ignis Domus | 0 |
| item.chest | ITEM | 箱子 | Cista Thesauri | 0 |
| item.workbench | ITEM | 工作台 | Mensa Opifex | 0 |
| item.cookpot | ITEM | 烹饪锅 | Ollae Coquus | 0 |
| item.tent | ITEM | 帐篷 | Tentorium Itinera | 0 |
| **食物（3，30+ 配方衍生）** ||||
| item.berry_cooked | ITEM | 烤浆果 | Bacca Assata | 0 |
| item.meat_cooked | ITEM | 烤肉 | Caro Assata | 0 |
| item.meatballs | ITEM | 肉丸 | Globulus Carnis | 0 |

> 总计 8 + 10 + 5 + 5 + 3 = **31 条目**，达成 30+ 目标。

---

## 5. 6 项属性键值对约定

为简化 GDScript 渲染，`stats` 是 6 字符串数组（不是结构体）。键值约定：

- 生物：`HP / 攻击 / 防御 / 移速 / 季节 / 食物`
- 资源：`产出 / 工具需求 / 季节 / 群系 / 再生 / 价值`
- 工具：`耐久 / 攻击加成 / 采集加成 / 速度 / 特殊 / 价值`
- 建筑：`HP / 范围 / 容纳 / 燃料 / 价值 / 特殊`
- 食物：`饱腹 / 精神 / 生命 / 时效 / 毒素 / 价值`

每条目严格 6 项，未知填 `"-"`。

---

## 6. 接入点（其它任务对接）

```go
// M2.2 采集系统: 玩家成功 gather 资源时
hub.UnlockCodex(playerID, "item.berry", nowMs)

// M2.10 战斗系统: 玩家击杀怪物时
hub.UnlockCodex(playerID, "creature.tree_sprite", nowMs)

// M2.9 合成系统: 玩家首次合成
hub.UnlockCodex(playerID, "item.axe", nowMs)

// M2.13 交互: 玩家打开箱子 / 烹饪锅
hub.UnlockCodex(playerID, "item.chest", nowMs)
```

**幂等性**: `UnlockCodex` 内部查表，已解锁则 no-op；新解锁则写 store + 标 dirty。

---

## 7. 验收对照（任务拆分表 M2.11 4 项）

| 验收项 | 落地证据 |
|---|---|
| ① 双 Tab 切换 | `CodexView.tscn` 两个 TabContainer 页签 + GDScript signal |
| ② 解锁广播 5Hz 状态同步 | `m211_codex_test.go` 集成测试 + Go `tickCodex()` 200ms 周期 |
| ③ 未解锁灰显 + ?? 占位 | `CodexView` 渲染时检查 unlocked map，未含则 `modulate = Color(0.3, 0.3, 0.3, 0.5)` + display_name="??" |
| ④ 已解锁显示完整属性 | `CodexView` 详情卡：64px icon + 学名 + 6 stats + behavior + weakness + drop_table |

---

## 8. 已知简化（M3.x 接管）

| 当前（M2.11） | M3.1 后 |
|---|---|
| 5Hz 独立 ticker，每次广播完整 unlocked 表 | 客户端预测+校正协议统辖；delta-only |
| 单一 `UnlockCodex(playerID, entryID)` 同步调用 | 事件流挂在 WorldDelta 内，沿 20Hz 主通道 |
| `CodexDatabase` 编译期 hard-code | 数据驱动（JSON 配置 / asset bundle） |
| 客户端本地缓存全量 database | 流式按需加载（懒查询） |
