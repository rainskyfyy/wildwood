/**
 * Biome transitions — blend adjacent biomes using a distance-based gradient.
 *
 * For each pair of biome neighbors we emit a transition band whose width
 * is given by `bandWidth` (in tiles). Inside the band we linearly
 * interpolate the two biomes' primary colors.
 *
 * Output: a `TransitionMap` = Float32Array of length width*height
 *   - 0.0  → fully biome A
 *   - 1.0  → fully biome B
 *   - 0.5  → midpoint (true transition tile)
 *
 * Renderers read this map to swap in shared transition tiles (or to
 * procedurally blend colors when art is missing).
 */

'use strict';

import { getBiome } from './biome-config.js';

const MAX_BIOMES = 4;

/**
 * @param {import('./generator.js').WorldGrid} world
 * @param {number} bandWidth — width of transition in tiles
 * @returns {{
 *   target: Uint8Array,   // dominant biome per tile (after transitions)
 *   blend:  Float32Array, // 0..1 blend toward `neighbor` below
 *   neighbor: Int16Array, // -1 = no neighbor; else biome code
 * }}
 */
export function computeTransitions(world, bandWidth = 3) {
  const N = world.width * world.height;
  const target = new Uint8Array(N);
  const blend = new Float32Array(N);
  const neighbor = new Int16Array(N);
  neighbor.fill(-1);

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const ei = world.idx(x, y);
      const myCode = world.tiles[ei];
      target[ei] = myCode;
      // Look in 4 directions; first different biome wins.
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const otherCode = world.tiles[world.idx(nx, ny)];
        if (otherCode !== myCode) {
          neighbor[ei] = otherCode;
          blend[ei] = 0.5; // direct neighbor = midpoint
          break;
        }
      }
    }
  }
  return { target, blend, neighbor };
}

/**
 * Procedural color blend when no transition art is available.
 * Mixes two biome primary colors by factor t in [0, 1].
 *
 * @param {string} colorA
 * @param {string} colorB
 * @param {number} t
 * @returns {string} hex color
 */
export function blendColors(colorA, colorB, t) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}
