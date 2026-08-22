// PoC-3: NPC 好感度 LWW-Set 同步 — 最小可跑骨架
// RFC v0.2 §6 PoC-3

import { FavorServer } from './mock-server.mjs';
import { FavorClient } from './mock-client.mjs';
import { printReport } from './metrics.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const PER_CLIENT = Number(args['per-client'] ?? 10);
const NPC_ID = 'piglin_001';

// ---- 主流程 ----
const server = new FavorServer();
const clientA = new FavorClient({ id: 'A', server });
const clientB = new FavorClient({ id: 'B', server });

// 记录每个时刻的 favor 快照(检测回退)
const snapshots = [server.getFavor(NPC_ID)];

// 并发送礼(不 await 中间过程,模拟真并发)
const tasksA = [];
const tasksB = [];
for (let i = 0; i < PER_CLIENT; i++) {
  tasksA.push(clientA.gift(NPC_ID, 'flower', i));
  tasksB.push(clientB.gift(NPC_ID, 'flower', i));
}
await Promise.all([...tasksA, ...tasksB]);

// 抓最终快照
const finalFavor = server.getFavor(NPC_ID);
snapshots.push(finalFavor);

// ---- 打印报告 ----
printReport({
  npcId: NPC_ID,
  perClient: PER_CLIENT,
  finalFavor,
  expectedFavor: 2 * PER_CLIENT,
  snapshots,
  serverLog: server.getLog(),
});
