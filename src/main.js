/**
 * Main entry — wires the M5 modules into a game loop.
 *
 * Boots in this order:
 *   1. World generation (Perlin → 4 biomes → decorations → transitions).
 *   2. Player + camera + HUD construction.
 *   3. requestAnimationFrame loop: input → update → render.
 *
 * M5 changes vs M4:
 *   - Async pre-load of all tile + decoration + transition PNGs at boot;
 *     first frame shows a "Loading..." splash until ready, then swaps in
 *     real M3.13 art automatically.
 *   - Per-tile variant via getTileSpriteAt(biomeId, x, y) — same world
 *     coord always picks the same PNG (deterministic).
 *   - Transition rendering: prefers M3.13 transition PNG (e.g.
 *     desert2snow_step1.png) when available; falls back to procedural
 *     color blend for pairs not covered by art (marsh pairs).
 *
 * Renders in two passes:
 *   pass 1 — world tiles (culled to camera bounds), then decorations
 *            and player (depth-sorted), all under the camera transform.
 *   pass 2 — HUD overlay in screen coords (no transform).
 */

'use strict';

import { generateWorld } from './world/generator.js';
import { scatterDecorations } from './world/decorator.js';
import {
  computeTransitions, blendColors, transitionArtPath
} from './world/transitions.js';
import { getBiome, BIOMES } from './world/biome-config.js';
import { Player } from './player/player.js';
import { Camera } from './player/camera.js';
import { Input } from './utils/input.js';
import { HUD } from './hud/hud.js';
import {
  TILE_W_HALF, TILE_H_HALF, TILE_SIZE,
  worldToScreen, depthKey
} from './render/isometric.js';
import {
  getTileSpriteAt, drawDecoration, drawPlayer
} from './render/tile-renderer.js';
import { preloadImages, isReady, getOrFallback } from './render/image-loader.js';

const WORLD_W = 80;
const WORLD_H = 60;
const SEED    = 20260822;

export function bootGame(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. World.
  const world = generateWorld({ width: WORLD_W, height: WORLD_H, seed: SEED });
  const decor = scatterDecorations(world, { density: 0.06, seed: SEED + 7 });
  const transitions = computeTransitions(world, 2);

  // 2. Actors.
  const input  = new Input();
  const camera = new Camera({
    viewportWidth: canvas.width,
    viewportHeight: canvas.height
  });
  const player = new Player({ world, x: 40, y: 30, speed: 5.0 });

  // 3. HUD.
  const hud = new HUD(ctx, input, world);
  const vitalsState = {
    hp:     { cur: 100, max: 100 },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  // 4. M5: pre-load all M3.13 art (tiles + decorations + transitions).
  // Trigger loads immediately so the first frame is the only "Loading..."
  // the user sees.
  const artPaths = collectAllArtPaths();
  let imagesReady = false;
  preloadImages(artPaths).then(() => { imagesReady = true; });

  // Last frame timestamp for dt.
  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); // clamp at 50ms
    lastT = now;

    // Update.
    player.update(dt, input);
    camera.follow(player);
    hud.update();
    input.endFrame();

    // Slow vitals drain — demonstrates HUD updates.
    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    // Render.
    if (imagesReady) {
      render(ctx, canvas, world, decor, transitions, player, camera);
    } else {
      renderLoading(ctx, canvas, artPaths);
    }
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { world, player, camera, hud };
}

/**
 * Collect every PNG path we want pre-loaded: 20 tiles + 16 decor + 18
 * transitions = 54 images.
 */
function collectAllArtPaths() {
  const paths = [];
  for (const id of Object.keys(BIOMES)) {
    const b = BIOMES[id];
    for (const p of b.tileArt) paths.push(p);
    for (const d of b.decorPool) if (d.art) paths.push(d.art);
  }
  // Transitions: 6 pairs × 3 steps. Marsh pairs have no real art so are
  // skipped — loadImage is harmless for missing paths but no point.
  const transitionPairs = [
    ['desert', 'snow'],
    ['desert', 'volcano'],
    ['snow', 'volcano']
  ];
  for (const [a, b] of transitionPairs) {
    for (let step = 0; step < 3; step++) {
      paths.push(`./assets/art/biomes/_shared/transitions/${a}2${b}_step${step}.png`);
    }
  }
  return paths;
}

/**
 * Minimal loading splash drawn while PNGs download. Keeps the demo
 * responsive even on a slow first paint.
 */
