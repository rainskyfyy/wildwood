/**
 * M2.10e — three-stage growth system tests.
 *
 * Validates:
 *   §1. catalog growthStages API (exports + validation)
 *   §2. entity initializes at stage 0
 *   §3. time progression advances stages
 *   §4. terminal stage stays put
 *   §5. harvest at each stage gives correct drops
 *   §6. harvest at terminal stage resets to stage 0
 *   §7. stage 2 (terminal) gives rare/seed items
 *   §8. non-growth-capable resources unchanged
 *   §9. depleted transform resets to stage 0 of new resource
 *   §10. payload fields (currentStage, growthReset)
 *   §11. integration with RegrowManager
 */
'use strict';

import {
  getGrowthStages,
  isGrowthCapable,
  getStageCount,
  getStageDef,
  validateCatalog
} from '../src/resources/catalog.js';
import { ResourceEntity } from '../src/resources/resource-entity.js';
import { RegrowManager } from '../src/resources/regrow.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL:', msg); }
}
function eq(a, b, msg) { assert(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function approx(a, b, msg, tol = 0.001) { assert(Math.abs(a - b) < tol, `${msg} (got ${a}, want ${b})`); }

console.log('=== M2.10e three-stage growth ===');

// ---------- §1 catalog API ----------
console.log('§1 catalog API');
validateCatalog();
eq(isGrowthCapable('tree'), true, 'tree is growth-capable');
eq(isGrowthCapable('dead_tree'), true, 'dead_tree is growth-capable');
eq(isGrowthCapable('berry_bush'), true, 'berry_bush is growth-capable');
eq(isGrowthCapable('rock'), false, 'rock is NOT growth-capable');
eq(isGrowthCapable('gold_ore'), false, 'gold_ore is NOT growth-capable');
eq(isGrowthCapable('coal'), false, 'coal is NOT growth-capable');
eq(getStageCount('tree'), 3, 'tree has 3 stages');
eq(getStageCount('dead_tree'), 3, 'dead_tree has 3 stages');
eq(getStageCount('berry_bush'), 3, 'berry_bush has 3 stages');
eq(getStageCount('rock'), 1, 'rock has 1 stage');
const treeStages = getGrowthStages('tree');
eq(treeStages.length, 3, 'tree growthStages.length');
eq(treeStages[0].def, 'tree_sprout', 'tree stage 0 def');
eq(treeStages[0].duration, 30, 'tree stage 0 duration');
eq(treeStages[1].def, 'tree', 'tree stage 1 def');
eq(treeStages[1].duration, 180, 'tree stage 1 duration');
eq(treeStages[2].def, 'tree_old', 'tree stage 2 def');
eq(treeStages[2].duration, -1, 'tree stage 2 duration is terminal');
const nullStages = getGrowthStages('rock');
eq(nullStages, null, 'rock growthStages is null');
const treeSprout = getStageDef('tree', 0);
eq(treeSprout.id, 'tree_sprout', 'getStageDef(tree, 0)');
const treeOld = getStageDef('tree', 2);
eq(treeOld.id, 'tree_old', 'getStageDef(tree, 2)');
const rockDef = getStageDef('rock', 0);
eq(rockDef.id, 'rock', 'getStageDef(rock, 0) is rock');
let threw = false;
try { getStageDef('rock', 1); } catch (e) { threw = e.message.includes('no stage 1'); }
assert(threw, 'getStageDef(rock, 1) throws');

// ---------- §2 init at stage 0 ----------
console.log('§2 init at stage 0');
const e1 = new ResourceEntity({ id: 'tree', x: 5, y: 5, now: 1000 });
eq(e1.currentStageIndex, 0, 'init stage');
eq(e1.id, 'tree_sprout', 'init id');
eq(e1._rootId, 'tree', 'init rootId');
eq(e1.stageStartedAt, 1000, 'init stageStartedAt');
assert(e1.isGrowthCapable, 'isGrowthCapable');
assert(!e1.isTerminalStage, 'init is not terminal');
eq(e1.stageCount, 3, 'stageCount');

const e2 = new ResourceEntity({ id: 'rock', x: 0, y: 0, now: 1000 });
eq(e2.currentStageIndex, 0, 'rock init stage');
eq(e2.id, 'rock', 'rock init id');
assert(!e2.isGrowthCapable, 'rock not growth-capable');
eq(e2.stageCount, 1, 'rock stageCount');
assert(e2.isTerminalStage, 'rock is terminal (single-stage is trivially terminal)');

// ---------- §3 time progression ----------
console.log('§3 time progression');
const e3 = new ResourceEntity({ id: 'tree', x: 3, y: 3, now: 0 });
let changed = e3.update(10*1000);
assert(!changed, 'no change at 10s (stage 0 needs 30s)');
eq(e3.currentStageIndex, 0, 'still stage 0 at 10s');
changed = e3.update(30*1000);
assert(changed, 'changed at 30s (stage 0 → 1)');
eq(e3.currentStageIndex, 1, 'now stage 1 at 30s');
eq(e3.id, 'tree', 'now id=tree at stage 1');
changed = e3.update(30*1000 + 1);
assert(!changed, 'no change at 30s+1ms (stage 1 needs 180s)');
changed = e3.update(30*1000 + 180*1000);
assert(changed, 'changed at 30+180=210s (stage 1 → 2)');
eq(e3.currentStageIndex, 2, 'now stage 2 at 210s');
eq(e3.id, 'tree_old', 'now id=tree_old at stage 2');
assert(e3.isTerminalStage, 'stage 2 is terminal');
assert(!e3.isDepletable, 'tree is not depletable (no maxHarvests)');

// ---------- §4 terminal stage stays ----------
console.log('§4 terminal stage stays');
e3.update(999*1000);
eq(e3.currentStageIndex, 2, 'still stage 2 after long time');
eq(e3.id, 'tree_old', 'still tree_old after long time');
e3.update(Number.MAX_SAFE_INTEGER);
eq(e3.currentStageIndex, 2, 'still stage 2 at MAX_SAFE_INTEGER');

// ---------- §5 harvest gives correct drops per stage ----------
console.log('§5 harvest drops per stage');
// stage 0 (tree_sprout) — 1 twine
const eH0 = new ResourceEntity({ id: 'tree', x: 1, y: 1, now: 0 });
const inv0 = makeFakeInv();
const rH0 = eH0.harvest(inv0, 1000);
eq(eH0.currentStageIndex, 0, 'harvested at stage 0');
eq(rH0.currentStage, 0, 'payload currentStage=0');
const items0 = rH0.granted.map(g => g.itemId);
eq(items0[0], 'twine', 'stage 0 drops twine first');
// stage 1 (tree) — 3 log + 25% twine
const eH1 = new ResourceEntity({ id: 'tree', x: 2, y: 2, now: 0 });
eH1.update(30*1000 + 1);
eq(eH1.currentStageIndex, 1, 'advanced to stage 1');
const inv1 = makeFakeInv();
const rH1 = eH1.harvest(inv1, 60*1000);
const items1 = rH1.granted.map(g => g.itemId);
assert(items1.includes('log'), 'stage 1 includes log');
const logCount1 = rH1.granted.find(g => g.itemId === 'log').count;
eq(logCount1, 3, 'stage 1 gives 3 log');
// stage 2 (tree_old) — 4 log + 1 twine + 1 acorn
const eH2 = new ResourceEntity({ id: 'tree', x: 3, y: 3, now: 0 });
eH2.update(30*1000 + 180*1000 + 1);
eq(eH2.currentStageIndex, 2, 'advanced to stage 2');
const inv2 = makeFakeInv();
const rH2 = eH2.harvest(inv2, 999*1000);
const items2 = rH2.granted.map(g => g.itemId);
assert(items2.includes('acorn'), 'stage 2 includes acorn (rare seed)');
const acornCount = rH2.granted.find(g => g.itemId === 'acorn').count;
eq(acornCount, 1, 'stage 2 gives 1 acorn');
const logCount2 = rH2.granted.find(g => g.itemId === 'log').count;
eq(logCount2, 4, 'stage 2 gives 4 log (more than stage 1)');

// ---------- §6 harvest at terminal resets to stage 0 ----------
console.log('§6 harvest at terminal resets to stage 0');
const eH3 = new ResourceEntity({ id: 'tree', x: 4, y: 4, now: 0 });
eH3.update(30*1000 + 180*1000 + 1);
eq(eH3.currentStageIndex, 2, 'pre: stage 2');
const rH3 = eH3.harvest(makeFakeInv(), 999*1000);
assert(rH3.growthReset, 'payload growthReset=true');
eq(eH3.currentStageIndex, 0, 'post: stage 0');
eq(eH3.id, 'tree_sprout', 'post: id=tree_sprout');
eq(eH3._rootId, 'tree', 'post: rootId still tree');

// ---------- §7 stage 2 gives rare items ----------
console.log('§7 stage 2 gives rare items');
// berry_bush_old: 4 berries + 1 berry_seed
const eb = new ResourceEntity({ id: 'berry_bush', x: 5, y: 5, now: 0 });
eb.update(30*1000 + 120*1000 + 1);
eq(eb.currentStageIndex, 2, 'berry_bush stage 2');
const rEb = eb.harvest(makeFakeInv(), 999*1000);
assert(rEb.granted.some(g => g.itemId === 'berry_seed'), 'berry_bush_old drops berry_seed');
const berriesCount = rEb.granted.find(g => g.itemId === 'berries').count;
eq(berriesCount, 4, 'berry_bush_old gives 4 berries');
// dead_tree_old: 3 log + 1 dead_wood_chunk
const ed = new ResourceEntity({ id: 'dead_tree', x: 6, y: 6, now: 0 });
ed.update(45*1000 + 180*1000 + 1);
eq(ed.currentStageIndex, 2, 'dead_tree stage 2');
const rEd = ed.harvest(makeFakeInv(), 999*1000);
assert(rEd.granted.some(g => g.itemId === 'dead_wood_chunk'), 'dead_tree_old drops dead_wood_chunk');
const dwdCount = rEd.granted.find(g => g.itemId === 'dead_wood_chunk').count;
eq(dwdCount, 1, 'dead_tree_old gives 1 dead_wood_chunk');

// ---------- §8 non-growth-capable unchanged ----------
console.log('§8 non-growth-capable unchanged');
const er = new ResourceEntity({ id: 'rock', x: 7, y: 7, now: 0 });
er.update(999*1000);
eq(er.currentStageIndex, 0, 'rock still stage 0 after long time');
eq(er.id, 'rock', 'rock still id=rock');
const rEr = er.harvest(makeFakeInv(), 999*1000);
assert(!rEr.growthReset, 'rock harvest growthReset=false');
assert(rEr.granted.some(g => g.itemId === 'stone'), 'rock drops stone');

// ---------- §9 depleted transform ----------
console.log('§9 depleted transform resets to stage 0 of new resource');
// gold_ore (maxHarvests=2, transform to rock after 2nd harvest)
const eg = new ResourceEntity({ id: 'gold_ore', x: 8, y: 8, now: 0 });
assert(eg.isDepletable, 'gold_ore is depletable');
eq(eg._rootId, 'gold_ore', 'gold_ore rootId');
const rEg1 = eg.harvest(makeFakeInv(), 1000);
eq(eg.harvestCount, 1, 'after 1st harvest count=1');
assert(!rEg1.transformedTo, '1st harvest no transform');
// Wait for regrow to complete (regrowTime=240s)
eg.update(1000 + 240*1000 + 1);
assert(!eg.depleted, 'regrew after 240s');
eq(eg.harvestCount, 1, 'harvestCount still 1 after regrow');
const rEg2 = eg.harvest(makeFakeInv(), 1_000_000);
assert(rEg2.transformedTo === 'rock', '2nd harvest transforms to rock');
eq(eg._rootId, 'rock', 'after transform, rootId=rock');
eq(eg.currentStageIndex, 0, 'after transform, stage 0');
eq(eg.id, 'rock', 'after transform, id=rock');

// ---------- §10 payload fields ----------
console.log('§10 payload fields');
const eP = new ResourceEntity({ id: 'tree', x: 9, y: 9, now: 0 });
const rP0 = eP.harvest(makeFakeInv(), 0);
eq(rP0.currentStage, 0, 'payload currentStage=0 for stage 0 harvest');
eq(rP0.growthReset, true, 'growthReset=true even for stage 0 (since growth-capable)');
eP.update(30*1000 + 1);
const rP1 = eP.harvest(makeFakeInv(), 60*1000);
eq(rP1.currentStage, 1, 'payload currentStage=1 for stage 1 harvest');
eq(rP1.growthReset, true, 'growthReset=true for stage 1 harvest');

// ---------- §11 integration with RegrowManager ----------
console.log('§11 RegrowManager integration');
// Create a tree entity, fast-forward via RegrowManager
const eI = new ResourceEntity({ id: 'tree', x: 10, y: 10, now: 0 });
const mgr = new RegrowManager({ entities: [eI], now: () => 0 });
eq(eI.currentStageIndex, 0, 'I: init stage 0');
mgr.update(29*1000);
eq(eI.currentStageIndex, 0, 'I: still stage 0 at 29s');
mgr.update(31*1000);
eq(eI.currentStageIndex, 1, 'I: stage 1 at 31s');
mgr.update(31*1000 + 180*1000);
eq(eI.currentStageIndex, 2, 'I: stage 2 at 31+180s');
mgr.update(999*1000);
eq(eI.currentStageIndex, 2, 'I: stage 2 holds at 999s');
// After harvest at terminal, regrow should restore stage 0
const rI = eI.harvest(makeFakeInv(), 1_000_000);
assert(rI.growthReset, 'I: harvest at terminal growthReset');
eq(eI.currentStageIndex, 0, 'I: reset to stage 0 after harvest');
// regrow time on stage 0 is 0, so it's not depleted — fully grown stage 0
assert(!eI.depleted, 'I: stage 0 not depleted (regrowTime=0)');
// time advance again
mgr.update(1_000_000 + 30*1000 + 1);
eq(eI.currentStageIndex, 1, 'I: cycle 2, stage 1 at +30s');
// regrowFraction: not depleted now
approx(eI.regrowFraction(0), 1, 'I: regrowFraction=1 when not depleted');

console.log(`=== ${passed} passed / ${failed} failed ===`);
if (failed > 0) process.exit(1);

// ---------- helpers ----------
function makeFakeInv() {
  return {
    items: [],
    add(itemId, count) {
      this.items.push({ itemId, count });
      return { added: count, leftover: 0 };
    }
  };
}
