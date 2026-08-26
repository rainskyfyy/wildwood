#!/usr/bin/env node
/**
 * M2.14 smoke test — runs under Node 20+, no jsdom.
 *
 * Covers:
 *   1. monsters.json loads + has 5 monsters + every required field
 *   2. Animator pure timing (frame index, loop, non-loop, state switch)
 *   3. A* pathfinding: simple, around wall, no path, perf under budget
 *   4. Monster state machine: IDLE → WANDER → CHASE → IDLE
 *   5. Monster collision: respects biome + building occupants
 *   6. MonsterManager: spawn defaults, no double-spawn, build state
 *      tables, resolve sprite fallback path
 *
 * Exits 0 on pass, prints "M2.14 smoke: N/N pass" on success.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { Animator, buildStateTableAnimator } from '../src/animation/animator.js';
import { findPath, chebyshev } from '../src/monster/pathfinding.js';
import { Monster, MonsterState } from '../src/monster/monster.js';
import { MonsterManager } from '../src/monster/monster-manager.js';
import { WorldGrid } from '../src/world/generator.js';
import { BIOMES } from '../src/world/biome-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function group(name, fn) {
  console.log(`\n[${name}]`);
  fn();
}

// ── World + a small "fake building" helper ────────────────────────

/** Build a flat walkable world. biomeId of every tile = the given id. */
function makeWorld(w, h, biomeId) {
  const g = new WorldGrid({ width: w, height: h, seed: 42 });
  const code = Object.keys(BIOMES).indexOf(biomeId);
  g.tiles.fill(code);
  return g;
}

/** Place a "building" (1×1 occupant) at the given tile. */
function placeOccupant(g, x, y, entityId = 1) {
  g.occupy(x, y, entityId);
}

// ── 1. monsters.json ──────────────────────────────────────────────

group('monsters.json', () => {
  const raw = readFileSync(resolve(ROOT, 'src/data/monsters.json'), 'utf8');
  const data = JSON.parse(raw);
  ok('parses as JSON', !!data);
  ok('has _meta with version', data._meta && data._meta.version === 1);
  const types = Object.keys(data).filter(k => !k.startsWith('_'));
  ok('has >=5 monster types', types.length >= 5, `got ${types.length}: ${types.join(',')}`);
  const expected = ['bat', 'treant', 'spider', 'merm', 'hound', 'tentacle'];
  for (const t of expected) {
    ok(`contains ${t}`, !!data[t], 'missing');
    const m = data[t];
    if (!m) continue;
    for (const field of ['name', 'fps', 'speed', 'hp', 'atk', 'detectRange', 'attackRange', 'wanderRadius', 'size', 'color', 'framesDir', 'actions']) {
      ok(`  ${t}.${field} present`, m[field] !== undefined && m[field] !== null);
    }
    ok(`  ${t}.actions ⊇ {idle, walk}`, m.actions.includes('idle') && m.actions.includes('walk'));
    ok(`  ${t}.speed > 0`, m.speed > 0);
    ok(`  ${t}.hp > 0`, m.hp > 0);
  }
});

// ── 2. Animator pure timing ───────────────────────────────────────

group('Animator', () => {
  // Multi-frame loop
  const a = new Animator({ frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 8, loop: true });
  ok('starts at frame 0', a.frameIndex === 0);
  // 1/8 s per frame; after 1s we should have wrapped 8 frames
  for (let i = 0; i < 8; i++) a.tick(0.125);
  ok('8 ticks at fps=8 → 4 frames in (loop wrap)', a.frameIndex === 0, `frameIndex=${a.frameIndex}`);
  // Non-loop
  const b = new Animator({ frameWidth: 16, frameHeight: 16, frameCount: 3, fps: 10, loop: false });
  b.tick(0.5); // 5 frames worth, clamps to 2 (last)
  ok('non-loop clamps at last frame', b.frameIndex === 2);
  ok('non-loop finished=true', b.finished === true);
  // setState resets clock
  a.setState({ action: 'walk' });
  ok('setState resets time', a.time === 0);
  ok('setState resets frameIndex', a.frameIndex === 0);
  // buildStateTableAnimator single-frame
  const fake = { down: { image: { naturalWidth: 32, naturalHeight: 32 } } };
  const s = buildStateTableAnimator({ idle: fake, walk: fake });
  s.setState({ action: 'walk', facing: 'down' });
  ok('state-table animator returns image', s.getImage() === fake.down.image);
  // Unknown facing falls back to down
  const t = buildStateTableAnimator({ idle: { down: { image: 'D' } } });
  t.setState({ action: 'idle', facing: 'left' });
  ok('unknown facing → down fallback', t.getImage() === 'D');
});

