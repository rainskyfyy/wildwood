/**
 * Main entry — wires the M4 modules into a game loop.
 *
 * Boots in this order:
 *   1. World generation (Perlin → 4 biomes → decorations → transitions).
 *   2. Player + camera + HUD construction.
 *   3. requestAnimationFrame loop: input → update → render.
 *
 * Renders in two passes:
 *   pass 1 — world tiles (culled to camera bounds), then decorations
 *            and player (depth-sorted), all under the camera transform.
 *   pass 2 — HUD overlay in screen coords (no transform).
 */

'use strict';

import { generateWorld } from './world/generator.js';
import { scatterDecorations } from './world/decorator.js';
import { computeTransitions, blendColors } from './world/transitions.js';
import { getBiome } from './world/biome-config.js';
import { Player } from './player/player.js';
import { Camera } from './player/camera.js';
import { Input } from './utils/input.js';
import { HUD } from './hud/hud.js';
import {
  TILE_W_HALF, TILE_H_HALF, TILE_SIZE,
  worldToScreen, depthKey
} from './render/isometric.js';
import { getTileSprite, drawDecoration, drawPlayer } from './render/tile-renderer.js';

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
    render(ctx, canvas, world, decor, transitions, player, camera);
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { world, player, camera, hud };
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
  // We draw in tile order; the iso depth is implicit by traversal.
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const id = world.getTile(x, y);
      if (!id) continue;
      const biome = getBiome(id);
      const ei = world.idx(x, y);

      // Compute screen pos.
      const s = worldToScreen(x, y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;

      // Tile sprite (cached).
      const sprite = getTileSprite(id);
      ctx.drawImage(sprite, sx - TILE_W_HALF, sy - TILE_H_HALF);

      // Transition blend: tint with neighbor's color at midpoint.
      if (transitions.neighbor[ei] >= 0) {
        const otherCode = transitions.neighbor[ei];
        const otherId = biomeCodeToId(otherCode);
        const other = getBiome(otherId);
        const blended = blendColors(biome.primary, other.primary, transitions.blend[ei]);
        ctx.fillStyle = blended;
        // Recolor only the diamond; rely on same drawImage then a tinted overlay.
        // For perf, only do this for actual transition tiles.
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

// Mirror of generator.js code map — kept local to avoid import cycle.
const CODE_TO_BIOME = ['forest', 'plains', 'mines', 'snow'];
function biomeCodeToId(c) {
  return CODE_TO_BIOME[c] || 'plains';
}
