/**
 * Biome configuration for M5 (real M3.13 art integration).
 *
 * 4 biomes aligned with the M3.13 art layer:
 *   - desert    (sand / dunes / pebbles)
 *   - marsh     (mud / swamp / puddles — M5 first; previously M2.7 "plains")
 *   - snow      (snow / ice / permafrost)
 *   - volcano   (basalt / lava / ash)
 *
 * Each biome defines:
 *   - elevation/moisture thresholds (Perlin field bands)
 *   - primary + secondary + accent colors (used as procedural fallback
 *     when M3.13 PNGs fail to load; UI 设计师 tokens reuse these)
 *   - decorPool: M3.13 decoration PNGs (desert/snow/volcano) and
 *     procedural kinds for marsh (no real art)
 *   - tileArt: 5 PNG paths under assets/art/biomes/<id>/tiles/
 *   - transitionArt: per-neighbor PNG path or null (procedural blend)
 *
 * Tile variant selection at render time: a Mulberry32 PRNG hashes the
 * tile's world coord to a stable [0..5) index so the same world tile
 * always picks the same PNG variant.
 */

'use strict';

// Path to a single M3.13 tile PNG; helpers below build full paths.
const TILE_DIR = id => `./assets/art/biomes/${id}/tiles/`;
const TILE_PNG = (id, name) => `${TILE_DIR(id)}${name}.png`;

// Decoration paths.
const DECOR_DIR = id => `./assets/art/biomes/_shared/decorations/${id}/`;
const DECOR_PNG = (id, name) => `${DECOR_DIR(id)}${name}.png`;

// Transition PNG: <a>2<b>_step{0,1,2}.png, sorted alphabetically.
const TRANS_PNG = (a, b, step) =>
  `./assets/art/biomes/_shared/transitions/${a}2${b}_step${step}.png`;

/**
 * M5 biomes. Order matters for BIOME_TO_CODE Uint8Array mapping in
 * generator.js — keep stable: ['desert', 'marsh', 'snow', 'volcano'].
 */
export const BIOMES = {
  desert: {
    id: 'desert',
    name: '荒漠',
    elevation: { min: 0.20, max: 0.85 },
    moisture:  { min: 0.00, max: 0.40 },
    primary:   '#c9a96e',  // 暖沙
    secondary: '#a88a52',
    accent:    '#e0c89a',
    tileArt: [
      TILE_PNG('desert', 'sand_base'),
      TILE_PNG('desert', 'sand_cracked'),
      TILE_PNG('desert', 'sand_pebbles'),
      TILE_PNG('desert', 'dunes'),
      TILE_PNG('desert', 'sand_dry_grass')
    ],
    decorPool: [
      { id: 'lizard',      weight: 18, art: DECOR_PNG('desert', 'lizard'),      color: '#a87a3a' },
      { id: 'sand_ripple', weight: 40, art: DECOR_PNG('desert', 'sand_ripple'), color: '#c9a96e' },
      { id: 'scorpion',    weight: 12, art: DECOR_PNG('desert', 'scorpion'),    color: '#6e4a2a' },
      { id: 'tumbleweed', weight: 30, art: DECOR_PNG('desert', 'tumbleweed'),  color: '#8a6e3a' }
    ],
    walkable: true
  },

  marsh: {
    id: 'marsh',
    name: '沼泽',
    elevation: { min: 0.05, max: 0.55 },
    moisture:  { min: 0.55, max: 1.00 },
    primary:   '#5a5a3a',  // 暗绿泥
    secondary: '#3a4a2a',
    accent:    '#6e7a3a',
    tileArt: [
      TILE_PNG('marsh', 'mud_base'),
      TILE_PNG('marsh', 'mud_puddle'),
      TILE_PNG('marsh', 'mud_grass'),
      TILE_PNG('marsh', 'dark_mud'),
      TILE_PNG('marsh', 'mud_swamp')
    ],
    // Marsh has no M3.13 decoration art; fall back to procedural dots.
    decorPool: [
      { id: 'mud_speck',  weight: 50, art: null, color: '#3a4a2a' },
      { id: 'reed',       weight: 25, art: null, color: '#6e7a3a' },
      { id: 'moss_patch', weight: 25, art: null, color: '#4a6a3a' }
    ],
    walkable: true
  },

  snow: {
    id: 'snow',
    name: '雪原',
    elevation: { min: 0.45, max: 0.95 },
    moisture:  { min: 0.00, max: 0.50 },
    primary:   '#d8e4ec',
    secondary: '#a8b8c4',
    accent:    '#f0f4f8',
    tileArt: [
      TILE_PNG('snow', 'snow_base'),
      TILE_PNG('snow', 'ice_crack'),
      TILE_PNG('snow', 'snow_powder'),
      TILE_PNG('snow', 'rocky_snow'),
      TILE_PNG('snow', 'permafrost')
    ],
    decorPool: [
      { id: 'icicle',      weight: 18, art: DECOR_PNG('snow', 'icicle'),      color: '#a8d4e8' },
      { id: 'pinecone',    weight: 30, art: DECOR_PNG('snow', 'pinecone'),    color: '#6e4a2a' },
      { id: 'rabbit_track',weight: 12, art: DECOR_PNG('snow', 'rabbit_track'),color: '#888888' },
      { id: 'snowflake',   weight: 40, art: DECOR_PNG('snow', 'snowflake'),   color: '#f0f4f8' }
    ],
    walkable: true
  },

  volcano: {
    id: 'volcano',
    name: '火山',
    elevation: { min: 0.65, max: 1.00 },
    moisture:  { min: 0.00, max: 0.30 },
    primary:   '#3a2a26',  // 暗红黑
    secondary: '#5a2a1a',
    accent:    '#d4622a',  // 熔岩橙
    tileArt: [
      TILE_PNG('volcano', 'lava_flow'),
      TILE_PNG('volcano', 'basalt'),
      TILE_PNG('volcano', 'ash_ground'),
      TILE_PNG('volcano', 'magma_crack'),
      TILE_PNG('volcano', 'scorched_earth')
    ],
    decorPool: [
      { id: 'ash',           weight: 35, art: DECOR_PNG('volcano', 'ash'),           color: '#2a201a' },
      { id: 'ember_spark',   weight: 18, art: DECOR_PNG('volcano', 'ember_spark'),   color: '#d4622a' },
      { id: 'lava_bubble',   weight: 12, art: DECOR_PNG('volcano', 'lava_bubble'),   color: '#ff8a3a' },
      { id: 'sulfur_crystal',weight: 35, art: DECOR_PNG('volcano', 'sulfur_crystal'),color: '#d4c84a' }
    ],
    walkable: true
  }
};

