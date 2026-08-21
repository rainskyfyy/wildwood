# CHANGELOG

## v0.4.0 — M2.1 移动 + LMB 智能判别 + M2.2 采集系统 (2026-08-20)

### 新增(M2.1 ★)

- **MOVE 服务端处理**(Go): `HandlePlayerInputMove` — 更新 PosX/PosY(200 px/s)、facing;移动时取消当前采集;广播玩家位置给全队
- **客户端预测**(GDScript): `scripts/player.gd` — WASD 立即移动(预测) + 发 C2S_PlayerInput(MOVE);服务端 S2C_WorldDelta 校正
- **LMB 智能判别**: `world.find_nearest_gatherable(mouse_pos, reach*2)` → 找屏幕鼠标位置最近的可采资源 → 发 GATHER
- **关键 Bug 修复**: handlePlayerInput 路由到 MOVE / GATHER / ATTACK 子 handler(M2.1 之前是 echo)

### 新增(M2.2 ★ 关键路径)

- **10+ 资源类型**(Go `world.go`): Tree / RockOre / Grass / RabbitHut / Berry / Mushroom / Reed / Flint / Bone / Twig / Bush / BerryBush = 12 种(超额满足 10+)
  - HP:草/芦苇/燧石/骨/木棍/浆果/蘑菇/兔窝=1,树/矿/灌木/浆果丛=3
  - 采集时长:全部 1500ms ± 100ms(任务验收 ①)
  - ReachPixels: 48 / 64(32px 网格对齐)
  - 浆果丛 RespawnAfterMS=60s(重生)
- **服务端采集 tick 推进**: `Room.TickGather(now)` 20Hz tick 循环,到 ExpiresAt 扣 1 HP;HP=0 → 移除(或重生)
- **GATHER 处理**: `HandlePlayerInputGather` 距离判定 + 创建/覆盖 GatherProgress(每次发新 GATHER 都重置 1.5s 倒计时)
- **HP 同步**(任务验收 ④): tick 检测到 HP 变化时,广播 S2C_WorldDelta.entity_updates 给全队
- **客户端联动**(GDScript):
  - `scripts/resource.gd` — sprite 抖动(HP 变化触发 0.15s 抖动 + 4px 振幅)+ HP 文字 + 颜色随 HP 衰减
  - `scripts/player.gd` — 头顶 ProgressBar 1.5s 倒计时
  - `scripts/world.gd` — WorldSnapshot.Entities spawn 资源,接收 S2C_WorldDelta 更新 HP / 玩家位置

### 测试

- Go 端:
  - 既有 53 个测试全过(M1.5+M1.9+M1.10+M1.11 baseline 不破坏)
  - 新增 5 个 M2.1/M2.2 验收测试:
    - `TestM21_Acc01_MoveUpdatesPosition` — 移动位置 + facing 广播
    - `TestM21_Acc02_MoveCancelsGather` — 移动取消当前采集
    - `TestM22_Acc01_10ResourceTypes_1500ms` — 12 种资源 1.5s ± 200ms 验证
    - `TestM22_Acc02_ProgressExpiresAt_1500ms` — GatherProgress.ExpiresAt = now + 1500ms
    - `TestM22_Acc03_HPSync_BroadcastToAllPlayers` — p2 收到 host 的 GATHER 引起的 WorldDelta(含 grass HP 变化 + GATHER_DONE event)
  - 全部 58 个测试 PASS(0.6s)

### 关键路径意义

- M2.2 解锁:
  - M2.6 战斗(怪物掉落材料依赖采集系统产出物品)
  - M2.7 合成(树/矿/芦苇/燧石等资源是合成的输入)
  - M2.14 联机压测(资源同步是联机带宽预算的关键场景)
- M2.1 解锁:
  - M2.10 战斗(玩家需要位置预测 + 服务端校正)
  - M3.1 联机完整版(20Hz tick + 客户端预测模式)

### 风险与限制

- 客户端进度条用本地计时 1.5s,未严格从 ack_input_seq 推导(简化)
- 资源位置由服务端 InitWorld 决定(每种 1 个);真实游戏中 M2.7 生物群系 spawner 接管
- M2.10 战斗 AI 的 ATTACK handler 已占位(只 ack),M2.10 任务实现完整攻击

---

## v0.3.0 — M1.11 房间创建/加入/退出 (2026-08-20)
## v0.2.0 — M1.5+M1.9+M1.10 联机三件套 (2026-08-20)
## v0.1.0 — M1.1 脚手架 (2026-08-20)
