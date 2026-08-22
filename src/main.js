/**
 * Main entry — M4 (world) + M2.10 (resources) integration.
 * v1.0.1 — M2.10b: regrow + tool durability
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
  TILE_W_HALF, TILE_H_HALF,
  worldToScreen, depthKey
} from './render/isometric.js';
import { getTileSprite, drawDecoration, drawPlayer } from './render/tile-renderer.js';
import { drawResource } from './render/resource-renderer.js';
import { screenToWorld } from './render/picker.js';
import { spawnResources } from './resources/spawner.js';
import { Inventory } from './resources/inventory.js';
import { Gather } from './resources/gather.js';
import { RegrowManager } from './resources/regrow.js';
import { TOTAL_SLOTS } from './resources/inventory.js';

const WORLD_W = 80;
const WORLD_H = 60;
const SEED    = 20260822;
const INV_KEY = 'wildwood.m210.inventory.v1';

function loadInventory() {
  try {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return null;
    const inv = new Inventory({
      onBreak: ({ itemId }) => {
        lastBreakBanner = `工具损坏:${itemId}`;
        lastBreakUntil = performance.now() + 2200;
      }
    });
    inv.loadSnapshot(JSON.parse(raw));
    return inv;
  } catch (_) { return null; }
}
function saveInventory(inv) {
  try { localStorage.setItem(INV_KEY, JSON.stringify(inv.serialize())); }
  catch (_) { /* quota / private mode — ignore */ }
}

