/**
 * M5.3 Processing Smoke — 晒肉架 + 发酵桶
 *
 * 测试:
 *   1. 晒肉架: meat → jerky, 30s 计时
 *   2. 发酵桶: berries/wheat/honey/pumpkin → 4 种酒
 *   3. 状态机 (EMPTY/PROCESSING/READY)
 *   4. tick 推进
 *   5. 拒绝错食材
 *   6. 取出后状态重置
 *   7. progress 0..1
 *   8. 序列化往返
 *   9. ProcessingManager 注册/取消注册/tickAll
 *  10. freshness 3x (meat → jerky)
 */
'use strict';

import { strict as assert } from 'node:assert';
import { ProcessingStation, ProcessingManager, PROC_STATE, STATION_PROCESS_TIME } from '../src/processing/processing.js';
import { Inventory } from '../src/resources/inventory.js';
import { processingPanelOnClick } from '../src/processing/processing-renderer.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

console.log('=== M5.3 Processing Smoke ===\n');

// ── 1. Freshness 3x for jerky ──────────────────────────────
test('freshMultiplier is 3x for meat → jerky', () => {
  assert.equal(ProcessingStation.freshMultiplier('meat', 'jerky'), 3.0);
  assert.equal(ProcessingStation.freshMultiplier('wheat', 'wheat_beer'), 1.0);
});

// ── 2. STATION_PROCESS_TIME defaults ───────────────────────
test('STATION_PROCESS_TIME has correct defaults', () => {
  assert.equal(STATION_PROCESS_TIME.drying_rack, 30);
  assert.equal(STATION_PROCESS_TIME.fermenting_barrel, 60);
});

// ── 3. Drying rack: meat → jerky ───────────────────────────
test('drying rack: meat → jerky', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  assert.equal(s.state, PROC_STATE.EMPTY);
  const r = s.put('meat');
  assert.equal(r.ok, true);
  assert.equal(s.state, PROC_STATE.PROCESSING);
  assert.equal(s.inputItemId, 'meat');
  assert.equal(s.outputRecipe.id, 'jerky');
  assert.equal(s.durationSec, 30);
});

// ── 4. Drying rack: 30s tick to READY ──────────────────────
test('drying rack ticks to READY after 30s', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  s.put('meat');
  const start = s.startedAt;
  // Simulate 31 seconds passing
  const r1 = s.tick(start + 31 * 1000);
  assert.equal(r1, 'completed');
  assert.equal(s.state, PROC_STATE.READY);
});

// ── 5. Fermenting barrel: berries → berry_wine ─────────────
test('fermenting barrel: berries → berry_wine', () => {
  const s = new ProcessingStation({ station: 'fermenting_barrel' });
  const r = s.put('berries');
  assert.equal(r.ok, true);
  assert.equal(s.outputRecipe.id, 'berry_wine');
  assert.equal(s.durationSec, 60);
});

// ── 6. All 5 processing inputs work ────────────────────────
test('all 5 processing inputs map to recipes', () => {
  const inputs = [
    ['drying_rack',       'meat',     'jerky'],
    ['fermenting_barrel', 'berries',  'berry_wine'],
    ['fermenting_barrel', 'wheat',    'wheat_beer'],
    ['fermenting_barrel', 'honey',    'honey_mead'],
    ['fermenting_barrel', 'pumpkin',  'pumpkin_spice']
  ];
  for (const [station, input, expectedOut] of inputs) {
    const s = new ProcessingStation({ station });
    const r = s.put(input);
    assert.equal(r.ok, true, `failed for ${input}`);
    assert.equal(r.recipe.output.itemId, expectedOut);
  }
});

// ── 7. Reject invalid inputs ───────────────────────────────
test('reject inputs not in any recipe', () => {
  const s = new ProcessingStation({ station: 'fermenting_barrel' });
  const r = s.put('gold');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_recipe');
});

// ── 8. Reject put when not empty ───────────────────────────
test('reject put when station is not empty', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  s.put('meat');
  const r = s.put('meat');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_empty');
});

// ── 9. Take resets state ───────────────────────────────────
test('take resets state to EMPTY', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  s.put('meat');
  s.tick(s.startedAt + 31 * 1000);
  const r = s.take();
  assert.equal(r.ok, true);
  assert.equal(r.itemId, 'jerky');
  assert.equal(s.state, PROC_STATE.EMPTY);
  assert.equal(s.inputItemId, null);
});

// ── 10. Take on non-READY fails ────────────────────────────
test('take on non-READY fails', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  s.put('meat');
  const r = s.take();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_ready');
});

