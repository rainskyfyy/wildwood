/**
 * Trade UI — minimal HTML overlay for the trading post.
 *
 * Opens when the player presses <kbd>T</kbd> while standing on (or
 * adjacent to) the trading post. Shows:
 *   - "Trader offers:" header
 *   - 1 row per stock item the player has: e.g. "carrot × 2  →  berries × 1"
 *   - A button to execute +1 of that trade, and a ×N input.
 *
 * The UI is drawn via plain DOM so it works in the existing demo.html
 * (which already has a <div class="UILayer"> with anchor slots).
 */
'use strict';
import { preview, execute, availableOffers } from './trader.js';
import { getItem } from '../resources/catalog.js';

const STYLE_ID = 'ww-trade-ui-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
  .ww-trade-panel {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20,20,30,0.95);
    border: 2px solid var(--accent, #d4a64a);
    border-radius: 0;
    padding: 12px 16px;
    color: #f0f0f0;
    font: 12px/1.4 ui-monospace, monospace;
    min-width: 320px;
    box-shadow: 2px 2px 0 var(--night-black, #101820);
    z-index: 200;
  }
  .ww-trade-panel h3 {
    margin: 0 0 8px 0; color: #d4a64a; font-size: 14px;
  }
  .ww-trade-panel table { width: 100%; border-collapse: collapse; }
  .ww-trade-panel th, .ww-trade-panel td {
    padding: 4px 6px; text-align: left; font-size: 11px;
  }
  .ww-trade-panel th { color: #d4a64a; border-bottom: 1px solid #444; }
  .ww-trade-panel tr.trade-row { background: rgba(212,166,74,0.05); }
  .ww-trade-panel tr.trade-row:hover { background: rgba(212,166,74,0.15); cursor: pointer; }
  .ww-trade-panel .trade-multi {
    color: #88c8ff; font-size: 10px; margin-left: 4px;
  }
  .ww-trade-panel .trade-empty {
    color: #888; font-style: italic; padding: 8px;
  }
  .ww-trade-panel .trade-close-bar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 4px;
  }
  `;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = css;
  document.head.appendChild(s);
}

export class TradeUI {
  /**
   * @param {Object} ctx
   * @param {import('../services/InventoryService.js').InventoryService} ctx.invSvc
   * @param {Object} ctx.state — TradeState
   * @param {Function} [ctx.onTrade] — called with the trade result
   */
  constructor({ invSvc, state, onTrade = null }) {
    this.invSvc = invSvc;
    this.state = state;
    this.onTrade = onTrade;
    this.visible = false;
    this._el = null;
  }

  isOpen() { return this.visible; }

  open() {
    if (this.visible) return;
    ensureStyles();
    const el = document.createElement('div');
    el.className = 'ww-trade-panel';
    // P1-13: 统一关闭按钮形态 —— 用 DOM 组件 .Dialog-Close × 按钮
    // (见 src/ui/components/components.css:.Dialog-Close),替换原先自绘的 .trade-close。
    const closeBtn = document.createElement('button');
    closeBtn.className = 'Dialog-Close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.setAttribute('data-act', 'close');
    closeBtn.textContent = '×';
    const header = document.createElement('div');
    header.className = 'trade-close-bar';
    const title = document.createElement('h3');
    title.textContent = '猪人交易';
    header.appendChild(title);
    header.appendChild(closeBtn);
    const body = document.createElement('div');
    body.setAttribute('data-role', 'body');
    el.appendChild(header);
    el.appendChild(body);
    el.addEventListener('click', (e) => {
      const t = e.target;
      if (t.matches('.Dialog-Close') || t.dataset.act === 'close') {
        this.close();
        return;
      }
      const row = t.closest('tr.trade-row');
      if (row) {
        const sell = row.dataset.sell;
        const count = parseInt(row.dataset.count, 10) || 1;
        this._tryTrade(sell, count);
      }
    });
    document.body.appendChild(el);
    this._el = el;
    this.visible = true;
    this._render();
  }

  close() {
    if (!this.visible) return;
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this.visible = false;
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }

  /** Rerender body (call after inventory or trade-state changes). */
  refresh() {
    if (this.visible) this._render();
  }

  _tryTrade(sellItem, count) {
    const r = execute(sellItem, count, {
      invSvc: this.invSvc,
      state: this.state
    });
    if (this.onTrade) this.onTrade(r);
    this._render();
  }

  _render() {
    if (!this._el) return;
    const body = this._el.querySelector('[data-role="body"]');
    if (!body) return;
    const offers = availableOffers(this.invSvc);
    if (offers.length === 0) {
      body.innerHTML = `<div class="trade-empty">背包里没有可交易物品。<br>把木头/石头/食物带来给猪人吧。</div>`;
      return;
    }
    const rows = offers.map(sellId => {
      const q = preview(sellId, 1, { invSvc: this.invSvc, state: this.state });
      if (!q || q.reason) return null;
      const sellMeta = getItem(sellId);
      const buyMeta = getItem(q.buyItem);
      const sellHave = this.invSvc.countOf(sellId);
      return `<tr class="trade-row" data-sell="${sellId}" data-count="1">
        <td>${sellMeta.name} ×1</td>
        <td>→ ${buyMeta.name} ×${q.buyCount}</td>
        <td class="trade-multi">×${q.multiplier.toFixed(2)}</td>
        <td style="color:#888">库存 ${sellHave}</td>
      </tr>`;
    }).filter(Boolean).join('');
    body.innerHTML = `
      <table>
        <thead><tr><th>给我</th><th>换</th><th>倍率</th><th>库存</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}
