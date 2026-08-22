# Wildwood 联机架构 RFC v0.1

> 状态:草案 v0.1 · 维护人:高级开发工程师 · 适用版本:Wildwood v0.6 联机预研
> 关联:ADR 详见《项目总方案》<https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu>

---

## 1. 背景与动机

v0.5 复盘时识别出一类「联机冲突预演」问题:虽然 v0.5 仍为纯前端 Demo,但 git 协作本身已经暴露出三层耦合——

- **数据层耦合**:`src/world/`、`src/npc/`、`src/craft/` 模块间共享可变对象,任何 agent 的提交都可能踩到另一个 agent 改动过的字段。
- **协议语义耦合**:`src/render/` 读 player / tile / npc 的字段顺序在 `main.js` 里硬编码,无法在不破坏渲染的前提下替换实现。
- **资源元数据耦合**:`assets/art/biomes/` 的命名约定散落在 decorator.js 与 catalog.json 中,新增资源时容易在客户端之间产生「同一个 id 解释成不同资源」的隐性 drift。

这三类问题在单人模式下不会爆发,但在联机模式下会立刻变成:玩家 A 看到的位置 ≠ 玩家 B 看到的位置、客户端 patch 错位导致 tile 显示分裂、NPC 好感度被多次覆盖回退。因此,v0.6 启动联机预研,**第一步不是写房间服务**,而是把上面三层抽象成可独立替换的接口(A/B/元数据),让 v0.7+ 真正落地联机时不需要回头改业务模块。

RFC 的目标读者是项目组全员(老板 + 4 agent),以及 v0.7 联机实现阶段的接手人。

## 2. 三层抽象总览

| 层 | 关注点 | 谁拥有权威 | 替换难度 |
| --- | --- | --- | --- |
| **A 数据层** | 世界状态(地块、生物、库存、NPC 好感) | 服务端 | 高(影响全部业务模块) |
| **B 网络协议层** | 消息类型、序列化、传输、心跳 | 双端共同定义,客户端可替换实现 | 中(影响 main.js 与传输) |
| **资源元数据层** | tile 资源哈希、版本、patch 策略 | 服务端权威,客户端按需 patch | 低(只影响资源加载) |

**A/B 分层的关键设计动机**:业务模块(种植、烹饪、NPC、战斗)只依赖 A 层的接口,**不应感知是单机还是联机**。当玩家人数从 1 变到 4,业务模块不应该改一行代码——切换只在 main.js 里做。这一约束的代价是 A 层 API 必须比当前的"直接读对象字段"更抽象(所有写操作走 `World.applyPatch`),但收益是 v0.7 接入房间服务时不需要改 src/npc、src/craft、src/world。

## 3. A 层 — 数据层

### 3.1 权威划分

| 子域 | 权威 | 理由 |
| --- | --- | --- |
| tile 编辑(挖、种、砍) | 服务端 | 多人可同时操作同一地块,必须串行化 |
| 生物 AI(NPC 寻路、怪物巡逻) | 服务端 tick 决定 | 客户端看到的只是历史快照 |
| 库存 / 物品栏 | 服务端 | 交易、烹饪、采集的最终依据 |
| NPC 好感度 | 服务端累加 | 多人协作会重复送礼 |
| boss 击杀权属 | 服务端按「对 boss 总伤害贡献」仲裁 | 防止最后一下抢人头 |
| 玩家位置 | 客户端权威 + 服务端校验 | 见 §3.3 |
| 本地 UI 状态(选中的格子、打开的面板) | 纯客户端 | 不应上链 |

### 3.2 CRDT 选型

对**可交换的子域**(库存物品、已解锁配方)采用 **LWW-Element-Set(Last-Write-Wins by timestamp + actor id)**;对**有序子域**(时间线事件)采用 **RGA(Replicated Growable Array)**。tile 编辑本身不是 CRDT——它落到 `World.applyPatch(patch)` 的串行化队列里,每个 patch 携带 `(x, y, actorId, tick, op)`,服务端用 `(tick, actorId)` 字典序仲裁,丢弃乱序包。