// ── 11. Progress fraction ─────────────────────────────────
test('progressFraction is 0..1 over duration', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  s.put('meat');
  const start = s.startedAt;
  assert.equal(s.progressFraction(start), 0);
  assert.equal(s.progressFraction(start + 15 * 1000), 0.5);
  assert.equal(s.progressFraction(start + 30 * 1000), 1);
  assert.equal(s.progressFraction(start + 100 * 1000), 1, 'clamps at 1');
});

// ── 12. tick before processing is idle ─────────────────────
test('tick on EMPTY returns idle', () => {
  const s = new ProcessingStation({ station: 'drying_rack' });
  const r = s.tick(Date.now());
  assert.equal(r, 'idle');
});

// ── 13. Serialize roundtrip ────────────────────────────────
test('serialize/load roundtrip preserves state', () => {
  const s = new ProcessingStation({ station: 'drying_rack', entityId: 'rack-1' });
  s.put('meat');
  s.tick(s.startedAt + 10 * 1000);
  const snap = s.serialize();
  assert.equal(snap.v, 1);
  assert.equal(snap.state, 'processing');
  assert.equal(snap.inputItemId, 'meat');

  const s2 = new ProcessingStation({ station: 'drying_rack', snapshot: snap });
  assert.equal(s2.state, PROC_STATE.PROCESSING);
  assert.equal(s2.inputItemId, 'meat');
  assert.equal(s2.outputRecipe.id, 'jerky');
});

// ── 14. ProcessingManager ─────────────────────────────────
test('ProcessingManager register / unregister / tickAll', () => {
  const mgr = new ProcessingManager();
  const s1 = new ProcessingStation({ station: 'drying_rack' });
  const s2 = new ProcessingStation({ station: 'fermenting_barrel' });
  s1.put('meat');
  s2.put('berries');
  mgr.register('b-1', s1);
  mgr.register('b-2', s2);
  assert.equal(mgr.stations.size, 2);
  mgr.tickAll(s1.startedAt + 31 * 1000);
  assert.equal(s1.state, PROC_STATE.READY);
  // s2 still processing (60s)
  assert.equal(s2.state, PROC_STATE.PROCESSING);
  mgr.unregister('b-1');
  assert.equal(mgr.stations.size, 1);
});

// ── 15. cooking station is NOT a processing station ────────
test('constructor rejects unknown station', () => {
  let threw = false;
  try { new ProcessingStation({ station: 'cooking' }); }
  catch (e) { threw = true; }
  assert.ok(threw);
});

// ── 16. inventory integration ──────────────────────────────
test('integrates with inventory: take → inventory.add', () => {
  const inv = new Inventory();
  inv.add('meat', 5);
  const s = new ProcessingStation({ station: 'drying_rack' });
  inv.consume('meat', 1);
  s.put('meat');
  s.tick(s.startedAt + 31 * 1000);
  const r = s.take();
  assert.equal(r.ok, true);
  inv.add(r.itemId, r.count);
  assert.equal(inv.countOf('jerky'), 1);
});

// ── 17. processingPanelOnClick routing ─────────────────────
test('processingPanelOnClick: EMPTY + click slot puts hotbar item', () => {
  const inv = new Inventory();
  inv.add('meat', 2);
  const s = new ProcessingStation({ station: 'drying_rack' });
  const hitMap = {
    panelRect: { x: 100, y: 100, w: 240, h: 200 },
    slotRect:  { x: 196, y: 150, w: 48, h: 48 },
    takeBtn:   null
  };
  const r = processingPanelOnClick(220, 174, hitMap, s, inv, 0);
  assert.equal(r.action, 'put');
  assert.equal(r.itemId, 'meat');
  assert.equal(s.state, PROC_STATE.PROCESSING);
  assert.equal(inv.countOf('meat'), 1, 'consumed 1 from hotbar');
});

test('processingPanelOnClick: click outside panel is noop', () => {
  const inv = new Inventory();
  const s = new ProcessingStation({ station: 'drying_rack' });
  const hitMap = {
    panelRect: { x: 100, y: 100, w: 240, h: 200 },
    slotRect:  { x: 196, y: 150, w: 48, h: 48 },
    takeBtn:   null
  };
  const r = processingPanelOnClick(10, 10, hitMap, s, inv, 0);
  assert.equal(r, null);
});

test('processingPanelOnClick: no_recipe when item not valid', () => {
  const inv = new Inventory();
  inv.add('stone', 1);  // stone has no drying_rack recipe
  const s = new ProcessingStation({ station: 'drying_rack' });
  const hitMap = {
    panelRect: { x: 100, y: 100, w: 240, h: 200 },
    slotRect:  { x: 196, y: 150, w: 48, h: 48 },
    takeBtn:   null
  };
  const r = processingPanelOnClick(220, 174, hitMap, s, inv, 0);
  assert.equal(r.action, 'no_recipe');
  assert.equal(s.state, PROC_STATE.EMPTY);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
