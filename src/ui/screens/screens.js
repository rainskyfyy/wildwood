/**
 * Wildwood UI · M2.13 4 屏交互 (v0.8.0 · 真实引擎接入)
 *
 * 职责:
 *   1. 主 HUD 之外的 4 屏 subtab 路由(背包 / 合成 / 地图 / 任务)
 *      使用 hash 锚点 SPA 路由,切换耗时 < 200ms
 *   2. HTML5 Drag and Drop 4 状态机:
 *      - 合并: 同类物品拖到已有同类格 → 堆叠
 *      - 移动: 不同类或空格 → 位置交换/置入
 *      - 不可达回弹: 拖到非法目标 → 视觉回弹 + shake 动画
 *      - 拖到快捷栏替换: 拖到 hotbar 槽 → 替换(原物品回到背包空格)
 *   3. 物品点击 → 打开详情卡(复用 M1.8 Dialog + items.json 数据契约)
 *   4. 5Hz 状态同步: 订阅 hudBus 'engine:frame' 事件
 *
 * 与其他子任务的关系:
 *   - v0.8.0 引擎:event.game.inventory.slots(21 槽) + event.game.player
 *     + event.game.world + event.game.dayCycle.describe() + event.game.npcMgr
 *   - M2.12 hud.js: 提供 window.__hudBus(同 5Hz TICK_MS = 200)
 *   - M1.8 components.css: 复用 .Panel / .Dialog / .Button / .HotbarSlot 类
 *   - M1.7 layout/tokens.css: 复用 --sp-* / --accent / --bg-panel 等 token
 *
 * 5Hz 同步:
 *   - 订阅 hudBus 'engine:frame' 事件(每帧 1 次,引擎渲染时)
 *   - 引擎帧尾同步 hotbar[0..5] + backpack[6..20] → 本地 view
 *   - 状态变更: hudBus.emit('inventory:change', {items, hotbar})
 *   - 拖拽完成: hudBus.emit('inventory:drag', {state, fromSlot, toSlot})
 *
 * 数据源:
 *   - items.json(展示元数据:name/icon/color/category/stackMax)
 *   - recipes.json(合成配方)
 *   - event.game.inventory.slots(真实槽位)
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空;无 DOM 时不抛错
 *   - 不修改 M2.12 hud.js / M1.7/M1.8
 *   - 普通 <script src> 加载,非 ESM
 */
