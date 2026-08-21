/**
 * AudioManager — singleton wrapper around Web Audio API.
 *
 * - BGM channel (masterBGM → lowpass + LFO + ambient source)
 * - SFX channel (masterSFX → one-shots)
 * - Persistence via localStorage under `wildwood.audio.v1`
 * - Lazy AudioContext (not created until `start()` after user gesture)
 * - Safe in non-browser environments (no-op fallbacks for tests)
 */
'use strict';

import { getRecipe, getBiomeAmbient } from './registry.js';
import { biquad, attachLFO, gain as makeGain } from './synth/filter.js';

export const STORAGE_KEY = 'wildwood.audio.v1';
export const DEFAULTS = Object.freeze({
  bgmVolume: 0.6,
  sfxVolume: 0.8,
  masterMute: false
});

const HARD_TAIL_S = 10.0; // safety: never keep a node connected longer than this

function loadPersisted() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      bgmVolume:    clamp01(parsed.bgmVolume    ?? DEFAULTS.bgmVolume),
      sfxVolume:    clamp01(parsed.sfxVolume    ?? DEFAULTS.sfxVolume),
      masterMute:   !!(parsed.masterMute ?? DEFAULTS.masterMute)
    };
  } catch (_) { return { ...DEFAULTS }; }
}

function persist(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* quota / private mode */ }
}

function clamp01(v) { return Math.max(0, Math.min(1, +v || 0)); }

export class AudioManager {
  constructor() {
    this.state = loadPersisted();
    this.ctx = null;
    this.started = false;
    // channel busses
    this.bgmBus = null;
    this.sfxBus = null;
    this.masterBgmGain = null;
    this.masterSfxGain = null;
    this.bgmFilter = null;
    this.bgmLfoDetach = null;
    this.currentAmbient = null;
    this.currentBiome = null;
    this._disconnectTimers = new Set();
  }

