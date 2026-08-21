/**
 * Main entry — M4 (world) + M2.9 (buildings) + M2.10 (resources) + v0.4 (multiplayer) + v0.5.1 (6 biomes + ecology) integration.
 *
 * `bootGame(canvas, options?)`:
 *   options.mode = 'offline' (default) | 'host' | 'join'
 *   options.client       — RelayClient(已连接)
 *   options.session      — Session(已 host/join 完成)
 *
 * 联机模式下:
 *   - host 端广播 G_STATE 10Hz + G_WORLD 离散事件
 *   - join 端发 G_INPUT + 应用 host 的 state/world
 *   - 双方都可发送 G_CHAT
 *
 * v0.5.1:
 *   - 6 群系径向布局（forest 中心、plains 环、4 极端群系四角）
 *   - 玩家从最大 forest 块中心出生
 *   - EcologyManager 推进种群动力学（logistic + 食物链）
 *   - EcologyMonster 在 M2.14 Monster 之上加 FLEE / GRAZE / HUNT
 */
'use strict';

import { generateWorld, findBiomeCenter } from './world/generator.js';
import { scatterDecorations } from './world/decorator.js';
import { computeTransitions, blendColors } from './world/transitions.js';
import { getBiome } from './world/biome-config.js';
import { CODE_TO_BIOME } from './world/generator.js';
import { Player } from './player/player.js';
import { Camera } from './player/camera.js';
import { Input } from './utils/input.js';
import { HUD } from './hud/hud.js';
import {
  TILE_W_HALF, TILE_H_HALF, TILE_SIZE,
  worldToScreen, depthKey
} from './render/isometric.js';
import { getTileSprite, drawDecoration, drawPlayer } from './render/tile-renderer.js';
import { drawResource } from './render/resource-renderer.js';
import { screenToWorld } from './render/picker.js';
import { spawnResources } from './resources/spawner.js';
import { Inventory } from './resources/inventory.js';
import { Gather } from './resources/gather.js';
import { TOTAL_SLOTS } from './resources/inventory.js';
import { BuildingManager } from './buildings/placer.js';
import { BuildingMenu } from './buildings/building-menu.js';
import { drawBuilding, drawPlacementPreview } from './buildings/building-renderer.js';
import { getBuilding } from './buildings/building-config.js';
import { Multiplayer } from './net/multiplayer.js';
import { loadImage, isReady, getOrFallback } from './render/image-loader.js';
import { MonsterManager } from './monster/monster-manager.js';
import { drawMonster } from './render/tile-renderer.js';
import { EcologyManager } from './ecology/ecology.js';

let monstersData = null;
let ecologyData = null;
let ecologyMonsters = null;

const WORLD_W = 80;
const WORLD_H = 60;
const SEED    = 20260822;
const INV_KEY = 'wildwood.m210.inventory.v1';

function loadInventory() {
  try {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return null;
    const inv = new Inventory();
    inv.loadSnapshot(JSON.parse(raw));
    return inv;
  } catch (_) { return null; }
}
function saveInventory(inv) {
  try { localStorage.setItem(INV_KEY, JSON.stringify(inv.serialize())); }
  catch (_) { /* quota / private mode — ignore */ }
}