> 选 LWW + RGA 而不是 OT(Operational Transform),因为 Wildwood 4 人房、tick 频率 20Hz、操作粒度粗(整格或整 item),CRDT 的实现成本与心智成本更划算。

### 3.3 玩家位置:客户端权威 + 服务端校验

位置不是 CRDT 字段。客户端按 20Hz 上报 `(x, y, vx, vy, tick)`,服务端:

1. 预测接收时间(根据 RTT/2 偏移)并夹回合法 walkable 范围;
2. 与服务端上一次记录比对,位移 > `MAX_SPEED * dt` 的包视为作弊/丢包,丢弃;
3. 真实位置每 200ms 同步给其他玩家一次(广播降频)。

## 4. B 层 — 网络协议层

### 4.1 消息类型(草案)

```
HELLO        { version, playerId, sessionToken }   // 握手
SNAPSHOT     { tick, full_state_hash, deltas[] }  // 全量/增量
INPUT        { tick, actor, op }                   // 客户端输入
PATCH        { tick, actor, op }                   // 服务端广播
HEARTBEAT    { ts }                                // 双向
GOODBYE      { reason }
```

`deltas[]` 与 `patch[]` 共享同一 `op` schema(`{x,y,kind,before,after}`),降低业务层心智成本。

### 4.2 序列化

候选:**MessagePack**(字节紧凑、JS 端 uMessagePack / Go 端 vmihailenco/msgpack,两端成熟)。**不选 Protobuf**,因为 v0.6 阶段 schema 还在高频调整,protobuf 的 `.proto` 编译会拖慢迭代。v0.8 稳定后再评估是否迁移。

### 4.3 传输

- **首选 WebSocket**(Go 端 Gorilla/websocket 已在技术备线评估过),原因:与 Godot 4.3、Unity 6 Mirror、HTML5 三端都有成熟实现,NAT 穿透交给基础设施。
- **不选 WebRTC DataChannel** 为主通道,只作为 4 人近距离 P2P 优化的备选——WebRTC 的 SDP 协商对小型独立游戏过重。
- **传输层冗余**:客户端断线 3s 内自动重连(走原 sessionToken,服务端续上),3s 后重连失败则进入只读旁观模式,提示「重连中」。

### 4.4 心跳与重连

| 端 | 行为 |
| --- | --- |
| 客户端 | 每 5s 发送 `HEARTBEAT`;超过 15s 未收到服务端 PATCH 视为半开,触发重连 |
| 服务端 | 每 10s 向空闲连接发 `HEARTBEAT`;连续 2 个心跳未回应则关闭 socket |

## 5. 资源元数据层

### 5.1 tile 资源哈希

`assets/manifest.json`(新增)在打包阶段计算每个 tile 资源的 SHA-256,结构:

```json
{
  "version": 42,
  "tiles": {
    "tree.oak": { "sha256": "ab12…", "size": 312, "deps": ["biome.forest"] },
    "biome.forest": { "sha256": "cd34…", "size": 1024 }
  }
}
```

### 5.2 版本协商

客户端连接时发 `HELLO { version }`,服务端比对:

- 客户端 `version < server.version` → 触发 patch 流程(§5.3)
- 客户端 `version > server.version` → 服务端降级到 client 兼容的最旧 manifest(危险,记录告警)
- 不匹配超过 2 个 minor 版本 → 拒绝连接,要求更新

### 5.3 客户端 patch 策略

- 启动时 GET `/manifest.json`,对比本地 cached manifest。
- diff 出 missing/changed 资源,按**依赖图拓扑序**并发拉取(Go 服务端按 CDN URL 范围请求)。
- patch 过程中**不阻塞玩家登录**,先用旧资源降级渲染,patch 完成原子切换。
- patch 失败重试 3 次,仍失败则提示「资源加载失败,请检查网络」并阻止进入游戏。

## 6. PoC 关键问题与最小验证实验

> 每个 PoC 都设计为「单人/无 UI」实验,可在 1 周内完成,失败可回滚。

### PoC-1:玩家位置同步频率 vs 带宽

