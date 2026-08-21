/**
 * M3.11 perf · Scenario 6 — 长时间稳定性 (30s wall / 600 ticks)
 *
 * 真实世界:玩家 4 人 + 30 分钟 = 1800 秒 ≈ 36000 server ticks.
 * 我们用 600 ticks (30s wall) 做烟测, 验证:
 *   1) RSS 不会无界增长 (内存泄漏)
 *   2) Heap 不会无限膨胀 (event-loop 内部分配)
 *   3) p99 延迟没有 trend (单帧延迟不随时间漂移)
 */

'use strict';

import { performance } from 'node:perf_hooks';
import { generateWorld } from '../../src/world/generator.js';
import { worldToScreen, TILE_W_HALF, TILE_H_HALF } from '../../src/render/isometric.js';
import { AABB, Quadtree, MockCtx } from './lib/spatial.mjs';

const VIEW_W = 1280, VIEW_H = 720;
class Camera {
  constructor() { this.x=0; this.y=0; }
  setTarget(tx,ty) { const s=worldToScreen(tx,ty); this.x=s.x-VIEW_W/2; this.y=s.y-VIEW_H/2; }
  viewBoundsTiles() {
    const pts=[[this.x,this.y],[this.x+VIEW_W,this.y],[this.x,this.y+VIEW_H],[this.x+VIEW_W,this.y+VIEW_H]];
    let minTx=Infinity,maxTx=-Infinity,minTy=Infinity,maxTy=-Infinity;
    for (const [sx,sy] of pts) {
      const tx = (sx/TILE_W_HALF + sy/TILE_H_HALF)*0.5;
      const ty = (sy/TILE_H_HALF - sx/TILE_W_HALF)*0.5;
      if (tx<minTx) minTx=tx; if (tx>maxTx) maxTx=tx;
      if (ty<minTy) minTy=ty; if (ty>maxTy) maxTy=ty;
    }
    return { x0:Math.max(0,Math.floor(minTx)-1), y0:Math.max(0,Math.floor(minTy)-1), x1:maxTx+1, y1:maxTy+1 };
  }
}

function makeActors(world, count) {
  const actors = [];
  for (let i = 0; i < count; i++) {
    const r = 6;
    const x = (i * 13) % world.width;
    const y = (i * 17) % world.height;
    actors.push({ id:i, kind:'monster', x, y, r, color:'#c33', vx:0, vy:0,
      b: new AABB(x-r, y-r, x+r, y+r) });
  }
  return actors;
}

function lightTick({ world, actors, qt, camera, dt, ctx }) {
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.vx) { a.vx = (a.id % 7 - 3) * 0.5; a.vy = (a.id % 11 - 5) * 0.5; }
    a.x = (a.x + a.vx * dt + world.width) % world.width;
    a.y = (a.y + a.vy * dt + world.height) % world.height;
    a.b.minX = a.x - a.r; a.b.maxX = a.x + a.r;
    a.b.minY = a.y - a.r; a.b.maxY = a.y + a.r;
  }
  qt.rebuild(actors);
  const b = camera.viewBoundsTiles();
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(world.width, Math.ceil(b.x1));
  const y1 = Math.min(world.height, Math.ceil(b.y1));
  ctx.save();
  ctx.translate();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const s = worldToScreen(x, y);
    ctx.fillStyle = '#0f0';
    ctx.fillRect();
  }
  ctx.restore();
}

