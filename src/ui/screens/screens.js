/**
 * Wildwood UI · M2.13 4 屏交互 (v0.8.0 真实引擎接入)
 *
 * 角色(从 M2.13 演进到 v0.8.0):
 *   1. 4 屏 subtab 路由(背包 / 合成 / 地图 / 任务):沿用 SPA hash
 *   2. **数据源切到真实引擎**(从 __game 读 inventory / player /
 *      npcMgr.piglins),不再用 MOCK_ITEMS / genInitialInventory 等
 *      本地 mock。
 *   3. **拖拽 4 状态机改为只读模式**:
 *      - 引擎模式下,拖拽是"显示状态",不真的修改 inventory
 *        (因为 engine.inventory 是 pass-through frozen,UI 改不动)。
 *      - 显示一个"🔗 引擎只读"角标。
 *      - 旧版本地 mock 拖拽逻辑保留,作为 __game==null 时的回退
 *        (确保 demo.html 在没有引擎时也能跑)。
 *   4. 合成屏:实时校验材料(从 engine.inventory 读 count),
 *      合成按钮 emit `engine:craft` 事件(等引擎实现 on('craft'))。
 *   5. 地图屏:玩家位置 / 当前群系从 engine 实时读。
 *   6. 任务屏:引擎尚未暴露 quest 系统,先沿用 MOCK_QUESTS 但
 *      加"待接入"角标(等 v0.8.x 引擎侧 quest 接入)。
 *
 * 与其他子任务的关系(同 v0.8.0):
 *   - M2.12 hud.js: 提供 window.__hudBus + 引擎 frame 转发
 *   - v0.8.0 engine: 提供 window.__game(冻结 pass-through 字段)
 *   - items-catalog.js: 提供 window.__itemsCatalog(本文件用)
 *   - tickState.js: 提供 5Hz tick / pause / resume
 *
 * 5Hz 同步(沿用 M2.13 规范):
 *   - 订阅 hudBus 'engine:frame' 事件,从 event.game 读 inventory
 *   - 状态变更: hudBus.emit('inventory:change', { slots, hotbar })
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空
 *   - 普通 <script> 加载,非 ESM
 *   - 引擎未就绪时显示"加载中..."占位,不白屏
 */

