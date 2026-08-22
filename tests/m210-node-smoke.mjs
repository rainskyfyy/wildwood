#!/usr/bin/env node
/**
 * M2.10 resource system smoke test — exercises inventory, spawner,
 * gather state machine, and crafting in Node (no DOM).
 *
 *   node tests/m210-node-smoke.mjs
 */

import {
  validateCatalog, allResources, resourcesForBiome, getResource, getItem, allItems, allRecipes
} from '../src/resources/catalog.js';
import { Inventory, HOTBAR_SIZE, TOTAL_SLOTS } from '../src/resources/inventory.js';
import { spawnResources } from '../src/resources/spawner.js';
import { ResourceEntity } from '../src/resources/resource-entity.js';
import { Gather, GATHER_IDLE, GATHER_GATHERING, DEFAULT_RANGE } from '../src/resources/gather.js';
import { matchRecipe, craft, emptyGrid } from '../src/resources/crafting.js';
import { generateWorld } from '../src/world/generator.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail || ''}`); }
}

// ---------- 1. catalog ----------
console.log('catalog');
ok('validateCatalog passes', validateCatalog() === true);
ok('allResources has >= 6 kinds', allResources().length >= 6, `got ${allResources().length}`);
ok('allItems has >= 8 items', allItems().length >= 8, `got ${allItems().length}`);
ok('allRecipes has >= 4 recipes', allRecipes().length >= 4, `got ${allRecipes().length}`);
ok('resourcesForBiome(plains) returns non-empty', resourcesForBiome('plains').length > 0);
ok('resourcesForBiome(mines) contains iron_ore',
   resourcesForBiome('mines').some(r => r.id === 'iron_ore'));
ok('unknown resource throws', (() => { try { getResource('nope'); return false; } catch (_) { return true; } })());
ok('unknown item throws', (() => { try { getItem('nope'); return false; } catch (_) { return true; } })());

// ---------- 2. inventory ----------
console.log('inventory');
const inv = new Inventory();
ok('new inventory empty', inv.isEmpty());
ok('total slots = 21', TOTAL_SLOTS === 21);

ok('add 5 of log -> placed 5', inv.add('log', 5).added === 5);
ok('add 5 more of log -> 10 total', inv.add('log', 5).added === 5 && inv.countOf('log') === 10);
ok('add 15 more stacks to cap 20 (1 full + 1 partial)',
   inv.add('log', 15).added === 15 && inv.countOf('log') === 25);
ok('inventory now has 2 stacks of log',
   inv.slots.filter(s => s && s.itemId === 'log').length === 2);

ok('remove 3 from first log slot', inv.remove(0, 3) === 3);
ok('first log slot count = 17 after remove (was 20)',
   inv.slots[0].count === 17);

ok('swap slots 0 and 1', (() => {
  inv.swap(0, 1);
  return inv.slots[0].itemId === 'log' && inv.slots[1].itemId === 'log';
})());

ok('move stacks same item merges when it fits in cap', (() => {
  const t = new Inventory();
  t.add('log', 10);
  t.add('log', 5);   // slots[0]={log,10}, slots[1]={log,5}
  t.move(0, 1);
  return t.slots[0] == null && t.slots[1].count === 15;
})());

ok('move stacks same item swaps when total exceeds cap', (() => {
  const t = new Inventory();
  t.slots[0] = { itemId: 'log', count: 18 };
  t.slots[1] = { itemId: 'log', count: 5 };   // 18+5=23 > 20
  t.move(0, 1);
  return t.slots[0].count === 5 && t.slots[1].count === 18;
})());

ok('move different items swaps (does not merge)', (() => {
  const t = new Inventory();
  t.slots[0] = { itemId: 'log',   count: 3 };
  t.slots[1] = { itemId: 'twine', count: 2 };
  t.move(1, 0);   // move twine -> slot 0; slot 0 holds log -> swap
  return t.slots[0].itemId === 'twine'
      && t.slots[0].count === 2
      && t.slots[1].itemId === 'log'
      && t.slots[1].count === 3;
})());

ok('serialize/loadSnapshot round-trip', (() => {
  const snap = inv.serialize();
  const inv2 = new Inventory();
  inv2.loadSnapshot(snap);
  return JSON.stringify(inv.serialize()) === JSON.stringify(inv2.serialize());
})());

ok('selectHotbar clamps to 0..5', (() => { inv.selectHotbar(99); return inv.selected === 5; })());
inv.slots[5] = { itemId: 'log', count: 1 };
ok('hotbarSelected returns current slot', inv.slot(inv.selected) != null);

// ---------- 3. spawner ----------
console.log('spawner');
const world = generateWorld({ width: 80, height: 60, seed: 20260822 });
const r1 = spawnResources(world, { seed: 20260853 });
const r2 = spawnResources(world, { seed: 20260853 });
ok('spawner determinism: same count', r1.length === r2.length);
ok('spawner determinism: same first 5 positions',
   JSON.stringify(r1.slice(0, 5).map(e => [e.x, e.y, e.id])) ===
   JSON.stringify(r2.slice(0, 5).map(e => [e.x, e.y, e.id])));
ok('spawner produced > 0 entities', r1.length > 0, `got ${r1.length}`);
ok('all entities are ResourceEntity instances', r1.every(e => e instanceof ResourceEntity));
ok('every entity has a defined icon', r1.every(e => !!e.icon));

