/**
 * SfxDispatcher — convenience façade with throttled footstep and
 * game-event mapping. Pure mapping; no state beyond the throttle.
 */
'use strict';

const FOOTSTEP_MIN_INTERVAL_MS = 180;

export class SfxDispatcher {
  constructor(audio, opts = {}) {
    this.audio = audio;
    this._lastFootstepAt = 0;
    this._minFootstepMs = opts.minFootstepMs ?? FOOTSTEP_MIN_INTERVAL_MS;
  }

  /** Throttled footstep — call when the player has moved. */
  onFootstep() {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - this._lastFootstepAt < this._minFootstepMs) return false;
    this._lastFootstepAt = now;
    this.audio && this.audio.play && this.audio.play('footstep');
    return true;
  }

  // ----- gather -----
  onGatherStart()  { this.audio && this.audio.play && this.audio.play('pickup', { peak: 0.25 }); }
  onGatherComplete(){ this.audio && this.audio.play && this.audio.play('gather'); }
  onGatherCancel()  { /* no-op (gathers either finish or are interrupted) */ }

  // ----- build -----
  onBuildPlace()  { this.audio && this.audio.play && this.audio.play('build_place'); }
  onBuildFail()   { this.audio && this.audio.play && this.audio.play('build_fail'); }
  onBuildRemove() { this.audio && this.audio.play && this.audio.play('build_remove'); }
  onBuildMenuOpen()  { this.audio && this.audio.play && this.audio.play('ui_open'); }
  onBuildMenuClose() { this.audio && this.audio.play && this.audio.play('ui_close'); }

  // ----- combat -----
  onAttack() { this.audio && this.audio.play && this.audio.play('attack'); }
  onHurt()   { this.audio && this.audio.play && this.audio.play('hurt'); }
  onDeath()  { this.audio && this.audio.play && this.audio.play('death'); }

  // ----- inventory / crafting -----
  onCraft()  { this.audio && this.audio.play && this.audio.play('craft'); }
  onPickup() { this.audio && this.audio.play && this.audio.play('pickup'); }
}
