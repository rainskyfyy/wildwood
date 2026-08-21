/**
 * Inventory — 6 hotbar + 15 backpack, drag/move/swap/stack, cap 20.
 * Pure logic, no DOM.
 */
'use strict';

import { getItem } from './catalog.js';

export const HOTBAR_SIZE   = 6;
export const BACKPACK_SIZE = 15;
export const TOTAL_SLOTS   = HOTBAR_SIZE + BACKPACK_SIZE;
export const DEFAULT_STACK_MAX = 20;

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0;
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

  selectHotbar(i) {
    // Clamp into [0, HOTBAR_SIZE - 1] so callers passing raw key
    // codes or the wrap-around value get a sensible slot.
    if (typeof i !== 'number' || Number.isNaN(i)) return;
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, i | 0));
  }

  add(itemId, count) {
    if (count <= 0) return { added: 0, leftover: 0 };
    const cap = this._stackMax(itemId);
    let remaining = count;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.itemId === itemId && s.count < cap) {
        const take = Math.min(remaining, cap - s.count);
        s.count += take;
        remaining -= take;
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (this.slots[i] == null) {
        const take = Math.min(remaining, cap);
        this.slots[i] = { itemId, count: take };
        remaining -= take;
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
   * Critical: partial merge would strand a residual in the source
   * slot, which breaks the "drag-to-slot" UX (the user expects
   * the source to end up empty or visibly different). Swap is the
   * safer default.
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
    if (a.itemId === b.itemId) {
      const cap = this._stackMax(a.itemId);
      if (a.count + b.count <= cap) {
        b.count += a.count;
        this.slots[from] = null;
        return;
      }
      // Cannot fit fully — swap so the player sees both stacks.
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

  compact() {
    const out = new Array(TOTAL_SLOTS).fill(null);
    let w = 0;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = this.slots[i];
      if (!s) continue;
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
      v: 1,
      selected: this.selected,
      slots: this.slots.map(s => s == null ? null
        : { itemId: s.itemId, count: s.count })
    };
  }

  loadSnapshot(snap) {
    if (!snap || snap.v !== 1) throw new Error('Invalid inventory snapshot');
    if (!Array.isArray(snap.slots) || snap.slots.length !== TOTAL_SLOTS) {
      throw new Error('Snapshot slot count mismatch');
    }
    this.slots = snap.slots.map(s => s == null ? null
      : { itemId: String(s.itemId), count: Math.max(0, s.count | 0) });
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
