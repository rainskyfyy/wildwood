/**
 * World generator — produces a 2D biome grid from Perlin elevation + moisture.
 *
 * Output: WorldGrid = {
 *   width, height,            // tile dimensions
 *   tiles: Uint8Array,        // biome id per tile (encoded as integer 0..3)
 *   elevation: Float32Array,  // raw elevation per tile [0, 1]
 *   moisture:  Float32Array,  // raw moisture per tile [0, 1]
 *   occupants: Uint8Array,    // 0 = empty, >0 = building entity id (M2.9)
 *   seed
 * }
 *
 * Determinism: same seed + same width/height always produces the same grid.
 *
 * M5: BIOME_TO_CODE order is ['desert', 'marsh', 'snow', 'volcano'] to
 * match the M3.13 art directories. CODE_TO_BIOME mirrors it.
 *
 * M2.9: Added `occupants` Uint8Array so the building system can mark
 * tiles as taken. `isWalkable` is updated to also reject occupied
 * tiles, so the player cannot walk through placed buildings.
 */

'use strict';

import { PerlinNoise } from './perlin.js';
import { pickBiome, getBiome, BIOMES } from './biome-config.js';

// Map biome id -> integer code for compact Uint8Array storage.
// M5: keep ordered by BIOMES key insertion so Uint8Array round-trips stable.
const BIOME_TO_CODE = Object.fromEntries(
  Object.keys(BIOMES).map((id, i) => [id, i])
);
const CODE_TO_BIOME = Object.keys(BIOMES);

export class WorldGrid {
  constructor({ width, height, seed }) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.tiles = new Uint8Array(width * height);
    this.elevation = new Float32Array(width * height);
    this.moisture = new Float32Array(width * height);
    // M2.9: 0 = empty tile, >0 = 1-based building entity id stored in
    // BuildingManager.buildings[entityId - 1]. Uint8 caps entities at
    // 255; more than enough for a 4-player co-op session.
    this.occupants = new Uint8Array(width * height);
  }

  idx(x, y) { return y * this.width + x; }

  getTile(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return CODE_TO_BIOME[this.tiles[this.idx(x, y)]];
  }

  isWalkable(x, y) {
    const id = this.getTile(x, y);
    if (id == null) return false;
    if (!getBiome(id).walkable) return false;
    // M2.9: occupied tiles (by buildings) are not walkable.
    if (this.occupants[this.idx(x, y)] !== 0) return false;
    return true;
  }

  // M2.9: occupancy API. All return true on success, false on out-of-bounds.
  isOccupied(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.occupants[this.idx(x, y)] !== 0;
  }

  occupy(x, y, entityId) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    this.occupants[this.idx(x, y)] = entityId;
    return true;
  }

  free(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    this.occupants[this.idx(x, y)] = 0;
    return true;
  }
}

/**
 * Generate a world grid.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.seed=1337]
 * @param {number} [opts.scale=0.05] — Perlin spatial frequency; smaller = larger biomes
 * @returns {WorldGrid}
 */
export function generateWorld({ width, height, seed = 1337, scale = 0.05 } = {}) {
  const grid = new WorldGrid({ width, height, seed });
  const elevNoise = new PerlinNoise(seed);
  const moistNoise = new PerlinNoise(seed + 991);

  // Pre-compute a moisture offset to ensure decorrelation with elevation.
  const offsetX = 137.42;
  const offsetY = 87.31;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // fbm gives roughly [-1, 1]; remap to [0, 1].
      const e = (elevNoise.fbm(x * scale, y * scale, 4, 0.5) + 1) * 0.5;
      const m = (moistNoise.fbm(x * scale + offsetX, y * scale + offsetY, 3, 0.55) + 1) * 0.5;
      const ei = grid.idx(x, y);
      grid.elevation[ei] = e;
      grid.moisture[ei] = m;
      grid.tiles[ei] = BIOME_TO_CODE[pickBiome(e, m)];
    }
  }
  return grid;
}