export function bootGame(canvas, opts = {}) {
  const mode = opts.mode || 'offline';
  const client = opts.client || null;
  const session = opts.session || null;
  const playerName = opts.playerName || 'Player';

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. World — v0.5.1 default layout = radial (6 biomes).
  const world = generateWorld({
    width: WORLD_W,
    height: WORLD_H,
    seed: SEED,
    layout: 'radial'
  });
  const decor = scatterDecorations(world, { density: 0.06, seed: SEED + 7 });
  const transitions = computeTransitions(world, 2);
  const resources = spawnResources(world, { seed: SEED + 53 });

  // 2. Inventory + gather.
  const inventory = loadInventory() || new Inventory();
  if (inventory.slots.every(s => s == null)) {
    inventory.add('log', 8);
    inventory.add('twine', 4);
    inventory.add('stone', 6);
    inventory.add('berries', 3);
  }
  const gather = new Gather({
    entities: resources,
    inventory,
    onEvent: (name, payload) => {
      if (name === 'complete') {
        const lootStr = (payload.loot || []).map(l => `${l.itemId}×${l.count}`).join(' ');
        lastLootBanner = lootStr || '已采集';
        lastLootUntil = performance.now() + 2200;
        if (mp && mp.mode === 'host' && payload.entity) {
          mp.broadcastGather(payload.entity.id, payload.loot, payload.regrowAt || 0);
        }
      }
    }
  });
  let lastLootBanner = null;
  let lastLootUntil = 0;

  // 3. Buildings.
  const buildingMgr = new BuildingManager(world);
  const buildingMenu = new BuildingMenu();

  // 4. Actors.
  const input = new Input(canvas);
  const camera = new Camera({
    viewportWidth: canvas.width, viewportHeight: canvas.height
  });

  // v0.5.1: spawn player in largest forest block (新手区中心).
  const forestCenter = findBiomeCenter(world, 'forest');
  const playerStart = forestCenter.size > 0
    ? { x: forestCenter.x, y: forestCenter.y }
    : { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  const player = new Player({
    world, x: playerStart.x, y: playerStart.y, speed: 5.0
  });
  const hud = new HUD(ctx, input, world, inventory);

  const vitalsState = {
    hp:     { cur: 100, max: 100 },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  // 5. Multiplayer.
  let mp = null;
  const chatLog = [];
  function pushChat(line) {
    chatLog.push({ at: Date.now(), text: line });
    if (chatLog.length > 20) chatLog.shift();
    updateChatDom();
  }
  function updateChatDom() {
    const el = document.getElementById('ww-chat-log');
    if (!el) return;
    el.innerHTML = chatLog.map(c => `<div>${escapeHtml(c.text)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
  if (client && session && (mode === 'host' || mode === 'join')) {
    session.self.name = playerName;
    mp = new Multiplayer({
      mode, client, session,
      player, world, buildingMgr, resources, gather,
      vitals: vitalsState,
      onChat: (m) => {
        const prefix = m.from ? `[${m.from}]` : '[系统]';
        pushChat(`${prefix} ${m.text}`);
      },
      onKicked: (reason) => {
        pushChat(`[系统] 你被踢出房间 (${reason || '未知'})`);
      },
      onPeerJoined: (p) => {
        pushChat(`[系统] ${p.name} 加入了房间`);
      },
      onPeerLeft: (m) => {
        pushChat(`[系统] 玩家离开了 (${m.reason || ''})`);
      },
    });
  }

  // 6. Chat input 绑定(联机时)。
  const chatInput = document.getElementById('ww-chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
          if (mp) {
            mp.broadcastChat(text);
            pushChat(`[${playerName}] ${text}`);
          } else {
            pushChat(`[${playerName}] ${text}`);
          }
          chatInput.value = '';
        }
        e.preventDefault();
      } else if (e.key === 'Escape') {
        chatInput.value = '';
        chatInput.blur();
      }
    });
  }

  // 7. Building placement 状态。
  let pendingBuilding = null;
  function tryPlaceBuilding(tx, ty) {
    if (!pendingBuilding) return false;
    const r = buildingMgr.canPlace(pendingBuilding, tx, ty, player);
    if (!r.ok) {
      pushChat(`[系统] 无法放置:${r.reason}`);
      return false;
    }
    const b = buildingMgr.place(pendingBuilding, tx, ty, player);
    if (mp && mp.mode === 'host') mp.broadcastPlace(b);
    pendingBuilding = null;
    buildingMenu.close();
    return true;
  }

  // 8. v0.5.1: ecology manager.
  const ecologyMgr = new EcologyManager({
    world,
    ecologyData: ecologyData || { biomes: {}, foodChain: {}, _meta: { ticksPerDay: 240 } },
    ecologyMonsters: ecologyMonsters || {},
    loadImage,
    isReady,
    getOrFallback,
    seed: SEED
  });

  // M2.14: combat monsters.
  const monsterMgr = new MonsterManager({
    world,
    monsterData: monstersData || {},
    loadImage,
    isReady,
    getOrFallback
  });

  // Data fetches: monsters + ecology. If fetch fails, both managers
  // stay empty (procedural fallback in the renderer handles empty
  // case — demo boots, just no critters).
  Promise.all([
    fetch('./data/monsters.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./data/ecology.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./data/ecology-monsters.json').then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([mData, eData, emData]) => {
    if (mData) {
      monstersData = mData;
      monsterMgr.monsterData = mData;
      monsterMgr.types = Object.keys(mData).filter(k => !k.startsWith('_'));
      monsterMgr.spawnDefaults();
    }
    if (eData && emData) {
      ecologyData = eData;
      ecologyMonsters = emData;
      ecologyMgr.ecologyData = eData;
      ecologyMgr.ecologyMonsters = emData;
      ecologyMgr.populations = new Map();
      ecologyMgr.entities = [];
      ecologyMgr._chunks = new Map();
      const FoodChain = ecologyMgr.foodChain.constructor;
      ecologyMgr.foodChain = new FoodChain(eData);
      ecologyMgr.initialize();
    }
  });

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    hud.processPanelToggles();

    let panelConsumed = false;
    if (input.consumeClick()) {
      panelConsumed = hud.handlePanelClick(input.mouseX, input.mouseY, canvas.width, canvas.height);
    }

    const menuSelected = buildingMenu.update(input, canvas.width, canvas.height);
    if (menuSelected) {
      const typeId = buildingMenu.consumeSelection();
      if (typeId) {
        pendingBuilding = typeId;
        pushChat(`[系统] 已选择建筑:${getBuilding(typeId)?.name || typeId},移动鼠标 + 左键放置`);
      }
    }

    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible && !buildingMenu.isOpen) {
      player.update(dt, input);
    }
    camera.follow(player);
    gather.update(player, dt);

    // v0.5.1: ecology + M2.14 monster AI tick — only when no panel open.
    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible && !buildingMenu.isOpen) {
      monsterMgr.update(dt, player);
      ecologyMgr.update(dt, player);
    }

    if (mp) mp.tick(now, input);

    if (!panelConsumed && !buildingMenu.isOpen && input.consumeClick()) {
      const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      if (pendingBuilding) {
        tryPlaceBuilding(tx, ty);
      } else {
        gather.click(w.x, w.y);
      }
    }

    if (input.consumeRightClick()) {
      if (pendingBuilding) {
        pendingBuilding = null;
        buildingMenu.close();
        pushChat('[系统] 已取消建筑选择');
      } else {
        const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
        const tx = Math.floor(w.x);
        const ty = Math.floor(w.y);
        const b = buildingMgr.buildings.find(b => b.contains(tx, ty));
        if (b) {
          const id = b.entityId;
          buildingMgr.remove(b);
          if (mp && mp.mode === 'host') mp.broadcastRemove(id);
          pushChat(`[系统] 拆除了 ${b.typeId}`);
        }
      }
    }

    if (hud.craftingPanel.visible && input.consumeRightClick()) {
      hud.craftingPanel.onClick(
        input.mouseX, input.mouseY, canvas.width, canvas.height,
        inventory.selected);
    }

    hud.update();
    input.endFrame();

    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, monsterMgr, ecologyMgr);
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

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

    if (pendingBuilding && !buildingMenu.isOpen) {
      const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      const s = worldToScreen(tx, ty);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const camScreen = worldToScreen(camera.x, camera.y);
      const offsetX = cx - camScreen.x;
      const offsetY = cy - camScreen.y;
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      const can = buildingMgr.canPlace(pendingBuilding, tx, ty, player).ok;
      drawPlacementPreview(ctx, sx, sy, pendingBuilding, can);
    }

    buildingMenu.draw(ctx, canvas.width, canvas.height);

    if ((now | 0) % 60 === 0) saveInventory(inventory);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { world, player, camera, hud, inventory, gather, resources, buildingMgr, mp, mode, ecologyMgr, monsterMgr };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, monsterMgr, ecologyMgr) {
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
        const other = getBiome(CODE_TO_BIOME[otherCode] || 'plains');
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
  for (const b of (buildingMgr?.buildings || [])) {
    if (b.tx < bounds.x0 - 2 || b.tx > bounds.x1 + 2
     || b.ty < bounds.y0 - 2 || b.ty > bounds.y1 + 2) continue;
    drawables.push({ kind: 'building', ref: b, depth: depthKey(b.tx, b.ty) });
  }
  // M2.14: combat monsters.
  if (monsterMgr) {
    for (const m of monsterMgr.visible(camera)) {
      const t = m.tilePos();
      drawables.push({ kind: 'monster', ref: m, depth: depthKey(t.x, t.y) });
    }
  }
  // v0.5.1: ecology entities.
  if (ecologyMgr && ecologyMgr.entities.length > 0) {
    for (const e of ecologyMgr.visible(camera)) {
      const t = e.tilePos();
      drawables.push({ kind: 'ecology', ref: e, depth: depthKey(t.x, t.y) });
    }
  }
  drawables.push({ kind: 'player', depth: depthKey(player.x, player.y), ref: player });
  if (mp && mp.session) {
    for (const p of mp.session.peers.values()) {
      if (!p.state) continue;
      const px = p.state.x, py = p.state.y;
      if (px < bounds.x0 - 1 || px > bounds.x1 + 1
       || py < bounds.y0 - 1 || py > bounds.y1 + 1) continue;
      drawables.push({ kind: 'remote', ref: p, depth: depthKey(px, py) });
    }
  }
  drawables.sort((a, b) => a.depth - b.depth);
  for (const it of drawables) {
    if (it.kind === 'decor') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawDecoration(ctx, s.x + offsetX, s.y + offsetY, it.ref);
    } else if (it.kind === 'resource') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      const progress = (gather.target === it.ref) ? gather.progressFraction() : 0;
      drawResource(ctx, s.x + offsetX, s.y + offsetY, it.ref, progress);
    } else if (it.kind === 'building') {
      const s = worldToScreen(it.ref.tx, it.ref.ty);
      drawBuilding(ctx, s.x + offsetX, s.y + offsetY, it.ref, { showHp: true });
    } else if (it.kind === 'monster') {
      const s = worldToScreen(it.ref.tilePos().x, it.ref.tilePos().y);
      const sprite = monsterMgr.resolveSprite(it.ref);
      drawMonster(ctx, s.x + offsetX, s.y + offsetY, it.ref, sprite);
    } else if (it.kind === 'ecology') {
      const s = worldToScreen(it.ref.tilePos().x, it.ref.tilePos().y);
      const sprite = ecologyMgr.resolveSprite(it.ref);
      drawMonster(ctx, s.x + offsetX, s.y + offsetY, it.ref, sprite);
    } else if (it.kind === 'player') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, it.ref.facing);
      drawNameHp(ctx, s.x + offsetX, s.y + offsetY, mp?.session?.self?.name || '你', vitalsState, true);
    } else if (it.kind === 'remote') {
      const s = worldToScreen(it.ref.state.x, it.ref.state.y);
      const facing = it.ref.state.facing || 'down';
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, facing);
      drawNameHp(ctx, s.x + offsetX, s.y + offsetY, it.ref.name || '?', it.ref.state, false);
    }
  }
}

function drawNameHp(ctx, sx, sy, name, state, self) {
  if (!state) return;
  const label = self ? `${name} (你)` : name;
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(sx - w/2, sy - 32, w, 14);
  ctx.fillStyle = self ? '#d4a64a' : '#88c8ff';
  ctx.fillText(label, sx, sy - 20);
  if (Number.isFinite(state.hp)) {
    const barW = 30, barH = 2;
    const bx = sx - barW/2, by = sy - 17;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx, by, barW, barH);
    const pct = Math.max(0, Math.min(1, state.hp / 100));
    ctx.fillStyle = pct > 0.5 ? '#5ad870' : pct > 0.25 ? '#d4c84a' : '#d45a4a';
    ctx.fillRect(bx, by, barW * pct, barH);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
