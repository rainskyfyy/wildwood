/**
 * AmbientController — debounced biome transitions for the BGM channel.
 */
'use strict';

import { listBiomeIds } from './registry.js';

const SMOOTH_DEBOUNCE_MS = 250;

export class AmbientController {
  constructor(audio, opts = {}) {
    this.audio = audio;
    this.currentBiome = null;
    this.lastSwitchAt = 0;
    this.debounceMs = opts.debounceMs ?? SMOOTH_DEBOUNCE_MS;
    this.onChange = opts.onChange || null;
  }

  /** Call on every frame with the player's current biome id. */
  updateBiome(biomeId) {
    if (!biomeId) return;
    if (this.currentBiome === biomeId) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - this.lastSwitchAt < this.debounceMs) return;
    this._apply(biomeId);
  }

  /** Force switch (no debounce). */
  onBiomeChange(biomeId) { this._apply(biomeId); }

  _apply(biomeId) {
    if (!listBiomeIds().includes(biomeId) && biomeId !== 'plains') {
      biomeId = 'plains';
    }
    this.currentBiome = biomeId;
    this.lastSwitchAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (this.audio && this.audio.started) this.audio.loopBiome(biomeId);
    if (this.onChange) {
      try { this.onChange(biomeId); } catch (_) { /* listener error swallowed */ }
    }
  }

  reset() { this.currentBiome = null; this.lastSwitchAt = 0; }
}
