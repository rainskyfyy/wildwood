/**
 * Tile + decoration sprite renderer — M5 swap-in for real M3.13 PNG art.
 *
 * Public API (M4 contract preserved):
 *   getTileSprite(biomeId)    -> HTMLImageElement|HTMLCanvasElement
 *   drawDecoration(ctx, sx, sy, decor)
 *   drawPlayer(ctx, sx, sy, facing, color)
 *
 * M5 behavior:
 *   - getTileSprite resolves a real M3.13 PNG via image-loader; if the
 *     PNG is missing or not yet loaded, returns a procedural diamond
 *     (M4 placeholder) so the demo never blanks.
 *   - Tile variant per world coord is deterministic via
 *     pickTileVariant(x, y) — same world → same PNG.
 *   - drawDecoration loads the M3.13 decoration PNG if decor.art is set;
 *     else draws a procedural dot/blob keyed by decor.kind.
 *   - drawPlayer unchanged from M4.
 *
 * NOTE: getTileSprite is now per-tile (variant) not per-biome. Callers
 * that batched per-biome caches should call getTileSprite(biomeId, x, y).
 * The biome-only signature is preserved for back-compat: it picks a
 * default variant (variant 0).
 */

'use strict';

import { BIOMES, getBiome, pickTileVariant } from '../world/biome-config.js';
import { TILE_SIZE, TILE_W_HALF, TILE_H_HALF } from './isometric.js';
import { loadImage, isReady, getOrFallback } from './image-loader.js';

// Sprite cache keyed by `biomeId|variant`.
const cache = new Map();

/**
 * Build a 32x32 diamond sprite for `biomeId` (procedural fallback).
 * Same shape as M4 — diamond with primary fill, secondary dabs, accent
 * highlight, 1px outline. Cached per (biomeId, -1) key.
 */
