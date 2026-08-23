/**
 * Wildwood UI · v0.8.0 物品 / 配方 / 猪人类型 catalog
 *
 * 角色(新增):
 *   - 引擎的 src/resources/catalog.js 是 ESM,UI <script> 加载
 *     不到,需要这个 IIFE 包装。
 *   - 装配前(裸 demo / 测试)异步 fetch JSON,装配后(引擎
 *     已就绪)从 window.__game 的对应字段读(如果暴露了)。
 *   - 暴露 window.__itemsCatalog:
 *       getItem(id)         → { id, name, icon, color, category, stackMax, ... }
 *       getRecipe(id)       → { id, name, station, grid, pattern, output, cost }
 *       flattenCost(recipe) → 把 pattern 拍平为 [{itemId, count}]
 *       allRecipes()        → Array<recipe>
 *       getPiglinType(id)   → 猪人类型配置
 *       isReady()           → bool
 *       whenReady(cb)       → 同步/异步都正常
 *
 * 数据源:
 *   - src/resources/items.json    (111 条物品,1.3.2 锁版)
 *   - src/resources/recipes.json  (多配方,1.2.1 锁版,2x2 grid pattern)
 *   - src/npc/data/piglins.json   (猪人类型,1.0.0 锁版,1 个类型 "piglin")
 *
 * 安全:
 *   - 不依赖 ESM,普通 <script> 加载
 *   - 无 fetch 成功时回退到内置 default catalog(避免 UI 崩溃)
 *   - 错误吞掉,console.warn 记录
 */

