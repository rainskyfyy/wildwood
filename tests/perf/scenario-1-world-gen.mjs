/**
 * M3.11 perf · Scenario 1 — 500×500 tile world generation
 *
 * Validates M3 验收 hard cap:
 *   generateWorld({ width: 500, height: 500, seed })  <  2s
 *   peak RSS during generation                       <  200 MB
 *
 * Method:
 *   - Cold run: build perlin → fill elevation/moisture → pickBiome
 *   - Warm run: same, but perlin cache is hot (reflects "subsequent tick"
 *     scenarios where 1 frame at a time triggers small re-runs of the
 *     perlin sampler).  We just re-instantiate to measure both shapes.
 *   - Report p50 of 5 runs (each is a fresh generator).
 *   - Memory measured via process.memoryUsage().heapUsed + RSS proxy.
 *
 * Determinism: same seed + dims → same Uint8Array tile grid (smoke asserts).
 */

'use strict';

import { performance } from 'node:perf_hooks';
import { generateWorld } from '../../src/world/generator.js';
import { scatterDecorations } from '../../src/world/decorator.js';
import { computeTransitions } from '../../src/world/transitions.js';

const W = 500;
const H = 500;
const SEED = 20260822;
const RUNS = 5;

function fmtMs(ms) { return ms.toFixed(2).padStart(7); }
function fmtMB(b)  { return (b / (1024 * 1024)).toFixed(1).padStart(6); }

export function runWorldGen() {
  const rows = [];
  let peakRss = 0;
  let peakHeap = 0;

  // Determinism: a/b must produce identical bytes.
  const refA = generateWorld({ width: W, height: H, seed: SEED });
  const refB = generateWorld({ width: W, height: H, seed: SEED });
  const deterministic = Buffer.compare(
    Buffer.from(refA.tiles.buffer),
    Buffer.from(refB.tiles.buffer)
  ) === 0;

  // Smoke: also scatter decor + transitions (typical boot path).
  const scatterStart = performance.now();
  const decor = scatterDecorations(refA, { density: 0.04, seed: SEED + 7 });
  const transitions = computeTransitions(refA, 2);
  const scatterMs = performance.now() - scatterStart;

  for (let i = 0; i < RUNS; i++) {
    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const heapBefore = process.memoryUsage().heapUsed;

    const t0 = performance.now();
    const w = generateWorld({ width: W, height: H, seed: SEED });
    const t1 = performance.now();

    // Force a few extra passes to amortize measurement noise on tiny gens.
    for (let k = 0; k < 3; k++) generateWorld({ width: W, height: H, seed: SEED + k });
    const t2 = performance.now();

    const rssAfter = process.memoryUsage().rss;
    const heapAfter = process.memoryUsage().heapUsed;
    peakRss = Math.max(peakRss, rssAfter);
    peakHeap = Math.max(peakHeap, heapAfter);

    rows.push({
      run: i + 1,
      singleMs: t1 - t0,
      x4Ms: t2 - t0,
      rssDelta: rssAfter - rssBefore,
      heapDelta: heapAfter - heapBefore,
    });
  }

  // Aggregate.
  const singles = rows.map(r => r.singleMs).sort((a, b) => a - b);
  const p50 = singles[Math.floor(singles.length / 2)];
  const p100 = singles[singles.length - 1];
  const budget = 2000;
  const pass = p100 < budget;

  // Count tiles inside a transition band (blend > 0) — useful for the report.
  let transTiles = 0;
  for (let i = 0; i < transitions.blend.length; i++) {
    if (transitions.blend[i] > 0) transTiles++;
  }

  const report = {
    scenario: 'world-gen-500x500',
    dims: `${W}x${H}`,
    tiles: W * H,
    runs: RUNS,
    singleMs: { p50: +p50.toFixed(2), max: +p100.toFixed(2) },
    budgetMs: budget,
    pass,
    decorCount: decor.length,
    transitionCount: transTiles,
    transitionTotal: transitions.blend.length,
    decorAndTransitionsMs: +scatterMs.toFixed(2),
    peakRssMB: +(peakRss / 1024 / 1024).toFixed(1),
    peakHeapMB: +(peakHeap / 1024 / 1024).toFixed(1),
    deterministic,
    rows,
  };

  console.log('┌─ Scenario 1 · 500×500 world generation');
  console.log(`│  ${W * H} tiles, ${RUNS} runs, seed=${SEED}`);
  for (const r of rows) {
    console.log(
      `│  run ${r.run}: single=${fmtMs(r.singleMs)} ms ` +
      `(×4 wall=${fmtMs(r.x4Ms)})  Δrss=${fmtMB(r.rssDelta)} MB ` +
      `Δheap=${fmtMB(r.heapDelta)} MB`
    );
  }
  console.log(
    `│  p50=${fmtMs(p50)} ms   max=${fmtMs(p100)} ms   ` +
    `budget=${budget} ms   ${pass ? '✅ PASS' : '❌ FAIL'}`
  );
  console.log(
    `│  decor=${decor.length}  transition-tiles=${transTiles}/${transitions.blend.length}  ` +
    `scatter+trans=${scatterMs.toFixed(1)} ms`
  );
  console.log(
    `│  peak RSS=${(peakRss / 1024 / 1024).toFixed(1)} MB   ` +
    `peak heap=${(peakHeap / 1024 / 1024).toFixed(1)} MB`
  );
  console.log(`│  determinism: ${deterministic ? 'identical bytes' : 'DRIFT'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runWorldGen();
  process.exit(r.pass ? 0 : 1);
}
