/**
 * v0.5.1 ecology smoke tests (Node ESM).
 *
 * Run with:  node tests/v051-ecology-smoke.mjs
 *
 * Coverage:
 *   - 6-biome radial layout: forest at center, plains ring, 4 extremes at corners
 *   - pickBiomeRadial returns valid biome ids for all quadrants
 *   - Population tick: logistic growth, predation loss applied correctly
 *   - FoodChain.computePredation: foxes eat rabbits, wolves eat foxes
 *   - EcologyManager end-to-end: initialize → tick × N → populations stable
 *   - EcologyMonster state transitions: rabbit FLEEs from fox, fox HUNTS rabbit
 *
 * All tests are deterministic — no Math.random; a fixed mulberry32
 * is passed into Population + EcologyManager.
 */

import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

// Stub minimal DOM globals so the ecology / monster modules import
// cleanly. They only touch document.createElement inside
// _proceduralFallback, which we never call in tests.
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };

const { generateWorld, findBiomeCenter } = await import(`file://${ROOT}/src/world/generator.js`);
const { pickBiomeRadial, getBiome, BIOMES } = await import(`file://${ROOT}/src/world/biome-config.js`);
const { Population } = await import(`file://${ROOT}/src/ecology/population.js`);
const { FoodChain } = await import(`file://${ROOT}/src/ecology/food-chain.js`);
const { EcologyManager } = await import(`file://${ROOT}/src/ecology/ecology.js`);

const ecologyJson = JSON.parse(
  readFileSync(`${ROOT}/src/data/ecology.json`, 'utf8')
);
const ecologyMonstersJson = JSON.parse(
  readFileSync(`${ROOT}/src/data/ecology-monsters.json`, 'utf8')
);

let testCount = 0, passCount = 0;
function it(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
    process.exitCode = 1;
  }
}
function group(name, fn) {
  console.log(`\n[${name}]`);
  fn();
}

// Deterministic LCG rng for tests.
function detRng() {
  let s = 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

// ── 6-biome radial layout ──────────────────────────────────────
group('6-biome radial layout', () => {
  it('BIOMES has 6 entries: forest, plains, desert, marsh, snow, volcano', () => {
    const ids = Object.keys(BIOMES);
    assert.deepEqual(ids, ['forest', 'plains', 'desert', 'marsh', 'snow', 'volcano']);
  });

  it('generateWorld({layout: "radial"}) defaults to radial and creates 80x60 grid', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    assert.equal(w.width, 80);
    assert.equal(w.height, 60);
    assert.equal(w.tiles.length, 80 * 60);
  });

  it('center tile (40, 30) is forest', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const biome = w.getTile(40, 30);
    assert.equal(biome, 'forest');
  });

  it('corner (5, 5) belongs to one of the 4 extreme biomes', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const biome = w.getTile(5, 5);
    assert.ok(['desert', 'marsh', 'snow', 'volcano'].includes(biome),
      `expected extreme biome, got ${biome}`);
  });

  it('corner (75, 5) (top-right) is snow or volcano', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const biome = w.getTile(75, 5);
    assert.ok(biome === 'snow' || biome === 'volcano',
      `expected snow/volcano, got ${biome}`);
  });

  it('pickBiomeRadial returns valid biome id for every (x, y) on 80x60', () => {
    const ids = new Set(Object.keys(BIOMES));
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        const id = pickBiomeRadial(x, y, 80, 60);
        assert.ok(ids.has(id), `bad id at (${x},${y}): ${id}`);
      }
    }
  });

  it('findBiomeCenter("forest") returns a forest tile with size > 0', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const c = findBiomeCenter(w, 'forest');
    assert.ok(c.size > 0, 'forest center not found');
    assert.equal(w.getTile(c.x, c.y), 'forest');
  });

  it('radial layout has all 6 biomes present', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const seen = new Set();
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        seen.add(w.getTile(x, y));
      }
    }
    for (const id of ['forest', 'plains', 'desert', 'marsh', 'snow', 'volcano']) {
      assert.ok(seen.has(id), `${id} missing from radial layout`);
    }
  });

  it('legacy layout still produces 4 biomes', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822, layout: 'legacy' });
    const seen = new Set();
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        seen.add(w.getTile(x, y));
      }
    }
    for (const id of ['desert', 'marsh', 'snow', 'volcano']) {
      assert.ok(seen.has(id), `${id} missing from legacy layout`);
    }
  });
});

