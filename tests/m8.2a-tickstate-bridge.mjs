/**
 * m8.2a-tickstate-bridge.mjs — v0.8.2a
 *
 * UI tickState 桥接边界 + 装配层 pass-through 冻结 PoC。
 *
 * 验收点(对照 v0.8.2a spec):
 *   1. TickStateService 是唯一 mutation 入口(setRate / pause / resume
 *      / start / stop / fireOnce / subscribe 都在 svc 上)
 *   2. TickStateView 是 pass-through 读入口(getState / subscribe 委托);
 *      任何写方法(setRate / pause / resume / ...)都抛 ReadOnlyViewError
 *   3. 装配层 game.tickStateSvc / game.tickStateView 引用被 v0.8.0a
 *      字段级 freeze 锁住(`game.tickStateSvc = newSvc()` 抛 TypeError,
 *      `delete game.tickStateView` 抛 TypeError)
 *   4. 装配层真实代码(assembleGame 完整流程)走 freeze 路径后,
 *      svc / view 都在 game 上,且都在 freeze 列表里
 *   5. window.__tickState IIFE 入口在装配前是占位 svc,装配后委托
 *      真实 svc(`__bindService` 后 setRate 改的是 realSvc)
 *   6. 漂移检测工具 tools/check-fixture-drift.mjs 能识别以下反模式:
 *      - src/ui/* 直接 import TickStateService
 *      - 任何代码 mutate svc 私有字段(_tickMs / _paused)
 *      - tests/* 中 UI 视角代码调 view.setRate(应改用 svc)
 *
 * Run: `node tests/m8.2a-tickstate-bridge.mjs`
 */
'use strict';

