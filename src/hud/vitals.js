/**
 * Vitals — 生命/饥饿/理智 三围条 (M4 Canvas 版)
 *
 * 旧版(M2.12 DOM)残留:
 *   - 构造函数收 `containerEl`,内调 `this.container.querySelector()`
 *   - 但 src/hud/hud.js:17 传的是 CanvasRenderingContext2D → TypeError
 *   - src/ui/hud.js 是另一套独立 DOM 系统,demo 用的;这套是引擎 HUD 用的
 *
 * 现版(M4 Canvas)契约:
 *   - 构造函数收 `ctx`(CanvasRenderingContext2D)
 *   - `draw(state)` 在 ctx 上画三根血条(左上角 12px 边距,向下排)
 *   - state 形状:{ hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max} }
 *   - 颜色按 ratio 切换:green > 30% / amber 10~30% / red < 10%
 *
 * 位置与样式参考 demo.html 中 .Anchor-TL .VitalBar 的视觉布局:
 *   - 顶层 4 个 PartySlot 之后,3 根条向下排列
 *   - 宽 ~200px,高 ~22px,4px 间距,12px 边距
 */

'use strict';

const VITALS = [
  { key: 'hp',     label: 'HP' },
  { key: 'hunger', label: 'HUN' },
  { key: 'sanity', label: 'SAN' }
];

const BAR_W = 200;
const BAR_H = 22;
const BAR_GAP = 4;
const MARGIN_X = 12;
const MARGIN_Y = 12;   // 留出 4 个 PartySlot 高度后开始;保守起见给 12
// PartySlot 实际占位 ~32px,所以 Y 从 12(已经够 PartySlot)+4*32 之后;
// 但 demo 4 槽有时折叠为 0,引擎 HUD 默认都画;给 56 让出 PartySlot 区
const PARTYS_Y = 56;

const COLOR_BG     = 'rgba(0,0,0,0.55)';
const COLOR_BORDER = 'rgba(212,166,74,0.7)';
const COLOR_FILL_OK   = '#7ec47e';
const COLOR_FILL_LOW  = '#d4a64a';
const COLOR_FILL_CRIT = '#e85a3a';
const COLOR_TEXT      = '#fff';
const COLOR_TEXT_DIM  = 'rgba(255,255,255,0.85)';

function pickFillColor(ratio) {
  if (ratio < 0.1) return COLOR_FILL_CRIT;
  if (ratio < 0.3) return COLOR_FILL_LOW;
  return COLOR_FILL_OK;
}

export class Vitals {
  /**
   * @param {CanvasRenderingContext2D} ctx - 引擎主画布的 ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * 在主 canvas 左上画 3 根血条。
   * @param {{hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}} state
   */
  draw(state) {
    if (!this.ctx) return;
    const s = state || {};
    const ctx = this.ctx;
    let y = PARTYS_Y;

    for (let i = 0; i < VITALS.length; i++) {
      const cfg = VITALS[i];
      const vs = s[cfg.key] || { cur: 0, max: 1 };
      const ratio = Math.max(0, Math.min(1, vs.cur / Math.max(1, vs.max)));
      const pct = Math.round(ratio * 100);
      const curRounded = Math.round(vs.cur);
      const x = MARGIN_X;

      // 1. 边框/底
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(x, y, BAR_W, BAR_H);
      ctx.strokeStyle = COLOR_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, BAR_W - 1, BAR_H - 1);

      // 2. 填充(按 ratio 上色)
      const fillW = Math.max(0, (BAR_W - 2) * ratio);
      ctx.fillStyle = pickFillColor(ratio);
      ctx.fillRect(x + 1, y + 1, fillW, BAR_H - 2);

      // 3. 标签
      ctx.fillStyle = COLOR_TEXT;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.label, x + 6, y + BAR_H / 2 + 1);

      // 4. 数字(cur/max)
      ctx.textAlign = 'right';
      ctx.fillStyle = COLOR_TEXT;
      const text = curRounded + '/' + vs.max;
      // 阴影让数字在绿/红底上都可读
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(text, x + BAR_W - 6 + 1, y + BAR_H / 2 + 1 + 1);
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(text, x + BAR_W - 6, y + BAR_H / 2 + 1);

      y += BAR_H + BAR_GAP;
    }
  }
}
