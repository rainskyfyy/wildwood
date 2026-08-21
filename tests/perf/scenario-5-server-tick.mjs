/**
 * M3.11 perf · Scenario 5 — 端到端 server tick (50ms budget)
 *
 * M3.1 服务端 tick rate = 20Hz → 单 tick 预算 50ms.
 * 1 个 tick 内要完成:
 *   - 1700 actor 位置更新 (含 Quadtree collision)
 *   - 渲染管线 (cull + depth sort + draw)
 *   - HUD 更新 (mock)
 *
 * 这是把 scenario-2 (render) + scenario-4 (collision) 串起来的端到端
 * 综合负载,反映 "M3.1 server 调度 1 tick 内能不能扛 1700 actor"
 * 这个更现实的指标.
 *
 * 预算: 50ms (20Hz), PASS 条件: p50 < 50ms.
 */

'use strict';

import { performance } from 'node:perf_hooks';
import { generateWorld } from '../../src/world/generator.js';
import { scatterDecorations } from '../../src/world/decorator.js';
import { worldToScreen, depthKey, TILE_W_HALF, TILE_H_HALF } from '../../src/render/isometric.js';
import { AABB, Quadtree, MockCtx } from './lib/spatial.mjs';

function serverTick({ world, actors, qt, camera, dt, ctx }) {
  // 1) Update positions.
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.vx) { a.vx = (a.id % 7 - 3) * 0.5; a.vy = (a.id % 11 - 5) * 0.5; }
    if (a.kind === 'building') continue;
    let nx = a.x + a.vx * dt;
    let ny = a.y + a.vy * dt;
    if (nx < 0) nx += world.width;
    if (nx >= world.width) nx -= world.width;
    if (ny < 0) ny += world.height;
    if (ny >= world.height) ny -= world.height;
    a.x = nx; a.y = ny;
    a.b.minX = nx - a.r; a.b.maxX = nx + a.r;
    a.b.minY = ny - a.r; a.b.maxY = ny + a.r;
  }

  // 2) Rebuild Quadtree + collision.
  qt.rebuild(actors);
  let hitCount = 0;
  for (const a of actors) {
    const cands = qt.queryRegion(a.b);
    for (const c of cands) {
      if (c.id > a.id) hitCount++;
    }
  }

  // 3) Render: tile + actor pass.
  ctx.save();
  ctx.translate();
  const b = camera.viewBoundsTiles();
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(world.width,  Math.ceil(b.x1));
  const y1 = Math.min(world.height, Math.ceil(b.y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * world.width + x;
      const s = worldToScreen(x, y);
      const id = world.tiles[idx];
      const hue = (id * 91) & 0xff;
      ctx.fillStyle = `rgb(${hue},${(hue * 3) & 0xff},${(hue * 7) & 0xff})`;
      ctx.fillRect();
    }
  }
  const cullX0 = b.x0 - 1, cullY0 = b.y0 - 1, cullX1 = b.x1 + 1, cullY1 = b.y1 + 1;
  const visible = [];
  for (const a of actors) {
    if (a.x < cullX0 || a.x > cullX1 || a.y < cullY0 || a.y > cullY1) continue;
    visible.push(a);
  }
  for (let i = 1; i < visible.length; i++) {
    const v = visible[i];
    let j = i - 1;
    while (j >= 0 && depthKey(visible[j].x, visible[j].y) > depthKey(v.x, v.y)) {
      visible[j + 1] = visible[j];
      j--;
    }
    visible[j + 1] = v;
  }
  for (const a of visible) {
    const s = worldToScreen(a.x, a.y);
    ctx.fillStyle = a.color;
    const r = a.kind === 'building' ? 12 : (a.kind === 'monster' ? 6 : 4);
    ctx.beginPath();
    ctx.arc();
    ctx.fill();
    if (a.kind === 'monster') ctx.stroke();
  }
  ctx.restore();
  return hitCount;
}

