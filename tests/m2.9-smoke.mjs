#!/usr/bin/env node
/**
 * M2.9 smoke test — building system.
 *
 * Validates:
 *   1. building-config: catalog has 5 buildings, buildOrder matches,
 *      every building has the required fields.
 *   2. WorldGrid.occupants: occupy / free / isOccupied / isWalkable
 *      integrate with biome walkability.
 *   3. placer.canPlace: rejects out-of-bounds, occupied, unwalkable,
 *      and out-of-range; accepts in-range walkable empty tiles.
 *   4. placer.place: marks all footprint tiles occupied, registers
 *      a Building, increases count.
 *   5. placer.remove: frees footprint tiles, removes from list.
 *   6. chebyshev distance: simple math sanity.
 *
 * No DOM required — building-renderer.js and building-menu.js are
 * skipped (they need canvas).
 *
 * Run: node tests/m2.9-smoke.mjs
 */

import { generateWorld } from '../src/world/generator.js';
import {
  getBuildings, getBuilding, getBuildingMenuOrder, getBuildingCount
} from '../src/buildings/building-config.js';
import {
  BuildingManager, chebyshev, _resetEntityIds
} from '../src/buildings/placer.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ''}`); }
}

// 1. building-config — catalog shape
console.log('building-config');
const cat = getBuildings();
ok('catalog version=1', cat.version === 1);
ok('buildOrder has 5 entries', cat.buildOrder.length === 5,
   `got ${cat.buildOrder.length}`);
ok('buildOrder = [campfire, science_machine, chest, wall, floor]',
   JSON.stringify(cat.buildOrder) === JSON.stringify(
     ['campfire', 'science_machine', 'chest', 'wall', 'floor']
   ));
