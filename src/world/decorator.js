/**
 * Decorator — scatters biome-appropriate decorations onto the world grid.
 *
 * M5 changes vs M4:
 *   - Each decor entry now has an `art` field (PNG path) or `art: null`
 *     for procedural fallbacks (marsh).
 *   - The M3.13 PNG paths reference assets/art/biomes/_shared/decorations/
 *     which the image loader resolves at render time.
 *
 * Each decoration has a position (tile coords), a kind (e.g. 'lizard'),
 * a deterministic seed for jitter, and the original art path so the
 * renderer can hot-swap to PNG when ready.
 *
 * Density comes from the biome's decorPool weights. The world is
 * reproducible: same seed + same biome config → same scatter.
 *
 * Output: Decor[] = {
 *   x, y, kind, color, size, art: string|null
 * }
 */

'use strict';

import { getBiome } from './biome-config.js';
// v0.8.0 P0 Bug-1:scatterDecorationsAndVillage needs to also produce
// the NPC village so assembly.js can install it on npcMgr in one shot.
// Lazy-static import is safe — npc/village.js does not import from
// world/decorator.js (no circular dep).
import { generateVillage } from '../npc/village.js';

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
 * @returns {Array<{x:number, y:number, kind:string, color:string, size:number, art:(string|null)}>}
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
        size: 0.55 + rng() * 0.35,
        art: pick.art || null
      });
    }
  }
  return out;
}

/**
 * v0.8.0 P0 Bug-1:scatter decorations AND the NPC village in one call.
 * Returns `{ decor, village }` so assembly.js can install both via
 * `const { decor, village } = scatterDecorationsAndVillage(...)`.
 *
 * Village is `{ piglins, buildings, origin }` on success, or `null` when
 * `generateVillage` returns an empty roster (no placeable clearing in
 * the forest biome). assembly.js already handles `village == null` by
 * falling back to `npcMgr.spawnVillage({ preferredBiome: 'forest' })`.
 *
 * @param {import('./generator.js').WorldGrid} world
 * @param {object} [opts]
 * @param {number} [opts.density=0.04] — probability of a decor per tile per cycle
 * @param {number} [opts.seed] — override seed (defaults to world.seed)
 * @returns {{ decor: Array<object>, village: { piglins: Array, buildings: Array, origin: object|null } | null }}
 */
export function scatterDecorationsAndVillage(world, opts = {}) {
  const decor = scatterDecorations(world, opts);
  let village = null;
  try {
    const result = generateVillage(world, opts);
    if (result && Array.isArray(result.piglins) && result.piglins.length > 0) {
      village = result;
    }
  } catch (_e) {
    // village generation failed — caller falls back to npcMgr.spawnVillage
    village = null;
  }
  return { decor, village };
}
