/**
 * World generator — produces a 2D biome grid.
 *
 * v0.5.1: 支持两种布局:
 *   - 'radial' (default): 6 群系径向布局 — 中心 forest, 内圈 plains,
 *     外圈 4 大极端群系按象限分布。
 *   - 'legacy': M5 4 群系 Perlin 模式(elevation + moisture 选 biome)。
 *
 * 输出 WorldGrid = {
 *   width, height, tiles (Uint8Array), elevation, moisture, occupants, seed
 * }
 *
 * 确定性: 相同 seed + width + height + layout 永远生成相同地图。
 *
 * v0.5.1 BIOME_TO_CODE 顺序: ['forest', 'plains', 'desert', 'marsh', 'snow', 'volcano']
 *   - 0 = forest, 1 = plains, 2 = desert, 3 = marsh, 4 = snow, 5 = volcano
 *
 * v0.5.0 (M5) BIOME_TO_CODE 顺序: ['desert', 'marsh', 'snow', 'volcano']
 *   - 0 = desert, 1 = marsh, 2 = snow, 3 = volcano
 *
 * 布局切换不影响 WorldGrid 接口(都是 Uint8Array 存生物群系 code)。
 * 唯一的兼容性影响: 把 v0.5.0 存档的 tiles 直接喂给 v0.5.1 的渲染器
 * 会把 0/1 解释成 forest/plains(变绿)。这是有意为之 — 老存档会
 * 自动迁移到 v0.5.1 的 6 群系体系。
 */

'use strict';

import { PerlinNoise } from './perlin.js';
import {
  pickBiome as pickBiomeLegacy,
  pickBiomeRadial,
  getBiome,
  BIOMES
} from './biome-config.js';

// v0.5.1 顺序:必须和 biome-config.js 的 BIOMES 顺序保持一致
const BIOME_TO_CODE = Object.fromEntries(
  Object.keys(BIOMES).map((id, i) => [id, i])
);
const CODE_TO_BIOME = Object.keys(BIOMES);
export { CODE_TO_BIOME };

export class WorldGrid {
  constructor({ width, height, seed }) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.tiles = new Uint8Array(width * height);
    this.elevation = new Float32Array(width * height);
    this.moisture = new Float32Array(width * height);
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
    if (this.occupants[this.idx(x, y)] !== 0) return false;
    return true;
  }

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
 * @param {number} [opts.scale=0.05]         Perlin spatial frequency (legacy layout only)
 * @param {'radial'|'legacy'} [opts.layout='radial']   v0.5.1 default = radial
 * @returns {WorldGrid}
 */
export function generateWorld({
  width,
  height,
  seed = 1337,
  scale = 0.05,
  layout = 'radial'
} = {}) {
  const grid = new WorldGrid({ width, height, seed });

  if (layout === 'radial') {
    _generateRadial(grid, width, height, seed);
  } else {
    _generateLegacy(grid, width, height, seed, scale);
  }
  return grid;
}

/**
 * v0.5.1 radial layout: 6 群系径向分布。
 * 仍然填充 elevation/moisture 字段(供未来用 Perlin 加细节)但
 * 不参与选群系。
 */
function _generateRadial(grid, width, height, seed) {
  const elevNoise = new PerlinNoise(seed);
  const moistNoise = new PerlinNoise(seed + 991);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 把 Perlin 字段作为附加数据(供装饰/资源密度使用)
      const e = (elevNoise.fbm(x * 0.05, y * 0.05, 4, 0.5) + 1) * 0.5;
      const m = (moistNoise.fbm(x * 0.05 + 137.42, y * 0.05 + 87.31, 3, 0.55) + 1) * 0.5;
      const ei = grid.idx(x, y);
      grid.elevation[ei] = e;
      grid.moisture[ei] = m;
      const id = pickBiomeRadial(x, y, width, height);
      grid.tiles[ei] = BIOME_TO_CODE[id];
    }
  }
}

/**
 * M5 4 群系 Perlin 模式(保留兼容)。
 */
function _generateLegacy(grid, width, height, seed, scale) {
  const elevNoise = new PerlinNoise(seed);
  const moistNoise = new PerlinNoise(seed + 991);
  const offsetX = 137.42;
  const offsetY = 87.31;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = (elevNoise.fbm(x * scale, y * scale, 4, 0.5) + 1) * 0.5;
      const m = (moistNoise.fbm(x * scale + offsetX, y * scale + offsetY, 3, 0.55) + 1) * 0.5;
      const ei = grid.idx(x, y);
      grid.elevation[ei] = e;
      grid.moisture[ei] = m;
      grid.tiles[ei] = BIOME_TO_CODE[pickBiomeLegacy(e, m)];
    }
  }
}

/**
 * 找一片连续的某群系地块并返回中心 tile 坐标。
 * v0.5.1 出生点用:玩家从 forest 出生 → 找最大森林连通块中心。
 */
export function findBiomeCenter(grid, biomeId) {
  const W = grid.width, H = grid.height;
  // 简单 flood-fill 找最大连通块
  const visited = new Uint8Array(W * H);
  let bestSize = 0;
  let bestCx = 0, bestCy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ei = grid.idx(x, y);
      if (visited[ei]) continue;
      if (grid.tiles[ei] !== BIOME_TO_CODE[biomeId]) continue;
      // BFS
      const stack = [[x, y]];
      let sumX = 0, sumY = 0, size = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const ci = grid.idx(cx, cy);
        if (visited[ci]) continue;
        if (grid.tiles[ci] !== BIOME_TO_CODE[biomeId]) continue;
        visited[ci] = 1;
        sumX += cx; sumY += cy; size++;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      if (size > bestSize) {
        bestSize = size;
        bestCx = Math.floor(sumX / size);
        bestCy = Math.floor(sumY / size);
      }
    }
  }
  return { x: bestCx, y: bestCy, size: bestSize };
}
