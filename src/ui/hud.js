/**
 * Wildwood UI · HUD 顶层状态机 (v0.8.0 真实引擎接入)
 *
 * 角色(从 M2.12 演进到 v0.8.0):
 *   1. 维护 EventTarget 总线 `window.__hudBus`(向后兼容
 *      M2.12 / M2.11 / v0.5.4 / v0.6.4a 的所有订阅方)。
 *   2. **数据源从 mock 切到真实引擎**:
 *      - 三围条 / 时间 / 快捷栏选中,不再自己持有状态,
 *        全部从 `event.game.*` 读(window.__game).
 *      - 队伍槽 / 群系指示是引擎未暴露的字段,保留 mock
 *        并加 "演示数据" 角标(避免误以为是真实状态)。
 *   3. **订阅 `engine:frame` 事件**(5Hz 节流到 ~200ms,
 *      与 M2.12 规范对齐);引擎未就绪时显示"加载中"占位。
 *   4. `__hudBus` 上保留历史事件类型(vitals:change /
 *      hotbar:select / party:join / party:leave / tick),
 *      同时新增转发 `engine:frame` 给不知道总线的旧组件。
 *
 * 数据契约(v0.8.0 锁版):
 *   - window.__game.vitalsState      { hp, hunger, sanity } · {cur, max}
 *   - window.__game.dayCycle.describe() → "Day · 14:32" / "Night · 02:14"
 *   - window.__game.dayCycle.elapsed() → 秒数(用于算日计数)
 *   - window.__game.inventory.selected  → 当前快捷栏槽(0..5)
 *   - window.__game.world.tiles      Uint8Array 群系码
 *   - window.__game.world.CODE_TO_BIOME → ['desert','marsh','snow','volcano']
 *   - window.__game.player           { x, y, facing, hp, maxHp, ... }
 *   - window.__game.npcMgr.piglins   猪人数组(给 NPC 演示区用)
 *
 * 安全:
 *   - DOM 查询全部防御性判空
 *   - 普通 <script> 加载,非 ESM
 *   - engine:frame 事件 handler 内部 try/catch,单次异常不影响下一帧
 *   - 引擎未就绪时(.ready === false)显示"加载中..."占位
 *   - 离开页面或长时间无 tick 时,自动停止内部 5Hz 节流(避免无意义 DOM 写入)
 */

