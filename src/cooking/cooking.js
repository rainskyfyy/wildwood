/**
 * Cooking — 烹饪锅 4 槽 multiset 匹配 + 解锁记录
 *
 * 4 槽(1D 数组),顺序无关:
 *   1. 玩家拖拽食材入锅(put)
 *   2. 系统按 multiset(物品 ID 计数)匹配食谱
 *   3. 计算品质(普通/优秀/完美)
 *   4. 烹饪 → 消耗食材 + 产出食物(数量+品质加成)
 *
 * 食谱解锁:
 *   首次烹饪成功后,recipe id 写入 unlocked 集合(永久记录)
 *   用于 Codex / 解锁提示
 *
 * 食材匹配规则(per recipe):
 *   - pattern 中每个非空 cell 必须有对应输入食材(按 multiset)
 *   - 输入食材的 multiset 必须与 pattern multiset 严格相等
 *     (即不能少食材,也不能多食材;空格位不要求)
 *
 *   例: pattern = ["meat", "water", "salt"]
 *       input   = ["meat", "", "water", "salt"]   ✓ 匹配
 *       input   = ["meat", "water", "salt", ""]   ✓ 匹配(顺序无关)
 *       input   = ["meat", "water", "salt", "egg"] ✗ 多了 egg
 *       input   = ["meat", "water"]               ✗ 缺 salt
 *
 * v1.0.0
 */
'use strict';

import { recipesForStation, getRecipe, getItem } from '../resources/catalog.js';
import { computeQuality, qualityMult, qualityBonus, QUALITY } from './quality.js';

export const COOKING_SLOTS = 4;
export const COOKING_STATION = 'cooking';

/**
 * CookingPot — 单个烹饪锅的状态
 *   slots: 1D 4 元素数组, '' 表示空
 *   preview: 匹配的 recipe + 品质(只读计算)
 *   unlocked: 玩家已解锁的食谱 id Set
 */
export class CookingPot {
  /**
   * @param {Object} opts
   * @param {Object} opts.inventory - Inventory instance
   * @param {Function} [opts.onEvent] - (name, payload) => void
   *   events: 'put' / 'removed' / 'cleared' / 'cooked' / 'unlocked' / 'no_match'
   * @param {Function} [opts.onUnlock] - (recipeId) => void  解锁新食谱时回调
   */
  constructor({ inventory, onEvent, onUnlock } = {}) {
    if (!inventory) throw new Error('CookingPot requires inventory');
    this.inventory = inventory;
    this.onEvent = onEvent || (() => {});
    this.onUnlock = onUnlock || (() => {});
    this.slots = new Array(COOKING_SLOTS).fill('');
    this.unlocked = new Set();
    this._dirty = false;
  }

  // ─── Slot manipulation ─────────────────────────────────────

