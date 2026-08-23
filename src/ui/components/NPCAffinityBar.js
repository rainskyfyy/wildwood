/**
 * Wildwood UI · v0.8.0 NPC 好感度 HUD 组件(真实引擎接入)
 *
 * 职责:
 *   1. 统一显示"当前视野内 NPC"的好感度 HUD
 *      头像 + 姓名 + 0-3 心 + 互动热提示
 *   2. 跨屏复用:
 *      - HUD 顶部栏(玩家身边 NPC)
 *      - 交易窗口头部(正在交易的猪人)
 *      - 对话气泡(语音冒泡时)
 *   3. 5Hz 同步(订阅 hudBus 'engine:frame' 事件):
 *      每帧检查 NPC 数据变化(从 event.game.npcMgr.piglins 拉),只更新差异部分
 *   4. 风格 token 全部走 var(--*) CSS 变量,与 tokens.css 对齐
 *   5. 暴露 window.NPCAffinityBar,与 v0.5.4 trading.js / npc.js 兼容
 *
 * 公共 API:
 *   NPCAffinityBar.create(pig, opts)  → DOM 元素
 *   NPCAffinityBar.mount(pigProvider, container, opts) → DOM + engine:frame 订阅
 *   NPCAffinityBar.update(el, pig)    → 手动刷新(节流,只改差异)
 *   NPCAffinityBar.unmount(unmountFn) → 解除订阅
 *
 * 数据契约(与 v0.5.4 npc.js / trading.js 兼容):
 *   pig = { id, name, affinity (0..3), portrait?, hint?, recruit? }
 *   opts = { theme, showHint, showRecruit, clickable }
 *
 * v0.8.0 真实引擎接入:
 *   - pig 数据从 event.game.npcMgr.piglins 拉(过滤非 DEAD)
 *   - 通过 hudBus.on('engine:frame', ...) 订阅,代替之前的 __tickState
 *   - 兼容:若 hudBus 未就绪,降级到 setInterval 100ms 轮询
 *
 * 依赖:
 *   - <link rel="stylesheet" href="./src/ui/components/NPCAffinityBar.css">
 *   - <script src="./src/ui/hud.js"></script>(提供 __hudBus)
 *   - .AffinityHeart 来自 src/ui/npc/npc.css(共享)
 *
 * 安全: 防御性判空,无 DOM 不抛错,不修改 v0.5.4 已有模块,普通 <script> 加载
 */
