/**
 * Inventory — 6 hotbar + 15 backpack, drag/move/swap/stack, cap 20.
 * Pure logic, no DOM.
 *
 * v1.0.1 — tool durability:
 *   - Tools (items.json category=tool) carry `durability` and `maxDurability`
 *     on their stack entry: { itemId, count, durability, maxDurability }
 *   - Non-tool stacks are unchanged: { itemId, count }
 *   - On add() of a new tool stack, durability is set to maxDurability
 *   - On merge of two tool stacks, durability = max(durability) is kept
 *     (we don't combine durabilities — that would let a fresh tool heal an
 *      old one; merging just stacks the unused fresh tool underneath)
 *   - breakTool(slotIndex) decrements durability by 1; if it hits 0,
 *     the slot is cleared and 'break' is emitted via onBreak callback
 *   - damageTool(slotIndex, by) decrements by N (default 1)
 */
'use strict';

import { getItem, isTool, getMaxDurability } from './catalog.js';

export const HOTBAR_SIZE   = 6;
export const BACKPACK_SIZE = 15;
export const TOTAL_SLOTS   = HOTBAR_SIZE + BACKPACK_SIZE;
export const DEFAULT_STACK_MAX = 20;

export class Inventory {
  constructor({ onBreak = null } = {}) {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0;
    this.onBreak = onBreak;
  }

  slot(i) {
    if (i < 0 || i >= TOTAL_SLOTS) return null;
    return this.slots[i];
  }

  hotbarSelected() { return this.slots[this.selected]; }

  isEmpty() { return this.slots.every(s => s == null); }

  countOf(itemId) {
    let n = 0;
    for (const s of this.slots) if (s && s.itemId === itemId) n += s.count;
    return n;
  }

  /**
   * Sum of durability across all stacks of a tool (sum of remaining uses).
   */
  totalDurabilityOf(itemId) {
    let n = 0;
    for (const s of this.slots) {
      if (s && s.itemId === itemId && s.durability != null) n += s.durability;
    }
    return n;
  }

