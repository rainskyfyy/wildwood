/**
 * Wildwood UI · v0.5.4 交易系统
 *
 * 职责:
 *   1. 打开/关闭交易对话框(基于 .Dialog 扩展 .TradeDialog)
 *   2. 价格模型: 基准价 × 供需系数(玩家买入时翻倍/猪人买入时折半)
 *      - 物品基础价 ITEMS[itemId].basePrice
 *      - 猪人偏好 ITEMS[itemId].tags ∩ PIG.preferences.likes/dislikes
 *      - 库存压力 玩家在猪人处的累计出售数量 → 降价
 *   3. 报价面板: 拖拽玩家栏 → 我出 → 拖拽猪人栏 → 换回
 *      总价差 ≤ 阈值(默认 ±10%) 才允许确认,差额为 0 完美交易
 *   4. 交易反馈: 拖入/拖出/锁定/确认/取消,触发猪人交易气泡
 *   5. 好感度门: 跨阈时猪人反应不同:
 *      - 0 心: 冷淡,只接受以物易物
 *      - 1 心: 中性,开始回应
 *      - 2 心: 友好,折扣 5%
 *      - 3 心(满): 招募候选,可触发"加入队伍"分支
 *
 * 数据契约(与 M2.10 inventory.js / M2.11 codex.js 兼容):
 *   - 物品: { id, name, icon, basePrice, tags: [...] }
 *   - 猪人: { id, name, preferences: { likes: [...], dislikes: [...] }, affinity: 0..3 }
 *   - 玩家背包: [{ itemId, count }]  长度 6×4 = 24
 *   - 猪人库存: [{ itemId, count }]  长度可变
 *
 * 5Hz 同步:
 *   - 订阅 hudBus 'tick' (M2.12) → 价格系数每秒更新一次
 *   - 状态变化: hudBus.emit('trade:change', { offer, returnOffer, balance })
 *   - 交易完成: hudBus.emit('trade:complete', { pig, itemsGiven, itemsReceived, affinityDelta })
 *
 * 复用:
 *   - .Dialog / .Button / .Panel 来自 components.css
 *   - 5Hz TICK_MS = 200 来自 M2.12
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空
 *   - 普通 <script src> 加载,非 ESM
 *   - 不修改 M2.12 hud.js / M1.7 tokens / M1.8 components
 */

