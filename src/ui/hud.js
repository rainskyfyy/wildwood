/**
 * Wildwood UI · HUD 顶层状态机 (M2.12)
 *
 * 职责:
 *   1. 在 demo.html 顶层建立 EventTarget 抽象层(window.__hudBus)
 *      M4 引擎 / M2.11 图鉴系统 / 任何屏都通过它推/订阅状态
 *   2. 5Hz 状态同步演示:每 200ms tick 一次,推进三围条演示动画
 *      (JS 每 200ms 减 1%,演示 5Hz 状态变化)
 *   3. 4 队伍槽 mock 数据:写入玩家名 + 队伍色
 *   4. 点击快捷栏切换 active(替代 demo.html 里的内联 JS)
 *
 * 与 M4 引擎的关系:
 *   - M4 src/hud/* 的 Canvas 程序绘制已替换为读 M1.8 组件的 DOM 操作
 *   - main.js 完全不变,bootGame() 不被破坏
 *   - 本模块作为 UI 顶层入口,独立于 M4 引擎;M4 通过 hudBus 推状态
 *   - M2.11 图鉴系统可订阅同一 hudBus,5Hz 频率统一
 *
 * 5Hz 同步规范:
 *   - TICK_MS = 200 (5Hz)
 *   - 任何推/订: hudBus.emit('vitals:change', {hp, hunger, sanity})
 *   - 任何订阅: hudBus.on('vitals:change', (state) => { ... })
 *   - 事件类型:
 *     - 'vitals:change' : detail = {hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}
 *     - 'hotbar:select' : detail = {index: 0..6}
 *     - 'tick'          : detail = {t: DOMHighResTimeStamp} 每 200ms 触发
 *     - 'party:join'    : detail = {slot: 0..3, player: {id, name, cls, color}}
 *     - 'party:leave'   : detail = {slot: 0..3}
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

  // 三围条初始值 + 演示衰减
  var vitalsState = {
    hp:     { cur: 100, max: 100 },
    hunger: { cur: 80,  max: 100 },
    sanity: { cur: 100, max: 100 }
  };
  // 是否启用 5Hz 演示动画(window.__vitalsDemo = false 可关闭,真实联机数据从 M4 推)
  var vitalsDemoEnabled = true;

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

  // ===== 5Hz tick =====

  function tick() {
    // 1. 演示动画:三围条每 200ms 减 1%(饥饿 5Hz - 1%, 理智 5Hz - 0.5%, HP 静止)
    if (vitalsDemoEnabled) {
      vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - 1);
      vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - 0.5);
      // 推送到 hudBus(M2.11 图鉴系统会订阅这条事件)
      hudBus.emit('vitals:change', cloneVitals(vitalsState));
    }
    // 2. 渲染 DOM
    renderVitals();
    renderTime();
    renderHotbarSelection();
    // 3. tick 广播(供 M2.11 等订阅)
    hudBus.emit('tick', { t: Date.now() });
  }

  function cloneVitals(v) {
    return {
      hp:     { cur: v.hp.cur,     max: v.hp.max },
      hunger: { cur: v.hunger.cur, max: v.hunger.max },
      sanity: { cur: v.sanity.cur, max: v.sanity.max }
    };
  }

  // ===== 事件订阅 =====

  // 1. M4 引擎推 vitals 状态(可选,演示模式下 hud.js 自己推)
  hudBus.on('vitals:change', function (v) {
    if (v && v.hp && v.hunger && v.sanity) {
      vitalsState = v;
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
    // 4. 暴露 API
    window.HudBusAPI = {
      bus: hudBus,
      setVitals: function (v) { vitalsState = v; renderVitals(); },
      setHotbar: function (i) { hotbarSelected = i; renderHotbarSelection(); },
      setDemoEnabled: function (b) { vitalsDemoEnabled = !!b; },
      getParty: function () { return PARTY.slice(); }
    };
    // 5. 标记就绪(M4 main.js 可检测)
    window.__hudReady = true;
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