  selectHotbar(i) {
    if (typeof i !== 'number' || Number.isNaN(i)) return;
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, i | 0));
  }

  /**
   * Build a fresh stack object for itemId — non-tool: {itemId,count};
   * tool: {itemId,count:1,durability:max,maxDurability:max}.
   */
  _newStack(itemId, count) {
    if (isTool(itemId)) {
      const max = getMaxDurability(itemId);
      return { itemId, count, durability: max, maxDurability: max };
    }
    return { itemId, count };
  }

  add(itemId, count) {
    if (count <= 0) return { added: 0, leftover: 0 };
    const cap = this._stackMax(itemId);
    const isToolItem = isTool(itemId);
    let remaining = count;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (!s || s.itemId !== itemId) continue;
      if (isToolItem) {
        // Tools: stackMax is 1 and each tool is its own instance.
        // We never merge two tools into one stack; the rest of the add()
        // loop will open new slots if count > 1.
        continue;
      }
      if (s.count < cap) {
        const take = Math.min(remaining, cap - s.count);
        s.count += take;
        remaining -= take;
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (this.slots[i] == null) {
        if (isToolItem) {
          // Each tool takes its own slot; cap is 1.
          this.slots[i] = this._newStack(itemId, 1);
          remaining -= 1;
        } else {
          const take = Math.min(remaining, cap);
          this.slots[i] = this._newStack(itemId, take);
          remaining -= take;
        }
      }
    }
    return { added: count - remaining, leftover: remaining };
  }

  remove(i, count) {
    if (count <= 0) return 0;
    const s = this.slots[i];
    if (!s) return 0;
    const take = Math.min(count, s.count);
    s.count -= take;
    if (s.count <= 0) this.slots[i] = null;
    return take;
  }

  /**
   * Move the stack at `from` to slot `to`. Three cases:
   *   1. to is empty                -> straight move
   *   2. to holds the same item AND the full `from` stack fits
   *                                  -> merge into one stack
   *   3. otherwise                  -> swap the two stacks
   *
   * Tools never merge (each tool is its own durability instance).
   */
  move(from, to) {
    if (from === to) return;
    if (from < 0 || from >= TOTAL_SLOTS) return;
    if (to   < 0 || to   >= TOTAL_SLOTS) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (a == null) return;
    if (b == null) {
      this.slots[to]   = a;
      this.slots[from] = null;
      return;
    }
    if (a.itemId === b.itemId && !isTool(a.itemId)) {
      const cap = this._stackMax(a.itemId);
      if (a.count + b.count <= cap) {
        b.count += a.count;
        this.slots[from] = null;
        return;
      }
    }
    this.slots[from] = b;
    this.slots[to]   = a;
  }

  swap(from, to) {
    if (from === to) return;
    if (from < 0 || from >= TOTAL_SLOTS) return;
    if (to   < 0 || to   >= TOTAL_SLOTS) return;
    const t = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to]   = t;
  }

  /**
   * Damage a tool in `slotIndex` by `by` durability points (default 1).
   * If the tool breaks (durability <= 0), the slot is cleared and the
   * `onBreak` callback fires. Returns the new durability (0 if broken).
   *
   * If the slot is empty or non-tool, this is a no-op (returns null).
   */
  damageTool(slotIndex, by = 1) {
    const s = this.slots[slotIndex];
    if (!s || !isTool(s.itemId) || s.durability == null) return null;
    s.durability = Math.max(0, s.durability - by);
    if (s.durability === 0) {
      const brokenId = s.itemId;
      this.slots[slotIndex] = null;
      if (typeof this.onBreak === 'function') {
        this.onBreak({ slotIndex, itemId: brokenId });
      }
    }
    return s.durability;
  }

  /**
   * Damage the currently selected hotbar tool. Returns the new durability
   * (0 if broken, null if no tool selected).
   */
  damageSelectedTool(by = 1) {
    const i = this.selected;
    return this.damageTool(i, by);
  }

  compact() {
    const out = new Array(TOTAL_SLOTS).fill(null);
    let w = 0;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = this.slots[i];
      if (!s) continue;
      if (isTool(s.itemId)) {
        // Tools keep their own slot; we just hand them through.
        out[w++] = s;
        continue;
      }
      const cap = this._stackMax(s.itemId);
      let remaining = s.count;
      for (let j = 0; j < w && remaining > 0; j++) {
        const t = out[j];
        if (t && t.itemId === s.itemId && t.count < cap) {
          const take = Math.min(remaining, cap - t.count);
          t.count += take;
          remaining -= take;
        }
      }
      if (remaining > 0) {
        out[w++] = { itemId: s.itemId, count: remaining };
      }
    }
    this.slots = out;
  }

  serialize() {
    return {
      v: 2,  // bumped: durability support
      selected: this.selected,
      slots: this.slots.map(s => s == null ? null
        : isTool(s.itemId)
          ? { itemId: s.itemId, count: s.count, durability: s.durability, maxDurability: s.maxDurability }
          : { itemId: s.itemId, count: s.count })
    };
  }

  loadSnapshot(snap) {
    if (!snap) throw new Error('Invalid inventory snapshot');
    if (snap.v !== 1 && snap.v !== 2) throw new Error(`Unsupported snapshot v=${snap.v}`);
    if (!Array.isArray(snap.slots) || snap.slots.length !== TOTAL_SLOTS) {
      throw new Error('Snapshot slot count mismatch');
    }
    this.slots = snap.slots.map(s => {
      if (s == null) return null;
      const out = { itemId: String(s.itemId), count: Math.max(0, s.count | 0) };
      if (isTool(s.itemId)) {
        const max = getMaxDurability(s.itemId);
        out.maxDurability = max;
        out.durability = typeof s.durability === 'number'
          ? Math.max(0, Math.min(max, s.durability | 0))
          : max;
      }
      return out;
    });
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, snap.selected | 0));
  }

  _stackMax(itemId) {
    try {
      const meta = getItem(itemId);
      return meta.stackMax || DEFAULT_STACK_MAX;
    } catch (_) {
      return DEFAULT_STACK_MAX;
    }
  }
}
