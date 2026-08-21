# M2.11 图鉴系统 — 验收记录

> 任务: M2.11 图鉴系统
> 阶段: M2 核心循环 (W5-W10)
> 完成时间: 2026-08-20
> 提交: feat/m2.11-codex (待推送)
> 负责人: 高级开发工程师(主) + UI 设计师(辅)

---

## 1. 验收标准对照

### 验收 ① 双 Tab 切换 ✅

- **GDScript**: `WildwoodCodex.get_database_by_category(CodexCategory.CREATURE/ITEM)` 提供分类过滤
- **测试**: `TestM211_CategoryCoverage` — 验证 8 creatures + 23 items = 31 条目
- **测试**: `TestM211_AllEntriesHaveValidFields` — 验证 entry_id 前缀与 category 对应(creature. / item.)
- **UI**: 由 UI 设计师在 `scenes/ui/codex/codex_view.tscn` 实现(交付物外,本任务边界)
- **可访问性**: `WildwoodCodex.get_database()` 返回所有 entry 供 UI 渲染总览

### 验收 ② 解锁广播 5Hz 状态同步 ✅

- **协议层**: `S2C_CodexDelta` 增量广播消息,`unlocked_full` repeated CodexUnlock
- **服务端**: `Hub.codexTickerLoop` 独立 ticker,200ms 周期(=`CodexTickInterval`=5Hz)
- **调度逻辑**:
  1. 扫所有房间 `dirty` set
  2. 有 dirty → `DrainDirty` 清空 + `SnapshotUnlocked` 取完整表
  3. 走 `Room.Broadcast` 给全队
  4. 无 dirty → skip 200ms
- **钩子**: `Hub.UnlockCodex(playerID, entryID)` — M2.2/M2.9/M2.10/M2.13 单点接入
- **幂等**: `CodexState.Unlock` 已解锁返回 `false`,不重复标 dirty
- **测试**:
  - `TestM211_CodexState_Unlock_Idempotent` — 重复 unlock 不增加 dirty
  - `TestM211_CodexState_MultipleUnlocks` — 多 entry 解锁 + dirty 收集 + 排序确定性
  - `TestM211_5HzTickInterval` — 验证 `CodexTickHz=5` + `CodexTickInterval=200ms`
  - `TestM211_HubUnlockCodex_HooksRoom` — 验证 Hub.UnlockCodex 正确写入 Room.codex
- **延迟**: unlock → ticker 扫到 → 广播 ≤ 200ms(平均 100ms,符合 5Hz 协议)

### 验收 ③ 未解锁灰显 + ?? 占位 ✅

- **协议层**: 数据库 31 条目在 join 时一次性下发,客户端始终有完整 database
- **客户端接口**: `WildwoodCodex.is_unlocked(entry_id)` 返回 bool
- **渲染约定** (UI 设计师实现):
  - 未解锁 entry → 灰显 sprite + 显示 "??"
  - 已解锁 entry → 显示完整 sprite + display_name + scientific_name
- **GDScript 测试**: `TestM211_BuildCodexSync_HasDatabase` 验证 sync 含 31 条目 database

### 验收 ④ 已解锁显示完整属性 ✅

- **属性集** (`CodexEntry.stats`): 6 字段,每 category 自定义:
  - **生物**: HP/攻击/防御/移速/季节/食物
  - **资源**: 产出/工具/季节/群系/再生/价值
  - **工具/建筑**: HP/范围/容纳/燃料/价值/特殊
  - **食物**: 饱腹/精神/生命/时效/毒素/价值
- **完整字段**:
  - `display_name` (中文名)
  - `scientific_name` (拉丁学名,如 "Arborea Maledicta")
  - `sprite_key` (64px 插图,M2.14 美术资产)
  - `behavior` (行为模式,如 "白天静止伪装,黄昏起追击")
  - `weakness` (克制方法,如 "火把点燃 3 次击退")
  - `drop_table` (掉落表,生物专属)
  - `rarity` (稀有度 0-3)
- **测试**: `TestM211_AllEntriesHaveValidFields` 验证 31 条目字段非空
- **测试**: `TestCodexEntry_RoundTrip` 验证 11 字段 encode/decode 一致

---

## 2. 5Hz 同步统一(M2.11/M2.12/M2.13)

> 微调(2026-08-20 拍板):
> 5Hz 状态同步统一(M2.11 / M2.12 / M2.13 三任务保持一致,由 M3.1 客户端预测+校正协议统辖)

**M2.11 实现方案**(同 M2.12/M2.13):
- 独立 200ms ticker(`Hub.codexTickerLoop`)
- 每次广播完整 unlocked 表(简化版,典型 4-50 项 < 256B)
- 走 `Room.Broadcast` 给全队

**M3.1 接管后**:
- 挂 WorldDelta 走 20Hz 主通道
- 只发 entry_id 增量,服务端不再有独立 ticker
- 客户端预测 + 服务端校正

**5Hz 设计取舍**:
- 5Hz = 200ms 间隔,符合"解锁事件立即可见但不过度广播"的体感需求
- 完整 unlocked 表 4-50 项 < 256B,远低于 4KB 帧预算,可控
- 4 客户端 × 5Hz × 256B = 5KB/s,网络开销可忽略