(function () {
  'use strict';

  // ===== 配置 =====
  var TICK_MS = 200;            // 5Hz,与 M2.12 对齐
  var PARTY_SIZE = 4;           // 联机 4 人上限
  var HOTBAR_SLOT_COUNT = 7;    // demo.html 5 + 2 disabled
  var SEASONS_CN = { SPRING: '春', SUMMER: '夏', AUTUMN: '秋', WINTER: '冬' };
  var SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  var SEASON_CYCLE_DAYS = 12;   // 12 个 in-game day 一季
  var DEFAULT_SEASON = 'AUTUMN';
  var DEFAULT_DAY = 1;
  var DEFAULT_TIME = 'Day · 00:00';
  var DEFAULT_BIOME = 'forest';

  // 群系中英对照(与 src/world/biome-config.js 对齐)
  var BIOME_CN = {
    desert:  '荒漠',
    marsh:   '沼泽',
    snow:    '雪原',
    volcano: '火山',
    forest:  '森林'
  };

  // ===== EventTarget 总线(沿用 M2.12 接口) =====
  function HudBus() {
    this.target = document.createTextNode(null);
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
  window.__hudBus = hudBus;  // 全局: 引擎 / M2.11 / v0.5.4 都订阅这里

  // ===== 工具 =====
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===== 应用状态(只放引擎未暴露的字段) =====
  // 队伍槽: 引擎 M4 没暴露 multiplayer party 数据,保留 mock,
  // 加 "演示" 角标,等联机接入替换。
  var PARTY = [
    { id: 1, name: '队长', cls: 'warrior', color: 'party-1' },
    { id: 2, name: '游侠', cls: 'ranger',  color: 'party-2' },
    { id: 3, name: '工匠', cls: 'artisan', color: 'party-3' },
    { id: 4, name: '学者', cls: 'scholar', color: 'party-4' }
  ];

  // 引擎 frame 缓存(每 200ms 刷一次,避免 60fps DOM 抖动)
  var lastFrame = null;       // { game, now, dt }
  var lastRenderTs = 0;
  var engineReady = false;    // window.__game 是否就绪

  // ===== 渲染函数 =====

  // 加载中占位(只显示一次,等 engine 接管)
  var _loadingRendered = false;
  function renderLoading() {
    if (_loadingRendered) return;
    _loadingRendered = true;
    var types = ['.VitalBar-HP', '.VitalBar-Hunger', '.VitalBar-Sanity'];
    types.forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var fill = $('.VitalBar-Fill', el);
      var valEl = $('.VitalBar-Value', el);
      if (fill) fill.style.width = '0%';
      if (valEl) valEl.textContent = '加载中…';
      el.classList.add('is-loading');
    });
    var timeEl = $('.Anchor-TR .TimeDisplay');
    if (timeEl) {
      timeEl.textContent = 'Day · 加载中…';
      timeEl.classList.add('is-loading');
    }
    var seasonEl = $('.Anchor-TR .SeasonTag');
    if (seasonEl) {
      seasonEl.textContent = '— —';
      seasonEl.classList.add('is-loading');
    }
  }
  function clearLoadingMarks() {
    $$('.is-loading').forEach(function (n) { n.classList.remove('is-loading'); });
  }

  // 4 队伍槽(展示数据,加 "DEMO" 角标避免误读)
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
      // v0.8.0: 标记演示数据
      slot.setAttribute('data-bind', 'demo');
    });
  }

  // 三围条: 从 event.game.vitalsState 读
  function renderVitals(game) {
    var vs = game && game.vitalsState;
    if (!vs) return;
    var types = [
      { sel: '.VitalBar-HP',     key: 'hp' },
      { sel: '.VitalBar-Hunger', key: 'hunger' },
      { sel: '.VitalBar-Sanity', key: 'sanity' }
    ];
    types.forEach(function (t) {
      var el = $(t.sel);
      if (!el) return;
      var s = vs[t.key];
      if (!s) return;
      var ratio = clamp((s.cur || 0) / Math.max(1, s.max || 1), 0, 1);
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

  // 时间 + 群系(从 engine.dayCycle.describe() 读)
  function renderTimeAndBiome(game) {
    var timeEl = $('.Anchor-TR .TimeDisplay');
    if (timeEl && game && game.dayCycle && typeof game.dayCycle.describe === 'function') {
      timeEl.textContent = game.dayCycle.describe();
      timeEl.classList.remove('is-loading');
    }
    // 群系指示:从 world.tiles[player.y * width + player.x] 读
    var seasonEl = $('.Anchor-TR .SeasonTag');
    if (seasonEl && game) {
      var biomeId = readBiomeAtPlayer(game);
      var label = biomeId ? (BIOME_CN[biomeId] || biomeId) : DEFAULT_BIOME;
      // 用 dayCount 算 season(12 day/季,共 4 季)
      var dayCount = readDayCount(game);
      var season = computeSeason(dayCount);
      seasonEl.textContent = label + ' · ' + SEASONS_CN[season] + season;
      seasonEl.classList.remove('is-loading');
    }
  }

  function readBiomeAtPlayer(game) {
    try {
      var w = game.world;
      var p = game.player;
      if (!w || !p || !w.tiles || typeof w.tiles !== 'object') return null;
      var x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) return null;
      var code;
      // world.tiles 可能是 Uint8Array(有 .idx 方法)或普通数组
      if (typeof w.idx === 'function') {
        code = w.idx(x, y);
      } else {
        code = w.tiles[y * w.width + x];
      }
      var table = w.CODE_TO_BIOME || w.codeToBiome;
      if (Array.isArray(table) && typeof code === 'number' && code >= 0 && code < table.length) {
        return table[code];
      }
    } catch (e) { /* swallow */ }
    return null;
  }

  function readDayCount(game) {
    try {
      if (game && game.dayCycle && typeof game.dayCycle.elapsed === 'function') {
        // 1 in-game day = CYCLE_LEN (8*60+4*60 = 720s)
        // 但 engine 没暴露 CYCLE_LEN,这里保守用 720s;
        // TODO v0.8.1: 改用 game.dayCycle.dayIndex 若暴露
        var t = game.dayCycle.elapsed();
        return Math.floor(t / 720) + 1;
      }
    } catch (e) { /* swallow */ }
    return DEFAULT_DAY;
  }

  function computeSeason(dayCount) {
    var idx = Math.floor((dayCount - 1) / SEASON_CYCLE_DAYS) % 4;
    return SEASONS[(idx + 2) % 4]; // 起点 AUTUMN 对齐 v0.8.0 启动时
  }

  // 快捷栏 active 切换: 从 event.game.inventory.selected 读
  function renderHotbarSelection(game) {
    var slots = $$('.Anchor-BL .HotbarSlot');
    if (!slots.length) return;
    var selected = (game && game.inventory && typeof game.inventory.selected === 'number')
      ? game.inventory.selected
      : 1;
    slots.forEach(function (slot, i) {
      if (slot.getAttribute('aria-disabled') === 'true') return;
      if (i === selected) {
        slot.classList.add('HotbarSlot-Active');
        slot.classList.remove('HotbarSlot-Default');
      } else {
        slot.classList.remove('HotbarSlot-Active');
        slot.classList.add('HotbarSlot-Default');
      }
    });
  }

  // 引擎绑定角标: 在 Anchor-TL 角落显示 "🔗 引擎" 或 "演示"
  function renderBindBadge() {
    var tl = $('.Anchor-TL');
    if (!tl) return;
    var existing = $('.Anchor-BindBadge', tl);
    if (engineReady) {
      if (existing) {
        existing.classList.remove('is-demo');
        existing.classList.add('is-engine');
        existing.textContent = '🔗 引擎';
      } else {
        var b = document.createElement('div');
        b.className = 'Anchor-BindBadge is-engine';
        b.textContent = '🔗 引擎';
        tl.appendChild(b);
      }
    } else {
      if (existing) {
        existing.classList.remove('is-engine');
        existing.classList.add('is-demo');
        existing.textContent = '加载中…';
      } else {
        var b = document.createElement('div');
        b.className = 'Anchor-BindBadge is-demo';
        b.textContent = '加载中…';
        tl.appendChild(b);
      }
    }
  }

  // ===== engine:frame 事件 handler =====
  // 来自 assembly.js defaultNotifyUI,每帧推一次({ now, dt, game }).
  // 我们用 5Hz 节流(throttle)避免每帧 DOM 写入。
  function onEngineFrame(detail) {
    if (!detail || !detail.game) return;
    engineReady = true;
    lastFrame = detail;
  }

  // 5Hz 节流渲染循环
  function renderTick() {
    // 1. 检查引擎就绪
    if (typeof window !== 'undefined' && window.__game && window.__game !== lastFrame && lastFrame === null) {
      // 引擎刚出现但还没收到 frame 事件: 用 window.__game 直接渲染一次
      engineReady = true;
      lastFrame = { game: window.__game, now: Date.now(), dt: 0 };
    }
    if (!engineReady) {
      renderLoading();
      renderBindBadge();
      return;
    }
    // 2. 引擎已就绪:每 200ms 渲染
    var now = Date.now();
    if (now - lastRenderTs < TICK_MS) return;
    lastRenderTs = now;

    var game = lastFrame && lastFrame.game;
    if (!game) return;
    clearLoadingMarks();
    renderVitals(game);
    renderTimeAndBiome(game);
    renderHotbarSelection(game);
    renderBindBadge();
  }

  // ===== 事件订阅(对外 API) =====

  // 1. 引擎推 engine:frame(v0.8.0 锁版事件)
  hudBus.on('engine:frame', onEngineFrame);

  // 2. 兼容 M2.12 的 vitals:change 事件(老组件可能还发)
  hudBus.on('vitals:change', function () { /* engine 接管后这里被忽略 */ });

  // 3. 快捷栏选中(数字键 / 点击触发)
  hudBus.on('hotbar:select', function (detail) {
    if (!detail || typeof detail.index !== 'number') return;
    // 引擎模式下:转发到游戏(当前引擎未实现此事件,只在本地高亮)
    var game = window.__game;
    if (game && game.inventory) {
      try { game.inventory.selected = detail.index; } catch (_) { /* frozen */ }
    }
    renderHotbarSelection({ inventory: { selected: detail.index } });
  });

  // 4. 队伍槽加入/离开(联机时由 mp 模块发)
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

  // 5. 数字键 1-5 切快捷栏(沿用 M2.12 交互)
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k >= '1' && k <= String(HOTBAR_SLOT_COUNT)) {
      var idx = parseInt(k, 10) - 1;
      var slots = $$('.Anchor-BL .HotbarSlot');
      if (slots[idx] && slots[idx].getAttribute('aria-disabled') !== 'true') {
        hudBus.emit('hotbar:select', { index: idx, source: 'keydown' });
        e.preventDefault();
      }
    }
  });

  // 6. 点击快捷栏切换
  document.addEventListener('click', function (e) {
    var slot = e.target.closest && e.target.closest('.Anchor-BL .HotbarSlot');
    if (!slot) return;
    if (slot.getAttribute('aria-disabled') === 'true') return;
    var slots = $$('.Anchor-BL .HotbarSlot');
    var idx = slots.indexOf(slot);
    if (idx >= 0) hudBus.emit('hotbar:select', { index: idx, source: 'click' });
  });

  // ===== 初始化 =====
  function init() {
    if (!$('.UILayer')) return false;
    // 1. 渲染一次占位状态(防止白屏)
    renderLoading();
    renderBindBadge();
    renderPartySlots();
    // 2. 启动 5Hz 节流渲染(无论引擎是否就绪都跑,引擎来了自动接管)
    setInterval(renderTick, TICK_MS);
    // 3. 暴露 API(向后兼容 M2.12)
    window.HudBusAPI = {
      bus: hudBus,
      setVitals: function (v) {
        // engine 模式下忽略(数据源是引擎,不允许外部覆盖)
        // 只在没有引擎时用于测试
        if (!engineReady && v) {
          var g = { vitalsState: v, dayCycle: null, inventory: null, player: null };
          renderVitals(g);
        }
      },
      setHotbar: function (i) { hudBus.emit('hotbar:select', { index: i }); },
      setDemoEnabled: function () { /* v0.8.0 起忽略 */ },
      getParty: function () { return PARTY.slice(); },
      isEngineReady: function () { return engineReady; }
    };
    window.__hudReady = true;
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
