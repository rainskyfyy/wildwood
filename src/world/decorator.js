/**
 * Decorator — scatters biome-appropriate decorations onto the world grid.
 *
 * Each decoration has a position (tile coords), a kind (e.g. 'tree'),
 * and a deterministic seed for jitter / sprite variant selection.
 *
 * Density comes from the biome's decorPool weights. The world is
 * reproducible: same seed + same biome config → same scatter.
 *
 * Output: Decor[] = { x, y, kind, color, size }
 */

'use strict';

import { getBiome } from './biome-config.js';

// Mulberry32 PRNG — same as perlin.js, exposed for deterministic scatter.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter decorations across the world.
 *
 * @param {import('./generator.js').WorldGrid} world
 * @param {object} [opts]
 * @param {number} [opts.density=0.04] — probability of a decor per tile per cycle
 * @param {number} [opts.seed] — override seed (defaults to world.seed)
 * @returns {Array<{x:number, y:number, kind:string, color:string, size:number}>}
 */
export function scatterDecorations(world, { density = 0.04, seed } = {}) {
  const rng = mulberry32(seed ?? world.seed ^ 0xDECAF);
  const out = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (rng() > density) continue;
      const biome = getBiome(world.getTile(x, y));
      // Weighted pick from decorPool.
      const totalWeight = biome.decorPool.reduce((s, d) => s + d.weight, 0);
      let r = rng() * totalWeight;
      let pick = biome.decorPool[0];
      for (const d of biome.decorPool) {
        r -= d.weight;
        if (r <= 0) { pick = d; break; }
      }
      out.push({
        x: x + 0.5 + (rng() - 0.5) * 0.4, // jitter inside tile
        y: y + 0.5 + (rng() - 0.5) * 0.4,
        kind: pick.id,
        color: pick.color,
        size: 0.55 + rng() * 0.35
      });
    }
  }
  return out;
}