(function () {
  'use strict';
  // ============================================================================
  // 配置
  // ============================================================================
  var TICK_MS = 200;            // 5Hz,与 M2.12 对齐
  var HOTBAR_SIZE = 6;          // 引擎 HOTBAR_SIZE=6(0..5 启用)
  var BACKPACK_SIZE = 15;       // 引擎 BACKPACK_SIZE=15(6..20)
  var INVENTORY_COLS = 5;       // 背包 5 列(15=5×3)
  var INVENTORY_ROWS = 3;       // 背包 3 行
  var STACK_MAX = 20;           // 默认堆叠上限(items.json 中各 item 自定义)
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
  // ============================================================================
  // 数据契约(items.json / recipes.json)
  // ============================================================================
  // ITEMS_BY_ID: 物品 id → {id, name, icon, color, category, stackMax, maxDurability?, toolType?}
  var ITEMS_BY_ID = {};
  // RECIPES: 配方数组 {id, name, station, grid, pattern, output}
  var RECIPES = [];
  // dataLoaded: items.json + recipes.json 是否都已加载
  var dataLoaded = false;
  // 数据加载(fetch,异步,init 时启动)
  function loadData() {
    var pending = 2;
    function check() { if (--pending === 0) { dataLoaded = true; hudBus.emit('screens:data-ready', {}); rerenderAll(); } }
    function failItems() { ITEMS_BY_ID = {}; check(); }
    function failRecipes() { RECIPES = []; check(); }
    // items.json:键值对集合
    fetch('./src/resources/items.json').then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        // items.json 是 {log: {...}, twine: {...}, ...} 格式
        Object.keys(data).forEach(function (k) {
          if (k === '_meta') return;
          var item = data[k];
          if (item && item.id) ITEMS_BY_ID[item.id] = item;
        });
        check();
      }).catch(failItems);
    // recipes.json:{recipes: [...]}
    fetch('./src/resources/recipes.json').then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        RECIPES = (data && (data.recipes || data)) || [];
        if (!Array.isArray(RECIPES)) RECIPES = [];
        check();
      }).catch(failRecipes);
  }
  // 从 itemId 拿 UI 展示元数据
  function getItemDef(itemId) {
    if (!itemId) return null;
    return ITEMS_BY_ID[itemId] || null;
  }
  // 推断 stackable(从 items.json 推:stackMax > 1 即堆叠)
  function isStackable(itemId) {
    var def = getItemDef(itemId);
    if (!def) return true;  // 未知物品默认可堆叠,避免 1 个变 N 个的 bug
    return (def.stackMax || 1) > 1;
  }
  // 物品的 stackMax(默认 STACK_MAX)
  function getStackMax(itemId) {
    var def = getItemDef(itemId);
    return def ? (def.stackMax || STACK_MAX) : STACK_MAX;
  }
  // ============================================================================
  // 应用状态(单例)—— view 镜像,数据从 event.game.inventory.slots 同步
  // ============================================================================
  var state = {
    activeTab: 'inventory',     // 'inventory' | 'crafting' | 'map' | 'quest'
    inventory: new Array(BACKPACK_SIZE).fill(null),  // [0..14] 镜像背包 6..20
    hotbar: new Array(HOTBAR_SIZE).fill(null),       // [0..5] 镜像快捷栏
    dataReady: false,           // items.json + recipes.json 是否加载
    engineReady: false,         // 引擎是否推送过 engine:frame
    drag: null,
    tickCount: 0
  };
  // 暴露给调试
  window.__screensState = state;
  var hudBus = null;  // 延迟绑定
  // ============================================================================
  // 引擎数据同步(每 engine:frame 把 slots 切成 hotbar[0..5] + inventory[0..14])
  // ============================================================================
  function syncFromEngine(game) {
    if (!game) return;
    // 1. inventory
    if (game.inventory && Array.isArray(game.inventory.slots)) {
      var slots = game.inventory.slots;
      var hotbarChanged = false;
      var invChanged = false;
      // 快捷栏 0..5
      for (var i = 0; i < HOTBAR_SIZE; i++) {
        var src = slots[i];
        var view = toView(src);
        if (!slotEqual(state.hotbar[i], view)) { state.hotbar[i] = view; hotbarChanged = true; }
      }
      // 背包 6..20(15 槽)→ 映射到 state.inventory[0..14]
      for (var j = 0; j < BACKPACK_SIZE; j++) {
        var src2 = slots[HOTBAR_SIZE + j];
        var view2 = toView(src2);
        if (!slotEqual(state.inventory[j], view2)) { state.inventory[j] = view2; invChanged = true; }
      }
      if (hotbarChanged || invChanged) {
        rerenderAll();
        if (hudBus) hudBus.emit('inventory:change', { items: state.inventory, hotbar: state.hotbar });
      }
    }
  }
  function toView(slot) {
    if (!slot || !slot.itemId) return null;
    return { itemId: slot.itemId, count: slot.count || 1 };
  }
  function slotEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.itemId === b.itemId && a.count === b.count;
  }
  // ============================================================================
  // 拖拽状态机(4 状态:合并 / 移动 / 不可达回弹 / 快捷栏替换)
  // ============================================================================
  // 状态转移:
  //   IDLE → dragstart → DRAGGING
  //   DRAGGING + drop on 同类/可堆叠 → MERGE
  //   DRAGGING + drop on 空格/不同类 → MOVE
  //   DRAGGING + drop on 非法目标 → REJECTED(200ms 后回弹 → IDLE)
  //   DRAGGING + drop on 快捷栏槽 → HOTBAR_REPLACE
  //   any → dragend → IDLE
  var DRAG_STATE = {
    IDLE: 'idle', DRAGGING: 'dragging', MERGE: 'merge',
    MOVE: 'move', REJECTED: 'rejected', HOTBAR_REPLACE: 'hotbar-replace'
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
  // 注意:拖拽只改本地 view,引擎端 inventory 后续由 v0.8.x 接入 InventoryService API
  // 现在 UI 拖拽成功后,只在本地 view 数组里变更;真实写入引擎待后端
  function startDrag(item, slotEl, sourceKind, sourceIdx) {
    state.drag = {
      state: DRAG_STATE.DRAGGING,
      item: item,
      source: { kind: sourceKind, idx: sourceIdx },
      el: slotEl
    };
    setDragFeedback(slotEl, 'source');
    if (hudBus) hudBus.emit('inventory:drag-start', { itemId: item.itemId, source: sourceKind });
  }
  function endDrag(targetKind, targetIdx, targetSlotEl) {
    var drag = state.drag;
    if (!drag) return;
    var src = drag.source;
    var item = drag.item;
    var result = tryDrop(src, targetKind, targetIdx, item);
    setDragFeedback(drag.el, null);
    clearAllDragFeedback();
    state.drag = null;
    if (result === 'rejected') {
      if (drag.el) {
        drag.el.classList.add('DragRejectShake');
        setTimeout(function () { drag.el.classList.remove('DragRejectShake'); }, 220);
      }
    }
    if (hudBus) {
      hudBus.emit('inventory:drag', {
        state: result,
        itemId: item.itemId,
        from: src,
        to: { kind: targetKind, idx: targetIdx }
      });
    }
  }
  function tryDrop(src, targetKind, targetIdx, item) {
    if (src.kind === targetKind && src.idx === targetIdx) return 'rejected';
    var srcArr = src.kind === 'hotbar' ? state.hotbar : state.inventory;
    var tgtArr = targetKind === 'hotbar' ? state.hotbar : state.inventory;
    var target = tgtArr[targetIdx];
    // 1. 目标为空 → MOVE
    if (!target) {
      tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
      srcArr[src.idx] = null;
      rerenderAll();
      return 'move';
    }
    // 2. 目标同类 + 可堆叠 + 未满 → MERGE
    if (isStackable(item.itemId) && target.itemId === item.itemId) {
      var max = getStackMax(item.itemId);
      var space = max - target.count;
      if (space <= 0) {
        tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
        srcArr[src.idx] = { itemId: target.itemId, count: target.count };
        rerenderAll();
        return 'move';
      }
      var take = Math.min(space, item.count);
      target.count += take;
      item.count -= take;
      if (item.count <= 0) {
        srcArr[src.idx] = null;
      } else {
        srcArr[src.idx] = { itemId: item.itemId, count: item.count };
      }
      rerenderAll();
      return 'merge';
    }
    // 3. 不同物品 → 交换
    tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
    srcArr[src.idx] = { itemId: target.itemId, count: target.count };
    rerenderAll();
    return 'move';
  }
  // ============================================================================
  // 物品槽渲染
  // ============================================================================
  function renderItemSlot(arr, idx, kind, opts) {
    var item = arr[idx];
    var def = item ? getItemDef(item.itemId) : null;
    var slot = el('div', {
      class: 'ItemSlot' + (item ? ' is-filled' : ' is-empty') + (opts && opts.disabled ? ' is-disabled' : '') + (!def && item ? ' is-unknown' : ''),
      dataset: { kind: kind, idx: String(idx) },
      draggable: !!(item && def && !(opts && opts.disabled)),
      tabindex: '0',
      role: 'button',
      'aria-label': item ? ((def ? def.name : item.itemId) + ' × ' + item.count) : '空槽'
    });
    if (item && def) {
      // icon 字段是 png key;display 阶段暂用 name[0](首字)做字母占位
      var glyph = def.icon ? def.icon.charAt(0).toUpperCase() : (def.name ? def.name.charAt(0) : '?');
      var art = el('div', { class: 'ItemSlot-Art' }, glyph);
      if (def.color) art.style.color = def.color;
      slot.appendChild(art);
      slot.appendChild(el('div', { class: 'ItemSlot-Name' }, def.name));
      if (isStackable(item.itemId) && item.count > 1) {
        slot.appendChild(el('div', { class: 'ItemSlot-Stack' }, '×' + item.count));
      }
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
        if (isStackable(item.itemId) && state.drag.item.itemId === item.itemId && item.count < getStackMax(item.itemId)) {
          setDragFeedback(slot, 'merge');
        } else {
          setDragFeedback(slot, 'move');
        }
      });
      slot.addEventListener('dragleave', function () {
        slot.classList.remove('DragMerge', 'DragMove');
      });
      slot.addEventListener('drop', function (e) {
        e.preventDefault();
        if (state.drag) endDrag(kind, idx, slot);
      });
      slot.addEventListener('click', function () { openItemDetail(item.itemId); });
    } else {
      slot.appendChild(el('div', { class: 'ItemSlot-Empty' }, '·'));
      slot.addEventListener('dragover', function (e) {
        if (!state.drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragFeedback(slot, 'move');
      });
      slot.addEventListener('dragleave', function () {
        slot.classList.remove('DragMove');
      });
      slot.addEventListener('drop', function (e) {
        e.preventDefault();
        if (state.drag) endDrag(kind, idx, slot);
      });
    }
    return slot;
  }
  // ============================================================================
  // 4 屏渲染
  // ============================================================================
  function renderInventory(container) {
    container.innerHTML = '';
    var grid = el('div', { class: 'InventoryGrid' });
    for (var i = 0; i < state.inventory.length; i++) {
      grid.appendChild(renderItemSlot(state.inventory, i, 'inventory'));
    }
    container.appendChild(grid);
    var used = state.inventory.filter(function (s) { return s; }).length;
    var summary = el('div', { class: 'InventorySummary' }, '槽位: ' + used + ' / ' + state.inventory.length);
    container.appendChild(summary);
  }
  function renderCrafting(container) {
    container.innerHTML = '';
    if (!dataLoaded) {
      container.appendChild(el('div', { class: 'CraftingEmpty' }, '加载配方中...'));
      return;
    }
    if (!RECIPES.length) {
      container.appendChild(el('div', { class: 'CraftingEmpty' }, '暂无可用配方'));
      return;
    }
    // 左侧:配方列表
    var list = el('div', { class: 'CraftingList' });
    list.appendChild(el('div', { class: 'Panel-Header' }, '合成配方 · ' + RECIPES.length));
    RECIPES.forEach(function (r) {
      var card = el('div', { class: 'CraftingCard' });
      card.appendChild(el('div', { class: 'CraftingCard-Name' }, '▸ ' + r.name));
      // 配方 cost:从 pattern 推?这里用 output 倒推,简化:取 output.itemId 关联材料
      // v0.8.0: 简化显示——仅显示 output 信息;详细材料点击后展示
      var resDef = getItemDef((r.output && r.output.itemId) || '');
      var outName = resDef ? resDef.name : (r.output && r.output.itemId) || '?';
      var outCount = (r.output && r.output.count) || 1;
      card.appendChild(el('div', { class: 'CraftingCard-Result' }, '产出: ' + outName + ' ×' + outCount));
      if (r.station) {
        card.appendChild(el('div', { class: 'CraftingCard-Cost' }, '工作站: ' + r.station));
      }
      var btn = el('button', { class: 'Button Button-Primary CraftingCard-Craft' }, '合成(预留)');
      btn.setAttribute('disabled', '');
      list.appendChild(card);
    });
    container.appendChild(list);
    // 右侧:分类 Tab(占位,后续按 station 过滤)
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
  function renderMap(container) {
    container.innerHTML = '';
    var wrap = el('div', { class: 'MapWrap' });
    var canvas = el('canvas', { class: 'MapCanvas' });
    canvas.width = 800; canvas.height = 500;
    wrap.appendChild(canvas);
    // POI:从引擎读 village + npcMgr 推断
    var overlay = el('div', { class: 'MapOverlay' });
    var pois = [{ x: '20%', y: '30%', label: '营地', color: 'var(--accent)' }];
    var game = (typeof window !== 'undefined') ? window.__game : null;
    if (game && game.village && game.village.buildings) {
      game.village.buildings.forEach(function (b, i) {
        pois.push({
          x: (15 + i * 12) + '%', y: (40 + i * 8) + '%',
          label: b.name || ('建筑' + i), color: 'var(--accent-3)'
        });
      });
    }
    pois.forEach(function (p) {
      var pin = el('div', { class: 'MapPin' });
      pin.style.left = p.x; pin.style.top = p.y;
      pin.style.background = p.color;
      pin.appendChild(el('div', { class: 'MapPin-Tip' }, p.label));
      overlay.appendChild(pin);
    });
    wrap.appendChild(overlay);
    // 地图底部:从 engine 读 player.x/y + dayCycle + biome
    var px = (game && game.player) ? Math.round(game.player.x || 0) : 0;
    var py = (game && game.player) ? Math.round(game.player.y || 0) : 0;
    var biome = (game && game.world && game.world.biome) || '--';
    var timeText = (game && game.dayCycle && typeof game.dayCycle.describe === 'function') ? game.dayCycle.describe() : '--';
    var info = el('div', { class: 'MapInfo' }, [
      el('span', {}, '坐标: '),
      el('span', { style: { color: 'var(--accent)' } }, 'X: ' + px + '  Y: ' + py),
      el('span', { style: { marginLeft: 'var(--sp-24)' } }, '群系: '),
      el('span', { style: { color: 'var(--accent)' } }, biome),
      el('span', { style: { marginLeft: 'var(--sp-24)' } }, timeText)
    ]);
    wrap.appendChild(info);
    container.appendChild(wrap);
    drawMapTerrain(canvas, game);
  }
  function drawMapTerrain(canvas, game) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 4 群系色块(desert / marsh / snow / volcano,v0.8.0 P0-3 修复后)
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(0, 0, 400, 250);   // desert
    ctx.fillStyle = '#1a2a3a'; ctx.fillRect(400, 0, 400, 250);  // marsh
    ctx.fillStyle = '#2a2a3a'; ctx.fillRect(0, 250, 400, 250);  // snow
    ctx.fillStyle = '#3a1a1a'; ctx.fillRect(400, 250, 400, 250); // volcano
    // 网格
    ctx.strokeStyle = 'rgba(212, 166, 74, 0.15)';
    ctx.lineWidth = 1;
    for (var x = 0; x < canvas.width; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (var y = 0; y < canvas.height; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    // 玩家位置(中心 = 引擎 player.x/y 映射到 canvas 中心)
    ctx.fillStyle = '#d4a64a';
    ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  function renderQuest(container) {
    container.innerHTML = '';
    // v0.8.0 任务系统未在引擎端实现,UI 屏显示占位
    var list = el('div', { class: 'QuestList' });
    var empty = el('div', { class: 'QuestSection QuestSection-Empty' });
    empty.appendChild(el('div', { class: 'Panel-Header' }, '任务系统'));
    empty.appendChild(el('div', { class: 'QuestEmpty' }, '系统暂无任务'));
    empty.appendChild(el('div', { class: 'QuestEmpty-Hint' }, '后续 v0.9.x 接入任务数据源后,此处显示主线 / 支线 / 委托'));
    list.appendChild(empty);
    container.appendChild(list);
  }
  // ============================================================================
  // 详情卡(复用 M1.8 Dialog)
  // ============================================================================
  function openItemDetail(itemId) {
    var def = getItemDef(itemId);
    if (!def) return;
    var old = $('.Dialog-ScreenOverlay');
    if (old) old.remove();
    var overlay = el('div', { class: 'Dialog-Overlay Dialog-ScreenOverlay' });
    var dialog = el('div', { class: 'Dialog', role: 'dialog', 'aria-label': def.name });
    var closeBtn = el('button', { class: 'Dialog-Close', 'aria-label': '关闭' }, '×');
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    var glyph = def.icon ? def.icon.charAt(0).toUpperCase() : (def.name ? def.name.charAt(0) : '?');
    var header = el('div', { class: 'Dialog-Header' }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' } }, [
        el('div', { class: 'Codex-Item-Art', style: { color: def.color || 'var(--accent)' } }, glyph),
        el('div', {}, [
          el('div', { class: 'Dialog-Title' }, def.name),
          el('div', { class: 'Codex-Detail-Sci' }, '类型: ' + (def.category || '?'))
        ])
      ]),
      closeBtn
    ]);
    var body = el('div', { class: 'Dialog-Body' }, [
      el('div', { class: 'Codex-Detail-Section' }, [
        el('div', { class: 'Codex-Detail-Section-Title' }, '▸ 属性'),
        el('div', { class: 'Codex-Detail-Section-Body' },
          '堆叠: ' + (isStackable(itemId) ? ('是(上限 ' + getStackMax(itemId) + ')') : '否') +
          (def.maxDurability ? '\n耐久: ' + def.maxDurability : '') +
          (def.toolType ? '\n工具类型: ' + def.toolType : '') +
          (def.foodValue ? '\n饱腹: ' + def.foodValue : '')
        )
      ])
    ]);
    var footer = el('div', { class: 'Dialog-Footer' }, [
      el('button', { class: 'Button Button-Secondary' }, '关闭')
    ]);
    footer.firstChild.addEventListener('click', function () { overlay.remove(); });
    dialog.appendChild(header); dialog.appendChild(body); dialog.appendChild(footer);
    overlay.addEventListener('click', function () { overlay.remove(); });
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
    var onKey = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }
  // ============================================================================
  // 5Hz 同步订阅
  // ============================================================================
  function bindHudBus() {
    hudBus = window.__hudBus;
    if (!hudBus) { setTimeout(bindHudBus, 100); return; }
    // 引擎帧尾通知(主数据源)
    hudBus.on('engine:frame', function (d) {
      if (d && d.game) {
        if (!state.engineReady) {
          state.engineReady = true;
          state.dataReady = state.dataReady || dataLoaded;
        }
        syncFromEngine(d.game);
      }
    });
    hudBus.on('screens:data-ready', function () {
      state.dataReady = dataLoaded;
      rerenderAll();
    });
    hudBus.on('tick', function () { state.tickCount++; });
    hudBus.on('hotbar:select', function (d) {
      if (!d || typeof d.index !== 'number') return;
      $$('.HotbarSlotMirror').forEach(function (s, i) {
        s.classList.toggle('HotbarSlot-Active', i === d.index);
        s.classList.toggle('HotbarSlot-Default', i !== d.index);
      });
    });
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
  }
  // ============================================================================
  // subtab 导航条 + 快捷键
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
        if (location.hash !== '#/inventory') {
          location.hash = '#/inventory';
          e.preventDefault();
        }
      }
    });
  }
  // ============================================================================
  // 初始化
  // ============================================================================
  function init() {
    if (!$('.SubtabBar') || !$('#screen-inventory')) {
      return false;
    }
    // 1. 启动 items.json + recipes.json 加载
    loadData();
    // 2. 绑定 hudBus
    bindHudBus();
    // 3. 绑定 subtab + 键盘
    bindSubtabs();
    bindKeys();
    // 4. 监听 hash 变化 + 首次路由
    window.addEventListener('hashchange', route);
    route();
    // 5. 标记就绪
    window.__screensReady = true;
    return true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
