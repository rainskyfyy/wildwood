/**
 * v0.7.0a — unit + integration tests for the three new services.
 *
 * Covers:
 *   - EventService: trigger / update / cancel / isActive / activeCount /
 *     getMonsterMultiplier / listPois / serialize / loadSnapshot
 *   - BuildingService: place / canPlace / remove / removeAt / findAt /
 *     damage / list / count / serialize / loadSnapshot
 *   - MonsterService: spawnOne / spawnDefaults / damage / kill / list /
 *     findNearest / visible / update (with event multiplier) /
 *     serialize / loadSnapshot
 *   - Coexistence: assembly 旧 Manager 字段(eventMgr / buildingMgr /
 *     monsterMgr)与新 svc 字段指向同一 Manager 实例。
 *
 * Run: `node tests/m7.0a-services.mjs`
 */
'use strict';

import { EventService, createEventService } from '../src/services/EventService.js';
import { BuildingService, createBuildingService } from '../src/services/BuildingService.js';
import { MonsterService, createMonsterService } from '../src/services/MonsterService.js';
import { EventManager } from '../src/events/event-manager.js';
import { EventRegistry } from '../src/events/events.js';
import { BuildingManager } from '../src/buildings/placer.js';
import { MonsterManager } from '../src/monster/monster-manager.js';
import monstersRaw from '../src/data/monsters.json' with { type: 'json' };

// ─── tiny test runner ────────────────────────────────────────
let pass = 0, fail = 0;
const log = [];
function it(name, fn) {
  try { fn(); pass++; log.push(`  ✓ ${name}`); }
  catch (e) {
    fail++;
    log.push(`  ✗ ${name}\n    ${e.message}\n${e.stack || ''}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} ${msg}`);
}
function ok(v, msg = '') { if (!v) throw new Error(`assertion failed ${msg}`); }
function near(a, b, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`expected ~${b}, got ${a}`);
}

// Minimal world stub — WorldGrid 的 isWalkable / getTile / idx / occupy / free
function makeWorld(w = 32, h = 24) {
  return {
    width: w, height: h,
    _occ: new Uint8Array(w * h),
    isWalkable(x, y) { return x >= 0 && y >= 0 && x < w && y < h; },
    getTile(x, y) { return 'plains'; },
    idx(x, y) { return y * w + x; },
    isOccupied(x, y) { return this._occ[this.idx(x, y)] !== 0; },
    occupy(x, y, eid) { this._occ[this.idx(x, y)] = eid; },
    free(x, y) { this._occ[this.idx(x, y)] = 0; }
  };
}

// EventRegistry helpers — by-id access (avoids numeric key confusion)
const EVENT_IDS = ['full_moon', 'meteor_shower', 'earthquake'];

// ═════════════════════════════════════════════════════════════
// 1. EventService
// ═════════════════════════════════════════════════════════════
console.log('\n── EventService ──');

it('constructs from a fresh world (no eventMgr reuse)', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  ok(svc.eventMgr instanceof EventManager);
  eq(svc.activeCount(), 0);
  ok(Array.isArray(svc.pois));
  eq(svc.pois.length, 0);
  ok(Array.isArray(svc.activeEffects));
  eq(svc.activeEffects.length, 0);
});

it('accepts an existing eventMgr (coexistence / pass-through)', () => {
  const world = makeWorld();
  const mgr = new EventManager({ world });
  const svc = new EventService({ eventMgr: mgr });
  ok(svc.eventMgr === mgr);
});

it('trigger / isActive / activeCount / listPois', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  const ok1 = svc.trigger(EVENT_IDS[0], 0);
  ok(ok1, `trigger returned false for ${EVENT_IDS[0]}`);
  ok(svc.isActive(EVENT_IDS[0]));
  eq(svc.activeCount(), 1);
  const before = svc.listPois();
  ok(Array.isArray(before));
  // Expire at far-future
  svc.update(1e15);
  eq(svc.activeCount(), 0);
  ok(!svc.isActive(EVENT_IDS[0]));
});

it('trigger with unknown id returns false', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  eq(svc.trigger('no-such-event-xyz', 0), false);
  eq(svc.activeCount(), 0);
});

