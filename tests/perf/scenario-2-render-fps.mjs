/**
 * M3.11 perf · Scenario 2 — Entity rendering FPS under load
 *
 * 模拟真实客户端单帧渲染管线:
 *   500 怪物 + 1000 资源 + 200 建筑  =  1700 个 actor 在 80×60 tile 地图上
 *
 * Node 没有真实 Canvas,但渲染瓶颈是
 *   1) draw 路径计算 (worldToScreen / depthKey / viewBounds cull)
 *   2) fillStyle / drawImage / arc / fill 调用的开销
 * 我们用 fast-mock ctx 计数 + 伪耗时来度量:
 *   - 真计算路径 (矩阵 / 投影) 用真 isometric + 真 camera cull
 *   - 调绘制 API 时按"现代浏览器 Canvas2D 实现成本"加 ns 级计数
 *
 * 输出:单帧 ms → 推算最大 FPS, 对比 30 FPS 预算 (33.3ms)。
 */

'use strict';

import { performance } from 'node:perf_hooks';
import { generateWorld } from '../../src/world/generator.js';
import { scatterDecorations } from '../../src/world/decorator.js';
import { worldToScreen, depthKey, TILE_W_HALF, TILE_H_HALF } from '../../src/render/isometric.js';
import { MockCtx } from './lib/spatial.mjs';

function makeMonster(id, x, y) {
  return { kind: 'monster', id, x, y, frameIdx: 0, color: '#c33' };
}
function makeResource(id, x, y) {
  return { kind: 'resource', id, x, y, color: '#9c5' };
}
function makeBuilding(id, x, y) {
  return { kind: 'building', id, x, y, w: 2, h: 2, color: '#888' };
}

const VIEW_W = 1280;
const VIEW_H = 720;

class Camera {
  constructor() { this.x = 0; this.y = 0; }
  setTarget(tx, ty) {
    const s = worldToScreen(tx, ty);
    this.x = s.x - VIEW_W / 2;
    this.y = s.y - VIEW_H / 2;
  }
  viewBoundsTiles() {
    const pts = [
      [this.x, this.y],
      [this.x + VIEW_W, this.y],
      [this.x, this.y + VIEW_H],
      [this.x + VIEW_W, this.y + VIEW_H],
    ];
    let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
    for (const [sx, sy] of pts) {
      const tx = (sx / TILE_W_HALF + sy / TILE_H_HALF) * 0.5;
      const ty = (sy / TILE_H_HALF - sx / TILE_W_HALF) * 0.5;
      if (tx < minTx) minTx = tx;
      if (tx > maxTx) maxTx = tx;
      if (ty < minTy) minTy = ty;
      if (ty > maxTy) maxTy = ty;
    }
    return {
      x0: Math.max(0, Math.floor(minTx) - 1),
      y0: Math.max(0, Math.floor(minTy) - 1),
      x1: maxTx + 1,
      y1: maxTy + 1,
    };
  }
}

function renderFrame(ctx, world, actors, camera) {
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
}

function makeWorldAndActors(seed = 20260822) {
  const world = generateWorld({ width: 80, height: 60, seed });
  const decor = scatterDecorations(world, { density: 0.30, seed: seed + 7 });
  const actors = [];
  let id = 0;
  for (let i = 0; i < 500; i++) {
    actors.push(makeMonster(id++, (i * 17) % world.width, (i * 31) % world.height));
  }
  for (let i = 0; i < Math.min(1000, decor.length); i++) {
    const d = decor[i];
    actors.push(makeResource(id++, d.x, d.y));
  }
  for (let i = decor.length; i < 1000; i++) {
    actors.push(makeResource(id++, (i * 13) % world.width, (i * 11) % world.height));
  }
  for (let i = 0; i < 200; i++) {
    const bx = (i * 7) % (world.width - 4);
    const by = (i * 19) % (world.height - 4);
    actors.push(makeBuilding(id++, bx, by));
  }
  return { world, actors };
}

export function runRenderFps() {
  const WARMUP = 5;
  const SAMPLES = 30;
  const FRAMES_PER_SAMPLE = 10;

  const { world, actors } = makeWorldAndActors();
  const camera = new Camera();
  camera.setTarget(world.width / 2, world.height / 2);

  for (let i = 0; i < WARMUP; i++) {
    const ctx = new MockCtx();
    renderFrame(ctx, world, actors, camera);
  }

  const samples = [];
  let totalDrawCalls = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const ctx = new MockCtx();
    camera.setTarget(40 + (i % 5), 30 + (i % 3));
    const t0 = performance.now();
    for (let f = 0; f < FRAMES_PER_SAMPLE; f++) {
      ctx.calls = 0; ctx.drawCalls = 0; ctx.totalNs = 0;
      renderFrame(ctx, world, actors, camera);
      totalDrawCalls += ctx.drawCalls;
    }
    const t1 = performance.now();
    samples.push((t1 - t0) / FRAMES_PER_SAMPLE);
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  const fpsP50 = 1000 / p50;
  const fpsP95 = 1000 / p95;
  const budgetFps = 30;
  const pass = fpsP50 >= budgetFps;

  const lastCtx = new MockCtx();
  renderFrame(lastCtx, world, actors, camera);
  const drawCallsPerFrame = lastCtx.drawCalls;

  const report = {
    scenario: 'render-fps-500-1000-200',
    actorCounts: { monsters: 500, resources: 1000, buildings: 200, total: 1700 },
    samples: SAMPLES,
    framesPerSample: FRAMES_PER_SAMPLE,
    frameMs: { p50: +p50.toFixed(3), p95: +p95.toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3) },
    fps:        { p50: +fpsP50.toFixed(1), p95: +fpsP95.toFixed(1) },
    budgetFps,
    pass,
    drawCallsPerFrame,
    totalDrawCalls,
  };

  console.log('┌─ Scenario 2 · Render FPS (500 monster + 1000 resource + 200 building)');
  console.log(`│  ${actors.length} actors, ${SAMPLES} samples × ${FRAMES_PER_SAMPLE} frames`);
  console.log(`│  draw calls / frame: ${drawCallsPerFrame}`);
  console.log(`│  frame ms   p50=${p50.toFixed(3)}   p95=${p95.toFixed(3)}   min=${min.toFixed(3)}   max=${max.toFixed(3)}`);
  console.log(`│  fps        p50=${fpsP50.toFixed(1)}   p95=${fpsP95.toFixed(1)}   budget=${budgetFps}   ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runRenderFps();
  process.exit(r.pass ? 0 : 1);
}