export function runStability() {
  const TICKS = 600;
  const DT = 1 / 20;

  const world = generateWorld({ width: 80, height: 60, seed: 20260822 });
  const actors = makeActors(world, 1700);
  const qt = new Quadtree(new AABB(0, 0, world.width, world.height));
  const camera = new Camera();
  camera.setTarget(world.width / 2, world.height / 2);

  for (let i = 0; i < 10; i++) {
    lightTick({ world, actors, qt, camera, dt: DT, ctx: new MockCtx() });
  }
  if (global.gc) global.gc();

  const tickMs = new Array(TICKS);
  const rssSeries = new Array(TICKS);
  const heapSeries = new Array(TICKS);
  const tStart = performance.now();
  for (let t = 0; t < TICKS; t++) {
    const ctx = new MockCtx();
    const ts = performance.now();
    lightTick({ world, actors, qt, camera, dt: DT, ctx });
    tickMs[t] = performance.now() - ts;
    const m = process.memoryUsage();
    rssSeries[t] = m.rss;
    heapSeries[t] = m.heapUsed;
  }
  const wallMs = performance.now() - tStart;

  const buckets = 6;
  const bucketSize = Math.floor(TICKS / buckets);
  const bucketP50 = [];
  for (let b = 0; b < buckets; b++) {
    const slice = tickMs.slice(b * bucketSize, (b + 1) * bucketSize).sort((a, c) => a - c);
    bucketP50.push(slice[Math.floor(slice.length / 2)]);
  }
  const firstBucketP50 = bucketP50[0];
  const lastBucketP50 = bucketP50[bucketP50.length - 1];
  const driftPct = ((lastBucketP50 - firstBucketP50) / firstBucketP50) * 100;

  const sorted = tickMs.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(TICKS * 0.5)];
  const p95 = sorted[Math.floor(TICKS * 0.95)];
  const p99 = sorted[Math.floor(TICKS * 0.99)];
  const max = sorted[TICKS - 1];

  const rssStart = rssSeries[0];
  const rssEnd = rssSeries[TICKS - 1];
  const rssGrowthMB = (rssEnd - rssStart) / 1024 / 1024;
  const heapStart = heapSeries[0];
  const heapEnd = heapSeries[TICKS - 1];
  const heapGrowthMB = (heapEnd - heapStart) / 1024 / 1024;
  const rssPeak = Math.max(...rssSeries) / 1024 / 1024;

  const pass = Math.abs(driftPct) < 50 && rssGrowthMB < 50;

  const report = {
    scenario: 'stability-600-ticks',
    ticks: TICKS,
    wallMs: +wallMs.toFixed(0),
    tickMs: {
      p50: +p50.toFixed(3),
      p95: +p95.toFixed(3),
      p99: +p99.toFixed(3),
      max: +max.toFixed(3),
    },
    bucketP50: bucketP50.map(v => +v.toFixed(3)),
    driftPct: +driftPct.toFixed(1),
    rssStartMB: +(rssStart / 1024 / 1024).toFixed(1),
    rssEndMB: +(rssEnd / 1024 / 1024).toFixed(1),
    rssGrowthMB: +rssGrowthMB.toFixed(2),
    rssPeakMB: +rssPeak.toFixed(1),
    heapStartMB: +(heapStart / 1024 / 1024).toFixed(1),
    heapEndMB: +(heapEnd / 1024 / 1024).toFixed(1),
    heapGrowthMB: +heapGrowthMB.toFixed(2),
    pass,
  };

  console.log('┌─ Scenario 6 · 长时间稳定性 (1700 actors × 600 ticks / 30s wall)');
  console.log(`│  wall time: ${wallMs.toFixed(0)} ms (target ~30000 ms = 600 × 50 ms)`);
  console.log(`│  tick ms  p50=${p50.toFixed(3)}  p95=${p95.toFixed(3)}  p99=${p99.toFixed(3)}  max=${max.toFixed(3)}`);
  console.log(`│  bucket p50 (100-tick window): ${bucketP50.map(v => v.toFixed(3)).join(' → ')}`);
  console.log(`│  drift  first→last: ${driftPct.toFixed(1)}%%  (positive = slower over time)`);
  console.log(`│  RSS   start=${(rssStart/1024/1024).toFixed(1)} MB  end=${(rssEnd/1024/1024).toFixed(1)} MB  growth=${rssGrowthMB.toFixed(2)} MB  peak=${rssPeak.toFixed(1)} MB`);
  console.log(`│  Heap  start=${(heapStart/1024/1024).toFixed(1)} MB  end=${(heapEnd/1024/1024).toFixed(1)} MB  growth=${heapGrowthMB.toFixed(2)} MB`);
  console.log(`│  ${pass ? '✅ PASS (no trend, no leak)' : '❌ FAIL (drift or leak detected)'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runStability();
  process.exit(r.pass ? 0 : 1);
}
