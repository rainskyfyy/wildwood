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
import { isTool, getToolType } from './resources/catalog.js';
import { Inventory } from './resources/inventory.js';
import { Gather } from './resources/gather.js';
import { TOTAL_SLOTS } from './resources/inventory.js';
import { BuildingManager } from './buildings/placer.js';
import { BuildingMenu } from './buildings/building-menu.js';
import { drawBuilding, drawPlacementPreview } from './buildings/building-renderer.js';
import { getBuilding } from './buildings/building-config.js';
import { Multiplayer } from './net/multiplayer.js';
// v0.5.3 农耕与烹饪 — 接入主循环
import { FarmSystem, TILE_STATE } from './farming/farming.js';
import { drawFarmTile } from './farming/tilled-renderer.js';
import { ProcessingManager, ProcessingStation, STATION_PROCESS_TIME } from './processing/processing.js';
import { CookingPot } from './cooking/cooking.js';
import {
  drawCookingPanel, cookingPanelOnClick, cookingPanelRect
} from './cooking/cooking-renderer.js';
import {
  drawProcessingPanel, processingPanelOnClick, processingPanelRect
} from './processing/processing-renderer.js';

// v0.5.3 加工站 — building typeId → processor station 名称
//   - drying_rack / fermenting_barrel → processingMgr(自动启动计时器)
//   - cooking_pot                     → cookingPots(4 槽 multiset,玩家手动 cook)
const PROCESSOR_STATIONS = {
  drying_rack: 'drying_rack',
  fermenting_barrel: 'fermenting_barrel',
  cooking_pot: null  // null = 走 cookingPots,不走 processingMgr
};

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

  // 3.5 v0.5.3 农耕与烹饪 — FarmSystem (每帧 update 推进生长) + ProcessingManager
  //   (晒肉架 / 发酵桶,目前 buildings 不含这俩 typeId,register 由调用方手动做)
  const farmSystem = new FarmSystem({
    world,
    inventory,
    onEvent: (name, payload) => {
      // 在 chat log 里简短反馈(避免对每个 PLANTED 滴都打日志)
      if (name === 'tilled' || name === 'harvested' || name === 'ready') {
        lastFarmingBanner = `${name} @ (${payload.tx},${payload.ty})`;
        lastFarmingUntil = performance.now() + 1600;
      }
    }
  });
  const processingMgr = new ProcessingManager();
  // v0.5.3 烹饪锅 — 每个 cooking_pot 建筑对应一个 CookingPot 实例
  //   (drying_rack / fermenting_barrel 走 processingMgr,不走这里)
  const cookingPots = new Map();
  // v0.5.3 加工站面板状态 — null 表示未打开
  //   entityId 是对应 building 的 entityId,用于在 processingMgr / cookingPots 里查找
  let openCookingPotId    = null;
  let openProcessingId    = null;
  let lastCookingHitMap   = null;  // drawCookingPanel 返回的 hitMap
  let lastProcessingHitMap = null; // drawProcessingPanel 返回的 hitMap
  let lastFarmingBanner = null;
  let lastFarmingUntil = 0;

  // 4. Actors.
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
    // v0.5.3 加工站注册钩子 — 放置完成后按 typeId 自动绑定 station / cooking pot
    if (PROCESSOR_STATIONS[pendingBuilding] != null) {
      const station = PROCESSOR_STATIONS[pendingBuilding];
      processingMgr.register(b.entityId, new ProcessingStation({
        station, entityId: b.entityId
      }));
      pushChat(`[系统] 已注册加工站 ${getBuilding(pendingBuilding)?.name} #${b.entityId}`);
    } else if (pendingBuilding === 'cooking_pot') {
      cookingPots.set(b.entityId, new CookingPot({
        inventory,
        onEvent: (name, payload) => {
          if (name === 'cooked' || name === 'unlocked') {
            const tag = name === 'unlocked' ? '新食谱解锁' : '烹饪完成';
            const item = name === 'unlocked'
              ? payload.recipeId
              : `${payload.output.itemId}×${payload.output.count}`;
            lastFarmingBanner = `${tag}: ${item}`;
            lastFarmingUntil = performance.now() + 1800;
          }
        }
      }));
      pushChat(`[系统] 已注册烹饪锅 #${b.entityId}(4 槽 multiset)`);
    }
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

    // v0.5.3 加工站面板:ESC 关闭(优先于 inventory/crafting 面板,避免 race)
    if (input.consumePressed('escape')
        && (openCookingPotId != null || openProcessingId != null)) {
      openCookingPotId = null;
      openProcessingId = null;
      pushChat('[系统] 已关闭加工站面板');
    }

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
    // v0.5.3 农耕:每帧推进作物生长(dry 状态除外)
    farmSystem.update(dt);
    // v0.5.3 加工:每帧推进 processing station 状态
    processingMgr.tickAll(now);

    // 联机:tick 驱动 state/input 广播
    if (mp) mp.tick(now, input);

    // v0.5.3 农耕按键 — T 触发 useToolAt(光标位置)
    //   - 装备 hoe → 犁地
    //   - 装备 seed/fertilizer → 播种/施肥
    //   - 装备 watering_can → 浇水
    //   - 手空 → 收获(READY 状态)
    //   距离限制 2 tile(同 building placement)
    if (input.consumePressed('t')
        && !hud.inventoryPanel.visible
        && !hud.craftingPanel.visible
        && !buildingMenu.isOpen
        && !openCookingPotId && !openProcessingId) {
      const fw = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      const ftx = Math.floor(fw.x), fty = Math.floor(fw.y);
      const dx = Math.abs(ftx - Math.floor(player.x));
      const dy = Math.abs(fty - Math.floor(player.y));
      if (dx > 2 || dy > 2) {
        pushChat('[系统] 距离太远,走到 tile 附近再 T 农耕');
      } else {
        const sel = inventory.slots[inventory.selected];
        const toolId = sel && isTool(sel.itemId) ? sel.itemId : null;
        const heldItemId = sel ? sel.itemId : null;
        const r = farmSystem.useToolAt(ftx, fty, toolId, heldItemId);
        if (!r.ok && r.reason) {
          pushChat(`[系统] 农耕:${r.reason}${r.detail ? ' (' + r.detail + ')' : ''}`);
        }
      }
    }

    // v0.5.3 加工站面板 — 鼠标左键处理(放在 gather 之前)
    //   优先级:panel 内部点击 > 点击 cooking/processing 建筑打开面板 > 普通采集/放置
    if (!panelConsumed && !buildingMenu.isOpen && input.consumeClick()) {
      const cw = input.mouseX, cy = input.mouseY;
      // 1. 烹饪锅面板已打开 → 路由到面板
      if (openCookingPotId != null) {
        const pot = cookingPots.get(openCookingPotId);
        if (pot) {
          const r = cookingPanelOnClick(cw, cy, lastCookingHitMap, pot, inventory, inventory.selected);
          if (r === 'cooked' || r === 'slot_added' || r === 'slot_removed') {
            // 成功反馈 — banner 已在 cook 事件里
          } else if (r === 'slot_noop' || r === null) {
            // 点空地不动
          }
        }
      }
      // 2. 加工站面板已打开 → 路由到面板
      else if (openProcessingId != null) {
        const st = processingMgr.get(openProcessingId);
        if (st) {
          const r = processingPanelOnClick(cw, cy, lastProcessingHitMap, st, inventory, inventory.selected);
          if (r && r.action === 'put' && r.recipe) {
            pushChat(`[系统] 加工开始:${r.itemId} → ${r.recipe.output.itemId}`);
          } else if (r && r.action === 'no_recipe') {
            pushChat(`[系统] ${st.station} 不接受 ${r.itemId}`);
          } else if (r && r.action === 'take') {
            pushChat(`[系统] 取出 ${r.itemId} × ${r.count}`);
          }
        }
      }
      // 3. 没面板 → 检查是否点中 cooking_pot / drying_rack / fermenting_barrel 建筑
      else {
        const w = screenToWorld(cw, cy, canvas, player, camera);
        const tx = Math.floor(w.x), ty = Math.floor(w.y);
        const b = buildingMgr.buildings.find(b => b.contains(tx, ty));
        if (b && b.typeId === 'cooking_pot' && cookingPots.has(b.entityId)) {
          openCookingPotId = b.entityId;
          pushChat(`[系统] 打开烹饪锅 #${b.entityId}(C / ESC 关闭)`);
        } else if (b && (b.typeId === 'drying_rack' || b.typeId === 'fermenting_barrel')
                   && processingMgr.get(b.entityId)) {
          openProcessingId = b.entityId;
          pushChat(`[系统] 打开${b.typeId === 'drying_rack' ? '晒肉架' : '发酵桶'} #${b.entityId}`);
        } else if (pendingBuilding) {
          tryPlaceBuilding(tx, ty);
        } else {
          gather.click(w.x, w.y);
        }
      }
    }

    // 右键:取消待放置 / 拆除 / 关闭面板 / 农耕取消
    if (input.consumeRightClick()) {
      if (openCookingPotId != null || openProcessingId != null) {
        openCookingPotId = null;
        openProcessingId = null;
        pushChat('[系统] 已关闭加工站面板');
      } else if (pendingBuilding) {
        pendingBuilding = null;
        buildingMenu.close();
        pushChat('[系统] 已取消建筑选择');
      } else {
        // 优先处理:建筑拆除 > 农耕 tile
        const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
        const tx = Math.floor(w.x);
        const ty = Math.floor(w.y);
        const b = buildingMgr.buildings.find(b => b.contains(tx, ty));
        if (b) {
          const id = b.entityId;
          // v0.5.3 加工站拆除:从 processingMgr / cookingPots 反注册
          if (processingMgr.get(id)) processingMgr.unregister(id);
          if (cookingPots.has(id)) cookingPots.delete(id);
          // 关掉可能打开的面板
          if (openCookingPotId === id) openCookingPotId = null;
          if (openProcessingId === id) openProcessingId = null;
          buildingMgr.remove(b);
          if (mp && mp.mode === 'host') mp.broadcastRemove(id);
          pushChat(`[系统] 拆除了 ${b.typeId}`);
        } else {
          // 农耕右击(取消 TILLED / 拔除 PLANTED / 收获 READY)
          const r = farmSystem.rightClick(tx, ty);
          if (r.ok) {
            const tag = { cancelled: '已取消犁地', removed: '已拔除作物', harvested: `收获 ${r.itemId}×${r.count}` };
            pushChat(`[系统] 农耕:${tag[r.action] || r.action}`);
          }
        }
      }
    }

    // right-click 配合 building menu 取消
    if (hud.craftingPanel.visible && input.consumeRightClick()) {
      hud.craftingPanel.onClick(
        input.mouseX, input.mouseY, canvas.width, canvas.height,
        inventory.selected);
    }

    hud.update();
    input.endFrame();

    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, farmSystem, processingMgr);
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    // v0.5.3 加工站面板:覆盖在 HUD 之上,缓存 hitMap 给下一帧点击用
    if (openCookingPotId != null) {
      const pot = cookingPots.get(openCookingPotId);
      if (pot) {
        const preview = pot.preview({ avgFreshness: 1.0 });
        const mouse = { x: input.mouseX, y: input.mouseY };
        lastCookingHitMap = drawCookingPanel(ctx, pot, preview, mouse, canvas.width, canvas.height);
      } else {
        openCookingPotId = null;  // 建筑被拆除,自动关闭
      }
    } else {
      lastCookingHitMap = null;
    }
    if (openProcessingId != null) {
      const st = processingMgr.get(openProcessingId);
      if (st) {
        const mouse = { x: input.mouseX, y: input.mouseY };
        lastProcessingHitMap = drawProcessingPanel(ctx, st, mouse, canvas.width, canvas.height);
      } else {
        openProcessingId = null;  // 建筑被拆除,自动关闭
      }
    } else {
      lastProcessingHitMap = null;
    }

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

    // v0.5.3 农耕 banner (右上角,小字)
    if (lastFarmingBanner && now < lastFarmingUntil) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(canvas.width - 200, 12, 188, 22);
      ctx.fillStyle = '#a8d462';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`farm: ${lastFarmingBanner}`, canvas.width - 16, 23);
      ctx.textAlign = 'left';
    } else {
      lastFarmingBanner = null;
    }

    // v0.5.3 加工:画每个 station 的状态文字(在对应 building 位置)
    if (processingMgr.stations.size > 0) {
      for (const station of processingMgr.stations.values()) {
        const b = buildingMgr.buildings.find(b => b.entityId === station.entityId);
        if (!b) continue;
        const s = worldToScreen(b.tx, b.ty);
        const sx = s.x + offsetX;
        const sy = s.y + offsetY;
        let txt = '';
        if (station.state === 'empty') txt = '';
        else if (station.state === 'processing') {
          const elapsed = Math.max(0, (now - station.startedAt) / 1000);
          const pct = Math.min(1, elapsed / station.durationSec);
          txt = `${station.inputItemId} ${(pct * 100) | 0}%`;
        } else if (station.state === 'ready') txt = `READY → ${station.outputRecipe?.output?.itemId || '?'}`;
        if (txt) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(sx - 36, sy - TILE_H_HALF - 14, 72, 14);
          ctx.fillStyle = station.state === 'ready' ? '#f0c450' : '#88c8ff';
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, sx, sy - TILE_H_HALF - 7);
          ctx.textAlign = 'left';
        }
      }
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
  return { world, player, camera, hud, inventory, gather, resources, buildingMgr, mp, mode, farmSystem, processingMgr, cookingPots };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function render(ctx, canvas, world, decor, transitions, resources, player, camera, gather, buildingMgr, pendingBuilding, mp, vitalsState, farmSystem, processingMgr) {
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
  // v0.5.3 农耕:已耕作的 tile 也参与深度排序(在 resource 之后,building 之前)
  for (const f of farmSystem.tilesInBounds(bounds.x0 - 1, bounds.y0 - 1, bounds.x1 + 1, bounds.y1 + 1)) {
    drawables.push({ kind: 'farm', ref: f, depth: depthKey(f.tx, f.ty) });
  }
  for (const b of (buildingMgr?.buildings || [])) {
    if (b.tx < bounds.x0 - 2 || b.tx > bounds.x1 + 2
     || b.ty < bounds.y0 - 2 || b.ty > bounds.y1 + 2) continue;
    drawables.push({ kind: 'building', ref: b, depth: depthKey(b.tx, b.ty) });
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
    } else if (it.kind === 'farm') {
      // v0.5.3 农耕:已耕作 tile(tilled / planted / ready)
      const s = worldToScreen(it.ref.tx, it.ref.ty);
      drawFarmTile(ctx, s.x + offsetX, s.y + offsetY, it.ref);
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
    }
  }
}

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