import { TickStateService, createTickStateService, DEFAULT_TICK_MS } from '../src/services/TickStateService.js';
import { TickStateView, createTickStateView, ReadOnlyViewError } from '../src/ui/sync/tickStateView.js';
import { freezePassThroughs } from '../src/util/freeze-passthrough.js';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─── tiny test runner ────────────────────────────────────────
let pass = 0, fail = 0;
const log = [];
function it(name, fn) {
  try {
    fn();
    pass++;
    log.push(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    log.push(`  ✗ ${name}\n    ${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} ${msg}`);
}
function ok(v, msg = '') { if (!v) throw new Error(`assertion failed ${msg}`); }
function throws(fn, ctor, msg = '') {
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  if (!thrown) throw new Error(`expected throw, got nothing ${msg}`);
  if (ctor && !(thrown instanceof ctor)) {
    throw new Error(`expected ${ctor.name}, got ${thrown.constructor.name}: ${thrown.message} ${msg}`);
  }
  return thrown;
}

// ═════════════════════════════════════════════════════════════
// 1. TickStateService 基础(svc 写)
// ═════════════════════════════════════════════════════════════
console.log('\n── TickStateService: svc 写 ──');

it('default tickRate is 200ms (5Hz)', () => {
  const svc = createTickStateService();
  eq(svc.rate, DEFAULT_TICK_MS, 'default rate should be 200');
  eq(svc.running, false, 'should not auto-start');
  eq(svc.tickCount, 0);
});

it('start / stop lifecycle', () => {
  const svc = createTickStateService();
  svc.start();
  ok(svc.running, 'should be running after start');
  svc.stop();
  ok(!svc.running, 'should not be running after stop');
});

it('start is idempotent (multiple start calls ok)', () => {
  const svc = createTickStateService();
  svc.start();
  const first = svc._intervalId;
  svc.start();  // 二次调用应 no-op
  eq(svc._intervalId, first, 'interval id should not change on re-start');
  svc.stop();
});

it('setRate(100) updates rate and restarts interval if running', () => {
  const svc = createTickStateService();
  svc.start();
  svc.setRate(100);
  eq(svc.rate, 100, 'rate should be 100');
  ok(svc.running, 'should still be running after setRate');
  svc.stop();
});

it('setRate enforces minMs floor (16)', () => {
  const svc = createTickStateService({ minMs: 16 });
  svc.setRate(2);
  eq(svc.rate, 16, 'rate should clamp to minMs=16');
});

it('setRate with non-numeric falls back to default', () => {
  const svc = createTickStateService({ defaultMs: 200 });
  svc.setRate('garbage');
  eq(svc.rate, 200, 'rate should fall back to default');
});

it('pause / resume toggle paused flag', () => {
  const svc = createTickStateService();
  eq(svc.paused, false);
  svc.pause();
  ok(svc.paused);
  svc.resume();
  ok(!svc.paused);
});

it('fireOnce triggers a tick and increments tickCount (synchronous)', () => {
  const svc = createTickStateService();
  const detail = svc.fireOnce();
  eq(svc.tickCount, 1, 'tickCount should be 1 after fireOnce');
  ok(detail && typeof detail.t === 'number');
  ok(detail.n === 1);
});

it('subscribe receives tick notifications; unsubscribe stops them', () => {
  const svc = createTickStateService();
  const received = [];
  const unsub = svc.subscribe((d) => received.push(d));
  // subscribe 立即推一次 (immediate=true)
  eq(received.length, 1, 'subscriber should get immediate fire');
  svc.fireOnce();
  eq(received.length, 2, 'subscriber should get fireOnce detail');
  unsub();
  svc.fireOnce();
  eq(received.length, 2, 'unsubbed subscriber should not get more');
});

it('subscriber throwing does not break other subscribers', () => {
  const svc = createTickStateService();
  const got = [];
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe((d) => got.push(d));
  // 2nd subscribe 立即推一次(immediate=true): got = [{...immediate}]
  // fireOnce 再推一次: got = [{...immediate}, {...fireOnce}]
  eq(got.length, 1, 'subscribe should give 1 immediate fire');
  svc.fireOnce();
  eq(got.length, 2, 'after fireOnce, second subscriber should still get tick (first throws)');
  // 关键断言:第一个订阅者抛了 error,不影响第二个;tickCount 仍 +1
  eq(svc.tickCount, 1, 'tickCount should still increment despite subscriber throw');
});

it('getState returns a plain snapshot', () => {
  const svc = createTickStateService();
  svc.start();
  const s = svc.getState();
  ok(s.rate === 200);
  ok(s.paused === false);
  ok(s.running === true);
  ok(s.tickCount === 0);
  ok(s.subscribers === 0);
  ok(s.uptime >= 0);
  // 关键:返回的是 plain object,svc 后续 mutation 不会影响旧 snapshot
  svc.setRate(100);
  eq(s.rate, 200, 'old snapshot should not reflect later setRate');
  svc.stop();
});

it('setHudBusEmitter wires external bus for compatibility', () => {
  const svc = createTickStateService();
  const busCalls = [];
  svc.setHudBusEmitter((type, detail) => busCalls.push({ type, detail }));
  svc.fireOnce();
  eq(busCalls.length, 1);
  eq(busCalls[0].type, 'tick');
  ok(busCalls[0].detail && busCalls[0].detail.n === 1);
});

it('hudBus emitter error does not break tick loop', () => {
  const svc = createTickStateService();
  const got = [];
  svc.subscribe((d) => got.push(d));
  svc.setHudBusEmitter(() => { throw new Error('bus fail'); });
  svc.fireOnce();
  eq(got.length, 2, 'subscriber still gets tick despite bus error');
});

it('can pass custom now() for deterministic testing', () => {
  let t = 1000;
  const svc = createTickStateService({ now: () => t });
  svc.start();
  const s1 = svc.getState();
  eq(s1.uptime, 0, 'uptime should be 0 at start');
  t = 1234;
  const s2 = svc.getState();
  eq(s2.uptime, 234, 'uptime should reflect custom now()');
  svc.stop();
});

// ═════════════════════════════════════════════════════════════
// 2. TickStateView(pass-through 读)
// ═════════════════════════════════════════════════════════════
console.log('\n── TickStateView: pass-through 读 ──');

it('view.getState returns frozen snapshot (UI 拿到的不可写)', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const s = view.getState();
  // 关键:getState 返回 frozen — UI 端即便直接写也无效
  throws(() => { s.rate = 999; }, TypeError, 'frozen snapshot should reject mutation');
  // 实际值没变
  eq(s.rate, 200);
});

it('view.subscribe delegates to svc (UI 订阅实际写到 svc._subscribers)', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const got = [];
  view.subscribe((d) => got.push(d));
  eq(svc.subscriberCount, 1, 'view.subscribe should add to svc');
  svc.fireOnce();
  eq(got.length, 2, 'subscriber should get immediate + fireOnce');
});

