/**
 * Noise buffer synthesis — deterministic, no third-party deps.
 *
 * Provides white / pink (Voss-McCartney) / brown (leaky integrator) noise
 * generators that return Float32Array PCM. Seeded via Mulberry32 for
 * reproducible test output.
 */
'use strict';

/** Mulberry32 — small fast PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fill `out` (Float32Array) with uniform white noise in [-1, 1]. */
export function fillWhite(out, rand) {
  for (let i = 0; i < out.length; i++) {
    out[i] = (rand() * 2 - 1);
  }
  return out;
}

/** Fill `out` with pink noise (Voss-McCartney 16-row). */
export function fillPink(out, rand) {
  const rows = new Float32Array(16);
  let runningSum = 0;
  let counter = 0;
  for (let i = 0; i < out.length; i++) {
    // update one row based on trailing-zero count of counter
    counter++;
    let row = 0;
    let c = counter;
    while ((c & 1) === 0 && row < 15) { c >>= 1; row++; }
    rows[row] = (rand() * 2 - 1);
    runningSum = 0;
    for (let r = 0; r < 16; r++) runningSum += rows[r];
    out[i] = (runningSum / 16) * 0.7; // gentle gain trim
  }
  return out;
}

/** Fill `out` with brown noise (leaky integrator of white). */
export function fillBrown(out, rand) {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = (rand() * 2 - 1) * 0.05;
    last = (last + w) * 0.998;
    if (last > 1) last = 1;
    if (last < -1) last = -1;
    out[i] = last * 3.5; // boost (brown is quiet)
  }
  return out;
}

/**
 * Create an AudioBuffer of the requested kind, duration, sample-rate.
 * If `ctx` is missing or has no `createBuffer`, returns a Float32Array
 * (for tests / node).
 */
export function createNoiseBuffer(ctx, durSec, kind = 'white', seed = 1, sampleRate = 44100) {
  const len = Math.max(1, Math.floor(durSec * sampleRate));
  const data = new Float32Array(len);
  const rand = mulberry32(seed);
  if (kind === 'pink')  fillPink(data, rand);
  else if (kind === 'brown') fillBrown(data, rand);
  else fillWhite(data, rand);

  if (ctx && typeof ctx.createBuffer === 'function') {
    const buf = ctx.createBuffer(1, len, sampleRate);
    buf.copyToChannel(data, 0);
    return buf;
  }
  // test/no-context fallback: shape object with same surface
  return {
    duration: durSec,
    sampleRate,
    length: len,
    numberOfChannels: 1,
    getChannelData: () => data
  };
}
