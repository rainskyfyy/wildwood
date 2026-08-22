/**
 * InventoryService — the ONE way to mutate or query the player's
 * inventory. Every gameplay module (gather / crafting / cooking /
 * trading / follower) talks to the service instead of the raw
 * Inventory class, so the public surface is stable and we can change
 * the underlying storage later without touching every caller.
 *
 * Design contract:
 *   - Owns a single Inventory instance.
 *   - Exposes semantic, itemId-oriented methods by default.
 *   - Slot-based methods are explicitly named (`getSlot`, `findSlotByItem`,
 *     `damageToolById`) so reviewers can spot them.
 *   - No module outside `src/services/InventoryService.js` and
 *     `src/resources/inventory.js` should `import` from
 *     `'../resources/inventory.js'` directly. Enforced by grep in CI.
 *
 * v0.6.0b — wraps Inventory v1.0.1 (durability-aware).
 */
'use strict';

import { Inventory, HOTBAR_SIZE, BACKPACK_SIZE, TOTAL_SLOTS } from '../resources/inventory.js';

export class InventoryService {
  /**
   * @param {Object} [opts]
   * @param {Inventory} [opts.inventory] — reuse an existing instance, or
   *   pass nothing and a fresh one is created.
   * @param {Function} [opts.onBreak] — forwarded to Inventory's onBreak.
   */
  constructor({ inventory = null, onBreak = null } = {}) {
    this._inv = inventory || new Inventory({ onBreak });
  }

  // ─── Lifecycle / delegation ──────────────────────────────

  /** Direct access to the underlying Inventory (UI panels only). */
  get inventory() { return this._inv; }

  /** Swap in a different Inventory (e.g. after deserialise). */
  setInventory(inv) { this._inv = inv; }

  /** Hotbar capacity (6). */
  get hotbarSize() { return HOTBAR_SIZE; }

  /** Backpack capacity (15). */
  get backpackSize() { return BACKPACK_SIZE; }

  /** Total slots (21). */
  get totalSlots() { return TOTAL_SLOTS; }

  // ─── Read ────────────────────────────────────────────────

  /**
   * How many of `itemId` the player has across all stacks.
   * @param {string} itemId
   * @returns {number}
   */
  countOf(itemId) { return this._inv.countOf(itemId); }

  /**
   * Convenience: has at least `count` of `itemId`.
   * @param {string} itemId
   * @param {number} [count=1]
   * @returns {boolean}
   */
  hasItem(itemId, count = 1) { return this.countOf(itemId) >= count; }

  /**
   * Describe a single item type. Combines `countOf` with the first
   * matching stack's durability (if it's a tool).
   * @param {string} itemId
   * @returns {{count:number,durability:number,maxDurability:number}|null}
   */
  getItem(itemId) {
    const count = this.countOf(itemId);
    if (count <= 0) return null;
    const idx = this.findSlotByItem(itemId);
    const stack = idx >= 0 ? this._inv.slot(idx) : null;
    if (stack && stack.durability != null) {
      return {
        count,
        durability: stack.durability,
        maxDurability: stack.maxDurability
      };
    }
    return { count, durability: null, maxDurability: null };
  }

  /**
   * Currently-selected hotbar stack (or null).
   * @returns {Object|null}
   */
  peekSelected() { return this._inv.hotbarSelected(); }

  /**
   * Read a single slot. 0..HOTBAR_SIZE-1 are hotbar, HOTBAR_SIZE.. are
   * backpack. Returns null for empty slots or out-of-range.
   */
  getSlot(index) { return this._inv.slot(index); }

  /**
   * Is the entire inventory empty?
   */
  isEmpty() { return this._inv.isEmpty(); }

  /**
   * Find the first slot holding `itemId`. Returns -1 if not present.
   * @param {string} itemId
   * @returns {number}
   */
  findSlotByItem(itemId) {
    const slots = this._inv.slots;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].itemId === itemId) return i;
    }
    return -1;
  }

  // ─── Mutate ──────────────────────────────────────────────

  /**
   * Add `count` of `itemId` to the inventory. May split across stacks
   * and slots; leftover > 0 means at least one stack was too full.
   * @returns {{added:number, leftover:number}}
   */
  addItem(itemId, count) { return this._inv.add(itemId, count); }

  /**
   * Batch add — used by follower death pickup and similar collectors.
   * @param {Array<{itemId:string, count:number}>} loot
   * @returns {{added:number, leftover:number}} totals across all entries
   */
  addMany(loot) {
    let added = 0;
    let leftover = 0;
    if (!Array.isArray(loot)) return { added: 0, leftover: 0 };
    for (const l of loot) {
      if (!l || !l.itemId || !l.count) continue;
      const r = this._inv.add(l.itemId, l.count);
      added += r.added;
      leftover += r.leftover;
    }
    return { added, leftover };
  }

  /**
   * Consume `count` of `itemId` from any combination of slots. Walks
   * slots in order and drains them until the request is met. Returns
   * the number actually removed.
   *
   * This is the canonical "remove by itemId" — cooking / crafting /
   * trader sell all use it. Replaces hand-rolled `for (i…) slots[i].count`
   * loops scattered across modules.
   *
   * @param {string} itemId
   * @param {number} count
   * @returns {number} removed
   */
  consumeByItem(itemId, count) {
    if (count <= 0) return 0;
    let left = count;
    const slots = this._inv.slots;
    for (let i = 0; i < slots.length && left > 0; i++) {
      const s = slots[i];
      if (!s || s.itemId !== itemId) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      if (s.count <= 0) slots[i] = null;
      left -= take;
    }
    return count - left;
  }

  /**
   * Consume `count` from a specific slot index. Pass-through to
   * Inventory.remove so callers don't need to know about slots.
   * @param {number} slotIndex
   * @param {number} [count=1]
   * @returns {number} removed
   */
  consumeSlot(slotIndex, count = 1) { return this._inv.remove(slotIndex, count); }

  /**
   * Damage the first tool stack whose itemId matches. Returns the new
   * durability (0 if broken, null if no matching tool stack).
   * @param {string} itemId
   * @param {number} [by=1]
   */
  damageToolById(itemId, by = 1) {
    const idx = this.findSlotByItem(itemId);
    if (idx < 0) return null;
    const before = this._inv.slot(idx);
    if (!before || before.durability == null) return null;
    return this._inv.damageTool(idx, by);
  }

  /**
   * Damage the currently selected hotbar tool. Returns the new
   * durability (0 if broken, null if no tool selected).
   */
  damageSelectedTool(by = 1) { return this._inv.damageSelectedTool(by); }

  /**
   * Compact non-tool stacks (no-op for tools). UI panels may call this
   * on close.
   */
  compact() { this._inv.compact(); }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Snapshot for save/load. Wraps Inventory.serialize for the future
   * case where we want to hide the schema version from callers.
   */
  serialize() { return this._inv.serialize(); }

  /**
   * Load a snapshot. Throws on schema mismatch — caller decides whether
   * to reset or surface an error.
   */
  loadSnapshot(snap) { this._inv.loadSnapshot(snap); }
}

/**
 * Factory — replaces `new Inventory()` at construction sites that
 * already want the service. Existing main.js can keep using
 * `new Inventory()` and wrap it in `new InventoryService({ inventory })`
 * for now.
 */
export function createInventoryService(opts) {
  return new InventoryService(opts);
}

export { HOTBAR_SIZE, BACKPACK_SIZE, TOTAL_SLOTS };
