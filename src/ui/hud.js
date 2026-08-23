/**
 * Wildwood UI · HUD 顶层状态机 (M2.12 + v0.8.3a)
 *
 * 职责:
 *   1. 在 demo.html 顶层建立 EventTarget 抽象层(window.__hudBus)
 *      M4 引擎 / M2.11 图鉴系统 / 任何屏都通过它推/订阅状态
 *   2. 5Hz 渲染节流:每 200ms 把引擎 vitalsState 推到 DOM。
 *      **数据源是引擎**(subscribe 'engine:frame'),不再本地 mock 衰减。
 *   3. 4 队伍槽 mock 数据:写入玩家名 + 队伍色
 *   4. 点击快捷栏切换 active(替代 demo.html 里的内联 JS)
 *
 * 与 M4 引擎的关系(v0.8.3a 起):
 *   - 之前 v0.6.4a 设计:UI 自己 5Hz tick 推进三围衰减(演示用 mock)
 *   - v0.7/v0.8 引擎已经 dt-based 推进 game.vitalsState,但 UI 仍然
 *     用本地 mock,两套 vitals 各自跑、互相漂移 — 见 dispatcher 报告 #6
 *   - v0.8.3a P1 统一:UI 删本地衰减,改订阅 'engine:frame',
 *     读 event.game.vitalsState 作为唯一数据源(同对象引用,引擎 dt tick
 *     推进的 cur 值直接反映到 DOM)
 *   - 引擎未就绪时(demo.html 脚本先于 bootGame 加载),本地初始值
 *     {hp:100, hunger:80, sanity:100} 作为占位,首次 'engine:frame' 到达
 *     后自动切换到真实值
 *
 * 5Hz 同步规范:
 *   - TICK_MS = 200 (5Hz 渲染节流 — 数据更新由 'engine:frame' 触发,~60Hz)
 *   - 引擎 → UI: window.__hudBus.emit('engine:frame', { now, dt, game })
 *   - 任何订阅: hudBus.on('engine:frame', (e) => { e.game.vitalsState ... })
 *   - 事件类型:
 *     - 'engine:frame'  : detail = { now, dt, game } ← 引擎 ~60Hz
 *     - 'hotbar:select'  : detail = {index: 0..6}
 *     - 'tick'           : detail = {t: DOMHighResTimeStamp} 每 200ms 触发
 *     - 'party:join'     : detail = {slot: 0..3, player: {id, name, cls, color}}
 *     - 'party:leave'    : detail = {slot: 0..3}
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空;无 DOM 时不抛错
 *   - 不依赖任何 ESM 引入,使用普通 <script src> 加载
 *   - DOMContentLoaded 后才初始化,避免 demo.html 解析未完成
 */

