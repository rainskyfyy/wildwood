/**
 * M5.3 Farming Smoke — 完整流程: 犁地→播种→浇水→施肥→收获
 *
 * 测试:
 *   1. 犁地 (hoe 工具)
 *   2. 播种 (carrot_seed)
 *   3. 浇水 (watering_can)
 *   4. 施肥 (compost)
 *   5. 加速生长 → 收获
 *   6. 缺水检查
 *   7. 拔除返还种子
 *   8. 8 作物定义完整
 *   9. 序列化往返
 *  10. 统计正确
 */
'use strict';

import { strict as assert } from 'node:assert';
import { FarmSystem, TILE_STATE } from '../src/farming/farming.js';
import { CROPS, CROP_STAGE, STAGE_THRESHOLD, growthSeconds, allSeedIds } from '../src/farming/crops.js';
import { FERTILIZERS, combineFertilizer, currentFertilizerMult } from '../src/farming/fertilizer.js';
import { Inventory } from '../src/resources/inventory.js';

// 抑制 FarmingSystem 的 console 噪音
function silence(fn) {
  const orig = console.log;
  return () => { /* keep quiet */ };
}

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

const world = { width: 80, height: 60 };

console.log('=== M5.3 Farming Smoke ===\n');

// ── 1. 8 crops defined ──────────────────────────────────────
test('8 crop definitions', () => {
  assert.equal(Object.keys(CROPS).length, 8);
  for (const c of Object.values(CROPS)) {
    assert.ok(c.seedId, `${c.id} missing seedId`);
    assert.ok(c.growthDays > 0);
    assert.ok(c.yieldMax >= c.yieldMin);
  }
  assert.equal(allSeedIds().length, 8);
});

// ── 2. 4 fertilizers ────────────────────────────────────────
test('4 fertilizers with positive mult', () => {
  assert.equal(Object.keys(FERTILIZERS).length, 4);
  for (const f of Object.values(FERTILIZERS)) {
    assert.ok(f.mult > 1);
  }
});

// ── 3. Tilling ──────────────────────────────────────────────
test('till grass tile with hoe', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  inv.add('watering_can', 1);
  inv.add('compost', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  const r = fs.useToolAt(10, 10, 'hoe', null);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'tilled');
  const tile = fs.getTile(10, 10);
  assert.equal(tile.state, TILE_STATE.TILLED);
});

// ── 4. Till again (idempotent on grass) ────────────────────
test('cannot till a non-grass tile', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(20, 20, 'hoe', null);
  const r2 = fs.useToolAt(20, 20, 'hoe', null);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'tile_state');
});

// ── 5. Plant a seed ─────────────────────────────────────────
test('plant carrot seed in tilled tile', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  const r = fs.useToolAt(5, 5, null, 'carrot_seed');
  assert.equal(r.ok, true);
  assert.equal(r.action, 'planted');
  assert.equal(r.cropId, 'carrot');
  assert.equal(inv.countOf('carrot_seed'), 4, 'seed should be consumed');
  const tile = fs.getTile(5, 5);
  assert.equal(tile.state, TILE_STATE.PLANTED);
  assert.equal(tile.cropId, 'carrot');
});

// ── 6. Water & fertilizer ───────────────────────────────────
test('water and fertilize planted tile', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  inv.add('watering_can', 1);
  inv.add('compost', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  fs.useToolAt(5, 5, null, 'carrot_seed');
  const w = fs.useToolAt(5, 5, 'watering_can', null);
  assert.equal(w.ok, true);
  assert.equal(w.action, 'watered');
  const f = fs.useToolAt(5, 5, null, 'compost');
  assert.equal(f.ok, true);
  assert.equal(f.action, 'fertilized');
  const tile = fs.getTile(5, 5);
  assert.equal(tile.dehydrated, false);
  assert.ok(tile.fertilizer);
  assert.equal(tile.fertilizer.id, 'compost');
});

