/**
 * Wildwood v0.4 audio module — public surface.
 *
 * Default sound sources:
 * ----------------------
 * All sounds in v0.4 are procedurally synthesized via Web Audio API
 * (noise generators + biquad filters + ADSR envelopes + LFO modulation).
 * No third-party audio libraries and no external .ogg/.wav files are
 * required at this stage.
 *
 * When real assets become available (e.g. freesound.org CC0 clips),
 * swap the recipe entries via `registerRecipe(id, { kind: 'file', src: '...' })`
 * — see `assets/audio/README.md` for the recommended directory layout and
 * naming convention.
 */
'use strict';

export { AudioManager, sharedAudio, STORAGE_KEY, DEFAULTS } from './audio-manager.js';
export { AmbientController } from './ambient.js';
export { SfxDispatcher } from './sfx.js';
export { UiAudio } from './ui.js';
export { attach as attachAudio } from './integration.js';
export { AudioSettingsWidget, mountAudioSettings } from './audio-settings.js';
export {
  DEFAULT_RECIPES, getRecipe, getBiomeAmbient,
  listRecipeIds, listBiomeIds, registerRecipe
} from './registry.js';
export {
  BIOME_AMBIENT_RECIPES,
  pluckRecipe, thudRecipe, slashRecipe, hurtRecipe, chimeRecipe,
  clickRecipe, errorRecipe, deathRecipe, footstepRecipe, ambientLoopRecipe
} from './synth/recipe.js';
export { mulberry32, fillWhite, fillPink, fillBrown, createNoiseBuffer } from './synth/noise.js';
export { applyADSR, releaseADSR, ramp } from './synth/envelope.js';
export { biquad, attachLFO, makeDistortionCurve, gain as makeGain, convolver } from './synth/filter.js';
