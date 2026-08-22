/**
 * m8.0a-freeze-passthrough.mjs — v0.8.0a
 *
 * 装配层 pass-through 字段冻结 PoC 测试。
 *
 * 验收点(对照 v0.8.0a spec):
 *   1. 只读访问走 pass-through 正常(get 不抛错)
 *   2. 写访问(换引用)必须抛 TypeError(strict mode + Object.defineProperty
 *      writable=false,语义等同 Object.freeze 字段)
 *   3. before 状态(plain object)可被 mutate,after 状态(locked)抛错
 *   4. 装配层真实代码(assembleGame 完整流程)走 freeze 路径后,
 *      所有列出的 pass-through 字段都被锁;get / 实例方法仍可工作。
 *
 * 关键设计权衡(本测试应体现):
 *   - 锁的是 game 字段描述符,不是字段值(实例本身)。Object.freeze(实例)
 *     会让 inventory.add / eventMgr.update 等方法抛错(破坏合法 mutation);
 *     字段级 freeze 等效于 Object.freeze 在 strict mode 下对字段的作用 —
 *     `game.X = newX` 抛 TypeError,但实例内部方法继续工作。
 *
 * Run: `node tests/m8.0a-freeze-passthrough.mjs`
 */
'use strict';

import { freezePassThroughs } from '../src/util/freeze-passthrough.js';

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
// 1. 工具函数本身 — before / after 对比
// ═════════════════════════════════════════════════════════════
console.log('\n── freezePassThroughs 工具函数 ──');

it('returns list of fields that were locked (skip null/undefined)', () => {
  const game = {
    inventory: { slots: [] },
    eventMgr:  { pois: [] },
    buildingMgr: null,           // 跳过:null
    monsterMgr: undefined,       // 跳过:undefined
  };
  const locked = freezePassThroughs(game, [
    'inventory', 'eventMgr', 'buildingMgr', 'monsterMgr',
  ]);
  eq(locked.length, 2, 'should skip null/undefined');
  ok(locked.includes('inventory'));
  ok(locked.includes('eventMgr'));
  // 字段描述符被锁
  const invDesc = Object.getOwnPropertyDescriptor(game, 'inventory');
  ok(invDesc.writable === false,    'inventory field should be writable=false');
  ok(invDesc.configurable === false,'inventory field should be configurable=false');
  ok(invDesc.enumerable === true,   'inventory field should keep enumerable=true');
  // buildingMgr / monsterMgr 跳过,字段描述符保留(原本 game 字段默认 writable=true)
  const bmDesc = Object.getOwnPropertyDescriptor(game, 'buildingMgr');
  // buildingMgr = null 在 plain object literal 中默认 writable=true / configurable=true
  ok(bmDesc.writable === true || bmDesc.value === null,
     'buildingMgr should be untouched (skipped because null)');
});

it('throws TypeError on bad input', () => {
  throws(() => freezePassThroughs(null, []), TypeError);
  throws(() => freezePassThroughs({}, 'not-array'), TypeError);
});

// ═════════════════════════════════════════════════════════════
// 2. before / after 行为对比(核心 PoC)
// ═════════════════════════════════════════════════════════════
console.log('\n── before vs after mutation 行为 ──');

it('BEFORE: plain object pass-through allows reassignment (no lock)', () => {
  // 模拟 v0.8.0a 之前的 pass-through 状态:game 字段是普通对象属性
  const game = { inventory: { slots: [] } };
  const invDesc = Object.getOwnPropertyDescriptor(game, 'inventory');
  // 普通对象字面量:字段默认 writable=true / configurable=true
  ok(invDesc.writable === true, 'sanity: field is writable before lock');
  // 换引用不会抛错 — 这就是 v0.8.0a 要堵的泄漏口
  const oldRef = game.inventory;
  game.inventory = { slots: [{}] };
  ok(game.inventory !== oldRef, 'reassign went through silently');
});

it('AFTER: locked pass-through throws TypeError on reassignment', () => {
  // 模拟 v0.8.0a 之后的状态
  const game = { inventory: { slots: [] } };
  freezePassThroughs(game, ['inventory']);
  const invDesc = Object.getOwnPropertyDescriptor(game, 'inventory');
  ok(invDesc.writable === false, 'sanity: field is now writable=false');
  // 关键断言:换引用抛 TypeError(strict mode)
  const err = throws(() => { game.inventory = { slots: [{}] }; }, TypeError);
  ok(err.message.includes('Cannot modify') || err.message.includes('read only') ||
     err.message.includes('Cannot assign'),
     `TypeError should mention readonly/assign, got: ${err.message}`);
});

it('AFTER: delete also throws (configurable=false)', () => {
  const game = { inventory: { slots: [] } };
  freezePassThroughs(game, ['inventory']);
  throws(() => { delete game.inventory; }, TypeError);
});

