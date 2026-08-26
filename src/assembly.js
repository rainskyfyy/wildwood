/**
 * assembly.js — v0.6.0a (extended v0.8.0a, v0.8.2a)
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
 * v0.8.0a — pass-through 冻结:
 *   所有指向 Manager / Service / UI 实例的字段在装配完成后立即
 *   Object.freeze,堵住"换引用"型状态泄漏口。Service 入口仍是
 *   mutation 唯一通路;UI 只读访问走 pass-through 不受影响。
 *
 * v0.8.2a — tickState 桥接边界:
 *   新增 TickStateService(svc 写,单 mutation 入口)与 TickStateView
 *   (pass-through 读,只读 view),挂到 game.tickStateSvc / game.tickStateView
 *   并纳入 v0.8.0a 冻结列表。UI 改 tickRate / paused 必须经 svc,读必须
 *   走 view。换引用 / 直接 mutate view 都被抛错拦截。
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
import { Minimap } from './hud/minimap.js';
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
import { InventoryService } from './services/InventoryService.js';
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
import { freezePassThroughs } from './util/freeze-passthrough.js';
import { createTickStateService } from './services/TickStateService.js';
import { createTickStateView } from './ui/sync/tickStateView.js';

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

  // v0.8.18-P0: InventoryService 是 mutation 唯一入口(gather.js v0.6.0b 起期望 invSvc)。
  // 装配层此前漏实例化 InventoryService,把裸 inventory 当 invSvc 传给 Gather,
  // resource-entity.harvest 拿到 undefined 即 TypeError 崩溃。
  const invSvc = new InventoryService({ inventory });

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
    invSvc,
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
  // v0.8.18-P1-11:双 HUD 收敛 — DOM 版(src/ui/hud.js,经 window.__hudBus
  // 'engine:frame' 驱动三围/时间/快捷栏;src/ui/screens/screens.js 键盘路由
  // i/c/m/q 四屏)是唯一权威 HUD。canvas 版 src/hud/hud.js 已 @deprecated
  // 冻结,装配段不再构造它 — 旧写法 new HUD(ctx,...) 还会把 ctx 错当
  // containerEl 传给 M2.12 DOM 版 Minimap(它要 .Anchor-BR 容器),浏览器
  // 启动即 TypeError、小地图从不渲染。
  // 这里保留 Minimap(M2.12 DOM 版,画在 .Anchor-BR .MinimapCanvas 上)作为
  // 引擎侧唯一每帧绘制的 HUD 部件;并用轻量 hud 适配对象保住 runtime.js 的
  // game.hud 契约(processPanelToggles / handlePanelClick / inventoryPanel.
  // visible / craftingPanel.visible / update / draw / setAudio)。
  // resolveMinimapContainer 防御性判空:测试/无头环境 querySelector 返回
  // 非 canvas mock 时不构造,Minimap 内部全 null → draw() 早退,不抛错。
  function resolveMinimapContainer() {
    try {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
      const c = document.querySelector('.Anchor-BR');
      if (!c || typeof c.querySelector !== 'function') return null;
      const mm = c.querySelector('.Minimap');
      const cv = mm && mm.querySelector('.MinimapCanvas');
      if (!cv || typeof cv.getContext !== 'function') return null;
      return c;
    } catch (_) { return null; }
  }
  const minimap = new Minimap(resolveMinimapContainer(), { x: 0, y: 0, w: 160, h: 120 });
  const hud = {
    minimap,
    // 面板归 DOM screens(i/c/m/q 由 screens.js keydown 路由);canvas 面板
    // 已废弃,visible 恒 false — 运动门控不误伤,旧字段读法不炸。
    inventoryPanel: { visible: false },
    craftingPanel: { visible: false, onClick() { return false; } },
    processPanelToggles() {},
    handlePanelClick() { return false; },
    update() {},
    setAudio() {},
    draw(cw, ch, _vitals, worldRef, cameraRef) {
      minimap.x = cw - 160 - 12;
      minimap.y = 12;
      minimap.draw(worldRef, cameraRef);
    },
  };

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

  // v0.8.2a:tickState 桥接边界 — svc 写 + pass-through 读
  // 装配层创建唯一 svc 实例,挂在 game.tickStateSvc(被 freeze 锁引用)
  // UI 视图挂在 game.tickStateView(只读,UI 组件 / 数据可视化唯一入口)
  const tickStateSvc = createTickStateService({ defaultMs: 200, minMs: 16 });
  const tickStateView = createTickStateView(tickStateSvc);
  // 委托给 window.__tickState(向后兼容 v0.6.4a 起的 IIFE 入口);
  // 装配前 IIFE 已有占位 svc,绑定时把占位订阅者迁移到真实 svc,再启动
  if (typeof window !== 'undefined' && window.__tickState && typeof window.__tickState.__bindService === 'function') {
    window.__tickState.__bindService(tickStateSvc, { migrateSubscribers: true, restart: false });
  }
  tickStateSvc.start();

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

  // v0.8.0 P0-1:UI 数据通道 — 引擎帧尾通知 UI 层,避免 UI 自己跑
  // tick 和引擎漂移。runtime.js 在 frame() 末尾调用 game.notifyUI(
  // game, dt, now);默认实现桥接两路出口:
  //   - window.__hudBus.emit('engine:frame', { now, dt, game }):向后兼容
  //     v0.6.x IIFE 总线(已有 cooking/npc 模块订阅,不要破坏)
  //   - window.__wildwood.uiSubscribers:注册式 API,新 UI 组件
  //     `window.__wildwood.onFrame(cb)` 即可订阅,可返回 unsubscribe
  // notifyUI 不放进 v0.8.0a 冻结列表 — 它是引擎→UI 回调入口,
  // 后续可以由 UI 端自己替换(测试用 mock 注入)。
  function defaultNotifyUI(game, dt, now) {
    if (typeof window === 'undefined') return;
    try {
      if (window.__hudBus && typeof window.__hudBus.emit === 'function') {
        window.__hudBus.emit('engine:frame', { now, dt, game });
      }
    } catch (_) { /* swallow UI bus errors */ }
    try {
      const subs = window.__wildwood && window.__wildwood.uiSubscribers;
      if (Array.isArray(subs)) {
        for (let i = 0; i < subs.length; i++) {
          try { subs[i](game, dt, now); } catch (_) { /* per-subscriber */ }
        }
      }
    } catch (_) { /* swallow window errors */ }
  }

  const game = {
    // 顶层对象(由 setup 创建)
    ctx, canvas, mode, playerName, client, session,
    world, decor, village, transitions, resources,
    inventory, gather, buildingMgr, buildingMenu,
    input, camera, player, hud,
    monsterMgr, bossMgr, bossBar, eventMgr, eventBanner,
    dayCycle, npcMgr, tradeState, tradeUI, followerMgr,
    vitalsState,
    // v0.8.2a:tickState 桥接边界(svc 写 + pass-through 读)
    tickStateSvc, tickStateView,
    // 闭包状态集中
    runtime,
    // 工具方法(原 bootGame 内的闭包,挂到 game 上供 runtime 调用)
    pushChat,
    tryPlaceBuilding, tryFeed, tryRecruit, tryToggleTrade,
    // 渲染常量(runtime 内 render() 用)
    TILE_W_HALF, TILE_H_HALF, TILE_SIZE,
    // cooldown 常量(runtime 内快捷键逻辑用)
    EVENT_COOLDOWN_S, BOSS_COOLDOWN_S,
    // v0.8.0 P0-1:引擎→UI 帧尾通知(非 pass-through,UI 端可替换)
    notifyUI: defaultNotifyUI,
  };

  // 顶层 HUD:BossBar / EventBanner draw 注册到模块钩子(供 render 调)
  setBossBarDraw(() => { try { bossBar.draw(bossMgr, canvas.width); } catch (_) { /* swallow */ } });
  setEventBannerDraw((dt) => { try { eventBanner._pruneFlashes(dt); eventBanner.draw(eventMgr, dt); } catch (_) { /* swallow */ } });

  // v0.8.0a:freeze 装配层 pass-through 字段,堵住"换引用"泄漏口。
  // 这些字段指向 Manager / Service / UI 实例,只读访问没问题;
  // 但任何 `game.X = newX` 都会抛 TypeError,迫使 mutation 走 Service。
  // runtime 闭包状态(`runtime` 对象本身)与画布等顶层对象不放进列表,
  // 那些是合法 mutable state。
  // v0.8.2a 扩展:把 tickStateSvc / tickStateView 也纳入冻结;UI 改
  // tickRate / paused 必须经 tickStateSvc(单 mutation 入口),读必须
  // 走 tickStateView(pass-through 只读 view)。换引用会被 v0.8.0a 字段
  // 级 freeze 抛 TypeError 拦截。
  freezePassThroughs(game, [
    // 状态拥有者(v0.6.0b / v0.7.0a Service 拆分)
    'inventory', 'eventMgr', 'buildingMgr', 'monsterMgr',
    // UI 组件 / 输入
    'gather', 'buildingMenu', 'hud', 'input', 'camera', 'player',
    'bossMgr', 'bossBar', 'eventBanner',
    // v0.5.4 NPC 村庄 + 交易 + 随从
    'dayCycle', 'npcMgr', 'tradeState', 'tradeUI', 'followerMgr',
    'vitalsState',
    // v0.8.2a:tickState 桥接边界(svc 写 + view 读)
    'tickStateSvc', 'tickStateView',
    // 世界 / 装饰 / 资源(只读 reference,装配完成后不应被换)
    'world', 'decor', 'village', 'transitions', 'resources',
    // 顶层上下文(装配完成,不应被换)
    'ctx', 'canvas',
  ]);

  // v0.8.0 P0-1:把 game 暴露到 window,让 demo UI 能从真实引擎读状态。
  // 字段集(vitalsState / inventory.slots+selected / npcMgr.piglins /
  // dayCycle.describe() / player)都已经作为 pass-through 字段挂在
  // game 上,UI 通过 window.__game 即可访问。
  //   window.__hudBus / window.__tickState 保留向后兼容。
  // 桥接后 UI 数据源:window.__game(真实引擎)而非 mock。
  if (typeof window !== 'undefined') {
    window.__game = game;
    window.__wildwood = Object.assign(window.__wildwood || {}, { game });
  }

  return game;
}

// saveInventory 暴露给 runtime 用(periodic save)
export { saveInventory };