(function () {
  'use strict';

  // ===== 配置 =====
  var TICK_MS = 200;          // 5Hz
  var PARTY_SIZE = 4;         // 联机 4 人上限
  var HOTBAR_SLOT_COUNT = 7;  // demo.html 现有 5+2 槽(2 个 disabled)

  // ===== EventTarget 总线 =====
  function HudBus() {
    this.target = document.createTextNode(null);  // 借一个节点做监听锚
  }
  HudBus.prototype.emit = function (type, detail) {
    // CustomEvent 在旧浏览器可能不支持 detail,但 target 上 dispatch 可用
    var evt;
    try {
      evt = new CustomEvent(type, { detail: detail, bubbles: false });
    } catch (e) {
      evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(type, false, false, detail);
    }
    this.target.dispatchEvent(evt);
  };
  HudBus.prototype.on = function (type, handler) {
    this.target.addEventListener(type, function (e) { handler(e.detail); });
  };
  HudBus.prototype.off = function (type, handler) {
    this.target.removeEventListener(type, handler);
  };

  var hudBus = new HudBus();
  // 暴露给 M4 引擎 + M2.11 图鉴
  // eslint-disable-next-line
  window.__hudBus = hudBus;

  // ===== Mock 数据(联机数据后续 M2.10 接入) =====
  // 4 队伍槽玩家数据
  var PARTY = [
    { id: 1, name: '队长',  cls: 'warrior', color: 'party-1' },
    { id: 2, name: '游侠',  cls: 'ranger',  color: 'party-2' },
    { id: 3, name: '工匠',  cls: 'artisan', color: 'party-3' },
    { id: 4, name: '学者',  cls: 'scholar', color: 'party-4' }
  ];

  // 季节(4 循环)
  var SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  var SEASON_NAMES_CN = { SPRING: '春', SUMMER: '夏', AUTUMN: '秋', WINTER: '冬' };
  var seasonIdx = 2;  // AUTUMN

  // 三围条初始值(引擎未就绪时的占位 — 首次 'engine:frame' 到达后自动替换)
  var vitalsState = {
    hp:     { cur: 100, max: 100 },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };

  // ===== DOM 引用 =====
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ===== 渲染函数 =====

  // 4 队伍槽:写入玩家名 + 队伍色
  function renderPartySlots() {
    var slots = $$('.Anchor-TL .PartySlot');
    if (!slots.length) return;
    slots.forEach(function (slot, i) {
      var p = PARTY[i];
      // 清空旧内容
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      if (!p) return;  // 空槽
      var name = document.createElement('div');
      name.className = 'PartySlot-Name';
      name.textContent = p.name;
      var idEl = document.createElement('div');
      idEl.className = 'PartySlot-Id';
      idEl.textContent = String(p.id);
      slot.appendChild(name);
      slot.appendChild(idEl);
      slot.setAttribute('data-party-id', String(p.id));
      slot.setAttribute('data-party-cls', p.cls);
      slot.setAttribute('data-party-color', p.color);
    });
  }

  // 三围条:从 vitalsState 读,改 .VitalBar-Fill width + .VitalBar-Value text + is-low/is-critical 类
  function renderVitals() {
    var v = vitalsState;
    var types = [
      { sel: '.VitalBar-HP',     key: 'hp' },
      { sel: '.VitalBar-Hunger', key: 'hunger' },
      { sel: '.VitalBar-Sanity', key: 'sanity' }
    ];
    types.forEach(function (t) {
      var el = $(t.sel);
      if (!el) return;
      var s = v[t.key];
      var ratio = Math.max(0, Math.min(1, s.cur / Math.max(1, s.max)));
      var pct = Math.round(ratio * 100);
      var fill = $('.VitalBar-Fill', el);
      var valEl = $('.VitalBar-Value', el);
      if (fill) fill.style.width = pct + '%';
      if (valEl) valEl.textContent = Math.round(s.cur) + '/' + s.max;
      // 状态类:< 30% is-low, < 10% is-critical(对照 components.css)
      el.classList.toggle('is-low', ratio < 0.3 && ratio >= 0.1);
      el.classList.toggle('is-critical', ratio < 0.1);
      el.setAttribute('data-value', String(Math.round(s.cur)));
    });
  }

  // 时间 + 季节
  function renderTime() {
    var el = $('.Anchor-TR .TimeDisplay');
    if (el) {
      el.textContent = 'Day 12 · 14:32';
    }
    var tag = $('.Anchor-TR .SeasonTag');
    if (tag) {
      var s = SEASONS[seasonIdx];
      tag.textContent = SEASON_NAMES_CN[s] + ' · ' + s;
    }
  }

  // 快捷栏 active 切换(被点击 + 数字键触发)
  var hotbarSelected = 1;  // 默认第 2 槽(沿用 demo.html 现状)
  function renderHotbarSelection() {
    var slots = $$('.Anchor-BL .HotbarSlot');
    slots.forEach(function (slot, i) {
      if (slot.getAttribute('aria-disabled') === 'true') return;
      if (i === hotbarSelected) {
        slot.classList.add('HotbarSlot-Active');
        slot.classList.remove('HotbarSlot-Default');
      } else {
        slot.classList.remove('HotbarSlot-Active');
        slot.classList.add('HotbarSlot-Default');
      }
    });
  }

  // ===== 5Hz 渲染 tick =====
  // v0.8.3a P1:tick 不再 mutate 任何状态 — 只负责按 5Hz 节流把
  // vitalsState(由 'engine:frame' 回调写入)推到 DOM。数据源是引擎,
  // 本模块对 vitalsState 只读不写。
  function tick() {
    // 1. 渲染 DOM(vitalsState 引用是引擎对象,引擎 dt tick 推进的 cur 直接反映)
    renderVitals();
    renderTime();
    renderHotbarSelection();
    // 2. tick 广播(供 M2.11 等订阅)
    hudBus.emit('tick', { t: Date.now() });
  }

  // ===== 事件订阅 =====

  // 1. v0.8.3a P1 — 引擎推 vitals 状态(单源,数据来自 event.game.vitalsState)
  hudBus.on('engine:frame', function (e) {
    if (e && e.game && e.game.vitalsState &&
        e.game.vitalsState.hp && e.game.vitalsState.hunger && e.game.vitalsState.sanity) {
      // 引擎对象是 dt tick 推进的,取同对象引用即可。
      // v0.8.0a 冻结的是 game 字段层(不可 reassign),但 vitalsState 对象的
      // cur 值仍是 mutable,UI 渲染读到的就是最新值。
      vitalsState = e.game.vitalsState;
    }
  });

  // 2. M4 引擎或外部推快捷栏选中
  hudBus.on('hotbar:select', function (detail) {
    if (detail && typeof detail.index === 'number') {
      hotbarSelected = detail.index;
      renderHotbarSelection();
    }
  });

  // 3. 队伍槽加入/离开
  hudBus.on('party:join', function (detail) {
    if (!detail || typeof detail.slot !== 'number') return;
    PARTY[detail.slot] = detail.player;
    renderPartySlots();
  });
  hudBus.on('party:leave', function (detail) {
    if (!detail || typeof detail.slot !== 'number') return;
    PARTY[detail.slot] = null;
    renderPartySlots();
  });

  // 4. 数字键 1-5 切快捷栏(与 M4 hotbar.js 行为一致,这里用 DOM 入口)
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k >= '1' && k <= String(HOTBAR_SLOT_COUNT)) {
      var idx = parseInt(k, 10) - 1;
      var slots = $$('.Anchor-BL .HotbarSlot');
      if (slots[idx] && slots[idx].getAttribute('aria-disabled') !== 'true') {
        hotbarSelected = idx;
        renderHotbarSelection();
        hudBus.emit('hotbar:select', { index: idx, source: 'keydown' });
        e.preventDefault();
      }
    }
  });

  // 5. 点击快捷栏切换
  document.addEventListener('click', function (e) {
    var slot = e.target.closest && e.target.closest('.Anchor-BL .HotbarSlot');
    if (!slot) return;
    if (slot.getAttribute('aria-disabled') === 'true') return;
    var slots = $$('.Anchor-BL .HotbarSlot');
    var idx = slots.indexOf(slot);
    if (idx >= 0) {
      hotbarSelected = idx;
      renderHotbarSelection();
      hudBus.emit('hotbar:select', { index: idx, source: 'click' });
    }
  });

  // ===== 初始化 =====

  function init() {
    // 1. 防御性检查:确认 demo.html 已加载锚定区
    if (!$('.UILayer')) {
      // 等 DOMContentLoaded 后再试
      return false;
    }
    // 2. 渲染初始 DOM
    renderPartySlots();
    renderVitals();
    renderTime();
    renderHotbarSelection();
    // 3. 启动 5Hz tick
    setInterval(tick, TICK_MS);
    // 4. 暴露 API(v0.8.3a P1:移除 setDemoEnabled,数据源已统一到引擎)
    window.HudBusAPI = {
      bus: hudBus,
      setVitals: function (v) { vitalsState = v; renderVitals(); },
      setHotbar: function (i) { hotbarSelected = i; renderHotbarSelection(); },
      getParty: function () { return PARTY.slice(); }
    };
    // 5. 标记就绪(M4 main.js 可检测)
    window.__hudReady = true;
    // 6. v0.8.3a P1:如果引擎已经先于本脚本加载,立即抓取 vitalsState
    if (window.__game && window.__game.vitalsState &&
        window.__game.vitalsState.hp && window.__game.vitalsState.hunger && window.__game.vitalsState.sanity) {
      vitalsState = window.__game.vitalsState;
      renderVitals();
    }
    return true;
  }

  // DOMContentLoaded 后初始化(demo.html 解析时同步执行 <script>,但 DOM 可能未完整)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    // 已加载完成(普通 script defer 后),直接 init
    init();
  }
})();
