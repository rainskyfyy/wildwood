#!/usr/bin/env node
/**
 * M2.10b resource regrow + tool durability smoke test.
 *
 *   node tests/m210b-regrow-durability.mjs
 *
 * Covers:
 *   1. catalog: isTool / getToolType / getMaxDurability / checkTool
 *   2. inventory: tool add / damageTool / break event / persistence v2
 *   3. resource-entity: regrowAt set on harvest, regrow via update(),
 *      getVisualState, regrowFraction
 *   4. regrow manager: ticks entities, emits onRegrow
 *   5. gather integration: tool durability consumed on successful gather,
 *      wrong_tool does NOT consume durability
 */

import {
  validateCatalog, getItem, isTool, getToolType, getMaxDurability, checkTool
} from '../src/resources/catalog.js';
import { Inventory, HOTBAR_SIZE, TOTAL_SLOTS } from '../src/resources/inventory.js';
import { ResourceEntity } from '../src/resources/resource-entity.js';
import { Gather, GATHER_IDLE, DEFAULT_RANGE } from '../src/resources/gather.js';
import { RegrowManager } from '../src/resources/regrow.js';
import { spawnResources } from '../src/resources/spawner.js';
import { generateWorld } from '../src/world/generator.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail || ''}`); }
}

// ---------- 1. catalog ----------
console.log('catalog');
ok('validateCatalog passes', validateCatalog() === true);
ok('isTool(axe) = true', isTool('axe') === true);
ok('isTool(log) = false', isTool('log') === false);
ok('isTool(null) = false', isTool(null) === false);
ok('getToolType(axe) = "axe"', getToolType('axe') === 'axe');
ok('getToolType(pickaxe) = "pickaxe"', getToolType('pickaxe') === 'pickaxe');
ok('getToolType(shovel) = "shovel"', getToolType('shovel') === 'shovel');
ok('getToolType(torch) = "light"', getToolType('torch') === 'light');
ok('getToolType(log) = null', getToolType('log') === null);
ok('getMaxDurability(axe) = 50', getMaxDurability('axe') === 50);
ok('getMaxDurability(log) = null', getMaxDurability('log') === null);
ok('checkTool(tree, axe) = compatible', checkTool('tree', 'axe') === 'compatible');
ok('checkTool(tree, pickaxe) = wrong_tool', checkTool('tree', 'pickaxe') === 'wrong_tool');
ok('checkTool(tree, null) = tool_required', checkTool('tree', null) === 'tool_required');
ok('checkTool(rock, pickaxe) = compatible', checkTool('rock', 'pickaxe') === 'compatible');
ok('checkTool(rock, axe) = wrong_tool', checkTool('rock', 'axe') === 'wrong_tool');
ok('checkTool(berry_bush, null) = no_tool_required', checkTool('berry_bush', null) === 'no_tool_required');
ok('checkTool(berry_bush, axe) = no_tool_required', checkTool('berry_bush', 'axe') === 'no_tool_required');
ok('checkTool(grass_tuft_harvest, null) = no_tool_required', checkTool('grass_tuft_harvest', null) === 'no_tool_required');

// ---------- 2. inventory + durability ----------
console.log('inventory + durability');
const inv = new Inventory();
const r1 = inv.add('axe', 2);  // each tool takes 1 slot, so 2 slots filled
ok('add(axe, 2) places 2 tools in 2 slots', r1.added === 2 && r1.leftover === 0);
ok('axe slot 0 has durability = 50', inv.slots[0].durability === 50);
ok('axe slot 0 has maxDurability = 50', inv.slots[0].maxDurability === 50);
ok('axe slot 1 has durability = 50', inv.slots[1].durability === 50);

ok('damageTool(0, 5) returns 45', inv.damageTool(0, 5) === 45);
ok('axe slot 0 durability = 45 after damage', inv.slots[0].durability === 45);

ok('damageSelectedTool on empty selected does nothing', (() => {
  inv.selectHotbar(5);  // slot 5 is empty
  return inv.damageSelectedTool(1) === null;
})());

ok('damageTool non-existent slot = null', inv.damageTool(99, 1) === null);
ok('damageTool non-tool slot = null', (() => {
  inv.add('log', 3);
  return inv.damageTool(HOTBAR_SIZE, 1) === null;  // log is in backpack, not a tool
})());

let broken = null;
const invBreak = new Inventory({
  onBreak: (e) => { broken = e; }
});
invBreak.add('axe', 1);
ok('axe initially at full durability', invBreak.slots[0].durability === 50);
ok('damage 49 -> durability 1', invBreak.damageTool(0, 49) === 1);
ok('axe not yet broken', broken === null);
ok('damage 1 more -> tool breaks (durability 0)', invBreak.damageTool(0, 1) === 0);
ok('axe slot is null after break', invBreak.slots[0] === null);
ok('onBreak callback fired with itemId=axe', broken && broken.itemId === 'axe');
ok('onBreak callback fired with slotIndex=0', broken && broken.slotIndex === 0);