(function () {
  'use strict';

  // ============================================================================
  // 配置
  // ============================================================================

  var TICK_MS = 200;
  var HOTBAR_SIZE = 7;          // demo.html 5 + 2 disabled
  var INVENTORY_COLS = 6;
  var INVENTORY_ROWS = 4;       // 24 槽
  var STACK_MAX = 20;
  var TOTAL_SLOTS = INVENTORY_COLS * INVENTORY_ROWS;  // 24

  // ============================================================================
  // 工具
  // ============================================================================

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    if (children) {
      [].concat(children).forEach(function (c) {
        if (c == null) return;
        node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return node;
  }

  // item 描述查询(优先用 __itemsCatalog,fallback 到本地已知表)
  function describeItem(itemId) {
    var c = window.__itemsCatalog;
    if (c && typeof c.getItem === 'function') {
      var it = c.getItem(itemId);
      if (it) return { name: it.name, icon: c.getItemShortLabel(itemId), stackMax: it.stackMax || STACK_MAX, color: it.color || '#888' };
    }
    // 离线 fallback(与 items-catalog.js DEFAULT_ITEMS 对齐)
    var FALLBACK = {
      log:     { name: '木头', icon: '木', stackMax: 20, color: '#8a5a2a' },
      twine:   { name: '草绳', icon: '绳', stackMax: 20, color: '#5a8a3a' },
      stone:   { name: '石头', icon: '石', stackMax: 20, color: '#7a7a7a' },
      flint:   { name: '燧石', icon: '燧', stackMax: 20, color: '#3a3a3a' },
      berries: { name: '浆果', icon: '果', stackMax: 20, color: '#8a2a4a' },
      carrot:  { name: '胡萝卜', icon: '萝', stackMax: 20, color: '#d4a64a' },
      axe:     { name: '斧头', icon: '斧', stackMax: 1, color: '#a86a2a' },
      pickaxe: { name: '镐子', icon: '镐', stackMax: 1, color: '#a8a8a8' },
      shovel:  { name: '铲子', icon: '铲', stackMax: 1, color: '#8a6a4a' },
      torch:   { name: '火把', icon: '炬', stackMax: 20, color: '#ffb84a' }
    };
    return FALLBACK[itemId] || { name: itemId, icon: (itemId || '?')[0].toUpperCase(), stackMax: STACK_MAX, color: '#888' };
  }

  // ============================================================================
  // 应用状态
  // ============================================================================
  // engineReady: __game 是否就绪
  // state.inventory: 引擎模式下 = 拷贝(engine.inventory.slots),本地模式下 = mock
  // state.engineLive: true 时禁用本地 mutation(拖拽只读)
  var state = {
    activeTab: 'inventory',
    inventory: new Array(TOTAL_SLOTS).fill(null),  // 24 槽
    hotbar: new Array(HOTBAR_SIZE).fill(null),
    drag: null,
    tickCount: 0,
    engineLive: false
  };
  window.__screensState = state;

  // ============================================================================
  // 引擎 frame 订阅
  // ============================================================================
  function onEngineFrame(detail) {
    if (!detail || !detail.game) return;
    var game = detail.game;
    state.engineLive = true;

    // 拷贝 engine.inventory.slots(注意:hotbar 是前 6 槽,UI 这边独立维护)
    if (game.inventory && Array.isArray(game.inventory.slots)) {
      // engine inventory 总槽数 21(6 hotbar + 15 backpack),但 UI 屏是 6×4=24 槽
      // 这里把 engine slots 直接映射过来(取 min(24, engine_slots.length))
      var slots = game.inventory.slots;
      var n = Math.min(TOTAL_SLOTS, slots.length);
      for (var i = 0; i < n; i++) {
        state.inventory[i] = slots[i] ? { itemId: slots[i].itemId, count: slots[i].count } : null;
      }
      // 剩余槽位补 null
      for (var j = n; j < TOTAL_SLOTS; j++) state.inventory[j] = null;
      // hotbar 镜像(前 6 槽,UI 共 7 槽,index 5/6 留给 demo 的 disabled)
      for (var k = 0; k < HOTBAR_SIZE; k++) state.hotbar[k] = null;
      for (var m = 0; m < Math.min(HOTBAR_SIZE, slots.length); m++) {
        if (slots[m]) state.hotbar[m] = { itemId: slots[m].itemId, count: slots[m].count };
      }
    }
    // player 位置
    if (game.player) {
      state.player = { x: game.player.x, y: game.player.y, facing: game.player.facing };
    }
  }

  // 5Hz 节流渲染
  var _lastRenderTs = 0;
  var _needsRerender = false;
  function maybeRerender() {
    var now = Date.now();
    if (now - _lastRenderTs < TICK_MS) { _needsRerender = true; return; }
    _lastRenderTs = now;
    rerenderAll();
  }

  // ============================================================================
  // 拖拽状态机(引擎模式下禁用,本地模式下保留 M2.13 行为)
  // ============================================================================
  var DRAG_STATE = {
    IDLE: 'idle', DRAGGING: 'dragging', MERGE: 'merge', MOVE: 'move',
    REJECTED: 'rejected', HOTBAR_REPLACE: 'hotbar-replace'
  };

  function setDragFeedback(node, kind) {
    if (!node) return;
    node.classList.remove('DragSource', 'DragMerge', 'DragMove', 'DragReject', 'DragHotbarTarget');
    if (kind) node.classList.add('Drag' + kind.charAt(0).toUpperCase() + kind.slice(1));
  }
  function clearAllDragFeedback() {
    $$('.DragSource, .DragMerge, .DragMove, .DragReject, .DragHotbarTarget').forEach(function (n) {
      n.classList.remove('DragSource', 'DragMerge', 'DragMove', 'DragReject', 'DragHotbarTarget');
    });
  }

  // 引擎模式下:拖拽 start 提示用户只读,不做 mutation
  // 本地模式下:沿用 M2.13 tryDrop 逻辑
  function startDrag(item, slotEl, sourceKind, sourceIdx) {
    if (state.engineLive) {
      // 视觉提示一下,然后回弹
      slotEl.classList.add('DragSource');
      setTimeout(function () { slotEl.classList.remove('DragSource'); }, 200);
      if (window.__hudBus) window.__hudBus.emit('inventory:read-only', { reason: 'engine', itemId: item.itemId });
      return;
    }
    state.drag = {
      state: DRAG_STATE.DRAGGING,
      item: item,
      source: { kind: sourceKind, idx: sourceIdx },
      el: slotEl
    };
    setDragFeedback(slotEl, 'source');
    if (window.__hudBus) window.__hudBus.emit('inventory:drag-start', { itemId: item.itemId, source: sourceKind });
  }

  function endDrag(targetKind, targetIdx, targetSlotEl) {
    if (state.engineLive) {
      // 引擎模式只读:不做任何 mutation
      clearAllDragFeedback();
      return;
    }
    // 本地模式:沿用 M2.13 tryDrop
    var drag = state.drag;
    if (!drag) return;
    var src = drag.source;
    var item = drag.item;
    var result = tryDrop(src, targetKind, targetIdx, item);
    setDragFeedback(drag.el, null);
    clearAllDragFeedback();
    state.drag = null;
    if (result === 'rejected' && drag.el) {
      drag.el.classList.add('DragRejectShake');
      setTimeout(function () { drag.el.classList.remove('DragRejectShake'); }, 220);
    }
    if (window.__hudBus) {
      window.__hudBus.emit('inventory:drag', { state: result, itemId: item.itemId, from: src, to: { kind: targetKind, idx: targetIdx } });
    }
  }

  function tryDrop(src, targetKind, targetIdx, item) {
    if (src.kind === targetKind && src.idx === targetIdx) return 'rejected';
    if (targetKind === 'hotbar' && targetIdx >= 5) return 'rejected';
    var srcArr = src.kind === 'hotbar' ? state.hotbar : state.inventory;
    var tgtArr = targetKind === 'hotbar' ? state.hotbar : state.inventory;
    var target = tgtArr[targetIdx];
    if (!target) {
      tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
      srcArr[src.idx] = null;
      rerenderAll();
      return 'move';
    }
    var def = describeItem(item.itemId);
    if (def.stackable !== false && target.itemId === item.itemId) {
      var space = (def.stackMax || STACK_MAX) - target.count;
      if (space <= 0) {
        tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
        srcArr[src.idx] = { itemId: target.itemId, count: target.count };
        rerenderAll();
        return 'move';
      }
      var take = Math.min(space, item.count);
      target.count += take;
      item.count -= take;
      if (item.count <= 0) srcArr[src.idx] = null;
      else srcArr[src.idx] = { itemId: item.itemId, count: item.count };
      rerenderAll();
      return 'merge';
    }
    tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
    srcArr[src.idx] = { itemId: target.itemId, count: target.count };
    rerenderAll();
    return 'move';
  }

  // ============================================================================
  // 物品槽渲染
  // ============================================================================
  function renderItemSlot(arr, idx, kind, opts) {
    opts = opts || {};
    var item = arr[idx];
    var def = item ? describeItem(item.itemId) : null;
    var readOnly = !!opts.readOnly;
    var slotClasses = 'ItemSlot' + (item ? ' is-filled' : ' is-empty') + (opts.disabled ? ' is-disabled' : '');
    if (readOnly && item) slotClasses += ' is-readonly';

    var slot = el('div', {
      class: slotClasses,
      dataset: { kind: kind, idx: String(idx) },
      draggable: !!(item && !readOnly && !opts.disabled),
      tabindex: '0',
      role: 'button',
      'aria-label': item ? (def.name + ' × ' + item.count) : '空槽'
    });

    if (item && def) {
      var art = el('div', { class: 'ItemSlot-Art' }, def.icon);
      slot.appendChild(art);
      slot.appendChild(el('div', { class: 'ItemSlot-Name' }, def.name));
      if (item.count > 1) {
        slot.appendChild(el('div', { class: 'ItemSlot-Stack' }, '×' + item.count));
      }
      // 拖拽(只在非 readOnly 时绑)
      if (!readOnly) {
        slot.addEventListener('dragstart', function (e) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: kind, idx: idx, itemId: item.itemId }));
          startDrag(item, slot, kind, idx);
        });
        slot.addEventListener('dragend', function () {
          if (state.drag) {
            setDragFeedback(state.drag.el, null);
            clearAllDragFeedback();
            state.drag = null;
          }
        });
        slot.addEventListener('dragover', function (e) {
          if (!state.drag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var def2 = describeItem(item.itemId);
          if (def2 && def2.stackMax && state.drag.item.itemId === item.itemId && item.count < def2.stackMax) {
            setDragFeedback(slot, 'merge');
          } else {
            setDragFeedback(slot, 'move');
          }
        });
        slot.addEventListener('dragleave', function () { slot.classList.remove('DragMerge', 'DragMove'); });
        slot.addEventListener('drop', function (e) { e.preventDefault(); if (state.drag) endDrag(kind, idx, slot); });
      }
      slot.addEventListener('click', function () { openItemDetail(item.itemId, item); });
    } else {
      slot.appendChild(el('div', { class: 'ItemSlot-Empty' }, '·'));
      if (!readOnly) {
        slot.addEventListener('dragover', function (e) {
          if (!state.drag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragFeedback(slot, 'move');
        });
        slot.addEventListener('dragleave', function () { slot.classList.remove('DragMove'); });
        slot.addEventListener('drop', function (e) { e.preventDefault(); if (state.drag) endDrag(kind, idx, slot); });
      }
    }
    return slot;
  }

  // ============================================================================
  // 4 屏渲染
  // ============================================================================

  function renderInventory(container) {
    container.innerHTML = '';
    if (state.engineLive) {
      container.appendChild(el('div', { class: 'Screen-BindBadge' }, '🔗 引擎只读 · 拖拽暂未接入'));
    } else {
      container.appendChild(el('div', { class: 'Screen-BindBadge is-demo' }, '加载中…'));
    }
    var grid = el('div', { class: 'InventoryGrid' });
    for (var i = 0; i < state.inventory.length; i++) {
      grid.appendChild(renderItemSlot(state.inventory, i, 'inventory', { readOnly: state.engineLive }));
    }
    container.appendChild(grid);
    var used = state.inventory.filter(function (s) { return s; }).length;
    var summary = el('div', { class: 'InventorySummary' }, '槽位: ' + used + ' / ' + state.inventory.length);
    container.appendChild(summary);
  }

  // 实时校验材料(从 state.inventory 数 count)
  function countItem(itemId) {
    var total = 0;
    for (var i = 0; i < state.inventory.length; i++) {
      var s = state.inventory[i];
      if (s && s.itemId === itemId) total += s.count;
    }
    return total;
  }

  // 合成配方:优先用 __itemsCatalog.allRecipes(),本地 fallback 留 4 条
  function getRecipes() {
    var c = window.__itemsCatalog;
    if (c && typeof c.allRecipes === 'function' && c.isReady && c.isReady()) {
      var list = c.allRecipes();
      if (list && list.length) return list;
    }
    return [
      { id: 'r_rope',    name: '绳索',     result: { itemId: 'twine',   count: 1 }, cost: [{ itemId: 'twine',   count: 3 }], tab: 'basic' },
      { id: 'r_boards',  name: '木板',     result: { itemId: 'twine',   count: 2 }, cost: [{ itemId: 'log',     count: 2 }], tab: 'basic' },
      { id: 'r_torch',   name: '火把',     result: { itemId: 'torch',   count: 2 }, cost: [{ itemId: 'log',     count: 1 }, { itemId: 'twine', count: 1 }], tab: 'basic' },
      { id: 'r_axe',     name: '斧头',     result: { itemId: 'axe',     count: 1 }, cost: [{ itemId: 'log',     count: 2 }, { itemId: 'flint', count: 1 }], tab: 'tools' }
    ];
  }

  function renderCrafting(container) {
    container.innerHTML = '';
    if (state.engineLive) {
      container.appendChild(el('div', { class: 'Screen-BindBadge' }, '🔗 引擎校验 · 合成动作需 engine:craft 接入'));
    } else {
      container.appendChild(el('div', { class: 'Screen-BindBadge is-demo' }, '加载中…'));
    }
    var list = el('div', { class: 'CraftingList' });
    var recipes = getRecipes();
    list.appendChild(el('div', { class: 'Panel-Header' }, '合成配方 · ' + recipes.length));
    recipes.forEach(function (r) {
      var card = el('div', { class: 'CraftingCard' });
      card.appendChild(el('div', { class: 'CraftingCard-Name' }, '▸ ' + r.name));
      var costText = r.cost.map(function (c) {
        var def = describeItem(c.itemId);
        return def.name + ' ×' + c.count;
      }).join(' + ');
      card.appendChild(el('div', { class: 'CraftingCard-Cost' }, '需求: ' + costText));
      var resDef = describeItem(r.result.itemId);
      card.appendChild(el('div', { class: 'CraftingCard-Result' }, '产出: ' + resDef.name + ' ×' + r.result.count));
      var canCraft = r.cost.every(function (c) { return countItem(c.itemId) >= c.count; });
      var btn = el('button', { class: 'Button Button-Primary CraftingCard-Craft' }, canCraft ? '合成' : '材料不足');
      if (!canCraft) btn.setAttribute('disabled', '');
      btn.addEventListener('click', function () {
        if (!canCraft) return;
        if (state.engineLive) {
          // 引擎模式:emit 合成请求,等引擎侧实现监听
          if (window.__hudBus) window.__hudBus.emit('engine:craft', { recipeId: r.id, cost: r.cost, result: r.result });
          if (window.console) console.info('[screens] engine:craft requested', r.id);
        } else {
          // 本地模式:模拟合成
          r.cost.forEach(function (c) {
            var need = c.count;
            for (var i = 0; i < state.inventory.length && need > 0; i++) {
              var s = state.inventory[i];
              if (s && s.itemId === c.itemId) {
                var take = Math.min(s.count, need);
                s.count -= take; need -= take;
                if (s.count <= 0) state.inventory[i] = null;
              }
            }
          });
          var placed = false;
          for (var j = 0; j < state.inventory.length; j++) {
            if (!state.inventory[j]) {
              state.inventory[j] = { itemId: r.result.itemId, count: r.result.count };
              placed = true; break;
            }
          }
          if (!placed) {
            for (var k = 0; k < state.inventory.length; k++) {
              var s2 = state.inventory[k];
              if (s2 && s2.itemId === r.result.itemId) { s2.count += r.result.count; break; }
            }
          }
          rerenderAll();
          if (window.__hudBus) window.__hudBus.emit('crafting:complete', { recipeId: r.id });
        }
      });
      card.appendChild(btn);
      list.appendChild(card);
    });
    container.appendChild(list);
    var tabs = el('div', { class: 'CraftingTabs' });
    ['basic', 'tools', 'survival', 'magic'].forEach(function (t) {
      var tab = el('span', { class: 'CraftingTab' + (t === 'basic' ? ' is-active' : '') }, t);
      tab.addEventListener('click', function () {
        $$('.CraftingTab', tabs).forEach(function (n) { n.classList.remove('is-active'); });
        tab.classList.add('is-active');
      });
      tabs.appendChild(tab);
    });
    container.appendChild(tabs);
  }

  // 群系中文标签
  var BIOME_CN = {
    desert: '荒漠', marsh: '沼泽', snow: '雪原', volcano: '火山', forest: '森林'
  };

  function renderMap(container) {
    container.innerHTML = '';
    if (state.engineLive) {
      container.appendChild(el('div', { class: 'Screen-BindBadge' }, '🔗 引擎 · 实时位置'));
    } else {
      container.appendChild(el('div', { class: 'Screen-BindBadge is-demo' }, '加载中…'));
    }
    var wrap = el('div', { class: 'MapWrap' });
    var canvas = el('canvas', { class: 'MapCanvas' });
    canvas.width = 800; canvas.height = 500;
    wrap.appendChild(canvas);
    var overlay = el('div', { class: 'MapOverlay' });
    var pois = [
      { x: '20%', y: '30%', label: '营地',   color: 'var(--accent)' },
      { x: '55%', y: '20%', label: '矿脉',   color: 'var(--fg-muted)' },
      { x: '70%', y: '65%', label: '沼泽',   color: '#5a7a4a' },
      { x: '40%', y: '80%', label: '森林',   color: 'var(--accent-3)' },
      { x: '85%', y: '40%', label: '遗迹',   color: 'var(--warn-sanity)' }
    ];
    pois.forEach(function (p) {
      var pin = el('div', { class: 'MapPin' });
      pin.style.left = p.x; pin.style.top = p.y;
      pin.style.background = p.color;
      var tip = el('div', { class: 'MapPin-Tip' }, p.label);
      pin.appendChild(tip);
      overlay.appendChild(pin);
    });
    wrap.appendChild(overlay);
    var info = el('div', { class: 'MapInfo' });
    container.appendChild(wrap);
    container.appendChild(info);
    drawMapTerrain(canvas, info, pois);
  }

  function drawMapTerrain(canvas, infoEl, pois) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 4 群系色块(参考 BIOMES 顺序:desert/marsh/snow/volcano)
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 群系色(从 engine.world.biome? 如果没有则用占位色)
    var game = window.__game;
    var colors = ['#c9a96e', '#5a5a3a', '#dcdcdc', '#3a2a2a'];  // desert/marsh/snow/volcano
    if (state.engineLive && game && game.world) {
      // 如果 world 有 biome 颜色表,优先用
      var w = game.world;
      if (w.BIOMES) {
        var b = w.BIOMES;
        colors = [b.desert && b.desert.primary || colors[0], b.marsh && b.marsh.primary || colors[1], b.snow && b.snow.primary || colors[2], b.volcano && b.volcano.primary || colors[3]];
      }
    }
    // 画 4 群系色块
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, 400, 250);
    ctx.fillStyle = colors[1]; ctx.fillRect(400, 0, 400, 250);
    ctx.fillStyle = colors[2]; ctx.fillRect(0, 250, 300, 250);
    ctx.fillStyle = colors[3]; ctx.fillRect(300, 250, 500, 250);
    // 网格
    ctx.strokeStyle = 'rgba(212, 166, 74, 0.15)';
    ctx.lineWidth = 1;
    for (var x = 0; x < canvas.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (var yy = 0; yy < canvas.height; yy += 32) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(canvas.width, yy); ctx.stroke(); }
    // 玩家位置(实时)
    var px = canvas.width / 2, py = canvas.height / 2;
    var biomeLabel = '—';
    var dayLabel = 'Day · 加载中…';
    if (state.engineLive && game) {
      if (game.player) {
        // 把世界坐标 (0..world.width, 0..world.height) 映射到 canvas 像素
        var w = game.world;
        if (w && w.width && w.height) {
          px = (game.player.x / w.width) * canvas.width;
          py = (game.player.y / w.height) * canvas.height;
          // 当前位置群系
          try {
            var tx = Math.floor(game.player.x), ty = Math.floor(game.player.y);
            if (tx >= 0 && ty >= 0 && tx < w.width && ty < w.height) {
              var code;
              if (typeof w.idx === 'function') code = w.idx(tx, ty);
              else code = w.tiles[ty * w.width + tx];
              var table = w.CODE_TO_BIOME || w.codeToBiome;
              if (Array.isArray(table) && typeof code === 'number' && code >= 0 && code < table.length) {
                var bid = table[code];
                biomeLabel = (BIOME_CN[bid] || bid);
              }
            }
          } catch (e) { /* swallow */ }
        }
      }
      if (game.dayCycle && typeof game.dayCycle.describe === 'function') {
        dayLabel = game.dayCycle.describe();
      }
    }
    ctx.fillStyle = '#d4a64a';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 底部信息条
    if (infoEl) {
      infoEl.innerHTML = '';
      var xCoord = state.engineLive && game && game.player ? Math.floor(game.player.x) : '-';
      var yCoord = state.engineLive && game && game.player ? Math.floor(game.player.y) : '-';
      infoEl.appendChild(el('span', {}, '坐标: '));
      infoEl.appendChild(el('span', { style: { color: 'var(--accent)' } }, 'X: ' + xCoord + '  Y: ' + yCoord));
      infoEl.appendChild(el('span', { style: { marginLeft: 'var(--sp-24)' } }, '群系: '));
      infoEl.appendChild(el('span', { style: { color: 'var(--accent)' } }, biomeLabel));
      infoEl.appendChild(el('span', { style: { marginLeft: 'var(--sp-24)' } }, dayLabel));
    }
  }

  // 任务屏(引擎未暴露 quest,先沿用 mock + 角标)
  var MOCK_QUESTS = [
    { id: 'q_intro',   title: '第一章 · 落地',  desc: '在荒野中醒来。收集 5 树枝,生起第一堆火。',       status: 'active',  progress: { twine: 4 },     goal: { twine: 5 } },
    { id: 'q_shelter', title: '第二章 · 庇护所', desc: '夜幕将至。合成 1 绳索,搭建简易帐篷。',          status: 'active',  progress: { torch: 0 },    goal: { torch: 1 } },
    { id: 'q_explore', title: '第三章 · 探索',   desc: '深入丛林。击杀 3 只猎犬,寻找失落的矿脉。',      status: 'locked',  progress: {},           goal: { hound: 3 } },
    { id: 'q_side_a',  title: '支线 · 篝火晚宴', desc: '在篝火旁烹饪 1 份烤肉,恢复饥饿值。',            status: 'active',  progress: { cooked: 0 },  goal: { cooked: 1 } },
    { id: 'q_side_b',  title: '支线 · 寻宝者',   desc: '收集 10 块石头,合成 1 把镐子。',                status: 'done',    progress: { pickaxe: 1 }, goal: { pickaxe: 1 } }
  ];

  function renderQuest(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'Screen-BindBadge is-pending' }, '⏳ 任务系统待引擎接入 (M2.14)'));
    var list = el('div', { class: 'QuestList' });
    var active = MOCK_QUESTS.filter(function (q) { return q.status === 'active'; });
    var done = MOCK_QUESTS.filter(function (q) { return q.status === 'done'; });
    var locked = MOCK_QUESTS.filter(function (q) { return q.status === 'locked'; });
    function makeSection(title, quests) {
      if (!quests.length) return null;
      var sec = el('div', { class: 'QuestSection' });
      sec.appendChild(el('div', { class: 'Panel-Header' }, title + ' · ' + quests.length));
      quests.forEach(function (q) {
        var card = el('div', { class: 'QuestCard QuestCard-' + q.status });
        card.appendChild(el('div', { class: 'QuestCard-Title' }, q.title));
        card.appendChild(el('div', { class: 'QuestCard-Desc' }, q.desc));
        var progKeys = Object.keys(q.progress);
        if (progKeys.length) {
          progKeys.forEach(function (k) {
            var p = q.progress[k] || 0;
            // 优先用真实库存数替换 mock 进度(只对材料类)
            if (k === 'twine' || k === 'torch' || k === 'pickaxe') {
              p = countItem(k);
            }
            var g = q.goal[k] || 1;
            var ratio = Math.min(1, p / g);
            var bar = el('div', { class: 'QuestCard-Progress' });
            var fill = el('div', { class: 'QuestCard-Progress-Fill' });
            fill.style.width = (ratio * 100) + '%';
            bar.appendChild(fill);
            bar.appendChild(el('span', { class: 'QuestCard-Progress-Text' }, p + ' / ' + g));
            card.appendChild(bar);
          });
        }
        list.appendChild(card);
      });
      return sec;
    }
    if (makeSection('进行中', active)) list.appendChild(makeSection('进行中', active));
    if (makeSection('已完成', done)) list.appendChild(makeSection('已完成', done));
    if (makeSection('未解锁', locked)) list.appendChild(makeSection('未解锁', locked));
    container.appendChild(list);
  }

  // ============================================================================
  // 详情卡
  // ============================================================================
  function openItemDetail(itemId, slot) {
    var def = describeItem(itemId);
    var old = $('.Dialog-ScreenOverlay');
    if (old) old.remove();
    var overlay = el('div', { class: 'Dialog-Overlay Dialog-ScreenOverlay' });
    var dialog = el('div', { class: 'Dialog', role: 'dialog', 'aria-label': def.name });
    var closeBtn = el('button', { class: 'Dialog-Close', 'aria-label': '关闭' }, '×');
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    var header = el('div', { class: 'Dialog-Header' }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' } }, [
        el('div', { class: 'Codex-Item-Art' }, [
          el('span', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-18)', color: 'var(--accent)' } }, def.icon)
        ]),
        el('div', {}, [
          el('div', { class: 'Dialog-Title' }, def.name),
          el('div', { class: 'Codex-Detail-Sci' }, 'ID: ' + itemId + (slot ? ' × ' + slot.count : ''))
        ])
      ]),
      closeBtn
    ]);
    var body = el('div', { class: 'Dialog-Body' }, [
      el('div', { class: 'Codex-Detail-Section' }, [
        el('div', { class: 'Codex-Detail-Section-Title' }, '▸ 属性'),
        el('div', { class: 'Codex-Detail-Section-Body' }, '堆叠上限: ' + (def.stackMax || STACK_MAX))
      ])
    ]);
    var footer = el('div', { class: 'Dialog-Footer' }, [
      el('button', { class: 'Button Button-Secondary' }, '关闭')
    ]);
    footer.firstChild.addEventListener('click', function () { overlay.remove(); });
    dialog.appendChild(header); dialog.appendChild(body); dialog.appendChild(footer);
    overlay.addEventListener('click', function () { overlay.remove(); });
    document.body.appendChild(overlay);
    var onKey = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  // ============================================================================
  // 路由(SPA hash)
  // ============================================================================
  var SCREENS = ['inventory', 'crafting', 'map', 'quest'];
  function route() {
    var hash = (location.hash || '').replace('#/', '').replace('#', '');
    var target = SCREENS.indexOf(hash) >= 0 ? hash : 'inventory';
    state.activeTab = target;
    $$('.Subtab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === target;
      t.classList.toggle('is-active', on);
    });
    SCREENS.forEach(function (s) {
      var node = $('#screen-' + s);
      if (node) node.style.display = (s === target ? '' : 'none');
    });
    var mount = $('#screen-' + target);
    if (!mount) return;
    if (target === 'inventory') renderInventory(mount);
    else if (target === 'crafting') renderCrafting(mount);
    else if (target === 'map') renderMap(mount);
    else if (target === 'quest') renderQuest(mount);
  }

  function rerenderAll() {
    var mount = $('#screen-' + state.activeTab);
    if (!mount) return;
    if (state.activeTab === 'inventory') renderInventory(mount);
    else if (state.activeTab === 'crafting') renderCrafting(mount);
    bindHotbarMirror();
  }

  function bindHotbarMirror() { /* 引擎模式下主 HUD 已绑定,这里 no-op */ }

  // ============================================================================
  // subtab + 快捷键
  // ============================================================================
  function bindSubtabs() {
    var bar = $('.SubtabBar');
    if (!bar) return;
    $$('.Subtab', bar).forEach(function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-tab');
        if (name) location.hash = '#/' + name;
      });
    });
  }
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var map = { 'i': 'inventory', 'c': 'crafting', 'm': 'map', 'q': 'quest' };
      var k = (e.key || '').toLowerCase();
      if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        location.hash = '#/' + map[k];
        e.preventDefault();
      }
      if (k === 'escape') {
        if (location.hash !== '#/inventory') { location.hash = '#/inventory'; e.preventDefault(); }
      }
    });
  }

  // ============================================================================
  // 初始化
  // ============================================================================
  function init() {
    if (!$('.SubtabBar') || !$('#screen-inventory')) return false;
    bindSubtabs();
    bindKeys();
    if (window.__hudBus) {
      window.__hudBus.on('engine:frame', onEngineFrame);
      window.__hudBus.on('tick', function () { state.tickCount++; });
      // 5Hz 节流渲染循环
      setInterval(function () {
        if (_needsRerender) { _needsRerender = false; rerenderAll(); }
      }, TICK_MS);
    } else {
      setTimeout(init, 100);
      return false;
    }
    window.addEventListener('hashchange', route);
    route();
    window.__screensReady = true;
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
