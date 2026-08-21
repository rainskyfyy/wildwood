/**
 * Building sprite renderer — Canvas-drawn placeholders for each building
 * type, mirroring the M4/M5 approach for tiles.
 *
 * Real art at `assets/art/buildings/<id>.png` is not yet shipped to
 * this sandbox. The placeholder layer generates a 32x32 (or Nx32)
 * sprite per building using the catalog's color/outline/accent
 * values, plus a type-specific motif:
 *   - campfire        : 2 logs in X + flickering flame wedge
 *   - science_machine : box + antenna + glowing screen
 *   - chest           : box with iron bands + clasp
 *   - wall            : 4 stacked bricks
 *   - floor           : 2 horizontal planks
 *
 * When PNGs land, this module grows a real loader; the public
 * `getBuildingSprite(buildingId)` contract stays the same.
 *
 * The drawing functions support alpha (for the placement preview)
 * and tint (green = can place, red = cannot) via `drawBuilding`.
 */

'use strict';

import { getBuilding } from './building-config.js';
import { TILE_SIZE, TILE_W_HALF, TILE_H_HALF } from '../render/isometric.js';

// Sprite cache: buildingId -> canvas (per footprint dims)
const cache = new Map();

/**
 * Build a sprite for a building. Dimensions: width = w * TILE_SIZE,
 * height = h * TILE_SIZE. The sprite is drawn in iso projection: each
 * tile of the building footprint is a diamond, drawn back-to-front
 * (north-west first, south-east last) so south-east tiles correctly
 * occlude north-west ones.
 */
function buildSprite(buildingId) {
  const def = getBuilding(buildingId);
  if (!def) throw new Error(`Unknown building: ${buildingId}`);
  const [w, h] = def.size;
  const cv = document.createElement('canvas');
  cv.width = w * TILE_SIZE;
  cv.height = h * TILE_SIZE;
  const ctx = cv.getContext('2d');

  // Draw each tile of the footprint in iso order so depth is right.
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      drawFootprintTile(ctx, def, dx, dy, w, h);
    }
  }

  // Apply type-specific motif on top.
  switch (buildingId) {
    case 'campfire':        drawCampfireMotif(ctx, def, w, h); break;
    case 'science_machine': drawScienceMachineMotif(ctx, def, w, h); break;
    case 'chest':           drawChestMotif(ctx, def, w, h); break;
    case 'wall':            drawWallMotif(ctx, def, w, h); break;
    case 'floor':           /* motif is the planks themselves */ break;
  }
  return cv;
}

/**
 * Draw the base diamond for one tile of the building's footprint.
 * Coordinates within the sprite canvas: tile (dx, dy) center is at
 * (dx*TS + TS/2, dy*TS + TS/2).
 */
function drawFootprintTile(ctx, def, dx, dy, w, h) {
  const cx = dx * TILE_SIZE + TILE_SIZE / 2;
  const cy = dy * TILE_SIZE + TILE_SIZE / 2;
  // Iso diamond corners.
  const top    = { x: cx,                  y: cy - TILE_H_HALF };
  const right  = { x: cx + TILE_W_HALF,    y: cy };
  const bottom = { x: cx,                  y: cy + TILE_H_HALF };
  const left   = { x: cx - TILE_W_HALF,    y: cy };

  // Base fill (slightly darker outline first, then main).
  ctx.fillStyle = def.outline;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fill();

  // Inset diamond (primary color, 1px smaller).
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y + 1);
  ctx.lineTo(right.x - 1, right.y);
  ctx.lineTo(bottom.x, bottom.y - 1);
  ctx.lineTo(left.x + 1, left.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Campfire motif: two crossed logs + flame triangle.
 */
function drawCampfireMotif(ctx, def, w, h) {
  const cx = w * TILE_SIZE / 2;
  const cy = h * TILE_SIZE / 2;
  // Two logs in an X.
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy + 2);
  ctx.lineTo(cx + 4, cy - 2);
  ctx.moveTo(cx - 4, cy - 2);
  ctx.lineTo(cx + 4, cy + 2);
  ctx.stroke();
  // Flame.
  ctx.fillStyle = def.accent;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 3, cy);
  ctx.lineTo(cx - 3, cy);
  ctx.closePath();
  ctx.fill();
  // Ember highlight.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 0.5, cy - 3, 1, 1);
}

/**
 * Science machine motif: box on the left tile, antenna on the right.
 */
