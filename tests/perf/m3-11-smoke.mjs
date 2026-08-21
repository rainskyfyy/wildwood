#!/usr/bin/env node
/**
 * M3.11 压力测试 — Node 端 smoke 总入口
 *
 * 串行执行 6 个场景, 任一失败即非零退出.
 *
 *   Scenario 1: 500×500 tile 地图生成                (< 2000 ms)
 *   Scenario 2: 500 怪物 + 1000 资源 + 200 建筑 渲染  (>= 30 FPS)
 *   Scenario 3: 200 怪物 × 20 帧 同步动画 CPU        (< 50% per 16.67ms)
 *   Scenario 4: 1000 实体碰撞检测 (Quadtree)         (< 16 ms)
 *   Scenario 5: 端到端 server tick (1700 actors @ 20Hz)  (< 50 ms)
 *   Scenario 6: 长时间稳定性 (600 ticks / 30s wall)  (no leak, no trend)
 *
 * 退出码:
 *   0 — 全部通过
 *   1 — 任一不达标
 *   2 — 脚本本身异常
 *
 * 用法:
 *   node tests/perf/m3-11-smoke.mjs
 *   node tests/perf/m3-11-smoke.mjs --json
 *   node tests/perf/m3-11-smoke.mjs --out report.json
 */

'use strict';

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runWorldGen } from './scenario-1-world-gen.mjs';
import { runRenderFps } from './scenario-2-render-fps.mjs';
import { runAnim } from './scenario-3-anim.mjs';
import { runCollision } from './scenario-4-collision.mjs';
import { runServerTick } from './scenario-5-server-tick.mjs';
import { runStability } from './scenario-6-stability.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

console.log('');
console.log('════════════════════════════════════════════════════════════════════');
console.log('  Wildwood M3.11 · 联机完整版性能压力测试');
console.log('  ' + new Date().toISOString());
console.log('════════════════════════════════════════════════════════════════════');
console.log('');

const t0 = performance.now();
const results = {
  m3_11: {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  scenarios: [],
  overall: { pass: true, totalMs: 0, failCount: 0, passCount: 0 },
};

const runners = [
  { id: 1, name: '500×500 地图生成',            fn: runWorldGen,    budget: '< 2000 ms'    },
  { id: 2, name: '500+1000+200 实体渲染 FPS',    fn: runRenderFps,   budget: '≥ 30 FPS'     },
  { id: 3, name: '200×20 帧动画 CPU',            fn: runAnim,        budget: '< 50% CPU'    },
  { id: 4, name: '1000 实体碰撞检测',            fn: runCollision,   budget: '< 16 ms'      },
  { id: 5, name: '端到端 server tick (1700 actors)', fn: runServerTick, budget: '< 50 ms'     },
  { id: 6, name: '长时间稳定性 (600 ticks)',      fn: runStability,   budget: 'no leak, no trend' },
];

for (const r of runners) {
  console.log(`\n>>> Scenario ${r.id}: ${r.name}    (${r.budget})`);
  try {
    const report = r.fn();
    results.scenarios.push(report);
    if (report.pass) results.overall.passCount++;
    else { results.overall.pass = false; results.overall.failCount++; }
  } catch (err) {
    results.overall.pass = false;
    results.overall.failCount++;
    results.scenarios.push({
      scenario: `scenario-${r.id}`,
      error: String(err),
      stack: err && err.stack ? err.stack : null,
      pass: false,
    });
    console.error(`  ✗ scenario ${r.id} threw:`, err);
  }
}

results.overall.totalMs = +(performance.now() - t0).toFixed(2);

console.log('\n════════════════════════════════════════════════════════════════════');
console.log(`  Overall: ${results.overall.pass ? '✅ PASS' : '❌ FAIL'}  ` +
  `(${results.overall.passCount} pass, ${results.overall.failCount} fail, ${results.overall.totalMs} ms wall)`);
console.log('════════════════════════════════════════════════════════════════════');
console.log('');

if (outFile) {
  const fullPath = resolve(outFile);
  writeFileSync(fullPath, JSON.stringify(results, null, 2));
  console.log(`  JSON 报告: ${fullPath}`);
}
if (wantJson) {
  console.log('--- JSON ---');
  console.log(JSON.stringify(results, null, 2));
}

process.exit(results.overall.pass ? 0 : 1);
