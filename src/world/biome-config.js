/**
 * Biome configuration for M4 world generation.
 *
 * 4 biomes aligned with M2.7 data layer (forest/plains/mines/snow).
 * Each biome defines:
 *  - elevation/moisture thresholds (Perlin field bands)
 *  - primary + secondary tile colors (placeholder; replace with PNG art)
 *  - decoration pool (rocks/trees/grass/mushrooms scattered on top)
 *  - collision flag (water/mountain block movement; grass/dirt allow)
 *
 * Stays consistent with assets/biomes/biome_map.json so M2.7 streaming
 * loader can later stream chunks of this same biome set.
 */

'use strict';

export const BIOMES = {
  forest: {
    id: 'forest',
    name: '森林',
    elevation: { min: 0.30, max: 0.85 },
    moisture:  { min: 0.40, max: 1.00 },
    primary:   '#3d5a2a',  // 暖深绿,森林主色
    secondary: '#5a7a3a',  // 草地点缀
    accent:    '#6e8a4a',  // 高光
    decorPool: [
      { id: 'tree',    weight: 60, color: '#2a3f1a' },
      { id: 'rock',    weight: 20, color: '#6b6258' },
      { id: 'mushroom',weight: 15, color: '#c25a3a' },
      { id: 'flower',  weight: 5,  color: '#d4a64a' }
    ],
    walkable: true
  },
  plains: {
    id: 'plains',
    name: '平原',
    elevation: { min: 0.10, max: 0.50 },
    moisture:  { min: 0.20, max: 0.60 },
    primary:   '#a89548',  // 暖金黄,平原主色
    secondary: '#c4b068',  // 草地点缀
    accent:    '#d8c888',  // 高光
    decorPool: [
      { id: 'grass_tuft', weight: 70, color: '#8a7a3a' },
      { id: 'flower',     weight: 20, color: '#d4a64a' },
      { id: 'rock',       weight: 10, color: '#6b6258' }
    ],
    walkable: true
  },
  mines: {
    id: 'mines',
    name: '矿区',
    elevation: { min: 0.70, max: 1.00 },
    moisture:  { min: 0.00, max: 0.40 },
    primary:   '#5a5560',  // 灰紫,岩石主色
    secondary: '#454050',  // 阴影
    accent:    '#7a6e72',  // 高光
    decorPool: [
      { id: 'ore_copper', weight: 40, color: '#b87a3a' },
      { id: 'ore_iron',   weight: 30, color: '#8a8a90' },
      { id: 'rock',       weight: 25, color: '#3a3540' },
      { id: 'crystal',    weight: 5,  color: '#5acfa8' }
    ],
    walkable: true
  },
  snow: {
    id: 'snow',
    name: '雪原',
    elevation: { min: 0.40, max: 0.95 },
    moisture:  { min: 0.00, max: 0.35 },
    primary:   '#d8e4ec',  // 冷白,雪原主色
    secondary: '#a8b8c4',  // 阴影
    accent:    '#f0f4f8',  // 高光
    decorPool: [
      { id: 'pine',      weight: 35, color: '#2a3f2a' },
      { id: 'rock',      weight: 30, color: '#6b7078' },
      { id: 'snowdrift', weight: 25, color: '#f0f4f8' },
      { id: 'ice',       weight: 10, color: '#a8d4e8' }
    ],
    walkable: true
  }
};

/**
 * Pick a biome id given elevation + moisture fields in [0, 1].
 * Falls back to nearest match if no band covers the point.
 *
 * @param {number} elevation
 * @param {number} moisture
 * @returns {string} biome id (forest/plains/mines/snow)
 */
export function pickBiome(elevation, moisture) {
  // Priority order: mines (high + dry) > snow (mid-high + dry) >
  //                 forest (any + wet) > plains (low + mid-dry).
  if (elevation >= 0.70 && moisture <= 0.40) return 'mines';
  if (elevation >= 0.40 && moisture <= 0.35) return 'snow';
  if (moisture >= 0.40) return 'forest';
  return 'plains';
}

/**
 * Lookup biome config; throws on unknown id.
 */
export function getBiome(id) {
  const b = BIOMES[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}