function drawScienceMachineMotif(ctx, def, w, h) {
  // The box sits in the left half of the left tile.
  const leftCx = TILE_SIZE / 2;
  const leftCy = TILE_SIZE / 2;
  // Box body.
  ctx.fillStyle = def.accent;
  ctx.fillRect(leftCx - 5, leftCy - 2, 10, 5);
  ctx.strokeStyle = def.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(leftCx - 5, leftCy - 2, 10, 5);
  // Tiny screen.
  ctx.fillStyle = '#a8e8ff';
  ctx.fillRect(leftCx - 3, leftCy - 1, 3, 2);
  // Antenna on right tile.
  if (w >= 2) {
    const rCx = TILE_SIZE + TILE_SIZE / 2;
    const rCy = TILE_SIZE / 2;
    ctx.strokeStyle = def.outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rCx, rCy + 2);
    ctx.lineTo(rCx, rCy - 4);
    ctx.stroke();
    // Bulb.
    ctx.fillStyle = def.accent;
    ctx.beginPath();
    ctx.arc(rCx, rCy - 5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Signal arcs.
    ctx.strokeStyle = def.accent;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(rCx, rCy - 5, 3, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();
  }
}

/**
 * Chest motif: box + iron bands + clasp.
 */
function drawChestMotif(ctx, def, w, h) {
  const cx = w * TILE_SIZE / 2;
  const cy = h * TILE_SIZE / 2;
  // Box body.
  ctx.fillStyle = def.color;
  ctx.fillRect(cx - 6, cy - 3, 12, 7);
  ctx.strokeStyle = def.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 6, cy - 3, 12, 7);
  // Iron bands (top + bottom).
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(cx - 6, cy - 3, 12, 1);
  ctx.fillRect(cx - 6, cy + 3, 12, 1);
  // Clasp.
  ctx.fillStyle = def.accent;
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
  // Lock dot.
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
}

/**
 * Wall motif: 4 small stacked bricks across the diamond.
 */
function drawWallMotif(ctx, def, w, h) {
  const cx = w * TILE_SIZE / 2;
  const cy = h * TILE_SIZE / 2;
  // Subtle bricks inside the diamond.
  ctx.fillStyle = def.accent;
  const brickW = 4, brickH = 2;
  for (let i = 0; i < 3; i++) {
    const y = cy - 3 + i * 3;
    ctx.fillRect(cx - 5, y, brickW, brickH);
    ctx.fillRect(cx + 1, y, brickW, brickH);
  }
  // Mortar lines.
  ctx.strokeStyle = def.outline;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - 1, cy - 3);
  ctx.lineTo(cx - 1, cy + 3);
  ctx.stroke();
}

/**
 * Get a cached sprite for a building type; builds it on first use.
 */
export function getBuildingSprite(buildingId) {
  if (!cache.has(buildingId)) cache.set(buildingId, buildSprite(buildingId));
  return cache.get(buildingId);
}

/**
 * Draw a placed building at a screen position. The building's
 * top-left tile should be at (screenX, screenY) in screen coords
 * (i.e. worldToScreen(building.tx, building.ty)).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} screenX — top-left tile's screen x
 * @param {number} screenY — top-left tile's screen y
 * @param {import('./placer.js').Building} building
 * @param {object} [opts]
 * @param {number} [opts.alpha=1.0] — 0..1 alpha multiplier (preview)
 * @param {string|null} [opts.tint=null] — 'green' | 'red' | null
 * @param {boolean} [opts.showHp=false] — draw an HP bar above the building
 */
export function drawBuilding(ctx, screenX, screenY, building, opts = {}) {
  const { alpha = 1.0, tint = null, showHp = false } = opts;
  const sprite = getBuildingSprite(building.id);
  // Anchor: the sprite was drawn with footprint top-left at (0,0).
  // The top-left tile's center in screen is (screenX, screenY); the
  // tile top in screen is (screenX, screenY - TILE_H_HALF).
  const drawX = screenX - TILE_W_HALF;
  const drawY = screenY - TILE_H_HALF;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, drawX, drawY);

  if (tint) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tint === 'green' ? 'rgba(80, 220, 100, 0.45)'
                                     : 'rgba(220, 60, 60, 0.45)';
    ctx.fillRect(drawX, drawY, sprite.width, sprite.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (showHp && building.hp < building.maxHp) {
    const barW = sprite.width * 0.7;
    const barH = 2;
    const bx = drawX + (sprite.width - barW) / 2;
    const by = drawY - 5;
    // Background.
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, barW, barH);
    // Fill.
    const pct = Math.max(0, building.hp / building.maxHp);
    ctx.fillStyle = pct > 0.5 ? '#5ad870' : pct > 0.25 ? '#d4c84a' : '#d45a4a';
    ctx.fillRect(bx, by, barW * pct, barH);
  }

  ctx.restore();
}

/**
 * Draw the placement preview (semi-transparent building at mouse
 * position). Equivalent to drawBuilding with alpha=0.5 and optional
 * green/red tint.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} screenX — top-left tile's screen x
 * @param {number} screenY — top-left tile's screen y
 * @param {string} buildingId
 * @param {boolean} canPlace
 */
export function drawPlacementPreview(ctx, screenX, screenY, buildingId, canPlace) {
  const def = getBuilding(buildingId);
  if (!def) return;
  // We need a fake Building for drawBuilding's interface. We bypass
  // it here and draw the sprite directly to avoid a stub object.
  const sprite = getBuildingSprite(buildingId);
  const drawX = screenX - TILE_W_HALF;
  const drawY = screenY - TILE_H_HALF;

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(sprite, drawX, drawY);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = canPlace ? 'rgba(80, 220, 100, 0.45)' : 'rgba(220, 60, 60, 0.45)';
  ctx.fillRect(drawX, drawY, sprite.width, sprite.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
