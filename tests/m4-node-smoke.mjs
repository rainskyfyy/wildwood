#!/usr/bin/env node
/**
 * M4 smoke test — runs the world/transition/decorator modules in Node
 * to confirm determinism, biome distribution, and transition counts.
 *
 * DOM modules (render/, hud/, player/camera, main) are NOT loaded here
 * — they need a browser. This file imports only the world/* pure pieces.
 */

import { PerlinNoise } from '../src/world/perlin.js';
import { pickBiome, BIOMES } from '../src/world/biome-config.js';
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

// 2. pickBiome thresholds
console.log('pickBiome');
ok('high+dry → mines', pickBiome(0.80, 0.20) === 'mines');
ok('mid+dry → snow',   pickBiome(0.50, 0.20) === 'snow');
ok('mid+wet → forest', pickBiome(0.50, 0.80) === 'forest');
ok('low+mid-dry → plains', pickBiome(0.20, 0.30) === 'plains');

// 3. generateWorld determinism + distribution
console.log('generateWorld');
const a = generateWorld({ width: 80, height: 60, seed: 20260822 });
const b = generateWorld({ width: 80, height: 60, seed: 20260822 });
ok('same seed same tiles', JSON.stringify(Array.from(a.tiles)) === JSON.stringify(Array.from(b.tiles)));
const counts = { forest: 0, plains: 0, mines: 0, snow: 0 };
const idMap = ['forest', 'plains', 'mines', 'snow'];
for (let i = 0; i < a.tiles.length; i++) counts[idMap[a.tiles[i]]]++;
ok('forest present',  counts.forest > 0,  `forest=${counts.forest}`);
ok('plains present',  counts.plains > 0,  `plains=${counts.plains}`);
ok('mines present',   counts.mines > 0,   `mines=${counts.mines}`);
ok('snow present',    counts.snow > 0,    `snow=${counts.snow}`);
const totalTiles = a.width * a.height;
ok('total tiles 4800', totalTiles === 4800, `got ${totalTiles}`);
const total = counts.forest + counts.plains + counts.mines + counts.snow;
ok('all 4800 tiles classified', total === 4800, `total=${total}`);

// 4. walkability (all 4 biomes walkable in M4 demo)
let walkable = 0;
for (let i = 0; i < a.tiles.length; i++) {
  const id = idMap[a.tiles[i]];
  if (BIOMES[id].walkable) walkable++;
}
ok('all tiles walkable (M4)', walkable === total);

// 5. scatterDecorations determinism + count
console.log('scatterDecorations');
const d1 = scatterDecorations(a, { density: 0.06, seed: 20260829 });
const d2 = scatterDecorations(a, { density: 0.06, seed: 20260829 });
ok('same seed same decor count', d1.length === d2.length);
ok('same seed same first 5 positions',
   JSON.stringify(d1.slice(0, 5).map(d => [d.x, d.y, d.kind])) ===
   JSON.stringify(d2.slice(0, 5).map(d => [d.x, d.y, d.kind])));
ok('decor count ≈ 6% of tiles', d1.length > 0.04 * total && d1.length < 0.08 * total,
   `got ${d1.length}, expected ${0.06 * total}±20%`);

// 6. computeTransitions — adjacent biome edges
console.log('transitions');
const t = computeTransitions(a, 2);
let edges = 0;
for (let i = 0; i < t.neighbor.length; i++) if (t.neighbor[i] >= 0) edges++;
ok('transitions present', edges > 0, `edges=${edges}`);
ok('edges < 30% of tiles', edges < 0.3 * total, `edges=${edges}`);

// Summary
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