// ── Population model ───────────────────────────────────────────
group('Population model', () => {
  it('initial count is clamped to [0, capacity]', () => {
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: 100, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() });
    assert.equal(p.count, 12);
  });

  it('negative initial is clamped to 0', () => {
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: -5, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() });
    assert.equal(p.count, 0);
  });

  it('logistic growth: count grows toward K when below', () => {
    // High birthRate so growth is visible even at low N.
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: 4, capacity: 12, birthRate: 0.5, deathRate: 0.01, rng: detRng() });
    const c0 = p.count;
    for (let i = 0; i < 50; i++) p.tick(0);
    assert.ok(p.count > c0, `expected growth, got ${c0} → ${p.count}`);
    assert.ok(p.count <= 12, `count must not exceed K, got ${p.count}`);
  });

  it('overpopulation: initial above K is clamped to K', () => {
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: 8, capacity: 4, birthRate: 0.10, deathRate: 0.01, rng: detRng() });
    assert.equal(p.count, 4); // clamped
  });

  it('predation loss is subtracted from N', () => {
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: 10, capacity: 20, birthRate: 0.10, deathRate: 0.01, rng: detRng() });
    const c0 = p.count;
    const result = p.tick(3);
    assert.equal(result.predationLoss, 3);
    assert.equal(p.count, c0 - 3);
  });

  it('extinct bucket: tick(0) returns zero deltas', () => {
    const p = new Population({ biome: 'forest', species: 'wolf', initial: 0, capacity: 1, birthRate: 0.10, deathRate: 0.01, rng: detRng() });
    const r = p.tick(0);
    assert.equal(r.delta, 0);
    assert.equal(p.count, 0);
  });

  it('snapshot has all expected fields', () => {
    const p = new Population({ biome: 'forest', species: 'rabbit', initial: 5, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() });
    const s = p.snapshot();
    assert.equal(s.biome, 'forest');
    assert.equal(s.species, 'rabbit');
    assert.equal(s.count, 5);
    assert.equal(s.capacity, 12);
  });
});

// ── Food chain ─────────────────────────────────────────────────
group('Food chain', () => {
  it('foxes eat rabbits (eatenBy rabbit contains fox)', () => {
    const fc = new FoodChain(ecologyJson);
    const preds = fc.getPredators('rabbit');
    assert.ok(preds.includes('fox'));
  });

  it('wolves eat foxes (eatenBy fox contains wolf)', () => {
    const fc = new FoodChain(ecologyJson);
    const preds = fc.getPredators('fox');
    assert.ok(preds.includes('wolf'));
  });

  it('wolf has no predators (top of chain)', () => {
    const fc = new FoodChain(ecologyJson);
    const preds = fc.getPredators('wolf');
    assert.equal(preds.length, 0);
  });

  it('computePredation: 5 foxes in forest kills some rabbits', () => {
    const fc = new FoodChain(ecologyJson);
    const pops = new Map();
    pops.set('forest|rabbit', new Population({ biome: 'forest', species: 'rabbit', initial: 10, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() }));
    pops.set('forest|fox',    new Population({ biome: 'forest', species: 'fox',    initial: 5,  capacity: 5,  birthRate: 0.015, deathRate: 0.01, rng: detRng() }));
    const losses = fc.computePredation(pops);
    const loss = losses.get('forest|rabbit') || 0;
    // 5 foxes * 0.30 eff * preyRatio(10 rabbits / 6 = 1, capped) = 1.5 → 1
    assert.ok(loss > 0, `expected fox → rabbit kills > 0, got ${loss}`);
  });

  it('computePredation: zero prey → zero loss', () => {
    const fc = new FoodChain(ecologyJson);
    const pops = new Map();
    pops.set('forest|rabbit', new Population({ biome: 'forest', species: 'rabbit', initial: 0, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() }));
    pops.set('forest|fox',    new Population({ biome: 'forest', species: 'fox',    initial: 5,  capacity: 5,  birthRate: 0.015, deathRate: 0.01, rng: detRng() }));
    const losses = fc.computePredation(pops);
    assert.equal(losses.get('forest|rabbit') || 0, 0);
  });

  it('wolf predation cascades: fox → rabbit both pressured', () => {
    // Bump wolf count to 4 (test fixture, not production config).
    const fc = new FoodChain(ecologyJson);
    const pops = new Map();
    pops.set('forest|rabbit', new Population({ biome: 'forest', species: 'rabbit', initial: 10, capacity: 12, birthRate: 0.04, deathRate: 0.02, rng: detRng() }));
    pops.set('forest|fox',    new Population({ biome: 'forest', species: 'fox',    initial: 3,  capacity: 3,  birthRate: 0.015, deathRate: 0.01, rng: detRng() }));
    pops.set('forest|wolf',   new Population({ biome: 'forest', species: 'wolf',   initial: 4,  capacity: 4,  birthRate: 0.005, deathRate: 0.008, rng: detRng() }));
    const losses = fc.computePredation(pops);
    assert.ok((losses.get('forest|rabbit') || 0) > 0, 'wolves should also pressure rabbits');
    assert.ok((losses.get('forest|fox')    || 0) > 0, 'wolves should pressure foxes');
  });
});