ok('building count == 5', getBuildingCount() === 5);
const expectedIds = ['campfire', 'science_machine', 'chest', 'wall', 'floor'];
for (const id of expectedIds) {
  const def = getBuilding(id);
  ok(`getBuilding(${id}) exists`, !!def);
  ok(`${id}.name is non-empty string`, typeof def.name === 'string' && def.name.length > 0);
  ok(`${id}.size is [w,h] with positive ints`,
     Array.isArray(def.size) && def.size.length === 2
     && def.size[0] >= 1 && def.size[1] >= 1
     && Number.isInteger(def.size[0]) && Number.isInteger(def.size[1]),
     JSON.stringify(def.size));
  ok(`${id}.hp > 0`, def.hp > 0, `hp=${def.hp}`);
  ok(`${id}.cost is non-empty object`, def.cost && Object.keys(def.cost).length > 0);
  for (const [k, v] of Object.entries(def.cost)) {
    ok(`${id}.cost.${k} > 0`, v > 0, `${k}=${v}`);
  }
  ok(`${id}.color is hex`, /^#[0-9a-f]{6}$/i.test(def.color), def.color);
  ok(`${id}.outline is hex`, /^#[0-9a-f]{6}$/i.test(def.outline), def.outline);
  ok(`${id}.description non-empty`, typeof def.description === 'string' && def.description.length > 0);
  ok(`${id}.tags is array`, Array.isArray(def.tags) && def.tags.length > 0);
}
ok('menu order returns 5 defs', getBuildingMenuOrder().length === 5);
ok('getBuilding(unknown) === null', getBuilding('not_a_building') === null);

// 2. chebyshev
console.log('chebyshev');
ok('chebyshev same point = 0', chebyshev(5, 5, 5, 5) === 0);
ok('chebyshev axis = 1', chebyshev(5, 5, 6, 5) === 1);
ok('chebyshev diagonal = 3', chebyshev(0, 0, 3, 3) === 3);
ok('chebyshev mixed = max(|3|,|3|) = 3', chebyshev(2, 7, 5, 10) === 3);
ok('chebyshev L-shaped = max(|5|,|1|) = 5', chebyshev(0, 0, 5, 1) === 5);

// 3. WorldGrid.occupants
console.log('WorldGrid.occupants');
_resetEntityIds();
const world = generateWorld({ width: 30, height: 20, seed: 42 });
ok('occupants array initialized', world.occupants instanceof Uint8Array);
ok('occupants length = width*height',
   world.occupants.length === world.width * world.height,
   `${world.occupants.length} vs ${world.width * world.height}`);
ok('all occupants start at 0', world.occupants.every(v => v === 0));
ok('isOccupied returns false for empty tile', !world.isOccupied(5, 5));
ok('occupy sets tile', world.occupy(5, 5, 7) && world.occupants[world.idx(5, 5)] === 7);
ok('isOccupied returns true after occupy', world.isOccupied(5, 5));
ok('isWalkable returns false for occupied walkable tile',
   !world.isWalkable(5, 5));
ok('isOccupied out of bounds returns false', !world.isOccupied(-1, 0));
ok('occupy out of bounds returns false', !world.occupy(-1, 0, 1));
ok('free clears tile', world.free(5, 5) && world.occupants[world.idx(5, 5)] === 0);
ok('isWalkable returns true again after free',
   world.isWalkable(5, 5));

// 4. placer.canPlace — valid placements
console.log('placer.canPlace');
const mgr = new BuildingManager(world);
const player = { x: 10, y: 10 };
// Player position is (10,10) on tile (10,10). Range 2 → valid for (8..12, 8..12).
const valid = mgr.canPlace('campfire', 11, 11, player, 2);
ok('canPlace valid tile (11,11) in range', valid.ok, JSON.stringify(valid));
const valid2 = mgr.canPlace('campfire', 8, 10, player, 2);
ok('canPlace valid tile (8,10) at range edge', valid2.ok, JSON.stringify(valid2));
const valid3 = mgr.canPlace('campfire', 12, 8, player, 2);
ok('canPlace valid tile (12,8) at range corner', valid3.ok, JSON.stringify(valid3));

// 5. placer.canPlace — invalid placements
console.log('placer.canPlace (invalid)');
const outOfRange = mgr.canPlace('campfire', 5, 5, player, 2);
ok('rejects tile out of range (5,5)', !outOfRange.ok,
   `reason=${outOfRange.reason}`);
const outOfBounds = mgr.canPlace('campfire', -1, 5, player, 2);
ok('rejects tile out of bounds (-1,5)', !outOfBounds.ok,
   `reason=${outOfBounds.reason}`);
const footprintOOB = mgr.canPlace('science_machine', 28, 5, player, 2);
ok('rejects 2x1 footprint out of bounds (28,5)',
   !footprintOOB.ok, `reason=${footprintOOB.reason}`);
const badType = mgr.canPlace('not_real', 11, 11, player, 2);
ok('rejects unknown building type', !badType.ok,
   `reason=${badType.reason}`);

// 6. placer.place
console.log('placer.place');
_resetEntityIds();
const mgr2 = new BuildingManager(world);
const b1 = mgr2.place('campfire', 11, 11, player);
ok('place returns Building instance', b1 instanceof Object);
ok('placed building id = campfire', b1.id === 'campfire');
ok('placed at (11,11)', b1.tx === 11 && b1.ty === 11);
ok('placed size = [1,1]', b1.w === 1 && b1.h === 1);
ok('placed hp = 30 (campfire)', b1.hp === 30 && b1.maxHp === 30);
ok('building count = 1', mgr2.count() === 1);
ok('tile (11,11) is now occupied', world.isOccupied(11, 11));
ok('tile (11,11) is not walkable', !world.isWalkable(11, 11));

// 7. Cannot place on occupied tile
const conflict = mgr2.canPlace('campfire', 11, 11, player, 2);
ok('cannot place on occupied tile', !conflict.ok,
   `reason=${conflict.reason}`);

// 8. 2x1 building (science_machine)
_resetEntityIds();
const mgr3 = new BuildingManager(world);
const b2 = mgr3.place('science_machine', 11, 11, player);
ok('2x1 footprint placed (2 tiles occupied)',
   world.isOccupied(11, 11) && world.isOccupied(12, 11),
   `${world.isOccupied(11, 11)},${world.isOccupied(12, 11)}`);
ok('2x1 building w=2, h=1', b2.w === 2 && b2.h === 1);

// 9. placer.remove
console.log('placer.remove');
const removed = mgr2.remove(b1);
ok('remove returns true', removed === true);
ok('building count back to 0', mgr2.count() === 0);
ok('tile (11,11) freed', !world.isOccupied(11, 11));
ok('tile (11,11) walkable again', world.isWalkable(11, 11));
const removedAgain = mgr2.remove(b1);
ok('remove on already-removed returns false', removedAgain === false);

// 10. damage & auto-remove
console.log('damage');
_resetEntityIds();
const mgr4 = new BuildingManager(world);
const b3 = mgr4.place('wall', 11, 11, player); // hp=100
ok('wall hp=100', b3.hp === 100);
const dead = mgr4.damage(b3, 60);
ok('damage 60 → still alive, returns null', dead === null);
ok('wall hp now 40', b3.hp === 40);
const killed = mgr4.damage(b3, 50);
ok('damage 50 more → killed, returns building', killed === b3);
ok('count after kill = 0', mgr4.count() === 0);
ok('tile freed after kill', !world.isOccupied(11, 11));

// 11. Building.contains
console.log('Building.contains');
_resetEntityIds();
const mgr5 = new BuildingManager(world);
const b4 = mgr5.place('science_machine', 11, 11, player);
ok('2x1 contains (11,11)', b4.contains(11, 11));
ok('2x1 contains (12,11)', b4.contains(12, 11));
ok('2x1 NOT contains (13,11)', !b4.contains(13, 11));
ok('2x1 NOT contains (10,11)', !b4.contains(10, 11));
ok('2x1 NOT contains (11,12)', !b4.contains(11, 12));
const c = b4.center();
ok('center is (12, 11.5)', c.x === 12 && c.y === 11.5,
   `(${c.x},${c.y})`);

// Summary
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