// ── 7. Growth to READY ──────────────────────────────────────
test('crop grows to READY with time + fertilizer boost', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  inv.add('watering_can', 1);
  inv.add('mixed_fertilizer', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  fs.useToolAt(5, 5, null, 'carrot_seed');
  fs.useToolAt(5, 5, 'watering_can', null);
  fs.useToolAt(5, 5, null, 'mixed_fertilizer');

  // carrot base growthDays=3, baseSec=90, with mult=2.0 → 45s for full growth
  // Simulate 50 seconds of growth
  for (let i = 0; i < 100; i++) {
    fs.update(0.5);  // 100 * 0.5 = 50 seconds
    // Re-water if needed (carrot waterDrain=60s, plantedAt is past)
    const tile = fs.getTile(5, 5);
    if (tile.dehydrated) {
      fs.useToolAt(5, 5, 'watering_can', null);
    }
  }
  const tile = fs.getTile(5, 5);
  assert.equal(tile.state, TILE_STATE.READY, `expected READY, got ${tile.state} progress=${tile.progress}`);
  assert.ok(tile.progress >= 0.99);
});

// ── 8. Harvest ──────────────────────────────────────────────
test('harvest a READY tile yields crops', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  inv.add('watering_can', 1);
  inv.add('mixed_fertilizer', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  fs.useToolAt(5, 5, null, 'carrot_seed');
  fs.useToolAt(5, 5, 'watering_can', null);
  fs.useToolAt(5, 5, null, 'mixed_fertilizer');
  for (let i = 0; i < 100; i++) {
    fs.update(0.5);
    if (fs.getTile(5, 5).dehydrated) fs.useToolAt(5, 5, 'watering_can', null);
  }
  const h = fs.harvest(5, 5);
  assert.equal(h.ok, true);
  assert.equal(h.itemId, 'carrot');
  assert.ok(h.count >= 1 && h.count <= 2, `yield ${h.count} out of range`);
  assert.equal(fs.getTile(5, 5).state, TILE_STATE.GRASS, 'should be back to grass');
  assert.equal(inv.countOf('carrot'), h.count);
});

// ── 9. Dehydration pauses growth ────────────────────────────
test('dehydrated tile does not grow', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  fs.useToolAt(5, 5, null, 'carrot_seed');
  // Don't water — tile is dehydrated from start
  for (let i = 0; i < 20; i++) fs.update(1.0);
  const tile = fs.getTile(5, 5);
  assert.equal(tile.dehydrated, true);
  assert.equal(tile.progress, 0, 'no growth without water');
});

// ── 10. Remove plant returns seed ───────────────────────────
test('right-click on planted returns seed', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 3);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(5, 5, 'hoe', null);
  fs.useToolAt(5, 5, null, 'carrot_seed');
  assert.equal(inv.countOf('carrot_seed'), 2);
  const r = fs.rightClick(5, 5);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'removed');
  assert.equal(inv.countOf('carrot_seed'), 3);
});

// ── 11. Fertilizer combine picks higher tier ────────────────
test('combineFertilizer upgrades to higher tier', () => {
  const a = combineFertilizer(null, 'compost');
  assert.equal(a.id, 'compost');
  const b = combineFertilizer(a, 'bonemeal');
  assert.equal(b.id, 'bonemeal', 'bonemeal should upgrade');
  const c = combineFertilizer(b, 'compost');
  assert.equal(c.id, 'bonemeal', 'compost should not downgrade bonemeal');
  assert.equal(currentFertilizerMult(b), 1.5);
});

// ── 12. Serialization roundtrip ─────────────────────────────
test('serialize/load roundtrip preserves tiles', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  inv.add('watering_can', 1);
  inv.add('bonemeal', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(10, 10, 'hoe', null);
  fs.useToolAt(10, 10, null, 'carrot_seed');
  fs.useToolAt(10, 10, 'watering_can', null);
  fs.useToolAt(10, 10, null, 'bonemeal');
  fs.update(5.0);
  const snap = fs.serialize();
  assert.equal(snap.v, 1);
  assert.equal(snap.tiles.length, 1);

  const fs2 = new FarmSystem({ world, inventory: inv });
  fs2.loadSnapshot(snap);
  const tile = fs2.getTile(10, 10);
  assert.equal(tile.state, TILE_STATE.PLANTED);
  assert.equal(tile.cropId, 'carrot');
  assert.equal(tile.fertilizer.id, 'bonemeal');
});

