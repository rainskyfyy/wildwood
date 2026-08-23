/**
 * v0.8.3a P1 · vitals 系统统一 smoke test
 *
 * dispatcher 报告 #6(v0.8.0 前):
 *   "hud.js 有自己的 tick(每 200ms 饥饿 -1、理智 -0.5),游戏引擎
 *    也有自己的 tick(每帧饥饿 -dt×0.4、理智 -dt×0.2)。它们独立运行、
 *    独立衰减,demo 上显示的数字和游戏引擎里的真实值对不上。"
 *
 * 修复(v0.8.3a P1):
 *   - src/ui/hud.js 删本地衰减(每 200ms 饥饿 -1 / 理智 -0.5)
 *   - 删 vitalsDemoEnabled 标志(无 demo / 真实双模式,只有引擎单源)
 *   - 删 cloneVitals() 工具(只被 mock tick 用)
 *   - 删 'vitals:change' 订阅(引擎不 emit 此事件,旧订阅是死代码)
 *   - 加 'engine:frame' 订阅 → 把 event.game.vitalsState 拿到本地
 *   - 删 setDemoEnabled API(已无 demo 模式)
 *
 * 验收:
 *   1. 文件内容:无 mock 衰减模式
 *   2. 文件内容:有 'engine:frame' 订阅
 *   3. 文件内容:API 无 setDemoEnabled
 *   4. 行为:fake 引擎 emit 'engine:frame' → DOM 三围条更新为引擎值
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD_PATH = path.join(__dirname, '..', 'src', 'ui', 'hud.js');

function readHud() {
  return fs.readFileSync(HUD_PATH, 'utf8');
}

describe('m8.3a-vitals-unify · file content (no mock tick)', () => {
  let src;
  beforeEach(() => { src = readHud(); });

  it('does NOT mutate vitalsState.hunger.cur with mock decrement', () => {
    // 旧 mock 模式:vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - 1)
    assert.equal(
      /vitalsState\.hunger\.cur\s*=\s*Math\.max\(\s*0\s*,\s*vitalsState\.hunger\.cur\s*-\s*1\s*\)/.test(src),
      false,
      'mock tick 衰减 hunger 仍存在 — v0.8.3a P1 修复未生效'
    );
  });

  it('does NOT mutate vitalsState.sanity.cur with mock decrement', () => {
    // 旧 mock 模式:vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - 0.5)
    assert.equal(
      /vitalsState\.sanity\.cur\s*=\s*Math\.max\(\s*0\s*,\s*vitalsState\.sanity\.cur\s*-\s*0\.5\s*\)/.test(src),
      false,
      'mock tick 衰减 sanity 仍存在 — v0.8.3a P1 修复未生效'
    );
  });

  it('does NOT declare vitalsDemoEnabled variable', () => {
    // 旧:vitalsDemoEnabled = true;
    assert.equal(/var\s+vitalsDemoEnabled\s*=/.test(src), false,
      'vitalsDemoEnabled 标志仍存在 — v0.8.3a P1 修复未生效');
  });

  it('does NOT define cloneVitals (only used by mock tick)', () => {
    // 旧:function cloneVitals(v) { return {...} }
    assert.equal(/function\s+cloneVitals\s*\(/.test(src), false,
      'cloneVitals() 仍存在(只被 mock tick 用)');
  });

  it('does NOT subscribe to dead "vitals:change" event', () => {
    // 旧:hudBus.on('vitals:change', function (v) { ... })
    // 注意只检测订阅,emit 在 fake 行为测试里覆盖
    assert.equal(/hudBus\.on\(\s*['"]vitals:change['"]/.test(src), false,
      "'vitals:change' 订阅仍存在(引擎不 emit 此事件,旧订阅是死代码)");
  });
});

describe('m8.3a-vitals-unify · file content (engine single source)', () => {
  let src;
  beforeEach(() => { src = readHud(); });

  it('subscribes to "engine:frame" event', () => {
    assert.match(src, /hudBus\.on\(\s*['"]engine:frame['"]\s*,\s*function/,
      "缺少 'engine:frame' 订阅 — v0.8.3a P1 修复未生效");
  });

  it('engine:frame handler reads event.game.vitalsState', () => {
    // 订阅体里读 e.game.vitalsState
    const subMatch = src.match(/hudBus\.on\(\s*['"]engine:frame['"]\s*,\s*function\s*\(\s*\w+\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\)/);
    assert.ok(subMatch, "找不到 'engine:frame' 订阅函数体");
    const body = subMatch[1];
    assert.match(body, /event\.game\.vitalsState|e\.game\.vitalsState/,
      "'engine:frame' 订阅体未读 event.game.vitalsState");
  });

  it('exposes setVitals debug API (保留向后兼容)', () => {
    assert.match(src, /setVitals\s*:\s*function/,
      "HudBusAPI.setVitals 缺失(可能破坏外部调用方)");
  });

  it('does NOT expose setDemoEnabled in API (无 demo 模式)', () => {
    // 检测 HudBusAPI 块内的 setDemoEnabled
    const apiMatch = src.match(/HudBusAPI\s*=\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(apiMatch, "找不到 HudBusAPI 定义");
    assert.equal(/setDemoEnabled\s*:/.test(apiMatch[1]), false,
      'HudBusAPI 仍暴露 setDemoEnabled(无 demo 模式,应移除)');
  });
});

describe('m8.3a-vitals-unify · behavior (engine:frame updates DOM)', () => {
  // 用 minimal DOM mock 验证订阅→渲染链路
  // IIFE 闭包了 vitalsState,只能通过 DOM 副作用观察
  let captured, origDoc, origWin, origSetInterval;
  let realQS;

  beforeEach(() => {
    // 构建一个 DOM 元素工厂,让每个 selector 对应一个稳定对象
    // 元素自带的 style / textContent 会被 renderVitals 修改
    const store = {};  // sel → element
    const make = (sel) => {
      if (store[sel]) return store[sel];
      const el = {
        sel,
        style: {},
        textContent: '',
        _set: [],
        _classList: { is_low: false, is_critical: false, _toggled: [] },
        classList: null,  // 后注入
        children: [],
        setAttribute: (k, v) => { el['_' + k] = v; },
        getAttribute: (k) => el['_' + k] || null,
        querySelector: (s) => make(sel + ' > ' + s),
        querySelectorAll: () => [],
        appendChild: () => {},
      };
      el.classList = {
        toggle: (cls, force) => {
          if (force === true)  el._classList[cls] = true;
          if (force === false) el._classList[cls] = false;
          el._classList._toggled.push({ cls, force });
        },
        add: (cls) => { el._classList[cls] = true; },
        remove: (cls) => { el._classList[cls] = false; },
        contains: (cls) => !!el._classList[cls],
      };
      store[sel] = el;
      return el;
    };
    realQS = make;

    // 把 HP / Hunger / Sanity 顶层元素绑到 captured
    captured = {
      hp:     make('.VitalBar-HP'),
      hunger: make('.VitalBar-Hunger'),
      sanity: make('.VitalBar-Sanity'),
    };
    // 预创建子元素(.VitalBar-Fill / .VitalBar-Value),确保 querySelector
    // 返回的对象和 setAttribute 的对象是同一个
    captured.hp._fill      = make('.VitalBar-HP > .VitalBar-Fill');
    captured.hp._valEl      = make('.VitalBar-HP > .VitalBar-Value');
    captured.hunger._fill   = make('.VitalBar-Hunger > .VitalBar-Fill');
    captured.hunger._valEl  = make('.VitalBar-Hunger > .VitalBar-Value');
    captured.sanity._fill   = make('.VitalBar-Sanity > .VitalBar-Fill');
    captured.sanity._valEl  = make('.VitalBar-Sanity > .VitalBar-Value');

    origDoc = globalThis.document;
    origWin = globalThis.window;
    origSetInterval = globalThis.setInterval;
    // mock setInterval:把回调存到 globalThis.__tickCb,测试里手动调
    globalThis.setInterval = (fn, ms) => {
      globalThis.__tickCb = fn;
      return 0;
    };
    globalThis.document = {
      readyState: 'complete',
      querySelector: realQS,
      querySelectorAll: () => [],
      addEventListener: () => {},
      // HudBus 需要一个监听锚。用 EventTarget 替代
      createTextNode: () => new EventTarget(),
    };
    globalThis.window = { __hudBus: null, __game: null };
  });

  it('engine emits "engine:frame" → HUD DOM shows engine vitalsState', () => {
    // 1. eval IIFE(init 跑,setInterval 注册 tick 回调到 globalThis.__tickCb)
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    assert.equal(typeof globalThis.__tickCb, 'function',
      'init() 未通过 setInterval 注册 tick 回调');

    // 2. 拿到 IIFE 内部创建的 bus
    const realBus = globalThis.window.HudBusAPI.bus;

    // 3. fake 引擎 emit(模拟引擎已就绪后首帧,带真实 vitalsState)
    const fakeGame = {
      vitalsState: {
        hp:     { cur: 75,  max: 100 },
        hunger: { cur: 40,  max: 100 },
        sanity: { cur: 88,  max: 100 },
      },
    };
    realBus.emit('engine:frame', { now: 0, dt: 0.016, game: fakeGame });

    // 4. 手动调一次 tick(对应真实 setInterval 200ms 后触发的那次)
    //    此时 vitalsState ref 已切到 fakeGame.vitalsState,renderVitals 读到的就是 75/40/88
    globalThis.__tickCb();

    // 5. 检查 DOM 抓到了引擎值
    assert.equal(captured.hp._fill.style.width,     '75%', 'HP fill width 未反映引擎值');
    assert.equal(captured.hunger._fill.style.width, '40%', 'Hunger fill width 未反映引擎值');
    assert.equal(captured.sanity._fill.style.width, '88%', 'Sanity fill width 未反映引擎值');
    assert.equal(captured.hp._valEl.textContent,     '75/100', 'HP 文本未反映引擎值');
    assert.equal(captured.hunger._valEl.textContent, '40/100', 'Hunger 文本未反映引擎值');
    assert.equal(captured.sanity._valEl.textContent, '88/100', 'Sanity 文本未反映引擎值');
  });

  it('mock tick does NOT mutate vitalsState (single-source guarantee)', () => {
    // 即使触发 tick,vitalsState.cur 也不应被改
    // 数据只通过 'engine:frame' 流入,'tick' 只负责渲染
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const realBus = globalThis.window.HudBusAPI.bus;
    const initialVitals = {
      hp:     { cur: 50,  max: 100 },
      hunger: { cur: 60,  max: 100 },
      sanity: { cur: 70,  max: 100 },
    };
    const fakeGame = { vitalsState: initialVitals };
    realBus.emit('engine:frame', { now: 0, dt: 0.016, game: fakeGame });
    // 跑 100 次 tick(对应真实环境 20s)
    for (let i = 0; i < 100; i++) globalThis.__tickCb();
    // fakeGame.vitalsState 的 cur 应该还是 50/60/70 — tick 不应修改
    assert.equal(fakeGame.vitalsState.hp.cur,     50, 'tick 改了 hp.cur');
    assert.equal(fakeGame.vitalsState.hunger.cur, 60, 'tick 改了 hunger.cur');
    assert.equal(fakeGame.vitalsState.sanity.cur, 70, 'tick 改了 sanity.cur');
  });

  // 清理 global
  afterEach(() => {
    if (origDoc)   globalThis.document = origDoc;
    if (origWin)   globalThis.window   = origWin;
    if (origSetInterval) globalThis.setInterval = origSetInterval;
    delete globalThis.window?.__hudBus;
    delete globalThis.window?.__game;
  });
});