/**
 * Pick a biome id given elevation + moisture fields in [0, 1].
 *
 * Priority (most specific first):
 *   - marsh    : moisture >= 0.55 (wet)
 *   - volcano  : elevation >= 0.65 && moisture <= 0.30 (high + dry)
 *   - snow     : elevation >= 0.50 && moisture <= 0.50 (high + cool/dry)
 *   - desert   : fallback (warm + dry)
 *
 * @param {number} elevation
 * @param {number} moisture
 * @returns {string} biome id
 */
export function pickBiome(elevation, moisture) {
  if (moisture >= 0.55) return 'marsh';
  if (elevation >= 0.65 && moisture <= 0.30) return 'volcano';
  if (elevation >= 0.50 && moisture <= 0.50) return 'snow';
  return 'desert';
}

/**
 * Lookup biome config; throws on unknown id.
 */
export function getBiome(id) {
  const b = BIOMES[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}

/**
 * Resolve the transition PNG path for a biome A → biome B pair, and
 * which `step` (0, 1, 2) to use given a blend factor in [0, 1].
 *
 * Returns `null` for `path` when no real art exists for the pair — the
 * caller then falls back to procedural color blending.
 *
 * Pairs with real art (M3.13): desert↔snow, desert↔volcano, snow↔volcano
 *   (3 of 6 pairs). The other 3 pairs (any involving marsh) get null.
 *
 * @param {string} a — biome id, sorted alphabetically vs b
 * @param {string} b — biome id
 * @param {number} blend — 0..1 (0=fully A, 1=fully B)
 * @returns {{ path: string|null, step: number } | null}
 */
export function transitionArt(a, b, blend) {
  if (a === b) return null;
  // Alphabetize so desert↔snow and snow↔desert hit the same PNG.
  const [lo, hi] = a < b ? [a, b] : [b, a];
  // Pairs without real art: anything involving marsh.
  if (lo === 'marsh' || hi === 'marsh') return null;
  // step index: 0=close to A, 1=midpoint, 2=close to B
  const step = blend < (1 / 3) ? 0 : blend < (2 / 3) ? 1 : 2;
  return { path: TRANS_PNG(lo, hi, step), step };
}

/**
 * Pick a tile variant index for a given world coordinate.
 * Deterministic Mulberry32-style hash → [0, n).
 *
 * @param {number} x — world tile x
 * @param {number} y — world tile y
 * @param {number} n — number of variants (default 5)
 * @returns {number} index in [0, n)
 */
export function pickTileVariant(x, y, n = 5) {
  // Hash coord with bit mix (same spirit as Mulberry32). Avoids creating
  // an RNG instance per tile.
  let h = ((x | 0) * 0x27d4eb2d) ^ ((y | 0) * 0x165667b1);
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