(function () {
  'use strict';

  if (window.__itemsCatalog) return; // 幂等

  // -------- 默认 fallback(无 fetch 时的保底) --------
  // 4 件基础资源 + 1 件工具 + 1 件食物,够 UI 显示空状态不白屏
  var DEFAULT_ITEMS = {
    log:     { id: 'log',     name: '木头', icon: 'log',     color: '#8a5a2a', category: 'material', stackMax: 20 },
    twine:   { id: 'twine',   name: '草绳', icon: 'twine',   color: '#5a8a3a', category: 'material', stackMax: 20 },
    stone:   { id: 'stone',   name: '石头', icon: 'stone',   color: '#7a7a7a', category: 'material', stackMax: 20 },
    flint:   { id: 'flint',   name: '燧石', icon: 'flint',   color: '#3a3a3a', category: 'material', stackMax: 20 },
    berries: { id: 'berries', name: '浆果', icon: 'berries', color: '#8a2a4a', category: 'food',     stackMax: 20, foodValue: 1 },
    carrot:  { id: 'carrot',  name: '胡萝卜', icon: 'carrot', color: '#d4a64a', category: 'food',     stackMax: 20, foodValue: 1 },
    axe:     { id: 'axe',     name: '斧头', icon: 'axe',     color: '#a86a2a', category: 'tool',     stackMax: 1,  maxDurability: 20, toolType: 'axe' },
    pickaxe: { id: 'pickaxe', name: '镐子', icon: 'pickaxe', color: '#a8a8a8', category: 'tool',     stackMax: 1,  maxDurability: 25, toolType: 'pickaxe' },
    shovel:  { id: 'shovel',  name: '铲子', icon: 'shovel',  color: '#8a6a4a', category: 'tool',     stackMax: 1,  maxDurability: 15, toolType: 'shovel' },
    torch:   { id: 'torch',   name: '火把', icon: 'torch',   color: '#ffb84a', category: 'tool',     stackMax: 20, maxDurability: 30, toolType: 'light' }
  };
  var DEFAULT_PIGLIN_TYPE = {
    id: 'piglin', name: '猪人', preferredBiome: 'forest',
    hp: 100, walkSpeed: 1.5, color: '#c8a89a', size: 14,
    houseWidth: 3, houseHeight: 2,
    greetingLines: ['嗯?陌生人...', '你带了吃的吗?'],
    tradeRejection: ['现在不卖给你', '再走走看看'],
    feedingThanks: ['好吃!', '谢谢你!'],
    followAccept:  ['好,跟着你走。'],
    deathShouts:   ['呜...']
  };

  // -------- 内部状态 --------
  var _items = Object.assign({}, DEFAULT_ITEMS);
  var _recipes = {};   // id -> recipe
  var _piglins = { piglin: DEFAULT_PIGLIN_TYPE };
  var _ready = false;  // fetch 完成 + 数据就绪
  var _readyCallbacks = [];

  function _setReady() {
    _ready = true;
    var cbs = _readyCallbacks;
    _readyCallbacks = [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](); } catch (e) { /* swallow */ }
    }
  }

  // 异步 fetch(单条失败不影响其他)
  function _fetchJson(path) {
    return fetch(path, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function _flattenPattern(recipe) {
    // 2D pattern → [{itemId, count}] 自动合并重复
    if (!recipe || !Array.isArray(recipe.pattern)) return [];
    var tally = {};
    for (var i = 0; i < recipe.pattern.length; i++) {
      var row = recipe.pattern[i];
      if (!Array.isArray(row)) continue;
      for (var j = 0; j < row.length; j++) {
        var id = row[j];
        if (!id) continue;
        tally[id] = (tally[id] || 0) + 1;
      }
    }
    var out = [];
    Object.keys(tally).forEach(function (k) {
      out.push({ itemId: k, count: tally[k] });
    });
    return out;
  }

  // -------- 加载流程 --------
  function _load() {
    var p1 = _fetchJson('./src/resources/items.json')
      .then(function (json) {
        if (json && typeof json === 'object') {
          Object.keys(json).forEach(function (k) {
            if (k === '_meta') return;
            if (json[k] && json[k].id) _items[k] = json[k];
          });
        }
      }).catch(function (e) { if (window.console) console.warn('[itemsCatalog] items.json load failed:', e.message); });

    var p2 = _fetchJson('./src/resources/recipes.json')
      .then(function (json) {
        if (json && typeof json === 'object') {
          Object.keys(json).forEach(function (k) {
            if (k === '_meta') return;
            var r = json[k];
            if (!r || !r.id) return;
            r.cost = _flattenPattern(r);
            _recipes[r.id] = r;
          });
        }
      }).catch(function (e) { if (window.console) console.warn('[itemsCatalog] recipes.json load failed:', e.message); });

    var p3 = _fetchJson('./src/npc/data/piglins.json')
      .then(function (json) {
        if (json && json.piglin) {
          _piglins.piglin = json.piglin;
        }
      }).catch(function (e) { if (window.console) console.warn('[itemsCatalog] piglins.json load failed:', e.message); });

    Promise.all([p1, p2, p3]).then(_setReady, function () {
      // 即便全失败也标 ready(已有 fallback)
      _setReady();
    });
  }

  // 立刻开始加载(浏览器空闲时)
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(_load, { timeout: 1500 });
  } else {
    setTimeout(_load, 50);
  }

  // -------- 公共 API --------
  function getItem(id) {
    if (!id) return null;
    return _items[id] || null;
  }
  function getRecipe(id) {
    if (!id) return null;
    return _recipes[id] || null;
  }
  function allRecipes() {
    return Object.keys(_recipes).map(function (k) { return _recipes[k]; });
  }
  function getPiglinType(id) {
    return _piglins[id] || _piglins.piglin || null;
  }
  function isReady() { return _ready; }
  function whenReady(cb) {
    if (_ready) { try { cb(); } catch (_) {} return; }
    _readyCallbacks.push(cb);
  }
  // 给 UI 用的 icon → 单字符 fallback(无 sprite 资源时)
  function getItemShortLabel(id) {
    var it = getItem(id);
    if (!it) return '?';
    // 优先用 id 第一个字符(中英兼容),再退到 name[0]
    var c = (it.icon || it.id || it.name || '?').toString();
    if (c.length >= 1) {
      // 英文 icon 截首字母(去 _),中文直接用
      var ch = c[0];
      if (/[\u4e00-\u9fff]/.test(ch)) return ch;
      return ch.toUpperCase();
    }
    return '?';
  }

  window.__itemsCatalog = {
    getItem: getItem,
    getRecipe: getRecipe,
    allRecipes: allRecipes,
    getPiglinType: getPiglinType,
    getItemShortLabel: getItemShortLabel,
    flattenCost: _flattenPattern,
    isReady: isReady,
    whenReady: whenReady
  };
})();
