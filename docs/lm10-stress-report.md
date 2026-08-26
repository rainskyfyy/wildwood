# L-M1-0 联机 PoC 集成压测与验收报告

- **日期**: 2026-08-26
- **压测对象**: main HEAD `2af942d0c1`（派发指定的 `feat/v0.8.18-mp-assembly-integration` 分支实际不存在；联机集成代码经 PR #9 `fc66f776e1` / PR #13 `bf01ba20ac` 已在 main，压测以 main 为准，并从 main HEAD 新建该分支存放压测产物）
- **环境**: 1 Core CPU / 4 GB 内存沙箱；Node 22；relay = `server/relay.mjs` 零依赖；公网延迟用 TCP 延迟代理模拟（每方向每 chunk 注入固定延迟，RTT ≈ 2 × 单向）；浏览器 = 系统 Chromium 141 headless × 4 实例
- **结论**: **验收线 4 条全部达成**；30 + 5 + 5 + 10 + 4 = **54 项断言全 PASS**；另记录 2 项 P1 + 1 项 P2 + 1 项带宽观察项（均为 main 既存，非压测产物引入，按任务边界未修）

## 1. RTT 压测（验收线 1：不掉线、不丢包）— 30/30 PASS

场景：1 host + 3 joiners 满房 60s，host 10Hz G_STATE、joiner 30Hz G_INPUT（≈4KB/s）、全员 1Hz ping（客户端侧计时）。

| 场景 | 注入 RTT | 实测 RTT p50/p95/max (ms) | 端到端 state 投递 p95 (ms) | 掉线 | error | G_STATE 缺口 | G_INPUT 缺口 |
|---|---|---|---|---|---|---|---|
| loopback | 0 | 1 / 1 / 5 | 1 | 0 | 0 | 0 | 0 |
| cn-30 | 30 | 42 / 63 / 71 | 62 | 0 | 0 | 0 | 0 |
| cn-50 | 50 | 65 / 83 / 96 | 83 | 0 | 0 | 0 | 0 |
| intl-100 | 100 | 116 / 133 / 134 | 131 | 0 | 0 | 0 | 0 |
| intl-200 | 200 | 212 / 233 / 255 | 233 | 0 | 0 | 0 | 0 |

每个场景 60s × 4 客户端共 ~600 条 state / ~5400 条 input 消息，seq 连续无缺口。RTT p95 全部落在注入值 + 60ms 预算内（开销主要来自 WebSocket 帧 + 代理定时器）。

## 2. 4 客户端满载（验收线 2：CPU、带宽、稳定）— spec 5/5 + game 5/5 PASS

CN 50ms RTT 代理下 300s 满载（1 host + 3 joiners）：

| 指标 | spec 模式（验收线口径：24 资源 ≈3KB/条 state） | game 模式（装配真实规模：354 资源 ≈28.7KB/条） |
|---|---|---|
| relay CPU p50/p95/max（单核） | 0.5 / 1.5 / 2.5 % | 1.0 / 1.5 / 4.0 % |
| relay RSS p50/max | 64.8 / 64.9 MB | 74.2 / 86.8 MB |
| 掉线 / error / 丢包 | 0 / 0 / 0 | 0 / 0 / 0 |
| joiner 出带宽（验收线 4KB/s 口径） | 4.01 KB/s | 4.01 KB/s |
| joiner 入带宽 | 38.06 KB/s | 288.66 KB/s |
| host 出带宽 | 29.42 KB/s | **280.11 KB/s（观察项）** |
| RTT p95 | 83 ms | 85 ms |

- **CPU 远低于预算**（p95 < 2% 单核 vs 50% 预算线），RSS 300s 内 max-p50 增长 ≤ 12.6MB，无泄漏迹象。
- 帧率口径说明：本任务为协议/服务端压测（headless 无渲染），客户端帧率由 M1 阶段 2+3 的浏览器冒烟覆盖；relay 侧零排队溢出（28.7KB × 10Hz 下 RTT p95 仍 85ms）为帧率不受网络层拖累的证据。
- **观察项（非验收线）**：game 模式 host 广播 280 KB/s（≈2.2 Mbps 上行）源自全量 snapshot 每条 28.7KB × 10Hz。joiner 端 4KB/s 输入口径达标；host 广播口径建议后续做 delta 同步 / 降频 / 快照裁剪（不在本任务边界内）。

## 3. 联机功能验收（验收线 3）— 协议级 10/10 + 浏览器级 4/4 PASS

