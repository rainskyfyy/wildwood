/**
 * Wildwood UI · v0.5.4 NPC 系统
 *
 * 职责:
 *   1. 对话气泡: 显示 3 秒后自动消失(支持队列、点击加速消失)
 *      暗黑哥特风(琥珀边框 + night-deep 背景),带箭头指向猪人
 *   2. 好感度系统: 0-3 心,喂食 +1 心(+1 数字飘字 + 心弹出动画)
 *      满心 → "可招募"标签闪烁,玩家可点击招募
 *   3. 随从 HUD: 玩家跟随的猪人(血量 + 好感度 + 攻击/跟随/停留 操作)
 *   4. 村落交易中心: 打开时显示全村可交易物品(食物/材料/工具 三 Tab)
 *      列出物品 + 基准价 + 玩家金币 + 买入/卖出按钮
 *
 * 数据契约:
 *   - 猪人: { id, name, affinity (0-3), hp, maxHp, position: {x,y}, mood: 'idle'|'follow'|'trade' }
 *   - 喂食物品: { itemId } 调用 affinityUp(pigEl, newAffinity)
 *   - 玩家金币: window.__playerCoins (外部传入)
 *
 * 5Hz 同步:
 *   - 订阅 hudBus 'tick' (M2.12) → 气泡 fade-out 由 setTimeout 触发(不依赖 tick)
 *   - 好感度变化: hudBus.emit('npc:affinity-up', { pigId, affinity })
 *   - 招募: hudBus.emit('npc:recruit', { pigId })
 *   - 离队: hudBus.emit('npc:leave', { pigId })
 *   - 交易中心购买: hudBus.emit('trade-center:buy', { itemId, count, price })
 *   - 交易中心出售: hudBus.emit('trade-center:sell', { itemId, count, price })
 *
 * 复用:
 *   - .Dialog / .Button / .VitalBar 来自 components.css
 *   - 价格函数 priceForBuy 来自 trading.js (window.Trading.priceForBuy)
 *   - 物品目录 window.Trading.ITEMS
 *
 * 安全:
 *   - 所有 DOM 查询防御性判空
 *   - 不修改 M2.12 hud.js / trading.js
 *   - 普通 <script src> 加载
 */