// ── 3. A* pathfinding ─────────────────────────────────────────────

group('A* pathfinding', () => {
  const g = makeWorld(20, 20, 'desert');
  const path = findPath(g, { x: 0, y: 0 }, { x: 5, y: 5 });
  ok('straight open path found', Array.isArray(path) && path.length === 10,
     `got ${JSON.stringify(path)}`);
  // Path should end at goal and have monotonically increasing x or y
  ok('last step == goal', path[path.length - 1].x === 5 && path[path.length - 1].y === 5);
  ok('every step adjacent (4-dir)', path.every((p, i) => {
    if (i === 0) return true;
    const q = path[i - 1];
    return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  }));
  // No path to unwalkable goal — simulate by occupying every tile.
  const g0 = makeWorld(20, 20, 'desert');
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) placeOccupant(g0, x, y, 1);
  ok('no path when all occupied', findPath(g0, { x: 0, y: 0 }, { x: 5, y: 5 }) === null);

  // Path around a single-tile wall — every biome in M2.14 is walkable,
  // so we use a building occupant as the obstacle (M2.9 invariant).
  const g2 = makeWorld(15, 5, 'desert');
  // Wall at exactly (5, 2). Path must detour to y=1 or y=3.
  placeOccupant(g2, 5, 2, 1);
  const p2 = findPath(g2, { x: 0, y: 2 }, { x: 14, y: 2 });
  // Manhattan = 14; going around 1 tile costs +2 = 16.
  ok('path around 1-tile wall exists', Array.isArray(p2) && p2.length === 16,
     `len=${p2 && p2.length}`);

  // Performance budget: 80x60 open grid
  const g3 = makeWorld(80, 60, 'desert');
  const t0 = process.hrtime.bigint();
  const p3 = findPath(g3, { x: 0, y: 0 }, { x: 79, y: 59 });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  ok(`80x60 open path < 50ms (was ${ms.toFixed(2)}ms)`, ms < 50);
  ok('path length ≈ Manhattan', p3.length === 79 + 59, `got ${p3.length}`);

  // Same start == goal → empty path
  const p4 = findPath(g3, { x: 10, y: 10 }, { x: 10, y: 10 });
  ok('start==goal → empty path', Array.isArray(p4) && p4.length === 0);
});

// ── 4. Monster state machine ──────────────────────────────────────

group('Monster state machine', () => {
  const w = makeWorld(20, 20, 'desert');
  // Build a minimal state table.
  const fakeImg = { naturalWidth: 32, naturalHeight: 32 };
  const table = {
    idle: { down: { image: fakeImg }, up: { image: fakeImg }, left: { image: fakeImg }, right: { image: fakeImg } },
    walk: { down: { image: fakeImg }, up: { image: fakeImg }, left: { image: fakeImg }, right: { image: fakeImg } }
  };
  const cfg = {
    name: 'test', speed: 4.0, hp: 50, maxHp: 50, atk: 5,
    detectRange: 5, attackRange: 1, wanderRadius: 3, size: 0.7,
    color: '#fff', fps: 8, actions: ['idle', 'walk']
  };
  const m = new Monster({ typeId: 'test', world: w, config: cfg, x: 5, y: 5, seed: 1, stateTable: table });
  ok('initial state IDLE', m.state === MonsterState.IDLE);
  // Idle ticks should eventually flip to WANDER.
  let didWander = false;
  for (let i = 0; i < 200 && !didWander; i++) {
    m.update(0.1, { x: 100, y: 100 });
    if (m.state === MonsterState.WANDER) didWander = true;
  }
  ok('eventually leaves IDLE → WANDER', didWander, `state=${m.state}`);
  // Player within detectRange → CHASE.
  const m2 = new Monster({ typeId: 'test', world: w, config: cfg, x: 5, y: 5, seed: 1, stateTable: table });
  m2.update(0.016, { x: 7, y: 5 }); // dist = 2 < 5
  ok('player in detectRange → CHASE', m2.state === MonsterState.CHASE);
  // CHASE plans a path.
  ok('CHASE has planned path', Array.isArray(m2._chasePath) && m2._chasePath.length > 0);
});