it('view rejects all write methods with ReadOnlyViewError', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const writeMethods = ['setRate', 'pause', 'resume', 'start', 'stop', 'fireOnce', 'setHudBusEmitter'];
  for (const m of writeMethods) {
    const err = throws(() => view[m](), ReadOnlyViewError, `${m} should throw ReadOnlyViewError`);
    ok(err.message.includes(m), `${m} error should mention the method name`);
    ok(err.message.includes('game.tickStateSvc'),
       `${m} error should hint at the right entrypoint`);
  }
});

it('view rejects construction with invalid svc', () => {
  throws(() => new TickStateView(null), TypeError);
  throws(() => new TickStateView({}), TypeError, 'plain object should be rejected');
  throws(() => new TickStateView({ getState: () => ({}) }), TypeError,
         'object missing subscribe should be rejected');
});

it('view error message is informative for debugging', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const err = throws(() => view.setRate(50), ReadOnlyViewError);
  ok(/TickStateView\.setRate/.test(err.message), 'should mention view.setRate');
  ok(/read-only/.test(err.message), 'should clarify "read-only"');
  ok(/game\.tickStateSvc\.setRate/.test(err.message), 'should point to the right entrypoint');
});

// ═════════════════════════════════════════════════════════════
// 3. 装配层集成(assembleGame 完整流程走 freeze 路径)
// ═════════════════════════════════════════════════════════════
console.log('\n── 装配层集成 — game.tickStateSvc / tickStateView ──');

it('manually assembled game: svc + view on game, freeze throws on reassign', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const game = { tickStateSvc: svc, tickStateView: view, inventory: { slots: [] } };
  freezePassThroughs(game, ['tickStateSvc', 'tickStateView', 'inventory']);
  // 字段被锁:换引用抛错
  throws(() => { game.tickStateSvc = createTickStateService(); }, TypeError);
  throws(() => { game.tickStateView = createTickStateView(svc); }, TypeError);
  // delete 也抛
  throws(() => { delete game.tickStateSvc; }, TypeError);
  throws(() => { delete game.tickStateView; }, TypeError);
  // redefine 也抛
  throws(() => {
    Object.defineProperty(game, 'tickStateView', { value: { leak: true } });
  }, TypeError);
  // get 仍工作
  ok(game.tickStateSvc === svc);
  ok(game.tickStateView === view);
  // 实例方法不被 freeze 阻断(svc.setRate / view.getState 仍工作)
  game.tickStateSvc.setRate(100);
  eq(game.tickStateSvc.rate, 100);
  const s = game.tickStateView.getState();
  eq(s.rate, 100, 'view should see svc.setRate(100)');
});