- **问题**:20Hz 上报 + 200ms 广播,4 人房 60s 内的带宽与 CPU 占用是否在可接受范围?
- **最小实验**:1 进程模拟 4 个 bot(按键随机游走),20Hz 上报到 mock 服务端,记录 60s 内的 p50/p95 RTT、服务端 CPU、出口字节数。
- **通过判据**:p95 RTT < 80ms,服务端单核 CPU < 30%,出口带宽 < 50KB/s/房。
- **回滚**:降到 10Hz 上报 + 500ms 广播,重新跑一次。

### PoC-2:tile 编辑冲突

- **问题**:两个玩家同时挖/种同一格,服务端串行化是否导致可感知的延迟?
- **最小实验**:在 main.js 里造一个假服务端,两个客户端同时点同一格,记录「从点击到 patch 广播回来」的时间。
- **通过判据**:p95 < 100ms(本地 mock,真实网络再 +RTT)。
- **回滚**:对热门地块加「操作队列 + 视觉锁」,UI 显示「排队中」。

### PoC-3:NPC 好感度同步

- **问题**:多人同时送礼给同一 NPC,好感度累加是否正确?会不会出现「送 2 次只 +1」?
- **最小实验**:2 个客户端各送 10 次,服务端用 LWW(Set + vector clock)记录,断言最终好感度 = 20 且无回退。
- **通过判据**:1000 次送礼物测试,无丢、无重复。
- **回滚**:降级为「单 NPC 单 tick 只接受一人的操作」,送不进去的提示「NPC 正忙」。

### PoC-4:boss 击杀权属

- **问题**:boss 死亡瞬间,谁拿到掉落物?按最后一下?按总伤害?
- **最小实验**:mock 一个 10000 HP boss,4 个 bot 各打不同 DPS,服务端按 `damage_contribution` 排序,前 1 名拿掉落。
- **通过判据**:模拟 1000 场,前 1 名伤害占比始终 > 0。
- **回滚**:改成「全队共享掉落池,按贡献度加权分配」,需要重新设计 inventory。

### PoC-5:客户端 patch 原子切换

- **问题**:patch 加载过程中切换,会不会出现半棵树半灌木的渲染态?
- **最小实验**:模拟客户端在 30% / 70% / 99% patch 完成时强制刷新,断言每次刷新要么走老资源,要么走新资源,不存在混合态。
- **通过判据**:100 次刷新,无混合态。
- **回滚**:增加「切换临界区」,patch 完成前禁止重渲染。

## 7. 风险与未决问题

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| CRDT 在 v0.6 阶段增加心智成本,业务模块需要适配 | 中 | PoC-1~3 在 A 层 mock 服务端上做,业务模块不改 |
| WebSocket 在 NAT/防火墙严格的家庭网络不稳定 | 中 | 客户端 3s 内重连,3s 后降级为只读旁观 |
| MessagePack 后期切换 Protobuf 成本高 | 低 | v0.8 评估,届时 schema 稳定 |
| 资源 manifest 体积膨胀 | 低 | 增量 manifest + CDN 缓存,详见 §5.3 |
| 服务端反作弊(玩家位置、伤害) | 中 | §3.3 服务端位移夹回;PoC-4 用总伤害仲裁 |
| Godot 4.3 / Unity 6 两端 schema 同步 | 中 | 单一 `op` schema 由服务端 SSoT 导出,两端代码生成 |

**未决问题**:

1. 房间服务用什么身份系统?(Steam / 微信 / 自建账号?)
2. 4 人房是否要支持中途加入/退出?(影响 SNAPSHOT 全量 vs 增量策略)
3. NPC 好感度跨存档是否要云存档?(需要独立产品决策)
4. 反作弊是否要做到服务端权威运算战斗?(成本高,需 ADR)

## 8. 路线图

- **v0.6.1a**(本 RFC):产出本文件 → 推 docs/ → PR 评审
- **v0.6.2**:基于 RFC 实现 A 层 mock 服务端(Node.js,纯内存),跑通 PoC-1~3
- **v0.6.3**:B 层(WebSocket + MessagePack)接入 main.js,跑通 PoC-5
- **v0.6.4**:资源 manifest 接入打包流水线
- **v0.7+**:联机房间服务(Go)与真实反作弊

—— 全文完 ——