// ── EcologyManager integration ─────────────────────────────────
group('EcologyManager integration', () => {
  it('initializes populations for every biome×species with K>0', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const m = new EcologyManager({
      world: w,
      ecologyData: ecologyJson,
      ecologyMonsters: ecologyMonstersJson,
      loadImage: () => null,
      isReady: () => false,
      getOrFallback: (_p, b) => b(),
      seed: 20260822
    });
    m.initialize();
    assert.ok(m.populations.size > 0);
    assert.ok(m.populations.has('forest|rabbit'));
    assert.ok(m.populations.has('plains|rabbit'));
    assert.ok(m.populations.has('forest|fox'));
  });

  it('produces initial entities for visible populations', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const m = new EcologyManager({
      world: w,
      ecologyData: ecologyJson,
      ecologyMonsters: ecologyMonstersJson,
      loadImage: () => null,
      isReady: () => false,
      getOrFallback: (_p, b) => b(),
      seed: 20260822
    });
    m.initialize();
    assert.ok(m.entities.length > 0, `expected entities, got ${m.entities.length}`);
    for (const e of m.entities.slice(0, 20)) {
      assert.ok(w.isWalkable(Math.floor(e.x), Math.floor(e.y)),
        `entity ${e.typeId} spawned on unwalkable tile (${e.x}, ${e.y})`);
    }
  });

  it('100 ticks keep populations bounded (no NaN, no runaway)', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const m = new EcologyManager({
      world: w,
      ecologyData: ecologyJson,
      ecologyMonsters: ecologyMonstersJson,
      loadImage: () => null,
      isReady: () => false,
      getOrFallback: (_p, b) => b(),
      seed: 20260822
    });
    m.initialize();
    const dummyPlayer = { x: 40, y: 30 };
    for (let i = 0; i < 100; i++) m.update(0.5, dummyPlayer);
    const snap = m.snapshot();
    for (const s of snap) {
      assert.ok(Number.isFinite(s.count), `non-finite count for ${s.biome}|${s.species}: ${s.count}`);
      assert.ok(s.count >= 0, `negative count for ${s.biome}|${s.species}: ${s.count}`);
      assert.ok(s.count <= s.capacity, `count exceeds K for ${s.biome}|${s.species}: ${s.count} > ${s.capacity}`);
    }
  });

  it('entity counts: forest rabbit population remains > 0 after 200 ticks', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const m = new EcologyManager({
      world: w,
      ecologyData: ecologyJson,
      ecologyMonsters: ecologyMonstersJson,
      loadImage: () => null,
      isReady: () => false,
      getOrFallback: (_p, b) => b(),
      seed: 20260822
    });
    m.initialize();
    const dummyPlayer = { x: 40, y: 30 };
    for (let i = 0; i < 200; i++) m.update(0.5, dummyPlayer);
    const forestRabbit = m.populations.get('forest|rabbit');
    assert.ok(forestRabbit, 'forest rabbit population missing');
    assert.ok(forestRabbit.count > 0, `forest rabbits went extinct in 200 ticks`);
  });

  it('snapshot has at least forest and plains biomes represented', () => {
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const m = new EcologyManager({
      world: w,
      ecologyData: ecologyJson,
      ecologyMonsters: ecologyMonstersJson,
      loadImage: () => null,
      isReady: () => false,
      getOrFallback: (_p, b) => b(),
      seed: 20260822
    });
    m.initialize();
    const snap = m.snapshot();
    const biomes = new Set(snap.map(s => s.biome));
    assert.ok(biomes.has('forest'));
    assert.ok(biomes.has('plains'));
  });
});

