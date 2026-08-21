/**
 * Perlin noise — Ken Perlin reference implementation, ported to JS.
 * Source: https://mrl.cs.nyu.edu/~perlin/noise/ (improved noise 2002)
 *
 * Pure JS, no deps. Deterministic given the same permutation seed.
 * Used by world/generator.js to derive elevation + moisture fields.
 */

'use strict';

class PerlinNoise {
  /**
   * @param {number} [seed=1337] — integer seed; deterministic across reloads
   */
  constructor(seed = 1337) {
    this.p = new Uint8Array(512);
    this.perm = new Uint8Array(256);
    // Mulberry32 — small fast deterministic PRNG.
    let s = seed >>> 0;
    for (let i = 0; i < 256; i++) {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      this.perm[i] = (t ^ (t >>> 14)) >>> 0;
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = this.perm[i & 255];
    }
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + t * (b - a); }
  static grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  /**
   * 2D Perlin noise in range roughly [-1, 1].
   * @param {number} x
   * @param {number} y
   */
  noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = PerlinNoise.fade(xf);
    const v = PerlinNoise.fade(yf);
    const p = this.p;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = PerlinNoise.lerp(
      PerlinNoise.grad(aa, xf, yf),
      PerlinNoise.grad(ba, xf - 1, yf),
      u
    );
    const x2 = PerlinNoise.lerp(
      PerlinNoise.grad(ab, xf, yf - 1),
      PerlinNoise.grad(bb, xf - 1, yf - 1),
      u
    );
    return PerlinNoise.lerp(x1, x2, v);
  }

  /**
   * Fractal Brownian Motion: stack multiple octaves for richer terrain.
   * @param {number} x
   * @param {number} y
   * @param {number} octaves
   * @param {number} persistence
   */
  fbm(x, y, octaves = 4, persistence = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / max; // normalize to ~[-1, 1]
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PerlinNoise };
}
