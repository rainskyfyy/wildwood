// PoC-1: 玩家位置同步频率 vs 带宽 — 最小可跑骨架
// RFC v0.2 §6 PoC-1
//
// 跑法: node index.mjs  (默认 60s)
//       node index.mjs --duration=10
//
// 不依赖任何 npm 包,Node 18+ 直接跑。

import { mockServer } from './mock-server.mjs';
import { Bot } from './mock-client.mjs';
import { printReport } from './metrics.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const DURATION_S = Number(args.duration ?? 60);
const REPORT_HZ = Number(args.hz ?? 20);            // 客户端上报频率
const BROADCAST_MS = Number(args.broadcast ?? 200);  // 服务端广播降频
const N_BOTS = 4;

// ---- 主流程 ----
const server = mockServer({ broadcastIntervalMs: BROADCAST_MS, maxSpeed: 6.0 });
await server.start();

// 起 4 个 bot
const bots = [];
for (let i = 0; i < N_BOTS; i++) {
  const bot = new Bot({
    id: `p${i + 1}`,
    server,
    reportHz: REPORT_HZ,
  });
  bots.push(bot);
  bot.start();
}

const t0 = Date.now();
const cpuStart = process.cpuUsage();

// 跑 DURATION_S 秒
await new Promise(r => setTimeout(r, DURATION_S * 1000));

// 停所有 bot
for (const bot of bots) bot.stop();
const cpuEnd = process.cpuUsage(cpuStart);
const wallMs = Date.now() - t0;

await server.stop();

// ---- 打印指标 ----
printReport({
  durationS: wallMs / 1000,
  nBots: N_BOTS,
  reportHz: REPORT_HZ,
  broadcastMs: BROADCAST_MS,
  serverMetrics: server.metrics(),
  cpuUserUs: cpuEnd.user,
  cpuSystemUs: cpuEnd.system,
});