// ── EcologyMonster state machine ───────────────────────────────
group('EcologyMonster state machine', () => {
  it('rabbit enters FLEE when fox is within detectRange', async () => {
    const { EcologyMonster } = await import(`file://${ROOT}/src/monster/ecology-monster.js`);
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    assert.equal(w.getTile(40, 30), 'forest');
    const rabbit = new EcologyMonster({
      typeId: 'rabbit', world: w, config: ecologyMonstersJson.rabbit,
      x: 40, y: 30, diet: [], threats: ['fox', 'wolf'], trophic: 'grazer',
      findNearest: (species, maxDist) => species === 'fox' ? { x: 41, y: 30 } : null,
      findFleeTarget: () => ({ x: 39, y: 30 })
    });
    rabbit.update(0.1, { x: 50, y: 50 });
    assert.equal(rabbit.state, 'flee');
  });

  it('fox enters HUNT when rabbit is within detectRange', async () => {
    const { EcologyMonster } = await import(`file://${ROOT}/src/monster/ecology-monster.js`);
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const fox = new EcologyMonster({
      typeId: 'fox', world: w, config: ecologyMonstersJson.fox,
      x: 40, y: 30, diet: ['rabbit'], threats: ['wolf'], trophic: 'predator',
      findNearest: (species, maxDist) => species === 'rabbit' ? { x: 41, y: 30 } : null,
      findFleeTarget: () => null
    });
    fox.update(0.1, { x: 50, y: 50 });
    assert.equal(fox.state, 'hunt');
  });

  it('fox falls back to IDLE when no prey and no threat', async () => {
    const { EcologyMonster } = await import(`file://${ROOT}/src/monster/ecology-monster.js`);
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const fox = new EcologyMonster({
      typeId: 'fox', world: w, config: ecologyMonstersJson.fox,
      x: 40, y: 30, diet: ['rabbit'], threats: ['wolf'], trophic: 'predator',
      findNearest: () => null,
      findFleeTarget: () => null
    });
    fox.update(0.1, { x: 50, y: 50 });
    assert.ok(['idle', 'wander'].includes(fox.state), `unexpected state: ${fox.state}`);
  });

  it('wolf has no threats → never FLEEs', async () => {
    const { EcologyMonster } = await import(`file://${ROOT}/src/monster/ecology-monster.js`);
    const w = generateWorld({ width: 80, height: 60, seed: 20260822 });
    const wolf = new EcologyMonster({
      typeId: 'wolf', world: w, config: ecologyMonstersJson.wolf,
      x: 40, y: 30, diet: ['fox', 'rabbit'], threats: [], trophic: 'predator',
      findNearest: () => null,
      findFleeTarget: () => null
    });
    for (let i = 0; i < 5; i++) wolf.update(0.1, { x: 50, y: 50 });
    assert.notEqual(wolf.state, 'flee');
  });
});

// ── Report ─────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`${passCount}/${testCount} passed`);
if (passCount === testCount) {
  console.log('All v0.5.1 ecology tests passed.');
  process.exit(0);
} else {
  console.log('Some v0.5.1 ecology tests failed.');
  process.exit(1);
}
