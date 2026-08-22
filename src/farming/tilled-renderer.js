/**
 * Tilled Renderer — 耕地 + 作物 4 阶段渲染
 *
 * 每个 cultivated tile 渲染:
 *   - 底层 tilled 地块 (深棕色菱形)
 *   - 缺水标记 (裂纹/灰白)
 *   - 作物 sprite (按 stage 缩放/换色)
 *   - 进度条 (READY 状态消失)
 *
 * 纯 Canvas2D,无外部资源 — 程序化绘制
 *
 * v1.0.0 — 初始
 */
'use strict';

import { TILE_W_HALF, TILE_H_HALF, TILE_SIZE } from '../render/isometric.js';
import { CROPS, CROP_STAGE, STAGE_THRESHOLD, stageForProgress, colorAtProgress } from './crops.js';
import { TILE_STATE } from './farming.js';

/**
 * Draw a single cultivated farm tile at (sx, sy) — screen coords of the
 * tile center. The tile is drawn with depth-aware offset so it sits
 * correctly among other iso sprites.
 */
export function drawFarmTile(ctx, sx, sy, tile) {
  if (tile.state === TILE_STATE.GRASS) return;

  if (tile.state === TILE_STATE.TILLED) {
    drawTilledGround(ctx, sx, sy, /*wet*/ false);
    return;
  }
  // PLANTED or READY
  const crop = CROPS[tile.cropId];
  if (!crop) return;

  drawTilledGround(ctx, sx, sy, !tile.dehydrated);
  drawCrop(ctx, sx, sy, crop, tile.progress, tile.dehydrated);
  if (tile.fertilizer) {
    drawFertilizerSparkle(ctx, sx, sy, tile.fertilizer);
  }
  if (tile.state === TILE_STATE.PLANTED && !tile.dehydrated) {
    drawWaterDroplet(ctx, sx, sy);
  }
}

