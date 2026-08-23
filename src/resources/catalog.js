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
 * v1.1.0 — gridKind(recipe.grid) returns shape descriptor.
 *   - 1x1 / 1x2 / 1x3 / 1x4 -> { kind: 'line', size: 1|2|3|4 }
 *   - 2x2 -> { kind: 'square', size: 2 }
 *   - 3x3 -> { kind: 'square', size: 3 }
 *   - anything else -> { kind: 'unknown', size: 0 }
 */
export function gridKind(grid) {
  if (typeof grid === 'string') {
    if (grid === '1x1') return { kind: 'line', size: 1 };
    if (grid === '1x2') return { kind: 'line', size: 2 };
    if (grid === '1x3') return { kind: 'line', size: 3 };
    if (grid === '1x4') return { kind: 'line', size: 4 };
    if (grid === '2x2') return { kind: 'square', size: 2 };
    if (grid === '3x3') return { kind: 'square', size: 3 };
  }
  return { kind: 'unknown', size: 0 };
}

// ---------- v1.1.0 — three-stage growth system (M2.10e) ----------

/**
 * A resource is "growth-capable" when it has a `growthStages` array of
 * length >= 2. Each stage entry has:
 *   { def: <resourceId used at this stage>, duration: <seconds, -1 = terminal> }
 *
 * The last stage is considered terminal (duration <= 0 means it never
 * advances). Non-growth-capable resources are single-stage and trivially
 * terminal.
 */
export function isGrowthCapable(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return false;
  return Array.isArray(r.growthStages) && r.growthStages.length >= 2;
}

export function getGrowthStages(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return null;
  return r.growthStages || null;
}

export function getStageCount(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return 0;
  return r.growthStages ? r.growthStages.length : 1;
}

/**
 * Returns the resource descriptor used at the given stage. For a single-
 * stage resource, stage 0 returns the resource itself. Throws if stage is
 * out of range.
 */
export function getStageDef(resourceId, stage) {
  const r = _RESOURCES[resourceId];
  if (!r) throw new Error(`Unknown resource: ${resourceId}`);
  if (!r.growthStages) {
    if (stage === 0) return r;
    throw new Error(`Resource "${resourceId}" has no stage ${stage}`);
  }
  if (stage < 0 || stage >= r.growthStages.length) {
    throw new Error(`Resource "${resourceId}" has no stage ${stage}`);
  }
  const defId = r.growthStages[stage].def;
  const def = _RESOURCES[defId];
  if (!def) {
    throw new Error(`Stage ${stage} of "${resourceId}" references unknown def "${defId}"`);
  }
  return def;
}

/**
 * A resource is "depletable" when it has a positive `maxHarvests` field.
 * When its harvestCount reaches maxHarvests and a regrow completes, the
 * entity transforms to the resource named in `depletedTransformsTo`
 * (or stays as the same resource when null).
 */
export function isDepletable(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return false;
  return typeof r.maxHarvests === 'number' && r.maxHarvests > 0;
}

export function getMaxHarvests(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return Infinity;
  if (typeof r.maxHarvests === 'number' && r.maxHarvests > 0) return r.maxHarvests;
  return Infinity;
}

export function getDepletedTransformsTo(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return null;
  return r.depletedTransformsTo || null;
}

/**
 * Which tool types can harvest which resource kinds.
 * null = bare hands (any resource can be gathered without a tool).
 *
 * Shovel is required for dig-category resources (dirt_mound / sapling /
 * carrot) and accelerates mushroom collection. berry_bush / grass_tuft /
 * ice_shard / flower_patch are bare-handed.
 */
const _TOOL_COMPAT = {
  // axe
  tree:                ['axe'],
  dead_tree:           ['axe'],
  // pickaxe
  rock:                ['pickaxe'],
  boulder:             ['pickaxe'],
  iron_ore:            ['pickaxe'],
  // shovel
  dirt_mound:          ['shovel'],
  sapling:             ['shovel'],
  carrot:              ['shovel'],
  mushroom:            ['shovel', null],   // shovel or bare hands
  // bare hands
  berry_bush:          [null],
  grass_tuft_harvest:  [null],
  ice_shard:           [null],             // bare hands (or pickaxe, but bare works)
  flower_patch:        [null]
};

/**
 * Returns:
 *   'no_tool_required'  if the resource can be gathered bare-handed
 *   'compatible'        if the equipped tool is allowed for this resource
 *   'wrong_tool'        if the tool exists but is not the right type
 *   'tool_required'     if the resource needs a tool but none is equipped
 */
/**
 * Resolve a stage id (e.g. 'tree_sprout', 'tree_old') back to its parent
 * root id (e.g. 'tree'). If resourceId is already a root id (no parent
 * references it as a stage def), returns resourceId as-is.
 */
function _findRootId(resourceId) {
  const r = _RESOURCES[resourceId];
  if (!r) return resourceId;
  // If this resource is referenced as a stage of another resource, the
  // parent is the root. Walk the catalog and check.
  for (const candidate of Object.values(_RESOURCES)) {
    if (Array.isArray(candidate.growthStages)) {
      for (const s of candidate.growthStages) {
        if (s.def === resourceId) return candidate.id;
      }
    }
  }
  return resourceId;
}

export function checkTool(resourceId, toolId) {
  // Growth-capable stages (e.g. 'tree_sprout', 'tree_old') aren't in
  // _TOOL_COMPAT directly — resolve them back to the parent root id
  // (e.g. 'tree') so a stage 0 sprout still respects the parent's tool
  // compatibility.
  const rootId = _findRootId(resourceId);
  const allowed = _TOOL_COMPAT[rootId];
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
  const rootId = _findRootId(resourceId);
  const allowed = _TOOL_COMPAT[rootId];
  if (allowed === undefined) return [];
  return allowed.slice();
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
    // v1.1.0 — accept both 2D (2x2/3x3) and 1D (1x1/1x2/1x3/1x4) grids.
    const dim1D = (g) => g === '1x1' ? 1 : g === '1x2' ? 2 : g === '1x3' ? 3 : g === '1x4' ? 4 : null;
    const dim2D = (g) => g === '2x2' ? 2 : g === '3x3' ? 3 : null;
    if (dim1D(grid) !== null) {
      // 1D pattern: flat array of strings, length 1..4.
      const expected = dim1D(grid);
      if (!Array.isArray(pattern) || pattern.length !== expected) {
        throw new Error(`Recipe "${r.id}" pattern must be length ${expected} (1D)`);
      }
      for (const cell of pattern) {
        if (typeof cell !== 'string') {
          throw new Error(`Recipe "${r.id}" pattern cells must be strings`);
        }
        if (cell !== '' && !itemIds.has(cell)) {
          throw new Error(`Recipe "${r.id}" references unknown item "${cell}"`);
        }
      }
    } else if (dim2D(grid) !== null) {
      // 2D pattern: array of arrays.
      const expected = dim2D(grid);
      if (!Array.isArray(pattern) || pattern.length !== expected) {
        throw new Error(`Recipe "${r.id}" pattern must be ${expected}x${expected}`);
      }
      for (const row of pattern) {
        if (!Array.isArray(row) || row.length !== expected) {
          throw new Error(`Recipe "${r.id}" pattern row width != ${expected}`);
        }
        for (const cell of row) {
          if (cell !== '' && !itemIds.has(cell)) {
            throw new Error(`Recipe "${r.id}" references unknown item "${cell}"`);
          }
        }
      }
    } else {
      throw new Error(`Recipe "${r.id}" has unknown grid "${grid}"`);
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
