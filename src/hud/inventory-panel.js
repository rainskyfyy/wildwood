/**
 * InventoryPanel — 5x3 backpack grid (15 slots) shown when [I] is pressed.
 * Two-click interaction: first click picks up a stack, second click drops
 * it (with merge or swap semantics matching Inventory.move).
 */
'use strict';

import { HOTBAR_SIZE, BACKPACK_SIZE, TOTAL_SLOTS } from '../resources/inventory.js';

const SLOT_SIZE = 44;
const SLOT_GAP  = 4;
const COLS = 5;
const ROWS = 3;

export class InventoryPanel {
  constructor(ctx, inventory) {
    this.ctx = ctx;
    this.inventory = inventory;
    this.visible = false;
    this._pickedFrom = null;   // inventory slot index, or null
  }

  toggle() { this.visible = !this.visible; this._pickedFrom = null; }
  show()   { this.visible = true; }
  hide()   { this.visible = false; this._pickedFrom = null; }

  onClick(mx, my, canvasWidth, canvasHeight) {
    if (!this.visible) return false;
    const layout = this._layout(canvasWidth, canvasHeight);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = HOTBAR_SIZE + r * COLS + c;
        const x = layout.x0 + c * (SLOT_SIZE + SLOT_GAP);
        const y = layout.y0 + r * (SLOT_SIZE + SLOT_GAP);
        if (mx >= x && mx <= x + SLOT_SIZE && my >= y && my <= y + SLOT_SIZE) {
          this._clickSlot(i);
          return true;
        }
      }
    }
    return false;
  }

  _clickSlot(i) {
    if (this._pickedFrom == null) {
      if (this.inventory.slots[i] != null) this._pickedFrom = i;
      return;
    }
    if (this._pickedFrom === i) { this._pickedFrom = null; return; }
    this.inventory.move(this._pickedFrom, i);
    this._pickedFrom = null;
  }

  _layout(canvasWidth, canvasHeight) {
    const totalW = COLS * SLOT_SIZE + (COLS - 1) * SLOT_GAP;
    const totalH = ROWS * SLOT_SIZE + (ROWS - 1) * SLOT_GAP;
    return {
      x0: Math.floor((canvasWidth - totalW) / 2),
      y0: Math.floor((canvasHeight - totalH) / 2)
    };
  }

  draw(canvasWidth, canvasHeight) {
    if (!this.visible) return;
    const ctx = this.ctx;
    const layout = this._layout(canvasWidth, canvasHeight);
    ctx.fillStyle = 'rgba(15,15,22,0.88)';
    ctx.fillRect(layout.x0 - 12, layout.y0 - 28, COLS * (SLOT_SIZE + SLOT_GAP) + 8, ROWS * (SLOT_SIZE + SLOT_GAP) + 36);
    ctx.fillStyle = '#d4a64a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('背包 (I 关闭)', layout.x0 - 8, layout.y0 - 22);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = HOTBAR_SIZE + r * COLS + c;
        const x = layout.x0 + c * (SLOT_SIZE + SLOT_GAP);
        const y = layout.y0 + r * (SLOT_SIZE + SLOT_GAP);
        const picked = (i === this._pickedFrom);
        ctx.fillStyle = picked ? 'rgba(212,166,74,0.95)' : 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - 2, y - 2, SLOT_SIZE + 4, SLOT_SIZE + 4);
        ctx.fillStyle = 'rgba(40,30,20,0.85)';
        ctx.fillRect(x, y, SLOT_SIZE, SLOT_SIZE);
        const stack = this.inventory.slots[i];
        if (stack) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(x + 8, y + 8, SLOT_SIZE - 16, SLOT_SIZE - 16);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          if (stack.count > 1) ctx.fillText(String(stack.count), x + SLOT_SIZE - 3, y + SLOT_SIZE - 2);
        }
      }
    }
  }
}
