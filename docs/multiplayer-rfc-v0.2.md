# Wildwood 联机架构 RFC v0.2

> 状态:草案 v0.2 · 维护人:高级开发工程师 · 适用版本:Wildwood v0.7 联机预研
> 前置:RFC v0.1([docs/multiplayer-rfc-v0.1.md](./multiplayer-rfc-v0.1.md),PR #4 已合并)
> 关联 ADR:《项目总方案》<https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu>
> 本版相对 v0.1 的增量:**A/B/资源元数据 三层 interface signature 补全 + 5 个 PoC 最小验证骨架**

---

## 目录

- [1. 背景与动机(沿用 v0.1)](#1-背景与动机)
- [2. 三层抽象总览(沿用 v0.1)](#2-三层抽象总览)
- [3. A 层 — 数据层 interface signature](#3-a-层--数据层-interface-signature)
  - [3.1 权威划分(沿用)](#31-权威划分)
  - [3.2 CRDT 选型(沿用)](#32-crdt-选型)
  - [3.3 玩家位置(沿用)](#33-玩家位置)
  - [3.4 **v0.2 新增** — 4 个 Service 接口契约](#34-v02-新增--4-个-service-接口契约)
- [4. B 层 — 网络协议层 interface signature](#4-b-层--网络协议层-interface-signature)
  - [4.1 消息类型(沿用)](#41-消息类型)
  - [4.2 序列化(沿用)](#42-序列化)
  - [4.3 传输(沿用)](#43-传输)
  - [4.4 **v0.2 新增** — G_STATE / G_ACTION / G_EVENT 接口契约](#44-v02-新增--g_state--g_action--g_event-接口契约)
- [5. 资源元数据层 interface signature](#5-资源元数据层-interface-signature)
  - [5.1 tile 资源哈希(沿用)](#51-tile-资源哈希)
  - [5.2 **v0.2 新增** — version negotiation 契约](#52-v02-新增--version-negotiation-契约)
  - [5.3 **v0.2 新增** — patch strategy 契约](#53-v02-新增--patch-strategy-契约)
- [6. PoC 关键问题与最小验证实验(骨架补全)](#6-poc-关键问题与最小验证实验骨架补全)
- [7. 风险与未决问题(增量)](#7-风险与未决问题增量)
- [8. 路线图(更新)](#8-路线图更新)
- [附录 A:Interface 速查表](#附录-ainterface-速查表)

---

## 1. 背景与动机

> 全文沿用 v0.1 §1。简要复述三处耦合:
>
> - **数据层耦合**:`src/world/`、`src/npc/`、`src/craft/` 共享可变对象
> - **协议语义耦合**:`src/render/` 读 player/tile/npc 字段顺序硬编码
> - **资源元数据耦合**:`assets/art/biomes/` 命名约定散落
>
> v0.6 启动联机预研,第一步不是写房间服务,而是抽象出 A/B/元数据三层可独立替换接口。
> v0.2 聚焦:把 v0.1 §3-§5 提到的接口**真正签出 TypeScript signature**,并为 §6 的 5 个 PoC 附最小可跑骨架。

## 2. 三层抽象总览

| 层 | 关注点 | 谁拥有权威 | 替换难度 |
| --- | --- | --- | --- |
| **A 数据层** | 世界状态(地块、生物、库存、NPC 好感) | 服务端 | 高(影响全部业务模块) |
| **B 网络协议层** | 消息类型、序列化、传输、心跳 | 双端共同定义,客户端可替换实现 | 中(影响 main.js 与传输) |
| **资源元数据层** | tile 资源哈希、版本、patch 策略 | 服务端权威,客户端按需 patch | 低(只影响资源加载) |

**v0.2 关键约束(新增)**:所有 A 层 Service 只能通过下述 §3.4 列出的 12 个语义化方法被访问,业务模块**禁止**直接读 `state.tiles[5][3]` 这种"穿透式"访问——一切读写都走接口,保证「单机/联机切换不需要改业务模块」。

---

## 3. A 层 — 数据层 interface signature

### 3.1 权威划分(沿用 v0.1)

| 子域 | 权威 | 理由 |
| --- | --- | --- |
| tile 编辑(挖、种、砍) | 服务端 | 多人可同时操作同一地块,必须串行化 |
| 生物 AI(NPC 寻路、怪物巡逻) | 服务端 tick 决定 | 客户端看到的只是历史快照 |
| 库存 / 物品栏 | 服务端 | 交易、烹饪、采集的最终依据 |
| NPC 好感度 | 服务端累加 | 多人协作会重复送礼 |
| boss 击杀权属 | 服务端按「对 boss 总伤害贡献」仲裁 | 防止最后一下抢人头 |
| 玩家位置 | 客户端权威 + 服务端校验 | 见 §3.3 |
| 本地 UI 状态(选中的格子、打开的面板) | 纯客户端 | 不应上链 |

### 3.2 CRDT 选型(沿用 v0.1)

LWW-Set + RGA,tile 编辑走服务端串行队列 + `(tick, actorId)` 字典序仲裁。

### 3.3 玩家位置(沿用 v0.1)

客户端 20Hz 上报 → 服务端预测 + 夹回 + 位移上限校验 → 真实位置 200ms 广播降频。

### 3.4 **v0.2 新增** — 4 个 Service 接口契约

> **设计原则**:
> 1. **Serialize 是纯函数**:不持有闭包,不引用可变全局,只读 `state` 后输出 canonical 字节流。
> 2. **Delta 模式按 (tick, actorId) 字典序仲裁**:客户端只持有 baseHash + delta 即可重建。
> 3. **hash() 必须稳定**:同样的 state 两次调用必须得到同样 hash(键排序 + 类型 tag)。
> 4. **applyDelta 必须幂等**:同一 delta 应用两次结果一致,用于 at-least-once 重传。

#### 3.4.1 `WorldStateService`

```typescript
// src/multiplayer/a/world-state-service.d.ts

/**
 * A.WORLD.v1 顶层 schema — 服务端 dump 给客户端的完整世界状态
 * (除玩家位置外,玩家位置走 G_EVENT.PLAYER_MOVE,不进 WorldState)
 */
export interface WorldStateV1 {
  readonly schema: 'A.WORLD.v1';
  readonly tick: number;            // 服务端 tick,客户端以此排序
  readonly fullHash: string;        // SHA-256 hex of canonical(this)
  readonly time: { tick: number; dayPhase: 'day' | 'dusk' | 'night' | 'dawn'; dayCount: number };
  readonly tiles: TileRecord[];     // 只 dump 玩家视野范围内 ± 视野半径的 tile
  readonly npcs: NpcRecord[];
  readonly buildings: BuildingRecord[];
  readonly monsters: MonsterRecord[];
  readonly inventory: InventoryRecord[];   // 玩家的(只 dump 本地玩家)
}

export interface TileRecord    { x:number; y:number; biome:string; resourceId:string|null; hp:number; meta?:Record<string,unknown> }
export interface NpcRecord     { id:string; x:number; y:number; aiState:string; hp:number; faction:string; ownerId?:string; meta?:Record<string,unknown> }
export interface BuildingRecord{ id:string; x:number; y:number; type:string; hp:number; ownerId?:string; meta?:Record<string,unknown> }
export interface MonsterRecord { id:string; x:number; y:number; hp:number; maxHp:number; species:string; aiState:string; damageLedger?:Record<string,number>; meta?:Record<string,unknown> }
export interface InventoryRecord{ slot:number; itemId:string; count:number; durability?:number }

/**
 * WorldStateService.serialize — 服务端权威状态的序列化入口
 * @param state  服务端持有 WorldState(可读,不允许 mutate)
 * @param opts.full       true=全量 dump;false=增量(只输出与 baseHash 不同部分)
 * @param opts.baseHash   增量模式下客户端持有的基线 hash(必填)
 * @param opts.vision     玩家视野半径(只 dump 视圆内 tile,默认 12)
 * @returns WorldStateV1,fullHash 字段是 canonical 序列化后再算 SHA-256
 */
export declare function serialize(
  state: WorldStateV1,
  opts: { full: true; vision?: number } | { full: false; baseHash: string; vision?: number }
): WorldStateV1;

/**
 * WorldStateService.deserialize — 客户端用 SNAPSHOT 消息构造本地 world
 * 内部走 canonical JSON.parse + schema 校验 + 字段白名单
 */
export declare function deserialize(bytes: Uint8Array | string): WorldStateV1;

/**
 * WorldStateService.applyDelta — 客户端把后续 SNAPSHOT(增量)叠加到本地
 * @returns {{ok:boolean; reason?:string; newHash:string}}
 *   - ok=false 时客户端应回退到 full snapshot 重连
 *   - newHash 是叠加后的完整状态 hash,供下次增量比对
 */
export declare function applyDelta(local: WorldStateV1, delta: WorldStateV1): { ok: boolean; reason?: string; newHash: string };

/**
 * WorldStateService.hash — 计算完整状态 hash(用于版本协商 + 一致性校验)
 * 纯函数;两次调用同 state 必同 hash。
 */
export declare function hash(state: WorldStateV1): string;
```

**约束与边界(重要)**:
- `serialize` 输出的 `tiles` 数组按 `x * 100000 + y` 升序排,保证 hash 稳定。
- `monsters.damageLedger` 字段仅服务端使用,客户端 deserialize 时丢弃(防止客户端伪造伤害)。
- `applyDelta` 在 `(tick, actorId)` 乱序时返回 `{ok:false, reason:'OUT_OF_ORDER'}`。

#### 3.4.2 `EventService`(RGA 时间线)

```typescript
// src/multiplayer/a/event-service.d.ts

/**
 * 事件类型联合 —— RGA 节点
 * 与 v0.1 §4.1 PATCH 的 op 字段不同,EventService 处理的是「发生了一件事」
 * (NPC 好感度变化、boss 死亡、玩家聊天),而 op 处理的是「修改了某格」
 */
export type EventKind =
  | 'NPC_GIFT'           // payload: {npcId, actorId, itemId, deltaFavor}
  | 'NPC_FAVOR_CHANGE'   // payload: {npcId, actorId, deltaFavor, reason}
  | 'BOSS_KILL'          // payload: {bossId, killerId, damageContrib:Record<playerId,number>}
  | 'TILE_EDIT'          // payload: {x,y,before,after,toolId}
  | 'PLAYER_JOIN'        // payload: {playerId, name}
  | 'PLAYER_LEAVE'       // payload: {playerId, reason}
  | 'PLAYER_DEATH'       // payload: {playerId, cause}
  | 'CHAT'               // payload: {playerId, text, channel:'team'|'nearby'}

export interface RgaNode {
  readonly eventId: string;          // 服务端单调 id,如 'e_<tick>_<seq>'
  readonly prevEventId: string|null; // RGA 前驱;null 表示链表头
  readonly tick: number;
  readonly actorId: string;
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;
  readonly causalChain?: string[];   // 可选,反向因果链(用于客户端 UI 工具提示)
  readonly hash: string;             // SHA-256 of canonical(this - hash)
}

export interface RgaLog {
  readonly schema: 'A.EVENT.v1';
  readonly tick: number;
  readonly head: RgaNode | null;     // 最新事件(链表头)
  readonly indexById: Record<string, RgaNode>;  // 全量索引,用于 applyEvent 跳转
  readonly size: number;             // 节点总数
}

/**
 * EventService.serialize — 服务端把 RGA 链表 dump 出来
 * @param log       服务端持有 RGA 链表
 * @param opts.since 只 dump eventId > since(增量);不传则全量
 * @returns RgaLog,head/indexById/size 三件套
 */
export declare function serialize(log: RgaLog, opts?: { since?: string }): RgaLog;

/**
 * EventService.applyEvent — 客户端把单个新事件 append 到本地 RGA 副本
 * @returns {{ok:boolean; reason?:string; newHead:string}}
 *   - prevEventId 不在本地 indexById 时返回 ok:false,reason:'MISSING_PREV'
 *   - 客户端应触发 full RgaLog resync
 */
export declare function applyEvent(local: RgaLog, node: RgaNode): { ok: boolean; reason?: string; newHead: string };

/**
 * EventService.replay — 客户端从某个 checkpoint 重放到最新
 * 用于客户端断线重连后增量回放,保证因果序
 */
export declare function replay(local: RgaLog, fromEventId: string, remoteFull: RgaLog): RgaLog;
```

**约束与边界**:
- RGA 节点 `eventId` 服务端**严格单调**;`prevEventId` 必须指向 log 中已存在节点或为 null。
- `causalChain` 字段不参与 hash(纯展示用),`hash` 字段不参与自身 hash 计算。
- 客户端只能通过 `applyEvent` append,不可直接 mutate `local.head` 或 `indexById`。

#### 3.4.3 `BuildingService`

```typescript
// src/multiplayer/a/building-service.d.ts

export interface BuildingListV1 {
  readonly schema: 'A.BUILDING.v1';
  readonly tick: number;
  readonly fullHash: string;
  readonly buildings: BuildingRecord[];
}

/**
 * BuildingService.serialize — 服务端 dump 建筑列表
 * 建筑量级小(通常 < 200),默认全量;不做增量
 */
export declare function serialize(state: WorldStateV1): BuildingListV1;

/**
 * BuildingService.applyPatch — 客户端应用「放置/拆除」操作
 * @param op {x,y,kind:'PLACE'|'REMOVE',buildingType?,actorId,tick}
 * @returns {{ok:boolean; reason?:string; newBuilding?:BuildingRecord}}
 *   - PLACE 时如果 (x,y) 已有建筑 → ok:false,reason:'OCCUPIED'
 *   - REMOVE 时如果 (x,y) 没有建筑 → ok:false,reason:'NOT_FOUND'
 *   - kind=PLACE 必须带 buildingType;REMOVE 不需要
 */
export declare function applyPatch(local: BuildingListV1, op: BuildingOp): { ok: boolean; reason?: string; newBuilding?: BuildingRecord };

export interface BuildingOp {
  x: number; y: number; tick: number; actorId: string;
  kind: 'PLACE' | 'REMOVE';
  buildingType?: string;  // PLACE 时必填
}
```

**约束与边界**:
- 建筑操作是**强同步**:服务端收到 G_ACTION 立即 ack 或 reject,不延迟。
- 客户端乐观更新:点 PLACE → 立即显示半透明 → 收到 ack 后实色 / 收到 reject 后撤回。

#### 3.4.4 `MonsterService`

```typescript
// src/multiplayer/a/monster-service.d.ts

export interface MonsterListV1 {
  readonly schema: 'A.MONSTER.v1';
  readonly tick: number;
  readonly fullHash: string;
  readonly monsters: MonsterRecord[];
  readonly damageLedgerVisible: boolean;  // 客户端是否能看到伤害贡献(防作弊,默认 false)
}

/**
 * MonsterService.serialize — 服务端 dump 怪物列表
 * 默认不 dump damageLedger(只服务端使用);damageLedgerVisible=true 时才 dump
 * 用于 PoC-4 boss 击杀权属调试
 */
export declare function serialize(state: WorldStateV1, opts?: { damageLedgerVisible: boolean }): MonsterListV1;

/**
 * MonsterService.applyDamage — 客户端上报伤害(只本地玩家对自己目标的伤害)
 * @param op {monsterId, damage, actorId, tick, weaponId?}
 * @returns {{ok:boolean; reason?:string; newHp:number}}
 *   - monsterId 不存在 → ok:false,reason:'UNKNOWN_MONSTER'
 *   - 单帧 damage > MAX_SINGLE_HIT → ok:false,reason:'OVER_DMG'(反作弊)
 *   - monster 已死亡 → ok:false,reason:'ALREADY_DEAD'
 */
export declare function applyDamage(local: MonsterListV1, op: DamageOp): { ok: boolean; reason?: string; newHp: number };

/**
 * MonsterService.applyDeath — 服务端广播 boss 死亡事件
 * 由 EventService.BOSS_KILL 触发,这里只更新本地 hp=0 + 移除 AI
 */
export declare function applyDeath(local: MonsterListV1, monsterId: string, tick: number): MonsterListV1;

export interface DamageOp {
  monsterId: string; damage: number; actorId: string; tick: number; weaponId?: string;
}
```

**约束与边界**:
- 客户端只对自己造成的伤害调 `applyDamage`(本地预测);服务端 tick 后广播权威 hp。
- `damageLedger` 永远只在服务端,**不下发给客户端**(v0.2 阶段),防客户端伪造。
- PoC-4 调试时单独打开 `damageLedgerVisible=true`,PoC 跑完立刻关闭。

---

## 4. B 层 — 网络协议层 interface signature

### 4.1 消息类型(沿用 v0.1)

```
HELLO        { version, playerId, sessionToken }   // 握手
SNAPSHOT     { tick, full_state_hash, deltas[] }  // 全量/增量
INPUT        { tick, actor, op }                   // 客户端输入
PATCH        { tick, actor, op }                   // 服务端广播
HEARTBEAT    { ts }                                // 双向
GOODBYE      { reason }
```

### 4.2 序列化(沿用 v0.1)

首选 MessagePack,JS 端 `@msgpack/msgpack`、Go 端 `vmihailenco/msgpack`。

### 4.3 传输(沿用 v0.1)

WebSocket 为主通道,Gorilla/websocket;WebRTC DataChannel 作为近距离 P2P 备选;客户端 3s 内重连。

### 4.4 **v0.2 新增** — G_STATE / G_ACTION / G_EVENT 接口契约

> **设计原则**:
> 1. **三类消息覆盖 v0.1 全部 wire 消息**:
>    - `G_STATE` = `SNAPSHOT`(全量/增量状态)
>    - `G_ACTION` = `INPUT`(客户端→服务端操作)
>    - `G_EVENT` = `PATCH` 中「事件型」子集(服务端→所有客户端)
> 2. **compress 是纯函数**:只读传入对象,输出 MessagePack 字节流,**不做加密/签名**(后续可加)。
> 3. **apply 是幂等操作**:同一消息应用两次状态不变;乱序消息必须返回 `{ok:false,reason}`。
> 4. **每个 G_* 都带 schema tag**:B.G_STATE.v1 / B.G_ACTION.v1 / B.G_EVENT.v1,服务端拒绝旧版客户端。

#### 4.4.1 G_STATE(大状态快照)

```typescript
// src/multiplayer/b/g-state.d.ts

/**
 * B.G_STATE.v1 — 服务端 → 客户端的状态同步消息
 * 触发时机:玩家加入时发一次全量;之后每 200ms 发一次增量(视玩家视野变化)
 */
export interface GStateV1 {
  readonly schema: 'B.G_STATE.v1';
  readonly tick: number;             // 服务端 tick
  readonly baseHash: string | null;  // null=全量;非空=增量,客户端据此合并
  readonly payload: WorldStateV1;    // A.WORLD.v1
  readonly sig: string;              // 服务端签名(防伪造,v0.3 启用,本版先占位)
}

export interface CompressOpts {
  readonly codec?: 'msgpack' | 'json';   // 默认 msgpack
  readonly compression?: 'none' | 'deflate' | 'zstd';  // 默认 none;zstd 需服务端装 go-zstd
  readonly includeDamageLedger?: boolean;  // 调试 PoC-4 用
}

/**
 * compressG_STATE — 服务端把 WorldState 编码成 wire 消息
 * @returns Uint8Array(已是 MessagePack/JSON 序列化结果)
 */
export declare function compressG_STATE(
  payload: WorldStateV1,
  opts: CompressOpts & { baseHash: string | null }
): Uint8Array;

/**
 * applyG_STATE — 客户端把 wire 消息解码并合并到本地 world
 * @returns {{ok:boolean; reason?:string; newHash:string; applied:boolean}}
 *   - applied=false 时客户端应忽略本条消息(去重/乱序)
 *   - newHash 是合并后 hash,供下次 G_STATE 增量比对
 */
export declare function applyG_STATE(
  bytes: Uint8Array,
  local: WorldStateV1 | null,
  opts: CompressOpts
): { ok: boolean; reason?: string; newHash: string; applied: boolean };
```

**约束**:
- `baseHash=null` 表示全量;客户端收到后必须清空 local world 再 apply。
- `baseHash` 不匹配本地 hash 时,客户端回退到 `applied=false,reason='HASH_MISMATCH'`,并请求服务端发全量。
- `payload` 字段在压缩后必须**不再含 `sig`**(sig 字段在压缩后由 `compressG_STATE` 自行加)。

#### 4.4.2 G_ACTION(玩家操作)

```typescript
// src/multiplayer/b/g-action.d.ts

export type ActionKind =
  | 'MOVE'         // payload: {dx,dy}(预测上报,服务端校验)
  | 'TILE_DIG'     // payload: {x,y,toolId}
  | 'TILE_PLANT'   // payload: {x,y,seedId}
  | 'TILE_HARVEST' // payload: {x,y}
  | 'BUILD_PLACE'  // payload: {x,y,buildingType}
  | 'BUILD_REMOVE' // payload: {x,y}
  | 'ATTACK'       // payload: {monsterId,weaponId,damageHint}
  | 'GIFT_NPC'     // payload: {npcId,itemId,slot}
  | 'CRAFT'        // payload: {recipeId,materialsUsed[]}
  | 'CHAT'         // payload: {text,channel}

export interface GActionV1 {
  readonly schema: 'B.G_ACTION.v1';
  readonly tick: number;            // 客户端意图产生 tick
  readonly actor: string;           // playerId
  readonly seq: number;             // 客户端自增,服务端去重
  readonly intentMs: number;        // Date.now() 客户端时间(仅辅助,不做信任)
  readonly kind: ActionKind;
  readonly payload: Record<string, unknown>;
}

/**
 * compressG_ACTION — 客户端把本地操作编码为 wire 消息
 * 默认 msgpack;带宽敏感场景可开 'zstd'
 */
export declare function compressG_ACTION(action: GActionV1, opts?: CompressOpts): Uint8Array;

/**
 * applyG_ACTION — 服务端把 wire 消息解码并执行
 * 内部顺序:
 *   1. schema 校验 + seq 去重
 *   2. (tick, actor) 字典序仲裁,乱序丢弃
 *   3. 调用对应 A 层 Service(BUILDING/MONSTER/INVENTORY/NPC)的 apply* 方法
 *   4. 服务端 tick 后回 PATCH(= G_EVENT 列表)
 * @returns {{ok:boolean; reason?:string; patchId?:string}}
 *   - patchId:成功时返回,客户端可据此 ack
 */
export declare function applyG_ACTION(
  bytes: Uint8Array,
  ctx: {
    actor: string;                       // 当前连接 playerId
    serverTick: number;
    world: WorldStateV1;
    aLayer: AServiceRegistry;            // 注入 A 层服务
  },
  opts?: CompressOpts
): { ok: boolean; reason?: string; patchId?: string };

/** A 层服务注册表(B 层只通过这个调 A,不直接读 WorldState) */
export interface AServiceRegistry {
  worldState:   typeof import('../a/world-state-service.js');
  event:        typeof import('../a/event-service.js');
  building:     typeof import('../a/building-service.js');
  monster:      typeof import('../a/monster-service.js');
}
```

**约束**:
- `seq` 是**客户端单调自增**(重启后归零),服务端用 `(actor, seq)` LRU 去重,容量 1024。
- `intentMs` 仅用于服务端估算 RTT(回声给客户端,做自适应预测),不做信任源。
- 服务端必须在 50ms 内 ack(PATCH 或 reject),否则客户端视为丢包重发。

#### 4.4.3 G_EVENT(时间线事件广播)

```typescript
// src/multiplayer/b/g-event.d.ts

/**
 * B.G_EVENT.v1 — 服务端 → 所有客户端的事件广播
 * 用于:玩家加入/离开/NPC 好感度变化/boss 死亡/聊天
 * 与 G_STATE 不同:G_STATE 是「状态是什么」,G_EVENT 是「发生了什么」
 */
export interface GEventV1 {
  readonly schema: 'B.G_EVENT.v1';
  readonly tick: number;
  readonly rgaNode: RgaNode;         // A.EVENT.v1 单个节点(EventService.serialize 的子集)
  readonly broadcast: 'ALL' | 'TEAM' | 'NEARBY';  // 广播范围
}

export interface CompressGEventOpts extends CompressOpts {
  readonly since?: string;  // 增量:只发 eventId > since
}

/**
 * compressG_EVENT — 服务端把 RGA 新节点编码为 wire 消息
 * since 不传 → 全量(只发 head);since 传了 → 发 [since+1, head] 区间
 */
export declare function compressG_EVENT(
  log: RgaLog,
  opts: CompressGEventOpts & { broadcast: GEventV1['broadcast'] }
): Uint8Array;

/**
 * applyG_EVENT — 客户端把 wire 消息解码并 append 到本地 RGA 副本
 * 内部走 EventService.applyEvent(§3.4.2)
 * @returns {{ok:boolean; reason?:string; newHead:string}}
 */
export declare function applyG_EVENT(
  bytes: Uint8Array,
  localRga: RgaLog,
  opts?: CompressOpts
): { ok: boolean; reason?: string; newHead: string };
```

**约束**:
- `broadcast=NEARBY` 时,服务端按 tile 距离过滤,客户端不需要知道是哪些人——只看自己是否在范围内。
- 客户端必须有 RGA 副本;首次加入时服务端连发 N 个 G_EVENT 直到 `localRga.head.eventId == serverHead.eventId`。

---

## 5. 资源元数据层 interface signature

### 5.1 tile 资源哈希(沿用 v0.1 + 接口补全)

```typescript
// src/multiplayer/resources/tile-hash.d.ts

export interface ResourceMetaV1 {
  readonly schema: 'RES.META.v1';
  readonly version: number;          // 单调递增
  readonly generatedAt: string;      // ISO 8601
  readonly tiles: Record<string, ResourceEntry>;
}

export interface ResourceEntry {
  readonly sha256: string;           // hex
  readonly size: number;             // bytes
  readonly deps: string[];           // 依赖 id(用于拓扑序)
  readonly cdnUrl: string;           // 相对或绝对 URL
}

/**
 * computeTileHash — 单文件 SHA-256(用于本地缓存比对)
 * 服务端打包时算一次,客户端 patch 时算一次,结果必须一致
 */
export declare function computeTileHash(bytes: Uint8Array): string;

/**
 * canonicalizeTileMap — 把 ResourceMap 序列化成 canonical 字符串
 * (按 id 字典序排序,再 JSON.stringify)用于计算 map 级别 hash
 */
export declare function canonicalizeTileMap(map: ResourceMetaV1): string;

/**
 * manifestHash — ResourceMap 整体 hash,客户端 manifest 比对入口
 */
export declare function manifestHash(map: ResourceMetaV1): string;
```

**约束**:
- 任何资源文件改动 → sha256 变 → version 递增 +1(打包流水线自动)。
- 客户端持有 `localManifest` 与 `serverManifest` 比对 → 调用 §5.3 diffManifest。

### 5.2 **v0.2 新增** — version negotiation 契约

```typescript
// src/multiplayer/resources/version-negotiation.d.ts

export type NegotiationAction = 'PATCH' | 'DOWNGRADE' | 'REJECT';

export interface NegotiationResult {
  readonly action: NegotiationAction;
  readonly reason: string;             // 可展示给玩家
  readonly targetVersion: number;      // 客户端应该升级/降级到的版本
  readonly patchList?: string[];       // action='PATCH' 时,需要下载的 resourceId 列表
}

/**
 * negotiateVersion — 客户端 HELLO 时调,服务端决定怎么处理
 * @param clientVersion 客户端持有 manifest.version
 * @param serverVersion 服务端当前 manifest.version
 * @param opts.rejectThreshold 不匹配超过多少 minor 版本就拒绝(v0.2 默认 2)
 * @param opts.diffResult  当 action='PATCH' 时填入 §5.3 diffManifest 的输出
 */
export declare function negotiateVersion(
  clientVersion: number,
  serverVersion: number,
  opts: {
    rejectThreshold?: number;
    diffResult?: ReturnType<typeof import('./patch-strategy.js').diffManifest>;
  }
): NegotiationResult;

/**
 * 规则(v0.2 锁定,后续 v0.3 评估再调):
 * - client == server → action='PATCH'(空 patchList,客户端无需下载)
 * - client < server,差 ≤ rejectThreshold → action='PATCH',patchList 列出 missing/changed
 * - client < server,差 > rejectThreshold → action='REJECT',要求更新
 * - client > server → action='DOWNGRADE',服务端降级到 clientVersion
 *                       (警告:此分支意味着客户端有未发布的内容,仅 dev 环境)
 */
```

### 5.3 **v0.2 新增** — patch strategy 契约

```typescript
// src/multiplayer/resources/patch-strategy.d.ts

export interface PatchPlan {
  readonly toFetch: ResourceEntry[];     // 按拓扑序排好
  readonly topoOrder: string[];          // resourceId 数组,按依赖图拓扑序
  readonly totalBytes: number;
  readonly criticalCount: number;        // 标记为 critical 的资源数(失败阻塞登录)
}

export interface AtomicSwapResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly newManifestHash: string;
  readonly swappedCount: number;
}

/**
 * diffManifest — 计算本地 manifest 与远程 manifest 的差异
 * @returns PatchPlan,toFetch 已经按拓扑序排好
 * 关键:依赖先于被依赖者下载 → 避免「切到新资源时老依赖还在」
 */
export declare function diffManifest(
  local: ResourceMetaV1,
  remote: ResourceMetaV1
): PatchPlan;

/**
 * atomicSwap — 客户端在 patch 完成后原子切换资源
 * 实现要点:
 *   1. 进入临界区(暂停所有 RenderTile 调用)
 *   2. 替换 resourceMap 引用
 *   3. 一次性 commit + 退出临界区
 * @returns AtomicSwapResult,ok=false 时本地 manifest 未改变(回滚安全)
 */
export declare function atomicSwap(
  current: ResourceMetaV1,
  next: ResourceMetaV1,
  ctx: { isInCriticalSection: () => boolean; enterCritical: () => void; exitCritical: () => void }
): AtomicSwapResult;

/**
 * fetchPatch — 按 PatchPlan 并发下载(并发度=6,失败重试 3 次)
 * 失败时 critical 资源失败 → 阻止进入游戏;非 critical 失败 → 提示但不阻塞
 */
export declare function fetchPatch(
  plan: PatchPlan,
  ctx: { fetch: typeof fetch; onProgress?: (loaded:number, total:number) => void; criticalIds?: string[] }
): Promise<{ ok: boolean; failedCritical: string[]; failedOptional: string[]; next: ResourceMetaV1 }>;
```

**约束**:
- 拓扑序必须**严格**:如果 `A.deps` 包含 `B`,则 `B` 必须在 `A` 之前出现在 `topoOrder`。
- `atomicSwap` 调用方必须提供 `isInCriticalSection/enter/exit` 三个钩子,保证 swap 期间不会被 RenderTile 读到中间态。
- 失败重试用指数退避(1s/3s/9s),总耗时不超过 30s,超时则视为 fetch 失败。

---

## 6. PoC 关键问题与最小验证实验(骨架补全)

> v0.1 §6 给了 5 个 PoC 的"问题 + 通过判据 + 回滚",v0.2 在 `docs/rfc-v0.2/pocs/poc-{1..5}/` 下附**最小可跑代码骨架**。
> 每个 PoC 都是「单人/无 UI/纯 Node.js 进程」,可在 1 周内完成,失败可回滚。
> 跑法统一:`cd docs/rfc-v0.2/pocs/poc-N && node index.mjs`(每个目录下有 README 详细说明)。

### 6.1 PoC-1:玩家位置同步频率 vs 带宽

- **目录**:`docs/rfc-v0.2/pocs/poc-1-position-bandwidth/`
- **入口**:`index.mjs`(mock client × 4 + mock server × 1)
- **关键代码**:`bot.move()`, `server.receive()`, `metrics.printReport()`
- **通过判据**:p95 RTT < 80ms、服务端单核 CPU < 30%、出口带宽 < 50KB/s/房
- **回滚**:把上报频率从 20Hz 降到 10Hz,广播从 200ms 降到 500ms

### 6.2 PoC-2:tile 编辑冲突

- **目录**:`docs/rfc-v0.2/pocs/poc-2-tile-conflict/`
- **入口**:`index.mjs`(2 个 fake client + fake server + conflict detector)
- **关键代码**:`client.click(x,y)`, `server.applyOp()`, `metrics.clickToPatchLatency`
- **通过判据**:p95 < 100ms(本地 mock,真实网络再 +RTT)
- **回滚**:对热门地块加「操作队列 + 视觉锁」

### 6.3 PoC-3:NPC 好感度同步

- **目录**:`docs/rfc-v0.2/pocs/poc-3-npc-favor/`
- **入口**:`index.mjs`(2 client × 1000 gift,服务端正向校验 LWW-Set)
- **关键代码**:`lwwSet.add()`, `server.applyEvent()`, `assertFinalFavor == 20`
- **通过判据**:1000 次送礼物,无丢、无重复
- **回滚**:单 NPC 单 tick 只接受一人操作

### 6.4 PoC-4:boss 击杀权属

- **目录**:`docs/rfc-v0.2/pocs/poc-4-boss-kill/`
- **入口**:`index.mjs`(10000 HP boss,4 bot 各打不同 DPS,模拟 1000 场)
- **关键代码**:`boss.takeDamage()`, `boss.die()`, `attribution.allocate(damageContrib)`
- **通过判据**:1000 场模拟,前 1 名伤害占比始终 > 0
- **回滚**:改成「全队共享掉落池,按贡献度加权分配」

### 6.5 PoC-5:客户端 patch 原子切换

- **目录**:`docs/rfc-v0.2/pocs/poc-5-atomic-swap/`
- **入口**:`index.mjs`(模拟 30%/70%/99% patch 完成时强制刷新)
- **关键代码**:`fetchPatch()`, `atomicSwap()`, `assertNoMixedState()`
- **通过判据**:100 次刷新,无混合态(老资源 + 新资源 不会同时被 RenderTile 读到)
- **回滚**:增加「切换临界区」,patch 完成前禁止重渲染

> **每个 PoC 目录的统一结构**:
> ```
> poc-N-name/
> ├── README.md         # 跑法 + 通过判据 + 回滚方案
> ├── index.mjs         # 主入口(可直接 node index.mjs)
> ├── mock-server.mjs   # mock 服务端(仅 1 个文件,内联类)
> ├── mock-client.mjs   # mock 客户端(同上)
> └── metrics.mjs       # 指标打印(可选,部分 PoC 内联)
> ```
> 骨架**能跑但不完整**——本版目标是把接口签名落到代码里,v0.7 联机实现阶段再补业务侧。

---

## 7. 风险与未决问题(增量)

> 沿用 v0.1 §7 全部内容,新增 v0.2 阶段识别到的 3 条:

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| A 层 Service 12 个方法签名后期发现不够 | 中 | v0.7 接入业务时按需加;新增方法必须走 RFC 评审,不允许直接加 |
| B 层 compress/apply 双向同步时,RGA head 漂移 | 中 | 客户端定期用 `replay()` 重放;PoC-3 验证 |
| 资源 patch 失败时,critical 与 optional 资源界限不清 | 低 | v0.2 显式 `criticalIds` 参数;v0.3 评估是否做 manifest 字段化 |
| 服务端反作弊(玩家位置、伤害) | 中 | §3.3 + PoC-4;v0.3 引入 sig 签名 |
| Godot 4.3 / Unity 6 两端 schema 同步 | 中 | 单一 `op` schema 由服务端 SSoT 导出,两端代码生成 |

**v0.2 阶段新增的未决问题**:

1. RGA `causalChain` 是否下发给客户端?(展示用,不影响逻辑,但占带宽)
2. `CompressOpts.compression='zstd'` 是否要在 v0.7 启用?(go-zstd 已稳定,但增加打包依赖)
3. `damageLedgerVisible` 是否要在生产环境保留开关?(目前只 PoC 用,但未来 debug 需要)

---

## 8. 路线图(更新)

- **v0.6.1a**(已合并,PR #4):RFC v0.1,A/B/元数据 设计 + 5 PoC 概述
- **v0.6.1b**(本 PR,PR #5):RFC v0.2,三层 interface signature 补全 + 5 PoC 最小骨架
- **v0.6.2**:A 层 mock 服务端(Node.js,纯内存)实现,跑通 PoC-1~3
- **v0.6.3**:B 层(WebSocket + MessagePack)接入 main.js,跑通 PoC-5
- **v0.6.4**:资源 manifest 接入打包流水线
- **v0.7+**:联机房间服务(Go)与真实反作弊

---

## 附录 A:Interface 速查表

> 给实现者一张单页速查,具体 TypeScript signature 见正文 §3.4 / §4.4 / §5.1-§5.3。

### A.1 A 层(数据层)

| Service | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- |
| `WorldStateService.serialize` | state + opts | `WorldStateV1` | 纯函数;`tiles` 字典序 |
| `WorldStateService.deserialize` | bytes | `WorldStateV1` | 严格 schema 校验 |
| `WorldStateService.applyDelta` | local + delta | `{ok,reason?,newHash}` | 幂等;乱序 reject |
| `WorldStateService.hash` | state | SHA-256 hex | 纯函数;稳定 |
| `EventService.serialize` | log + opts | `RgaLog` | since 之后增量 |
| `EventService.applyEvent` | local + node | `{ok,reason?,newHead}` | prevEventId 必须存在 |
| `EventService.replay` | local + fromId + remote | `RgaLog` | 用于重连后回放 |
| `BuildingService.serialize` | state | `BuildingListV1` | 全量(量级小) |
| `BuildingService.applyPatch` | local + op | `{ok,reason?,newBuilding?}` | OCCUPIED/NOT_FOUND |
| `MonsterService.serialize` | state + opts | `MonsterListV1` | 默认不 dump damageLedger |
| `MonsterService.applyDamage` | local + op | `{ok,reason?,newHp}` | OVER_DMG/UNKNOWN_MONSTER/ALREADY_DEAD |
| `MonsterService.applyDeath` | local + id + tick | `MonsterListV1` | 由 G_EVENT 触发 |

### A.2 B 层(协议语义层)

| 函数 | 触发方 | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- | --- |
| `compressG_STATE` | 服务端 | payload + baseHash | bytes | msgpack 默认 |
| `applyG_STATE` | 客户端 | bytes + local | `{ok,reason?,newHash,applied}` | HASH_MISMATCH 回退全量 |
| `compressG_ACTION` | 客户端 | action | bytes | seq 单调 |
| `applyG_ACTION` | 服务端 | bytes + ctx | `{ok,reason?,patchId?}` | 50ms 内 ack |
| `compressG_EVENT` | 服务端 | log + opts | bytes | 增量 since 之后 |
| `applyG_EVENT` | 客户端 | bytes + localRga | `{ok,reason?,newHead}` | 走 EventService.applyEvent |

### A.3 资源元数据层

| 函数 | 触发方 | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- | --- |
| `computeTileHash` | 打包/客户端 | bytes | SHA-256 hex | 稳定 |
| `canonicalizeTileMap` | 客户端 | map | canonical string | 按 id 字典序 |
| `manifestHash` | 客户端 | map | SHA-256 hex | 稳定 |
| `negotiateVersion` | 客户端 HELLO | clientV + serverV + opts | `NegotiationResult` | 规则见 §5.2 |
| `diffManifest` | 客户端 | local + remote | `PatchPlan` | 拓扑序 |
| `atomicSwap` | 客户端 | current + next + ctx | `AtomicSwapResult` | 临界区保护 |
| `fetchPatch` | 客户端 | plan + ctx | Promise<{...}> | 失败重试 3 次 |

—— 全文完 ——
