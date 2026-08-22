// PoC-5: 客户端 patch 原子切换 — 最小可跑骨架
// RFC v0.2 §6 PoC-5

import { PatchClient } from './mock-client.mjs';
import { localManifest, remoteManifest } from './mock-server.mjs';
import { printReport } from './metrics.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const TRIALS = Number(args.trials ?? 100);

// ---- 主流程 ----
const client = new PatchClient();
const report = [];

for (let i = 0; i < TRIALS; i++) {
  // 每次 trial 在不同 patch 进度强制刷新
  const interruptAt = [0.3, 0.7, 0.99][i % 3];
  const result = await client.runPatchWithInterrupt({
    local: localManifest(),
    remote: remoteManifest(),
    interruptProgress: interruptAt,
  });
  report.push({ trial: i, interruptAt, ...result });
}

// ---- 打印报告 ----
printReport({ trials: TRIALS, report });