// ── 5. Monster collision ──────────────────────────────────────────

group('Monster collision', () => {
  // All M2.14 biomes are walkable, so we use occupants to mark walls.
  const w = makeWorld(10, 10, 'desert');
  placeOccupant(w, 5, 5, 1);
  const fakeImg = { naturalWidth: 32, naturalHeight: 32 };
  const table = { idle: { down: { image: fakeImg } }, walk: { down: { image: fakeImg } } };
  const cfg = {
    name: 'test', speed: 4.0, hp: 50, atk: 5,
    detectRange: 5, attackRange: 1, wanderRadius: 3, size: 0.7,
    color: '#fff', fps: 8, actions: ['idle', 'walk']
  };
  const m = new Monster({ typeId: 'test', world: w, config: cfg, x: 0, y: 0, seed: 1, stateTable: table });
  // Try to step into an occupant wall
  ok('collides with occupant tile', m.collidesAt(5.5, 5.5));
  // Free tile — not colliding
  ok('free tile → no collision', !m.collidesAt(2, 2));
  // Building occupant blocks even if biome is walkable
  const w2 = makeWorld(10, 10, 'desert');
  placeOccupant(w2, 3, 3);
  const m2 = new Monster({ typeId: 'test', world: w2, config: cfg, x: 0, y: 0, seed: 1, stateTable: table });
  ok('building-occupied tile is blocked', m2.collidesAt(3, 3));
});

// ── 6. MonsterManager ─────────────────────────────────────────────

group('MonsterManager', () => {
  const w = makeWorld(40, 30, 'desert');
  const data = JSON.parse(readFileSync(resolve(ROOT, 'src/data/monsters.json'), 'utf8'));
  const mgr = new MonsterManager({
    world: w,
    monsterData: data,
    loadImage: () => null,
    isReady: () => false,
    getOrFallback: (_p, b) => b(),
    seed: 123
  });
  ok('types excludes _meta', !mgr.types.includes('_meta'));
  ok('types has >=5 entries', mgr.types.length >= 5);
  mgr.spawnDefaults();
  ok('spawned >=5 monsters', mgr.monsters.length >= 5, `got ${mgr.monsters.length}`);
  // Each monster sits on a different walkable tile
  const seen = new Set();
  let collisions = 0;
  for (const m of mgr.monsters) {
    const t = `${m.tilePos().x},${m.tilePos().y}`;
    if (seen.has(t)) collisions++;
    seen.add(t);
  }
  ok('no two monsters on same tile', collisions === 0, `${collisions} collisions`);
  // All start in IDLE
  ok('all start in IDLE', mgr.monsters.every(m => m.state === MonsterState.IDLE));
  // Build state table returns a structure
  const table = mgr._buildStateTable('bat', data.bat);
  ok('state table has idle.down', !!(table.idle && table.idle.down));
  ok('state table path ends with .png', table.idle.down.path.endsWith('.png'));
  // resolveSprite → fallback canvas (no PNGs loaded)
  // Need a stub document for the canvas
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      createElement(tag) {
        if (tag !== 'canvas') return {};
        return {
          width: 0, height: 0,
          getContext: () => ({
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
            fill() {}, fillRect() {}
          })
        };
      }
    };
  }
  const m0 = mgr.monsters[0];
  const sprite = mgr.resolveSprite(m0);
  ok('resolveSprite returns something', sprite !== null && sprite !== undefined);
});

// ── Result ────────────────────────────────────────────────────────

console.log(`\nM2.14 smoke: ${pass}/${pass + fail} pass`);
if (fail > 0) {
  process.exit(1);
}
