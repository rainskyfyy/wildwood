/**
 * m0-integration.mjs — v0.8.18-P0 装配层集成测试基线
 *
 * 目的:驱动【真实】装配路径 assembleGame(canvas, {mode:'offline'}) → bootGame,
 * 再触发一次采集,验证 v0.6.0b 起期望的 invSvc 接线在 assembly.js 中确实落地
 * (P0-1:此前装配漏实例化 InventoryService,把裸 inventory 当 invSvc 传给 Gather,
 *  resource-entity.harvest 拿到 undefined 即 TypeError 崩溃)。
 *
 * 与既有 gather smoke 的区别:那些测试用 fixture 直接传正确 `invSvc` key,
 * 完全绕开 assembly.js 的装配,因此 P0-1 被测试盲区掩盖。本测试走真实装配,
 * 装配错即抛。
 *
 * 运行:node tests/m0-integration.mjs  (Node 22+,需全局 WebSocket —— 本测试不联机)
 */
'use strict';

import { bootGame } from '../src/main.js';
import { InventoryService } from '../src/services/InventoryService.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ' :: ' + detail : ''}`); console.log(`  ✗ ${label}${detail ? ' :: ' + detail : ''}`); }
}

// ────────────────────────────────────────────────────────────
// 最小 DOM / 浏览器全局 mock —— 仅满足 assembleGame 装配所需,
// 不启动帧循环(requestAnimationFrame no-op)、不联机、不渲染。
// ────────────────────────────────────────────────────────────
function makeEl() {
  const el = {
    _children: [], style: {}, value: '', textContent: '', innerHTML: '',
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { return c; },
    addEventListener() {}, removeEventListener() {},
    focus() {}, click() {}, setAttribute() {}, removeAttribute() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 }; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    insertAdjacentElement() {}, insertBefore(c) { return c; },
    replaceChildren() {}, append() {}, remove() {},
  };
  return el;
}
const ctxMock = new Proxy({}, {
  get(t, p) {
    if (p === 'imageSmoothingEnabled' || p === 'canvas') return t[p];
    if (typeof p === 'string') return () => {};   // 任何 ctx 方法 no-op
    return 0;
  },
  set(t, p, v) { t[p] = v; return true; },
});
globalThis.document = {
  getElementById: () => makeEl(),
  createElement: (t) => {
    const e = makeEl();
    if (t === 'canvas') { e.width = 800; e.height = 600; e.getContext = () => ctxMock; }
    return e;
  },
  body: makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector() { return makeEl(); }, querySelectorAll() { return []; },
};
globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
let perfNow = 1000;
globalThis.performance = { now: () => (perfNow += 16) };
globalThis.requestAnimationFrame = () => 1;   // 不启动帧循环
globalThis.cancelAnimationFrame = () => {};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.Image = function () {};
const canvas = {
  width: 800, height: 600, style: {},
  addEventListener() {}, removeEventListener() {},
  getContext: () => ctxMock,
};

console.log('\n── m0-integration: 真实装配路径 → 采集 → invSvc.addItem ──');

// ── 1. 真实装配 ──
let game;
try {
  ({ game } = bootGame(canvas, { mode: 'offline' }));
  ok(true, 'assembleGame + startRuntime 装配完成(无构造期异常)');
} catch (e) {
  ok(false, 'assembleGame + startRuntime 装配完成(无构造期异常)', e.stack || String(e));
  console.log(`\nm0-integration: ${pass} pass, ${fail} fail`);
  process.exit(1);
}

// ── 2. P0-1 接线:game.gather.invSvc 必须是真实 InventoryService 实例(非 undefined) ──
const gather = game.gather;
ok(!!gather, 'game.gather 存在');
const invSvc = gather && gather.invSvc;
ok(invSvc instanceof InventoryService, 'game.gather.invSvc 是 InventoryService 实例(P0-1 接线)', invSvc ? invSvc.constructor.name : 'undefined');
ok(typeof (invSvc && invSvc.addItem) === 'function', 'invSvc.addItem 是 function');

// ── 3. 真实采集路径:click + update → entity.harvest(invSvc, now) ──
// spy InventoryService.prototype.addItem(原型未冻结,实例可能冻结;改原型最安全)。
const proto = invSvc ? Object.getPrototypeOf(invSvc) : null;
const origAddItem = proto && proto.addItem;
let addItemCalls = 0;
if (origAddItem) {
  proto.addItem = function (itemId, count) {
    addItemCalls++;
    return origAddItem.call(this, itemId, count);
  };
}

let harvestThrow = null;
let triggeredHarvest = false;
const ents = (gather && Array.isArray(gather.entities)) ? gather.entities.slice() : [];
ok(ents.length > 0, `gather.entities 非空(${ents.length} 个可采实体)`);

// 迭代实体:把"玩家"移到实体位置 → click → update 过 harvestTime,
// 直到至少一次 addItem 被调用(证明服务路径真的在授予战利品)。
// rng 是 seeded mulberry32,354 个实体中必然有首个 harvest 命中 drop。
const CAP = Math.min(ents.length, 30);
for (let i = 0; i < CAP && addItemCalls === 0; i++) {
  const e = ents[i];
  if (!e || e.depleted) continue;
  try {
    gather.click(e.x, e.y);
    // gather.update(player, dt, now):player 传到实体正上方,距离 0 <= range。
    gather.update({ x: e.x, y: e.y }, (e.harvestTime || 0.5) + 0.1, performance.now());
    triggeredHarvest = true;
  } catch (err) {
    harvestThrow = err;
    break;
  }
}

// 还原原型
if (origAddItem) proto.addItem = origAddItem;

ok(harvestThrow === null, '采集路径无 TypeError / 无异常抛出', harvestThrow ? `${harvestThrow.constructor.name}: ${harvestThrow.message}` : '');
ok(triggeredHarvest, '至少驱动了一次完整 click→update 采集周期');
ok(addItemCalls > 0, `invSvc.addItem 在真实采集路径被调用(${addItemCalls} 次)`,
   addItemCalls === 0 ? '前 ' + CAP + ' 个实体首采均未掉落(应不可能)' : '');

console.log(`\nm0-integration: ${pass} pass, ${fail} fail`);
if (fail > 0) { console.log('FAILURES:\n' + failures.map(f => '  - ' + f).join('\n')); }

// 装配可能注册 setInterval/timeout(DayCycle / AmbientController 等),
// 显式退出,避免事件循环挂住测试 runner。
process.exit(fail > 0 ? 1 : 0);
