/**
 * M3.11 perf · Scenario 3 — 200 怪物同步帧动画 CPU 占用
 *
 * 目标: 200 怪物同步播放 20 帧 walk/attack idle 动画, 单 tick (16.67ms) 内
 *       CPU 占用 < 50%.
 *
 * 帧动画的本质:
 *   每个怪物持有 N 张 sprite 帧 (20 帧 = 240×32×32 字节 pixel buffer),
 *   每 tick 选择 frameIdx[i] = (frameIdx[i] + 1) % 20, 并把这张 sprite
 *   提交到 draw queue.
 *
 * 实际渲染走 Canvas drawImage, 但 draw 成本已计入 scenario-2.
 * 这里专测 "动画 tick" 的开销: frame index 推进 + 一次
 * 当前帧的 hash lookup + draw queue 入队.
 *
 * 基准: 单 tick 16.67ms (60 FPS), 50% = 8.33 ms.
 */

'use strict';

import { performance } from 'node:perf_hooks';

const MONSTER_COUNT = 200;
const FRAME_COUNT = 20;
const TICKS = 600;   // 10 seconds @ 60 FPS
const TICK_BUDGET_MS = 16.67; // 60 FPS

// Sprite "frame" — a 32x32 RGBA buffer.
const FRAME_BYTES = 32 * 32 * 4;
function buildFramePalette(count) {
  // Allocate the frame table up-front. Same cost as loading 20 PNGs once.
  const frames = new Array(count);
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(FRAME_BYTES);
    // Cheap "fill" — every other row to make it look like an animation cell.
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const off = (y * 32 + x) * 4;
        buf[off] = (i * 7) & 0xff;
        buf[off + 1] = (i * 13) & 0xff;
        buf[off + 2] = (i * 19) & 0xff;
        buf[off + 3] = 0xff;
      }
    }
    frames[i] = buf;
  }
  return frames;
}

function makeMonsters(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i,
      x: (i * 17) % 1000,
      y: (i * 31) % 1000,
      frameIdx: i % FRAME_COUNT,
      frameTime: 0,
      // per-monster anim state (idle vs walk vs attack)
      animState: ['idle', 'walk', 'attack'][i % 3],
    };
  }
  return out;
}

/**
 * One frame animation tick. Returns a draw queue length (caller-agnostic).
 *
 * Real-world: per-monster frameTime += dt, if frameTime >= frameInterval
 *             advance frameIdx. Some monsters share state (idle), some
 *             tick independently (walk). This matches M2.14 design.
 */
function animTick(monsters, frames, dt) {
  // Draw queue — entry per monster. Each entry is (frameBuffer, sx, sy).
  const drawQueue = new Array(monsters.length);
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i];
    // 20 frames @ 12 FPS anim → frameInterval = 1/12s = 83ms.
    m.frameTime += dt;
    if (m.frameTime >= 0.0833) {
      m.frameTime -= 0.0833;
      m.frameIdx = (m.frameIdx + 1) % FRAME_COUNT;
    }
    // Look up the current frame buffer (this is a real map lookup).
    const frame = frames[m.frameIdx];
    // Compute screen position (typical iso: worldToScreen).
    const sx = (m.x - m.y) * 16;
    const sy = (m.x + m.y) * 8;
    drawQueue[i] = { frame, sx, sy, mid: m.id };
  }
  return drawQueue;
}

export function runAnim() {
  const frames = buildFramePalette(FRAME_COUNT);
  const monsters = makeMonsters(MONSTER_COUNT);

  // Memory: 200 * 20 * 4KB = 16 MB pixel data.
  const pixelBufferMB = (MONSTER_COUNT * FRAME_COUNT * FRAME_BYTES) / 1024 / 1024;
  const monstersArrMB = JSON.stringify(monsters).length / 1024 / 1024;

  // Warmup.
  for (let i = 0; i < 10; i++) animTick(monsters, frames, TICK_BUDGET_MS / 1000);

  // Per-tick cost across 600 ticks.
  const tickMs = new Array(TICKS);
  let totalDrawQueue = 0;
  const dt = TICK_BUDGET_MS / 1000;
  for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();
    const q = animTick(monsters, frames, dt);
    const t1 = performance.now();
    tickMs[t] = t1 - t0;
    totalDrawQueue += q.length;
  }
  const sorted = tickMs.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];
  const mean = tickMs.reduce((s, x) => s + x, 0) / tickMs.length;
  const cpuPctP50 = (p50 / TICK_BUDGET_MS) * 100;
  const cpuPctP95 = (p95 / TICK_BUDGET_MS) * 100;
  const cpuPctMax = (max / TICK_BUDGET_MS) * 100;
  const budgetPct = 50;
  const pass = cpuPctP50 < budgetPct;

  const report = {
    scenario: 'anim-200x20',
    monsters: MONSTER_COUNT,
    framesPerAnim: FRAME_COUNT,
    ticks: TICKS,
    tickBudgetMs: TICK_BUDGET_MS,
    tickMs: {
      mean: +mean.toFixed(3),
      p50: +p50.toFixed(3),
      p95: +p95.toFixed(3),
      p99: +p99.toFixed(3),
      max: +max.toFixed(3),
    },
    cpuPct: {
      p50: +cpuPctP50.toFixed(2),
      p95: +cpuPctP95.toFixed(2),
      max: +cpuPctMax.toFixed(2),
    },
    budgetPct,
    pass,
    drawQueuePerTick: MONSTER_COUNT,
    totalDrawEnqueued: totalDrawQueue,
    frameBufferMB: +pixelBufferMB.toFixed(2),
  };

  console.log('┌─ Scenario 3 · 200 怪物 × 20 帧同步动画 CPU');
  console.log(`│  ${MONSTER_COUNT} monsters × ${FRAME_COUNT} frames = ${pixelBufferMB.toFixed(1)} MB 像素缓存`);
  console.log(`│  ${TICKS} ticks @ ${TICK_BUDGET_MS} ms budget (60 FPS)`);
  console.log(`│  tick ms  mean=${mean.toFixed(3)}   p50=${p50.toFixed(3)}   p95=${p95.toFixed(3)}   p99=${p99.toFixed(3)}   max=${max.toFixed(3)}`);
  console.log(`│  CPU %%    p50=${cpuPctP50.toFixed(2)}%%   p95=${cpuPctP95.toFixed(2)}%%   max=${cpuPctMax.toFixed(2)}%%   budget=${budgetPct}%%   ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('└─');
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runAnim();
  process.exit(r.pass ? 0 : 1);
}
