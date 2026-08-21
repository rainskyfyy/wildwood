/**
 * M3.11 perf · Scenario 4 — 1000 实体间碰撞检测
 *
 * 目标: 1000 entities (含 monster / resource / building) 在 16 ms 内
 *       跑完一对多 AABB 碰撞检测 + 收集 hit pairs.
 *
 * 对比两种实现:
 *   1) Brute force O(n²) = 500K pair checks.
 *   2) Quadtree-based  O(n log n + k)  — M2.10 已用此.
 *
 * 通过标准: Quadtree path 单帧 < 16 ms (16.67 ms = 60 FPS 单帧).
 *
 * 备注: 这是 port 到 JS 的 Quadtree 简化版 (与 Python core 等价),
 *       用于 Node 端 smoke. GDScript 端走 core/abstract/ai/quadtree.gd,
 *       共享同一份算法.
 */

'use strict';

import { performance } from 'node:perf_hooks';
import { AABB, Quadtree } from './lib/spatial.mjs';

const ENTITY_COUNT = 1000;
const SEED = 20260822;
const BUDGET_MS = 16.0;
const SAMPLES = 50;

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEntities(n, seed) {
  const rng = mulberry32(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = 6 + Math.floor(rng() * 10);
    const x = rng() * 5000;
    const y = rng() * 5000;
    out[i] = {
      id: i,
      kind: ['monster', 'resource', 'building'][i % 3],
      b: new AABB(x - r, y - r, x + r, y + r),
    };
  }
  return out;
}

function bruteForceCollision(entities) {
  const hits = [];
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      if (a.b.intersects(b.b)) hits.push([a.id, b.id]);
    }
  }
  return hits;
}

function quadtreeCollision(entities, qt) {
  qt.rebuild(entities);
  const hits = new Set();
  for (const a of entities) {
    const cands = qt.queryRegion(a.b);
    for (const c of cands) {
      if (c.id === a.id) continue;
      if (c.id > a.id) hits.add((a.id << 16) | c.id);
      else hits.add((c.id << 16) | a.id);
    }
  }
  return hits;
}

export function runCollision() {
  const entities = makeEntities(ENTITY_COUNT, SEED);
  const worldBounds = new AABB(0, 0, 5000, 5000);
  const qt = new Quadtree(worldBounds);

  // Brute force — single run, expensive.
  const _bf0 = bruteForceCollision(entities.slice(0, 50));
  const t0 = performance.now();
  const bfHits = bruteForceCollision(entities);
  const bfMs = performance.now() - t0;

  // Quadtree — many samples.
  for (let i = 0; i < 5; i++) quadtreeCollision(entities, qt);
  const samples = new Array(SAMPLES);
  let lastHits = null;
  for (let s = 0; s < SAMPLES; s++) {
    const ts = performance.now();
    lastHits = quadtreeCollision(entities, qt);
    samples[s] = performance.now() - ts;
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(SAMPLES * 0.5)];
  const p95 = sorted[Math.floor(SAMPLES * 0.95)];
  const p99 = sorted[Math.floor(SAMPLES * 0.99)];
  const max = sorted[SAMPLES - 1];
  const min = sorted[0];
  const mean = samples.reduce((s, x) => s + x, 0) / SAMPLES;
  const pass = p50 < BUDGET_MS;

  const bfHitCount = bfHits.length;
  const qtHitCount = lastHits ? lastHits.size : 0;
  const hitsAgree = bfHitCount === qtHitCount;

  const report = {
    scenario: 'collision-1000',
    entities: ENTITY_COUNT,
    samples: SAMPLES,
    bruteMs: +bfMs.toFixed(3),
    bruteHits: bfHitCount,
    quadtreeMs: {
      mean: +mean.toFixed(3),
      min: +min.toFixed(3),
      p50: +p50.toFixed(3),
      p95: +p95.toFixed(3),
      p99: +p99.toFixed(3),
      max: +max.toFixed(3),
    },
    quadtreeHits: qtHitCount,
    hitsAgree,
    speedupVsBrute: +(bfMs / p50).toFixed(1),
    budgetMs: BUDGET_MS,
    pass,
  };

  console.log('┌─ Scenario 4 · 1000 实体碰撞检测 (brute force vs Quadtree)');
  console.log(`│  entities=${ENTITY_COUNT}, samples=${SAMPLES}, budget=${BUDGET_MS} ms`);
  console.log(`│  brute force  : ${bfMs.toFixed(3)} ms  (${bfHitCount} pairs)`);
  console.log(`│  quadtree     : mean=${mean.toFixed(3)} ms  p50=${p50.toFixed(3)} ms  p95=${p95.toFixed(3)} ms  p99=${p99.toFixed(3)} ms  max=${max.toFixed(3)} ms`);
  console.log(`│  quadtree hits: ${qtHitCount}  agree: ${hitsAgree ? '✅' : '❌'}`);
  console.log(`│  speedup vs brute: ${(bfMs / p50).toFixed(1)}×   budget ${BUDGET_MS} ms  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runCollision();
  process.exit(r.pass ? 0 : 1);
}