(function () {
  'use strict';

  // ============================================================================
  // 配置
  // ============================================================================
  var TICK_MS = 200;                  // 5Hz,与 M2.12 对齐
  var TRADE_FAIR_THRESHOLD = 0.1;     // ±10% 算公平交易
  var AFFINITY_DISCOUNT = [0, 0, 0.05, 0.10];  // 0/1/2/3 心的折扣
  var PRICE_JITTER = 0.05;            // 价格随机波动 ±5%
  var INVENTORY_COLS = 6;
  var INVENTORY_ROWS = 4;

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
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }

  // ============================================================================
  // 物品目录(与 M2.10 inventory / M2.11 codex 数据契约对齐)
  // ============================================================================
  // basePrice: 基础金价 · tags: 用于猪人偏好匹配
  // 简易货币单位: 金(1 金 = 100 银,但交易按整数金)
  var ITEMS = {
    twigs:    { id: 'twigs',    name: '树枝',   icon: '枝', basePrice: 1,  tags: ['plant', 'common'] },
    flint:    { id: 'flint',    name: '燧石',   icon: '石', basePrice: 2,  tags: ['mineral', 'common'] },
    log:      { id: 'log',      name: '圆木',   icon: '木', basePrice: 4,  tags: ['plant', 'refined'] },
    cut_grass:{ id: 'cut_grass',name: '草',     icon: '草', basePrice: 1,  tags: ['plant', 'common'] },
    rope:     { id: 'rope',     name: '绳索',   icon: '绳', basePrice: 3,  tags: ['craft', 'common'] },
    boards:   { id: 'boards',   name: '木板',   icon: '板', basePrice: 6,  tags: ['craft', 'refined'] },
    stone:    { id: 'stone',    name: '石头',   icon: '石', basePrice: 2,  tags: ['mineral', 'common'] },
    gold:     { id: 'gold',     name: '金块',   icon: '金', basePrice: 50, tags: ['mineral', 'valuable'] },
    carrot:   { id: 'carrot',   name: '胡萝卜', icon: '萝', basePrice: 5,  tags: ['food', 'plant'] },
    berry:    { id: 'berry',    name: '浆果',   icon: '果', basePrice: 3,  tags: ['food', 'plant'] },
    meat:     { id: 'meat',     name: '生肉',   icon: '肉', basePrice: 8,  tags: ['food', 'animal'] },
    cooked:   { id: 'cooked',   name: '烤肉',   icon: '烤', basePrice: 15, tags: ['food', 'animal', 'refined'] },
    axe:      { id: 'axe',      name: '斧头',   icon: '斧', basePrice: 20, tags: ['tool', 'refined'] },
    pickaxe:  { id: 'pickaxe',  name: '镐子',   icon: '镐', basePrice: 25, tags: ['tool', 'refined'] },
    torch:    { id: 'torch',    name: '火把',   icon: '炬', basePrice: 2,  tags: ['tool', 'common'] }
  };

  // ============================================================================
  // 交易反应语料(猪人,根据操作触发)
  // ============================================================================
  // 拖入合法物品:positive; 拖入厌恶物品:negative; 拖出:warn; 完美交易:happy; 拒绝/退出:neutral
  var PIG_LINES = {
    open:       ['欢迎~', '嘿嘿,带了什么?', '看看你的货', '嗅嗅...木头味', '闻起来不错'],
    positive:   ['这个我喜欢~', '噢!好货!', '想要想要!', '嗅嗅~', '赞!'],
    negative:   ['嗅...不要', '不喜欢!', '拿走拿走', '不要这个', '皱眉'],
    offer:      ['再加一点?', '这个换那个?', '嗯嗯...', '让我想想', '划算吗?'],
    perfect:    ['成交!爽快!', '嘿嘿!谢谢~', '你是个好朋友', '棒!', '愉快!'],
    partial:    ['还行吧...', '勉为其难', '凑合', '下次多带点好的'],
    reject:     ['不行!', '太亏了!', '不要!', '拒绝!', '嫌弃'],
    cancel:     ['下次再来~', '哦,走了?', '再见~', '欢迎再来', '挥挥'],
    affinity:   ['你真好~', '朋友!', '我信任你', '好感+1', '要跟我走吗?'],
    full:       ['我想跟你走!', '招募我吧~', '你是我的朋友!', '并肩作战!']
  };
  function pickLine(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ============================================================================
  // Mock 数据(玩家背包 24 槽,演示用)
  // ============================================================================
  function genMockPlayerInventory() {
    var inv = new Array(INVENTORY_COLS * INVENTORY_ROWS);
    // 8 槽有物,16 槽空
    var seed = [
      { itemId: 'twigs',    count: 8 },
      { itemId: 'flint',    count: 4 },
      { itemId: 'log',      count: 3 },
      { itemId: 'cut_grass',count: 12 },
      { itemId: 'carrot',   count: 6 },
      { itemId: 'berry',    count: 9 },
      { itemId: 'meat',     count: 2 },
      { itemId: 'rope',     count: 1 }
    ];
    for (var i = 0; i < seed.length; i++) inv[i] = seed[i];
    return inv;
  }

  // 猪人库存(根据偏好生成 6-8 槽,演示用)
  function genMockPigInventory(preferences) {
    var likes = preferences.likes || [];
    var pool = Object.keys(ITEMS).filter(function (id) {
      var t = ITEMS[id].tags;
      return t.indexOf('food') >= 0 || t.indexOf('plant') >= 0;
    });
    // 偏好物品权重 ×3
    var weighted = [];
    pool.forEach(function (id) {
      var w = likes.indexOf(ITEMS[id].tags[0]) >= 0 ? 3 : 1;
      for (var i = 0; i < w; i++) weighted.push(id);
    });
    var inv = [];
    var used = {};
    for (var i = 0; i < 7; i++) {
      var pick = weighted[Math.floor(Math.random() * weighted.length)];
      if ((used[pick] || 0) >= 2) { i--; continue; }
      used[pick] = (used[pick] || 0) + 1;
      inv.push({ itemId: pick, count: Math.floor(rand(1, 5)) });
    }
    return inv;
  }

  // ============================================================================
  // 价格模型
  // ============================================================================
  // priceForBuy(itemId, pig, marketState, side)
  //   side = 'player-buys-from-pig' | 'pig-buys-from-player'
  //   玩家从猪人买: 基础价 × (1 + 通胀) × (1 - 好感度折扣) × 偏好(厌恶 ×2, 喜欢 ×0.8)
  //   猪人从玩家买: 基础价 × 0.6 × 偏好(喜欢 ×1.5, 厌恶 ×0.3)
  function priceForBuy(itemId, pig, marketState, side) {
    var item = ITEMS[itemId];
    if (!item) return 0;
    var base = item.basePrice;
    // 通胀:猪人累计买得越多,玩家买得越贵(1 + 市场压力)
    var inflation = clamp(marketState.pigBought[itemId] || 0, 0, 0.4);
    // 偏好系数
    var pref = 1.0;
    var tags = item.tags;
    var isLiked = tags.some(function (t) { return pig.preferences.likes.indexOf(t) >= 0; });
    var isDisliked = tags.some(function (t) { return pig.preferences.dislikes.indexOf(t) >= 0; });
    if (isLiked) pref *= 0.8;
    if (isDisliked) pref *= 2.0;
    // 好感度折扣(仅玩家从猪人买时生效)
    var affinityDiscount = (side === 'player-buys-from-pig')
      ? AFFINITY_DISCOUNT[pig.affinity] || 0
      : 0;
    // 随机波动
    var jitter = 1 + (Math.random() * 2 - 1) * PRICE_JITTER;
    if (side === 'player-buys-from-pig') {
      // 买入: 基础 × (1 + 通胀) × 偏好 × (1 - 折扣) × 抖动
      return Math.max(1, Math.round(base * (1 + inflation) * pref * (1 - affinityDiscount) * jitter));
    } else {
      // 卖出: 基础 × 0.6 × 偏好(喜欢 ×1.5, 厌恶 ×0.3) × 抖动
      var sellPref = isLiked ? 1.5 : (isDisliked ? 0.3 : 1.0);
      return Math.max(1, Math.round(base * 0.6 * sellPref * jitter));
    }
  }

  // 计算报价面板总价值(取中间价: 玩家从猪人买价)
  function offerValue(side, offer, pig, marketState) {
    var total = 0;
    offer.forEach(function (stack) {
      if (!stack) return;
      var p = priceForBuy(stack.itemId, pig, marketState, side);
      total += p * stack.count;
    });
    return total;
  }

  // ============================================================================
  // 交易对话框(单例:同一时刻只允许一个交易)
  // ============================================================================
  var currentDialog = null;
  var marketTimers = {};  // 物品ID → 5Hz 计数器,模拟猪人累计买量变化

  // 打开交易
  // pig: { id, name, affinity, preferences }
  // playerInventory: [{ itemId, count }, ...] (24 槽)
  // options: { onComplete, onCancel, pigInventory? }
  function openTrade(pig, playerInventory, options) {
    options = options || {};
    if (currentDialog) {
      console.warn('[Trading] Already open, closing previous');
      closeTrade();
    }
    pig = pig || {
      id: 'pig_forest_1',
      name: '森林猪人',
      affinity: 1,  // 默认 1 心
      preferences: { likes: ['food', 'plant'], dislikes: ['mineral'] }
    };
    playerInventory = playerInventory || genMockPlayerInventory();
    var pigInventory = options.pigInventory || genMockPigInventory(pig.preferences);

    var state = {
      pig: pig,
      playerInventory: playerInventory.slice(),
      pigInventory: pigInventory.slice(),
      offer: [null, null, null],          // 我出:最多 3 槽
      returnOffer: [null, null, null],    // 换回:最多 3 槽
      marketState: {
        pigBought: {},                    // 累计猪人从玩家买走的物品计数
        playerBought: {}                  // 累计玩家从猪人买走的物品计数
      },
      tickCount: 0
    };

    var root = el('div', { class: 'TradeDialog', 'data-pig-id': pig.id });
    root.appendChild(buildHeader(pig, state));
    root.appendChild(buildBody(state));
    root.appendChild(buildOfferPanel(state));
    root.appendChild(buildConfirmBar(state, options));

    // 模态遮罩
    var overlay = el('div', { class: 'Dialog-Overlay' });
    overlay.addEventListener('click', function () {
      // 外部点击不关闭(避免误操作)
    });

    document.body.appendChild(overlay);
    document.body.appendChild(root);

    currentDialog = { root: root, overlay: overlay, state: state, options: options };

    // 5Hz tick: 更新市场价格系数 + 猪人反应气泡
    state.tickInterval = setInterval(function () { tick(state); }, TICK_MS);

    // 初始猪人反应
    showPigReaction(state, pickLine(PIG_LINES.open), 'neutral');

    // 推 hudBus
    if (window.__hudBus) {
      window.__hudBus.emit('trade:open', { pigId: pig.id, affinity: pig.affinity });
    }

    return root;
  }

  // 关闭
  function closeTrade() {
    if (!currentDialog) return;
    if (currentDialog.state.tickInterval) {
      clearInterval(currentDialog.state.tickInterval);
    }
    if (currentDialog.root.parentNode) currentDialog.root.parentNode.removeChild(currentDialog.root);
    if (currentDialog.overlay.parentNode) currentDialog.overlay.parentNode.removeChild(currentDialog.overlay);
    if (window.__hudBus) {
      window.__hudBus.emit('trade:close', { pigId: currentDialog.state.pig.id });
    }
    currentDialog = null;
  }

  // 当前是否打开
  function isOpen() { return !!currentDialog; }

  // 当前 pig
  function currentPig() { return currentDialog ? currentDialog.state.pig : null; }

  // ============================================================================
  // 头部(标题 + 好感度)
  // v0.6.4a: 集成 NPCAffinityBar 组件,降级用 buildAffinityDisplay
  // ============================================================================
  function buildHeader(pig, state) {
    var header = el('div', { class: 'TradeDialog-Header' });
    var left = el('div', { class: 'TradeDialog-Title' }, [
      el('span', { class: 'TradeDialog-Title-Icon', 'aria-label': '猪人' }),
      el('span', null, '交易'),
      el('span', { class: 'TradeDialog-PigName' }, pig.name)
    ]);
    var aff = el('div', { class: 'TradeDialog-Affinity' });
    // v0.6.4a: 优先用 NPCAffinityBar 组件,降级 buildAffinityDisplay
    if (window.NPCAffinityBar && typeof window.NPCAffinityBar.create === 'function') {
      aff.appendChild(window.NPCAffinityBar.create(pig, { theme: 'trade', showHint: false }));
    } else {
      aff.appendChild(buildAffinityDisplay(pig.affinity, /* clickable */ false));
    }
    var close = el('button', { class: 'Dialog-Close', 'aria-label': '关闭', onclick: function () {
      showPigReaction(state, pickLine(PIG_LINES.cancel), 'neutral');
      setTimeout(function () {
        if (currentDialog && currentDialog.state === state && currentDialog.options.onCancel) {
          currentDialog.options.onCancel({ reason: 'user-cancel' });
        }
        closeTrade();
      }, 600);
    } }, '×');
    header.appendChild(left);
    header.appendChild(aff);
    header.appendChild(close);
    return header;
  }

  // 好感度显示(0-3 心,带满心"可招募"标记)
  // clickable=true 时,点击给当前心 +1(喂食),用于演示
  function buildAffinityDisplay(affinity, clickable) {
    var wrap = el('div', { class: 'AffinityDisplay' });
    for (var i = 0; i < 3; i++) {
      var heart = el('span', {
        class: 'AffinityHeart' + (i < affinity ? ' is-filled' : ' is-empty'),
        'data-heart-idx': String(i),
        title: '好感度 ' + (i + 1) + '/3'
      }, i < affinity ? '♥' : '♡');
      if (clickable) {
        (function (idx) {
          heart.addEventListener('click', function () {
            // 喂食:+1 心(演示用,真实游戏需 feedItem 调用)
            var p = currentPig();
            if (!p) return;
            if (p.affinity >= 3) return;
            p.affinity = Math.min(3, p.affinity + 1);
            rerenderAffinity();
            // 触发"好感+1"动画(npc.js 的 +1 动画逻辑)
            if (window.NPC && typeof window.NPC.affinityUp === 'function') {
              window.NPC.affinityUp(heart, p.affinity);
            }
            if (window.__hudBus) {
              window.__hudBus.emit('npc:affinity-up', { pigId: p.id, affinity: p.affinity });
            }
            if (p.affinity >= 3) {
              showPigReaction(currentDialog.state, pickLine(PIG_LINES.full), 'positive');
            } else {
              showPigReaction(currentDialog.state, pickLine(PIG_LINES.affinity), 'positive');
            }
          });
        })(i);
      }
      wrap.appendChild(heart);
    }
    if (affinity >= 3) {
      wrap.appendChild(el('span', { class: 'AffinityRecruitFlag', title: '可招募' }, '可招募'));
    }
    return wrap;
  }

  function rerenderAffinity() {
    if (!currentDialog) return;
    var old = $('.TradeDialog-Affinity', currentDialog.root);
    if (!old) return;
    // v0.6.4a: 优先用 NPCAffinityBar.update 节流更新(只改差异部分)
    // 降级: 完整重建(原 buildAffinityDisplay 路径)
    if (window.NPCAffinityBar && typeof window.NPCAffinityBar.update === 'function') {
      var pig = currentDialog.state.pig;
      // NPCAffinityBar 顶层就是 display 容器,直接 update 它
      var bar = old.querySelector('.NPCAffinityBar');
      if (bar) {
        window.NPCAffinityBar.update(bar, pig);
        return;
      }
    }
    var fresh = buildAffinityDisplay(currentDialog.state.pig.affinity, true);
    old.parentNode.replaceChild(fresh, old);
  }

  // ============================================================================
  // 双栏(玩家/猪人)
  // ============================================================================
  function buildBody(state) {
    var body = el('div', { class: 'TradeBody' });
    body.appendChild(buildColumn('Player', state.playerInventory, state, 'player'));
    body.appendChild(buildCenter(state));
    body.appendChild(buildColumn('Pig', state.pigInventory, state, 'pig'));
    return body;
  }

  // 渲染一栏
  function buildColumn(side, inventory, state, sideKey) {
    var col = el('div', { class: 'TradeColumn' + (sideKey === 'pig' ? ' TradeColumn-Right' : '') });
    var title = sideKey === 'player' ? '你的物品' : state.pig.name + ' 的物品';
    var count = inventory.filter(function (s) { return s; }).length;
    var header = el('div', { class: 'TradeColumn-Header' }, [
      el('span', { class: 'TradeColumn-Title' }, title),
      el('span', { class: 'TradeColumn-Count' }, count + '/' + inventory.length)
    ]);
    var body = el('div', { class: 'TradeColumn-Body' + (count === 0 ? ' is-empty' : '') });
    inventory.forEach(function (stack, idx) {
      body.appendChild(buildSlot(sideKey, idx, stack, state));
    });
    col.appendChild(header);
    col.appendChild(body);
    return col;
  }

  // 渲染一个槽
  function buildSlot(side, idx, stack, state) {
    var slot = el('div', {
      class: 'TradeSlot' + (stack ? '' : ' is-empty'),
      'data-side': side,
      'data-idx': String(idx),
      draggable: stack ? 'true' : 'false'
    });
    if (!stack) {
      slot.appendChild(el('span', { class: 'ItemSlot-Empty' }, ''));
      return slot;
    }
    var item = ITEMS[stack.itemId];
    if (!item) {
      slot.appendChild(document.createTextNode('?'));
      return slot;
    }
    slot.appendChild(el('span', { class: 'TradeSlot-Art' }, item.icon));
    slot.appendChild(el('span', { class: 'TradeSlot-Name' }, item.name));
    if (stack.count > 1) {
      slot.appendChild(el('span', { class: 'TradeSlot-Stack' }, 'x' + stack.count));
    }
    slot.appendChild(buildPriceTag(stack.itemId, state, side));
    // 拖拽源
    slot.addEventListener('dragstart', function (e) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/wildwood-trade', JSON.stringify({
        side: side, idx: idx, itemId: stack.itemId, count: stack.count
      }));
      slot.classList.add('DragSource');
      if (window.__hudBus) {
        window.__hudBus.emit('trade:drag-start', { side: side, idx: idx, itemId: stack.itemId });
      }
    });
    slot.addEventListener('dragend', function () {
      slot.classList.remove('DragSource');
      $$('.DragOver, .DragInvalid', currentDialog.root).forEach(function (n) {
        n.classList.remove('DragOver', 'DragInvalid');
      });
    });
    // 点击:加入报价面板(快速操作,非拖拽)
    slot.addEventListener('click', function () {
      addToOffer(side, idx);
    });
    return slot;
  }

  // 价格标签
  function buildPriceTag(itemId, state, side) {
    var item = ITEMS[itemId];
    if (!item) return el('span', null, '');
    // 中间价显示
    var midPrice = priceForBuy(itemId, state.pig, state.marketState, 'player-buys-from-pig');
    // 趋势(根据猪人累计买量)
    var bought = state.marketState.pigBought[itemId] || 0;
    var trend = bought > 5 ? 'is-up' : (bought > 0 ? 'is-flat' : 'is-flat');
    return el('div', { class: 'TradePriceTag' }, [
      el('span', { class: 'TradePrice-Icon' }, '⦿'),
      el('span', { class: 'TradePrice-Value' }, String(midPrice)),
      el('span', { class: 'TradePrice-Trend ' + trend }, bought > 5 ? '↑' : '·')
    ]);
  }

  // ============================================================================
  // 中央交换区(箭头 + 价值平衡)
  // ============================================================================
  function buildCenter(state) {
    var center = el('div', { class: 'TradeCenter' });
    var arrow = el('div', { class: 'TradeArrow', title: '等价值交换' });
    var balance = el('div', { class: 'TradeBalance' }, [
      el('div', { class: 'TradeBalance-Label' }, '价值差'),
      el('div', { class: 'TradeBalance-Value is-zero', id: 'trade-balance-value' }, '0 金')
    ]);
    var status = el('div', { class: 'TradeStatus', id: 'trade-status' }, '拖入物品开始交易');
    center.appendChild(arrow);
    center.appendChild(balance);
    center.appendChild(status);
    return center;
  }

  // 重新计算并显示平衡值
  function updateBalance(state) {
    var offerVal = offerValue('pig-buys-from-player', state.offer, state.pig, state.marketState);
    var returnVal = offerValue('player-buys-from-pig', state.returnOffer, state.pig, state.marketState);
    var diff = returnVal - offerVal;  // 正数=玩家多得
    var balEl = $('#trade-balance-value', currentDialog.root);
    var statusEl = $('#trade-status', currentDialog.root);
    if (!balEl) return;
    if (returnVal === 0 && offerVal === 0) {
      balEl.textContent = '0 金';
      balEl.className = 'TradeBalance-Value is-zero';
      statusEl.textContent = '拖入物品开始交易';
      statusEl.className = 'TradeStatus';
      return;
    }
    var abs = Math.abs(diff);
    var label;
    if (diff === 0) label = '完美交换';
    else if (diff > 0) label = '你 +' + diff + ' 金';
    else label = '猪人 +' + abs + ' 金';
    balEl.textContent = label;
    balEl.className = 'TradeBalance-Value ' + (diff > 0 ? 'is-pos' : (diff < 0 ? 'is-neg' : 'is-zero'));

    // 状态文字
    var ratio = offerVal === 0 ? 1 : (returnVal / Math.max(offerVal, 1));
    if (ratio >= 1 - TRADE_FAIR_THRESHOLD && ratio <= 1 + TRADE_FAIR_THRESHOLD) {
      statusEl.textContent = '可以确认';
      statusEl.className = 'TradeStatus is-ok';
    } else if (diff > 0) {
      statusEl.textContent = '猪人多给了 ' + diff + ' 金';
      statusEl.className = 'TradeStatus';
    } else {
      statusEl.textContent = '差额 ' + abs + ' 金(>10%)';
      statusEl.className = 'TradeStatus is-bad';
    }
  }

  // ============================================================================
  // 报价面板(我出 / 换回)
  // ============================================================================
  function buildOfferPanel(state) {
    var panel = el('div', { class: 'TradeOfferPanel' });
    var offerWrap = el('div', { class: 'TradeOfferWrap' }, [
      el('div', { class: 'TradeOfferTitle' }, '我 出'),
      buildOfferSlot('offer', state)
    ]);
    var arrow = el('div', { class: 'TradeOfferArrow', title: '交换' });
    var retWrap = el('div', { class: 'TradeOfferWrap' }, [
      el('div', { class: 'TradeOfferTitle' }, '换 回'),
      buildOfferSlot('return', state)
    ]);
    panel.appendChild(offerWrap);
    panel.appendChild(arrow);
    panel.appendChild(retWrap);
    return panel;
  }

  // 报价槽(可拖入 + 移除)
  function buildOfferSlot(kind, state) {
    var slot = el('div', {
      class: 'TradeOfferSlot',
      'data-offer-kind': kind
    });
    var offerArr = kind === 'offer' ? state.offer : state.returnOffer;
    var hasItem = offerArr.some(function (s) { return s; });
    if (!hasItem) {
      slot.appendChild(el('div', { class: 'TradeOfferEmpty' }, kind === 'offer' ? '拖入你的物品' : '拖入猪人物品'));
    } else {
      offerArr.forEach(function (stack, i) {
        slot.appendChild(buildOfferItem(kind, i, stack, state));
      });
      // 补空槽
      for (var j = offerArr.length; j < 3; j++) {
        slot.appendChild(el('div', { class: 'TradeOfferItem', style: { background: 'transparent', border: '1px dashed var(--border)' } }));
      }
    }
    // 拖入区
    slot.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      slot.classList.add('is-drop-active');
    });
    slot.addEventListener('dragleave', function () {
      slot.classList.remove('is-drop-active');
    });
    slot.addEventListener('drop', function (e) {
      e.preventDefault();
      slot.classList.remove('is-drop-active');
      var raw = e.dataTransfer.getData('text/wildwood-trade');
      if (!raw) return;
      try {
        var data = JSON.parse(raw);
        handleDropOnOffer(kind, data);
      } catch (err) {
        console.warn('[Trading] Bad drag data', err);
      }
    });
    return slot;
  }

  // 报价里的单物品显示
  function buildOfferItem(kind, idx, stack, state) {
    if (!stack) {
      return el('div', { class: 'TradeOfferItem' });
    }
    var item = ITEMS[stack.itemId];
    var side = kind === 'offer' ? 'pig-buys-from-player' : 'player-buys-from-pig';
    var price = priceForBuy(stack.itemId, state.pig, state.marketState, side);
    var node = el('div', {
      class: 'TradeOfferItem',
      title: '点击移除',
      onclick: function () { removeFromOffer(kind, idx); }
    }, [
      el('span', { class: 'TradeOfferItem-Art' }, item.icon),
      stack.count > 1 ? el('span', { class: 'TradeOfferItem-Stack' }, 'x' + stack.count) : null,
      el('span', { class: 'TradeOfferItem-Price' }, price + '金')
    ]);
    return node;
  }

  // 处理拖入报价
  function handleDropOnOffer(kind, data) {
    var state = currentDialog.state;
    // 校验:我出 只能放玩家物品,换回 只能放猪人物品
    var expectedSide = kind === 'offer' ? 'player' : 'pig';
    if (data.side !== expectedSide) {
      showPigReaction(state, pickLine(PIG_LINES.reject), 'negative');
      shakeReject();
      return;
    }
    // 找到第一个空槽
    var arr = kind === 'offer' ? state.offer : state.returnOffer;
    var emptyIdx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i]) { emptyIdx = i; break; }
    }
    if (emptyIdx < 0) {
      showPigReaction(state, '满了!', 'negative');
      shakeReject();
      return;
    }
    // 同一物品已在报价里 → 合并堆叠(沿用 M2.10 STACK_MAX = 20 规范)
    for (var j = 0; j < arr.length; j++) {
      if (arr[j] && arr[j].itemId === data.itemId) {
        arr[j].count = Math.min(20, arr[j].count + data.count);
        // 源槽清空
        if (data.side === 'player') state.playerInventory[data.idx] = null;
        else state.pigInventory[data.idx] = null;
        rerenderAll(state);
        showPigReaction(state, pickLine(PIG_LINES.positive), 'positive');
        return;
      }
    }
    // 新槽
    arr[emptyIdx] = { itemId: data.itemId, count: data.count };
    // 源槽清空(单次拖拽)
    if (data.side === 'player') state.playerInventory[data.idx] = null;
    else state.pigInventory[data.idx] = null;
    // 反应气泡
    var isLiked = ITEMS[data.itemId].tags.some(function (t) { return state.pig.preferences.likes.indexOf(t) >= 0; });
    var isDisliked = ITEMS[data.itemId].tags.some(function (t) { return state.pig.preferences.dislikes.indexOf(t) >= 0; });
    if (isLiked) showPigReaction(state, pickLine(PIG_LINES.positive), 'positive');
    else if (isDisliked) showPigReaction(state, pickLine(PIG_LINES.negative), 'negative');
    else showPigReaction(state, pickLine(PIG_LINES.offer), 'neutral');
    rerenderAll(state);
  }

  // 点击快速加入(默认到第一个空槽)
  function addToOffer(side, idx) {
    var state = currentDialog.state;
    var arrSide = side === 'player' ? 'player' : 'pig';
    var arr = side === 'player' ? state.playerInventory : state.pigInventory;
    var stack = arr[idx];
    if (!stack) return;
    // 加入到"对面"的报价里(我点的玩家物品 → 加入"我出"报价,实际更直觉的是)
    // 我们这里做:点击玩家物品 → 直接加入"我出"报价
    //           点击猪人物品 → 直接加入"换回"报价
    var kind = side === 'player' ? 'offer' : 'return';
    handleDropOnOffer(kind, { side: arrSide, idx: idx, itemId: stack.itemId, count: stack.count });
  }

  // 移除报价
  function removeFromOffer(kind, idx) {
    var state = currentDialog.state;
    var arr = kind === 'offer' ? state.offer : state.returnOffer;
    var stack = arr[idx];
    if (!stack) return;
    // 放回源栏(简化:第一个空槽)
    var source = kind === 'offer' ? state.playerInventory : state.pigInventory;
    var free = -1;
    for (var i = 0; i < source.length; i++) {
      if (!source[i]) { free = i; break; }
    }
    if (free >= 0) source[free] = stack;
    else {
      // 源栏也满了,合并同类
      for (var j = 0; j < source.length; j++) {
        if (source[j] && source[j].itemId === stack.itemId) {
          source[j].count = Math.min(20, source[j].count + stack.count);
          break;
        }
      }
    }
    arr[idx] = null;
    rerenderAll(state);
  }

  // ============================================================================
  // 确认栏
  // ============================================================================
  function buildConfirmBar(state, options) {
    var bar = el('div', { class: 'TradeConfirmBar' });
    var left = el('div', { class: 'TradeConfirmBar-Left' }, '拖拽物品到报价区 · 等价交换');
    var right = el('div', { class: 'TradeConfirmBar-Right' });
    var cancelBtn = el('button', { class: 'Button Button-Secondary', onclick: function () {
      showPigReaction(state, pickLine(PIG_LINES.cancel), 'neutral');
      setTimeout(function () {
        if (currentDialog && currentDialog.options.onCancel) {
          currentDialog.options.onCancel({ reason: 'user-cancel' });
        }
        closeTrade();
      }, 500);
    } }, '取消');
    var confirmBtn = el('button', { class: 'Button Button-Primary', id: 'trade-confirm-btn', onclick: function () {
      confirmTrade();
    } }, '确认交换');
    right.appendChild(cancelBtn);
    right.appendChild(confirmBtn);
    bar.appendChild(left);
    bar.appendChild(right);
    return bar;
  }

  // 确认交易
  function confirmTrade() {
    var state = currentDialog.state;
    var offerVal = offerValue('pig-buys-from-player', state.offer, state.pig, state.marketState);
    var returnVal = offerValue('player-buys-from-pig', state.returnOffer, state.pig, state.marketState);
    if (offerVal === 0 && returnVal === 0) {
      showPigReaction(state, '没东西可换~', 'neutral');
      shakeReject();
      return;
    }
    var ratio = offerVal === 0 ? 1 : (returnVal / Math.max(offerVal, 1));
    if (ratio < 1 - TRADE_FAIR_THRESHOLD || ratio > 1 + TRADE_FAIR_THRESHOLD) {
      showPigReaction(state, pickLine(PIG_LINES.reject), 'negative');
      shakeReject();
      return;
    }
    // 完美或部分交易
    if (offerVal === returnVal) {
      showPigReaction(state, pickLine(PIG_LINES.perfect), 'positive');
    } else {
      showPigReaction(state, pickLine(PIG_LINES.partial), 'neutral');
    }
    // 清空报价(物品已实际交换)
    var offerSnapshot = state.offer.filter(function (s) { return s; });
    var returnSnapshot = state.returnOffer.filter(function (s) { return s; });
    state.offer = [null, null, null];
    state.returnOffer = [null, null, null];
    // 推 hudBus
    if (window.__hudBus) {
      window.__hudBus.emit('trade:complete', {
        pigId: state.pig.id,
        itemsGiven: offerSnapshot,
        itemsReceived: returnSnapshot,
        valueGiven: offerVal,
        valueReceived: returnVal
      });
    }
    // 好感度 +1(完美交易)
    if (offerVal === returnVal && state.pig.affinity < 3) {
      state.pig.affinity = Math.min(3, state.pig.affinity + 1);
    }
    setTimeout(function () {
      rerenderAll(state);
      if (currentDialog && currentDialog.options.onComplete) {
        currentDialog.options.onComplete({
          pig: state.pig,
          itemsGiven: offerSnapshot,
          itemsReceived: returnSnapshot
        });
      }
    }, 600);
  }

  // ============================================================================
  // 猪人反应气泡(浮动在对话气泡,3 秒自动消失)
  // ============================================================================
  var pigReactionTimer = null;
  function showPigReaction(state, text, kind) {
    var header = $('.TradeDialog-Header', currentDialog.root);
    if (!header) return;
    // 移除旧气泡
    var old = $('.TradeBubble', header);
    if (old) old.parentNode.removeChild(old);
    var bubble = el('div', {
      class: 'TradeBubble' + (kind === 'positive' ? ' is-positive' : (kind === 'negative' ? ' is-negative' : ''))
    }, text);
    header.appendChild(bubble);
    if (pigReactionTimer) clearTimeout(pigReactionTimer);
    pigReactionTimer = setTimeout(function () {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 3000);
  }

  // 拒绝抖动
  function shakeReject() {
    var offerSlot = $('.TradeOfferSlot[data-offer-kind="offer"]', currentDialog.root);
    if (offerSlot) {
      offerSlot.classList.add('DragRejectShake');
      setTimeout(function () { offerSlot.classList.remove('DragRejectShake'); }, 220);
    }
  }

  // ============================================================================
  // 渲染辅助
  // ============================================================================
  function rerenderAll(state) {
    if (!currentDialog) return;
    var old = $('.TradeBody', currentDialog.root);
    var oldOffer = $('.TradeOfferPanel', currentDialog.root);
    if (old) {
      var fresh = buildBody(state);
      old.parentNode.replaceChild(fresh, old);
    }
    if (oldOffer) {
      var freshOffer = buildOfferPanel(state);
      oldOffer.parentNode.replaceChild(freshOffer, oldOffer);
    }
    rerenderAffinity();
    updateBalance(state);
  }

  // ============================================================================
  // 5Hz tick
  // ============================================================================
  function tick(state) {
    state.tickCount++;
    // 每 5 秒(25 ticks)衰减猪人"最近买过"记忆,让价格回归
    if (state.tickCount % 25 === 0) {
      Object.keys(state.marketState.pigBought).forEach(function (k) {
        state.marketState.pigBought[k] = Math.max(0, state.marketState.pigBought[k] - 1);
      });
      Object.keys(state.marketState.playerBought).forEach(function (k) {
        state.marketState.playerBought[k] = Math.max(0, state.marketState.playerBought[k] - 1);
      });
    }
    // 每 1 秒(5 ticks)重新渲染价格标签(避免价格狂跳,5Hz 仍平滑)
    if (state.tickCount % 5 === 0) {
      // 找到所有价格标签,刷新(只刷新数值,不动结构)
      $$('.TradePriceTag', currentDialog.root).forEach(function (tag) {
        var slot = tag.closest('.TradeSlot');
        if (!slot) return;
        var side = slot.getAttribute('data-side');
        var idx = parseInt(slot.getAttribute('data-idx'), 10);
        var stack = (side === 'player' ? state.playerInventory : state.pigInventory)[idx];
        if (!stack) return;
        var midPrice = priceForBuy(stack.itemId, state.pig, state.marketState, 'player-buys-from-pig');
        var valEl = $('.TradePrice-Value', tag);
        if (valEl) valEl.textContent = String(midPrice);
        var trendEl = $('.TradePrice-Trend', tag);
        if (trendEl) {
          var bought = state.marketState.pigBought[stack.itemId] || 0;
          trendEl.className = 'TradePrice-Trend ' + (bought > 5 ? 'is-up' : 'is-flat');
          trendEl.textContent = bought > 5 ? '↑' : '·';
        }
      });
    }
    // 推 hudBus
    if (window.__hudBus) {
      window.__hudBus.emit('trade:tick', { tick: state.tickCount });
    }
  }

  // ============================================================================
  // 公共 API
  // ============================================================================
  window.Trading = {
    open: openTrade,
    close: closeTrade,
    isOpen: isOpen,
    currentPig: currentPig,
    ITEMS: ITEMS,                  // 暴露给 npc.js 复用
    PIG_LINES: PIG_LINES,
    priceForBuy: priceForBuy,
    genMockPigInventory: genMockPigInventory
  };

})();
