/**
 * assembly.js — v0.6.0a
 *
 * 把原 main.js 的「装配层」独立出来:所有 import + 常量 + 子系统实例化。
 * 返回一个 `game` 对象(包含 ctx / world / 各种 manager / 闭包状态),
 * 供 runtime.js 启动游戏循环使用。
 *
 * 拆分动机:让「装配」与「运行」解耦,集成新子任务时改动只落在 assembly.js
 * 末段「追加段」,不动 runtime.js;反过来调优帧循环 / 渲染时不动装配。
 * 多 agent 并行推不同子任务时,冲突面从 main.js 一整块缩到 assembly.js
 * 末段「追加段」,缓解集成炸弹。
 *
 * 集成规范:
 *  - 不引入新依赖,不改变外部行为
 *  - 保持 bootGame(canvas, opts) 签名在 main.js 暴露,这里只导出 assembleGame
 *  - runtime.js 依赖此模块导出的 assembleGame,反方向不依赖
 */
'use strict';

import { generateWorld } from './world/generator.js';
import { scatterDecorationsAndVillage } from './world/decorator.js';
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
import { DayCycle } from './utils/day-cycle.js';
import { getItem } from './resources/catalog.js';
import { NPCManager, buildingAt, traderBuilding, PiglinState } from './npc/npc-manager.js';
import { newTradeState, traderStock } from './trading/price-engine.js';
import { TradeUI } from './trading/trade-ui.js';
import { FollowerManager } from './follower/follower-manager.js';
import { drawPiglin, drawFollower, drawBuilding as drawVillageBuilding } from './render/npc-renderer.js';
import { escapeHtml } from './util/escape-html.js';
import { setBossBarDraw, setEventBannerDraw } from './util/render-hooks.js';

// ---------- 常量 ----------
const DAY_START_T = 4 * 60; // 4:00 of the 24h clock — sunrise-ish
const WORLD_W = 80;
const WORLD_H = 60;
const SEED    = 20260822;
const INV_KEY = 'wildwood.m210.inventory.v1';

const EVENT_COOLDOWN_S = 8.0;
const BOSS_COOLDOWN_S  = 12.0;

// ---------- 持久化 helpers ----------
function loadInventory() {
  try {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const inv = new Inventory();
    if (Array.isArray(data.slots)) {
      for (let i = 0; i < Math.min(TOTAL_SLOTS, data.slots.length); i++) {
        inv.slots[i] = data.slots[i];
      }
    }
    if (typeof data.selected === 'number') inv.selected = data.selected;
    return inv;
  } catch (e) {
    return null;
  }
}
function saveInventory(inv) {
  try {
    const data = { slots: inv.slots, selected: inv.selected };
    localStorage.setItem(INV_KEY, JSON.stringify(data));
  } catch (e) {
    /* swallow quota errors */
  }
}

/**
 * assembleGame — 构造整个游戏世界与所有子系统,返回 game 对象。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object}  [opts]
 * @param {'offline'|'host'|'join'} [opts.mode]
 * @param {RelayClient} [opts.client]
 * @param {Session}    [opts.session]
 * @param {string}     [opts.playerName]
 * @returns {Object} game — runtime.js 启动帧循环所需的所有状态
 */
