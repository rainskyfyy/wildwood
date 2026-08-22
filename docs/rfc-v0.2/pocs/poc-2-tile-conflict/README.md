# PoC-2: tile 编辑冲突

**目标**:验证两个玩家同时挖/种同一格,服务端串行化是否导致可感知的延迟。

**对应 RFC 章节**:§3.2 CRDT 选型 + §6 PoC-2

## 跑法

```bash
cd docs/rfc-v0.2/pocs/poc-2-tile-conflict
node index.mjs                # 跑 1000 次冲突实验
node index.mjs --trials=100   # 跑 100 次
```

不依赖外部包,纯 Node.js 18+。

## 通过判据

- p95 click-to-patch latency < 100ms(本地 mock,真实网络再 +RTT)
- 100% 的冲突请求都收到 ack,无丢失
- 没有「同 tile 双 PLACE」 — 第二次必须 reject

## 回滚方案

对热门地块加「操作队列 + 视觉锁」,UI 显示「排队中」。

## 关键设计

- **2 个 fake client**(进程内 class)
- **fake server** 维护一个 `tileOwnership: Map<key, ownerId>`
- **冲突检测**:`(x, y)` 已被 client A 占用且未完成时,client B 的 PLACE 请求排队
- **延迟测量**:从 client.click 到 client 收到 ack 的总时间(主循环调度延迟)

## 与 RFC v0.2 接口对应

- `compressG_ACTION`(`B.G_ACTION.v1` `TILE_DIG`/`TILE_PLANT`)
- `applyG_ACTION` → `BuildingService.applyPatch`(`A.BUILDING.v1`)
- §3.4.3 `OCCUPIED` / `NOT_FOUND` 拒绝原因