function drawTilledGround(ctx, sx, sy, wet) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy - TILE_H_HALF);
  ctx.lineTo(sx + TILE_W_HALF, sy);
  ctx.lineTo(sx, sy + TILE_H_HALF);
  ctx.lineTo(sx - TILE_W_HALF, sy);
  ctx.closePath();
  ctx.fillStyle = wet ? '#4a2a14' : '#6a3a1a';
  ctx.fill();
  // Furrow lines
  ctx.strokeStyle = wet ? 'rgba(40, 18, 8, 0.6)' : 'rgba(80, 40, 18, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx - TILE_W_HALF * 0.6, sy - TILE_H_HALF * 0.2);
  ctx.lineTo(sx + TILE_W_HALF * 0.6, sy - TILE_H_HALF * 0.2);
  ctx.moveTo(sx - TILE_W_HALF * 0.4, sy + TILE_H_HALF * 0.2);
  ctx.lineTo(sx + TILE_W_HALF * 0.4, sy + TILE_H_HALF * 0.2);
  ctx.stroke();

  if (!wet) {
    // Dehydrated cracks
    ctx.strokeStyle = 'rgba(220, 200, 160, 0.4)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sx - 4, sy - 2);
    ctx.lineTo(sx + 4, sy - 2);
    ctx.moveTo(sx - 3, sy + 3);
    ctx.lineTo(sx + 3, sy + 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaterDroplet(ctx, sx, sy) {
  ctx.save();
  ctx.fillStyle = 'rgba(80, 140, 220, 0.7)';
  ctx.beginPath();
  ctx.arc(sx - 5, sy - 4, 1.5, 0, Math.PI * 2);
  ctx.arc(sx + 6, sy + 3, 1.2, 0, Math.PI * 2);
  ctx.arc(sx + 1, sy + 5, 1.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrop(ctx, sx, sy, crop, progress, dehydrated) {
  const stage = stageForProgress(progress);
  if (stage === CROP_STAGE.SEED) {
    // tiny seed dot
    ctx.save();
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.arc(sx, sy + 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // sizes scale with stage
  const sizeMap = {
    [CROP_STAGE.SEEDLING]: 0.4,
    [CROP_STAGE.GROWING]:  0.6,
    [CROP_STAGE.MATURE]:   0.8,
    [CROP_STAGE.READY]:    1.0
  };
  const size = sizeMap[stage] || 0.5;
  const baseColor = crop.stages[stage];
  const color = dehydrated ? desaturate(baseColor, 0.5) : baseColor;

  ctx.save();
  ctx.translate(sx, sy - 2);

  if (crop.id === 'wheat') {
    drawWheat(ctx, color, size);
  } else if (crop.id === 'pumpkin' || crop.id === 'watermelon') {
    drawRoundFruit(ctx, color, size, crop.id);
  } else if (crop.id === 'berries') {
    drawBerries(ctx, color, size);
  } else if (crop.id === 'corn') {
    drawCorn(ctx, color, size);
  } else {
    drawGenericCrop(ctx, color, size);
  }

  if (stage === CROP_STAGE.READY) {
    // Sparkle to signal ready
    ctx.fillStyle = 'rgba(255, 220, 120, 0.85)';
    ctx.beginPath();
    ctx.arc(2, -2, 1.2, 0, Math.PI * 2);
    ctx.arc(-3, 1, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGenericCrop(ctx, color, size) {
  // stalk
  ctx.fillStyle = '#5a8a3a';
  ctx.fillRect(-1 * size, -6 * size, 2 * size, 8 * size);
  // leaves
  ctx.fillStyle = '#7aaa3a';
  ctx.beginPath();
  ctx.ellipse(-3 * size, -3 * size, 2 * size, 1.2 * size, 0, 0, Math.PI * 2);
  ctx.ellipse(3 * size, -1 * size, 2 * size, 1.2 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  // fruit/flower
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -7 * size, 2.5 * size, 0, Math.PI * 2);
  ctx.fill();
}

function drawWheat(ctx, color, size) {
  // stalks
  ctx.fillStyle = '#7a8a3a';
  ctx.fillRect(-2 * size, -8 * size, 1.2 * size, 10 * size);
  ctx.fillRect(0.5 * size, -7 * size, 1.2 * size, 9 * size);
  // heads
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(-1.4 * size, -9 * size, 1.5 * size, 3 * size, 0, 0, Math.PI * 2);
  ctx.ellipse(1.1 * size, -8 * size, 1.5 * size, 3 * size, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoundFruit(ctx, color, size, kind) {
  // vine
  ctx.strokeStyle = '#5a8a3a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 4 * size);
  ctx.quadraticCurveTo(-3 * size, 0, -4 * size, -3 * size);
  ctx.stroke();
  // round fruit
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 1 * size, 5 * size, 0, Math.PI * 2);
  ctx.fill();
  // stripes for watermelon
  if (kind === 'watermelon') {
    ctx.strokeStyle = '#1a5a2a';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-4 * size, 1 * size);
    ctx.quadraticCurveTo(0, -3 * size, 4 * size, 1 * size);
    ctx.stroke();
  }
}

function drawBerries(ctx, color, size) {
  ctx.fillStyle = '#5a8a3a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4 * size, 3 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  // berries
  ctx.fillStyle = color;
  for (const [bx, by, r] of [[-2, -1, 1.2], [1, -1, 1.2], [-1, 1, 1.1], [2, 1, 1.0]]) {
    ctx.beginPath();
    ctx.arc(bx * size, by * size, r * size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCorn(ctx, color, size) {
  ctx.fillStyle = '#5a8a3a';
  ctx.fillRect(-1, -7 * size, 2, 9 * size);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, -2 * size, 1.8 * size, 4 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  // kernels
  ctx.fillStyle = '#fff3a8';
  for (let i = -2; i <= 2; i++) {
    for (let j = -3; j <= 0; j++) {
      ctx.fillRect(i * 0.8 * size - 0.4, j * 1.2 * size - 0.4, 0.8 * size, 0.8 * size);
    }
  }
}

function drawFertilizerSparkle(ctx, sx, sy, fertilizer) {
  ctx.save();
  ctx.fillStyle = 'rgba(180, 220, 120, 0.5)';
  for (let i = 0; i < 3; i++) {
    const angle = (Date.now() / 1000 + i) * (Math.PI * 2 / 3);
    const r = 4 + i;
    ctx.beginPath();
    ctx.arc(sx + Math.cos(angle) * r, sy - 5 + Math.sin(angle) * r, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function desaturate(hex, amount) {
  // Convert hex to RGB, blend toward gray
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = (r + g + b) / 3;
  const rr = Math.round(r * (1 - amount) + gray * amount);
  const gg = Math.round(g * (1 - amount) + gray * amount);
  const bb = Math.round(b * (1 - amount) + gray * amount);
  return `rgb(${rr},${gg},${bb})`;
}