it('AFTER: redefine also throws (configurable=false)', () => {
  const game = { inventory: { slots: [] } };
  freezePassThroughs(game, ['inventory']);
  throws(() => {
    Object.defineProperty(game, 'inventory', { value: { leak: true } });
  }, TypeError);
});

it('AFTER: get access still works (read-only is the goal, not write-block all)', () => {
  const inner = { count: 42, list: [1, 2, 3] };
  const game = { inventory: inner };
  freezePassThroughs(game, ['inventory']);
  // get 路径完全不受影响
  eq(game.inventory.count, 42);
  eq(game.inventory.list.length, 3);
  ok(game.inventory.list[0] === 1);
});

it('AFTER: instance methods still work (intentional — Service entrypoint kept alive)', () => {
  // 关键兼容点:实例本身没被 Object.freeze,own props 可写,实例方法
  // (inventory.add / eventMgr.update 等) 继续 mutate 内部 state。
  class MockInv {
    constructor() { this.count = 0; this.slots = []; }
    add(n) { this.count += n; this.slots.push(n); return this.count; }
  }
  const inv = new MockInv();
  const game = { inventory: inv };
  freezePassThroughs(game, ['inventory']);
  // 方法照常工作 — 这是 v0.8.0a 不冻实例的关键收益
  eq(game.inventory.add(5), 5);
  eq(game.inventory.count, 5);
  eq(game.inventory.slots.length, 1);
  eq(game.inventory.add(3), 8);
  eq(game.inventory.slots.length, 2);
});

it('AFTER: instance own-prop mutation is NOT caught (intentional design)', () => {
  // v0.8.0a 字段级 freeze 不替代 v0.7.0a Service 单入口的语义。
  // Service 内部 mutation (如 inventory.loadSnapshot 重新赋 this.slots)
  // 与 Manager.add / update 都需要在实例上 mutate own props —
  // 所以本任务只锁字段,不冻实例。Service 入口单一由 v0.7.0a 约定 + 后
  // 续 Service 拆分保证。
  const inner = { slots: [{ id: 'apple' }] };
  const game = { inventory: inner };
  freezePassThroughs(game, ['inventory']);
  // 实例 own props 可写(不冻实例)
  inner.slots.push({ id: 'log' });
  eq(inner.slots.length, 2);
  inner.newField = 'allowed';
  eq(inner.newField, 'allowed');
});

it('AFTER: non-locked fields stay mutable (runtime / closure state intact)', () => {
  // runtime 是闭包状态对象(runtime.mp / runtime.chatLog),runtime.js
  // 会合法 mutate 它 — 不放进 freeze 列表,保持可写。
  const game = {
    inventory: { slots: [] },
    runtime:   { mp: null, chatLog: [] },
  };
  freezePassThroughs(game, ['inventory']);
  // inventory 锁了
  throws(() => { game.inventory = { leaked: true }; }, TypeError);
  // runtime 没锁
  game.runtime.mp = { client: 'real' };
  ok(game.runtime.mp.client === 'real');
  game.runtime.chatLog.push({ at: 0, text: 'hi' });
  eq(game.runtime.chatLog.length, 1);
});

// ═════════════════════════════════════════════════════════════
// 3. 真实装配层(assembleGame 完整流程)走 freeze 路径
// ═════════════════════════════════════════════════════════════
console.log('\n── 真实装配层集成 sanity ──');

// 装配层依赖 canvas / DOM / localStorage — Node 测不到 bootGame 全程。
// 我们用 jsdom-less 的方式只验证:
//   (a) assembly.js 顶部确实 import 了 freezePassThroughs
//   (b) assembly.js 在 game 对象构造之后确实调用了 freezePassThroughs
//   (c) freeze 列表覆盖了所有 v0.6.0b / v0.7.0a 设计的 pass-through 字段
//   (d) 'use strict' 在 imports 之前(冻结抛错的前置条件)
//
// 这比硬起一遍装配更稳,也不会因 jsdom / canvas 缺失导致 false negative。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assemblySrc = readFileSync(join(here, '../src/assembly.js'), 'utf8');