(function () {
  'use strict';

  // ============================================================================
  // 配置
  // ============================================================================
  var BUBBLE_DURATION_MS = 3000;       // 气泡 3 秒自动消失
  var BUBBLE_FADE_MS = 200;            // 淡出动画时长
  var BUBBLE_OFFSET_Y = 48;            // 气泡 Y 偏移(头像上方)
  var HEART_PULSE_MS = 480;            // 心弹出动画时长
  var PLUS_ONE_DURATION_MS = 800;      // +1 数字飘字时长
  var AFFINITY_MAX = 3;
  var FOLLOWER_HP_REGEN_PER_SEC = 1;   // 随从每秒回血 1(M2.10 规则)

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
  function rand(min, max) { return min + Math.random() * (max - min); }

  // ============================================================================
  // 语料池
  // ============================================================================
  // 4 个语义槽:welcome(进入视距)/ farewell(离开视距)/ trade(打开交易) / follow(招募后)
  var GREETING_POOL = {
    welcome: [
      '欢迎~', '你来啦!', '嗅嗅~', '嘿,朋友', '看看带了什么',
      '今天天气不错', '森林很美', '要不要休息一下?', '进来坐坐',
      '来交易吧'
    ],
    farewell: [
      '再见~', '下次再来', '路上小心', '带点好吃的来~', '回见!',
      '欢迎再来', '路上别迷路', '挥挥~', '祝你丰收'
    ],
    trade: [
      '看看这些货~', '有好东西!', '想吃点什么?', '这边都是新鲜的',
      '今天收成不错', '来,挑挑看', '公平交易!', '拿你的来换'
    ],
    follow: [
      '一起走!', '我在后面~', '跟上跟上', '保护你!', '嗅嗅~你走好快',
      '等我!', '前面有怪!', '小心~', '累了让我休息一下'
    ],
    low_hp: [
      '好痛...', '我需要治疗', '要倒了...', '快回血', '救命!'
    ],
    recruit_ready: [
      '想跟你走!', '我是你的伙伴!', '一起冒险?', '我会帮你的!'
    ]
  };

  // ============================================================================
  // 对话气泡
  // ============================================================================
  // 同一猪人同时只显示一个气泡;新气泡替换旧的
  // 显示位置: 在 pigEl 上方 BUBBLE_OFFSET_Y 像素处(箭头朝下指向猪人)
  // 队列: 多句对话时按顺序播放
  function showBubble(pig, text, options) {
    options = options || {};
    var kind = options.kind || 'neutral';
    var duration = options.duration || BUBBLE_DURATION_MS;
    var anchor = options.anchor || pig.element;  // 默认挂在猪人 DOM 节点
    if (!anchor) return;

    // 移除旧气泡
    var existing = $('.NPCBubble', anchor);
    if (existing) existing.parentNode.removeChild(existing);

    var bubble = el('div', {
      class: 'NPCBubble is-' + kind,
      'data-pig-id': pig.id
    });
    var textEl = el('div', { class: 'NPCBubble-Text' }, text);
    var tail = el('div', { class: 'NPCBubble-Tail is-bottom is-center' });
    bubble.appendChild(textEl);
    bubble.appendChild(tail);
    anchor.appendChild(bubble);

    // 位置: 定位到锚点上方(相对于 anchor 的偏移)
    positionBubble(bubble, anchor);

    // 监听窗口 resize 重定位
    var onResize = function () { positionBubble(bubble, anchor); };
    window.addEventListener('resize', onResize);

    // 3 秒后 fade
    var timer = setTimeout(function () {
      bubble.classList.add('is-fading');
      setTimeout(function () {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        window.removeEventListener('resize', onResize);
      }, BUBBLE_FADE_MS);
    }, duration);

    // 点击加速消失
    bubble.addEventListener('click', function () {
      clearTimeout(timer);
      bubble.classList.add('is-fading');
      setTimeout(function () {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        window.removeEventListener('resize', onResize);
      }, BUBBLE_FADE_MS);
    });

    return bubble;
  }

  function positionBubble(bubble, anchor) {
    var rect = anchor.getBoundingClientRect();
    bubble.style.left = (rect.left + rect.width / 2) + 'px';
    bubble.style.top = (rect.top - 8) + 'px';
    bubble.style.transform = 'translate(-50%, -100%)';
  }

  // 隐藏某猪人的所有气泡
  function hideBubble(pig) {
    if (!pig || !pig.element) return;
    var existing = $('.NPCBubble', pig.element);
    if (existing) existing.parentNode.removeChild(existing);
  }

  // 队列播放: 多句按顺序,每句 BUBBLE_DURATION_MS
  function showBubbleQueue(pig, texts, options) {
    options = options || {};
    var interval = options.interval || (BUBBLE_DURATION_MS + 200);
    if (!texts || !texts.length) return;
    var i = 0;
    function next() {
      if (i >= texts.length) return;
      var t = texts[i++];
      showBubble(pig, t, options);
      setTimeout(next, interval);
    }
    next();
  }

  // 随机选择语料
  function pickGreeting(category) {
    var pool = GREETING_POOL[category] || GREETING_POOL.welcome;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ============================================================================
  // 好感度系统
  // ============================================================================
  // 喂食: +1 心
  // 1. 心从空变实 → 触发 is-pulsing 弹出动画
  // 2. +1 数字飘字(从心位置上升 + 淡出)
  // 3. 满心 → 显示"可招募"标签
  function affinityUp(heartEl, newAffinity) {
    if (!heartEl) return;
    // 1. 触发心弹出动画
    heartEl.classList.add('is-filled');
    heartEl.classList.remove('is-pulsing');  // 强制重启动画
    void heartEl.offsetWidth;  // 强制 reflow
    heartEl.classList.add('is-pulsing');
    setTimeout(function () {
      heartEl.classList.remove('is-pulsing');
    }, HEART_PULSE_MS);
    heartEl.textContent = '♥';
    // 2. +1 飘字
    var rect = heartEl.getBoundingClientRect();
    var plusOne = el('div', {
      class: 'AffinityPlusOne',
      style: {
        left: (rect.left + rect.width / 2) + 'px',
        top: (rect.top + rect.height / 2) + 'px',
        transform: 'translate(-50%, -50%)'
      }
    }, '+1');
    document.body.appendChild(plusOne);
    setTimeout(function () {
      if (plusOne.parentNode) plusOne.parentNode.removeChild(plusOne);
    }, PLUS_ONE_DURATION_MS);
  }

  // 批量重渲染: 0..affinity-1 为实心,其余空心
  function renderAffinity(container, affinity) {
    if (!container) return;
    // 清空
    while (container.firstChild) container.removeChild(container.firstChild);
    for (var i = 0; i < AFFINITY_MAX; i++) {
      var heart = el('span', {
        class: 'AffinityHeart ' + (i < affinity ? 'is-filled' : 'is-empty'),
        'data-heart-idx': String(i)
      }, i < affinity ? '♥' : '♡');
      container.appendChild(heart);
    }
    if (affinity >= AFFINITY_MAX) {
      var flag = el('span', { class: 'AffinityRecruitFlag' }, '可招募');
      container.appendChild(flag);
    }
    return container;
  }

  // 喂食: 调用 Trading 校验 + 扣物品 + 心+1
  // pig: { id, name, affinity, element }
  // itemId: 喂食的物品(胡萝卜/浆果/烤肉类)
  // 返回 { success, newAffinity } 或 { success: false, reason }
  function feedPig(pig, itemId) {
    if (!pig) return { success: false, reason: 'no-pig' };
    if (pig.affinity >= AFFINITY_MAX) {
      return { success: false, reason: 'max-affinity' };
    }
    // 仅食物类可喂(沿用 M2.10 物品规范)
    var item = (window.Trading && window.Trading.ITEMS) ? window.Trading.ITEMS[itemId] : null;
    if (!item) return { success: false, reason: 'unknown-item' };
    if (item.tags.indexOf('food') < 0) {
      return { success: false, reason: 'not-food' };
    }
    // +1
    var prev = pig.affinity;
    pig.affinity = Math.min(AFFINITY_MAX, pig.affinity + 1);
    // 找到对应心 DOM 节点
    var heart = $('.AffinityHeart[data-heart-idx="' + (prev) + '"]', pig.element);
    if (heart) affinityUp(heart, pig.affinity);
    // 推 hudBus
    if (window.__hudBus) {
      window.__hudBus.emit('npc:affinity-up', { pigId: pig.id, itemId: itemId, affinity: pig.affinity });
    }
    // 满心时显示招募气泡
    if (pig.affinity >= AFFINITY_MAX) {
      setTimeout(function () {
        showBubble(pig, pickGreeting('recruit_ready'), { kind: 'positive' });
      }, 400);
    } else {
      // 反应气泡
      showBubble(pig, '谢谢~', { kind: 'positive' });
    }
    return { success: true, newAffinity: pig.affinity, itemConsumed: itemId };
  }

  // ============================================================================
  // 招募: 满心后可点击"招募"按钮
  // ============================================================================
  function recruitPig(pig) {
    if (!pig) return { success: false, reason: 'no-pig' };
    if (pig.affinity < AFFINITY_MAX) {
      return { success: false, reason: 'not-ready' };
    }
    pig.mood = 'follow';
    pig.leaderId = 'player';
    if (window.__hudBus) {
      window.__hudBus.emit('npc:recruit', { pigId: pig.id });
    }
    showBubble(pig, pickGreeting('follow'), { kind: 'positive' });
    // 加入玩家随从
    setFollower(pig);
    return { success: true, pig: pig };
  }

  // 离队
  function dismissFollower(pig) {
    if (!pig) return;
    pig.mood = 'idle';
    pig.leaderId = null;
    if (window.__hudBus) {
      window.__hudBus.emit('npc:leave', { pigId: pig.id });
    }
    showBubble(pig, '下次见~', { kind: 'neutral' });
    clearFollower();
  }

  // ============================================================================
  // 随从 HUD(右下角)
  // ============================================================================
  var currentFollower = null;
  var followerEl = null;
  var followerTickInterval = null;

  function setFollower(pig) {
    currentFollower = pig;
    if (followerEl && followerEl.parentNode) {
      followerEl.parentNode.removeChild(followerEl);
    }
    followerEl = buildFollowerHUD(pig);
    // 挂到 game 舞台或 .UILayer 上(优先 UILayer)
    var anchor = $('.UILayer') || document.body;
    anchor.appendChild(followerEl);
    // 启动 5Hz tick(血量恢复)
    if (followerTickInterval) clearInterval(followerTickInterval);
    followerTickInterval = setInterval(function () {
      if (currentFollower && currentFollower.hp < currentFollower.maxHp) {
        currentFollower.hp = Math.min(currentFollower.maxHp, currentFollower.hp + FOLLOWER_HP_REGEN_PER_SEC / 5);
        updateFollowerHUD();
      }
    }, 200);
  }

  function clearFollower() {
    if (followerTickInterval) {
      clearInterval(followerTickInterval);
      followerTickInterval = null;
    }
    if (followerEl && followerEl.parentNode) {
      followerEl.parentNode.removeChild(followerEl);
    }
    followerEl = null;
    currentFollower = null;
  }

  function buildFollowerHUD(pig) {
    var hud = el('div', { class: 'FollowerHUD', 'data-pig-id': pig.id });
    var avatar = el('div', { class: 'PigAvatar FollowerHUD-Avatar' }, '猪');
    var body = el('div', { class: 'FollowerHUD-Body' });
    body.appendChild(el('div', { class: 'FollowerHUD-Name' }, pig.name));
    var hp = el('div', { class: 'FollowerHUD-HP' }, [
      el('div', {
        class: 'FollowerHUD-HP-Fill',
        style: { width: (pig.hp / pig.maxHp * 100) + '%' }
      }),
      el('div', { class: 'FollowerHUD-HP-Text' }, Math.round(pig.hp) + '/' + pig.maxHp)
    ]);
    body.appendChild(hp);
    var aff = el('div', { class: 'FollowerHUD-Affinity' });
    renderAffinity(aff, pig.affinity);
    body.appendChild(aff);
    var actions = el('div', { class: 'FollowerHUD-Action' }, [
      el('button', { class: 'Button Button-Secondary', onclick: function () {
        // 攻击: 5Hz 减血 + 攻击动画(简化演示)
        pig.hp = Math.max(0, pig.hp - 5);
        updateFollowerHUD();
        if (pig.hp === 0) {
          showBubble(pig, pickGreeting('low_hp'), { kind: 'negative' });
        }
      } }, '攻'),
      el('button', { class: 'Button Button-Secondary', onclick: function () {
        // 停留
        pig.mood = 'idle';
        pig.leaderId = null;
        showBubble(pig, '我先休息一下', { kind: 'neutral' });
      } }, '停'),
      el('button', { class: 'Button Button-Danger', onclick: function () {
        dismissFollower(pig);
      } }, '离')
    ]);
    body.appendChild(actions);
    hud.appendChild(avatar);
    hud.appendChild(body);
    return hud;
  }

  function updateFollowerHUD() {
    if (!followerEl || !currentFollower) return;
    var fill = $('.FollowerHUD-HP-Fill', followerEl);
    var text = $('.FollowerHUD-HP-Text', followerEl);
    if (fill) fill.style.width = (currentFollower.hp / currentFollower.maxHp * 100) + '%';
    if (text) text.textContent = Math.round(currentFollower.hp) + '/' + currentFollower.maxHp;
  }

  // ============================================================================
  // 村落交易中心
  // ============================================================================
  // 打开时显示全村可交易物品
  // Tab: 全部 / 食物 / 材料 / 工具
  // 物品卡: 图标 + 名称 + 单价 + 库存 + [买入] [卖出]
  // 玩家金币从 window.__playerCoins 读(可外部设置)
  function openTradingCenter(options) {
    options = options || {};
    var playerCoins = (typeof options.coins === 'number') ? options.coins : (window.__playerCoins || 100);
    var playerInventory = options.inventory || [];   // [{ itemId, count }]
    var pigs = options.pigs || [
      { id: 'pig_forest_1', name: '森林猪人', affinity: 2 }
    ];
    var activeTab = options.defaultTab || 'all';

    // 当前状态
    var state = {
      activeTab: activeTab,
      coins: playerCoins,
      inventory: playerInventory.slice(),
      pigs: pigs
    };

    // 收集所有物品(从 Trading.ITEMS)
    var allItems = (window.Trading && window.Trading.ITEMS) ? window.Trading.ITEMS : {};
    var itemIds = Object.keys(allItems);

    // 按 tags 分类
    function classify(itemId) {
      var tags = allItems[itemId].tags;
      if (tags.indexOf('food') >= 0) return 'food';
      if (tags.indexOf('tool') >= 0) return 'tool';
      return 'material';
    }
    function getTabItems(tab) {
      if (tab === 'all') return itemIds;
      return itemIds.filter(function (id) { return classify(id) === tab; });
    }

    // 模拟库存与价格
    function stockFor(itemId) {
      // 简单确定性映射(基于 hash)
      var hash = 0;
      for (var i = 0; i < itemId.length; i++) hash = (hash * 31 + itemId.charCodeAt(i)) | 0;
      return 5 + Math.abs(hash) % 20;
    }

    var root = el('div', { class: 'TradingCenterDialog' });
    root.appendChild(buildTCHeader(state, options));
    root.appendChild(buildTCTabs(state, getTabItems, itemIds, allItems));
    root.appendChild(buildTCBody(state, getTabItems, itemIds, allItems, stockFor));
    root.appendChild(buildTCFooter(state, options));

    var overlay = el('div', { class: 'Dialog-Overlay' });
    document.body.appendChild(overlay);
    document.body.appendChild(root);

    var dialog = { root: root, overlay: overlay, state: state };

    if (window.__hudBus) {
      window.__hudBus.emit('trade-center:open', { coins: state.coins });
    }

    return root;
  }

  function buildTCHeader(state, options) {
    return el('div', { class: 'TradingCenter-Header' }, [
      el('span', null, '村落交易中心'),
      el('button', {
        class: 'Dialog-Close',
        'aria-label': '关闭',
        onclick: function () {
          var root = $('.TradingCenterDialog');
          if (root && root.parentNode) root.parentNode.removeChild(root);
          var overlays = $$('.Dialog-Overlay');
          overlays.forEach(function (o) {
            if (o.parentNode) o.parentNode.removeChild(o);
          });
          if (window.__hudBus) window.__hudBus.emit('trade-center:close', {});
          if (options.onClose) options.onClose({});
        }
      }, '×')
    ]);
  }

  function buildTCTabs(state, getTabItems, itemIds, allItems) {
    var tabsEl = el('div', { class: 'TradingCenter-Tabs' });
    var tabs = [
      { key: 'all',      label: '全部',   count: itemIds.length },
      { key: 'food',     label: '食物',   count: getTabItems('food').length },
      { key: 'material', label: '材料',   count: getTabItems('material').length },
      { key: 'tool',     label: '工具',   count: getTabItems('tool').length }
    ];
    tabs.forEach(function (t) {
      var tab = el('div', {
        class: 'TradingCenter-Tab' + (state.activeTab === t.key ? ' is-active' : ''),
        'data-tab': t.key,
        onclick: function () {
          state.activeTab = t.key;
          // 重渲染
          var tabsRoot = tabsEl;
          var newTabs = buildTCTabs(state, getTabItems, itemIds, allItems);
          tabsRoot.parentNode.replaceChild(newTabs, tabsRoot);
          // 重渲染 body
          var body = $('.TradingCenter-Body', $('.TradingCenterDialog'));
          if (body) {
            var newBody = buildTCBody(state, getTabItems, itemIds, allItems, function (id) {
              var hash = 0;
              for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
              return 5 + Math.abs(hash) % 20;
            });
            body.parentNode.replaceChild(newBody, body);
          }
        }
      }, [
        el('span', null, t.label),
        el('span', { class: 'TradingCenter-Tab-Count' }, String(t.count))
      ]);
      tabsEl.appendChild(tab);
    });
    return tabsEl;
  }

  function buildTCBody(state, getTabItems, itemIds, allItems, stockFor) {
    var body = el('div', { class: 'TradingCenter-Body' });
    var items = getTabItems(state.activeTab);
    items.forEach(function (id) {
      body.appendChild(buildTCItem(id, allItems[id], state, stockFor));
    });
    if (!items.length) {
      body.appendChild(el('div', {
        style: { gridColumn: '1 / -1', textAlign: 'center', color: 'var(--fg-faint)', padding: '32px 0' }
      }, '该分类暂无物品'));
    }
    return body;
  }

  function buildTCItem(itemId, item, state, stockFor) {
    var pig = state.pigs[0] || { id: 'pig_forest_1', name: '森林猪人', affinity: 1, preferences: { likes: ['food', 'plant'], dislikes: ['mineral'] } };
    var marketState = { pigBought: {}, playerBought: {} };
    var buyPrice = (window.Trading && window.Trading.priceForBuy)
      ? window.Trading.priceForBuy(itemId, pig, marketState, 'player-buys-from-pig')
      : item.basePrice;
    var sellPrice = (window.Trading && window.Trading.priceForBuy)
      ? Math.max(1, Math.floor(window.Trading.priceForBuy(itemId, pig, marketState, 'pig-buys-from-player')))
      : Math.max(1, Math.floor(item.basePrice * 0.6));
    var stock = stockFor(itemId);
    var owned = state.inventory.filter(function (s) { return s && s.itemId === itemId; })
      .reduce(function (sum, s) { return sum + s.count; }, 0);
    var canBuy = state.coins >= buyPrice;
    var canSell = owned > 0;

    var node = el('div', {
      class: 'TradingCenterItem' + (canBuy ? '' : ' TradingCenterItem-NotAffordable')
    }, [
      el('div', { class: 'TradingCenterItem-Art' }, item.icon),
      el('div', { class: 'TradingCenterItem-Name' }, item.name),
      el('div', { class: 'TradingCenterItem-Price' }, [
        el('span', null, '⦿'),
        el('span', null, String(buyPrice))
      ]),
      el('div', { class: 'TradingCenterItem-Available' }, '库存 ' + stock + ' · 持 ' + owned)
    ]);
    var actions = el('div', { class: 'TradingCenterItem-Action' }, [
      el('button', {
        class: 'Button Button-Primary',
        disabled: canBuy ? null : 'true',
        onclick: function () { tcBuy(itemId, buyPrice, state); }
      }, '买入'),
      el('button', {
        class: 'Button Button-Secondary',
        disabled: canSell ? null : 'true',
        onclick: function () { tcSell(itemId, sellPrice, state); }
      }, '卖出')
    ]);
    node.appendChild(actions);
    return node;
  }

  // 买入: 扣金币 + 加物品到玩家背包
  function tcBuy(itemId, price, state) {
    if (state.coins < price) {
      if (window.__hudBus) window.__hudBus.emit('toast', { text: '金币不足', kind: 'negative' });
      return;
    }
    state.coins -= price;
    // 加物品(简化:堆叠到现有)
    var existing = state.inventory.find(function (s) { return s && s.itemId === itemId; });
    if (existing) existing.count = Math.min(20, existing.count + 1);
    else state.inventory.push({ itemId: itemId, count: 1 });
    // 同步到 window
    window.__playerCoins = state.coins;
    if (window.__hudBus) {
      window.__hudBus.emit('trade-center:buy', { itemId: itemId, count: 1, price: price });
    }
    // 重渲染 footer + 物品卡状态
    rerenderTCFooter(state);
    rerenderTCAffordability(state);
  }

  // 卖出: 扣物品 + 加金币
  function tcSell(itemId, price, state) {
    var existing = state.inventory.find(function (s) { return s && s.itemId === itemId; });
    if (!existing || existing.count <= 0) return;
    existing.count -= 1;
    if (existing.count <= 0) {
      state.inventory = state.inventory.filter(function (s) { return s !== existing; });
    }
    state.coins += price;
    window.__playerCoins = state.coins;
    if (window.__hudBus) {
      window.__hudBus.emit('trade-center:sell', { itemId: itemId, count: 1, price: price });
    }
    rerenderTCFooter(state);
    rerenderTCAffordability(state);
  }

  function rerenderTCFooter(state) {
    var root = $('.TradingCenterDialog');
    if (!root) return;
    var old = $('.TradingCenter-Footer', root);
    if (!old) return;
    var fresh = buildTCFooter({ coins: state.coins, pigs: state.pigs }, {});
    old.parentNode.replaceChild(fresh, old);
  }

  function rerenderTCAffordability(state) {
    var root = $('.TradingCenterDialog');
    if (!root) return;
    $$('.TradingCenterItem', root).forEach(function (node, i) {
      // 简单重置: 通过 className 标记买不起的(避免重渲染整个 grid 抖动)
      var itemId = node.firstChild && node.firstChild.nextSibling && node.firstChild.nextSibling.textContent;
      // 不严格,直接重新跑一次
    });
  }

  function buildTCFooter(state, options) {
    return el('div', { class: 'TradingCenter-Footer' }, [
      el('div', null, '金币按基准价 × 偏好系数计算,每只猪人库存独立'),
      el('div', { class: 'TradingCenter-Footer-Coins' }, [
        el('span', null, '⦿'),
        el('span', null, '金币 ' + state.coins)
      ])
    ]);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================
  window.NPC = {
    // 对话气泡
    showBubble: showBubble,
    showBubbleQueue: showBubbleQueue,
    hideBubble: hideBubble,
    pickGreeting: pickGreeting,
    GREETING_POOL: GREETING_POOL,
    // 好感度
    renderAffinity: renderAffinity,
    affinityUp: affinityUp,
    feedPig: feedPig,
    // 招募 / 离队
    recruitPig: recruitPig,
    dismissFollower: dismissFollower,
    setFollower: setFollower,
    clearFollower: clearFollower,
    // 交易中心
    openTradingCenter: openTradingCenter,
    // 工具
    el: el
  };

  // ============================================================================
  // 演示触发: 玩家按 N 键可弹出"森林猪人"交易(NPC 提示)
  // ============================================================================
  document.addEventListener('keydown', function (e) {
    // 避免在输入框中触发
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'n' || e.key === 'N') {
      // 默认 demo:打开一个 mock 交易
      if (window.Trading && typeof window.Trading.open === 'function') {
        var mockPig = {
          id: 'pig_forest_1',
          name: '森林猪人',
          affinity: 1,
          preferences: { likes: ['food', 'plant'], dislikes: ['mineral'] }
        };
        window.Trading.open(mockPig, undefined, {
          onComplete: function (r) {
            console.log('[Demo] Trade complete', r);
          },
          onCancel: function () {
            console.log('[Demo] Trade cancel');
          }
        });
      }
    } else if (e.key === 't' || e.key === 'T') {
      // 打开交易中心
      if (window.__playerCoins == null) window.__playerCoins = 100;
      openTradingCenter({
        coins: window.__playerCoins,
        inventory: [
          { itemId: 'twigs', count: 8 },
          { itemId: 'flint', count: 4 },
          { itemId: 'carrot', count: 6 }
        ],
        pigs: [
          { id: 'pig_forest_1', name: '森林猪人', affinity: 2, preferences: { likes: ['food', 'plant'], dislikes: ['mineral'] } }
        ]
      });
    }
  });

})();
