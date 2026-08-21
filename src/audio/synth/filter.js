/**
 * Filter factory + LFO modulation helpers.
 */
'use strict';

/** BiquadFilterNode factory. Falls back to a stub when no ctx. */
export function biquad(ctx, type = 'lowpass', freq = 1000, Q = 1, gain = 0) {
  if (ctx && typeof ctx.createBiquadFilter === 'function') {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  }
  return makeStubFilter(type, freq, Q, gain);
}

/** Oscillator + Gain → filter.frequency modulator. Returns disconnect fn. */
export function attachLFO(filter, ctx, lfoFreq = 4, depthHz = 100) {
  if (!ctx || typeof ctx.createOscillator !== 'function') return () => {};
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = lfoFreq;
  gain.gain.value = depthHz;
  osc.connect(gain);
  // Filter may be a stub in tests; in production AudioParam.connect exists
  if (filter && filter.frequency && typeof filter.frequency.connect === 'function') {
    gain.connect(filter.frequency);
  }
  osc.start();
  return () => {
    try { osc.stop(); } catch (_) { /* already stopped */ }
    try { osc.disconnect(); } catch (_) {}
    try { gain.disconnect(); } catch (_) {}
  };
}

/** Make a WaveShaper distortion curve. */
export function makeDistortionCurve(amount = 50, samples = 1024) {
  const n = samples;
  const curve = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/** ConvolverNode factory (returns a stub if no ctx). */
export function convolver(ctx, buffer = null) {
  if (ctx && typeof ctx.createConvolver === 'function') {
    const c = ctx.createConvolver();
    if (buffer) c.buffer = buffer;
    return c;
  }
  return makeStubNode('convolver');
}

/** GainNode factory. */
export function gain(ctx, value = 1) {
  if (ctx && typeof ctx.createGain === 'function') {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  }
  return makeStubNode('gain', { value });
}

// ---------- test/no-ctx fallbacks ----------

function makeStubFilter(type, freq, Q, gainVal) {
  return {
    type,
    frequency: makeStubParam(freq),
    Q: makeStubParam(Q),
    gain: makeStubParam(gainVal),
    connect() {},
    disconnect() {}
  };
}

function makeStubParam(initial) {
  const p = makeStubNode('param', { value: initial });
  p.value = initial;
  p.setValueAtTime = () => {};
  p.linearRampToValueAtTime = () => {};
  p.exponentialRampToValueAtTime = () => {};
  p.setTargetAtTime = () => {};
  p.cancelScheduledValues = () => {};
  p.connect = () => {};
  p.disconnect = () => {};
  return p;
}

function makeStubNode(kind, opts = {}) {
  return Object.assign({ kind, ...opts }, {
    connect() {}, disconnect() {}
  });
}
