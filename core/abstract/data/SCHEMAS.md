# Wildwood 数据层 Schema 文档

> M1.4 数据层抽象接口 — A/B 通用层 1(关键路径)
> 项目:Wildwood · 立项 2026-08-20
> 对应项目总方案 §3.3.1(数据层 — 通用层,A/B 切换时不重写)

---

## 1. 概述

数据层是 Wildwood 三层抽象中的**最底层**,负责:

- **世界状态持久化**(地形、生物、季节、玩家位置)
- **玩家档案管理**(属性 / 装备 / 背包 / 死亡记录 / 图鉴解锁)
- **存档组织**(单一世界 + 多人档案 + 联机元信息)

A 线(主线,Godot 4.3 + Go 房间服务)与 B 线(备线,Unity 6 + Mirror + .NET 8)共用本层。
切换时**只改实现**,不改接口;业务代码零修改。

### 1.1 硬约束

| 约束       | 取值                                                                                       | 来源               |
|------------|--------------------------------------------------------------------------------------------|--------------------|
| 序列化格式 | JSON(UTF-8,无 BOM)                                                                          | 方案 §3.3.1 数据层 |
| 版本号     | 语义化版本 `MAJOR.MINOR.PATCH`                                                              | 通用约定           |
| 兼容性     | 同 MAJOR 视为兼容;不同 MAJOR 抛 `VersionIncompatibleError`                                  | 本文档 §3          |
| 联机上限   | 4 人小队(1 主机 + 3 队友)                                                                  | 方案 §5.4          |
| 同步频率   | 20Hz tick,客户端预测 + 服务端校正,偏差 > 32px 用 100ms 平滑插值                              | 方案 §3.1.1        |
| 断线保留   | 5 分钟断线保留,超时生成离线墓碑                                                              | 方案 §5.4          |
| 死亡复活   | 10s 队友复活窗口                                                                              | 方案 §5.4          |
| 状态共享   | HP/饱腹/精神/温度对队友可见,**隐藏具体数值**,只显示条形                                       | 方案 §5.4          |
| 外部依赖   | **零**(纯 Python stdlib;A→B 切换时不引入 .NET 运行时)                                       | 本任务硬约束       |

### 1.2 不在本层职责内

- 实时同步协议(走网络协议语义层,M1.5)
- 资源元数据(走资源元数据层,M1.6)
- 业务规则校验(如"HP 不能超过 HP_MAX"、"玩家不能穿墙")
- 引擎相关数据(节点 ID、scene path、资产 hash 等)

---

## 2. Schema 定义

### 2.1 `WorldState` — 世界状态

| 字段                | 类型                  | 必填 | 说明                                              |
|---------------------|-----------------------|------|---------------------------------------------------|
| `schema_version`    | string                | ✓    | 当前 `1.0.0`                                       |
| `world_id`          | string (UUID)         | ✓    | 世界唯一 ID,存档迁移时不变                          |
| `world_seed`        | int                   | ✓    | 随机种子,决定地形/生物群系布局                       |
| `created_at`        | float (unix ts)       | ✓    | 世界创建时间                                       |
| `day`               | int (≥1)              | ✓    | 累计天数(1-based)                                  |
| `season`            | enum                  | ✓    | `spring` / `summer` / `autumn` / `winter`         |
| `time_of_day`       | float [0.0, 1.0]      | ✓    | 当前日间进度                                       |
| `day_in_season`     | int (≥1)              | ✓    | 当前季节内日数(每 30 天切换,方案 §2.7)              |
| `biome_layout`      | dict                  | ✓    | 生物群系布局(群系 ID → 权重 / 形状)                  |
| `players`           | dict                  | ✓    | `player_id` → 内嵌数据(位置 + 当前状态摘要)         |
| `entities`          | dict                  | ✓    | `entity_id` → 内嵌数据(怪物/资源/建筑)              |
| `world_modifications` | list                | ✓    | 玩家造成的地形修改记录(用于客户端展示)               |

