/**
 * Hotbar — 6-slot bottom-center strip driven by the real Inventory.
 * v1.0.1 — shows tool durability bar at the bottom of each tool slot.
 */
'use strict';

import { HOTBAR_SIZE } from '../resources/inventory.js';
import { isTool } from '../resources/catalog.js';

const SLOT_SIZE = 44;
const SLOT_GAP  = 4;

const ICON_COLOR = {
  log: '#8a5a2a', twine: '#5a8a3a', stone: '#7a7070', flint: '#3a3a3a',
  iron_ore: '#a85a3a', ice: '#a8d4e8', berries: '#8a2a4a', torch: '#ffb84a',
  axe: '#8a5a2a', pickaxe: '#8a5a2a', shovel: '#8a5a2a', campfire: '#d4622a'
};

export class Hotbar {
  constructor(ctx, input, inventory) {
    this.ctx = ctx;
    this.input = input;
    this.inventory = inventory;
  }

  update() {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.input.consumePressed(String(i + 1))) {
        this.inventory.selectHotbar(i);
      }
    }
  }

  draw(canvasWidth, canvasHeight) {
    const ctx = this.ctx;
    const totalW = HOTBAR_SIZE * SLOT_SIZE + (HOTBAR_SIZE - 1) * SLOT_GAP;
    const x0 = Math.floor((canvasWidth - totalW) / 2);
    const y0 = canvasHeight - SLOT_SIZE - 10;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const x = x0 + i * (SLOT_SIZE + SLOT_GAP);
      const sel = (i === this.inventory.selected);
      ctx.fillStyle = sel ? 'rgba(212,166,74,0.95)' : 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 2, y0 - 2, SLOT_SIZE + 4, SLOT_SIZE + 4);
      ctx.fillStyle = 'rgba(40,30,20,0.85)';
      ctx.fillRect(x, y0, SLOT_SIZE, SLOT_SIZE);

      const stack = this.inventory.slots[i];
      if (stack) {
        ctx.fillStyle = ICON_COLOR[stack.itemId] || '#888';
        ctx.fillRect(x + 8, y0 + 8, SLOT_SIZE - 16, SLOT_SIZE - 16);
        if (stack.count > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(String(stack.count), x + SLOT_SIZE - 3, y0 + SLOT_SIZE - 2);
        }
        // Tool durability bar
        if (isTool(stack.itemId) && stack.durability != null && stack.maxDurability > 0) {
          const frac = stack.durability / stack.maxDurability;
          const w = SLOT_SIZE - 4;
          const h = 3;
          const bx = x + 2;
          const by = y0 + SLOT_SIZE - h - 1;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(bx, by, w, h);
          // green > 50%, amber > 20%, red otherwise
          ctx.fillStyle = frac > 0.5 ? '#7ec47e'
                        : frac > 0.2 ? '#d4a64a'
                        : '#e85a3a';
          ctx.fillRect(bx, by, Math.max(0, w * frac), h);
        }
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), x + 3, y0 + 3);
    }
  }
}
