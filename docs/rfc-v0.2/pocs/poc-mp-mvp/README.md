# Wildwood v0.7.X 联机最小 PoC:player 移动同步

> **任务**:M1 启动前,验证 v0.7.0b RFC v0.2 选型(网络协议 / 同步方案 / 房间管理)能否在「2 客户端 + 1 服务端」最小场景下满足 player 移动端到端延迟 < 100ms。

## 跑法

```bash
cd poc/v0_7_mp_poc
node player-movement-sync-poc.mjs
```

期望输出:

```
==> 启动 relay server (port 18802 )
  ✓ relay server up
  ✓ host + joiner connected
  ...
  样本: 29 个,延迟 ms = [p50: 2, p95: 3, p99: 3, max: 3]
  posX 末值 = 5.70 (起始 0,步长 0.1×20Hz×3s ≈ 6.0)
  ✓ p95 < 100ms(任务原文要求), got 3ms
  ...
✅ PoC PASS: 11 通过 / 0 失败
   端到端延迟 p95 = 3ms (阈值 100ms)
```

## 架构

```
┌─────────────────┐  ws://127.0.0.1:18802  ┌──────────────────┐
│ Alice (host)    │ ◄────G_STATE 10Hz────► │  relay.mjs       │
│ - 20Hz 移动     │                         │  (server/relay)  │
│ - 10Hz 广播     │ ◄────C_HOST,C_JOIN───► │  - 房间管理      │
│ - sentAt 时间戳 │                         │  - 4-char 房间码  │
└─────────────────┘                         │  - 重连 grace 30s│
                                            │  - host 死亡 2m  │
┌─────────────────┐                         └──────────────────┘
│ Bob (joiner)    │ ◄────G_STATE 转发──────┘
│ - 收到记 recv_at│
│ - 算 latency    │
│ - 测 p50/p95    │
└─────────────────┘
```

## 复用 / 改动

| 文件 | 状态 | 说明 |
|---|---|---|
| `server/relay.mjs` | 复用(21.8KB) | v0.7.0b RFC v0.2 自带,zero-dep Node 18+ |
| `src/net/protocol.js` | 复用(6.5KB) | v0.7.0b RFC v0.2 自带,JSON over WS,PROTOCOL_VERSION=1 |
| `src/net/relay-client.js` | 未用(浏览器) | PoC 用原生 WebSocket |
| `src/net/session.js` | 未用(浏览器) | PoC 直接测 raw 协议层 |
| `src/net/multiplayer.js` | 未用(浏览器) | PoC 测应用层 player 位置,不走 game loop |
| `player-movement-sync-poc.mjs` | **新增**(本 PoC) | 1 server + 2 client,测端到端延迟 |
| `latency-samples.json` | **新增**(本 PoC) | 原始 sample 数据,30 个 tick |

## 验收

| 判据 | 阈值 | 实测 | 通过 |
|---|---|---|---|
| p95 端到端延迟 | < 100 ms(任务原文) | **3 ms** | ✅ |
| p99 端到端延迟 | < 200 ms | 3 ms | ✅ |
| max 端到端延迟 | < 300 ms(3× 容忍) | 3 ms | ✅ |
| 0 协议错误 | 必填 | 0 / 0 | ✅ |
| host 位置递增 | 必填 | 0.10 → 5.70 | ✅ |
| sample 数 | >= 25 (3s × 10Hz) | 29 | ✅ |

## 失败模式 + 回滚

| 失败模式 | 检测 | 回滚方案 |
|---|---|---|
| p95 >= 100ms | 本 PoC | 降频:G_STATE 10Hz → 5Hz,host 移动 20Hz → 10Hz |
| 丢包 | sample 数 < 25 | 改 binary frame + msgpack(v0.6.3 计划项) |
| 服务端 CPU 过载 | (后续压测覆盖) | 加 sequence 序号 + 客户端预测 |

## 与 m3.0-relay-smoke.mjs 的边界

| 测试 | 范围 | 用途 |
|---|---|---|
| `smoke/tests/m3.0-protocol-smoke.mjs` | 协议层单元:envelope/parseIncoming/校验 | 不启动 server |
| `smoke/tests/m3.0-relay-smoke.mjs` | 端到端:host/join/snapshot/广播/重连/聊天/建筑 | 验证 relay 转发正确性 |
| **本 PoC**(本目录) | **应用层:G_STATE 携带 player 位置端到端延迟** | **验证 RFC v0.2 选型满足 M1 任务要求** |

## 已知限制

- 沙箱本地 loopback,延迟不含公网 RTT(中国大陆实测 RTT ~30-50ms,海外 100-200ms,生产环境需要再 +30-50ms)
- host 端没跑真实 game loop,仅 setInterval 模拟
- 2 客户端,4 客户端满载场景未覆盖
- 带宽未量化(估算:10Hz × 4 players × ~100B = 4KB/s 出站,远低于 50KB/s/房 阈值)

## 后续

- [ ] M1 L-M1-0 任务:把本 PoC 集成进 `assembly.js`,host/join mode 走 `Multiplayer`
- [ ] 压测:4 客户端满载 + 100Hz 移动上报
- [ ] 跨地域:部署一个海外 relay,测 RTT
- [ ] 断线重连:模拟 joiner 断 5s 重连
- [ ] host 移动权威性:加位置/速度校验(防作弊)
