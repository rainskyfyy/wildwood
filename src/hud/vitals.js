/**
 * Vital bars — HP / Hunger / Sanity (Don't Starve style).
 *
 * Pure draw. State (current/max) is read from the player model passed in.
 * Drawn in the top-left corner of the canvas overlay.
 *
 * Layout: 3 horizontal bars, stacked, each 120px wide × 14px tall.
 *  - HP:    red gradient
 *  - Hunger: amber
 *  - Sanity: purple
 *
 * Below each bar: a label. This layer lives in HUD coordinates (after
 * the world is drawn), so it's not affected by camera transform.
 */

'use strict';

const BAR_W = 140;
const BAR_H = 16;
const GAP   = 6;
const PAD   = 12;
const ICON_W = 16;

const VITALS = [
  { key: 'hp',     label: '生命', color: '#d04040', bg: '#3a1414' },
  { key: 'hunger', label: '饥饿', color: '#d0a040', bg: '#3a2a14' },
  { key: 'sanity', label: '理智', color: '#8040a0', bg: '#241430' }
];

export class Vitals {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * @param {{hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}} state
   */
  draw(state) {
    const ctx = this.ctx;
    let y = PAD;
    for (const v of VITALS) {
      const s = state[v.key] || { cur: 0, max: 1 };
      const ratio = Math.max(0, Math.min(1, s.cur / Math.max(1, s.max)));

      // Background frame.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(PAD - 2, y - 2, BAR_W + ICON_W + 4, BAR_H + 4);

      // Background bar.
      ctx.fillStyle = v.bg;
      ctx.fillRect(PAD + ICON_W, y, BAR_W, BAR_H);

      // Filled bar.
      ctx.fillStyle = v.color;
      ctx.fillRect(PAD + ICON_W, y, BAR_W * ratio, BAR_H);

      // Icon (drawn as a small colored circle for placeholder).
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.arc(PAD + ICON_W / 2, y + BAR_H / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label.
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.label, PAD + ICON_W + 4, y + BAR_H / 2 + 0.5);

      y += BAR_H + GAP;
    }
  }
}
