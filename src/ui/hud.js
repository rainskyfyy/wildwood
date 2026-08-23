/**
 * Wildwood UI · HUD 顶层状态机 (v0.8.0 · 真实引擎接入)
 *
 * 职责:
 *   1. 在 demo.html 顶层建立 EventTarget 抽象层(window.__hudBus)
 *      引擎 + 任何屏都通过它推/订阅状态
 *   2. 5Hz 状态同步:每 200ms tick 一次,渲染三围条/时间/快捷栏
 *      数据源:window.__game(由 src/assembly.js 注入)
 *   3. 4 队伍槽 mock 数据:写入玩家名 + 队伍色(联机数据后续 M2.10 接入)
 *   4. 点击快捷栏切换 active(替代 demo.html 里的内联 JS)
 *
 * 与 M4 引擎的关系(v0.8.0 真实接入):
 *   - 引擎通过 defaultNotifyUI(game, dt, now) 在 frame() 末尾广播
 *   - defaultNotifyUI 双出口:__hudBus.emit('engine:frame', { now, dt, game })
 *     + window.__wildwood.uiSubscribers 列表遍历
 *   - UI 订阅 hudBus 的 'engine:frame' 事件,从 event.game 读真实数据
 *   - 数据源:event.game.vitalsState / event.game.dayCycle.describe() /
 *     event.game.player / event.game.inventory.selected(快捷栏)
 *
 * 5Hz 同步规范:
 *   - TICK_MS = 200 (5Hz)
 *   - 任何推/订: hudBus.emit('vitals:change', {hp, hunger, sanity})
 *   - 任何订阅: hudBus.on('vitals:change', (state) => { ... })
 *   - 事件类型:
 *     - 'engine:frame'  : detail = {now, dt, game} 引擎帧尾通知(主数据源)
 *     - 'vitals:change' : detail = {hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}
 *     - 'hotbar:select' : detail = {index: 0..6}
 *     - 'tick'          : detail = {t: DOMHighResTimeStamp} 每 200ms 触发
 *     - 'party:join'    : detail = {slot: 0..3, player: {id, name, cls, color}}
 *     - 'party:leave'   : detail = {slot: 0..3}
 *
 * 加载占位:
 *   - 引擎未就绪(window.__game 不存在)时,三围条显示 '--/--',时间显示 'Day · --:--'
 *   - 首次 engine:frame 到达后,自动从占位切到真实值
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
  // eslint-disable-next-line
  window.__hudBus = hudBus;
  // ===== 队伍数据(联机数据后续 M2.10 接入,这里保留 mock) =====
  // 4 队伍槽玩家数据
  var PARTY = [
    { id: 1, name: '队长',  cls: 'warrior', color: 'party-1' },
    { id: 2, name: '游侠',  cls: 'ranger',  color: 'party-2' },
    { id: 3, name: '工匠',  cls: 'artisan', color: 'party-3' },
    { id: 4, name: '学者',  cls: 'scholar', color: 'party-4' }
  ];
  // 季节(4 循环)—— 留作扩展接口,目前由 dayCycle.describe() 输出昼夜标签
  var SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  var SEASON_NAMES_CN = { SPRING: '春', SUMMER: '夏', AUTUMN: '秋', WINTER: '冬' };
  var seasonIdx = 2;  // AUTUMN
  // ===== 三围条状态(从 window.__game.vitalsState 实时同步) =====
  // 引擎未就绪时显示占位 --/--,首次 engine:frame 到达后切换到真实值
  var vitalsState = {
    hp:     { cur: null, max: null },
    hunger: { cur: null, max: null },
    sanity: { cur: null, max: null },
    _loaded: false  // 引擎是否已就绪并推送过真实值
  };
  // 时间显示(从 event.game.dayCycle.describe() 同步)
  var timeDisplay = 'Day · --:--';
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
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      if (!p) return;
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
      // 引擎未就绪:占位 '--/--' + 0 宽度
      if (!v._loaded || s.cur == null || s.max == null || s.max <= 0) {
        el.classList.add('is-loading');
        var fill0 = $('.VitalBar-Fill', el);
        var valEl0 = $('.VitalBar-Value', el);
        if (fill0) fill0.style.width = '0%';
        if (valEl0) valEl0.textContent = '--/--';
        el.classList.remove('is-low', 'is-critical');
        el.setAttribute('data-value', '--');
        return;
      }
      el.classList.remove('is-loading');
      var ratio = Math.max(0, Math.min(1, s.cur / Math.max(1, s.max)));
      var pct = Math.round(ratio * 100);
      var fill = $('.VitalBar-Fill', el);
      var valEl = $('.VitalBar-Value', el);
      if (fill) fill.style.width = pct + '%';
      if (valEl) valEl.textContent = Math.round(s.cur) + '/' + s.max;
      el.classList.toggle('is-low', ratio < 0.3 && ratio >= 0.1);
      el.classList.toggle('is-critical', ratio < 0.1);
      el.setAttribute('data-value', String(Math.round(s.cur)));
    });
  }
  // 时间显示(从 dayCycle.describe() 读)
  function renderTime() {
    var el = $('.Anchor-TR .TimeDisplay');
    if (el) el.textContent = timeDisplay;
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
  // ===== 5Hz tick(只渲染,不推进数据) =====
  function tick() {
    // 1. 渲染 DOM(数据已在 onEngineFrame 里同步)
    renderVitals();
    renderTime();
    renderHotbarSelection();
    // 2. tick 广播(供 M2.11 等订阅)
    hudBus.emit('tick', { t: Date.now() });
  }
  // ===== 引擎数据通道订阅 =====
  // 由 src/assembly.js 的 defaultNotifyUI 注入 hudBus.emit('engine:frame', {now, dt, game})
  // 我们把 vitals/time 从 game 同步到本地 state,后续渲染只用本地 state
  function onEngineFrame(detail) {
    if (!detail || !detail.game) return;
    var game = detail.game;
    // 1. vitals
    if (game.vitalsState && game.vitalsState.hp && game.vitalsState.hunger && game.vitalsState.sanity) {
      var v = game.vitalsState;
      vitalsState.hp     = { cur: v.hp.cur,     max: v.hp.max };
      vitalsState.hunger = { cur: v.hunger.cur, max: v.hunger.max };
      vitalsState.sanity = { cur: v.sanity.cur, max: v.sanity.max };
      if (!vitalsState._loaded) {
        vitalsState._loaded = true;
        // 兼容总线:告知其他模块(下游屏 / 图鉴系统)真实 vitals 已就绪
        hudBus.emit('vitals:change', {
          hp:     { cur: vitalsState.hp.cur,     max: vitalsState.hp.max },
          hunger: { cur: vitalsState.hunger.cur, max: vitalsState.hunger.max },
          sanity: { cur: vitalsState.sanity.cur, max: vitalsState.sanity.max }
        });
      }
    }
    // 2. dayCycle
    if (game.dayCycle && typeof game.dayCycle.describe === 'function') {
      timeDisplay = game.dayCycle.describe();
    }
  }
  // ===== 事件订阅 =====
  // 1. 引擎帧尾通知(主数据源)
  hudBus.on('engine:frame', onEngineFrame);
  // 2. 外部推快捷栏选中(由 hud.js 数字键 / 点击触发,屏幕只读镜像)
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
    if (!$('.UILayer')) {
      return false;
    }
    // 1. 渲染初始 DOM(占位状态)
    renderPartySlots();
    renderVitals();
    renderTime();
    renderHotbarSelection();
    // 2. 启动 5Hz tick(只渲染,数据由 engine:frame 推送)
    setInterval(tick, TICK_MS);
    // 3. 暴露 API
    window.HudBusAPI = {
      bus: hudBus,
      setVitals: function (v) { vitalsState = v; renderVitals(); },
      setHotbar: function (i) { hotbarSelected = i; renderHotbarSelection(); },
      getParty: function () { return PARTY.slice(); },
      isLoaded: function () { return vitalsState._loaded; }
    };
    // 4. 标记就绪
    window.__hudReady = true;
    return true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
