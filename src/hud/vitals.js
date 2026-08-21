/**
 * Vitals — 生命/饥饿/理智 三围条 (M2.12 DOM 版)
 *
 * M2.12 changes vs M4 Canvas 绘制:
 *   - 不再画 ctx,改为读 M1.8 .VitalBar 组件的 DOM 操作
 *   - 改 .VitalBar-Fill width 改值,改 .VitalBar-Value text 改数字
 *   - 状态类(is-low < 30% / is-critical < 10% / is-disabled)由 components.css 控制
 *   - 节流由 HUD.draw 负责,本类每次调用都做全量更新(轻量,3 个 <div>)
 *
 * 容器结构(M1.7 .Anchor-TL):
 *   <div class="Anchor-TL">
 *     ...
 *     <div class="VitalBar VitalBar-HP"     data-value="82">
 *       <div class="VitalBar-Fill" style="width:82%"></div>
 *       <div class="VitalBar-Value">82/100</div>
 *     </div>
 *     <div class="VitalBar VitalBar-Hunger" data-value="45">...</div>
 *     <div class="VitalBar VitalBar-Sanity" data-value="60">...</div>
 *   </div>
 */

'use strict';

const VITALS = [
  { key: 'hp',     sel: '.VitalBar-HP' },
  { key: 'hunger', sel: '.VitalBar-Hunger' },
  { key: 'sanity', sel: '.VitalBar-Sanity' }
];

export class Vitals {
  constructor(containerEl) {
    this.container = containerEl || null;
    // 缓存 3 个 VitalBar 元素引用,避免每次 querySelector
    this.bars = {};
    VITALS.forEach(function (v) {
      this.bars[v.key] = this.container ? this.container.querySelector(v.sel) : null;
    }.bind(this));
  }

  /**
   * @param {{hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}} state
   */
  draw(state) {
    var s = state || {};
    for (var i = 0; i < VITALS.length; i++) {
      var cfg = VITALS[i];
      var bar = this.bars[cfg.key];
      if (!bar) continue;
      var vs = s[cfg.key] || { cur: 0, max: 1 };
      var ratio = Math.max(0, Math.min(1, vs.cur / Math.max(1, vs.max)));
      var pct = Math.round(ratio * 100);
      var curRounded = Math.round(vs.cur);

      var fill = bar.querySelector('.VitalBar-Fill');
      var valEl = bar.querySelector('.VitalBar-Value');
      if (fill) fill.style.width = pct + '%';
      if (valEl) valEl.textContent = curRounded + '/' + vs.max;
      // 状态类(对照 components.css)
      bar.classList.toggle('is-low', ratio < 0.3 && ratio >= 0.1);
      bar.classList.toggle('is-critical', ratio < 0.1);
      bar.setAttribute('data-value', String(curRounded));
    }
  }
}
