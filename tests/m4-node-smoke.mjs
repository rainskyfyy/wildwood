#!/usr/bin/env node
/**
 * M5 smoke test — runs the world/transition/decorator modules in Node
 * to confirm determinism, biome distribution, and transition counts.
 *
 * M5 update: 4 biomes are now desert/marsh/snow/volcano (was
 * forest/plains/mines/snow). Marsh has no M3.13 decoration art and
 * 3 of 6 transition pairs lack real art (verified by counting null
 * transition entries).
 *
 * DOM modules (render/, hud/, player/camera, main) are NOT loaded here
 * — they need a browser. This file imports only the world/* pure pieces.
 */

import { PerlinNoise } from '../src/world/perlin.js';
import { pickBiome, BIOMES, transitionArt } from '../src/world/biome-config.js';
import { generateWorld } from '../src/world/generator.js';
import { scatterDecorations } from '../src/world/decorator.js';
import { computeTransitions } from '../src/world/transitions.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ''}`); }
}

// 1. Perlin determinism
console.log('perlin');
const p1 = new PerlinNoise(123);
const p2 = new PerlinNoise(123);
const p3 = new PerlinNoise(456);
ok('same seed same output', p1.fbm(1.2, 3.4) === p2.fbm(1.2, 3.4));
ok('different seed different output', p1.fbm(1.2, 3.4) !== p3.fbm(1.2, 3.4));
const sample = p1.fbm(0.5, 0.5);
ok('fbm in [-1, 1]', sample >= -1.01 && sample <= 1.01, `got ${sample}`);

// 2. pickBiome thresholds — M5 4 biomes
console.log('pickBiome');
ok('wet → marsh',     pickBiome(0.20, 0.80) === 'marsh');
ok('high+dry → volcano', pickBiome(0.80, 0.10) === 'volcano');
ok('mid+dry → snow',   pickBiome(0.60, 0.30) === 'snow');
ok('low+dry → desert', pickBiome(0.20, 0.10) === 'desert');

// 3. generateWorld determinism + distribution
console.log('generateWorld');
const a = generateWorld({ width: 80, height: 60, seed: 20260822 });
const b = generateWorld({ width: 80, height: 60, seed: 20260822 });
ok('same seed same tiles', JSON.stringify(Array.from(a.tiles)) === JSON.stringify(Array.from(b.tiles)));
const idMap = Object.keys(BIOMES);
const counts = Object.fromEntries(idMap.map(id => [id, 0]));
for (let i = 0; i < a.tiles.length; i++) counts[idMap[a.tiles[i]]]++;
ok('desert present',  counts.desert  > 0, `desert=${counts.desert}`);
ok('marsh present',   counts.marsh   > 0, `marsh=${counts.marsh}`);
ok('snow present',    counts.snow    > 0, `snow=${counts.snow}`);
ok('volcano present', counts.volcano > 0, `volcano=${counts.volcano}`);
const totalTiles = a.width * a.height;
ok('total tiles 4800', totalTiles === 4800, `got ${totalTiles}`);
const total = counts.desert + counts.marsh + counts.snow + counts.volcano;
ok('all 4800 tiles classified', total === 4800, `total=${total}`);

// 4. walkability (all 4 biomes walkable in M5 demo)
let walkable = 0;
for (let i = 0; i < a.tiles.length; i++) {
  const id = idMap[a.tiles[i]];
  if (BIOMES[id].walkable) walkable++;
}
ok('all tiles walkable (M5)', walkable === total);

// 5. tileArt references — every biome has 5 PNGs
console.log('tileArt');
for (const id of idMap) {
  ok(`${id} has 5 tile variants`, BIOMES[id].tileArt.length === 5,
     `got ${BIOMES[id].tileArt.length}`);
  // PNG paths should be reachable strings.
  for (const p of BIOMES[id].tileArt) {
    ok(`${id} tile path ends .png`, /\.png$/.test(p), p);
  }
}

// 6. decorPool
console.log('decorPool');
for (const id of idMap) {
  const pool = BIOMES[id].decorPool;
  ok(`${id} has decorPool with >=3 entries`, pool.length >= 3, `len=${pool.length}`);
  for (const d of pool) ok(`${id} decor ${d.id} has weight>0`, d.weight > 0, `w=${d.weight}`);
}
// Marsh has no real art (art:null), all others do.
for (const d of BIOMES.marsh.decorPool) {
  ok(`marsh decor ${d.id} art is null`, d.art == null, `art=${d.art}`);
}
for (const id of ['desert', 'snow', 'volcano']) {
  const hasArt = BIOMES[id].decorPool.some(d => d.art);
  ok(`${id} decor has at least one PNG art`, hasArt);
}

// 7. scatterDecorations determinism + count + art propagated
console.log('scatterDecorations');
const d1 = scatterDecorations(a, { density: 0.06, seed: 20260829 });
const d2 = scatterDecorations(a, { density: 0.06, seed: 20260829 });
ok('same seed same decor count', d1.length === d2.length);
ok('same seed same first 5 positions',
   JSON.stringify(d1.slice(0, 5).map(d => [d.x, d.y, d.kind])) ===
   JSON.stringify(d2.slice(0, 5).map(d => [d.x, d.y, d.kind])));
ok('decor count ≈ 6% of tiles', d1.length > 0.04 * total && d1.length < 0.08 * total,
   `got ${d1.length}, expected ${0.06 * total}±20%`);
// All decor entries now have an `art` field (string or null).
const allHaveArt = d1.every(d => 'art' in d);
ok('every decor entry has art field', allHaveArt);
// Marsh decor should all be art:null.
const marshDecor = d1.filter(d => a.getTile(Math.floor(d.x), Math.floor(d.y)) === 'marsh');
const marshHasArt = marshDecor.some(d => d.art != null);
ok('no marsh decor has art', !marshHasArt, `${marshDecor.length} marsh decors`);

// 8. transition table — 3 pairs have art, 3 are null
console.log('transitions');
const pairs = [['desert','snow'],['desert','volcano'],['snow','volcano'],
               ['marsh','desert'],['marsh','snow'],['marsh','volcano']];
let withArt = 0, withoutArt = 0;
for (const [x, y] of pairs) {
  const r = transitionArt(x, y, 0.5);
  if (r && r.path) withArt++;
  else withoutArt++;
}
ok('3 transition pairs have art (desert↔snow, desert↔volcano, snow↔volcano)',
   withArt === 3, `got ${withArt}`);
ok('3 transition pairs are null (marsh pairs)', withoutArt === 3, `got ${withoutArt}`);
// Marsh pairs always null regardless of blend.
ok('marsh↔desert always null', transitionArt('marsh', 'desert', 0.2) == null
   && transitionArt('marsh', 'desert', 0.8) == null);
// Real pairs return a step in [0, 2].
for (const blend of [0.0, 0.3, 0.5, 0.7, 1.0]) {
  const r = transitionArt('desert', 'snow', blend);
  ok(`desert↔snow step in [0,2] for blend=${blend}`, r && r.step >= 0 && r.step <= 2,
     `step=${r && r.step}`);
}

// 9. computeTransitions — adjacent biome edges
const t = computeTransitions(a, 2);
let edges = 0;
for (let i = 0; i < t.neighbor.length; i++) if (t.neighbor[i] >= 0) edges++;
ok('transitions present', edges > 0, `edges=${edges}`);
ok('edges < 50% of tiles', edges < 0.5 * total, `edges=${edges}`);

// Summary
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