`WorldState.players` 只存**位置摘要** + 状态摘要(HP/饱腹/精神/温度的条形数据);
**完整 PlayerProfile 在 `SaveGame.player_profiles` 里**,这样世界状态可保持小体积,
契合 §3.4 的"< 4KB/tick 同步包"硬约束。

### 2.2 `PlayerProfile` — 玩家档案

| 字段              | 类型                 | 必填 | 说明                                                  |
|-------------------|----------------------|------|-------------------------------------------------------|
| `schema_version`  | string               | ✓    | 当前 `1.0.0`                                          |
| `player_id`       | string (UUID)        | ✓    | 玩家唯一 ID                                           |
| `display_name`    | string (非空)        | ✓    | 显示名(2-20 字符,游戏内由 UI 约束)                    |
| `character_class` | enum                 | ✓    | `scout` / `builder` / `warrior` / `gatherer`         |
| `appearance`      | dict                 | ✓    | 外观数据(帽子色、衣色、配件等;引擎层负责渲染)         |
| `stats`           | object               | ✓    | `PlayerStats` — 四维属性上限(均 > 0)                  |
| `current_state`   | object               | ✓    | `PlayerCurrentState` — 四维属性当前值                  |
| `inventory`       | dict                 | ✓    | `item_id` → count(count ≥ 0)                          |
| `equipment`       | dict                 | ✓    | 槽位 → item_id / null(`head` / `body` / `hand_main` / `hand_off`) |
| `buffs`           | list                 | ✓    | 当前 buff 列表(剩余时间、效果等)                       |
| `unlocked_codex`  | list                 | ✓    | 已解锁图鉴 ID 列表(方案 §2.5 联机共享)                 |
| `deaths`          | int (≥0)             | ✓    | 累计死亡次数                                           |
| `survival_days`   | int (≥0)             | ✓    | 累计存活天数                                           |

`PlayerStats`:

| 字段             | 类型   | 范围  | 默认  |
|------------------|--------|-------|-------|
| `hp_max`         | float  | > 0   | 100.0 |
| `hunger_max`     | float  | > 0   | 100.0 |
| `sanity_max`     | float  | > 0   | 100.0 |
| `temperature_max`| float  | > 0   | 100.0 |

`PlayerCurrentState`:

| 字段         | 类型  | 说明                                |
|--------------|-------|-------------------------------------|
| `hp`         | float | 当前 HP                              |
| `hunger`     | float | 当前饱腹                             |
| `sanity`     | float | 当前精神                             |
| `temperature`| float | 当前温度(偏移值,用于相对判定)         |

`is_critical()`:任一维度 < 30.0 返回 True(对应方案 §2.1 警示动效)。

### 2.3 `SaveGame` — 完整存档

| 字段              | 类型   | 必填 | 说明                                                    |
|-------------------|--------|------|---------------------------------------------------------|
| `schema_version`  | string | ✓    | 当前 `1.0.0`                                            |
| `save_id`         | string | ✓    | 存档唯一 ID(每次 `save_save` 复用同一 ID)                |
| `created_at`      | float  | ✓    | 存档创建时间                                             |
| `updated_at`      | float  | ✓    | 存档最近更新时间                                         |
| `game_mode`       | enum   | ✓    | `single` / `host` / `client`                            |
| `host_player_id`  | string | ✓    | 主机玩家 ID(单人模式 = 唯一玩家 ID)                       |
| `world_state`     | object | ✓    | **inline** `WorldState`(嵌套)                            |
| `player_profiles` | dict   | ✓    | `player_id` → **inline** `PlayerProfile`(嵌套)          |
| `clients`         | list   | ✓    | `ClientConnection` 列表(最多 4 个,联机断线用)             |
| `settings`        | dict   | ✓    | 游戏设置(音量、键位、难度等)                              |

`ClientConnection`:

| 字段              | 类型   | 说明                                              |
|-------------------|--------|---------------------------------------------------|
| `player_id`       | string | 玩家 ID                                           |
| `last_seen`       | float  | 上次心跳时间(unix ts)                              |
| `connection_state`| enum   | `connected` / `reconnecting` / `offline`         |