it('getMonsterMultiplier defaults to {1, 1}', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  const m1 = svc.getMonsterMultiplier();
  eq(m1.atk, 1);
  eq(m1.speed, 1);
});

it('getMonsterMultiplier reflects active full_moon (atkMul=2, speedMul=1.2)', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  svc.trigger('full_moon', 0);
  const m = svc.getMonsterMultiplier();
  eq(m.atk, 2);
  near(m.speed, 1.2);
});

it('cancel() drains an active event', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  svc.trigger(EVENT_IDS[0], 0);
  eq(svc.activeCount(), 1);
  ok(svc.cancel());
  eq(svc.activeCount(), 0);
  // cancel on empty is a no-op
  eq(svc.cancel(), false);
});

it('serialize / loadSnapshot round-trips pois and counters', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  // Manually inject a POI to verify the snapshot round-trips.
  svc.pois.push({ id: 999, kind: 'meteor', x: 5, y: 7, itemId: 'iron_ore' });
  const snap = svc.serialize();
  eq(snap.schema, 1);
  eq(snap.pois.length, 1);
  eq(snap.pois[0].id, 999);
  // New svc, load the snapshot
  const svc2 = new EventService({ world });
  svc2.loadSnapshot(snap);
  eq(svc2.pois.length, 1);
  eq(svc2.pois[0].itemId, 'iron_ore');
});

it('loadSnapshot throws on bad schema', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  let threw = false;
  try { svc.loadSnapshot({ schema: 99 }); }
  catch (e) { threw = true; ok(/unsupported schema/.test(e.message)); }
  ok(threw, 'loadSnapshot should throw on bad schema');
});

it('createEventService factory works', () => {
  const svc = createEventService({ world: makeWorld() });
  ok(svc instanceof EventService);
});

// ═════════════════════════════════════════════════════════════
// 2. BuildingService
// ═════════════════════════════════════════════════════════════
console.log('\n── BuildingService ──');

it('constructs from a world', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  ok(svc.buildingMgr instanceof BuildingManager);
  eq(svc.count(), 0);
  ok(Array.isArray(svc.buildings));
});

it('accepts an existing buildingMgr (pass-through)', () => {
  const world = makeWorld();
  const mgr = new BuildingManager(world);
  const svc = new BuildingService({ world, buildingMgr: mgr });
  ok(svc.buildingMgr === mgr);
});

it('canPlace rejects unknown typeId and out-of-bounds', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r1 = svc.canPlace('nope-not-real', 0, 0, { x: 0, y: 0 });
  eq(r1.ok, false);
  ok(/unknown building/.test(r1.reason));
  const r2 = svc.canPlace('campfire', 999, 999, { x: 0, y: 0 });
  eq(r2.ok, false);
});

it('place returns {ok, building} or {ok:false, reason} without throwing', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  ok(r.ok, `place failed: ${r.reason}`);
  ok(r.building);
  eq(r.building.typeId, 'campfire');
  eq(svc.count(), 1);
  ok(world.isOccupied(5, 5));
});

it('place twice on the same tile fails with occupancy reason', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r1 = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  ok(r1.ok);
  const r2 = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  eq(r2.ok, false);
  ok(/occupied/.test(r2.reason));
});

it('remove / removeAt / findAt', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  const b = r.building;
  // findAt
  const f1 = svc.findAt(5, 5);
  ok(f1 === b);
  const f2 = svc.findAt(6, 6);
  eq(f2, null);
  // removeAt
  const removed = svc.removeAt(5, 5);
  ok(removed === b);
  eq(svc.count(), 0);
  ok(!world.isOccupied(5, 5));
  // Idempotent remove
  eq(svc.removeAt(5, 5), null);
  // remove with non-existent building
  eq(svc.remove(b), false);
});

it('damage destroys building at hp<=0; auto-removes', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  const b = r.building;
  ok(b.maxHp > 0);
  // Damage half — should still be alive
  const half = svc.damage(b, Math.floor(b.maxHp / 2));
  eq(half, null, 'should be alive at half hp');
  eq(svc.count(), 1);
  // Damage past max — should destroy
  const destroyed = svc.damage(b, b.maxHp + 1);
  ok(destroyed, 'should be destroyed at hp<=0');
  eq(svc.count(), 0);
  ok(!world.isOccupied(5, 5));
});

