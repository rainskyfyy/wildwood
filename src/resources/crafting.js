/**
 * Crafting — exact-position recipe matcher + executor.
 */
'use strict';

import { allRecipes } from './catalog.js';

const STATION_GRID = { hand: 2, science: 3, campfire: 2 };

export function matchRecipe(grid, station) {
  const n = STATION_GRID[station];
  if (!n) return null;
  if (!Array.isArray(grid) || grid.length !== n) return null;
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== n) return null;
  }
  for (const r of allRecipes()) {
    if (r.station !== station) continue;
    if (gridEquals(grid, r.pattern)) return r;
  }
  return null;
}

export function craft(grid, station, inventory) {
  const recipe = matchRecipe(grid, station);
  if (!recipe) return { ok: false, reason: 'no_match' };

  const needed = new Map();
  for (const row of grid) for (const cell of row) {
    if (cell !== '') needed.set(cell, (needed.get(cell) || 0) + 1);
  }

  for (const [itemId, n] of needed) {
    if (inventory.countOf(itemId) < n) {
      return { ok: false, reason: 'insufficient_items' };
    }
  }

  const consumed = [];
  for (const [itemId, n] of needed) {
    let left = n;
    for (let i = 0; i < inventory.slots.length && left > 0; i++) {
      const s = inventory.slots[i];
      if (s && s.itemId === itemId) {
        const take = Math.min(left, s.count);
        s.count -= take;
        if (s.count <= 0) inventory.slots[i] = null;
        left -= take;
      }
    }
    consumed.push({ itemId, count: n });
  }

  const r = inventory.add(recipe.output.itemId, recipe.output.count);
  if (r.leftover > 0) {
    for (const c of consumed) inventory.add(c.itemId, c.count);
    return { ok: false, reason: 'output_full' };
  }

  return {
    ok: true,
    recipe,
    output: { itemId: recipe.output.itemId, count: r.added },
    consumed
  };
}

export function emptyGrid(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = new Array(n).fill('');
  return out;
}

export function gridContents(grid) {
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== '') out.push({ r, c, itemId: grid[r][c] });
    }
  }
  return out;
}

function gridEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}
