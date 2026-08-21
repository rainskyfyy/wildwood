/**
 * Spawner — scatter harvestable ResourceEntity per tile, biome-gated.
 */
'use strict';

import { ResourceEntity } from './resource-entity.js';
import { resourcesForBiome } from './catalog.js';
import { getBiome } from '../world/biome-config.js';

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

export function spawnResources(world, { seed, biomeFilter = null } = {}) {
  const rng = mulberry32((seed ?? world.seed) ^ 0xCAFE);
  const out = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const biomeId = world.getTile(x, y);
      if (!biomeId) continue;
      if (biomeFilter && biomeId !== biomeFilter) continue;
      if (!getBiome(biomeId).walkable) continue;
      const eligible = resourcesForBiome(biomeId);
      for (const def of eligible) {
        if (rng() < def.density) {
          out.push(new ResourceEntity({
            id: def.id,
            x: x + 0.5 + (rng() - 0.5) * 0.4,
            y: y + 0.5 + (rng() - 0.5) * 0.4,
            size: def.size * (0.9 + rng() * 0.2),
            rngSeed: (Math.floor(x * 1000 + y) ^ hashStr(def.id)) >>> 0
          }));
        }
      }
    }
  }
  return out;
}

function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