  /**
   * Put an item into the first empty slot.
   * @returns {ok: true, slotIndex} or {ok: false, reason: 'full' | 'unknown_item' | 'not_cookable'}
   */
  put(itemId) {
    if (!itemId) return { ok: false, reason: 'unknown_item' };
    try {
      const it = getItem(itemId);
      if (['tool', 'seed', 'fertilizer', 'placeable'].includes(it.category)) {
        return { ok: false, reason: 'not_cookable' };
      }
    } catch (_) {
      return { ok: false, reason: 'unknown_item' };
    }
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i] === '') {
        this.slots[i] = itemId;
        this._dirty = true;
        this.onEvent('put', { slot: i, itemId });
        return { ok: true, slotIndex: i };
      }
    }
    return { ok: false, reason: 'full' };
  }

  /**
   * Remove an item from a slot. Does not return to inventory.
   */
  removeFromSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return null;
    const old = this.slots[slotIndex];
    this.slots[slotIndex] = '';
    this._dirty = true;
    if (old) this.onEvent('removed', { slot: slotIndex, itemId: old });
    return old;
  }

  /**
   * Clear all slots. Returns list of removed itemIds.
   */
  clear() {
    const removed = this.slots.filter(s => s !== '');
    this.slots = new Array(COOKING_SLOTS).fill('');
    this._dirty = true;
    this.onEvent('cleared', { removed });
    return removed;
  }

  // ─── Preview / matching ───────────────────────────────────

  _slotMultiset() {
    const out = new Map();
    for (const s of this.slots) {
      if (s === '') continue;
      out.set(s, (out.get(s) || 0) + 1);
    }
    return out;
  }

  static patternMultiset(pattern) {
    const out = new Map();
    for (const cell of pattern) {
      if (cell === '') continue;
      out.set(cell, (out.get(cell) || 0) + 1);
    }
    return out;
  }

  static multisetEquals(a, b) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || b.get(k) !== v) return false;
    }
    return true;
  }

  /**
   * Find a recipe matching the current slots. Returns recipe or null.
   *
   * Match rule:
   *   1. The input multiset must be a *superset* of the recipe's pattern
   *      multiset (input ⊇ pattern).
   *   2. The recipe with the LARGEST non-empty pattern size wins. This way
   *      a 4-slot input [carrot,potato,water,salt] matches the 4-cell
   *      vegetable_stew recipe, not the 1-cell cooked_carrot. When two
   *      recipes share the same pattern size, declaration order in
   *      recipes.json is the tiebreaker.
   *
   *   pattern = ["potato", "", "", ""]   (1 cell)
   *   input   = ["potato", "water"]       ✓ → roasted_potato
   *   pattern = ["carrot","potato","water","salt"]  (4 cells)
   *   input   = ["carrot","potato","water","salt"]   ✓ → vegetable_stew
   *   input   = ["gold","flint","dirt","petals"]     ✗ no pattern ⊆ input
   */
  findRecipe() {
    const inputMs = this._slotMultiset();
    if (inputMs.size === 0) return null;
    let best = null;
    let bestSize = -1;
    for (const r of recipesForStation(COOKING_STATION)) {
      const patMs = CookingPot.patternMultiset(r.pattern);
      let ok = true;
      for (const [k, v] of patMs) {
        if ((inputMs.get(k) || 0) < v) { ok = false; break; }
      }
      if (!ok) continue;
      const size = patMs.size === 0 ? 0 : Math.max(...patMs.values());
      // Score by total cell count, not unique count, so a 2-cell recipe
      // with 2 distinct items beats a 1-cell recipe.
      const totalCells = patMs.size === 0 ? 0 : Array.from(patMs.values()).reduce((a, b) => a + b, 0);
      if (totalCells > bestSize) {
        best = r;
        bestSize = totalCells;
      }
    }
    return best;
  }

  /**
   * Compute preview: { recipe, quality, foodValue, foodCount, slots }.
   * Returns null if slots are empty.
   *
   * If no recipe matches but slots are non-empty, we still compute a
   * tentative quality based on the input cells themselves (using the
   * input as a virtual pattern) so the UI can show "would be GOOD if a
   * recipe existed".
   */
  preview(inventoryStats) {
    const slots = [...this.slots];
    if (this._slotMultiset().size === 0) return null;
    const recipe = this.findRecipe();
    if (recipe) {
      const quality = computeQuality(slots, recipe.pattern, inventoryStats);
      const baseFood = (() => {
        try { return getItem(recipe.output.itemId).foodValue || 1; } catch (_) { return 1; }
      })();
      const mult = qualityMult(quality);
      const foodValue = Math.round(baseFood * mult);
      const baseCount = recipe.output.count;
      const foodCount = qualityBonus(quality, baseCount);
      return { recipe, quality, foodValue, foodCount, slots };
    }
    // No recipe matched — compute a tentative quality from the input cells
    // (using the input as a virtual pattern, so patternLen === input size).
    const quality = computeQuality(slots, slots, inventoryStats);
    return { recipe: null, quality, foodValue: 0, foodCount: 0, slots };
  }

  // ─── Cook action ──────────────────────────────────────────

  /**
   * Cook the current slots. Returns:
   *   { ok: true, recipe, output: {itemId, count, quality}, consumed: [...] }
   *   { ok: false, reason: 'no_match' | 'insufficient_items' | 'inventory_full' }
   *
   * Algorithm:
   *   1. Find recipe; abort if no_match
   *   2. Verify inventory has enough of each input
   *   3. Simulate add of output (testAdd); if leftover > 0, abort inventory_full
   *      and roll back the simulation by consuming what was tentatively added
   *   4. Consume inputs
   *   5. Add output (now guaranteed to fit)
   *   6. Clear slots
   *   7. Unlock recipe
   */
  cook(inventoryStats) {
    const recipe = this.findRecipe();
    if (!recipe) {
      this.onEvent('no_match', { slots: [...this.slots] });
      return { ok: false, reason: 'no_match' };
    }

    const needed = CookingPot.patternMultiset(recipe.pattern);
    for (const [itemId, n] of needed) {
      if (this.inventory.countOf(itemId) < n) {
        return { ok: false, reason: 'insufficient_items', missing: itemId };
      }
    }

    const quality = computeQuality(this.slots, recipe.pattern, inventoryStats);
    const outCount = qualityBonus(quality, recipe.output.count);

    // Simulate add (roll back if it overflows)
    const testAdd = this.inventory.add(recipe.output.itemId, outCount);
    if (testAdd.leftover > 0) {
      // Roll back what was tentatively added
      if (testAdd.added > 0) {
        this.inventory.consume(recipe.output.itemId, testAdd.added);
      }
      return { ok: false, reason: 'inventory_full' };
    }

    // Consume inputs
    const consumed = [];
    for (const [itemId, n] of needed) {
      const r = this.inventory.consume(itemId, n);
      consumed.push({ itemId, count: n });
    }

    this.clear();

    const wasUnlocked = this.unlocked.has(recipe.id);
    this.unlocked.add(recipe.id);

    const result = {
      ok: true,
      recipe,
      output: { itemId: recipe.output.itemId, count: outCount, quality },
      consumed
    };
    this.onEvent('cooked', result);
    if (!wasUnlocked) {
      this.onEvent('unlocked', { recipeId: recipe.id });
      this.onUnlock(recipe.id);
    }
    return result;
  }

  // ─── Persistence ──────────────────────────────────────────

  serialize() {
    return {
      v: 1,
      slots: [...this.slots],
      unlocked: Array.from(this.unlocked)
    };
  }

  loadSnapshot(snap) {
    if (!snap || snap.v !== 1) return false;
    if (!Array.isArray(snap.slots) || snap.slots.length !== COOKING_SLOTS) return false;
    this.slots = snap.slots.slice(0, COOKING_SLOTS);
    this.unlocked = new Set(Array.isArray(snap.unlocked) ? snap.unlocked : []);
    return true;
  }
}

/**
 * Find all currently-cookable recipes (inventory has all inputs).
 */
export function findCookableRecipes(pot, inventory, station = COOKING_STATION) {
  const out = [];
  for (const r of recipesForStation(station)) {
    if (pot.unlocked.has(r.id)) continue;
    const needed = CookingPot.patternMultiset(r.pattern);
    let canCook = true;
    for (const [itemId, n] of needed) {
      if (inventory.countOf(itemId) < n) { canCook = false; break; }
    }
    if (canCook) out.push(r);
  }
  return out;
}

/**
 * Compute inventory stats for cooking quality: { avgFreshness } in [0, 1].
 * Currently a constant 1.0 — placeholder for per-stack freshness integration.
 */
export function computeInventoryStats(inventory) {
  return { avgFreshness: 1.0 };
}