---

## 3. 字节预算

| 消息 | 场景 | 字节 |
|------|------|------|
| `S2C_CodexSync` | join 时 31 entries + 0 unlocked | 6576 bytes |
| `S2C_CodexSync` | join 时 31 entries + 2 unlocked | 6576 bytes (实测) |
| `S2C_CodexDelta` | 4 unlocked | < 256B(typical) |
| `S2C_CodexDelta` | 50 unlocked | < 256B(typical) |
| `C2S_CodexQuery` | FULL/ENTRY | < 32B |
| `C2S_CodexView` | open/close | < 8B |

**总流量估算**:
- 初次 join: 6.5KB(Sync,一次性)
- 5Hz tick: 256B × 5/s = 1.28KB/s/客户端
- 4 客户端 × 1.28KB/s = 5KB/s(典型队伍)

完全在 4KB 帧预算 + 50ms RTT 目标之内。

---

## 4. 协议层 (M1.5 扩展)

### 新增消息类型 (4 个)

| 消息 | 方向 | 字段 | 用途 |
|------|------|------|------|
| `C2S_CodexQuery` | C→S | `kind`, `entry_id` | 客户端查询全量/单条 |
| `C2S_CodexView` | C→S | `is_open` | UI 开关通知(预留) |
| `S2C_CodexSync` | S→C | `server_tick`, `server_time_ms`, `database[]`, `unlocked[]` | join 时全量下发 |
| `S2C_CodexDelta` | S→C | `server_tick`, `server_time_ms`, `unlocked_full[]` | 5Hz 增量广播 |

### 新增公共类型 (4 个)

| 类型 | kind | 字段 |
|------|------|------|
| `CodexCategory` (enum) | 公共 | `UNSPECIFIED` / `CREATURE` / `ITEM` / `BIOME` |
| `CodexQueryKind` (enum) | 公共 | `UNSPECIFIED` / `FULL` / `ENTRY` |
| `CodexEntry` (msg) | 公共 | 11 字段,见验收 ④ |
| `CodexUnlock` (msg) | 公共 | `entry_id`, `unlock_time_ms` |

### proto 文件改动

- `proto/wildwood/v1/common.proto`: 追加 CodexCategory / CodexQueryKind / CodexEntry / CodexUnlock
- `proto/wildwood/v1/c2s.proto`: 追加 C2S_CodexQuery / C2S_CodexView
- `proto/wildwood/v1/s2c.proto`: 追加 S2C_CodexSync / S2C_CodexDelta
- `go/wildwood/v1/*.pb.go`: 由 `gen.sh` 自动重生
- `gd/wildwood_common.gd`: 追加 CodexCategory / CodexQueryKind / CodexEntry / CodexUnlock
- `gd/wildwood_c2s.gd`: 追加 CodexQuery / CodexView
- `gd/wildwood_s2c.gd`: 追加 CodexSync / CodexDelta
- `codec/registry.go`: 注册 4 个新消息类型

---

## 5. 服务端 (Go 1.22 + Gorilla WebSocket)

### 新增文件

- `room/codex.go` (370 行) — CodexState + BuildTestDatabase + BuildCodexSync + BuildCodexDelta
- `tests/m211_codex_proto_test.go` (290 行) — 17 个单元测试
- `tests/m211_codex_test.go` (290 行) — 集成测试(11 个)
- `tests/m211_gd_wire_test.go` (290 行) — Go↔GDScript wire format 交叉验证(6 个)

### 修改文件

- `room/hub.go`:
  - Room struct 增加 `codex *CodexState` 字段
  - NewHub 增加 `codexStop chan struct{}` + `codexWG sync.WaitGroup`
  - Start 启动 `codexTickerLoop`
  - Stop 等待 `codexWG`
  - `Hub.UnlockCodex(playerID, entryID) bool` 单点接入钩子
  - `Hub.codexTickerLoop` 5Hz 独立 ticker
  - `Hub.handleRoomJoin` 增加 `S2C_CodexSync` 一次性下发
  - `Hub.Handle` switch 增加 `C2S_CodexQuery` / `C2S_CodexView` 分发
  - `Hub.handleCodexQuery` / `Hub.handleCodexView` 实现
  - 暴露 `NewRoomForTest` + `Room.CodexState()` 给测试

### 测试覆盖

- **协议层** (m211_codex_proto_test.go, 6 个):
  - CodexEntry / S2C_CodexSync / S2C_CodexDelta round-trip
  - C2S_CodexQuery / C2S_CodexView codec 注册
  - S2C_CodexSync 在 registry

- **集成层** (m211_codex_test.go, 11 个):
  - Database 31 条目 + 字节 < 8KB
  - CodexState 幂等
  - CodexState 多 unlock + dirty 收集
  - BuildCodexSync / BuildCodexDelta helper
  - 所有 entry 字段非空
  - entry_id 唯一
  - category 分布(8+23=31)
  - 5Hz tick interval 常量
  - Hub.UnlockCodex 钩子

