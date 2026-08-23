/**
 * v0.8.3b P2 · 时间 + 快捷栏 系统统一 smoke test
 *
 * dispatcher 报告(P2 范畴):
 *   "hud.js renderTime() 写死 'Day 12 · 14:32' / 用本地 SEASONS[seasonIdx=2] = AUTUMN,
 *    引擎 dayCycle 已经在跑 (8min day + 4min night),但 UI 完全不接。两套时间系统
 *    各自跑。"
 *   "hud.js renderHotbarSelection() 用本地 hotbarSelected=1,引擎 inventory.selected
 *    才是真正的快捷栏选中。两套状态也各跑各的。"
 *
 * 修复(v0.8.3b P2,接 v0.8.3a P1 之后):
 *   - renderTime() 改读 e.game.dayCycle.describe() 引擎单源
 *   - renderHotbarSelection() 改读 e.game.inventory.selected 引擎单源
 *   - click/key/'hotbar:select' 处理器通过 writeHotbar() 写回引擎
 *     inventory.selected(v0.8.0a 冻结 game 字段层但 inventory 实例属性可 mutate)
 *   - SEASONS 保持为静态 UI 装饰(引擎 dayCycle 没有 season 概念,留待未来接)
 *
 * 验收:
 *   1. 文件内容:renderTime 不再写死 'Day 12 · 14:32'
 *   2. 文件内容:有 'engine:frame' 订阅,handler 读 dayCycle + inventory.selected
 *   3. 文件内容:click/key 处理器通过 writeHotbar() 写引擎
 *   4. 文件内容:无 var hotbarSelected 局部变量
 *   5. 行为:fake 引擎 emit 'engine:frame' → DOM TimeDisplay 反映 dayCycle.describe()
 *   6. 行为:fake 引擎 emit 'engine:frame' → hotbar slot 反映 inventory.selected
 *   7. 行为:emit 'hotbar:select' → 写到 window.__game.inventory.selected
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

describe('m8.3b-time-hotbar-unify · file content (no hardcoded UI state)', () => {
  let src;
  beforeEach(() => { src = readHud(); });

  it('renderTime does NOT hardcode "Day 12 · 14:32"', () => {
    assert.equal(
      /textContent\s*=\s*['"]Day 12 · 14:32['"]/.test(src),
      false,
      "renderTime 仍写死 'Day 12 · 14:32' — v0.8.3b P2 修复未生效"
    );
  });

  it('does NOT declare local "var hotbarSelected"', () => {
    assert.equal(/var\s+hotbarSelected\s*=/.test(src), false,
      '局部 var hotbarSelected 仍存在 — v0.8.3b P2 修复未生效');
  });

  it('renderTime reads from dayCycle.describe()', () => {
    // 形如: el.textContent = dayCycle ? dayCycle.describe() : '...'
    assert.match(src, /dayCycle\s*\?\s*dayCycle\.describe\(\)/,
      "renderTime 未使用 dayCycle.describe() — v0.8.3b P2 修复未生效");
  });

  it('renderHotbarSelection reads engineInventorySelected (not local var)', () => {
    // 函数体里比对 i === engineInventorySelected
    const fnMatch = src.match(/function\s+renderHotbarSelection\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(fnMatch, '找不到 renderHotbarSelection 函数体');
    assert.match(fnMatch[1], /i\s*===\s*engineInventorySelected/,
      'renderHotbarSelection 未使用 engineInventorySelected');
  });
});

describe('m8.3b-time-hotbar-unify · file content (engine single source)', () => {
  let src;
  beforeEach(() => { src = readHud(); });

  it('engine:frame handler reads event.game.dayCycle', () => {
    const subMatch = src.match(/hudBus\.on\(\s*['"]engine:frame['"]\s*,\s*function\s*\(\s*\w+\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\)/);
    assert.ok(subMatch, "找不到 'engine:frame' 订阅函数体");
    const body = subMatch[1];
    // 形如 e.game.dayCycle / event.game.dayCycle / g.dayCycle (在函数体内 var g = e.game 后)
    assert.match(body, /(?:event\.game\.dayCycle|e\.game\.dayCycle|g\.dayCycle)/,
      "'engine:frame' 订阅体未读 dayCycle");
  });

  it('engine:frame handler reads event.game.inventory.selected', () => {
    const subMatch = src.match(/hudBus\.on\(\s*['"]engine:frame['"]\s*,\s*function\s*\(\s*\w+\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\)/);
    assert.ok(subMatch, "找不到 'engine:frame' 订阅函数体");
    const body = subMatch[1];
    assert.match(body, /(?:event\.game\.inventory\.selected|e\.game\.inventory\.selected|g\.inventory\.selected)/,
      "'engine:frame' 订阅体未读 inventory.selected");
  });

  it('click handler writes to window.__game.inventory.selected via writeHotbar', () => {
    // writeHotbar() 内部应写 window.__game.inventory.selected = idx
    const fnMatch = src.match(/function\s+writeHotbar\s*\(\s*\w+\s*\)\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(fnMatch, '找不到 writeHotbar 函数定义');
    assert.match(fnMatch[1], /window\.__game\.inventory\.selected\s*=/,
      'writeHotbar 未写入 window.__game.inventory.selected');
  });

  it('click handler invokes writeHotbar (not local var mutation)', () => {
    // click handler 块:写 writeHotbar(idx) 而不是 hotbarSelected = idx
    const clickMatch = src.match(/addEventListener\(\s*['"]click['"]\s*,\s*function\s*\([\s\S]*?\n\s*\}\s*\)/);
    assert.ok(clickMatch, '找不到 click 处理器');
    assert.match(clickMatch[0], /writeHotbar\s*\(/,
      'click 处理器未调用 writeHotbar');
    assert.equal(/hotbarSelected\s*=/.test(clickMatch[0]), false,
      'click 处理器仍直接改 local hotbarSelected');
  });

  it('keydown handler invokes writeHotbar', () => {
    const kdMatch = src.match(/addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([\s\S]*?\n\s*\}\s*\)/);
    assert.ok(kdMatch, '找不到 keydown 处理器');
    assert.match(kdMatch[0], /writeHotbar\s*\(/,
      'keydown 处理器未调用 writeHotbar');
  });

  it('HudBusAPI.setHotbar delegates to writeHotbar', () => {
    // setHotbar 块:writeHotbar(i)
    const apiMatch = src.match(/HudBusAPI\s*=\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(apiMatch, '找不到 HudBusAPI 定义');
    const setHotbarMatch = apiMatch[1].match(/setHotbar\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
    assert.ok(setHotbarMatch, '找不到 HudBusAPI.setHotbar');
    assert.match(setHotbarMatch[1], /writeHotbar\s*\(/,
      'HudBusAPI.setHotbar 未走 writeHotbar 写引擎');
  });
});

describe('m8.3b-time-hotbar-unify · behavior (engine:frame drives DOM)', () => {
  let captured, origDoc, origWin, origSetInterval;
  let makeRef;  // 闭包引用 — querySelector 委托

  beforeEach(() => {
    const store = {};

    const make = (sel) => {
      if (store[sel]) return store[sel];
      const el = {
        sel,
        style: {},
        textContent: '',
        _attrs: {},
        _classList: {},
        classList: null,
        setAttribute: (k, v) => { el._attrs[k] = String(v); },
        getAttribute: (k) => el._attrs[k] != null ? el._attrs[k] : null,
        querySelector: (s) => make(sel + ' > ' + s),
        querySelectorAll: () => [],
        appendChild: () => {},
        addEventListener: () => {},
        closest: (s) => null,
      };
      el.classList = {
        add: (cls) => { el._classList[cls] = true; },
        remove: (cls) => { el._classList[cls] = false; },
        contains: (cls) => !!el._classList[cls],
        toggle: (cls, force) => {
          if (force === true)  el._classList[cls] = true;
          if (force === false) el._classList[cls] = false;
        },
      };
      store[sel] = el;
      return el;
    };
    makeRef = make;

    captured = {
      timeDisplay:   make('.Anchor-TR .TimeDisplay'),
      seasonTag:     make('.Anchor-TR .SeasonTag'),
      hotbarSlots:   [
        make('.Anchor-BL .HotbarSlot:nth-child(1)'),
        make('.Anchor-BL .HotbarSlot:nth-child(2)'),
        make('.Anchor-BL .HotbarSlot:nth-child(3)'),
        make('.Anchor-BL .HotbarSlot:nth-child(4)'),
        make('.Anchor-BL .HotbarSlot:nth-child(5)'),
        make('.Anchor-BL .HotbarSlot:nth-child(6)'),
        make('.Anchor-BL .HotbarSlot:nth-child(7)'),
      ],
      uiLayer:       make('.UILayer'),
    };
    make('.Anchor-TL .PartySlot');
    make('.VitalBar-HP');
    make('.VitalBar-Hunger');
    make('.VitalBar-Sanity');

    origDoc = globalThis.document;
    origWin = globalThis.window;
    origSetInterval = globalThis.setInterval;

    globalThis.setInterval = (fn, ms) => {
      globalThis.__tickCb = fn;
      return 0;
    };

    globalThis.document = {
      readyState: 'complete',
      querySelector: (sel) => makeRef(sel),
      querySelectorAll: (sel) => {
        if (sel === '.Anchor-BL .HotbarSlot') return captured.hotbarSlots.slice();
        if (sel === '.Anchor-TL .PartySlot') return [];
        return [];
      },
      addEventListener: () => {},
      createTextNode: () => new EventTarget(),
    };

    globalThis.window = {
      __hudBus: null,
      __game: null,
      HudBusAPI: undefined,
    };
  });

  it('engine:frame with dayCycle → TimeDisplay shows describe() output', () => {
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const realBus = globalThis.window.HudBusAPI.bus;

    // fake dayCycle:8min day 循环里 t=240s(=04:00)
    const fakeDayCycle = {
      t: 240,
      isDay: () => true,
      describe: () => 'Day · 04:00',
    };
    realBus.emit('engine:frame', { now: 0, dt: 0.016, game: { dayCycle: fakeDayCycle } });
    // tick 把 dayCycle ref 写进本地缓存后渲染
    globalThis.__tickCb();
    assert.equal(captured.timeDisplay.textContent, 'Day · 04:00',
      'TimeDisplay 未反映 dayCycle.describe() 输出');
  });

  it('engine:frame with dayCycle (Night) → TimeDisplay shows Night tag', () => {
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const realBus = globalThis.window.HudBusAPI.bus;

    const fakeDayCycle = {
      t: 540,  // 9min 处 = 夜
      isDay: () => false,
      describe: () => 'Night · 09:00',
    };
    realBus.emit('engine:frame', { now: 0, dt: 0.016, game: { dayCycle: fakeDayCycle } });
    globalThis.__tickCb();
    assert.equal(captured.timeDisplay.textContent, 'Night · 09:00',
      'TimeDisplay 未反映 Night 标签');
  });

  it('engine:frame with inventory.selected → hotbar slot gets HotbarSlot-Active', () => {
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const realBus = globalThis.window.HudBusAPI.bus;

    const fakeGame = { inventory: { selected: 3, slots: [null, null, null, {}, null, null, null] } };
    realBus.emit('engine:frame', { now: 0, dt: 0.016, game: fakeGame });
    globalThis.__tickCb();

    // slot 3 (index 3, 第 4 个) 应该是 Active,其他是 Default
    assert.equal(captured.hotbarSlots[3]._classList['HotbarSlot-Active'], true,
      'inventory.selected=3 时,slot 3 未标记 HotbarSlot-Active');
    assert.equal(captured.hotbarSlots[0]._classList['HotbarSlot-Default'], true,
      'slot 0 应为 Default');
    assert.equal(captured.hotbarSlots[3]._classList['HotbarSlot-Default'], false,
      'Active slot 不应同时是 Default');
  });

  it('hotbar:select event → writeHotbar writes to window.__game.inventory.selected', () => {
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const realBus = globalThis.window.HudBusAPI.bus;

    // 模拟引擎已先于本脚本加载(typical 顺序是 assembly 之后才挂 hud.js)
    const fakeInventory = { selected: 0, slots: [null, null, null, null, null, null, null] };
    globalThis.window.__game = { inventory: fakeInventory };

    // 外部 emit 'hotbar:select' (例如 M2.11 任务系统)
    realBus.emit('hotbar:select', { index: 5, source: 'quest' });
    // writeHotbar 应该写到引擎 inventory
    assert.equal(fakeInventory.selected, 5,
      'hotbar:select 处理器未把 selected 写回 window.__game.inventory');
  });

  it('renderTime falls back to "Day · --:--" when engine not ready', () => {
    const src = readHud();
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    // 不 emit 'engine:frame' — 引擎未就绪
    globalThis.__tickCb();
    assert.equal(captured.timeDisplay.textContent, 'Day · --:--',
      '未就绪时占位文字不正确(应为 "Day · --:--")');
  });

  // 清理
  afterEach(() => {
    if (origDoc)   globalThis.document = origDoc;
    if (origWin)   globalThis.window   = origWin;
    if (origSetInterval) globalThis.setInterval = origSetInterval;
    delete globalThis.__tickCb;
  });
});
