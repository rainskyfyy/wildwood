/**
 * Hotbar — 5-slot horizontal strip drawn at the bottom-center.
 *
 * Each slot is a 48x48 frame with a small placeholder icon. The
 * selected slot has a brighter outline. Slot 1..5 selected via
 * number keys 1-5 (consumed once per press).
 *
 * Items are placeholders (`{ kind: 'tree' | 'rock' | ... }`); when the
 * inventory system lands in a later milestone, replace `items` with
 * the real backing store.
 */

'use strict';

const SLOT_COUNT = 5;
const SLOT_SIZE  = 48;
const SLOT_GAP   = 6;

export class Hotbar {
  constructor(ctx, input) {
    this.ctx = ctx;
    this.input = input;
    this.selected = 0;
    this.items = [
      { kind: 'axe' },
      { kind: 'pickaxe' },
      { kind: 'torch' },
      { kind: 'food' },
      { kind: 'rock' }
    ];
  }

  update() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (this.input.consumePressed(String(i + 1))) {
        this.selected = i;
      }
    }
  }

  draw(canvasWidth, canvasHeight) {
    const ctx = this.ctx;
    const totalW = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
    const x0 = Math.floor((canvasWidth - totalW) / 2);
    const y0 = canvasHeight - SLOT_SIZE - 12;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = x0 + i * (SLOT_SIZE + SLOT_GAP);
      // Frame.
      ctx.fillStyle = i === this.selected ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 2, y0 - 2, SLOT_SIZE + 4, SLOT_SIZE + 4);
      ctx.fillStyle = 'rgba(40,30,20,0.85)';
      ctx.fillRect(x, y0, SLOT_SIZE, SLOT_SIZE);

      // Item placeholder icon.
      const item = this.items[i];
      this._drawItemIcon(x + SLOT_SIZE / 2, y0 + SLOT_SIZE / 2, item.kind);

      // Slot number (top-left).
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), x + 3, y0 + 3);
    }
  }

  _drawItemIcon(cx, cy, kind) {
    const ctx = this.ctx;
    ctx.save();
    if (kind === 'axe') {
      ctx.fillStyle = '#8a5a2a';
      ctx.fillRect(cx - 2, cy - 8, 2, 12);
      ctx.fillStyle = '#bbb';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + 6, cy - 5);
      ctx.lineTo(cx, cy - 2);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'pickaxe') {
      ctx.fillStyle = '#8a5a2a';
      ctx.fillRect(cx - 2, cy - 8, 2, 12);
      ctx.fillStyle = '#aaa';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 8);
      ctx.lineTo(cx + 6, cy - 8);
      ctx.lineTo(cx, cy - 4);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'torch') {
      ctx.fillStyle = '#8a5a2a';
      ctx.fillRect(cx - 1, cy - 6, 2, 10);
      ctx.fillStyle = '#ffb84a';
      ctx.beginPath();
      ctx.arc(cx, cy - 8, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'food') {
      ctx.fillStyle = '#c25a3a';
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a8a3a';
      ctx.fillRect(cx + 3, cy - 9, 1, 3);
    } else if (kind === 'rock') {
      ctx.fillStyle = '#7a7070';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