function buildProceduralTile(biomeId) {
  const biome = getBiome(biomeId);
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE;
  cv.height = TILE_SIZE;
  const ctx = cv.getContext('2d');

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

  ctx.fillStyle = biome.secondary;
  const dab = (px, py) => {
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };
  dab(-3, -1.5); dab(3, -1.5); dab(-3, 1.5); dab(3, 1.5);

  ctx.fillStyle = biome.accent;
  dab(0, -3);

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
 * Resolve a tile sprite for a given (biomeId, variant).
 * Returns a real M3.13 PNG Image if loaded, else the procedural diamond.
 *
 * @param {string} biomeId
 * @param {number} [variant=0] — index into biome.tileArt
 * @returns {HTMLImageElement|HTMLCanvasElement}
 */
export function getTileSprite(biomeId, variant = 0) {
  const key = `${biomeId}|${variant}`;
  if (cache.has(key)) return cache.get(key);

  const biome = getBiome(biomeId);
  const artPath = biome.tileArt[variant] || biome.tileArt[0];

  // Trigger the load; the image is cached by the loader.
  if (artPath) loadImage(artPath);

  // Use the loader's hot-path: returns Image if ready, else fallback.
  // The fallback is the procedural diamond (cached lazily inside the
  // loader for repeated calls while the PNG is still loading).
  const sprite = getOrFallback(
    artPath,
    () => buildProceduralTile(biomeId)
  );
  cache.set(key, sprite);
  return sprite;
}

/**
 * Convenience: get the variant for a (x, y) world coord and return its
 * sprite. This is the M5 hot-path used by the renderer.
 *
 * @param {string} biomeId
 * @param {number} x — world tile x
 * @param {number} y — world tile y
 * @returns {HTMLImageElement|HTMLCanvasElement}
 */
export function getTileSpriteAt(biomeId, x, y) {
  const variant = pickTileVariant(x, y, getBiome(biomeId).tileArt.length);
  return getTileSprite(biomeId, variant);
}

/**
 * Pre-load all tile PNGs for the given biome ids. Resolves when every
 * PNG has loaded (or errored). Used by main.js to warm the cache
 * before the first frame.
 *
 * @param {string[]} biomeIds
 * @returns {Promise<void>}
 */
export async function preloadAllTiles(biomeIds = Object.keys(BIOMES)) {
  const paths = [];
  for (const id of biomeIds) {
    for (const p of getBiome(id).tileArt) paths.push(p);
  }
  const { preloadImages } = await import('./image-loader.js');
  await preloadImages(paths);
}

/**
 * Render a single decoration onto a destination context.
 * M5: loads decor.art PNG if present; falls back to procedural shape.
 *
 * Decoration kinds seen in M5 (mapped to procedural shape when art
 * is missing):
 *   - lizard, scorpion, tumbleweed, icicle, pinecone, snowflake,
 *     ash, ember_spark, lava_bubble, sulfur_crystal  → PNG
 *   - mud_speck, reed, moss_patch                      → procedural blob
 *   - rabbit_track, sand_ripple                        → procedural line/dot
 */
export function drawDecoration(ctx, screenX, screenY, decor) {
  // M5 hot-path: real PNG via loader.
  if (decor.art) {
    if (isReady(decor.art)) {
      const img = getOrFallback(decor.art, () => buildProceduralDecor(decor));
      // Draw centered with size-based scale; most M3.13 PNGs are 32x32.
      const w = (img.naturalWidth || TILE_SIZE) * decor.size;
      const h = (img.naturalHeight || TILE_SIZE) * decor.size;
      ctx.drawImage(img, screenX - w / 2, screenY - h / 2, w, h);
      return;
    }
    // Still loading — fire the load so it's ready by next frame.
    loadImage(decor.art);
  }
  // Procedural fallback (also used when art: null).
  drawProceduralDecor(ctx, screenX, screenY, decor);
}

function buildProceduralDecor(decor) {
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE;
  cv.height = TILE_SIZE;
  const ctx = cv.getContext('2d');
  drawProceduralDecor(ctx, TILE_SIZE / 2, TILE_SIZE / 2, decor);
  return cv;
}

function drawProceduralDecor(ctx, screenX, screenY, decor) {
  const r = decor.size * 2.5;
  ctx.fillStyle = decor.color;
  switch (decor.kind) {
    case 'reed':
      // Vertical line + tiny head.
      ctx.fillRect(screenX - 0.5, screenY - r, 1, r * 2);
      ctx.beginPath();
      ctx.arc(screenX, screenY - r, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'moss_patch':
      // Soft ellipse.
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, r * 0.8, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rabbit_track':
      // Two small ovals like a footprint.
      ctx.beginPath();
      ctx.ellipse(screenX - 1, screenY, 1.2, 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(screenX + 1, screenY + 1, 1.2, 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sand_ripple':
      // Curved line.
      ctx.beginPath();
      ctx.arc(screenX, screenY, r * 0.8, Math.PI * 0.2, Math.PI * 0.8);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = decor.color;
      ctx.stroke();
      break;
    case 'mud_speck':
    default:
      // Plain dot.
      ctx.beginPath();
      ctx.arc(screenX, screenY, 1.4, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

/**
 * Draw the player as a small humanoid: head + body.
 * `facing`: 'down' | 'up' | 'left' | 'right' (used for body offset).
 * Unchanged from M4 — no M3.13 hero art yet.
 */
export function drawPlayer(ctx, screenX, screenY, facing = 'down', color = '#d8a85a') {
  ctx.fillStyle = color;
  ctx.fillRect(screenX - 3, screenY - 4, 6, 7);
  ctx.fillStyle = '#f0d4a8';
  ctx.beginPath();
  ctx.arc(screenX, screenY - 7, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  const dirOffset = {
    up:    [0, -1.5],
    down:  [0,  1.5],
    left:  [-1, 0],
    right: [ 1, 0]
  }[facing] || [0, 1.5];
  ctx.fillRect(screenX + dirOffset[0], screenY - 7 + dirOffset[1], 1, 1);
}
