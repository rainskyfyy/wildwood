/**
 * Main entry — wires the M5 modules + M2.9 building system into a
 * game loop.
 *
 * Boots in this order:
 *   1. World generation (Perlin → 4 biomes → decorations → transitions).
 *   2. Player + camera + HUD + BuildingManager + BuildingMenu construction.
 *   3. requestAnimationFrame loop: input → update → render.
 *
 * M2.9 changes vs M5:
 *   - BuildingManager + BuildingMenu added.
 *   - B key toggles the build menu; 1-5 / mouse + click to select.
 *   - Mouse position maps to a world tile; placement preview follows.
 *   - Left click places the selected building if can-place; right click
 *     cancels selection / removes a building under cursor.
 *   - Buildings render in depth-sorted pass between decor and player.
 *   - WorldGrid.occupants now participates in isWalkable — player
 *     cannot walk through placed buildings.
 *
 * Renders in two passes:
 *   pass 1 — world tiles (culled to camera bounds), then depth-sorted
 *            decorations + buildings + player, all under the camera
 *            transform.
 *   pass 2 — HUD overlay + building menu + placement preview in
 *            screen coords (no transform).
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
  worldToScreen, screenToTile, depthKey
} from './render/isometric.js';
import {
  getTileSpriteAt, drawDecoration, drawPlayer
} from './render/tile-renderer.js';
import { preloadImages, isReady, getOrFallback } from './render/image-loader.js';
// M2.9: building system
import { BuildingManager } from './buildings/placer.js';
import { BuildingMenu } from './buildings/building-menu.js';
import {
  drawBuilding, drawPlacementPreview
} from './buildings/building-renderer.js';

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
  const input  = new Input(canvas);
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

  // 4. M2.9: building manager + menu. The selected building id is
  //    set when the user confirms a wedge in the menu; cleared after
  //    a successful placement OR explicit right-click.
  const buildingMgr = new BuildingManager(world);
  const buildMenu = new BuildingMenu();
  let pendingBuilding = null;   // building type id awaiting placement, or null

  // 5. M5: pre-load all M3.13 art (tiles + decorations + transitions).
  const artPaths = collectAllArtPaths();
  let imagesReady = false;
  preloadImages(artPaths).then(() => { imagesReady = true; });

  // ---- helpers (closure over local state) ----

  /**
   * Map a canvas-space (mouseX, mouseY) to a world tile coord. Returns
   * null if outside the world.
   */
  function mouseToTile(mx, my) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const camScreen = worldToScreen(camera.x, camera.y);
    const wsx = mx - (cx - camScreen.x);
    const wsy = my - (cy - camScreen.y);
    const t = screenToTile(wsx, wsy);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return null;
    return { x: tx, y: ty };
  }

  /**
   * Compute the screen coords of a world tile (top-left tile center),
   * given the current camera + canvas.
   */
  function tileToScreenXY(tx, ty) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const camScreen = worldToScreen(camera.x, camera.y);
    const s = worldToScreen(tx, ty);
    return { x: s.x + (cx - camScreen.x), y: s.y + (cy - camScreen.y) };
  }

  /**
   * M2.9: handle B key (toggle menu), menu input, placement, and
   * right-click cancel / destroy.
   *
   * Priority order each frame:
   *   1. If the menu is open, give it input first.
   *   2. Otherwise, B opens it.
   *   3. With a pending building, left click places; right click cancels.
   *   4. Without a pending building, right click removes a building
   *      under the cursor.
   */
  function updateBuildingInput() {
    if (buildMenu.isOpen) {
      buildMenu.update(input, canvas.width, canvas.height);
      const sel = buildMenu.consumeSelection();
      if (sel) {
        pendingBuilding = sel;
      }
      return;
    }
    if (input.consumePressed('b')) {
      buildMenu.open();
      return;
    }
    if (pendingBuilding) {
      if (input.consumeLeftClick()) {
        const tile = mouseToTile(input.mouseX, input.mouseY);
        if (tile) {
          const check = buildingMgr.canPlace(pendingBuilding, tile.x, tile.y, player, 2);
          if (check.ok) {
            buildingMgr.place(pendingBuilding, tile.x, tile.y, player);
            // Stay in placement mode for the same building (QoL: spam-build).
          }
        }
      }
      if (input.consumeRightClick()) {
        pendingBuilding = null;
      }
      return;
    }
    if (input.consumeRightClick()) {
      const tile = mouseToTile(input.mouseX, input.mouseY);
      if (tile) {
        for (const b of buildingMgr.buildings) {
          if (b.contains(tile.x, tile.y)) {
            buildingMgr.remove(b);
            break;
          }
        }
      }
    }
  }

  /**
   * Render the placement preview (if a building is selected) on top
   * of the world, before the HUD.
   */
  function renderBuildingOverlay() {
    if (!pendingBuilding) return;
    const tile = mouseToTile(input.mouseX, input.mouseY);
    if (!tile) return;
    const sxy = tileToScreenXY(tile.x, tile.y);
    const check = buildingMgr.canPlace(pendingBuilding, tile.x, tile.y, player, 2);
    drawPlacementPreview(ctx, sxy.x, sxy.y, pendingBuilding, check.ok);
  }

  // ---- main loop ----

  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); // clamp at 50ms
    lastT = now;

    // Update.
    player.update(dt, input);
    camera.follow(player);
    hud.update();
    updateBuildingInput();
    input.endFrame();

    // Slow vitals drain — demonstrates HUD updates.
    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    // Render.
    if (imagesReady) {
      render(ctx, canvas, world, decor, transitions, player, camera, buildingMgr);
      renderBuildingOverlay();
    } else {
      renderLoading(ctx, canvas, artPaths);
    }
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);
    if (buildMenu.isOpen) {
      buildMenu.draw(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { world, player, camera, hud, buildingMgr, buildMenu };
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
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let ready = 0;
  for (const p of paths) if (isReady(p)) ready++;
  const pct = paths.length > 0 ? (ready / paths.length) : 0;
  const barW = canvas.width * 0.5;
  const barH = 8;
  const bx = (canvas.width - barW) / 2;
  const by = canvas.height / 2;
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = '#d4a64a';
  ctx.fillRect(bx, by, barW * pct, barH);
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Loading art… ${ready}/${paths.length}`, canvas.width / 2, by - 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function render(ctx, canvas, world, decor, transitions, player, camera, mgr) {
  // Clear with a deep blue night-sky tone.
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = camera.viewBounds();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
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

      const s = worldToScreen(x, y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;

      const sprite = getTileSpriteAt(id, x, y);
      ctx.drawImage(sprite, sx - TILE_W_HALF, sy - TILE_H_HALF);

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

  // Pass 2: depth-sorted list of decor + buildings + player.
  const drawables = [];
  for (const d of decor) {
    if (d.x < bounds.x0 - 1 || d.x > bounds.x1 + 1
     || d.y < bounds.y0 - 1 || d.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'decor', ref: d, depth: depthKey(d.x, d.y) });
  }
  for (const b of mgr.buildings) {
    if (b.tx + b.w < bounds.x0 - 1 || b.tx > bounds.x1 + 1
     || b.ty + b.h < bounds.y0 - 1 || b.ty > bounds.y1 + 1) continue;
    // Depth by center of footprint so a 2x1 sorts by visual center.
    const c = b.center();
    drawables.push({ kind: 'building', ref: b, depth: depthKey(c.x, c.y) });
  }
  drawables.push({
    kind: 'player', depth: depthKey(player.x, player.y),
    ref: player
  });
  drawables.sort((a, b) => a.depth - b.depth);
  for (const it of drawables) {
    if (it.kind === 'decor') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      drawDecoration(ctx, sx, sy, it.ref);
    } else if (it.kind === 'building') {
      const b = it.ref;
      // Anchor: top-left tile of the building footprint.
      const bs = worldToScreen(b.tx, b.ty);
      const bsx = bs.x + offsetX;
      const bsy = bs.y + offsetY;
      drawBuilding(ctx, bsx, bsy, b, { showHp: true });
    } else {
      const s = worldToScreen(it.ref.x, it.ref.y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      drawPlayer(ctx, sx, sy, it.ref.facing);
    }
  }
}

// M5: matches BIOMES key order — desert=0, marsh=1, snow=2, volcano=3.
const CODE_TO_BIOME = Object.keys(BIOMES);

const transitionFallbackCache = new Map();
function buildTransitionFallback(me, other, blend) {
  const key = `${me.id}->${other.id}@${blend.toFixed(2)}`;
  if (transitionFallbackCache.has(key)) return transitionFallbackCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE;
  cv.height = TILE_SIZE;
  const c = cv.getContext('2d');
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