// serialize/load roundtrip with v=2 durability
ok('serialize v=2 with durability', (() => {
  const t = new Inventory();
  t.add('axe', 1);
  t.damageTool(0, 10);
  const s = t.serialize();
  return s.v === 2 && s.slots[0].durability === 40;
})());
ok('loadSnapshot v=2 with durability', (() => {
  const t = new Inventory();
  t.loadSnapshot({
    v: 2, selected: 0,
    slots: [
      { itemId: 'axe', count: 1, durability: 23, maxDurability: 50 },
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null, null, null, null, null, null
    ]
  });
  return t.slots[0].durability === 23 && t.slots[0].maxDurability === 50;
})());
ok('loadSnapshot v=1 still loads (backward compat)', (() => {
  const t = new Inventory();
  t.loadSnapshot({
    v: 1, selected: 0,
    slots: [
      { itemId: 'axe', count: 1 },
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null, null, null, null, null, null
    ]
  });
  return t.slots[0].durability === 50;  // migrated: full durability
})());

// Tools do not merge in move()
ok('tools do not merge when moving', (() => {
  const t = new Inventory();
  t.add('axe', 1);
  t.add('axe', 1);
  t.move(0, 1);
  return t.slots[0] != null && t.slots[1] != null;
})());

// ---------- 3. resource regrow ----------
console.log('resource-entity regrow');
const r = new ResourceEntity({ id: 'tree', x: 10, y: 10, rngSeed: 1 });
ok('tree regrowTime = 60', r.regrowTime === 60);
ok('initial visual state = full', r.getVisualState() === 'full');
ok('initial regrowFraction = 1', r.regrowFraction(0) === 1);

const now0 = 1000000;
const out = r.harvest(new Inventory(), now0);
ok('harvest returns granted array', Array.isArray(out.granted));
ok('harvest sets regrowAt = now + 60s', out.regrowAt === now0 + 60_000);
ok('after harvest: depleted = true', r.depleted === true);
ok('after harvest: visual = regrowing', r.getVisualState() === 'regrowing');
ok('regrowFraction at t0 = 0', r.regrowFraction(now0) === 0);
ok('regrowFraction halfway = ~0.5', Math.abs(r.regrowFraction(now0 + 30_000) - 0.5) < 0.001);
ok('regrowFraction at full = 1', r.regrowFraction(now0 + 60_000) === 1);

ok('update(now) before regrowAt does not respawn', (() => {
  const e = new ResourceEntity({ id: 'rock', x: 1, y: 1, rngSeed: 1 });
  e.harvest(new Inventory(), 1000);
  return e.update(1000 + 60_000) === false && e.depleted === true;
})());

ok('update(now) at regrowAt respawns', (() => {
  const e = new ResourceEntity({ id: 'rock', x: 1, y: 1, rngSeed: 1 });
  e.harvest(new Inventory(), 1000);
  return e.update(1000 + 120_000) === true && e.depleted === false;
})());

ok('re-harvest after regrow drops again', (() => {
  const e = new ResourceEntity({ id: 'rock', x: 1, y: 1, rngSeed: 1 });
  const bag = new Inventory();
  e.harvest(bag, 1000);
  e.update(1000 + 120_000);
  const out2 = e.harvest(bag, 1000 + 120_000);
  return out2.granted.length > 0;
})());

// regrowTime = 0 means permanent depletion
ok('rock without regrowTime stays depleted', (() => {
  // grass_tuft has regrowTime 30; this checks the no-regrow path
  // by passing a custom entity with regrowTime: 0 — but our catalog
  // always assigns a regrowTime. So we test that an entity with
  // regrowTime 0 is permanent.
  const def = {
    id: 'test_no_regrow', name: 'X', category: 'harvest', biomes: [],
    density: 0, harvestTime: 1, hp: 1, collision: '1x1',
    blockMovement: false, icon: 'rock', color: '#000', size: 0.5,
    regrowTime: 0, drops: []
  };
  // Manually construct entity bypassing catalog
  const e = Object.create(ResourceEntity.prototype);
  Object.assign(e, {
    id: def.id, x: 0, y: 0, size: 0.5, color: '#000', icon: 'rock', def,
    hp: 1, harvestTime: 1, blockMovement: false, drops: [],
    regrowTime: 0, depleted: false, regrowAt: 0,
    _rng: () => 0
  });
  e.harvest(new Inventory(), 0);
  return e.depleted === true && e.regrowAt === 0 && e.update(999999) === false;
})());

// ---------- 4. regrow manager ----------
console.log('regrow manager');
const w = generateWorld({ width: 30, height: 30, seed: 1 });
const ents = spawnResources(w, { seed: 1 });
let respawned = [];
const mgr = new RegrowManager({
  entities: ents,
  onRegrow: (e) => { respawned.push(e); }
});
const baseNow = 5000;
ok('update with no harvests -> 0 respawns', (() => {
  respawned = [];
  return mgr.update(baseNow).length === 0 && respawned.length === 0;
})());