it('serialize / loadSnapshot round-trip re-occupies tiles', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const r = svc.place('campfire', 5, 5, { x: 5, y: 5 });
  const b = r.building;
  const snap = svc.serialize();
  eq(snap.schema, 1);
  eq(snap.buildings.length, 1);
  eq(snap.buildings[0].typeId, 'campfire');

  // Load into a fresh world
  const world2 = makeWorld();
  const svc2 = new BuildingService({ world: world2 });
  svc2.loadSnapshot(snap, world2);
  eq(svc2.count(), 1);
  ok(svc2.findAt(5, 5));
  ok(world2.isOccupied(5, 5));
});

it('loadSnapshot throws on bad schema', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  let threw = false;
  try { svc.loadSnapshot({ schema: 99 }, world); }
  catch (e) { threw = true; }
  ok(threw);
});

it('chebyshev is re-exported as static method', () => {
  eq(BuildingService.chebyshev(0, 0, 3, 4), 4);
});

it('createBuildingService factory works', () => {
  const svc = createBuildingService({ world: makeWorld() });
  ok(svc instanceof BuildingService);
});

// ═════════════════════════════════════════════════════════════
// 3. MonsterService
// ═════════════════════════════════════════════════════════════
console.log('\n── MonsterService ──');

it('constructs from monsterData', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 42 });
  ok(svc.monsterMgr instanceof MonsterManager);
  eq(svc.count(), 0);
});

it('accepts an existing monsterMgr (pass-through)', () => {
  const world = makeWorld();
  const mgr = new MonsterManager({ world, monsterData: monstersRaw, seed: 1 });
  const svc = new MonsterService({ monsterMgr: mgr });
  ok(svc.monsterMgr === mgr);
});

it('spawnOne returns a Monster and adds it to list', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  ok(ids.length > 0, 'monstersRaw should have at least one type');
  const m = svc.spawnOne(ids[0], 5.5, 5.5, 0);
  ok(m);
  ok(m.typeId === ids[0]);
  eq(svc.count(), 1);
  ok(svc.list().includes(m));
  // unknown typeId returns null
  eq(svc.spawnOne('zzz-unknown', 0, 0, 0), null);
});

it('damage reduces hp; kill() removes from list', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  const m = svc.spawnOne(ids[0], 1, 1, 0);
  const before = m.hp;
  const after = svc.damage(m, 1);
  eq(after, before - 1);
  // kill
  ok(svc.kill(m));
  eq(svc.count(), 0);
  // Idempotent kill
  eq(svc.kill(m), false);
});

it('findNearest prefers alive over dead and respects maxDist', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  // Use two different types so we can tell them apart.
  // a at (10, 10): Euclidean distance to (0,0) ≈ 14.14
  // b at (3, 3):   Euclidean distance to (0,0) ≈ 4.24
  const a = svc.spawnOne(ids[0], 10, 10, 0);
  const b = svc.spawnOne(ids[1] || ids[0], 3, 3, 1);
  // player at (0,0): b is closer, expect b.
  const near1 = svc.findNearest({ x: 0, y: 0 });
  ok(near1 === b, `expected b (closer), got ${near1 === a ? 'a' : 'neither'}`);
  // maxDist=4 (Euclidean): b at 4.24 is excluded, only a (14.14) is also excluded → null
  const near2 = svc.findNearest({ x: 0, y: 0 }, { maxDist: 4 });
  eq(near2, null, 'both monsters should be excluded by maxDist=4');
  // maxDist=5: b (4.24) included, a (14.14) excluded → b
  const near3 = svc.findNearest({ x: 0, y: 0 }, { maxDist: 5 });
  ok(near3 === b, 'b should be the only monster within maxDist=5');
  // kill b, then findNearest returns a
  svc.kill(b);
  const near4 = svc.findNearest({ x: 0, y: 0 });
  eq(near4, a);
});

it('update() applies event multiplier to every monster', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  const m = svc.spawnOne(ids[0], 5, 5, 0);
  const baseAtk = m.config?.atk || 1;
  const baseSpeed = m.config?.speed || 1;
  // default multiplier
  svc.update(0.016, { x: 0, y: 0 });
  eq(m.effectiveAtk, baseAtk);
  near(m.effectiveSpeed, baseSpeed, 1e-9);
  // 2x atk, 1.5x speed
  svc.update(0.016, { x: 0, y: 0 }, { atk: 2, speed: 1.5 });
  eq(m.effectiveAtk, baseAtk * 2);
  near(m.effectiveSpeed, baseSpeed * 1.5, 1e-9);
});