const VIEW_W = 1280, VIEW_H = 720;
class Camera {
  constructor() { this.x = 0; this.y = 0; }
  setTarget(tx, ty) {
    const s = worldToScreen(tx, ty);
    this.x = s.x - VIEW_W / 2;
    this.y = s.y - VIEW_H / 2;
  }
  viewBoundsTiles() {
    const pts = [[this.x,this.y],[this.x+VIEW_W,this.y],[this.x,this.y+VIEW_H],[this.x+VIEW_W,this.y+VIEW_H]];
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

function makeActors(world) {
  const actors = [];
  let id = 0;
  for (let i = 0; i < 500; i++) {
    const r = 6;
    const x = (i * 17) % world.width;
    const y = (i * 31) % world.height;
    actors.push({ id:id++, kind:'monster', x, y, r, color:'#c33', vx:0, vy:0,
      b: new AABB(x-r, y-r, x+r, y+r) });
  }
  for (let i = 0; i < 1000; i++) {
    const r = 4;
    const x = (i * 13) % world.width;
    const y = (i * 11) % world.height;
    actors.push({ id:id++, kind:'resource', x, y, r, color:'#9c5', vx:0, vy:0,
      b: new AABB(x-r, y-r, x+r, y+r) });
  }
  for (let i = 0; i < 200; i++) {
    const r = 12;
    const bx = (i * 7) % (world.width - 4);
    const by = (i * 19) % (world.height - 4);
    actors.push({ id:id++, kind:'building', x:bx, y:by, r, color:'#888', vx:0, vy:0,
      b: new AABB(bx-r, by-r, bx+r, by+r) });
  }
  return actors;
}

export function runServerTick() {
  const TICKS = 600;
  const DT = 1 / 20;
  const BUDGET_MS = 50;

  const world = generateWorld({ width: 80, height: 60, seed: 20260822 });
  scatterDecorations(world, { density: 0.20, seed: 20260822 + 7 });
  const actors = makeActors(world);
  const qt = new Quadtree(new AABB(0, 0, world.width, world.height));
  const camera = new Camera();
  camera.setTarget(world.width / 2, world.height / 2);

  for (let i = 0; i < 10; i++) {
    serverTick({ world, actors, qt, camera, dt: DT, ctx: new MockCtx() });
  }

  const tickMs = new Array(TICKS);
  let totalDrawCalls = 0;
  let totalHits = 0;
  for (let t = 0; t < TICKS; t++) {
    const ctx = new MockCtx();
    const ts = performance.now();
    const hits = serverTick({ world, actors, qt, camera, dt: DT, ctx });
    tickMs[t] = performance.now() - ts;
    totalDrawCalls += ctx.drawCalls;
    totalHits += hits;
  }

  const sorted = tickMs.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(TICKS * 0.5)];
  const p95 = sorted[Math.floor(TICKS * 0.95)];
  const p99 = sorted[Math.floor(TICKS * 0.99)];
  const max = sorted[TICKS - 1];
  const min = sorted[0];
  const mean = tickMs.reduce((s, x) => s + x, 0) / TICKS;
  const fpsEq = 1000 / p50;
  const pass = p50 < BUDGET_MS;

  const report = {
    scenario: 'server-tick-1700-actors',
    ticks: TICKS,
    tickBudgetMs: BUDGET_MS,
    tickMs: { mean:+mean.toFixed(3), min:+min.toFixed(3), p50:+p50.toFixed(3),
              p95:+p95.toFixed(3), p99:+p99.toFixed(3), max:+max.toFixed(3) },
    fpsEquivalent: +fpsEq.toFixed(1),
    drawCallsPerTick: Math.round(totalDrawCalls / TICKS),
    totalCollisionPairs: totalHits,
    pass,
  };

  console.log('┌─ Scenario 5 · 端到端 server tick (1700 actors, 20Hz)');
  console.log(`│  ${TICKS} ticks @ ${DT*1000} ms target, ${actors.length} actors`);
  console.log(`│  tick ms  mean=${mean.toFixed(3)}  min=${min.toFixed(3)}  p50=${p50.toFixed(3)}  p95=${p95.toFixed(3)}  p99=${p99.toFixed(3)}  max=${max.toFixed(3)}`);
  console.log(`│  ≈ ${fpsEq.toFixed(0)} FPS equivalent; ${Math.round(totalDrawCalls/TICKS)} draw calls/tick; ${totalHits} collision pairs total`);
  console.log(`│  budget ${BUDGET_MS} ms   ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runServerTick();
  process.exit(r.pass ? 0 : 1);
}
