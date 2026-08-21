/**
 * Building radial menu — opens on B key, displays 5 building wedges
 * arranged around a center point. Mouse hover or 1-5 key selects a
 * building. Click / Enter confirms, Esc / B-again cancels.
 *
 * State:
 *   - isOpen:    true while the menu overlay is visible
 *   - hover:     index of wedge currently under the mouse (-1 = none)
 *   - selected:  index of confirmed building (after Enter / click);
 *                one-shot — caller should call consumeSelection() then
 *                close() the menu.
 *
 * The menu is fully driven by the catalog order; new buildings
 * automatically get a wedge.
 *
 * Visual:
 *   - Center: small white circle with "Build" label
 *   - 5 wedges of (360/5)=72° each, color = building.color
 *   - Hover: brighter fill + 2px outline
 *   - Selected: filled with accent color
 */

'use strict';

import { getBuildingMenuOrder, getBuildingCount } from './building-config.js';

const MENU_RADIUS = 110;        // px, distance from screen center to wedge label
const WEDGE_INNER = 38;         // px, inner radius of the ring
const WEDGE_OUTER = 130;        // px, outer radius of the ring
const CENTER_RADIUS = 30;       // px, center circle radius
const N_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export class BuildingMenu {
  constructor() {
    this.isOpen = false;
    this.hover = -1;            // wedge index under mouse
    this.selected = -1;         // confirmed selection (one-shot)
    this._consumed = false;     // true after consumeSelection() was called
  }

  /** Open the menu. Resets hover / selection. */
  open() {
    this.isOpen = true;
    this.hover = -1;
    this.selected = -1;
    this._consumed = false;
  }

  /** Close the menu. Resets hover / selection. */
  close() {
    this.isOpen = false;
    this.hover = -1;
    this.selected = -1;
    this._consumed = false;
  }

  /** Toggle: open if closed, close if open. */
  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /**
   * Per-frame update. Handles:
   *   - Esc / B to close
   *   - 1..N keys to select a building
   *   - Mouse hover (computes wedge from mouseX, mouseY relative to center)
   *   - Left click to confirm selection
   *
   * @param {object} input — Input singleton (with mouseX, mouseY, consumePressed, consumeLeftClick, consumeRightClick)
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {boolean} true if a selection was made this frame (caller should place then close)
   */
  update(input, canvasW, canvasH) {
    if (!this.isOpen) return false;

    // Esc / B closes.
    if (input.consumePressed('escape') || input.consumePressed('b')) {
      this.close();
      return false;
    }

    // Number keys 1..N pick a wedge.
    const n = getBuildingCount();
    for (let i = 0; i < n && i < N_KEYS.length; i++) {
      if (input.consumePressed(N_KEYS[i])) {
        this._confirm(i);
        return true;
      }
    }

    // Update hover from mouse position.
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const dx = input.mouseX - cx;
    const dy = input.mouseY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist >= WEDGE_INNER && dist <= WEDGE_OUTER) {
      // Angle: 0 = right, going clockwise (canvas Y is down so atan2 is
      // already clockwise from +X axis when we negate Y).
      const ang = Math.atan2(dy, dx);  // -PI..PI
      // Wedge i covers [start + i*step, start + (i+1)*step) where
      // step = 2*PI / n and start is chosen so wedge 0 is at the top
      // (north). Top = ang = -PI/2.
      const step = (Math.PI * 2) / n;
      const start = -Math.PI / 2 - step / 2;  // center wedge 0 at -PI/2
      let rel = ang - start;
      // Normalize to [0, 2PI).
      rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.floor(rel / step);
      this.hover = (idx >= 0 && idx < n) ? idx : -1;
    } else {
      this.hover = -1;
    }

    // Left click confirms the hovered wedge (or none).
    if (input.consumeLeftClick()) {
      if (this.hover >= 0) {
        this._confirm(this.hover);
        return true;
      } else {
        // Click outside any wedge → close without selecting.
        this.close();
        return false;
      }
    }
    // Right click → close.
    if (input.consumeRightClick()) {
      this.close();
      return false;
    }
    return false;
  }

  /**
   * Mark a wedge as selected. The caller reads it via
   * `consumeSelection()` and then calls `close()`.
   */
  _confirm(idx) {
    this.selected = idx;
  }

  /**
   * One-shot accessor: returns the selected building type id and
   * closes the menu. Returns null if no selection (or already consumed).
   *
   * @returns {string|null}
   */
  consumeSelection() {
    if (!this.isOpen || this.selected < 0 || this._consumed) {
      this._consumed = true;
      return null;
    }
    const order = getBuildingMenuOrder();
    const def = order[this.selected];
    this._consumed = true;
    this.close();
    return def ? def.id : null;
  }

  /**
   * Draw the radial menu overlay. Drawn in screen coords on top of
   * the world.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cw — canvas width
   * @param {number} ch — canvas height
   */
  draw(ctx, cw, ch) {
    if (!this.isOpen) return;
    const cx = cw / 2;
    const cy = ch / 2;
    const order = getBuildingMenuOrder();
    const n = order.length;
    const step = (Math.PI * 2) / n;
    const start = -Math.PI / 2 - step / 2;

    // Dim background.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, cw, ch);

    // Draw wedges.
    for (let i = 0; i < n; i++) {
      const a0 = start + i * step;
      const a1 = a0 + step;
      const def = order[i];
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * WEDGE_INNER, cy + Math.sin(a0) * WEDGE_INNER);
      ctx.arc(cx, cy, WEDGE_INNER, a0, a1, false);
      ctx.lineTo(cx + Math.cos(a1) * WEDGE_OUTER, cy + Math.sin(a1) * WEDGE_OUTER);
      ctx.arc(cx, cy, WEDGE_OUTER, a1, a0, true);
      ctx.closePath();
      // Fill.
      if (i === this.selected) {
        ctx.fillStyle = def.accent;
      } else if (i === this.hover) {
        ctx.fillStyle = def.color;
      } else {
        ctx.fillStyle = def.outline;
      }
      ctx.fill();
      // Outline.
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = (i === this.hover || i === this.selected) ? 2 : 1;
      ctx.stroke();

      // Label at wedge center.
      const labelAng = (a0 + a1) / 2;
      const labelR = (WEDGE_INNER + WEDGE_OUTER) / 2;
      const lx = cx + Math.cos(labelAng) * labelR;
      const ly = cy + Math.sin(labelAng) * labelR;
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Shorten long names so they fit.
      const label = def.name.length > 4 ? def.name.slice(0, 4) : def.name;
      ctx.fillText(label, lx, ly);
      // Hotkey hint below.
      ctx.fillStyle = '#cccccc';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(String(i + 1), lx, ly + 11);
    }

    // Center circle.
    ctx.beginPath();
    ctx.arc(cx, cy, CENTER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2a';
    ctx.fill();
    ctx.strokeStyle = '#d4a64a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#d4a64a';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Build', cx, cy - 4);
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('B / Esc', cx, cy + 8);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}