export function assembleGame(canvas, opts = {}) {
  const mode = opts.mode || 'offline';
  const client = opts.client || null;
  const session = opts.session || null;
  const playerName = opts.playerName || 'Player';

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. World.
  const world = generateWorld({ width: WORLD_W, height: WORLD_H, seed: SEED });
  // v0.5.4: also returns a `village` object (piglins + buildings + origin)
  const { decor, village } = scatterDecorationsAndVillage(world, { density: 0.06, seed: SEED + 7 });
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

  // 闭包状态:在 game 对象上集中,避免散落在 bootGame 体内
  const runtime = {
    mp: null,
    chatLog: [],
    lastLootBanner: null,
    lastLootUntil: 0,
    lastEventTrigger: -Infinity,
    lastBossTrigger:  -Infinity,
    pendingBuilding: null,
  };

  function pushChat(line) {
    runtime.chatLog.push({ at: Date.now(), text: line });
    if (runtime.chatLog.length > 20) runtime.chatLog.shift();
    updateChatDom();
  }
  function updateChatDom() {
    const el = document.getElementById('ww-chat-log');
    if (!el) return;
    el.innerHTML = runtime.chatLog.map(c => `<div>${escapeHtml(c.text)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  const gather = new Gather({
    entities: resources,
    inventory,
    onEvent: (name, payload) => {
      if (name === 'complete') {
        const lootStr = (payload.loot || []).map(l => `${l.itemId}×${l.count}`).join(' ');
        runtime.lastLootBanner = lootStr || '已采集';
        runtime.lastLootUntil = performance.now() + 2200;
        // 联机:host 广播给其他 peers
        if (runtime.mp && runtime.mp.mode === 'host' && payload.entity) {
          runtime.mp.broadcastGather(payload.entity.id, payload.loot, payload.regrowAt || 0);
        }
      }
    }
  });

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
      runtime.lastLootBanner = `${itemId}×${count}`;
      runtime.lastLootUntil = performance.now() + 2200;
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

  // 3c. v0.5.4: day/night + NPC village + trading post + follower.
  const dayCycle = new DayCycle({ t0: DAY_START_T });
  const npcMgr = new NPCManager({ world, seed: SEED + 91 });
  if (village && village.piglins && village.piglins.length) {
    // 复用 decorator 跑出来的村庄(避免双重 generateVillage)
    npcMgr.piglins = village.piglins;
    npcMgr.buildings = village.buildings;
    npcMgr.villageOrigin = village.origin;
  } else {
    // fallback: 自己跑一次
    npcMgr.spawnVillage({ preferredBiome: 'forest' });
  }
  // 把村庄建筑的 footprint 标为不可走,供 A* pathfinder 使用。
  // 只对 follower / piglin AI 生效(玩家碰撞仍由建筑系统处理)。
  const blockedTiles = new Set();
  for (const b of npcMgr.buildings) {
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        blockedTiles.add((b.y + dy) * 4096 + (b.x + dx));
      }
    }
  }
  const baseIsWalkable = world.isWalkable.bind(world);
  world.isWalkable = function (x, y) {
    if (blockedTiles.has(y * 4096 + x)) return false;
    return baseIsWalkable(x, y);
  };
  const tradeState = newTradeState();
  // 预填 scarcity 快照,让首次报价反映玩家当前库存
  for (const id of traderStock()) {
    tradeState.scarcity[id] = inventory.countOf(id);
  }
  const tradeUI = new TradeUI({
    inventory,
    state: tradeState,
    onTrade: (r) => {
      if (r && r.ok) {
        const buyMeta = getItem(r.buyItem);
        pushChat(`[系统] 交易成功:${getItem(r.sellItem).name}×${r.sellCount} → ${buyMeta.name}×${r.buyCount} (×${r.multiplier.toFixed(2)})`);
      } else if (r && r.reason) {
        pushChat(`[系统] 交易失败:${r.reason}`);
      }
    }
  });
  const followerMgr = new FollowerManager({
    world,
    player,
    getMonsters: () => (monsterMgr ? monsterMgr.monsters : [])
  });

  // 4b. vitals + chat
  const vitalsState = {
    hp:     { cur: player.hp, max: player.maxHp },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  // 5. Multiplayer(必须放 pushChat 之后,因 onChat 用到)。
  if (client && session && (mode === 'host' || mode === 'join')) {
    session.self.name = playerName;
    runtime.mp = new Multiplayer({
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
          if (runtime.mp) {
            runtime.mp.broadcastChat(text);
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

  // 7. Building placement helpers(挂到 game 上,runtime 用)
  function tryPlaceBuilding(tx, ty) {
    if (!runtime.pendingBuilding) return false;
    const r = buildingMgr.canPlace(runtime.pendingBuilding, tx, ty, player);
    if (!r.ok) {
      pushChat(`[系统] 无法放置:${r.reason}`);
      return false;
    }
    const b = buildingMgr.place(runtime.pendingBuilding, tx, ty, player);
    if (runtime.mp && runtime.mp.mode === 'host') runtime.mp.broadcastPlace(b);
    runtime.pendingBuilding = null;
    buildingMenu.close();
    return true;
  }

  // 7b. v0.5.4 helpers: feed / recruit / open-trade / dismiss.
  function playerTile() {
    return { x: Math.floor(player.x), y: Math.floor(player.y) };
  }
  function isAdjacent(a, b) {
    return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  }
  function nearestPiglinForInteraction(maxDist = 2) {
    const pt = playerTile();
    let best = null, bestDist = Infinity;
    for (const p of npcMgr.piglins) {
      if (p.state === PiglinState.DEAD) continue;
      const px = Math.floor(p.x), py = Math.floor(p.y);
      const d = Math.abs(px - pt.x) + Math.abs(py - pt.y);
      if (d <= maxDist && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }
  function tryFeed() {
    const p = nearestPiglinForInteraction(2);
    if (!p) {
      pushChat('[系统] 附近没有猪人可喂食(E 键)');
      return;
    }
    let itemId = null;
    if (typeof inventory.selected === 'number' && inventory.slots[inventory.selected]) {
      const s = inventory.slots[inventory.selected];
      if (s && getItem(s.itemId).category === 'food') itemId = s.itemId;
    }
    if (!itemId) {
      for (const s of inventory.slots) {
        if (s && getItem(s.itemId).category === 'food') { itemId = s.itemId; break; }
      }
    }
    if (!itemId) {
      pushChat('[系统] 背包里没有食物');
      return;
    }
    if (p.feed(itemId)) {
      for (let i = 0; i < inventory.slots.length; i++) {
        const s = inventory.slots[i];
        if (s && s.itemId === itemId) { inventory.remove(i, 1); break; }
      }
      pushChat(`[系统] 猪人收到 ${getItem(itemId).name},好感 +1(目前 ${p.affection}/3)`);
    } else if (p.affection >= 3) {
      pushChat('[系统] 这只猪人已经吃饱了(好感已满,按 F 招募)');
    } else {
      pushChat('[系统] 猪人不想吃这个');
    }
  }
  function tryRecruit() {
    if (followerMgr.current()) {
      pushChat('[系统] 解散当前随从');
      followerMgr.dismiss();
      return;
    }
    const p = nearestPiglinForInteraction(2);
    if (!p) {
      pushChat('[系统] 附近没有猪人可招募');
      return;
    }
    if (!p.isRecruitable()) {
      pushChat(`[系统] 好感度不足:需要 3 颗心,当前 ${p.affection}/3`);
      return;
    }
    const f = followerMgr.recruit(p);
    if (f) {
      pushChat('[系统] 猪人加入了你的队伍!跟随战斗');
    } else {
      pushChat('[系统] 招募失败');
    }
  }
  function tryToggleTrade() {
    if (tradeUI.isOpen()) {
      tradeUI.close();
      return;
    }
    const trader = traderBuilding(npcMgr.buildings);
    if (!trader) {
      pushChat('[系统] 附近没有猪人交易站');
      return;
    }
    const center = { x: trader.x + trader.w / 2, y: trader.y + trader.h / 2 };
    const pt = playerTile();
    if (!isAdjacent(pt, center)) {
      pushChat('[系统] 走近交易中心再按 T 键交易');
      return;
    }
    tradeUI.open();
  }

  // ---------- 装配完成,统一返回 game 对象 ----------
  const game = {
    // 顶层对象(由 setup 创建)
    ctx, canvas, mode, playerName, client, session,
    world, decor, village, transitions, resources,
    inventory, gather, buildingMgr, buildingMenu,
    input, camera, player, hud,
    monsterMgr, bossMgr, bossBar, eventMgr, eventBanner,
    dayCycle, npcMgr, tradeState, tradeUI, followerMgr,
    vitalsState,
    // 闭包状态集中
    runtime,
    // 工具方法(原 bootGame 内的闭包,挂到 game 上供 runtime 调用)
    pushChat,
    tryPlaceBuilding, tryFeed, tryRecruit, tryToggleTrade,
    // 渲染常量(runtime 内 render() 用)
    TILE_W_HALF, TILE_H_HALF, TILE_SIZE,
    // cooldown 常量(runtime 内快捷键逻辑用)
    EVENT_COOLDOWN_S, BOSS_COOLDOWN_S,
  };

  // 顶层 HUD:BossBar / EventBanner draw 注册到模块钩子(供 render 调)
  setBossBarDraw(() => { try { bossBar.draw(bossMgr, canvas.width); } catch (_) { /* swallow */ } });
  setEventBannerDraw((dt) => { try { eventBanner._pruneFlashes(dt); eventBanner.draw(eventMgr, dt); } catch (_) { /* swallow */ } });

  return game;
}

// saveInventory 暴露给 runtime 用(periodic save)
export { saveInventory };
