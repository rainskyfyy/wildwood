/**
 * Catalog — loads and queries the resource/item/recipe tables.
 * Pure functions over frozen objects; no DOM.
 */
'use strict';

import resourcesRaw from './resources.json' with { type: 'json' };
import itemsRaw     from './items.json'     with { type: 'json' };
import recipesRaw   from './recipes.json'   with { type: 'json' };

const _stripMeta = (o) => {
  const out = {};
  for (const k of Object.keys(o)) if (k !== '_meta') out[k] = o[k];
  return Object.freeze(out);
};

const _RESOURCES = _stripMeta(resourcesRaw);
const _ITEMS     = _stripMeta(itemsRaw);
const _RECIPES   = _stripMeta(recipesRaw);

export function getResource(id) {
  const r = _RESOURCES[id];
  if (!r) throw new Error(`Unknown resource: ${id}`);
  return r;
}
export function allResources() { return Object.values(_RESOURCES); }
export function resourcesForBiome(biomeId) {
  return Object.values(_RESOURCES).filter(r => r.biomes.includes(biomeId));
}
export function getItem(id) {
  const it = _ITEMS[id];
  if (!it) throw new Error(`Unknown item: ${id}`);
  return it;
}
export function allItems() { return Object.values(_ITEMS); }
export function getRecipe(id) {
  const r = _RECIPES[id];
  if (!r) throw new Error(`Unknown recipe: ${id}`);
  return r;
}
export function allRecipes() { return Object.values(_RECIPES); }
export function recipesForStation(station) {
  return Object.values(_RECIPES).filter(r => r.station === station);
}

export function validateCatalog() {
  const itemIds = new Set(Object.keys(_ITEMS));
  for (const r of Object.values(_RESOURCES)) {
    for (const d of r.drops || []) {
      if (!itemIds.has(d.itemId)) {
        throw new Error(`Resource "${r.id}" drops unknown item "${d.itemId}"`);
      }
    }
  }
  for (const r of Object.values(_RECIPES)) {
    const { grid, pattern } = r;
    const expected = grid === '2x2' ? 2 : 3;
    if (!Array.isArray(pattern) || pattern.length !== expected) {
      throw new Error(`Recipe "${r.id}" pattern must be ${expected}x${expected}`);
    }
    for (const row of pattern) {
      if (row.length !== expected) {
        throw new Error(`Recipe "${r.id}" pattern row width != ${expected}`);
      }
      for (const cell of row) {
        if (cell !== '' && !itemIds.has(cell)) {
          throw new Error(`Recipe "${r.id}" references unknown item "${cell}"`);
        }
      }
    }
    if (!itemIds.has(r.output.itemId)) {
      throw new Error(`Recipe "${r.id}" outputs unknown item "${r.output.itemId}"`);
    }
  }
  return true;
}
