# PoC-3: NPC 好感度同步 (LWW-Set)

**目标**:验证多人同时送礼给同一 NPC,好感度累加是否正确(无丢失、无重复)。

**对应 RFC 章节**:§3.2 CRDT 选型(LWW-Element-Set)+ §6 PoC-3

## 跑法

```bash
cd docs/rfc-v0.2/pocs/poc-3-npc-favor
node index.mjs                # 2 client × 10 gift
node index.mjs --per-client=500  # 2 client × 500 gift
```

不依赖外部包,纯 Node.js 18+。

## 通过判据

- 最终好感度 = `2 × perClient`(无丢、无重复)
- 多次跑结果稳定
- 无回退(任何时间点的快照值不减小)

## 回滚方案

降级为「单 NPC 单 tick 只接受一人的操作」,送不进去的提示「NPC 正忙」。

## 关键设计

- **LWW-Set**:每个 gift 元素带 `(timestamp, actorId)`,set 仅当新元素 (timestamp, actorId) > 旧时才替换
- **2 个 client 并发送礼**:模拟 `applyG_ACTION(GIFT_NPC)` 高并发
- **最终一致性断言**:服务端 `favor` 必须等于 `2 × perClient`

## 与 RFC v0.2 接口对应

- `compressG_ACTION`(`B.G_ACTION.v1` `GIFT_NPC`)
- `EventService.applyEvent`(`A.EVENT.v1` `NPC_FAVOR_CHANGE`)
- §3.4.2 RGA 节点中 `causalChain` 字段(此处不演示,PoC-4 boss kill 用)