it('serialize / loadSnapshot round-trip preserves monster list', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 7 });
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  const m = svc.spawnOne(ids[0], 5.5, 5.5, 0);
  m.hp = 1; // pretend we damaged it
  const snap = svc.serialize();
  eq(snap.schema, 1);
  eq(snap.monsters.length, 1);
  eq(snap.monsters[0].typeId, ids[0]);
  // Load into a fresh svc
  const world2 = makeWorld();
  const svc2 = new MonsterService({ world: world2, monsterData: monstersRaw, seed: 7 });
  svc2.loadSnapshot(snap);
  eq(svc2.count(), 1);
  const m2 = svc2.list()[0];
  eq(m2.typeId, ids[0]);
  eq(m2.hp, 1);
});

it('loadSnapshot throws on bad schema', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  let threw = false;
  try { svc.loadSnapshot({ schema: 99 }); }
  catch (e) { threw = true; }
  ok(threw);
});

it('createMonsterService factory works', () => {
  const svc = createMonsterService({ world: makeWorld(), monsterData: monstersRaw, seed: 1 });
  ok(svc instanceof MonsterService);
});

// ═════════════════════════════════════════════════════════════
// 4. Coexistence — assembly layer old Manager fields point to
//    the same instance as the service's internal Manager
// ═════════════════════════════════════════════════════════════
console.log('\n── coexistence (assembly + service reference sharing) ──');

it('eventMgr pass-through shares the same EventManager as eventSvc', () => {
  const world = makeWorld();
  const svc = new EventService({ world });
  // Simulate assembly.js: `eventMgr = eventSvc.eventMgr`
  const eventMgr = svc.eventMgr;
  ok(eventMgr === svc.eventMgr);
  // Mutation through svc is observable via eventMgr
  svc.trigger('full_moon', 0);
  eq(eventMgr._active.length, 1);
});

it('buildingMgr pass-through shares the same BuildingManager as buildingSvc', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const buildingMgr = svc.buildingMgr;
  // svc.place should reflect on buildingMgr.buildings
  svc.place('campfire', 5, 5, { x: 5, y: 5 });
  eq(buildingMgr.buildings.length, 1);
  // svc.findAt and mgr.findAt should agree
  ok(svc.findAt(5, 5) === buildingMgr.buildings[0]);
});

it('monsterMgr pass-through shares the same MonsterManager as monsterSvc', () => {
  const world = makeWorld();
  const svc = new MonsterService({ world, monsterData: monstersRaw, seed: 1 });
  const monsterMgr = svc.monsterMgr;
  const ids = Object.keys(monstersRaw).filter(k => !k.startsWith('_'));
  svc.spawnOne(ids[0], 5, 5, 0);
  eq(monsterMgr.monsters.length, 1);
});

// ═════════════════════════════════════════════════════════════
// 5. mutation single entry — callers go through the service
// ═════════════════════════════════════════════════════════════
console.log('\n── mutation single entry (caller discipline) ──');

it('buildingMgr.place still throws (legacy path), buildingSvc.place is the safe path', () => {
  const world = makeWorld();
  const svc = new BuildingService({ world });
  const mgr = svc.buildingMgr;
  // The bare manager throws on invalid input — preserved for callers
  // that bypass svc (e.g. Multiplayer). svc.place() does not throw.
  let threw = false;
  try { mgr.place('nope-unknown', 0, 0, { x: 0, y: 0 }); }
  catch (e) { threw = true; }
  ok(threw, 'BuildingManager.place throws on unknown typeId (legacy)');
  // svc returns {ok:false, reason} — the safe path.
  const r = svc.place('nope-unknown', 0, 0, { x: 0, y: 0 });
  eq(r.ok, false);
  ok(r.reason);
});

// ═════════════════════════════════════════════════════════════
// Final report
// ═════════════════════════════════════════════════════════════
console.log('\n' + log.join('\n'));
console.log(`\nm7.0a services smoke: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
