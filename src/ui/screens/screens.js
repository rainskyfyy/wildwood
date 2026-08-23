/**
 * Wildwood UI · M2.13 4 屏交互
 *
 * 职责:
 *   1. 主 HUD 之外的 4 屏 subtab 路由(背包 / 合成 / 地图 / 任务)
 *      使用 hash 锚点 SPA 路由,切换耗时 < 200ms
 *   2. HTML5 Drag and Drop 4 状态机:
 *      - 合并: 同类物品拖到已有同类格 → 堆叠
 *      - 移动: 不同类或空格 → 位置交换/置入
 *      - 不可达回弹: 拖到非法目标 → 视觉回弹 + shake 动画
 *      - 拖到快捷栏替换: 拖到 hotbar 槽 → 替换(原物品回到背包空格)
 *   3. 物品点击 → 打开详情卡(复用 M1.8 Dialog + M2.11 codex 数据契约)
 *   4. 5Hz 状态同步: 订阅 window.__hudBus(M2.12),状态变化推回 bus
 *
 * 与其他子任务的关系:
 *   - M2.12 hud.js: 提供 window.__hudBus(同 5Hz TICK_MS = 200)
 *   - M2.11 codex.js: 提供 items.json / creatures.json 数据契约,
 *     screens.js 不直接 import,而是 fetch 自己的 data,避免与 M2.11 模块冲突
 *   - M1.8 components.css: 复用 .Panel / .Dialog / .Button / .HotbarSlot 类
 *   - M1.7 layout/tokens.css: 复用 --sp-* / --accent / --bg-panel 等 token
 *
 * 5Hz 同步:
 *   - 订阅 hudBus 'tick' 事件(每 200ms 一次)
 *   - 状态变更: hudBus.emit('inventory:change', {items, hotbar})
 *   - 拖拽完成: hudBus.emit('inventory:drag', {state, fromSlot, toSlot})
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空;无 DOM 时不抛错
 *   - 不修改 M2.12 hud.js / M1.7/M1.8 / M2.11 codex
 *   - 普通 <script src> 加载,非 ESM
 */

