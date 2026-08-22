/**
 * M5.3 Catalog Smoke — 验证 items/recipes 完整性
 *
 * 校验:
 *   1. validateCatalog() 通过
 *   2. 8 种子 + 4 肥料存在
 *   3. 30 烹饪食谱存在
 *   4. 5 加工站食谱存在
 *   5. 每个 crop seed → crop 的 plantGrowsInto 引用有效
 *   6. 每个 fertilizer 的 mult > 1
 *   7. 烹饪食谱 pattern 全部是 1D 数组 (length 1..4)
 *   8. 加工站食谱 pattern 长度 1
 *   9. potion 物品有 buff 字段
 */
'use strict';

import { strict as assert } from 'node:assert';
import {
  validateCatalog,
  allItems,
  allRecipes,
  getItem,
  getRecipe,
  gridKind,
  recipesForStation
} from '../src/resources/catalog.js';
import { CROPS, allSeedIds } from '../src/farming/crops.js';
import { FERTILIZERS, allFertilizerIds } from '../src/farming/fertilizer.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('=== M5.3 Catalog Smoke ===\n');

// 1. validateCatalog
test('validateCatalog() passes', () => {
  assert.equal(validateCatalog(), true);
});

// 2. 8 seeds
test('8 crop seeds exist', () => {
  const seeds = allSeedIds();
  assert.equal(seeds.length, 8, `expected 8 seeds, got ${seeds.length}`);
  for (const s of seeds) {
    const it = getItem(s);
    assert.equal(it.category, 'seed');
    assert.ok(it.plantGrowsInto, `${s} missing plantGrowsInto`);
    assert.ok(it.growthDays > 0, `${s} growthDays <= 0`);
  }
});

// 3. 30 cooking recipes
test('30 cooking recipes exist', () => {
  const cooking = recipesForStation('cooking');
  assert.equal(cooking.length, 30, `expected 30 cooking recipes, got ${cooking.length}`);
});

// 4. 5 processing recipes
test('5 processing recipes exist', () => {
  const drying = recipesForStation('drying_rack');
  const fermenting = recipesForStation('fermenting_barrel');
  assert.equal(drying.length, 1, `drying_rack: expected 1, got ${drying.length}`);
  assert.equal(fermenting.length, 4, `fermenting_barrel: expected 4, got ${fermenting.length}`);
});

// 5. seed -> crop refs valid
test('crop seeds reference valid plant targets', () => {
  for (const crop of Object.values(CROPS)) {
    const seed = getItem(crop.seedId);
    const target = getItem(crop.id);
    assert.equal(seed.plantGrowsInto, crop.id, `${crop.seedId}.plantGrowsInto != ${crop.id}`);
    assert.ok(target, `crop target ${crop.id} not found`);
  }
});

// 6. fertilizer mult > 1
test('all fertilizers have mult > 1', () => {
  for (const f of Object.values(FERTILIZERS)) {
    assert.ok(f.mult > 1, `${f.id} mult ${f.mult} <= 1`);
  }
  assert.equal(allFertilizerIds().length, 4);
});

// 7. cooking pattern is 1D
test('all cooking patterns are 1D length 1..4', () => {
  for (const r of recipesForStation('cooking')) {
    const kind = gridKind(r.grid);
    assert.equal(kind.kind, 'line');
    assert.equal(kind.size, 4);
    const nonEmpty = r.pattern.filter(c => c !== '');
    assert.ok(nonEmpty.length >= 1 && nonEmpty.length <= 4,
      `${r.id} pattern length ${nonEmpty.length}`);
  }
});

// 8. processing pattern is 1 cell
test('all processing patterns are single-cell', () => {
  for (const r of [...recipesForStation('drying_rack'), ...recipesForStation('fermenting_barrel')]) {
    const nonEmpty = r.pattern.filter(c => c !== '');
    assert.equal(nonEmpty.length, 1, `${r.id} should have 1 cell`);
  }
});

// 9. potion buff
test('all potions have buff', () => {
  const potions = allItems().filter(it => it.category === 'potion');
  assert.equal(potions.length, 4, `expected 4 potions, got ${potions.length}`);
  for (const p of potions) {
    assert.ok(typeof p.buff === 'string' && p.buff.length > 0,
      `${p.id} missing buff`);
  }
});

// 10. recipe count summary
test('total recipe count by station', () => {
  const total = allRecipes();
  const byStation = {};
  for (const r of total) byStation[r.station] = (byStation[r.station] || 0) + 1;
  console.log('     stations:', JSON.stringify(byStation));
  assert.ok(byStation.hand >= 3);
  assert.ok(byStation.science >= 8, `science: ${byStation.science}`);
  assert.ok(byStation.cooking === 30);
  assert.equal(byStation.drying_rack, 1);
  assert.equal(byStation.fermenting_barrel, 4);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