// ── 13. All 8 crops grow to READY ───────────────────────────
test('all 8 crops reach READY under boost+water', () => {
  for (const crop of Object.values(CROPS)) {
    const inv = new Inventory();
    inv.add('hoe', 1);
    inv.add(crop.seedId, 5);
    inv.add('watering_can', 1);
    inv.add('mixed_fertilizer', 5);
    const fs = new FarmSystem({ world, inventory: inv });
    fs.useToolAt(0, 0, 'hoe', null);
    fs.useToolAt(0, 0, null, crop.seedId);
    fs.useToolAt(0, 0, 'watering_can', null);
    fs.useToolAt(0, 0, null, 'mixed_fertilizer');
    // Worst case: watermelon 6 days * 30s / 2.0 = 90s. Pump 200s.
    for (let i = 0; i < 400; i++) {
      fs.update(0.5);
      if (fs.getTile(0, 0).dehydrated) fs.useToolAt(0, 0, 'watering_can', null);
    }
    const tile = fs.getTile(0, 0);
    assert.equal(tile.state, TILE_STATE.READY, `${crop.id} failed to reach READY (progress=${tile.progress})`);
  }
});

// ── 14. countByState ────────────────────────────────────────
test('countByState reflects tile states', () => {
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 5);
  const fs = new FarmSystem({ world, inventory: inv });
  fs.useToolAt(1, 1, 'hoe', null);
  fs.useToolAt(2, 2, 'hoe', null);
  fs.useToolAt(1, 1, null, 'carrot_seed');
  const c = fs.countByState();
  assert.equal(c.tilled, 1);
  assert.equal(c.planted, 1);
});

// ── 15. T key flow: simulate main.js T → useToolAt routing ──
test('T-key flow: hoe selected → tilled; seed selected → planted; harvest with empty hand', () => {
  // Mimic what main.js does for the T key:
  //   1. toolId = selected tool item, heldItemId = selected item
  //   2. call farmSystem.useToolAt(fx, fy, toolId, heldItemId)
  const inv = new Inventory();
  inv.add('hoe', 1);
  inv.add('carrot_seed', 3);
  inv.add('watering_can', 1);

  const world = { width: 5, height: 5, idx: (x, y) => y * 5 + x };
  const fs = new FarmSystem({ world, inventory: inv });

  // Step 1: equip hoe (hotbar slot 0)
  let sel = inv.slots[0];
  let toolId = sel && sel.itemId === 'hoe' ? sel.itemId : null;
  let heldItemId = sel.itemId;
  let r = fs.useToolAt(2, 2, toolId, heldItemId);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'tilled');
  assert.equal(fs.getTile(2, 2).state, TILE_STATE.TILLED);

  // Step 2: equip carrot_seed (in slot 1)
  sel = inv.slots[1];
  toolId = null;  // seed is held, not a tool
  heldItemId = sel.itemId;
  r = fs.useToolAt(2, 2, toolId, heldItemId);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'planted');
  assert.equal(fs.getTile(2, 2).state, TILE_STATE.PLANTED);

  // Step 3: water with watering_can
  sel = inv.slots[2];
  toolId = sel.itemId;  // watering_can is a tool
  heldItemId = sel.itemId;
  r = fs.useToolAt(2, 2, toolId, heldItemId);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'watered');
  assert.equal(fs.getTile(2, 2).dehydrated, false);

  // Step 4: harvest with empty hand (simulate selecting an empty slot)
  toolId = null;
  heldItemId = null;
  // Force growth to 1.0 (simulate waiting or fertilizing)
  const tile = fs.tiles.get('2,2');
  tile.progress = 1.0;
  tile.state = TILE_STATE.READY;
  r = fs.useToolAt(2, 2, toolId, heldItemId);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'harvested');
  assert.equal(r.itemId, 'carrot');
  // carrot yieldMin=1 yieldMax=2 — just assert at least 1 carrot got in
  assert.ok(inv.countOf('carrot') >= 1, `expected ≥1 carrot, got ${inv.countOf('carrot')}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
