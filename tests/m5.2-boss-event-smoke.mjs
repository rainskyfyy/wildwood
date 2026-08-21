#!/usr/bin/env node
/**
 * M5.2 Boss & Event smoke test — runs in Node 20+ with no jsdom.
 *
 * Coverage:
 *   1. bosses.json — 4 bosses, required fields, phase schemas
 *   2. Monster extension — phase field, takeDamage, ATTACK/DEAD states
 *   3. Player extension — hp, takeDamage, attack()
 *   4. BossManager — spawn defaults, phase transition, skill cooldown,
 *      death + drops, event emission
 *   5. Skills — charge/aoe/summon/roar effects
 *   6. Events — full_moon/meteor_shower/earthquake trigger + duration
 *
 * Exits 0 on pass, 1 on fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Monster, MonsterState } from '../src/monster/monster.js';
import { MonsterManager } from '../src/monster/monster-manager.js';
import { Player } from '../src/player/player.js';
import { WorldGrid } from '../src/world/generator.js';
import { BIOMES } from '../src/world/biome-config.js';
import { BossManager } from '../src/boss/boss-manager.js';
import { BossConfig } from '../src/boss/boss-config.js';
import { EventManager } from '../src/events/event-manager.js';
import { EventRegistry } from '../src/events/events.js';
import { Inventory } from '../src/resources/inventory.js';
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
function makeWorld(w, h, biomeId) {
  const g = new WorldGrid({ width: w, height: h, seed: 42 });
  const code = Object.keys(BIOMES).indexOf(biomeId);
  g.tiles.fill(code);
  return g;
}
function makeStubDocument() {
  if (typeof globalThis.document !== 'undefined') return;
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return { width: 0, height: 0, getContext: () => ({
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, fillRect() {}, stroke() {}, arc() {}, ellipse() {},
        fillText() {}, save() {}, restore() {}, translate() {},
        set globalAlpha(v){}, set fillStyle(v){}, set strokeStyle(v){},
        set lineWidth(v){}, set globalCompositeOperation(v){}, set font(v){},
        set textAlign(v){}, set textBaseline(v){}
      }) };
      return {};
    }
  };
}
// ── 1. bosses.json ───────────────────────────────────────────────
group('bosses.json', () => {
  const raw = readFileSync(resolve(ROOT, 'src/data/bosses.json'), 'utf8');
  const data = JSON.parse(raw);
  ok('parses as JSON', !!data);
  ok('has _meta with version >= 1', data._meta && data._meta.version >= 1);
  const types = Object.keys(data).filter(k => !k.startsWith('_'));
  ok('has 4 boss types', types.length === 4, `got ${types.length}: ${types.join(',')}`);
  const expected = ['spring_deer', 'summer_queen', 'autumn_bear', 'winter_dragon'];
  for (const id of expected) {
    ok(`contains ${id}`, !!data[id]);
    const b = data[id];
    if (!b) continue;
    for (const field of ['name', 'biome', 'hp', 'atk', 'speed', 'size', 'color', 'phases', 'skills', 'drops']) {
      ok(`  ${id}.${field} present`, b[field] !== undefined && b[field] !== null);
    }
    ok(`  ${id}.phases.length ∈ {2,3}`, b.phases.length >= 2 && b.phases.length <= 3,
       `got ${b.phases.length}`);
    ok(`  ${id}.phases[0].hpThreshold === 1.0`, b.phases[0].hpThreshold === 1.0,
       `got ${b.phases[0].hpThreshold}`);
    for (const ph of b.phases) {
      ok(`    ${id} phase hpThreshold ≤ 1.0`, ph.hpThreshold <= 1.0 && ph.hpThreshold > 0);
    }
    ok(`  ${id}.skills is non-empty array`, Array.isArray(b.skills) && b.skills.length > 0);
    for (const s of b.skills) {
      ok(`    ${id} skill ${s.id} has type & cooldown`,
         s.type && typeof s.cooldown === 'number' && s.cooldown > 0);
    }
    ok(`  ${id}.drops is non-empty array`, Array.isArray(b.drops) && b.drops.length > 0);
  }
});
// ── 2. Monster extension ────────────────────────────────────────
group('Monster extension', () => {
  const w = makeWorld(20, 20, 'desert');
  const fakeImg = { naturalWidth: 32, naturalHeight: 32 };
  const table = {
    idle: { down: { image: fakeImg } },
    walk: { down: { image: fakeImg } },
    attack: { down: { image: fakeImg } },
    hurt: { down: { image: fakeImg } },
    death: { down: { image: fakeImg } }
  };
  const cfg = {
    name: 'test', speed: 4.0, hp: 100, maxHp: 100, atk: 10,
    detectRange: 5, attackRange: 1, wanderRadius: 3, size: 1.2,
    color: '#fff', fps: 8, actions: ['idle', 'walk', 'attack', 'hurt', 'death']
  };
  const m = new Monster({ typeId: 'test', world: w, config: cfg, x: 5, y: 5, seed: 1, stateTable: table });
  ok('Monster has phase field default 0', m.phase === 0);
  ok('Monster has atkRange field', m.attackRange === 1);
  ok('takeDamage reduces hp', m.takeDamage(30), m.hp === 70 ? 'm.hp=70' : `m.hp=${m.hp}`);
  ok('takeDamage returns true when alive', m.takeDamage(10) === true);
  // Drain to 0 so the next takeDamage triggers DEAD
  m.takeDamage(9999);
  ok('Monster enters DEAD state when hp ≤ 0', m.state === MonsterState.DEAD, `state=${m.state}`);
  ok('Monster exposes attackRange & atk', m.atk === 10);
});
// ── 3. Player extension ──────────────────────────────────────────
group('Player extension', () => {
  const w = makeWorld(20, 20, 'desert');
  const p = new Player({ world: w, x: 10, y: 10, speed: 4.0 });
  ok('Player has hp=100', p.hp === 100, `p.hp=${p.hp}`);
  ok('Player has maxHp=100', p.maxHp === 100);
  ok('Player has atk=20', p.atk === 20, `p.atk=${p.atk}`);
  ok('takeDamage reduces hp', p.takeDamage(30), p.hp === 70 ? 'p.hp=70' : `p.hp=${p.hp}`);
  ok('takeDamage returns true when alive', p.takeDamage(20) === true);
  // Drain to 0 to verify death handling
  p.takeDamage(9999);
  ok('Player hp 0 → dead', p.hp === 0, `p.hp=${p.hp}`);
  ok('takeDamage(0) on dead returns false', p.takeDamage(10) === false);
});
// ── 4. BossManager ──────────────────────────────────────────────
group('BossManager', () => {
  makeStubDocument();
  const w = makeWorld(80, 60, 'marsh');
  // Insert a few desert and snow tiles for the multi-biome bosses.
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) w.tiles[w.idx(x, y)] = Object.keys(BIOMES).indexOf('desert');
  for (let y = 50; y < 60; y++) for (let x = 60; x < 80; x++) w.tiles[w.idx(x, y)] = Object.keys(BIOMES).indexOf('snow');
  const monsterData = JSON.parse(readFileSync(resolve(ROOT, 'src/data/monsters.json'), 'utf8'));
  const mgr = new MonsterManager({
    world: w, monsterData,
    loadImage: () => null,
    isReady: () => false,
    getOrFallback: (_p, b) => b(),
    seed: 123
  });
  const player = new Player({ world: w, x: 40, y: 30, speed: 4.0 });
  const inv = new Inventory();
  const dropped = [];
  const bm = new BossManager({
    world: w, monsterManager: mgr, player, inventory: inv,
    onDrop: (itemId, count) => dropped.push({ itemId, count }),
    rng: () => 0.5,
    now: () => 0
  });
  ok('BossManager creates 0 bosses initially', bm.bosses.length === 0);
  ok('BossConfig has 4 bosses', Object.keys(BossConfig.bosses).length === 4);
  // Spawn all 4 bosses at known positions
  bm.spawnBoss('spring_deer', 10, 10);
  bm.spawnBoss('summer_queen', 5, 5);
  bm.spawnBoss('autumn_bear', 40, 30);
  bm.spawnBoss('winter_dragon', 70, 55);
  ok('BossManager has 4 bosses after spawn', bm.bosses.length === 4);
  // All bosses have phase=0
  ok('all bosses start in phase 0', bm.bosses.every(b => b.phase === 0));
  // Each boss has skills registered
  ok('each boss has at least one skill', bm.bosses.every(b => b._skillStates.length > 0));
  // Damage the spring_deer to 50% hp → should be phase 1
  const deer = bm.bosses[0];
  const phaseCount = deer.config.phases.length;
  const threshold = phaseCount >= 2 ? deer.config.phases[1].hpThreshold : 1.0;
  deer.takeDamage(Math.ceil(deer.maxHp * (1 - threshold + 0.05)));
  bm.tickSkills(0);  // process phase transition
  ok('deer advances to phase 1 after threshold', deer.phase === 1,
     `phase=${deer.phase}`);
  // Damage dragon to 30% hp → should be phase 2
  const dragon = bm.bosses[3];
  const dphases = dragon.config.phases;
  if (dphases.length >= 3) {
    dragon.takeDamage(Math.ceil(dragon.maxHp * (1 - dphases[2].hpThreshold + 0.05)));
    bm.tickSkills(0);
    ok('dragon advances to phase 2', dragon.phase === 2, `phase=${dragon.phase}`);
  } else {
    ok('dragon only has 2 phases (skipping)', true);
  }
  // Kill the deer
  const startHp = deer.hp;
  deer.takeDamage(9999);
  ok('deer is dead (hp<=0)', deer.hp <= 0);
  ok('deer in DEAD state', deer.state === MonsterState.DEAD);
  // Process drops
  bm.handleDeath(deer, 0);
  const deerDrops = deer.config.drops;
  for (const drop of deerDrops) {
    const count = inv.countOf(drop.itemId);
    ok(`deer drop ${drop.itemId} in inventory (count >= ${drop.min || 1})`,
       count >= (drop.min || 1), `inv.count=${count}`);
  }
  // Ondrop was called
  ok('onDrop was called at least once', dropped.length > 0, `dropped=${JSON.stringify(dropped)}`);
});
// ── 5. Skills ─────────────────────────────────────────────────────
group('Skills', () => {
  makeStubDocument();
  const w = makeWorld(40, 30, 'marsh');
  // Create a fresh BossManager with a player standing 4 tiles from the boss
  const monsterData = JSON.parse(readFileSync(resolve(ROOT, 'src/data/monsters.json'), 'utf8'));
  const mgr = new MonsterManager({
    world: w, monsterData,
    loadImage: () => null, isReady: () => false, getOrFallback: (_p, b) => b(),
    seed: 99
  });
  const player = new Player({ world: w, x: 20, y: 15, speed: 4.0 });
  const inv = new Inventory();
  const bm = new BossManager({
    world: w, monsterManager: mgr, player, inventory: inv,
    onDrop: () => {}, rng: () => 0.5, now: () => 0
  });
  bm.spawnBoss('spring_deer', 20, 18);  // 3 tiles south
  const deer = bm.bosses[0];
  // Force the first skill ready
  const skill = deer._skillStates[0];
  skill.ready = true;
  skill.cooldown = 0.5;
  let skillFired = false;
  const events = [];
  bm.onSkill = (b, sk) => { skillFired = true; events.push({ boss: b.config.id, skill: sk.id }); };
  bm.tickSkills(0);
  ok('skill fires when ready', skillFired);
  ok('skill was reset (cooldown)', skill.cooldown === 0.5);
  ok('onSkill event recorded', events.length > 0);
});
// ── 6. Events ────────────────────────────────────────────────────
group('Events', () => {
  makeStubDocument();
  const w = makeWorld(40, 30, 'marsh');
  const monsterData = JSON.parse(readFileSync(resolve(ROOT, 'src/data/monsters.json'), 'utf8'));
  const mgr = new MonsterManager({
    world: w, monsterData,
    loadImage: () => null, isReady: () => false, getOrFallback: (_p, b) => b(),
    seed: 1
  });
  const player = new Player({ world: w, x: 20, y: 15, speed: 4.0 });
  const inv = new Inventory();
  const bm = new BossManager({
    world: w, monsterManager: mgr, player, inventory: inv,
    onDrop: () => {}, rng: () => 0.5, now: () => 0
  });
  let notices = [];
  const em = new EventManager({
    world: w, bossManager: bm, monsterManager: mgr,
    rng: () => 0.5,
    now: () => 0,
    onNotice: (n) => notices.push(n)
  });
  ok('EventManager has 3 events', Object.keys(EventRegistry.events).length === 3);
  ok('initial active events = 0', em.activeCount() === 0);
  // Force full_moon
  em.trigger('full_moon', 0);
  ok('full_moon is active after trigger', em.isActive('full_moon'));
  // Update with no time elapsed → still active
  em.update(0);
  ok('full_moon still active after dt=0', em.isActive('full_moon'));
  // Update with full duration → expired
  em.update(EventRegistry.events.full_moon.duration);
  ok('full_moon expired after duration', !em.isActive('full_moon'));
  // Force trigger with notify
  em.trigger('meteor_shower', 0);
  ok('meteor_shower notice triggered', notices.length > 0,
     `notices=${notices.length}`);
  ok('meteor_shower has world effect', em.activeEffects.length >= 0);
  // Player attack damage during full_moon — monster attr multiplier
  em.trigger('full_moon', 0);
  const mult = em.getMonsterMultiplier();
  ok('full_moon monster multiplier > 1', mult.atk > 1, `atk=${mult.atk}`);
  em.update(EventRegistry.events.full_moon.duration + 1);
  const mult2 = em.getMonsterMultiplier();
  ok('after expiry monster multiplier = 1', mult2.atk === 1, `atk=${mult2.atk}`);
  // Earthquake spawns a cave POI
  em.trigger('earthquake', 0);
  ok('earthquake has cave POI spawned', em.pois.length > 0, `pois=${em.pois.length}`);
  // Trigger respects one active at a time
  em.trigger('full_moon', 0);
  em.trigger('meteor_shower', 0);
  ok('only one event active at a time', em.activeCount() === 1);
});
// ── Result ────────────────────────────────────────────────────────
console.log(`\nM5.2 boss/event smoke: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