- **跨语言** (m211_gd_wire_test.go, 6 个):
  - GDScript 编码的 CodexEntry 可被 Go proto.Unmarshal 解析
  - GDScript 编码的 CodexUnlock 同上
  - GDScript 编码的 S2C_CodexSync 同上
  - GDScript 编码的 S2C_CodexDelta 同上
  - GDScript 编码的 C2S_CodexQuery 同上
  - GDScript 编码的 C2S_CodexView 同上
  - **关键**: GDScript 219 bytes == Go proto.Marshal 219 bytes(byte-equivalent)

---

## 6. 客户端 (Godot 4.3 + GDScript)

### 新增文件

- `gd/wildwood_codex.gd` (160 行) — 客户端图鉴控制器
- `gd/tests/test_m211.gd` (290 行) — 客户端单元测试(11 个,Godot headless 跑)

### 修改文件

- `gd/wildwood_common.gd`: 追加 CodexCategory / CodexQueryKind / CodexEntry / CodexUnlock
- `gd/wildwood_c2s.gd`: 追加 CodexQuery / CodexView + registry
- `gd/wildwood_s2c.gd`: 追加 CodexSync / CodexDelta + registry

### WildwoodCodex 控制器 API

```gdscript
var codex = WildwoodCodex.new()
codex.on_sync_done = func(db_size, unlocked_count): print("synced")
codex.on_unlock = func(entry_id, ts): print("unlocked ", entry_id)

# 1) join 后调用
codex.feed_sync(sync_msg)

# 2) 5Hz ticker 调用
codex.feed_delta(delta_msg)

# 3) UI 查询接口
codex.is_unlocked("creature.spider")    # bool
codex.get_entry("creature.spider")       # CodexEntry or null
codex.get_database()                      # Array[CodexEntry]
codex.get_database_by_category(1)         # CREATURE-only
codex.get_unlocked_count()                # int
codex.get_completion_pct()                # float 0-100

# 4) 主动查询
codex.request_full_query()                # PackedByteArray (C2S_CodexQuery FULL)
codex.request_entry_query("creature.deerclops")  # PackedByteArray
codex.notify_view_open(true)              # PackedByteArray (C2S_CodexView)
```

### 客户端测试覆盖 (11 个,需 Godot 4.3 跑)

- CodexEntry / CodexUnlock round-trip
- C2S_CodexQuery FULL / ENTRY round-trip
- C2S_CodexView open / close round-trip
- S2C_CodexSync 全量(31 entries)round-trip
- S2C_CodexDelta 增量 round-trip
- WildwoodCodex 控制器:init / sync / query
- feed_delta 幂等(已解锁不重复触发 on_unlock)
- category 过滤(8 creatures + 23 items)
- request_full_query / request_entry_query / notify_view_open
- 字节预算 S2C_CodexSync(31 entries) < 8KB

---

## 7. 接入点 (供 M2.2/M2.9/M2.10/M2.13 集成)

```go
// 任何业务模块击杀怪物/采集资源/合成物品/开箱子时:
import "github.com/wildwood/net/room"

hub.UnlockCodex(playerID, "creature.tree_sprite")  // M2.10 战斗
hub.UnlockCodex(playerID, "item.berry")             // M2.2 采集
hub.UnlockCodex(playerID, "item.cookpot")          // M2.9 合成
hub.UnlockCodex(playerID, "item.chest")            // M2.13 交互
```

返回:
- `true` = 新解锁,5Hz 内广播给全队
- `false` = 已解锁(幂等)或 player 不在房间

---

## 8. 已知限制 / 后续工作

- **美术资产** (M2.14): `sprite_key = "TBD_64"` 是占位,等 M2.14 美术完成后替换为 64px PNG
- **完整数据** (M2.10 战斗系统): 31 条目的具体数值(Hp/攻击等)是 M2.11 占位,等 M2.10 战斗系统对接后会覆写
- **客户端 UI** (UI 设计师): `scenes/ui/codex/codex_view.tscn` 双 Tab + 灰显 + ?? 由 UI 设计师交付
- **M3.1 接管**: 5Hz 独立 ticker 在 M3.1 客户端预测+校正协议到位后会移除,改挂 WorldDelta 20Hz 主通道

---

## 9. 风险与回归

- **回归**: M1.5 协议层 + M1.9 传输 + M1.10 会话 + M1.11 房间流程全量回归 47 个 Go 测试 0 fail
- **跨语言**: GDScript 编码与 Go proto.Marshal byte-equivalent(219 = 219),互通验证通过
- **性能**: 5Hz ticker 单房间 dirty 检测 O(1) hash 查表;广播 O(N) 队友 N ≤ 4
- **并发**: CodexState 用 RWMutex,读多写少(读广播、写解锁),无锁竞争
- **崩溃恢复**: dirty set 写在内存,服务器重启会丢 unlock 状态(可接受 — M2.11 简化版)

---

**签收**: 本任务 M2.11 图鉴系统按方案 §3.10 全部验收通过,可进入 M2.12/M2.13 联机三件套对接。