// ---------- 4. resource entity ----------
console.log('resource-entity');
const bag = new Inventory();
const tree = new ResourceEntity({ id: 'tree', x: 10, y: 10, rngSeed: 42 });
ok('tree.hp = 1', tree.hp === 1);
ok('tree.harvestTime = 1.5', tree.harvestTime === 1.5);
ok('tree.distTo self = 0', tree.distTo(10, 10) < 0.001);

const loot = tree.harvest(bag);
ok('tree.harvest returns granted array', Array.isArray(loot.granted));
ok('tree.harvested -> depleted', tree.depleted === true);
ok('tree.regrowAt set to future timestamp', loot.regrowAt > 0 && loot.regrowAt > Date.now());
ok('at least one drop landed in bag', bag.countOf('log') > 0 || bag.countOf('twine') > 0,
   `bag=${JSON.stringify(bag.slots.filter(Boolean))}`);

const reHarvest = tree.harvest(bag);
ok('re-harvesting depleted returns empty granted', reHarvest.granted.length === 0);

const a = new ResourceEntity({ id: 'tree', x: 5, y: 5, rngSeed: 100 });
const b = new ResourceEntity({ id: 'tree', x: 5, y: 5, rngSeed: 100 });
const bagA = new Inventory();
const bagB = new Inventory();
const lootA = a.harvest(bagA);
const lootB = b.harvest(bagB);
ok('same rng seed -> same loot', JSON.stringify(lootA.granted) === JSON.stringify(lootB.granted));

// ---------- 5. gather state machine ----------
console.log('gather');
const gatherWorld = generateWorld({ width: 30, height: 30, seed: 7 });
const ents = spawnResources(gatherWorld, { seed: 7 });
const gInv = new Inventory();
const gather = new Gather({ entities: ents, inventory: gInv, range: DEFAULT_RANGE });

ok('initial state = idle', gather.state === GATHER_IDLE);

ents.push(new ResourceEntity({ id: 'tree', x: 15.5, y: 15.5, rngSeed: 1 }));
const player = { x: 15.5, y: 15.5 };
ok('click on in-range resource starts gathering',
   gather.click(15.5, 15.5) === true && gather.state === GATHER_GATHERING);

gather.update({ x: 30, y: 30 }, 0.5);
ok('walk out of range cancels', gather.state === GATHER_IDLE);

gather.click(15.5, 15.5);
ok('click again restarts', gather.state === GATHER_GATHERING);
gather.update(player, 0.1);
ok('partial progress < 1', gather.progressFraction() < 1);
gather.update(player, 5.0);
gather.update(player, 0.001);
ok('after enough time, completes and returns to idle', gather.state === GATHER_IDLE);
ok('inventory gained at least 1 log', gInv.countOf('log') >= 1, `log=${gInv.countOf('log')}`);

// ---------- 6. crafting ----------
console.log('crafting');
const cInv = new Inventory();
cInv.add('log', 4);
cInv.add('twine', 4);
cInv.add('stone', 2);

// 5.3 农耕与烹饪 将 hand 配方改名 + pattern 微调:
//   make_torch      pattern: [['twine', 'twine'], ['', '']]
//   build_campfire  pattern: [['log', 'twine'], ['stone', '']]
const grid1 = [
  ['twine', 'twine'],
  ['', '']
];
ok('match torch recipe', matchRecipe(grid1, 'hand')?.id === 'make_torch');

const beforeLog = cInv.countOf('log');
const beforeTwine = cInv.countOf('twine');
const beforeStone = cInv.countOf('stone');
const r1c = craft(grid1, 'hand', cInv);
ok('craft torch returns ok', r1c.ok === true);
ok('craft torch consumed 2 twine', cInv.countOf('twine') === beforeTwine - 2);
ok('craft produced 1 torch', cInv.countOf('torch') === 1);

const grid2 = [
  ['log', 'twine'],
  ['stone', '']
];
ok('match campfire recipe', matchRecipe(grid2, 'hand')?.id === 'build_campfire');
const r2c = craft(grid2, 'hand', cInv);
ok('craft campfire ok', r2c.ok === true);
ok('craft produced 1 campfire', cInv.countOf('campfire') === 1);
ok('craft campfire consumed 1 log + 1 twine + 1 stone',
   cInv.countOf('log') === beforeLog - 1
   && cInv.countOf('twine') === beforeTwine - 3   // 2 for torch + 1 for campfire
   && cInv.countOf('stone') === beforeStone - 1);

const gridBad = [
  ['log', 'log'],
  ['log', 'log']
];
ok('match fails for unknown pattern', matchRecipe(gridBad, 'hand') === null);
ok('craft unknown returns no_match', craft(gridBad, 'hand', cInv).reason === 'no_match');

ok('match 2x2 in 3x3 station fails', matchRecipe(grid1, 'science') === null);

const emptyInv = new Inventory();
const r3c = craft(grid1, 'hand', emptyInv);
ok('craft with empty inventory returns insufficient_items',
   r3c.reason === 'insufficient_items');

const g3 = emptyGrid(2);
ok('emptyGrid is 2x2 of ""', g3.length === 2 && g3[0][0] === '' && g3[1][1] === '');

ok('all recipe patterns reference real items', (() => {
  const itemIds = new Set(allItems().map(i => i.id));
  for (const r of allRecipes()) {
    // pattern 可以是 1D(line grid, 5.3 cooking)或 2D(matrix, hand/science)
    const cells = (!Array.isArray(r.pattern[0]))
      ? r.pattern                                  // 1D
      : r.pattern.flat();                          // 2D
    for (const c of cells) {
      if (c !== '' && c != null && !itemIds.has(c)) return false;
    }
  }
  return true;
})());

// ---------- summary ----------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
