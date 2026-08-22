// PoC-2: tile 编辑冲突 — 最小可跑骨架
// RFC v0.2 §6 PoC-2

import { ConflictServer } from './mock-server.mjs';
import { ConflictClient } from './mock-client.mjs';
import { printReport } from './metrics.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const TRIALS = Number(args.trials ?? 1000);

// ---- 主流程 ----
const server = new ConflictServer();
await server.start();

const clientA = new ConflictClient({ id: 'A', server });
const clientB = new ConflictClient({ id: 'B', server });

const latencies = [];
const outcomes = { ok: 0, occupied: 0, notFound: 0, other: 0 };

for (let i = 0; i < TRIALS; i++) {
  // 两个 client 同时点同一格(用 trialId 隔离 namespace,避免跨 trial 残留)
  const x = Math.floor(Math.random() * 50);
  const y = Math.floor(Math.random() * 50);

  const t0 = Date.now();
  const [resA, resB] = [
    clientA.placeBuilding(i, x, y, 'campfire'),
    clientB.placeBuilding(i, x, y, 'campfire'),
  ];
  const dt = Date.now() - t0;
  latencies.push(dt);

  for (const r of [resA, resB]) {
    if (r.ok) outcomes.ok++;
    else if (r.reason === 'OCCUPIED') outcomes.occupied++;
    else if (r.reason === 'NOT_FOUND') outcomes.notFound++;
    else outcomes.other++;
  }
}

await server.stop();

// ---- 打印报告 ----
printReport({ trials: TRIALS, latencies, outcomes });