ok('mass-harvest then tick regrows the right number', (() => {
  respawned = [];
  // Harvest the first 5 entities
  const target = ents.slice(0, 5);
  const bag = new Inventory();
  for (const e of target) e.harvest(bag, baseNow);
  // Compute the latest regrowAt
  const maxRegrowAt = Math.max(...target.map(e => e.regrowAt));
  // Tick at the moment each one should respawn
  const out = mgr.update(maxRegrowAt + 1);
  return out.length === 5 && respawned.length === 5
      && target.every(e => e.depleted === false);
})());

ok('update with virtual clock (no Date.now) works', (() => {
  const localMgr = new RegrowManager({
    entities: ents.slice(0, 1),
    now: () => 1000000
  });
  return typeof localMgr.now === 'function' && localMgr.now() === 1000000;
})());

// ---------- 5. gather integration with tool durability ----------
console.log('gather + tool integration');
const gw = generateWorld({ width: 30, height: 30, seed: 99 });
const gent = spawnResources(gw, { seed: 99 });
// Find the closest tree to (0,0) — robust against RNG-sequence shifts
// caused by catalog changes (e.g. adding new resource types shifts the
// spawner rng sequence per tile, changing which tree is "first").
const trees = gent.filter(e => e.id === 'tree');
trees.sort((a, b) => a.distTo(0, 0) - b.distTo(0, 0));
const tree = trees[0];
ok('at least one tree spawned', trees.length > 0);
ok('closest tree is within gather range (5)', tree && tree.distTo(0, 0) <= 5);
const invG = new Inventory();
invG.add('axe', 1);
invG.selectHotbar(0);

let lastEvent = null;
const gather = new Gather({
  entities: [tree],
  inventory: invG,
  range: 5,
  selectedItemProvider: () => {
    const s = invG.hotbarSelected();
    return s ? s.itemId : null;
  },
  onEvent: (n, p) => { if (n === 'complete') lastEvent = p; }
});

ok('gather click on tree starts gathering', (() => {
  gather.click(0, 0);
  return gather.state === 'gathering' && gather.target === tree;
})());

ok('after enough time, completes with toolUsed=axe', (() => {
  // harvestTime is 1.5s; run for 2s
  gather.update({ x: 0, y: 0 }, 2.0, 1000);
  return lastEvent != null && lastEvent.toolUsed === 'axe';
})());

ok('axe durability decreased by 1 after gather', invG.slots[0].durability === 49);
ok('axe not broken yet', invG.slots[0] != null);

// Wrong tool: pickaxe on tree should not consume durability
const invW = new Inventory();
invW.add('pickaxe', 1);
invW.selectHotbar(0);
let wrongEvent = null;
const tree2 = trees[1];
if (tree2) {
  const gatherW = new Gather({
    entities: [tree2],
    inventory: invW,
    range: 5,
    selectedItemProvider: () => 'pickaxe',
    onEvent: (n, p) => { if (n === 'complete') wrongEvent = p; }
  });
  gatherW.click(tree2.x, tree2.y);
  gatherW.update({ x: tree2.x, y: tree2.y }, 2.0, 2000);
  ok('wrong_tool still allows bare-handed harvest', wrongEvent != null);
  ok('wrong_tool does NOT consume pickaxe durability', invW.slots[0].durability === 50);
} else {
  ok('skipped: no second tree in range', true);
}

// Bare hands on berry_bush should not consume anything
const invB = new Inventory();
const berry = gent.find(e => e.id === 'berry_bush');
let berryEvent = null;
if (berry) {
  const gatherB = new Gather({
    entities: [berry],
    inventory: invB,
    range: 5,
    selectedItemProvider: () => null,
    onEvent: (n, p) => { if (n === 'complete') berryEvent = p; }
  });
  gatherB.click(berry.x, berry.y);
  gatherB.update({ x: berry.x, y: berry.y }, 1.0, 3000);
  ok('berry_bush harvestable bare hands', berryEvent != null);
  ok('berry_bush no tool used', berryEvent && berryEvent.toolUsed === null);
} else {
  ok('skipped: no berry_bush', true);
}

// Tool break mid-loop
const invBr = new Inventory({ onBreak: () => {} });
invBr.add('axe', 1);
invBr.slots[0].durability = 1;  // one use left
invBr.selectHotbar(0);
let brEvent = null;
const gatherBr = new Gather({
  entities: [tree],
  inventory: invBr,
  range: 5,
  selectedItemProvider: () => 'axe',
  onEvent: (n, p) => { if (n === 'complete') brEvent = p; }
});
// tree is already depleted from earlier test; re-create
const tree3 = new ResourceEntity({ id: 'tree', x: 0, y: 0, rngSeed: 99 });
gatherBr.entities = [tree3];
gatherBr.click(0, 0);
gatherBr.update({ x: 0, y: 0 }, 2.0, 4000);
ok('tool with 1 durability breaks on use', invBr.slots[0] === null);

// ---------- summary ----------
console.log();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
