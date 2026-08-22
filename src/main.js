/**
 * Main entry — M4 (world) + M2.9 (buildings) + M2.10 (resources) + v0.4 (multiplayer) integration.
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
import { MonsterManager } from './monster/monster-manager.js';
import { BossManager } from './boss/boss-manager.js';
import { BossConfig, validateBossConfig } from './boss/boss-config.js';
import { EventManager } from './events/event-manager.js';
import { EventRegistry } from './events/events.js';
import { BossBar } from './hud/boss-bar.js';
import { EventBanner } from './hud/event-banner.js';
import monstersRaw from './data/monsters.json' with { type: 'json' };

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

/**
 * 主入口。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {'offline'|'host'|'join'} [opts.mode='offline']
 * @param {object} [opts.client]    — 已连接的 RelayClient
 * @param {object} [opts.session]   — 已 setHosted/setJoined 的 Session
 * @param {string} [opts.playerName] — 玩家名(用于世界显示 + chat)
 */
export function bootGame(canvas, opts = {}) {
  const mode = opts.mode || 'offline';
  const client = opts.client || null;
  const session = opts.session || null;
  const playerName = opts.playerName || 'Player';

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. World.
  const world = generateWorld({ width: WORLD_W, height: WORLD_H, seed: SEED });
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
        // 联机:host 广播给其他 peers
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
  const player = new Player({ world, x: 40, y: 30, speed: 5.0 });
  const hud = new HUD(ctx, input, world, inventory);

  // 3b. Monsters + Bosses + Events (v0.5.2) — 必须在 player 之后构造
  const monsterMgr = new MonsterManager({
    world,
    monsterData: monstersRaw,
    seed: SEED + 99
  });
  monsterMgr.spawnDefaults();
  const bossMgr = new BossManager({
    world,
    monsterManager: monsterMgr,
    player,
    inventory,
    onDrop: (itemId, count) => {
      lastLootBanner = `${itemId}×${count}`;
      lastLootUntil = performance.now() + 2200;
    }
  });
  const bossBar = new BossBar(ctx);
  const eventMgr = new EventManager({
    world,
    bossManager: bossMgr,
    monsterManager: monsterMgr,
    now: () => performance.now() / 1000,
    onNotice: (n) => {
      if (n.type === 'start' && n.event) {
        eventBanner.flash(n.event.name || n.event.id, 'start');
      }
    }
  });
  const eventBanner = new EventBanner(ctx);
  let lastEventTrigger = -Infinity;
  let lastBossTrigger  = -Infinity;
  const EVENT_COOLDOWN_S = 8.0;
  const BOSS_COOLDOWN_S  = 12.0;
  // 注入到 module-level helper(供 render 顶层 HUD 调)
  _bossBarDraw = (_dt) => { try { bossBar.draw(bossMgr, canvas.width); } catch (_) { /* swallow */ } };
  _eventBannerDraw = (dt) => { try { eventBanner._pruneFlashes(dt); eventBanner.draw(eventMgr, dt); } catch (_) { /* swallow */ } };
  // 4b. vitals + chat(原 4 / 5 段已合并)
  const vitalsState = {
    hp:     { cur: player.hp, max: player.maxHp },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  // 5. Multiplayer.
  let mp = null;
  const chatLog = [];          // 最近 20 条
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
    // session.self.name 用于广播时附带
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
  let pendingBuilding = null;  // 选中的建筑 id,等待鼠标点击放置
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

  // 8. Frame loop.
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

    // building menu 更新
    const menuSelected = buildingMenu.update(input, canvas.width, canvas.height);
    if (menuSelected) {
      const typeId = buildingMenu.consumeSelection();
      if (typeId) {
        pendingBuilding = typeId;
        pushChat(`[系统] 已选择建筑:${getBuilding(typeId)?.name || typeId},移动鼠标 + 左键放置`);
      }
    }

    // 移动 + 采集(本地)
    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible && !buildingMenu.isOpen) {
      player.update(dt, input);
    }
    camera.follow(player);
    gather.update(player, dt);

    // 联机:tick 驱动 state/input 广播
    if (mp) mp.tick(now, input);

    // 鼠标左键:如果有待放置建筑,放;否则,采集
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

    // 右键:取消待放置 / 拆除
    if (input.consumeRightClick()) {
      if (pendingBuilding) {
        pendingBuilding = null;
        buildingMenu.close();
        pushChat('[系统] 已取消建筑选择');
      } else {
        // 拆除:找光标下的 building
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

    // right-click 配合 building menu 取消
    if (hud.craftingPanel.visible && input.consumeRightClick()) {
      hud.craftingPanel.onClick(
        input.mouseX, input.mouseY, canvas.width, canvas.height,
        inventory.selected);
    }

    // 9. v0.5.2 战斗 / Boss / 事件
    // 9a. 应用活动事件到所有 monster(满月 +atk / +speed)
    if (eventMgr && typeof eventMgr.getMonsterMultiplier === 'function') {
      const mul = eventMgr.getMonsterMultiplier();
      for (const m of (monsterMgr?.monsters || [])) {
        m.effectiveAtk = Math.max(1, Math.round((m.config?.atk || 1) * (mul.atkMul || 1)));
        m.effectiveSpeed = (m.config?.speed || 1) * (mul.speedMul || 1);
      }
    }
    // 9b. tick monsters
    if (monsterMgr) monsterMgr.update(dt, player);
    // 9c. 玩家攻击(空格键) — 找最近 monster/boss 攻击
    if (input.consumePressed(' ')) {
      let closest = null, closestD = Infinity;
      for (const m of (monsterMgr?.monsters || [])) {
        if (m.state === 'DEAD' || m.hp <= 0) continue;
        const d = Math.hypot(m.x - player.x, m.y - player.y);
        if (d < closestD) { closestD = d; closest = m; }
      }
      if (closest && player.attack(closest)) {
        lastLootBanner = `Hit ${closest.typeId || closest.config?.id || 'mob'}`;
        lastLootUntil = performance.now() + 1200;
      }
    }
    // 9d. tick boss
    if (bossMgr) bossMgr.update(now / 1000);
    // 9e. tick events
    if (eventMgr) eventMgr.update(now / 1000);
    // 9f. 死亡后回血(简化)
    if (player.hp <= 0) {
      player.hp = player.maxHp;
      vitalsState.hp.cur = player.maxHp;
      pushChat('[系统] 你倒下了,已被复活 (HP 满)');
    } else {
      vitalsState.hp.cur = player.hp;
    }
    // 9g. 快捷键: B = 召唤季节 Boss(选最近 biomes)
    if (input.consumePressed('b') || input.consumePressed('B')) {
      const nowS = now / 1000;
      if (nowS - lastBossTrigger >= BOSS_COOLDOWN_S) {
        lastBossTrigger = nowS;
        const playerBiome = world.getTile(Math.floor(player.x), Math.floor(player.y));
        const candidates = (typeof BossConfig.forBiome === 'function')
          ? BossConfig.forBiome(playerBiome) : BossConfig.all();
        if (candidates && candidates.length > 0) {
          const b = candidates[0];
          // 找玩家附近的 walkable tile
          const ix = Math.floor(player.x), iy = Math.floor(player.y);
          let tx = ix, ty = iy;
          outer:
          for (let r = 3; r < 20; r += 2) {
            for (let dx = -r; dx <= r; dx += 2) {
              for (let dy = -r; dy <= r; dy += 2) {
                if (world.isWalkable(ix + dx, iy + dy)) {
                  tx = ix + dx; ty = iy + dy;
                  break outer;
                }
              }
            }
          }
          const spawned = bossMgr.spawnBoss(b.id, tx + 0.5, ty + 0.5);
          if (spawned) {
            pushChat(`[系统] 召唤 Boss:${b.name || b.id}`);
          }
        }
      } else {
        pushChat(`[系统] Boss 召唤冷却中 (${Math.ceil(BOSS_COOLDOWN_S - (nowS - lastBossTrigger))}s)`);
      }
    }
    // 9h. 快捷键: L = 触发一个随机事件(满月/陨石雨/地震)
    if (input.consumePressed('l') || input.consumePressed('L')) {
      const nowS = now / 1000;
      if (nowS - lastEventTrigger >= EVENT_COOLDOWN_S) {
        lastEventTrigger = nowS;
        const ids = Object.keys(EventRegistry.all());
        if (ids.length > 0) {
          const idx = Math.floor(Math.random() * ids.length);
          const ok = eventMgr.trigger(ids[idx], nowS);
          if (!ok) pushChat(`[系统] 事件 ${ids[idx]} 触发失败`);
        }
      } else {
        pushChat(`[系统] 事件冷却中 (${Math.ceil(EVENT_COOLDOWN_S - (nowS - lastEventTrigger))}s)`);
      }
    }

    hud.update();
    input.endFrame();

    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, monsterMgr, bossBar, eventBanner);
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    // loot banner
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

    // 放置预览(在 building menu 关闭后,显示一个半透明的 ghost)
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

    // 建造 menu 渲染
    buildingMenu.draw(ctx, canvas.width, canvas.height);

    // periodic save
    if ((now | 0) % 60 === 0) saveInventory(inventory);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { world, player, camera, hud, inventory, gather, resources, buildingMgr, mp, mode };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, monsterMgr, bossBar, eventBanner) {
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
  for (const b of (buildingMgr?.buildings || [])) {
    if (b.tx < bounds.x0 - 2 || b.tx > bounds.x1 + 2
     || b.ty < bounds.y0 - 2 || b.ty > bounds.y1 + 2) continue;
    drawables.push({ kind: 'building', ref: b, depth: depthKey(b.tx, b.ty) });
  }
  // v0.5.2: monsters (含 Boss)
  for (const m of (monsterMgr?.monsters || [])) {
    if (m.x < bounds.x0 - 1 || m.x > bounds.x1 + 1
     || m.y < bounds.y0 - 1 || m.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'monster', ref: m, depth: depthKey(m.x, m.y) });
  }
  // v0.5.2: event POIs (cave_poi, meteor_fall)
  if (eventMgr && Array.isArray(eventMgr.pois)) {
    for (const p of eventMgr.pois) {
      if (!p || p.x == null) continue;
      if (p.x < bounds.x0 - 1 || p.x > bounds.x1 + 1
       || p.y < bounds.y0 - 1 || p.y > bounds.y1 + 1) continue;
      drawables.push({ kind: 'poi', ref: p, depth: depthKey(p.x, p.y) });
    }
  }
  drawables.push({ kind: 'player', depth: depthKey(player.x, player.y), ref: player });
  // 远端玩家(联机):用各自的位置参与深度排序
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
    } else if (it.kind === 'player') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, it.ref.facing);
      // 在本地玩家头上画名字 + HP(简单文字)
      drawNameHp(ctx, s.x + offsetX, s.y + offsetY, mp?.session?.self?.name || '你', vitalsState, /*self*/true);
    } else if (it.kind === 'remote') {
      const s = worldToScreen(it.ref.state.x, it.ref.state.y);
      const facing = it.ref.state.facing || 'down';
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, facing);
      drawNameHp(ctx, s.x + offsetX, s.y + offsetY, it.ref.name || '?', it.ref.state, /*self*/false);
    } else if (it.kind === 'monster') {
      const m = it.ref;
      const s = worldToScreen(m.x, m.y);
      const sx = s.x + offsetX, sy = s.y + offsetY;
      const tint = (m.phase && m.phase.colorTint) || m.config?.colorTint || (m.config?.biome === 'snow' ? '#cfe8ff' : m.config?.biome === 'desert' ? '#d4a04a' : m.config?.biome === 'marsh' ? '#5a8a4a' : m.config?.biome === 'volcano' ? '#d4623a' : '#888');
      const hpPct = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
      const isBoss = !!(m.config && m.config.phases);
      const radius = isBoss ? 22 : 10;
      ctx.save();
      ctx.fillStyle = isBoss ? '#1a0e0e' : '#222';
      ctx.beginPath();
      ctx.arc(sx, sy - radius, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tint;
      ctx.globalAlpha = m.state === 'DEAD' ? 0.4 : 1.0;
      ctx.beginPath();
      ctx.arc(sx, sy - radius, radius - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
      if (isBoss) {
        // Boss 阶段 / 名字
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px ui-monospace';
        ctx.textAlign = 'center';
        ctx.fillText(m.config.name || m.config.id, sx, sy - radius * 2 - 4);
      }
      // HP 迷你条
      const barW = isBoss ? 36 : 20, barH = 3;
      const bx = sx - barW / 2, by = sy - radius * 2 + (isBoss ? -2 : 4);
      ctx.fillStyle = '#000';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#400';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#5ad870' : hpPct > 0.25 ? '#d4c84a' : '#d45a4a';
      ctx.fillRect(bx, by, barW * hpPct, barH);
      ctx.restore();
    } else if (it.kind === 'poi') {
      const p = it.ref;
      const s = worldToScreen(p.x, p.y);
      const sx = s.x + offsetX, sy = s.y + offsetY;
      ctx.save();
      ctx.fillStyle = (p.kind === 'meteor_fall') ? '#ffb84a' : '#88c8ff';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(sx, sy - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (p.kind === 'meteor_fall') {
        ctx.strokeStyle = '#ff6a3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy - 14);
        ctx.lineTo(sx, sy - 6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // v0.5.2: BossBar + EventBanner (顶层 HUD) — 需要 BossManager / EventManager 实例
  // 通过闭包访问(因为 render 是 module 内函数)
  if (typeof _bossBarDraw === 'function') _bossBarDraw(dt);
  if (typeof _eventBannerDraw === 'function') _eventBannerDraw(dt);
}

// 模块级桥:render 是 module 顶层函数,无法直接闭包到 bootGame 内的 bossMgr/eventMgr。
// 用 helper 注入,避免改 render 签名。
let _bossBarDraw = null;
let _eventBannerDraw = null;

function drawNameHp(ctx, sx, sy, name, state, self) {
  if (!state) return;
  const label = self ? `${name} (你)` : name;
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // 背景框
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(sx - w/2, sy - 32, w, 14);
  ctx.fillStyle = self ? '#d4a64a' : '#88c8ff';
  ctx.fillText(label, sx, sy - 20);
  // HP 迷你条
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

const CODE_TO_BIOME = ['forest', 'plains', 'mines', 'snow'];
function biomeCodeToId(c) { return CODE_TO_BIOME[c] || 'plains'; }
