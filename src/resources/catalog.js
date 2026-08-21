/**
 * Catalog — loads and queries the resource/item/recipe tables.
 * Pure functions over frozen objects; no DOM.
 *
 * v1.0.1 — tool durability + regrow fields:
 *   isTool(itemId)        true for category=tool
 *   getToolType(itemId)   returns 'axe' / 'pickaxe' / 'shovel' / 'light' / null
 *   getMaxDurability(id)  null for non-tool, else the max durability
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

export function isTool(itemId) {
  if (!itemId) return false;
  const it = _ITEMS[itemId];
  return !!(it && it.category === 'tool');
}

export function getToolType(itemId) {
  if (!isTool(itemId)) return null;
  return _ITEMS[itemId].toolType || null;
}

export function getMaxDurability(itemId) {
  if (!isTool(itemId)) return null;
  return _ITEMS[itemId].maxDurability || 0;
}

/**
 * Which tool types can harvest which resource kinds.
 * null = bare hands (any resource can be gathered without a tool).
 */
const _TOOL_COMPAT = {
  tree:           ['axe'],
  dead_tree:      ['axe'],
  rock:           ['pickaxe'],
  boulder:        ['pickaxe'],
  iron_ore:       ['pickaxe'],
  berry_bush:     [null],   // bare hands
  grass_tuft_harvest: [null],
  ice_shard:      [null]    // bare hands (or pickaxe, but bare works)
};

/**
 * Returns:
 *   'no_tool_required'  if the resource can be gathered bare-handed
 *   'compatible'        if the equipped tool is allowed for this resource
 *   'wrong_tool'        if the tool exists but is not the right type
 *   'tool_required'     if the resource needs a tool but none is equipped
 */
export function checkTool(resourceId, toolId) {
  const allowed = _TOOL_COMPAT[resourceId];
  if (allowed === undefined) return 'compatible';  // unknown resource id, fail open
  if (allowed.includes(null)) return 'no_tool_required';
  if (toolId == null) return 'tool_required';
  if (!isTool(toolId)) return 'wrong_tool';
  const t = getToolType(toolId);
  return allowed.includes(t) ? 'compatible' : 'wrong_tool';
}

export function validateCatalog() {
  const itemIds = new Set(Object.keys(_ITEMS));
  for (const r of Object.values(_RESOURCES)) {
    for (const d of r.drops || []) {
      if (!itemIds.has(d.itemId)) {
        throw new Error(`Resource "${r.id}" drops unknown item "${d.itemId}"`);
      }
    }
    // regrowTime is optional; if present must be a non-negative number
    if (r.regrowTime != null && (typeof r.regrowTime !== 'number' || r.regrowTime < 0)) {
      throw new Error(`Resource "${r.id}" regrowTime must be a non-negative number`);
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
  for (const it of Object.values(_ITEMS)) {
    if (it.category === 'tool') {
      if (typeof it.maxDurability !== 'number' || it.maxDurability <= 0) {
        throw new Error(`Tool "${it.id}" must have a positive maxDurability`);
      }
    } else if (it.maxDurability != null) {
      throw new Error(`Non-tool "${it.id}" must not have maxDurability`);
    }
  }
  return true;
}