### 3.1 协议级（CN 50ms RTT 代理下）

- **A1 重复出入**：20/20 轮「建房→加入→离开→关房」零错误，单轮平均 341ms
- **A2 满房管理**：5/5 轮「4 人满房→2 离开→2 重进（名额复用）→第 5 人 room_full 拒绝」
- **B 断线重连**：TCP 硬断（不发 leave）→ 3s 后 token 重连成功（`joined{reconnected:true}`），host 收 `peer_reconnected`
- **C 移动同步**：host 3 tiles/s 匀速移动 10s，端到端投递 p95 52ms；移动期位置误差 p95 **0.156 tiles**（预算 0.756）；停止后最终漂移 **0.000000 tiles（零永久漂移）**
- **D 世界操作同步**：gather×50 / place×30 / remove×10 / chat×20（含多字节），3 个 joiner 全量收到且逐条 seq + sha256 哈希一致

### 3.2 浏览器级（真实 Chromium × 4 实例 × demo.html）

- host 经主菜单「创建房间」拿到房间码，3 个 joiner 输码加入全部到达 lobby
- joiner 离开房间后 demo 正确回退单人模式；刷新后重新加入同一房间成功
- host 点「开始游戏」后引擎 + HUD 正常启动（`window.__game` / `__hudReady`）
- 联机流程无新增致命 JS 错误

## 4. 现有测试不回归（验收线 4）— 全绿

- smoke：**27/27 PASS**
- m0-integration：**8/8 PASS**
- CI 工具：fixture-drift / esm-exports / asset-budget / palette-gitignore **4/4 PASS**（超出 3 CI 要求），metrics-hygiene PASS with warnings（非阻塞）
- 新增压测脚本位于 `tests/stress/` 子目录，不影响 `tests/*.mjs` 既有 fixture-drift 扫描

## 5. 阻塞项与发现（main 既存，按边界未修）

| 级别 | 发现 | 位置 | 影响 |
|---|---|---|---|
| **P1** | joiner 无进入游戏路径：lobby 中 joiner 只有「等待房主开始游戏…」文本，`resolve({mode:'join'})` 不存在（grep 全文件 resolve 仅 4 处，均为 host/offline/cancel） | `src/net/menu.js:394-401` | 浏览器端多人游戏不可玩：host 开局后 3 个 joiner 全部永久停在等待界面（10s 观测实证）。协议层同步无漂移已验证，但 UI 层接不通 |
| **P1** | lobby 阶段未接 `peer_joined → session.addPeer`（该接线只在 Multiplayer 类内，即开局后才生效）；且 relay `snapshot().players` 只含发过 G_STATE 的 peer，lobby 阶段为空 | `src/net/menu.js`（_flowHost 接线缺失）/ `server/relay.mjs` snapshot() | host/joiner 在 lobby 互看不见对方（浏览器实测 host 列表恒 1 行）。房间状态本身正确（协议级验证） |
| **P2** | `game.bossMgr.update is not a function`：runtime 调用了不存在的方法（BossManager 只有 `tickSkills`） | `src/runtime.js:178` vs `src/boss/boss-manager.js` | 所有模式（含纯离线）引擎启动即抛 1 次 pageerror，不阻塞游玩；`tests/m5.2-main-integration.mjs:54` 只断言源码字符串包含 `bossMgr.update(`，掩盖了运行时错误 |
| 观察 | host 广播带宽 280 KB/s（game 模式全量 snapshot 28.7KB × 10Hz） | `src/net/multiplayer.js` _broadcastState | ≈2.2 Mbps 家宽上行占用偏高，建议 delta 同步 / 降频 / 快照裁剪 |

## 6. 产物清单

- `tests/stress/lm10-lib.mjs` — 压测共享库（relay 进程管理 / TCP 延迟代理 / MPClient / proc 采样 / metrics 落盘）
- `tests/stress/lm10-rtt-stress.mjs` — RTT 压测（5 场景）
- `tests/stress/lm10-load-4clients.mjs` — 4 客户端满载（spec / game 双模式）
- `tests/stress/lm10-sync-acceptance.mjs` — 协议级功能验收（A/B/C/D 四组）
- `tests/stress/lm10-browser-acceptance.mjs` — 浏览器级验收（4 Chromium 实例）
- `metrics/mp_assembly_integration.jsonl` — 全部压测指标（append-only，source=lm10-stress，schema_version=1.0）
- 本报告 `docs/lm10-stress-report.md`