it('assembly.js imports freezePassThroughs', () => {
  ok(/from\s+['"]\.\/util\/freeze-passthrough\.js['"]/.test(assemblySrc),
     'should import freezePassThroughs from util/freeze-passthrough.js');
});

it('assembly.js calls freezePassThroughs in assembleGame', () => {
  ok(/freezePassThroughs\s*\(/.test(assemblySrc),
     'should call freezePassThroughs somewhere in assembly.js');
  // 调用必须在 game 对象构造之后、return game 之前
  const gameBlockIdx = assemblySrc.indexOf('const game = {');
  const returnIdx    = assemblySrc.indexOf('return game;');
  const freezeIdx    = assemblySrc.indexOf('freezePassThroughs(');
  ok(gameBlockIdx > 0, 'game block exists');
  ok(returnIdx > gameBlockIdx, 'return game; comes after game block');
  ok(freezeIdx > gameBlockIdx && freezeIdx < returnIdx,
     'freezePassThroughs call must be between game block and return game;');
});

it('assembly.js freeze list covers all v0.6.0b / v0.7.0a pass-through fields', () => {
  // 这些是装配层暴露的引用下游 Manager / Service / UI 实例的字段,
  // 不冻任何一条都意味着仍有泄漏口。
  const required = [
    'inventory',     // v0.6.0b InventoryService
    'eventMgr',      // v0.7.0a EventService
    'buildingMgr',   // v0.7.0a BuildingService
    'monsterMgr',    // v0.7.0a MonsterService
    'gather',
    'buildingMenu',
    'hud',
    'input',
    'camera',
    'player',
    'bossMgr',
    'bossBar',
    'eventBanner',
    'dayCycle',
    'npcMgr',
    'tradeState',
    'tradeUI',
    'followerMgr',
    'vitalsState',
    'world',
    'decor',
    'village',
    'transitions',
    'resources',
  ];
  // 抽取 freezePassThroughs( ... ) 调用的参数字符串
  const m = assemblySrc.match(/freezePassThroughs\s*\(\s*game\s*,\s*\[([\s\S]*?)\]\s*\)/);
  ok(m, 'should find a freezePassThroughs(game, [...]) call');
  const list = m[1];
  const missing = required.filter(name => !new RegExp(`['"]${name}['"]`).test(list));
  eq(missing.length, 0, `missing fields: ${missing.join(', ')}`);
});

it('assembly.js does NOT freeze `runtime` (intentional: closure state is mutable)', () => {
  // runtime 是闭包状态对象(runtime.mp / runtime.chatLog / runtime.pendingBuilding),
  // runtime.js 会合法 mutate 它,所以不放进 freeze 列表。
  const m = assemblySrc.match(/freezePassThroughs\s*\(\s*game\s*,\s*\[([\s\S]*?)\]\s*\)/);
  const list = m[1];
  ok(!/['"]runtime['"]/.test(list),
     'runtime should NOT be in freeze list (closure state, mutated by runtime.js)');
});

it('assembly.js has \'use strict\' before any import (required for freeze to throw)', () => {
  // 'use strict' 是 freeze 抛错的必要条件:sloppy mode 下,赋值静默失败。
  // 装配层已开启 strict(顶部 'use strict';),严格模式是 v0.8.0a 的前提。
  ok(/^'use strict';/m.test(assemblySrc),
     'should have "use strict" directive somewhere in file');
  const strictIdx = assemblySrc.search(/^'use strict';/m);
  const firstImport = assemblySrc.search(/^import\s/m);
  ok(strictIdx >= 0, '"use strict" exists');
  ok(firstImport > strictIdx,
     '"use strict" must precede the first import statement (top-of-file directive)');
});

it('util/freeze-passthrough.js is itself in strict mode', () => {
  // 工具模块自身也要 strict mode,这样调用方的 'use strict' 才能一致
  const utilSrc = readFileSync(join(here, '../src/util/freeze-passthrough.js'), 'utf8');
  ok(/^'use strict';/m.test(utilSrc),
     'freeze-passthrough.js should have "use strict" at top');
});

// ═════════════════════════════════════════════════════════════
// 4. runtime.js 仍能正常工作(没有 game.X = ... 形式 reassign)
// ═════════════════════════════════════════════════════════════
console.log('\n── runtime.js 兼容性 sanity ──');

it('runtime.js does not reassign any locked field on game (regression guard)', () => {
  // v0.8.0a 锁装配层字段后,runtime.js 任何 `game.X = Y` 形式都会
  // 抛错。已知 runtime 全部走 method call,只对 game.runtime.* mutate,
  // 而 game.runtime 不在 freeze 列表。留 sanity test 防回归。
  const runtimeSrc = readFileSync(join(here, '../src/runtime.js'), 'utf8');
  // 找 game.<ident> = ... (不是 == / ===) 形式
  const re = /game\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=[^=]/g;
  const offenders = [];
  let m;
  while ((m = re.exec(runtimeSrc)) !== null) {
    offenders.push(m[1]);
  }
  // game.runtime.pendingBuilding = ... / game.runtime.mp = ... 是合法的
  // (runtime 不在 freeze 列表),其他字段名都该为空
  const illegal = offenders.filter(n => n !== 'runtime');
  eq(illegal.length, 0, `runtime.js should not reassign locked fields, found: ${illegal.join(', ')}`);
});

// ═════════════════════════════════════════════════════════════
console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error(log.filter(l => l.startsWith('  ✗')).join('\n'));
  process.exit(1);
}
