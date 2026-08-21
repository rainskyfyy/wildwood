/**
 * Tile sprite renderer — Canvas-drawn placeholders for each biome.
 *
 * Real art at `assets/art/biomes/{biome}/` is not yet shipped to this
 * sandbox. The placeholder layer generates a 32x32 diamond with
 * biome-themed color + a couple of pixel-detail dabs so the demo is
 * visually distinguishable while the art team produces PNGs.
 *
 * When PNGs land, this module grows a real loader; the public
 * `getTileSprite(biomeId, ctx)` contract stays the same.
 */

'use strict';

import { BIOMES, getBiome } from '../world/biome-config.js';
import { TILE_SIZE, TILE_W_HALF, TILE_H_HALF } from './isometric.js';

const cache = new Map(); // biomeId -> OffscreenCanvas (or HTMLCanvasElement)

/**
 * Build a 32x32 diamond sprite for `biomeId`. The sprite is a soft
 * "stone tile" diamond with primary fill, secondary corner dabs, accent
 * highlight, and a 1px outline. Cached for re-use.
 */
function buildSprite(biomeId) {
  const biome = getBiome(biomeId);
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE;
  cv.height = TILE_SIZE;
  const ctx = cv.getContext('2d');

  // Diamond outline points (centered on the canvas).
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;
  const w = TILE_W_HALF;
  const h = TILE_H_HALF;
  const tip = (x, y) => ({ x: cx + x, y: cy + y });

  ctx.beginPath();
  const top    = tip(0, -h);
  const right  = tip(w, 0);
  const bottom = tip(0, h);
  const left   = tip(-w, 0);
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = biome.primary;
  ctx.fill();

  // Secondary corner dabs.
  ctx.fillStyle = biome.secondary;
  const dab = (px, py) => {
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };
  dab(-3, -1.5); dab(3, -1.5); dab(-3, 1.5); dab(3, 1.5);

  // Accent highlight at top vertex.
  ctx.fillStyle = biome.accent;
  dab(0, -3);

  // 1px outline.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.stroke();

  return cv;
}

/**
 * Get the cached sprite for a biome id; builds it on first use.
 */
export function getTileSprite(biomeId) {
  if (!cache.has(biomeId)) cache.set(biomeId, buildSprite(biomeId));
  return cache.get(biomeId);
}

/**
 * Render a single decoration onto a destination context.
 * Decoration is drawn at its world position; assumes caller already
 * applied the world→screen transform and depth sort.
 */
export function drawDecoration(ctx, screenX, screenY, decor) {
  // Tree: trunk + canopy
  if (decor.kind === 'tree' || decor.kind === 'pine') {
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(screenX - 1, screenY - 1, 2, 5);
    ctx.fillStyle = decor.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 4, decor.size * 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Rock: small irregular blob
  if (decor.kind === 'rock') {
    ctx.fillStyle = decor.color;
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, decor.size * 3, decor.size * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Mushroom / flower / grass_tuft: small colored dot
  if (decor.kind === 'mushroom' || decor.kind === 'flower' || decor.kind === 'grass_tuft') {
    ctx.fillStyle = decor.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Ore: small bright dots
  if (decor.kind.startsWith('ore_')) {
    ctx.fillStyle = decor.color;
    ctx.fillRect(screenX - 1, screenY - 1, 2, 2);
    return;
  }
  // Snowdrift / ice / crystal: light blue dot
  ctx.fillStyle = decor.color;
  ctx.beginPath();
  ctx.arc(screenX, screenY, decor.size * 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw the player as a small humanoid: head + body.
 * `facing`: 'down' | 'up' | 'left' | 'right' (used for body offset).
 */
export function drawPlayer(ctx, screenX, screenY, facing = 'down', color = '#d8a85a') {
  // Body.
  ctx.fillStyle = color;
  ctx.fillRect(screenX - 3, screenY - 4, 6, 7);
  // Head.
  ctx.fillStyle = '#f0d4a8';
  ctx.beginPath();
  ctx.arc(screenX, screenY - 7, 3, 0, Math.PI * 2);
  ctx.fill();
  // Facing indicator: small offset dot on the head.
  ctx.fillStyle = '#000';
  const dirOffset = {
    up:    [0, -1.5],
    down:  [0,  1.5],
    left:  [-1, 0],
    right: [ 1, 0]
  }[facing] || [0, 1.5];
  ctx.fillRect(screenX + dirOffset[0], screenY - 7 + dirOffset[1], 1, 1);
}