function renderLoading(ctx, canvas, paths) {
  // Clear.
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Count how many are ready.
  let ready = 0;
  for (const p of paths) if (isReady(p)) ready++;
  const pct = paths.length > 0 ? (ready / paths.length) : 0;
  // Bar.
  const barW = canvas.width * 0.5;
  const barH = 8;
  const bx = (canvas.width - barW) / 2;
  const by = canvas.height / 2;
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = '#d4a64a';
  ctx.fillRect(bx, by, barW * pct, barH);
  // Label.
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Loading art… ${ready}/${paths.length}`, canvas.width / 2, by - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function render(ctx, canvas, world, decor, transitions, player, camera) {
  // Clear with a deep blue night-sky tone.
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = camera.viewBounds();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // Center of camera in screen space.
  const camScreen = worldToScreen(camera.x, camera.y);
  const offsetX = cx - camScreen.x;
  const offsetY = cy - camScreen.y;

  // Pass 1: tiles (back to front, by depth).
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const id = world.getTile(x, y);
      if (!id) continue;
      const ei = world.idx(x, y);

      // Compute screen pos.
      const s = worldToScreen(x, y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;

      // M5: per-tile variant sprite (real M3.13 PNG).
      const sprite = getTileSpriteAt(id, x, y);
      ctx.drawImage(sprite, sx - TILE_W_HALF, sy - TILE_H_HALF);

      // M5: transition — try real PNG first, else procedural blend.
      if (transitions.neighbor[ei] >= 0) {
        const otherCode = transitions.neighbor[ei];
        const otherId = CODE_TO_BIOME[otherCode];
        const other = getBiome(otherId);
        const me = getBiome(id);
        const blend = transitions.blend[ei];
        const art = transitionArtPath(id, otherId, blend);
        if (art && art.path && isReady(art.path)) {
          const img = getOrFallback(art.path, () => buildTransitionFallback(me, other, blend));
          ctx.drawImage(img, sx - TILE_W_HALF, sy - TILE_H_HALF);
        } else {
          // Procedural color blend.
          const blended = blendColors(me.primary, other.primary, blend);
          ctx.fillStyle = blended;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          const tipX = sx;
          const tipY = sy - TILE_H_HALF;
          const rightX = sx + TILE_W_HALF;
          const rightY = sy;
          const botX = sx;
          const botY = sy + TILE_H_HALF;
          const leftX = sx - TILE_W_HALF;
          const leftY = sy;
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(rightX, rightY);
          ctx.lineTo(botX, botY);
          ctx.lineTo(leftX, leftY);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }
    }
  }

  // Pass 2: depth-sorted list of decor + player.
  const drawables = [];
  for (const d of decor) {
    if (d.x < bounds.x0 - 1 || d.x > bounds.x1 + 1
     || d.y < bounds.y0 - 1 || d.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'decor', ref: d, depth: depthKey(d.x, d.y) });
  }
  drawables.push({
    kind: 'player', depth: depthKey(player.x, player.y),
    ref: player
  });
  drawables.sort((a, b) => a.depth - b.depth);
  for (const it of drawables) {
    const s = worldToScreen(it.ref.x, it.ref.y);
    const sx = s.x + offsetX;
    const sy = s.y + offsetY;
    if (it.kind === 'decor') {
      drawDecoration(ctx, sx, sy, it.ref);
    } else {
      drawPlayer(ctx, sx, sy, it.ref.facing);
    }
  }
}

// M5: matches BIOMES key order — desert=0, marsh=1, snow=2, volcano=3.
const CODE_TO_BIOME = Object.keys(BIOMES);

// Fallback canvas (one per unique blend) used when a transition PNG
// path is registered but the file is missing. Cached for the run.
const transitionFallbackCache = new Map();
function buildTransitionFallback(me, other, blend) {
  const key = `${me.id}->${other.id}@${blend.toFixed(2)}`;
  if (transitionFallbackCache.has(key)) return transitionFallbackCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE;
  cv.height = TILE_SIZE;
  const c = cv.getContext('2d');
  // Fill a diamond with the blended color.
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;
  c.fillStyle = blendColors(me.primary, other.primary, blend);
  c.beginPath();
  c.moveTo(cx, cy - TILE_H_HALF);
  c.lineTo(cx + TILE_W_HALF, cy);
  c.lineTo(cx, cy + TILE_H_HALF);
  c.lineTo(cx - TILE_W_HALF, cy);
  c.closePath();
  c.fill();
  transitionFallbackCache.set(key, cv);
  return cv;
}

// Suppress unused-import warning for biomeCodeToId (kept for debug
// hooks; main.js no longer calls it directly).
void biomeCodeToId;
