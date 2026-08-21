/**
 * CraftingPanel — 2x2 hand-craft grid. Open with [C]. Two-click flow:
 *   - click empty grid cell with a hotbar item selected -> place item
 *   - click placed cell -> remove
 *   - click "Craft" button -> match + consume + produce
 */
'use strict';

import { matchRecipe, craft, emptyGrid, gridContents } from '../resources/crafting.js';
import { getRecipe } from '../resources/catalog.js';

const CELL = 56;
const GAP  = 4;
const GRID = 2;

export class CraftingPanel {
  constructor(ctx, inventory) {
    this.ctx = ctx;
    this.inventory = inventory;
    this.visible = false;
    this.grid = emptyGrid(GRID);
    this._hover = null;
  }
  toggle() { this.visible = !this.visible; this._resetGrid(); }
  show()   { this.visible = true; this._resetGrid(); }
  hide()   { this.visible = false; this._resetGrid(); }
  _resetGrid() { this.grid = emptyGrid(GRID); }

  onClick(mx, my, canvasWidth, canvasHeight, hotbarSlotIndex) {
    if (!this.visible) return false;
    const layout = this._layout(canvasWidth, canvasHeight);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const x = layout.x + c * (CELL + GAP);
        const y = layout.y + r * (CELL + GAP);
        if (mx >= x && mx <= x + CELL && my >= y && my <= y + CELL) {
          this._clickCell(r, c, hotbarSlotIndex);
          return true;
        }
      }
    }
    if (mx >= layout.btnX && mx <= layout.btnX + layout.btnW
     && my >= layout.btnY && my <= layout.btnY + 28) {
      this._doCraft();
      return true;
    }
    return false;
  }

  _clickCell(r, c, hotbarSlotIndex) {
    if (this.grid[r][c] !== '') {
      this.grid[r][c] = '';
      return;
    }
    const stack = this.inventory.slots[hotbarSlotIndex];
    if (!stack) return;
    this.grid[r][c] = stack.itemId;
  }

  _doCraft() {
    const r = craft(this.grid, 'hand', this.inventory);
    if (r.ok) this._resetGrid();
  }

  _layout(canvasWidth, canvasHeight) {
    const totalW = GRID * CELL + (GRID - 1) * GAP;
    const padX = 16, padY = 60;
    const x = Math.floor((canvasWidth - totalW) / 2);
    const y = Math.floor((canvasHeight - 2 * CELL - GAP - 60) / 2);
    return {
      x, y,
      btnX: x, btnW: totalW,
      btnY: y + 2 * (CELL + GAP) + 8
    };
  }

  draw(canvasWidth, canvasHeight, hotbarSlotIndex) {
    if (!this.visible) return;
    const ctx = this.ctx;
    const layout = this._layout(canvasWidth, canvasHeight);
    const totalW = GRID * CELL + (GRID - 1) * GAP;
    const totalH = 2 * CELL + GAP + 36;
    ctx.fillStyle = 'rgba(15,15,22,0.9)';
    ctx.fillRect(layout.x - 12, layout.y - 28, totalW + 8, totalH + 24);
    ctx.fillStyle = '#d4a64a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('手持合成 (C 关闭)', layout.x - 8, layout.y - 22);

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const x = layout.x + c * (CELL + GAP);
        const y = layout.y + r * (CELL + GAP);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - 2, y - 2, CELL + 4, CELL + 4);
        ctx.fillStyle = 'rgba(40,30,20,0.85)';
        ctx.fillRect(x, y, CELL, CELL);
        const id = this.grid[r][c];
        if (id) {
          ctx.fillStyle = 'rgba(212,166,74,0.6)';
          ctx.fillRect(x + 6, y + 6, CELL - 12, CELL - 12);
          ctx.fillStyle = '#fff';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(id, x + CELL / 2, y + CELL / 2);
        }
      }
    }
    // Match preview
    const match = matchRecipe(this.grid, 'hand');
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(match ? `→ ${match.name} (${match.output.itemId} ×${match.output.count})`
                        : '未匹配配方',
                 layout.x, layout.y + 2 * (CELL + GAP) - 18);
    // Craft button
    const can = !!match && this._canAfford(match);
    ctx.fillStyle = can ? 'rgba(212,166,74,0.95)' : 'rgba(80,80,80,0.7)';
    ctx.fillRect(layout.btnX, layout.btnY, layout.btnW, 28);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(can ? '合成' : '材料不足', layout.btnX + layout.btnW / 2, layout.btnY + 14);
  }

  _canAfford(recipe) {
    if (!recipe) return false;
    const need = {};
    for (const row of recipe.pattern) for (const c of row) {
      if (c !== '') need[c] = (need[c] || 0) + 1;
    }
    for (const id of Object.keys(need)) {
      if (this.inventory.countOf(id) < need[id]) return false;
    }
    return true;
  }
}