(function () {
  'use strict';

  // ============================================================================
  // 配置
  // ============================================================================

  var TICK_MS = 200;            // 5Hz,与 M2.12 对齐
  var HOTBAR_SIZE = 7;          // 与 M2.12 demo.html 的 5+2 槽对齐
  var INVENTORY_COLS = 6;       // 背包 6 列
  var INVENTORY_ROWS = 4;       // 背包 4 行(共 24 槽)
  var STACK_MAX = 20;           // 同类物品堆叠上限(沿用 M2.10 规范)

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
  // Mock 物品数据(沿用 M2.10 物品规范,等 M2.11 接入后只换 data 来源)
  // ============================================================================
  // 物品: { id, name, icon, type, stackable, maxStack, description }
  // type: 'resource' | 'tool' | 'food' | 'placeable'
  var MOCK_ITEMS = [
    { id: 'twigs',    name: '树枝',   icon: '枝', type: 'resource',  stackable: true,  maxStack: 20, description: '基础资源,3 棵 = 1 捆' },
    { id: 'flint',    name: '燧石',   icon: '石', type: 'resource',  stackable: true,  maxStack: 20, description: '基础资源,概率刷新于沙漠/雪原' },
    { id: 'log',      name: '圆木',   icon: '木', type: 'resource',  stackable: true,  maxStack: 20, description: '1 棵树 = 2 圆木,持斧砍伐' },
    { id: 'cut_grass',name: '草',     icon: '草', type: 'resource',  stackable: true,  maxStack: 20, description: '基础资源,割草获得' },
    { id: 'rope',     name: '绳索',   icon: '绳', type: 'resource',  stackable: true,  maxStack: 20, description: '3 草 = 1 绳,合成基础' },
    { id: 'boards',   name: '木板',   icon: '板', type: 'resource',  stackable: true,  maxStack: 20, description: '圆木合成,建筑用' },
    { id: 'stone',    name: '石头',   icon: '石', type: 'resource',  stackable: true,  maxStack: 20, description: '基础资源,镐采石' },
    { id: 'gold',     name: '金块',   icon: '金', type: 'resource',  stackable: true,  maxStack: 20, description: '稀有资源,金矿冶炼' },
    { id: 'axe',      name: '斧头',   icon: '斧', type: 'tool',      stackable: false, maxStack: 1,  description: '砍树/挖矿双用,耐久 20' },
    { id: 'pickaxe',  name: '镐子',   icon: '镐', type: 'tool',      stackable: false, maxStack: 1,  description: '挖掘矿石/燧石,耐久 25' },
    { id: 'torch',    name: '火把',   icon: '炬', type: 'tool',      stackable: true,  maxStack: 5,  description: '照明 + 驱虫,持续 90s' },
    { id: 'shovel',   name: '铲子',   icon: '铲', type: 'tool',      stackable: false, maxStack: 1,  description: '挖掘/掩埋,耐久 15' }
  ];
  // 索引
  var ITEMS_BY_ID = {};
  MOCK_ITEMS.forEach(function (i) { ITEMS_BY_ID[i.id] = i; });

  // 初始背包(随机 12 槽有物,12 槽空,共 24 槽)
  function genInitialInventory() {
    var inv = new Array(INVENTORY_COLS * INVENTORY_ROWS);
    var used = {};
    var stackCount = {};
    for (var i = 0; i < 12; i++) {
      var idx = Math.floor(Math.random() * MOCK_ITEMS.length);
      var item = MOCK_ITEMS[idx];
      // 同一 id 在 24 槽内最多 2 堆,避免初始太散
      var key = item.id;
      if ((used[key] || 0) >= 2) {
        i--; continue;
      }
      used[key] = (used[key] || 0) + 1;
      var stack = item.stackable ? (Math.floor(Math.random() * 8) + 1) : 1;
      inv[i] = { itemId: item.id, count: stack };
    }
    return inv;
  }

  // 初始快捷栏(7 槽:5 启用 + 2 禁用,沿用 M2.12 demo.html 布局)
  function genInitialHotbar() {
    var bar = new Array(HOTBAR_SIZE);
    for (var i = 0; i < 5; i++) {
      var idx = i % 4;
      bar[i] = { itemId: MOCK_ITEMS[idx].id, count: (i + 1) * 2 };
    }
    bar[5] = null; bar[6] = null;
    return bar;
  }

  // 初始合成配方(简单 4 条,M2.10 recipes.json 对齐)
  var MOCK_RECIPES = [
    { id: 'r_rope',    name: '绳索',     result: { itemId: 'rope',     count: 1 }, cost: [{ itemId: 'cut_grass', count: 3 }], tab: 'basic' },
    { id: 'r_boards',  name: '木板',     result: { itemId: 'boards',   count: 2 }, cost: [{ itemId: 'log',       count: 2 }], tab: 'basic' },
    { id: 'r_torch',   name: '火把',     result: { itemId: 'torch',    count: 2 }, cost: [{ itemId: 'twigs',     count: 2 }, { itemId: 'cut_grass', count: 2 }], tab: 'basic' },
    { id: 'r_axe',     name: '斧头',     result: { itemId: 'axe',      count: 1 }, cost: [{ itemId: 'twigs',     count: 2 }, { itemId: 'flint',    count: 2 }], tab: 'tools' }
  ];

  // 初始任务(沿用 M2.14 设计,3 主线 + 2 支线)
  var MOCK_QUESTS = [
    { id: 'q_intro',   title: '第一章 · 落地',  desc: '在荒野中醒来。收集 5 树枝,生起第一堆火。',         status: 'active',  progress: { twigs: 3 },   goal: { twigs: 5 } },
    { id: 'q_shelter', title: '第二章 · 庇护所', desc: '夜幕将至。合成 1 绳索,搭建简易帐篷。',            status: 'active',  progress: { rope: 0 },    goal: { rope: 1 } },
    { id: 'q_explore', title: '第三章 · 探索',   desc: '深入丛林。击杀 3 只猎犬,寻找失落的矿脉。',        status: 'locked',  progress: {},           goal: { hound: 3 } },
    { id: 'q_side_a',  title: '支线 · 篝火晚宴', desc: '在篝火旁烹饪 1 份烤肉,恢复饥饿值。',              status: 'active',  progress: { cooked: 0 },  goal: { cooked: 1 } },
    { id: 'q_side_b',  title: '支线 · 寻宝者',   desc: '收集 10 块石头,合成 1 把镐子。',                  status: 'done',    progress: { pickaxe: 1 }, goal: { pickaxe: 1 } }
  ];

  // ============================================================================
  // 应用状态(单例)
  // ============================================================================
  var state = {
    activeTab: 'inventory',  // 'inventory' | 'crafting' | 'map' | 'quest'
    inventory: genInitialInventory(),
    hotbar: genInitialHotbar(),
    drag: null,              // 当前拖拽上下文(见 DragContext)
    tickCount: 0
  };

  // 暴露给调试 + 未来联机同步
  window.__screensState = state;

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
    IDLE: 'idle',
    DRAGGING: 'dragging',
    MERGE: 'merge',
    MOVE: 'move',
    REJECTED: 'rejected',
    HOTBAR_REPLACE: 'hotbar-replace'
  };

  function setDragFeedback(node, kind) {
    // kind: 'merge' | 'move' | 'reject' | 'hotbar' | 'source'
    if (!node) return;
    node.classList.remove('DragSource', 'DragMerge', 'DragMove', 'DragReject', 'DragHotbarTarget');
    if (kind) node.classList.add('Drag' + kind.charAt(0).toUpperCase() + kind.slice(1));
  }

  function clearAllDragFeedback() {
    $$('.DragSource, .DragMerge, .DragMove, .DragReject, .DragHotbarTarget').forEach(function (n) {
      n.classList.remove('DragSource', 'DragMerge', 'DragMove', 'DragReject', 'DragHotbarTarget');
    });
  }

  function startDrag(item, slotEl, sourceKind, sourceIdx) {
    state.drag = {
      state: DRAG_STATE.DRAGGING,
      item: item,
      source: { kind: sourceKind, idx: sourceIdx },  // kind: 'inventory' | 'hotbar'
      el: slotEl
    };
    setDragFeedback(slotEl, 'source');
    if (window.__hudBus) window.__hudBus.emit('inventory:drag-start', { itemId: item.itemId, source: sourceKind });
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
      // 视觉回弹 + shake 动画(由 CSS .DragRejectShake 触发,200ms 后自动消除)
      if (drag.el) {
        drag.el.classList.add('DragRejectShake');
        setTimeout(function () { drag.el.classList.remove('DragRejectShake'); }, 220);
      }
    }
    // 推送到 hudBus(M2.12 同步)
    if (window.__hudBus) {
      window.__hudBus.emit('inventory:drag', {
        state: result,
        itemId: item.itemId,
        from: src,
        to: { kind: targetKind, idx: targetIdx }
      });
    }
  }

  function tryDrop(src, targetKind, targetIdx, item) {
    // 不可达情况 1: 源 == 目标
    if (src.kind === targetKind && src.idx === targetIdx) return 'rejected';
    // 不可达情况 2: 目标槽不可用(快捷栏 disabled)
    if (targetKind === 'hotbar' && targetIdx >= 5) return 'rejected';

    var srcArr = src.kind === 'hotbar' ? state.hotbar : state.inventory;
    var tgtArr = targetKind === 'hotbar' ? state.hotbar : state.inventory;
    var target = tgtArr[targetIdx];

    // 目标为空 → MOVE
    if (!target) {
      tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
      srcArr[src.idx] = null;
      rerenderAll();
      return 'move';
    }

    // 目标同类 + 可堆叠 + 未满 → MERGE
    var def = ITEMS_BY_ID[item.itemId];
    if (def.stackable && target.itemId === item.itemId) {
      var space = def.maxStack - target.count;
      if (space <= 0) {
        // 满了,只能交换(MOVE)
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

    // 目标为不同物品 → 交换(MOVE 形式)
    tgtArr[targetIdx] = { itemId: item.itemId, count: item.count };
    srcArr[src.idx] = { itemId: target.itemId, count: target.count };
    rerenderAll();
    return 'move';
  }

  // 拖到快捷栏专用逻辑(快捷栏替换语义,不动背包原有物品)
  function dropToHotbar(src, targetIdx, item) {
    var hotbar = state.hotbar;
    var inv = state.inventory;
    var existing = hotbar[targetIdx];

    // 不可达: 快捷栏 disabled 槽(targetIdx >= 5)
    if (targetIdx >= 5) return 'rejected';

    // 目标为空 → 直接置入
    if (!existing) {
      hotbar[targetIdx] = { itemId: item.itemId, count: item.count };
      // 源槽置空(若源是背包)
      if (src.kind === 'inventory') inv[src.idx] = null;
      else hotbar[src.idx] = null;
      rerenderAll();
      return 'hotbar-replace';
    }

    // 目标同类 + 可堆叠 → merge
    var def = ITEMS_BY_ID[item.itemId];
    if (def.stackable && existing.itemId === item.itemId) {
      var space = def.maxStack - existing.count;
      if (space <= 0) {
        // 满,作 hotbar-replace(全量替换,背包端物品回到原槽)
        hotbar[targetIdx] = { itemId: item.itemId, count: item.count };
        if (src.kind === 'inventory') inv[src.idx] = { itemId: existing.itemId, count: existing.count };
        else hotbar[src.idx] = { itemId: existing.itemId, count: existing.count };
        rerenderAll();
        return 'hotbar-replace';
      }
      var take = Math.min(space, item.count);
      existing.count += take;
      item.count -= take;
      if (item.count <= 0) {
        if (src.kind === 'inventory') inv[src.idx] = null;
        else hotbar[src.idx] = null;
      } else {
        if (src.kind === 'inventory') inv[src.idx] = { itemId: item.itemId, count: item.count };
        else hotbar[src.idx] = { itemId: item.itemId, count: item.count };
      }
      rerenderAll();
      return 'merge';
    }

    // 目标为不同物品 → hotbar-replace(全量替换,原物品回到源槽)
    hotbar[targetIdx] = { itemId: item.itemId, count: item.count };
    if (src.kind === 'inventory') inv[src.idx] = { itemId: existing.itemId, count: existing.count };
    else hotbar[src.idx] = { itemId: existing.itemId, count: existing.count };
    rerenderAll();
    return 'hotbar-replace';
  }

  // ============================================================================
  // 物品槽渲染
  // ============================================================================

  function renderItemSlot(arr, idx, kind, opts) {
    var item = arr[idx];
    var def = item ? ITEMS_BY_ID[item.itemId] : null;
    var slot = el('div', {
      class: 'ItemSlot' + (item ? ' is-filled' : ' is-empty') + (opts && opts.disabled ? ' is-disabled' : ''),
      dataset: { kind: kind, idx: String(idx) },
      draggable: !!(item && !(opts && opts.disabled)),
      tabindex: '0',
      role: 'button',
      'aria-label': item ? (def.name + ' × ' + item.count) : '空槽'
    });

    if (item && def) {
      // 1px 边 + 缩写字母(占位,等 M2.14 美术到位换 24px 图标)
      var art = el('div', { class: 'ItemSlot-Art' }, def.icon);
      slot.appendChild(art);
      slot.appendChild(el('div', { class: 'ItemSlot-Name' }, def.name));
      if (def.stackable && item.count > 1) {
        slot.appendChild(el('div', { class: 'ItemSlot-Stack' }, '×' + item.count));
      }
      // 拖拽事件
      slot.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: kind, idx: idx, itemId: item.itemId }));
        startDrag(item, slot, kind, idx);
      });
      slot.addEventListener('dragend', function () {
        if (state.drag) {
          // 取消拖拽:清理
          setDragFeedback(state.drag.el, null);
          clearAllDragFeedback();
          state.drag = null;
        }
      });
      slot.addEventListener('dragover', function (e) {
        if (!state.drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var def2 = ITEMS_BY_ID[item.itemId];
        if (def2 && def2.stackable && state.drag.item.itemId === item.itemId && item.count < def2.maxStack) {
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
        if (state.drag) {
          endDrag(kind, idx, slot);
        }
      });
      // 点击 → 打开详情卡
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
        if (state.drag) {
          endDrag(kind, idx, slot);
        }
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

    // 槽位计数提示
    var used = state.inventory.filter(function (s) { return s; }).length;
    var summary = el('div', { class: 'InventorySummary' }, '槽位: ' + used + ' / ' + state.inventory.length);
    container.appendChild(summary);
  }

  function renderCrafting(container) {
    container.innerHTML = '';
    // 左侧:配方列表
    var list = el('div', { class: 'CraftingList' });
    list.appendChild(el('div', { class: 'Panel-Header' }, '合成配方 · ' + MOCK_RECIPES.length));
    MOCK_RECIPES.forEach(function (r) {
      var card = el('div', { class: 'CraftingCard' });
      card.appendChild(el('div', { class: 'CraftingCard-Name' }, '▸ ' + r.name));
      // v0.8.0 P0 Bug-2:defense against sparse/empty cost entries (c may
      // be undefined when a recipe from getRecipes() has a hole in cost).
      // Falls back to '?×?' so the card still renders.
      var costText = r.cost.map(function (c) {
        if (!c) return '?×?';
        var def = ITEMS_BY_ID[c.itemId];
        return (def ? def.name : '?') + ' ×' + c.count;
      }).join(' + ');
      card.appendChild(el('div', { class: 'CraftingCard-Cost' }, '需求: ' + costText));
      var resDef = ITEMS_BY_ID[r.result.itemId];
      card.appendChild(el('div', { class: 'CraftingCard-Result' }, '产出: ' + (resDef ? resDef.name : '?') + ' ×' + r.result.count));
      // 能否合成(简单判断,实际合成要 M2.10 inventory API)
      var canCraft = r.cost.every(function (c) {
        if (!c) return false;
        var have = 0;
        state.inventory.forEach(function (s) { if (s && s.itemId === c.itemId) have += s.count; });
        return have >= c.count;
      });
      var btn = el('button', { class: 'Button Button-Primary CraftingCard-Craft' }, canCraft ? '合成' : '材料不足');
      if (!canCraft) btn.setAttribute('disabled', '');
      btn.addEventListener('click', function () {
        if (!canCraft) return;
        // 简化逻辑:消耗材料 + 产出物品(找一个空格)
        r.cost.forEach(function (c) {
          if (!c) return;
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
        // 找空格塞入结果
        var placed = false;
        for (var j = 0; j < state.inventory.length; j++) {
          if (!state.inventory[j]) {
            state.inventory[j] = { itemId: r.result.itemId, count: r.result.count };
            placed = true; break;
          }
        }
        if (!placed) {
          // 背包满,合并到已有同类
          for (var k = 0; k < state.inventory.length; k++) {
            var s2 = state.inventory[k];
            if (s2 && s2.itemId === r.result.itemId) {
              s2.count += r.result.count; break;
            }
          }
        }
        rerenderAll();
        if (window.__hudBus) window.__hudBus.emit('crafting:complete', { recipeId: r.id });
      });
      card.appendChild(btn);
      list.appendChild(card);
    });
    container.appendChild(list);

    // 右侧:分类 Tab(basic / tools / 预留)
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
    // 地图屏:大地图占位 + POI 标记
    var wrap = el('div', { class: 'MapWrap' });
    var canvas = el('canvas', { class: 'MapCanvas' });
    canvas.width = 800; canvas.height = 500;
    wrap.appendChild(canvas);

    // 地图覆盖层(POI 标记)
    var overlay = el('div', { class: 'MapOverlay' });
    [
      { x: '20%', y: '30%', label: '营地',   color: 'var(--accent)' },
      { x: '55%', y: '20%', label: '矿脉',   color: 'var(--fg-muted)' },
      { x: '70%', y: '65%', label: '沼泽',   color: '#5a7a4a' },
      { x: '40%', y: '80%', label: '森林',   color: 'var(--accent-3)' },
      { x: '85%', y: '40%', label: '遗迹',   color: 'var(--warn-sanity)' }
    ].forEach(function (p) {
      var pin = el('div', { class: 'MapPin' });
      pin.style.left = p.x; pin.style.top = p.y;
      pin.style.background = p.color;
      var tip = el('div', { class: 'MapPin-Tip' }, p.label);
      pin.appendChild(tip);
      overlay.appendChild(pin);
    });
    wrap.appendChild(overlay);

    // 地图底部:当前坐标 + 缩放
    var info = el('div', { class: 'MapInfo' }, [
      el('span', {}, '坐标: '),
      el('span', { style: { color: 'var(--accent)' } }, 'X: 124  Y: 88'),
      el('span', { style: { marginLeft: 'var(--sp-24)' } }, '群系: '),
      el('span', { style: { color: 'var(--accent)' } }, '森林'),
      el('span', { style: { marginLeft: 'var(--sp-24)' } }, 'Day 12 · 14:32')
    ]);
    wrap.appendChild(info);
    container.appendChild(wrap);

    // 绘制简化地形(Canvas 2D 网格)
    drawMapTerrain(canvas);
  }

  function drawMapTerrain(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 底色
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 群系色块(简化)
    ctx.fillStyle = '#1a3a1a'; ctx.fillRect(0, 0, 400, 250);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(400, 0, 400, 250);
    ctx.fillStyle = '#1a2a3a'; ctx.fillRect(0, 250, 300, 250);
    ctx.fillStyle = '#2a1a3a'; ctx.fillRect(300, 250, 500, 250);
    // 网格线
    ctx.strokeStyle = 'rgba(212, 166, 74, 0.15)';
    ctx.lineWidth = 1;
    for (var x = 0; x < canvas.width; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (var y = 0; y < canvas.height; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    // 玩家位置(中心)
    ctx.fillStyle = '#d4a64a';
    ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function renderQuest(container) {
    container.innerHTML = '';
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
        // 进度条
        var progKeys = Object.keys(q.progress);
        if (progKeys.length) {
          progKeys.forEach(function (k) {
            var p = q.progress[k] || 0;
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
    makeSection('进行中', active) && list.appendChild(makeSection('进行中', active));
    makeSection('已完成', done) && list.appendChild(makeSection('已完成', done));
    makeSection('未解锁', locked) && list.appendChild(makeSection('未解锁', locked));

    container.appendChild(list);
  }

  // ============================================================================
  // 详情卡(复用 M1.8 Dialog)
  // ============================================================================
  function openItemDetail(itemId) {
    var def = ITEMS_BY_ID[itemId];
    if (!def) return;

    // 关闭已有
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
          el('div', { class: 'Codex-Detail-Sci' }, '类型: ' + def.type)
        ])
      ]),
      closeBtn
    ]);
    var body = el('div', { class: 'Dialog-Body' }, [
      el('div', { class: 'Codex-Detail-Section' }, [
        el('div', { class: 'Codex-Detail-Section-Title' }, '▸ 描述'),
        el('div', { class: 'Codex-Detail-Section-Body' }, def.description)
      ]),
      el('div', { class: 'Codex-Detail-Section' }, [
        el('div', { class: 'Codex-Detail-Section-Title' }, '▸ 属性'),
        el('div', { class: 'Codex-Detail-Section-Body' }, '堆叠: ' + (def.stackable ? '是(上限 ' + def.maxStack + ')' : '否'))
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

    // ESC 关闭
    var onKey = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  // ============================================================================
  // 5Hz 同步订阅
  // ============================================================================
  function bindHudBus() {
    if (!window.__hudBus) {
      // M2.12 还没初始化,等一下
      setTimeout(bindHudBus, 100);
      return;
    }
    window.__hudBus.on('tick', function () {
      state.tickCount++;
    });
    window.__hudBus.on('hotbar:select', function (d) {
      // 外部选中快捷栏(数字键 1-7)→ 同步本地 hotbar 状态(高亮槽)
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
    // 切换 subtab active 样式
    $$('.Subtab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === target;
      t.classList.toggle('is-active', on);
    });
    // 切换屏显示
    SCREENS.forEach(function (s) {
      var node = $('#screen-' + s);
      if (node) node.style.display = (s === target ? '' : 'none');
    });
    // 渲染当前屏
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
    // 重新绑定快捷栏镜像
    bindHotbarMirror();
  }

  // ============================================================================
  // 快捷栏镜像(把 M2.12 主 HUD 的 .HotbarSlot 状态同步到本屏)
  // ============================================================================
  function bindHotbarMirror() {
    // 本屏只读主 HUD 的快捷栏(不重复渲染),通过 .HotbarSlotMirror 标记
    // 这里只触发 hotbar:select 同步
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
      // I / C / M / Q 切屏
      var map = { 'i': 'inventory', 'c': 'crafting', 'm': 'map', 'q': 'quest' };
      var k = (e.key || '').toLowerCase();
      if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 输入框里不抢
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        location.hash = '#/' + map[k];
        e.preventDefault();
      }
      // ESC → 回到 inventory
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
    // 1. 防御:确认 DOM 已就绪
    if (!$('.SubtabBar') || !$('#screen-inventory')) {
      return false;
    }
    // 2. 绑定 subtab 导航 + 键盘
    bindSubtabs();
    bindKeys();
    // 3. 绑定 hudBus(异步等 M2.12)
    bindHudBus();
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
