/**
 * Catalog — loads and queries the resource/item/recipe tables.
 * Pure functions over frozen objects; no DOM.
 *
 * v1.0.1 — tool durability + regrow fields:
 *   isTool(itemId)        true for category=tool
 *   getToolType(itemId)   returns 'axe' / 'pickaxe' / 'shovel' / 'light' / null
 *   getMaxDurability(id)  null for non-tool, else the max durability
 *
 * v1.0.2 — shovel wired to diggable resources (dirt_mound, sapling, carrot,
 *   mushroom). New 'dig' resource category is metadata-only (no behavior
 *   difference from 'harvest' today, but lets future systems filter on it).
 *
 * v1.0.3 — resource depletion system:
 *   isDepletable(id)           true if the resource has finite harvests
 *   getMaxHarvests(id)         the max harvest count, or Infinity
 *   getDepletedTransformsTo(id)  resource id the entity becomes when depleted
 *                              (null = no transform, stays depleted forever)
 *
 * v1.0.4 — three-stage growth system:
 *   getGrowthStages(id)       array of {def, duration} for growth-capable
 *                             resources; null for single-stage resources
 *   getStageCount(id)         3 for growth-capable, 1 otherwise
 *   getStageDef(id, idx)      the resource def for stage idx (0-based)
 *   isGrowthCapable(id)       convenience: has growthStages array
 *
 *   Stage durations:
 *     duration > 0   — auto-advance to next stage after N seconds
 *     duration = -1  — terminal stage; entity stays here until harvested
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
 *
 * Shovel is required for dig-category resources (dirt_mound / sapling /
 * carrot) and accelerates mushroom collection. berry_bush / grass_tuft /
 * ice_shard / flower_patch are bare-handed.
 *
 * v1.0.3 — 4 new mine-only depletable resources (coal / gold_ore /
 * gem_vein / tin_ore) all require pickaxe.
 */
const _TOOL_COMPAT = {
  // axe — trees (incl. v1.0.4 growth stages)
  tree:                ['axe'],
  dead_tree:           ['axe'],
  tree_sprout:         ['axe'],
  tree_old:            ['axe'],
  dead_tree_sprout:    ['axe'],
  dead_tree_old:       ['axe'],
  // pickaxe
  rock:                ['pickaxe'],
  boulder:             ['pickaxe'],
  iron_ore:            ['pickaxe'],
  // v1.0.3 — depletable mines-only resources
  coal:                ['pickaxe'],
  gold_ore:            ['pickaxe'],
  gem_vein:            ['pickaxe'],
  tin_ore:             ['pickaxe'],
  // shovel
  dirt_mound:          ['shovel'],
  sapling:             ['shovel'],
  carrot:              ['shovel'],
  mushroom:            ['shovel', null],   // shovel or bare hands
  // bare hands
  berry_bush:          [null],
  grass_tuft_harvest:  [null],
  ice_shard:           [null],             // bare hands (or pickaxe, but bare works)
  flower_patch:        [null],
  // v1.0.4 — bush growth stages (bare hands)
  berry_sprout:        [null],
  berry_bush_old:      [null]
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
  // If a tool is equipped: prefer 'compatible' if its type is in the allowed
  // list. If it's a tool but not allowed, return 'wrong_tool' UNLESS bare
  // hands are also allowed (then the player can still gather bare-handed,
  // but the tool is wrong and the gather step should not damage it).
  if (toolId != null) {
    if (!isTool(toolId)) return 'wrong_tool';
    const t = getToolType(toolId);
    if (allowed.includes(t)) return 'compatible';
    if (allowed.includes(null)) return 'no_tool_required';
    return 'wrong_tool';
  }
  // No tool equipped.
  if (allowed.includes(null)) return 'no_tool_required';
  return 'tool_required';
}

/**
 * Tool types that can speed up / interact with a given resource. null entry
 * indicates bare-handed compatibility. Returns [] for unknown ids.
 */
export function allowedTools(resourceId) {
  const allowed = _TOOL_COMPAT[resourceId];
  if (allowed === undefined) return [];
  return allowed.slice();
}