(function () {
  'use strict';
  var AFFINITY_MAX = 3;
  var HINT_DEFAULT = '按 F 喂食';
  var HINT_RECRUIT = '按 R 招募!';
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.keys(v).forEach(function (dk) { n.dataset[dk] = v[dk]; });
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    if (children) [].concat(children).forEach(function (c) {
      if (c != null) n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  // 创建 0-3 心 DOM(复用 npc.css .AffinityHeart)
  function buildHearts(affinity) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < AFFINITY_MAX; i++) {
      var filled = i < affinity;
      frag.appendChild(el('span', {
        class: 'AffinityHeart ' + (filled ? 'is-filled' : 'is-empty'),
        'data-heart-idx': String(i),
        title: '好感度 ' + (i + 1) + '/' + AFFINITY_MAX
      }, filled ? '♥' : '♡'));
    }
    return frag;
  }
  // 创建单个 NPCAffinityBar DOM
  // pig: { id, name, affinity (0..3), portrait?, hint? }
  // opts: { theme?: 'top-hud'|'trade'|'bubble', showHint?, showRecruit? }
  function create(pig, opts) {
    opts = opts || {};
    pig = pig || {};
    var theme = opts.theme || 'top-hud';
    var showHint = opts.showHint !== false;
    var affinity = pig.affinity || 0;
    var root = el('div', {
      class: 'NPCAffinityBar NPCAffinityBar-Theme-' + theme + (affinity >= AFFINITY_MAX ? ' is-full' : ''),
      'data-pig-id': String(pig.id != null ? pig.id : ''),
      role: 'group',
      'aria-label': 'NPC 好感度 ' + (pig.name || '') + ' ' + affinity + '/' + AFFINITY_MAX
    });
    root.appendChild(el('div', { class: 'NPCAffinityBar-Avatar', 'aria-hidden': 'true' }, pig.portrait || '猪'));
    var body = el('div', { class: 'NPCAffinityBar-Body' });
    body.appendChild(el('div', { class: 'NPCAffinityBar-Name' }, pig.name || '猪人'));
    var display = el('div', { class: 'NPCAffinityBar-Display AffinityDisplay' });
    display.appendChild(buildHearts(affinity));
    if (opts.showRecruit !== false && affinity >= AFFINITY_MAX) {
      display.appendChild(el('span', { class: 'AffinityRecruitFlag' }, '可招募'));
    }
    body.appendChild(display);
    root.appendChild(body);
    if (showHint) {
      var hint = affinity >= AFFINITY_MAX ? (pig.hint || HINT_RECRUIT) : (pig.hint || HINT_DEFAULT);
      root.appendChild(el('div', { class: 'NPCAffinityBar-Hint' }, hint));
    }
    root._lastAffinity = affinity;
    root._lastHint = pig.hint || '';
    return root;
  }
  // 节流更新(只改变化部分)
  function update(barEl, pig) {
    if (!barEl || !pig) return;
    var next = pig.affinity || 0;
    var prev = barEl._lastAffinity;
    var hintChanged = barEl._lastHint !== (pig.hint || '');
    var crossMax = (prev < AFFINITY_MAX && next >= AFFINITY_MAX) || (prev >= AFFINITY_MAX && next < AFFINITY_MAX);
    if (prev === next && !hintChanged && !crossMax) return;
    var display = $('.NPCAffinityBar-Display', barEl);
    if (display) {
      while (display.firstChild) display.removeChild(display.firstChild);
      display.appendChild(buildHearts(next));
      var oldFlag = $('.AffinityRecruitFlag', display);
      if (next >= AFFINITY_MAX && !oldFlag) {
        display.appendChild(el('span', { class: 'AffinityRecruitFlag' }, '可招募'));
      } else if (next < AFFINITY_MAX && oldFlag) {
        display.removeChild(oldFlag);
      }
    }
    var hintEl = $('.NPCAffinityBar-Hint', barEl);
    if (hintEl) {
      hintEl.textContent = next >= AFFINITY_MAX ? (pig.hint || HINT_RECRUIT) : (pig.hint || HINT_DEFAULT);
    }
    if (next >= AFFINITY_MAX) barEl.classList.add('is-full');
    else barEl.classList.remove('is-full');
    barEl.setAttribute('aria-label', 'NPC 好感度 ' + (pig.name || '') + ' ' + next + '/' + AFFINITY_MAX);
    barEl._lastAffinity = next;
    barEl._lastHint = pig.hint || '';
  }
  // 从引擎 NPC 转换成 UI pig 对象
  // enginePig: src/npc/piglin.js 的 Piglin 实例
  //   字段:.id, .affection, .hp, .state, .config.name?, .typeId
  function fromEnginePig(enginePig, idx) {
    if (!enginePig) return null;
    var name = (enginePig.config && enginePig.config.name) || ('猪人 #' + ((idx || 0) + 1));
    return {
      id: enginePig.id || ('pig-' + idx),
      name: name,
      affinity: Math.max(0, Math.min(AFFINITY_MAX, enginePig.affection || 0)),
      portrait: '🐷',
      hint: ''
    };
  }
  // 自动 5Hz 同步挂载: pigProvider() 返回当前 NPC,无 NPC 时组件自动隐藏
  // v0.8.0 真实接入:从 hudBus 'engine:frame' 拉,代替 __tickState
  function mount(pigProvider, container, opts) {
    if (!container) return null;
    opts = opts || {};
    var bar = null, pigId = null, unsubscribe = null;
    function ensure(pig) {
      if (!pig) {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        bar = null; pigId = null;
        return;
      }
      if (bar && pigId === pig.id) { update(bar, pig); return; }
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = create(pig, opts);
      bar._pig = pig;
      container.appendChild(bar);
      pigId = pig.id;
    }
    function onTick() { ensure((typeof pigProvider === 'function') ? pigProvider() : pigProvider); }
    // v0.8.0:优先订阅 hudBus 'engine:frame'(与 v0.5.4 烹饪/交易模块同源)
    var bus = window.__hudBus;
    if (bus && typeof bus.on === 'function') {
      // 包装一层:引擎帧尾触发时调用 onTick
      function onFrame() { onTick(); }
      bus.on('engine:frame', onFrame);
      unsubscribe = function () { bus.off('engine:frame', onFrame); };
    } else if (window.__tickState && typeof window.__tickState.subscribe === 'function') {
      // 兼容:__tickState 仍可用(向后兼容 v0.6.x)
      unsubscribe = window.__tickState.subscribe(onTick);
    } else {
      // 降级: 100ms 轮询
      var fallbackId = setInterval(onTick, 100);
      unsubscribe = function () { clearInterval(fallbackId); };
    }
    onTick();
    return function unmount() {
      if (unsubscribe) unsubscribe();
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
    };
  }
  // 公开 API
  window.NPCAffinityBar = {
    create: create, update: update, mount: mount,
    fromEnginePig: fromEnginePig,
    AFFINITY_MAX: AFFINITY_MAX,
    HINTS: { DEFAULT: HINT_DEFAULT, RECRUIT: HINT_RECRUIT }
  };
})();
