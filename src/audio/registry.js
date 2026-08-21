/**
 * Sound registry — maps event ids to recipe builders (or file-backed
 * entries via override). Central place to extend with real OGG/WAV files.
 */
'use strict';

import {
  pluckRecipe, thudRecipe, slashRecipe, hurtRecipe, chimeRecipe,
  clickRecipe, errorRecipe, deathRecipe, footstepRecipe,
  BIOME_AMBIENT_RECIPES
} from './synth/recipe.js';

/**
 * Each entry is one of:
 *   { kind: 'recipe', build: (ctx, opts) => Recipe }
 *   { kind: 'recipe', variants: [(ctx, opts) => Recipe, ...] }
 *   { kind: 'file', src: 'assets/audio/foo.ogg', volume?: number }
 *
 * `volume` (default 1) scales the output bus.
 */
export const DEFAULT_RECIPES = {
  // gather — 3 wood/leaf/stone variants
  gather: { kind: 'recipe', variants: [
    (ctx, o = {}) => pluckRecipe(ctx, { ...o, freq: 800, peak: 0.7 }),
    (ctx, o = {}) => pluckRecipe(ctx, { ...o, freq: 650, peak: 0.6 }),
    (ctx, o = {}) => thudRecipe(ctx,  { ...o, peak: 0.65 })
  ] },

  // build
  build_place: { kind: 'recipe', build: (ctx, o = {}) => thudRecipe(ctx, { ...o, peak: 0.75 }) },
  build_fail:  { kind: 'recipe', build: (ctx, o = {}) => errorRecipe(ctx, o) },
  build_remove:{ kind: 'recipe', build: (ctx, o = {}) => pluckRecipe(ctx, { ...o, freq: 500, peak: 0.5 }) },

  // combat
  attack: { kind: 'recipe', build: (ctx, o = {}) => slashRecipe(ctx, o) },
  hurt:   { kind: 'recipe', build: (ctx, o = {}) => hurtRecipe(ctx, o) },
  death:  { kind: 'recipe', build: (ctx, o = {}) => deathRecipe(ctx, o) },

  // inventory / crafting
  craft:  { kind: 'recipe', build: (ctx, o = {}) => chimeRecipe(ctx, { ...o, freq: 660 }) },
  pickup: { kind: 'recipe', build: (ctx, o = {}) => chimeRecipe(ctx, { ...o, freq: 1100, peak: 0.4 }) },

  // movement
  footstep: { kind: 'recipe', build: (ctx, o = {}) => footstepRecipe(ctx, o) },

  // UI
  ui_click: { kind: 'recipe', build: (ctx, o = {}) => clickRecipe(ctx, o) },
  ui_hover: { kind: 'recipe', build: (ctx, o = {}) => clickRecipe(ctx, { ...o, peak: 0.18 }) },
  ui_open:  { kind: 'recipe', build: (ctx, o = {}) => pluckRecipe(ctx, { ...o, freq: 700, peak: 0.35 }) },
  ui_close: { kind: 'recipe', build: (ctx, o = {}) => pluckRecipe(ctx, { ...o, freq: 500, peak: 0.30 }) },
  ui_error: { kind: 'recipe', build: (ctx, o = {}) => errorRecipe(ctx, o) }
};

/** Resolve a registered id to a single recipe builder. Picks random for `variants`. */
export function getRecipe(id) {
  const entry = DEFAULT_RECIPES[id];
  if (!entry) return null;
  if (entry.kind !== 'recipe') return null;
  if (Array.isArray(entry.variants)) {
    const i = Math.floor(Math.random() * entry.variants.length);
    return entry.variants[i];
  }
  return entry.build;
}

/** Get a biome ambient builder. */
export function getBiomeAmbient(biomeId) {
  return BIOME_AMBIENT_RECIPES[biomeId] || BIOME_AMBIENT_RECIPES.plains;
}

/** List all registered recipe ids. */
export function listRecipeIds() {
  return Object.keys(DEFAULT_RECIPES);
}

/** List known biome ids. */
export function listBiomeIds() {
  return Object.keys(BIOME_AMBIENT_RECIPES);
}

/** Override a recipe entry — useful for file-backed assets. */
export function registerRecipe(id, entry) {
  DEFAULT_RECIPES[id] = entry;
}
