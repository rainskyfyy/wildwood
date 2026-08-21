/**
 * Envelope helpers — schedule ADSR / ramp on AudioParam.
 * All time arguments are in seconds, absolute ctx.currentTime relative.
 */
'use strict';

/**
 * Apply ADSR envelope to an AudioParam. Schedules attack/decay/sustain/release.
 * `env` shape: { attack, decay, sustain, release, peak? } — sustain is 0..1.
 * Returns total envelope duration (used to schedule node stop).
 */
export function applyADSR(param, t0, env) {
  const a = Math.max(0.001, env.attack  ?? 0.01);
  const d = Math.max(0.001, env.decay   ?? 0.05);
  const s = Math.max(0,     Math.min(1, env.sustain ?? 0.7));
  const r = Math.max(0.001, env.release ?? 0.1);
  const peak = (env.peak != null) ? env.peak : (param.value > 0 ? param.value : 1);
  const sustainLevel = peak * s;

  param.cancelScheduledValues(t0);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak,    t0 + a);
  param.linearRampToValueAtTime(sustainLevel, t0 + a + d);
  return a + d + r; // total to release end
}

/** Release a previously-adsr'd param back to zero over `releaseSec`. */
export function releaseADSR(param, t0, env) {
  const r = Math.max(0.001, env.release ?? 0.1);
  const s = Math.max(0, Math.min(1, env.sustain ?? 0.7));
  const peak = (env.peak != null) ? env.peak : 1;
  param.cancelScheduledValues(t0);
  param.setValueAtTime(peak * s, t0);
  param.linearRampToValueAtTime(0, t0 + r);
  return t0 + r;
}

/** Linear ramp from current value to `to` over duration. */
export function ramp(param, t0, to, duration) {
  param.cancelScheduledValues(t0);
  const v = (typeof param.value === 'number') ? param.value : 0;
  param.setValueAtTime(v, t0);
  param.linearRampToValueAtTime(to, t0 + duration);
  return t0 + duration;
}
