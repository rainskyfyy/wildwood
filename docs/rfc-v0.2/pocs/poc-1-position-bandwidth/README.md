# PoC-1: 玩家位置同步频率 vs 带宽

**目标**:验证 4 人房 60s 内,20Hz 上报 + 200ms 广播降频的带宽与 CPU 占用是否在可接受范围。

**对应 RFC 章节**:§3.3 玩家位置(客户端权威 + 服务端校验) + §6 PoC-1

## 跑法

```bash
cd docs/rfc-v0.2/pocs/poc-1-position-bandwidth
node index.mjs                # 跑一次 60s 模拟
node index.mjs --duration=10  # 跑 10s 加速模式
```

不依赖外部包,纯 Node.js 18+。

## 通过判据

- p95 RTT(模拟) < 80ms
- 服务端单核 CPU < 30%(用 process.cpuUsage() 估算)
- 出口带宽 < 50KB/s/房(上报 + 广播总字节数)

## 回滚方案

- 把 `REPORT_HZ` 从 20 降到 10
- 把 `BROADCAST_MS` 从 200 调到 500
- 重新跑,记录新指标

## 关键设计

- **4 个 bot 进程内模拟**(不真起子进程),每个 bot 60s 随机游走
- **mock server 内存累加**,每 200ms 广播一次真实位置给所有 bot
- **指标**:
  - RTT = bot 收到 broadcast 时 - 上报时的 tick 数
  - 带宽 = sum(每条消息字节数) / duration
  - CPU = server 主循环占用 / wall clock

## 已知限制

- 没有真网络,所有通信走同进程 setImmediate 队列;RTT 测的是「主循环调度延迟」,不是真 RTT。
- 没有 wall-clock 校准,服务端 tick 用 setInterval(20ms),浏览器实际不会这么稳。
- 真实部署需要补 Go 端房间服务 + 实测。

## 与 RFC v0.2 接口的对应

- `compressG_ACTION`(`B.G_ACTION.v1` `MOVE`):bot 端用本 PoC 简化为 `{x, y, tick}`
- `compressG_STATE`(`B.G_STATE.v1`):server → bot 的位置广播
- §3.3 校验(`MAX_SPEED * dt`):`server.validateClientMove()` 体现
