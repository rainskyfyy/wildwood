/**
 * Sound recipes — declarative factory functions that build a graph of
 * Web Audio nodes given a context + AudioManager. Each recipe returns:
 *   {
 *     nodes: [...],            // nodes to keep alive (e.g. source)
 *     bus: GainNode,           // entry point — connect this to your destination
 *     totalDuration: sec,      // how long until the source ends
 *     stop?: (when) => void,   // optional manual teardown
 *   }
 *
 * Recipes are pure factories; no state lives inside them. The registry
 * maps id → recipe.
 */
'use strict';

import { createNoiseBuffer } from './noise.js';
import { applyADSR, releaseADSR, ramp } from './envelope.js';
import { biquad, gain, attachLFO, makeDistortionCurve } from './filter.js';

// ---------- one-shot SFX recipes ----------

/** Soft pluck — short noise burst → resonant bandpass. */
export function pluckRecipe(ctx, opts = {}) {
  const dur = opts.dur ?? 0.18;
  const buf = createNoiseBuffer(ctx, dur, 'pink', opts.seed ?? 11);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'bandpass', opts.freq ?? 800, 4, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  applyADSR(env.gain, t0, { attack: 0.005, decay: 0.04, sustain: 0.0, release: 0.1, peak: opts.peak ?? 0.7 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Thud — low-passed brown noise with pitch sweep. */
export function thudRecipe(ctx, opts = {}) {
  const dur = opts.dur ?? 0.22;
  const buf = createNoiseBuffer(ctx, dur, 'brown', opts.seed ?? 21);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'lowpass', 800, 0.7, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  ramp(filter.frequency, t0, 200, dur);
  applyADSR(env.gain, t0, { attack: 0.003, decay: 0.05, sustain: 0.0, release: 0.18, peak: opts.peak ?? 0.9 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Slash — short high-frequency noise burst. */
export function slashRecipe(ctx, opts = {}) {
  const dur = opts.dur ?? 0.12;
  const buf = createNoiseBuffer(ctx, dur, 'white', opts.seed ?? 31);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'bandpass', 2400, 2, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  ramp(filter.frequency, t0, 900, dur);
  applyADSR(env.gain, t0, { attack: 0.002, decay: 0.04, sustain: 0.0, release: 0.06, peak: opts.peak ?? 0.6 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Hurt — distorted growl with quick decay. */
export function hurtRecipe(ctx, opts = {}) {
  const dur = opts.dur ?? 0.28;
  const buf = createNoiseBuffer(ctx, dur, 'brown', opts.seed ?? 41);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'lowpass', 600, 5, 0);
  const shaper = (ctx.createWaveShaper) ? ctx.createWaveShaper() : null;
  if (shaper) shaper.curve = makeDistortionCurve(40);
  const env = gain(ctx, 0);
  if (shaper) { src.connect(filter); filter.connect(shaper); shaper.connect(env); }
  else        { src.connect(filter); filter.connect(env); }
  const t0 = ctx.currentTime;
  applyADSR(env.gain, t0, { attack: 0.005, decay: 0.06, sustain: 0.0, release: 0.22, peak: opts.peak ?? 0.7 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, shaper, env].filter(Boolean), totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Chime — two sine partials with bell-like envelope (used for craft/pickup). */
export function chimeRecipe(ctx, opts = {}) {
  const dur = opts.dur ?? 0.5;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'sine'; osc2.type = 'sine';
  const base = opts.freq ?? 880;
  osc1.frequency.value = base;
  osc2.frequency.value = base * 1.5;
  const env = gain(ctx, 0);
  osc1.connect(env); osc2.connect(env);
  const t0 = ctx.currentTime;
  applyADSR(env.gain, t0, { attack: 0.003, decay: 0.18, sustain: 0.05, release: 0.3, peak: opts.peak ?? 0.5 });
  osc1.start(t0); osc2.start(t0);
  osc1.stop(t0 + dur); osc2.stop(t0 + dur);
  return { bus: env, nodes: [osc1, osc2, env], totalDuration: dur };
}

/** Click — tiny UI tick (very short bandpass noise). */
export function clickRecipe(ctx, opts = {}) {
  const dur = 0.05;
  const buf = createNoiseBuffer(ctx, dur, 'white', opts.seed ?? 51);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'bandpass', 1800, 8, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  applyADSR(env.gain, t0, { attack: 0.001, decay: 0.02, sustain: 0.0, release: 0.02, peak: opts.peak ?? 0.4 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Error buzz — descending two-tone. */
export function errorRecipe(ctx, opts = {}) {
  const dur = 0.22;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  const env = gain(ctx, 0);
  osc.connect(env);
  const t0 = ctx.currentTime;
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.linearRampToValueAtTime(110, t0 + dur);
  applyADSR(env.gain, t0, { attack: 0.002, decay: 0.04, sustain: 0.3, release: 0.1, peak: opts.peak ?? 0.35 });
  osc.start(t0); osc.stop(t0 + dur);
  return { bus: env, nodes: [osc, env], totalDuration: dur };
}

/** Death — long low rumble, longer release. */
export function deathRecipe(ctx, opts = {}) {
  const dur = 1.2;
  const buf = createNoiseBuffer(ctx, dur, 'brown', opts.seed ?? 61);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'lowpass', 400, 1, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  ramp(filter.frequency, t0, 80, dur);
  applyADSR(env.gain, t0, { attack: 0.02, decay: 0.4, sustain: 0.1, release: 0.8, peak: opts.peak ?? 0.8 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

/** Footstep — very short low thud. */
export function footstepRecipe(ctx, opts = {}) {
  const dur = 0.08;
  const buf = createNoiseBuffer(ctx, dur, 'brown', opts.seed ?? 71);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = biquad(ctx, 'lowpass', 600, 0.7, 0);
  const env = gain(ctx, 0);
  src.connect(filter); filter.connect(env);
  const t0 = ctx.currentTime;
  applyADSR(env.gain, t0, { attack: 0.001, decay: 0.02, sustain: 0.0, release: 0.05, peak: opts.peak ?? 0.3 });
  src.start(t0);
  return { bus: env, nodes: [src, filter, env], totalDuration: dur, stop: () => src.stop(t0 + dur) };
}

// ---------- ambient loop recipes (looped) ----------

/**
 * Build an ambient loop. Buffer is `loopDur` seconds; source.loop = true.
 * Returns a controller with `stop()` and `setLevel()`.
 */
export function ambientLoopRecipe(ctx, opts = {}) {
  const kind    = opts.kind    ?? 'pink';
  const dur     = opts.dur     ?? 4.0;
  const cutoff  = opts.cutoff  ?? 900;
  const lfoFreq = opts.lfoFreq ?? 0.1;
  const lfoDepth= opts.lfoDepth?? 80;
  const baseGain= opts.baseGain?? 0.18;

  const buf = createNoiseBuffer(ctx, dur, kind, opts.seed ?? 91);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = biquad(ctx, 'lowpass', cutoff, 0.6, 0);
  const env = gain(ctx, baseGain);
  src.connect(filter); filter.connect(env);
  src.start();
  const detachLFO = attachLFO(filter, ctx, lfoFreq, lfoDepth);
  return {
    bus: env,
    nodes: [src, filter, env],
    totalDuration: Infinity,
    stop: () => {
      try { src.stop(); } catch (_) {}
      try { src.disconnect(); } catch (_) {}
      try { filter.disconnect(); } catch (_) {}
      try { env.disconnect(); } catch (_) {}
      detachLFO();
    },
    setLevel(v) { env.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }
  };
}

/** Per-biome ambient configs. */
export const BIOME_AMBIENT_RECIPES = {
  desert:  (ctx) => ambientLoopRecipe(ctx, { kind: 'brown', cutoff: 700,  lfoFreq: 0.10, lfoDepth: 60, baseGain: 0.20 }),
  marsh:   (ctx) => ambientLoopRecipe(ctx, { kind: 'brown', cutoff: 380,  lfoFreq: 0.05, lfoDepth: 40, baseGain: 0.22 }),
  snow:    (ctx) => ambientLoopRecipe(ctx, { kind: 'pink',  cutoff: 1500, lfoFreq: 0.18, lfoDepth: 120, baseGain: 0.15 }),
  volcano: (ctx) => ambientLoopRecipe(ctx, { kind: 'brown', cutoff: 220,  lfoFreq: 0.13, lfoDepth: 50, baseGain: 0.25 }),
  forest:  (ctx) => ambientLoopRecipe(ctx, { kind: 'pink',  cutoff: 900,  lfoFreq: 0.12, lfoDepth: 90, baseGain: 0.18 }),
  plains:  (ctx) => ambientLoopRecipe(ctx, { kind: 'pink',  cutoff: 1100, lfoFreq: 0.10, lfoDepth: 70, baseGain: 0.16 }),
  mines:   (ctx) => ambientLoopRecipe(ctx, { kind: 'brown', cutoff: 500,  lfoFreq: 0.08, lfoDepth: 50, baseGain: 0.20 })
};

// Map for sfx/ambient dispatch tables
export const RECIPE_BUILDERS = {
  pluck: pluckRecipe,
  thud: thudRecipe,
  slash: slashRecipe,
  hurt: hurtRecipe,
  chime: chimeRecipe,
  click: clickRecipe,
  error: errorRecipe,
  death: deathRecipe,
  footstep: footstepRecipe
};