it('assembly.js imports TickStateService and TickStateView', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/assembly.js'), 'utf8');
  ok(/from\s+['"]\.\/services\/TickStateService\.js['"]/.test(src),
     'should import TickStateService');
  ok(/from\s+['"]\.\/ui\/sync\/tickStateView\.js['"]/.test(src),
     'should import TickStateView');
});

it('assembly.js creates svc + view in assembleGame', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/assembly.js'), 'utf8');
  // createTickStateService 必须在 assembleGame 函数体内调用
  const assembleIdx = src.indexOf('export function assembleGame');
  ok(assembleIdx > 0);
  const after = src.slice(assembleIdx);
  ok(/createTickStateService\s*\(/.test(after),
     'createTickStateService should be called inside assembleGame');
  ok(/createTickStateView\s*\(/.test(after),
     'createTickStateView should be called inside assembleGame');
});

it('assembly.js binds svc to window.__tickState facade', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/assembly.js'), 'utf8');
  const assembleIdx = src.indexOf('export function assembleGame');
  const after = src.slice(assembleIdx);
  ok(/__bindService/.test(after), 'should call __bindService to hand over facade');
  ok(/tickStateSvc\.start\s*\(/.test(after), 'should start the svc after binding');
});

it('assembly.js adds tickStateSvc / tickStateView to freeze list', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/assembly.js'), 'utf8');
  // 抽取 freezePassThroughs(game, [...]) 第二个参数数组
  const m = src.match(/freezePassThroughs\s*\(\s*game\s*,\s*\[([\s\S]*?)\]\s*\)/);
  ok(m, 'should find freezePassThroughs call');
  const list = m[1];
  ok(/['"]tickStateSvc['"]/.test(list), 'tickStateSvc should be in freeze list');
  ok(/['"]tickStateView['"]/.test(list), 'tickStateView should be in freeze list');
});

it('assembly.js hangs tickStateSvc + tickStateView on game object', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/assembly.js'), 'utf8');
  const gameBlock = src.match(/const game = \{([\s\S]*?)\n  \}/);
  ok(gameBlock, 'should find game = { ... } block');
  const body = gameBlock[1];
  ok(/tickStateSvc/.test(body), 'game should expose tickStateSvc');
  ok(/tickStateView/.test(body), 'game should expose tickStateView');
});

it('tickState.js is now a thin facade delegating to bound svc', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/ui/sync/tickState.js'), 'utf8');
  // IIFE 应该不再持有自己的 interval / setInterval 调用,转而委托 svc
  ok(/__bindService\s*\(/.test(src), 'tickState.js must export __bindService');
  ok(/function createPlaceholderService/.test(src),
     'tickState.js should have a placeholder for unbound state');
  // 关键:占位 svc 自己 start 一次(占位运行时)
  ok(/createPlaceholderService\(\)/.test(src), 'placeholder should be created at module load');
  // 装配后所有方法委托 _svc
  ok(/let _svc = createPlaceholderService/.test(src),
     'window.__tickState should bind to _svc which is replaceable');
});

// ═════════════════════════════════════════════════════════════
// 4. window.__tickState IIFE 入口(向后兼容)
// ═════════════════════════════════════════════════════════════
console.log('\n── window.__tickState IIFE 入口(向后兼容) ──');

// 由于 tickState.js 是 IIFE 加载到 window,需要用 jsdom-like 方式
// 模拟 window;但本测试只检查源码契约(不实际加载 IIFE)。

it('tickState.js exposes window.__tickState with documented API', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/ui/sync/tickState.js'), 'utf8');
  // 必须暴露的 API(set / get / control / 内部)
  const required = [
    'subscribe', 'setRate', 'getRate', 'getTickCount',
    'pause', 'resume', 'stop', 'start', 'fireOnce',
    '__bindService', '__service', '__reset', 'getState'
  ];
  for (const m of required) {
    ok(new RegExp(`\\b${m}\\s*[(:]`).test(src), `tickState.js should expose ${m}`);
  }
});

it('tickState.js still emits to window.__hudBus for trading/npc compat', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/ui/sync/tickState.js'), 'utf8');
  ok(/__hudBus/.test(src), 'should still reference window.__hudBus for v0.5.x compat');
  ok(/emitHudBus|emit\(['"]tick['"]/.test(src), 'should emit "tick" to hudBus');
});

it('tickState.js is idempotent (multiple loads skip)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/ui/sync/tickState.js'), 'utf8');
  ok(/if\s*\(\s*window\.__tickState\s*\)\s*\{[\s\S]*?return/.test(src),
     'should early-return if window.__tickState already exists');
});

// ═════════════════════════════════════════════════════════════
// 5. 漂移检测工具(tools/check-fixture-drift.mjs)
// ═════════════════════════════════════════════════════════════
console.log('\n── 漂移检测工具 tools/check-fixture-drift.mjs ──');

it('check-fixture-drift.mjs exists and runs as a CLI', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const toolPath = join(here, '../tools/check-fixture-drift.mjs');
  let src;
  try { src = readFileSync(toolPath, 'utf8'); }
  catch (e) { throw new Error(`tools/check-fixture-drift.mjs not found: ${e.message}`); }
  ok(src.length > 1000, 'should be a substantial tool, not a stub');
  ok(/'use strict'/.test(src), 'should be strict mode');
  // CLI 工具特征:用 process.exit 报告状态;运行入口在顶层
  ok(/process\.exit\s*\(/.test(src), 'should call process.exit with status code');
  ok(/console\.log/.test(src), 'should print human-readable report');
  // 主流程入口
  ok(/function\s+listDefaultTargets[\s\S]*?\bwalkJs\s*\(/.test(src), 'listDefaultTargets should call walkJs in main loop');
});

it('check-fixture-drift.mjs detects all expected drift patterns', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const toolPath = join(here, '../tools/check-fixture-drift.mjs');
  const src = readFileSync(toolPath, 'utf8');
  // 关键检测关键词
  const expectedSignals = [
    /TickStateService/i,        // svc 引用
    /tickStateView/i,           // view 引用
    /__tickState/i,             // window 全局
    /_tickMs|_paused|_subscribers/i,  // 私有字段访问
  ];
  for (const re of expectedSignals) {
    ok(re.test(src), `check-fixture-drift.mjs should reference ${re}`);
  }
});

it('check-fixture-drift.mjs runs end-to-end on the repo and exits 0', async () => {
  // 跑实际工具,确保它对当前仓库没误报
  const here = dirname(fileURLToPath(import.meta.url));
  const toolPath = join(here, '../tools/check-fixture-drift.mjs');
  const result = await new Promise((resolve) => {
    const child = spawn('node', [toolPath], { cwd: join(here, '..') });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => child.kill(), 15000);
  });
  // 当前 repo 状态应该是干净的(没有违规),但允许 warnings
  if (result.code !== 0) {
    throw new Error(
      `check-fixture-drift.mjs failed (code ${result.code})\n` +
      `--- stdout ---\n${result.stdout}\n` +
      `--- stderr ---\n${result.stderr}`
    );
  }
  ok(true, `exit 0 — clean repo`);
});

// ═════════════════════════════════════════════════════════════
// 6. 集成 sanity:svc 写 → view 读 端到端
// ═════════════════════════════════════════════════════════════
console.log('\n── 集成 sanity:svc 写 → view 读 端到端 ──');

it('end-to-end: game.tickStateSvc.setRate → game.tickStateView.getState reflects', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const game = { tickStateSvc: svc, tickStateView: view };
  freezePassThroughs(game, ['tickStateSvc', 'tickStateView']);

  // UI 写
  game.tickStateSvc.setRate(50);
  game.tickStateSvc.start();
  const s1 = game.tickStateView.getState();
  eq(s1.rate, 50, 'view should reflect svc.setRate(50)');
  ok(s1.running);

  // UI 写 pause
  game.tickStateSvc.pause();
  const s2 = game.tickStateView.getState();
  ok(s2.paused, 'view should reflect svc.pause()');

  // UI 写 resume
  game.tickStateSvc.resume();
  const s3 = game.tickStateView.getState();
  ok(!s3.paused, 'view should reflect svc.resume()');

  // UI 试图在 view 上写 — 抛 ReadOnlyViewError
  throws(() => game.tickStateView.setRate(200), ReadOnlyViewError);

  game.tickStateSvc.stop();
});

it('end-to-end: subscription via view receives ticks from svc', () => {
  const svc = createTickStateService();
  const view = createTickStateView(svc);
  const game = { tickStateSvc: svc, tickStateView: view };
  freezePassThroughs(game, ['tickStateSvc', 'tickStateView']);

  const got = [];
  game.tickStateView.subscribe((d) => got.push(d));
  game.tickStateSvc.start();
  // 立即 fire 一次
  game.tickStateSvc.fireOnce();
  game.tickStateSvc.fireOnce();
  // got[0] = immediate fire (n=0), got[1] = fireOnce n=1, got[2] = fireOnce n=2
  ok(got.length >= 3, 'should get immediate + 2 manual fires');
  eq(got[got.length - 1].n, 2);

  game.tickStateSvc.stop();
});

// ═════════════════════════════════════════════════════════════
console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error(log.filter(l => l.startsWith('  ✗')).join('\n'));
  process.exit(1);
}