export function bootGame(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. World.
  const world = generateWorld({ width: WORLD_W, height: WORLD_H, seed: SEED });
  const decor = scatterDecorations(world, { density: 0.06, seed: SEED + 7 });
  const transitions = computeTransitions(world, 2);
  const resources = spawnResources(world, { seed: SEED + 53 });

  // 2. Inventory + gather + regrow.
  const inventory = loadInventory() || new Inventory({
    onBreak: ({ itemId }) => {
      lastBreakBanner = `工具损坏:${itemId}`;
      lastBreakUntil = performance.now() + 2200;
    }
  });
  if (inventory.slots.every(s => s == null)) {
    inventory.add('log', 8);
    inventory.add('twine', 4);
    inventory.add('stone', 6);
    inventory.add('berries', 3);
  }
  const gather = new Gather({
    entities: resources,
    inventory,
    selectedItemProvider: () => {
      const s = inventory.hotbarSelected();
      return s ? s.itemId : null;
    },
    onEvent: (name, payload) => {
      if (name === 'complete') {
        const lootStr = (payload.loot || []).map(l => `${l.itemId}×${l.count}`).join(' ');
        const suffix = payload.toolUsed ? `  工具耐久 -1` : '';
        lastLootBanner = (lootStr || '已采集') + suffix;
        lastLootUntil = performance.now() + 2200;

        // v1.0.3 — depletion / transform messaging.
        if (payload.transformedTo) {
          // gold_ore -> rock, gem_vein -> rock
          lastDepletedBanner = `${payload.entity.def.name} 枯竭 → 变为 ${payload.transformedTo}`;
          lastDepletedUntil = performance.now() + 2800;
        } else if (payload.depleted && Number.isFinite(payload.maxHarvests)
                   && payload.harvestCount >= payload.maxHarvests) {
          // Permanent depletion with no transform (e.g. coal after 4 hits)
          lastDepletedBanner = `${payload.entity.def.name} 已彻底枯竭 (${payload.harvestCount}/${payload.maxHarvests})`;
          lastDepletedUntil = performance.now() + 2800;
        } else if (payload.depleted && Number.isFinite(payload.maxHarvests)) {
          // Regrow between depletions
          lastDepletedBanner = `${payload.entity.def.name} (${payload.harvestCount}/${payload.maxHarvests})`;
          lastDepletedUntil = performance.now() + 1400;
        }
      }
    }
  });
  const regrow = new RegrowManager({
    entities: resources,
    onRegrow: (e) => {
      lastRegrowBanner = `${e.def.name} 已重生`;
      lastRegrowUntil = performance.now() + 1800;
    }
  });
  let lastLootBanner = null;
  let lastLootUntil = 0;
  let lastRegrowBanner = null;
  let lastRegrowUntil = 0;
  let lastBreakBanner = null;
  let lastBreakUntil = 0;
  let lastDepletedBanner = null;
  let lastDepletedUntil = 0;

  // 3. Actors.
  const input = new Input(canvas);
  const camera = new Camera({
    viewportWidth: canvas.width, viewportHeight: canvas.height
  });
  const player = new Player({ world, x: 40, y: 30, speed: 5.0 });
  const hud = new HUD(ctx, input, world, inventory);

  const vitalsState = {
    hp:     { cur: 100, max: 100 },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // panel toggles
    hud.processPanelToggles();

    // panel clicks consume mouse before game routing
    let panelConsumed = false;
    if (input.consumeClick()) {
      panelConsumed = hud.handlePanelClick(input.mouseX, input.mouseY, canvas.width, canvas.height);
    }

    // player movement only when no panel visible
    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible) {
      player.update(dt, input);
    }
    camera.follow(player);
    regrow.update(now);
    gather.update(player, dt, now);

    // world click for gather — only when not consumed by a panel
    if (!panelConsumed && input.consumeClick()) {
      const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      gather.click(w.x, w.y);
    }
    // right-click places the hotbar item into the crafting grid (if open)
    if (hud.craftingPanel.visible && input.consumeRightClick()) {
      hud.craftingPanel.onClick(
        input.mouseX, input.mouseY, canvas.width, canvas.height,
        inventory.selected);
    }

    hud.update();
    input.endFrame();

    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, now);
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    // banners
    if (lastLootBanner && now < lastLootUntil) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(canvas.width/2 - 110, 50, 220, 28);
      ctx.fillStyle = '#d4a64a';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+ ${lastLootBanner}`, canvas.width/2, 64);
    } else {
      lastLootBanner = null;
    }
    if (lastRegrowBanner && now < lastRegrowUntil) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(canvas.width/2 - 110, 86, 220, 26);
      ctx.fillStyle = '#7ec47e';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`✿ ${lastRegrowBanner}`, canvas.width/2, 99);
    } else {
      lastRegrowBanner = null;
    }
    if (lastBreakBanner && now < lastBreakUntil) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(canvas.width/2 - 110, 120, 220, 26);
      ctx.fillStyle = '#e85a3a';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`✕ ${lastBreakBanner}`, canvas.width/2, 133);
    } else {
      lastBreakBanner = null;
    }
    if (lastDepletedBanner && now < lastDepletedUntil) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(canvas.width/2 - 130, 154, 260, 26);
      ctx.fillStyle = '#a85a3a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`▼ ${lastDepletedBanner}`, canvas.width/2, 167);
    } else {
      lastDepletedBanner = null;
    }

    // periodic save
    if ((now | 0) % 60 === 0) saveInventory(inventory);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { world, player, camera, hud, inventory, gather, regrow, resources };
}

function render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, now) {
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = camera.viewBounds();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const camScreen = worldToScreen(camera.x, camera.y);
  const offsetX = cx - camScreen.x;
  const offsetY = cy - camScreen.y;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const id = world.getTile(x, y);
      if (!id) continue;
      const biome = getBiome(id);
      const ei = world.idx(x, y);
      const s = worldToScreen(x, y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      const sprite = getTileSprite(id);
      ctx.drawImage(sprite, sx - TILE_W_HALF, sy - TILE_H_HALF);
      if (transitions.neighbor[ei] >= 0) {
        const otherCode = transitions.neighbor[ei];
        const other = getBiome(biomeCodeToId(otherCode));
        const blended = blendColors(biome.primary, other.primary, transitions.blend[ei]);
        ctx.fillStyle = blended;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(sx, sy - TILE_H_HALF);
        ctx.lineTo(sx + TILE_W_HALF, sy);
        ctx.lineTo(sx, sy + TILE_H_HALF);
        ctx.lineTo(sx - TILE_W_HALF, sy);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }
  }

  const drawables = [];
  for (const d of decor) {
    if (d.x < bounds.x0 - 1 || d.x > bounds.x1 + 1
     || d.y < bounds.y0 - 1 || d.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'decor', ref: d, depth: depthKey(d.x, d.y) });
  }
  for (const r of resources) {
    if (r.x < bounds.x0 - 1 || r.x > bounds.x1 + 1
     || r.y < bounds.y0 - 1 || r.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'resource', ref: r, depth: depthKey(r.x, r.y) });
  }
  drawables.push({ kind: 'player', depth: depthKey(player.x, player.y), ref: player });
  drawables.sort((a, b) => a.depth - b.depth);
  for (const it of drawables) {
    const s = worldToScreen(it.ref.x, it.ref.y);
    const sx = s.x + offsetX;
    const sy = s.y + offsetY;
    if (it.kind === 'decor') drawDecoration(ctx, sx, sy, it.ref);
    else if (it.kind === 'resource') {
      const progress = (gather.target === it.ref) ? gather.progressFraction() : 0;
      drawResource(ctx, sx, sy, it.ref, progress, now);
    }
    else drawPlayer(ctx, sx, sy, it.ref.facing);
  }
}

const CODE_TO_BIOME = ['forest', 'plains', 'mines', 'snow'];
function biomeCodeToId(c) { return CODE_TO_BIOME[c] || 'plains'; }