### 2.4 枚举

```text
Season:        spring | summer | autumn | winter
GameMode:      single | host | client
EntityType:    player | monster | resource | building | item_drop
BiomeId:       forest | plains | desert | snow | marsh | lava(v1.1)
```

---

## 3. 版本号与迁移

### 3.1 语义

`MAJOR.MINOR.PATCH`(对应 [semver.org](https://semver.org)):

- **MAJOR**:结构性变更(字段重命名、类型变更、字段删除)— **不兼容**,需要迁移脚本
- **MINOR**:新增字段、新增可选值、默认值变更 — **向后兼容**
- **PATCH**:仅文档/注释调整 — **完全兼容**

### 3.2 兼容判断(`is_compatible`)

```python
is_compatible(reader, writer) = parse(reader).major == parse(writer).major
```

- `1.0.0` ↔ `1.5.3` → **True**(同 major,字段变更非破坏)
- `1.0.0` ↔ `2.0.0` → **False**(不同 major,需迁移)
- `0.9.0` ↔ `1.0.0` → **False**

校验器遇到不兼容情况抛 `VersionIncompatibleError`,业务层应捕获并提示用户:

> "存档版本为 X,游戏当前为 Y,需要从历史版本迁移。请回退游戏或联系开发。"

### 3.3 未来迁移策略(M1.4 不实现,留接口)

预留迁移 hook:

```python
class SchemaMigrator:
    """W3-M2.x 实现。签名:"""
    def migrate_save_game(self, save_data: dict, from_version: str) -> dict: ...
```

调用时机:DataStore 加载时,先校验 schema_version,若与 CURRENT 不同 major 则调用迁移器。

---

## 4. 抽象接口(`DataStore`)

### 4.1 接口定义

```python
class DataStore(ABC):
    # 存档 CRUD
    def list_saves() -> list[dict]                     # 存档摘要
    def load_save(save_id: str) -> SaveGame             # 加载完整存档
    def save_save(save: SaveGame) -> None               # 写入/覆盖
    def delete_save(save_id: str) -> bool               # 删除
    def exists(save_id: str) -> bool                    # 存在性检查

    # 子对象快捷操作(M2+ 大量 entity 时可优化)
    def load_world_state(save_id: str) -> WorldState
    def save_world_state(save_id: str, world: WorldState) -> None
    def upsert_player_profile(save_id: str, profile: PlayerProfile) -> None
    def load_player_profile(save_id: str, player_id: str) -> PlayerProfile
```

### 4.2 错误约定

| 错误类型                     | 触发场景                            | 业务处理建议                          |
|------------------------------|-------------------------------------|---------------------------------------|
| `SchemaError`                | 字段缺失、类型错误、值越界          | 弹窗"存档损坏,无法加载"                |
| `VersionIncompatibleError`   | major 版本不一致                    | 弹窗"需要迁移到当前版本"                |
| `KeyError`                   | 存档 / 玩家档案不存在                | 静默忽略或显示"该条目已删除"            |
| `ValueError`                 | 重复插入(仅 mock 的 LiteDB API)    | 内部错误,日志记录                     |

---

## 5. 实现对照

| 维度         | `JsonFileStore` (Reference)               | `MockLiteDbStore` (Mock, B 线参考) |
|--------------|-------------------------------------------|--------------------------------------|
| 存储形态     | 目录树,每个存档一个子目录                 | 单文件 JSON 数据库                    |
| 文件结构     | `meta.json` + `world.json` + `profiles/<pid>.json` | 单文件,内含 3 个 collection          |
| 原子写       | 临时文件 + `os.replace`                   | 同上                                  |
| 适用引擎     | A 线(模拟 SQLite 风格)                     | B 线参考(LiteDB 语义)                |
| 单存档大小   | 3-4 个文件(便于按需加载)                  | 1 个文件(便于整体序列化)              |
| 缺点         | 文件多,大量 entity 时 IO 较慢             | 整体加载,世界巨大时内存压力           |
| 联机写并发   | 需 OS 文件锁                              | 需 LiteDB 内部事务                    |

**A → B 切换工作量**:~2 周,只改 `DataStore` 实现,业务代码零修改。

---

## 6. 用法示例

### 6.1 最小存档 workflow

```python
from core.abstract.data import (
    WorldState, PlayerProfile, SaveGame, make_store, Season
)

# 1. 选 backend(reference 或 mock)
store = make_store("reference", reference_root="./saves")
# 或:store = make_store("mock", mock_db_path="./wildwood.db.json")

# 2. 建世界 + 玩家
world = WorldState.create_new(world_seed=42)
profile = PlayerProfile.create_new("Astone", character_class="builder")
world.players[profile.player_id] = {
    "position": {"x": 16.0, "y": 32.0},
    "current_state": {"hp": 100, "hunger": 80, "sanity": 90, "temperature": 50},
}

# 3. 写存档
save = SaveGame.from_world_and_profiles(
    world, {profile.player_id: profile}, host_player_id=profile.player_id
)
store.save_save(save)

# 4. 读存档
loaded = store.load_save(save.save_id)
print(loaded.world_state["world_seed"])  # 42

# 5. 推进天数,只更新世界状态
w = store.load_world_state(save.save_id)
w.day += 1
if w.day_in_season >= 30:
    w.season = Season.SUMMER.value
    w.day_in_season = 1
store.save_world_state(save.save_id, w)
```

### 6.2 A/B 切换

```python
import os

# 走 env
os.environ["WILDSWOOD_DATA_BACKEND"] = "mock"
store = make_store(mock_db_path="./data/wildwood.db.json")

# 走显式参数
store = make_store("reference", reference_root="./data/saves")
```

### 6.3 联机:断线保留

```python
import time

# 玩家断开时,记录 last_seen
save.clients.append(ClientConnection(
    player_id="...",
    last_seen=time.time(),
    connection_state="reconnecting",
))
store.save_save(save)

# 5 分钟后再次心跳,判断为 offline
# 由 M1.10(M3 联机)的房间服务负责清理
```

---

## 7. 验收对账(M1.4 任务验收)

| 验收标准                                            | 交付物                                  |
|----------------------------------------------------|------------------------------------------|
| ① schema 文档                                       | 本文件 `core/abstract/data/SCHEMAS.md`   |
| ② schema 校验器(版本号兼容判断)                     | `core/abstract/data/schemas.py` `SchemaValidator` + `is_compatible` |
| ③ reference + mock 实现各 1 份                      | `JsonFileStore` + `MockLiteDbStore`      |
| ④ A/B 切换 mock 适配器测试通过                       | `tests/unit/test_data_layer.py` `TestAdapter` + `DataStoreContractMixin` |
| 依赖 M1.1                                            | 已基于 M1.1 仓库的 `core/abstract/`     |
| 风险:延期 ≥ 3 天拖累 M2.1 / 2.6 / 2.7 / 2.14         | 本任务 T+0 完成,无延期                   |

---

## 8. 后续工作

| 任务     | 描述                                                            |
|----------|-----------------------------------------------------------------|
| M1.5     | 网络协议语义层(Protobuf 定义 player:input / world:delta / chat:msg) |
| M1.6     | 资源元数据层(Aseprite .ase + 24 色板 + 32px 网格)              |
| M2.1     | 移动与采集 — 走 DataStore 写入 world_modifications + entity HP  |
| M2.6     | 战斗 — 走 DataStore 写入仇恨表 + 死亡事件                       |
| M2.7     | 合成 — 走 DataStore 写入 inventory                             |
| M2.14    | 联机 4 人压测 — 走 DataStore 多 save 并发测试                   |
| M3.x     | B 线 LiteDB 真接入(替换 MockLiteDbStore)                        |
| 迁移器   | 当 major 版本号变更时实现 `SchemaMigrator`                       |

---

**版本**:M1.4 v1.0 · 2026-08-20 · 高级开发工程师
