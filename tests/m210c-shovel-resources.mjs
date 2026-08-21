#!/usr/bin/env node
/**
 * M2.10c shovel tool compat + new dig resources smoke test.
 *
 *   node tests/m210c-shovel-resources.mjs
 *
 * Covers:
 *   1. catalog: validateCatalog still passes with new resources / items
 *   2. checkTool returns 'compatible' for shovel + dirt_mound/sapling/carrot
 *   3. checkTool returns 'compatible' for shovel OR null + mushroom
 *   4. checkTool returns 'no_tool_required' for flower_patch / berry_bush
 *   5. Spawner produces all 4 biomes' resources including the new dig ones
 *   6. Resource-entity: dirt_mound / sapling / carrot / mushroom harvest
 *      correctly drops the new items (dirt, twine, carrot, mushroom)
 *   7. Gather integration: shovel on dirt_mound damages shovel by 1
 *   8. Gather integration: axe on dirt_mound does NOT damage the axe
 *      (resource is gathered bare-handed instead, as fallback)
 *   9. Gather integration: bare hands on mushroom does NOT damage anything
 *      but does still harvest
 */

import {
  validateCatalog, getItem, isTool, getToolType, getMaxDurability,
  checkTool, allowedTools, getResource
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
ok('validateCatalog passes (with new resources/items)', validateCatalog() === true);
ok('dirt item exists', getItem('dirt').name === '泥土');
ok('carrot item exists', getItem('carrot').name === '胡萝卜' && getItem('carrot').foodValue === 1);
ok('mushroom item exists', getItem('mushroom').name === '蘑菇' && getItem('mushroom').foodValue === 1);
ok('petals item exists', getItem('petals').name === '花瓣');
ok('dirt resource exists', getResource('dirt_mound').name === '土堆');
ok('sapling resource exists', getResource('sapling').name === '树苗');
ok('carrot resource exists', getResource('carrot').name === '胡萝卜');
ok('mushroom resource exists', getResource('mushroom').name === '蘑菇');
ok('flower_patch resource exists', getResource('flower_patch').name === '花丛');
ok('dirt_mound category=dig', getResource('dirt_mound').category === 'dig');
ok('flower_patch category=harvest', getResource('flower_patch').category === 'harvest');

// ---------- 2. shovel tool compat ----------
console.log('shovel tool compat');
ok('checkTool(dirt_mound, shovel) = compatible', checkTool('dirt_mound', 'shovel') === 'compatible');
ok('checkTool(dirt_mound, null) = tool_required', checkTool('dirt_mound', null) === 'tool_required');
ok('checkTool(dirt_mound, axe) = wrong_tool', checkTool('dirt_mound', 'axe') === 'wrong_tool');
ok('checkTool(dirt_mound, pickaxe) = wrong_tool', checkTool('dirt_mound', 'pickaxe') === 'wrong_tool');

ok('checkTool(sapling, shovel) = compatible', checkTool('sapling', 'shovel') === 'compatible');
ok('checkTool(sapling, null) = tool_required', checkTool('sapling', null) === 'tool_required');
ok('checkTool(sapling, axe) = wrong_tool', checkTool('sapling', 'axe') === 'wrong_tool');

ok('checkTool(carrot, shovel) = compatible', checkTool('carrot', 'shovel') === 'compatible');
ok('checkTool(carrot, null) = tool_required', checkTool('carrot', null) === 'tool_required');
ok('checkTool(carrot, axe) = wrong_tool', checkTool('carrot', 'axe') === 'wrong_tool');

ok('checkTool(mushroom, shovel) = compatible', checkTool('mushroom', 'shovel') === 'compatible');
ok('checkTool(mushroom, null) = no_tool_required', checkTool('mushroom', null) === 'no_tool_required');
ok('checkTool(mushroom, axe) = no_tool_required', checkTool('mushroom', 'axe') === 'no_tool_required');

ok('checkTool(flower_patch, null) = no_tool_required', checkTool('flower_patch', null) === 'no_tool_required');
ok('checkTool(flower_patch, shovel) = no_tool_required', checkTool('flower_patch', 'shovel') === 'no_tool_required');

// allowedTools()
ok('allowedTools(dirt_mound) = [shovel]', JSON.stringify(allowedTools('dirt_mound')) === '["shovel"]');
ok('allowedTools(mushroom) includes shovel and null',
   allowedTools('mushroom').includes('shovel') && allowedTools('mushroom').includes(null));
ok('allowedTools(unknown) = []', allowedTools('does_not_exist').length === 0);

// ---------- 3. spawner produces new resources ----------
console.log('spawner');
const w = generateWorld({ width: 60, height: 60, seed: 20260822 });
const allRes = spawnResources(w, { seed: 20260822 + 53 });
const byId = (id) => allRes.filter(e => e.id === id);
ok('plains spawns dirt_mound (forest/plains biome)', byId('dirt_mound').length > 0);
ok('forest spawns sapling', byId('sapling').length > 0);
ok('forest spawns carrot (forest/plains)', byId('carrot').length > 0);
ok('forest spawns mushroom (forest/mines)', byId('mushroom').length > 0);
ok('plains/forest spawns flower_patch', byId('flower_patch').length > 0);
ok('total entities > 0 (regression check)', allRes.length > 0);

// ---------- 4. resource-entity drops ----------
console.log('resource-entity drops');
const d = new ResourceEntity({ id: 'dirt_mound', x: 0, y: 0, rngSeed: 42 });
const dInv = new Inventory();
const dOut = d.harvest(dInv, 0);
ok('dirt_mound drop includes dirt', dOut.granted.some(g => g.itemId === 'dirt'));
ok('dirt_mound drops >= 2 dirt', dOut.granted.find(g => g.itemId === 'dirt').count >= 2);
ok('dirt_mound regrowTime = 60', d.regrowTime === 60);

const sa = new ResourceEntity({ id: 'sapling', x: 0, y: 0, rngSeed: 42 });
const saInv = new Inventory();
const saOut = sa.harvest(saInv, 0);
ok('sapling drop includes twine', saOut.granted.some(g => g.itemId === 'twine'));
ok('sapling regrowTime = 35', sa.regrowTime === 35);

const ca = new ResourceEntity({ id: 'carrot', x: 0, y: 0, rngSeed: 42 });
const caInv = new Inventory();
const caOut = ca.harvest(caInv, 0);
ok('carrot drop includes carrot', caOut.granted.some(g => g.itemId === 'carrot'));
ok('carrot regrowTime = 90', ca.regrowTime === 90);

const mu = new ResourceEntity({ id: 'mushroom', x: 0, y: 0, rngSeed: 42 });
const muInv = new Inventory();
const muOut = mu.harvest(muInv, 0);
ok('mushroom drop includes mushroom', muOut.granted.some(g => g.itemId === 'mushroom'));
ok('mushroom regrowTime = 110', mu.regrowTime === 110);

const fl = new ResourceEntity({ id: 'flower_patch', x: 0, y: 0, rngSeed: 42 });
const flInv = new Inventory();
const flOut = fl.harvest(flInv, 0);
ok('flower_patch drop includes petals', flOut.granted.some(g => g.itemId === 'petals'));
ok('flower_patch regrowTime = 40', fl.regrowTime === 40);

// ---------- 5. regrow works for new resources ----------
console.log('regrow new resources');
const r0 = new ResourceEntity({ id: 'carrot', x: 5, y: 5, rngSeed: 1 });
r0.harvest(new Inventory(), 1000);
ok('carrot visual after harvest = regrowing', r0.getVisualState() === 'regrowing');
ok('carrot regrowFraction = 0 at t0', r0.regrowFraction(1000) === 0);
r0.update(1000 + 90_000);
ok('carrot respawns after 90s', r0.depleted === false && r0.getVisualState() === 'full');

// RegrowManager works on the full set
const mgr = new RegrowManager({ entities: allRes });
const someNewRes = allRes.find(e => e.icon === 'dirt_mound' || e.icon === 'sapling'
                                  || e.icon === 'carrot' || e.icon === 'mushroom'
                                  || e.icon === 'flower_patch');
ok('RegrowManager has a new dig resource', someNewRes != null);
if (someNewRes) {
  someNewRes.harvest(new Inventory(), 0);
  const now = (someNewRes.regrowAt || 0) + 1;
  const respawned = mgr.update(now);
  ok('RegrowManager respawns the new resource', respawned.length >= 1 && respawned[0] === someNewRes);
}

// ---------- 6. gather: shovel on dirt_mound damages shovel ----------
console.log('gather shovel + new resources');
const dm = new ResourceEntity({ id: 'dirt_mound', x: 0, y: 0, rngSeed: 99 });
const invS = new Inventory();
invS.add('shovel', 1);
invS.selectHotbar(0);
let evtS = null;
const gatherS = new Gather({
  entities: [dm],
  inventory: invS,
  range: 5,
  selectedItemProvider: () => 'shovel',
  onEvent: (n, p) => { if (n === 'complete') evtS = p; }
});
gatherS.click(0, 0);
gatherS.update({ x: 0, y: 0 }, 1.5, 5000);
ok('shovel on dirt_mound completes', evtS != null);
ok('shovel on dirt_mound: toolUsed=shovel', evtS && evtS.toolUsed === 'shovel');
ok('shovel on dirt_mound: toolStatus=compatible', evtS && evtS.toolStatus === 'compatible');
ok('shovel durability decreased by 1', invS.slots[0].durability === 39);
ok('dirt added to inventory', invS.countOf('dirt') >= 2);

// ---------- 7. gather: axe on dirt_mound falls back to bare hands ----------
console.log('gather wrong tool = bare-handed');
const dm2 = new ResourceEntity({ id: 'dirt_mound', x: 0, y: 0, rngSeed: 7 });
const invA = new Inventory();
invA.add('axe', 1);
invA.selectHotbar(0);
let evtA = null;
const gatherA = new Gather({
  entities: [dm2],
  inventory: invA,
  range: 5,
  selectedItemProvider: () => 'axe',
  onEvent: (n, p) => { if (n === 'complete') evtA = p; }
});
gatherA.click(0, 0);
gatherA.update({ x: 0, y: 0 }, 1.5, 5000);
ok('axe on dirt_mound completes (bare-handed fallback)', evtA != null);
ok('axe on dirt_mound: toolStatus=wrong_tool', evtA && evtA.toolStatus === 'wrong_tool');
ok('axe on dirt_mound: toolUsed=null (axe NOT consumed)', evtA && evtA.toolUsed === null);
ok('axe durability NOT decreased (still 50)', invA.slots[0].durability === 50);
ok('dirt still added on bare-handed fallback', invA.countOf('dirt') >= 2);

// ---------- 8. gather: bare hands on mushroom works ----------
console.log('gather bare hands on mushroom');
const mu2 = new ResourceEntity({ id: 'mushroom', x: 0, y: 0, rngSeed: 1 });
const invB = new Inventory();
let evtB = null;
const gatherB = new Gather({
  entities: [mu2],
  inventory: invB,
  range: 5,
  selectedItemProvider: () => null,
  onEvent: (n, p) => { if (n === 'complete') evtB = p; }
});
gatherB.click(0, 0);
gatherB.update({ x: 0, y: 0 }, 1.0, 5000);
ok('bare hands on mushroom completes', evtB != null);
ok('bare hands on mushroom: toolStatus=no_tool_required', evtB && evtB.toolStatus === 'no_tool_required');
ok('bare hands on mushroom: toolUsed=null', evtB && evtB.toolUsed === null);
ok('mushroom added to inventory', invB.countOf('mushroom') >= 1);

// ---------- 9. gather: shovel on mushroom works too ----------
console.log('gather shovel on mushroom');
const mu3 = new ResourceEntity({ id: 'mushroom', x: 0, y: 0, rngSeed: 2 });
const invM = new Inventory();
invM.add('shovel', 1);
invM.selectHotbar(0);
let evtM = null;
const gatherM = new Gather({
  entities: [mu3],
  inventory: invM,
  range: 5,
  selectedItemProvider: () => 'shovel',
  onEvent: (n, p) => { if (n === 'complete') evtM = p; }
});
gatherM.click(0, 0);
gatherM.update({ x: 0, y: 0 }, 1.0, 5000);
ok('shovel on mushroom completes', evtM != null);
ok('shovel on mushroom: toolStatus=compatible', evtM && evtM.toolStatus === 'compatible');
ok('shovel durability decreased', invM.slots[0].durability === 39);
ok('mushroom added via shovel', invM.countOf('mushroom') >= 1);

// ---------- 10. inventory can hold the new items ----------
console.log('inventory new items');
const invNew = new Inventory();
invNew.add('dirt', 10);
invNew.add('carrot', 5);
invNew.add('mushroom', 7);
invNew.add('petals', 12);
ok('countOf(dirt)=10', invNew.countOf('dirt') === 10);
ok('countOf(carrot)=5', invNew.countOf('carrot') === 5);
ok('countOf(mushroom)=7', invNew.countOf('mushroom') === 7);
ok('countOf(petals)=12', invNew.countOf('petals') === 12);

// Tools do not merge, but new materials do stack
ok('dirt stacks 10 into 1 slot (cap 20)', (() => {
  let n = 0;
  for (const s of invNew.slots) if (s && s.itemId === 'dirt') { n++; }
  return n === 1;
})());

// Serialize/load v=2 still works with new items
ok('serialize + loadSnapshot preserves new items', (() => {
  const t = new Inventory();
  t.add('dirt', 5);
  t.add('carrot', 3);
  t.add('shovel', 1);
  const snap = t.serialize();
  const r = new Inventory();
  r.loadSnapshot(snap);
  return r.countOf('dirt') === 5 && r.countOf('carrot') === 3
      && r.slots.find(s => s && s.itemId === 'shovel').durability === 40;
})());

// ---------- summary ----------
console.log();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