  /** Lazily create the AudioContext (requires a user gesture upstream). */
  start() {
    if (this.started) return true;
    if (typeof window === 'undefined') return false;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      this.ctx = new Ctx();
      // master → destination
      this.masterBgmGain = this.ctx.createGain();
      this.masterSfxGain = this.ctx.createGain();
      this.masterBgmGain.gain.value = this.state.masterMute ? 0 : this.state.bgmVolume;
      this.masterSfxGain.gain.value = this.state.masterMute ? 0 : this.state.sfxVolume;
      this.masterBgmGain.connect(this.ctx.destination);
      this.masterSfxGain.connect(this.ctx.destination);
      // BGM bus with lowpass + LFO for sanity distortion
      this.bgmBus = this.ctx.createGain();
      this.bgmBus.gain.value = 1.0;
      this.bgmFilter = biquad(this.ctx, 'lowpass', 22050, 0.5, 0);
      this.bgmBus.connect(this.bgmFilter).connect(this.masterBgmGain);
      // SFX bus
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1.0;
      this.sfxBus.connect(this.masterSfxGain);
      this.started = true;
      return true;
    } catch (e) {
      // AudioContext blocked / unavailable
      this.ctx = null;
      return false;
    }
  }

  /** Resume if suspended (autoplay policy). */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) {}
    }
  }

  // ---------- BGM ----------

  /** Switch (or start) the biome ambient loop. */
  loopBiome(biomeId, opts = {}) {
    if (!this.started) return;
    if (this.currentBiome === biomeId && this.currentAmbient) return;
    this.stopAmbient();
    const builder = getBiomeAmbient(biomeId);
    if (!builder) return;
    const ctrl = builder(this.ctx, opts);
    if (!ctrl || !ctrl.bus) return;
    try { ctrl.bus.connect(this.bgmBus); } catch (_) { return; }
    this.currentAmbient = ctrl;
    this.currentBiome = biomeId;
  }

  stopAmbient() {
    if (this.currentAmbient) {
      try { this.currentAmbient.stop && this.currentAmbient.stop(); } catch (_) {}
      this.currentAmbient = null;
    }
    this.currentBiome = null;
  }

  // ---------- SFX ----------

  /** Play a one-shot. Returns true if dispatched. */
  play(id, opts = {}) {
    if (!this.started) return false;
    const builder = getRecipe(id);
    if (!builder) return false;
    let ctrl;
    try { ctrl = builder(this.ctx, opts); }
    catch (_) { return false; }
    if (!ctrl || !ctrl.bus) return false;
    try { ctrl.bus.connect(this.sfxBus); } catch (_) { return false; }
    this._scheduleDisconnect(ctrl);
    return true;
  }

  _scheduleDisconnect(ctrl) {
    const tail = Math.min(HARD_TAIL_S, (ctrl.totalDuration || 0) + 0.05);
    const t = setTimeout(() => {
      try { ctrl.stop && ctrl.stop(); } catch (_) {}
      try { ctrl.bus && ctrl.bus.disconnect && ctrl.bus.disconnect(); } catch (_) {}
      this._disconnectTimers.delete(t);
    }, Math.max(50, tail * 1000));
    this._disconnectTimers.add(t);
  }

  // ---------- dynamic mixing: sanity distortion ----------

  /**
   * `amount` is 0 (sane) .. 1 (insane). Applies:
   *   - BGM lowpass cutoff: 22050 → 800 Hz
   *   - LFO depth: 0 → 250 Hz
   *   - SFX bus gain: ×(1 - 0.3 * amount)
   */
  setSanityAmount(amount) {
    if (!this.started) return;
    const a = Math.max(0, Math.min(1, +amount || 0));
    const t = this.ctx.currentTime;
    // filter cutoff: pow interpolation 22050 → 800
    const cutoff = 22050 * Math.pow(800 / 22050, a);
    this.bgmFilter.frequency.setTargetAtTime(cutoff, t, 0.1);
    // LFO modulation
    if (this.bgmLfoDetach) this.bgmLfoDetach();
    this.bgmLfoDetach = attachLFO(this.bgmFilter, this.ctx, 0.8 + a * 1.5, a * 250);
    // SFX ducking
    const sfxDucked = 1 - 0.3 * a;
    this.sfxBus.gain.setTargetAtTime(sfxDucked, t, 0.1);
  }

  // ---------- volume / mute ----------

  setBgmVolume(v) {
    this.state.bgmVolume = clamp01(v);
    if (this.started) this.masterBgmGain.gain.setTargetAtTime(
      this.state.masterMute ? 0 : this.state.bgmVolume, this.ctx.currentTime, 0.05);
    persist(this.state);
  }
  getBgmVolume() { return this.state.bgmVolume; }

  setSfxVolume(v) {
    this.state.sfxVolume = clamp01(v);
    if (this.started) this.masterSfxGain.gain.setTargetAtTime(
      this.state.masterMute ? 0 : this.state.sfxVolume, this.ctx.currentTime, 0.05);
    persist(this.state);
  }
  getSfxVolume() { return this.state.sfxVolume; }

  setMuted(m) {
    this.state.masterMute = !!m;
    if (this.started) {
      this.masterBgmGain.gain.setTargetAtTime(m ? 0 : this.state.bgmVolume, this.ctx.currentTime, 0.05);
      this.masterSfxGain.gain.setTargetAtTime(m ? 0 : this.state.sfxVolume, this.ctx.currentTime, 0.05);
    }
    persist(this.state);
  }
  isMuted() { return this.state.masterMute; }

  // ---------- teardown ----------

  dispose() {
    for (const t of this._disconnectTimers) clearTimeout(t);
    this._disconnectTimers.clear();
    this.stopAmbient();
    if (this.bgmLfoDetach) { this.bgmLfoDetach(); this.bgmLfoDetach = null; }
    if (this.ctx) {
      try { this.ctx.close(); } catch (_) {}
    }
    this.ctx = null;
    this.started = false;
  }
}

let _shared = null;
/** Shared singleton accessor. */
export function sharedAudio() {
  if (!_shared) _shared = new AudioManager();
  return _shared;
}