/**
 * v1.0.3 — resource depletion.
 *
 * A resource is "depletable" if it has a finite maxHarvests. Once a node
 * has been harvested that many times, it transitions to a permanent
 * depleted state (regrowAt = 0 forever). If depletedTransformsTo is set,
 * the entity mutates in place into the target resource id (e.g. gold_ore
 * becomes rock after 2 harvests, so the spot is still useful for stone).
 *
 * Resources without maxHarvests (or with Infinity) never deplete; they
 * behave as before (regrow after regrowTime).
 */
export function isDepletable(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return false;
  return Number.isFinite(r.maxHarvests) && r.maxHarvests > 0;
}

export function getMaxHarvests(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r || !Number.isFinite(r.maxHarvests)) return Infinity;
  return r.maxHarvests;
}

export function getDepletedTransformsTo(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return null;
  return r.depletedTransformsTo || null;
}

/**
 * v1.0.4 — three-stage growth.
 *
 * A resource is "growth-capable" if it has a `growthStages` array. Each
 * stage is a {def, duration} entry: duration > 0 means the entity
 * auto-advances to the next stage after N seconds; duration = -1 marks
 * a terminal stage (entity stays until harvested).
 *
 * Single-stage resources (no growthStages) return null / 1 / null respectively.
 */
export function isGrowthCapable(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return false;
  return Array.isArray(r.growthStages) && r.growthStages.length > 0;
}

export function getGrowthStages(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r || !Array.isArray(r.growthStages)) return null;
  return r.growthStages;
}

export function getStageCount(resourceId) {
  const stages = getGrowthStages(resourceId);
  return stages ? stages.length : 1;
}

/**
 * Return the def for a given stage index of a resource. For single-stage
 * resources (no growthStages), only idx=0 is valid and it returns the
 * resource's own def.
 */
export function getStageDef(resourceId, stageIndex) {
  const stages = getGrowthStages(resourceId);
  if (stages) {
    const s = stages[stageIndex];
    if (!s) throw new Error(`Resource "${resourceId}" has no stage ${stageIndex}`);
    return getResource(s.def);
  }
  if (stageIndex !== 0) {
    throw new Error(`Single-stage resource "${resourceId}" has no stage ${stageIndex}`);
  }
  return getResource(resourceId);
}

export function validateCatalog() {
  const itemIds = new Set(Object.keys(_ITEMS));
  const resourceIds = new Set(Object.keys(_RESOURCES));
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
    // v1.0.3 — maxHarvests is optional; if present must be a positive integer
    if (r.maxHarvests != null) {
      if (!Number.isFinite(r.maxHarvests) || r.maxHarvests < 1 || !Number.isInteger(r.maxHarvests)) {
        throw new Error(`Resource "${r.id}" maxHarvests must be a positive integer`);
      }
    }
    // v1.0.3 — depletedTransformsTo must reference an existing resource
    if (r.depletedTransformsTo != null) {
      if (!resourceIds.has(r.depletedTransformsTo)) {
        throw new Error(`Resource "${r.id}" depletedTransformsTo references unknown resource "${r.depletedTransformsTo}"`);
      }
    }
    // v1.0.4 — growthStages validation
    if (r.growthStages != null) {
      if (!Array.isArray(r.growthStages)) {
        throw new Error(`Resource "${r.id}" growthStages must be an array`);
      }
      if (r.growthStages.length !== 3) {
        throw new Error(`Resource "${r.id}" growthStages must have exactly 3 entries (got ${r.growthStages.length})`);
      }
      for (let i = 0; i < r.growthStages.length; i++) {
        const s = r.growthStages[i];
        if (!s || typeof s !== 'object') {
          throw new Error(`Resource "${r.id}" growthStages[${i}] must be an object`);
        }
        if (typeof s.def !== 'string' || !resourceIds.has(s.def)) {
          throw new Error(`Resource "${r.id}" growthStages[${i}].def must reference an existing resource (got "${s.def}")`);
        }
        if (typeof s.duration !== 'number' || (s.duration < 0 && s.duration !== -1)) {
          throw new Error(`Resource "${r.id}" growthStages[${i}].duration must be a non-negative number or -1 for terminal (got ${s.duration})`);
        }
      }
      // Last stage must be terminal (duration = -1)
      if (r.growthStages[2].duration !== -1) {
        throw new Error(`Resource "${r.id}" growthStages[2] (terminal stage) must have duration = -1`);
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
