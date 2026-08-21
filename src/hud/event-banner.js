/**
 * EventBanner — top-of-screen notification for active events.
 *
 * Two surface modes:
 *   1. **Active strip** — small, persistent at the top under the
 *      boss bar; lists the currently-running event(s). Disappears
 *      automatically when the event ends.
 *   2. **Flash notice** — large, fading banner shown for ~1.6s
 *      whenever an event starts or ends. Driven by the
 *      `onNotice` callback from EventManager.
 *
 * Both are driven by the EventManager. The banner is a pure
 * draw-only consumer — it doesn't mutate the event state.
 *
 * v0.5.2 — first cut.
 */
'use strict';

const ACTIVE_W = 200;
const ACTIVE_H = 22;
const ACTIVE_X = 12;
const ACTIVE_Y = 44;  // below boss bar
const FLASH_W = 360;
const FLASH_H = 48;
const FLASH_HOLD_S = 1.2;
const FLASH_FADE_S = 0.5;
const BORDER_COLOR = '#0e0d12';

export class EventBanner {
  constructor(ctx) {
    this.ctx = ctx;
    /** Flash notices to draw, each {text, type, t, life}. */
    this._flashes = [];
  }

  /**
   * Add a flash notice. Called by main.js's onNotice hook:
   *   onNotice = (n) => { if (n.type==='start') banner.flash(...); }
   *
   * @param {string} text  — what to display
   * @param {'start'|'end'} type — colors the bar slightly differently
   */
  flash(text, type = 'start') {
    this._flashes.push({
      text, type,
      t: 0, life: FLASH_HOLD_S + FLASH_FADE_S
    });
  }

  /**
   * Drop any expired flashes. Called once per frame.
   */
  _pruneFlashes(dt) {
    for (const f of this._flashes) f.t += dt;
    this._flashes = this._flashes.filter(f => f.t < f.life);
  }

  /**
   * Draw the persistent active-event strip + any flash notices.
   */
  draw(eventManager, dt) {
    if (!this.ctx) return;
    this._pruneFlashes(dt || 0);
    // Persistent strip
    if (eventManager && eventManager.activeCount() > 0) {
      for (const e of eventManager._active) {
        this._drawActive(e);
      }
    }
    // Flash notices (drawn over the strip; most recent on top)
    for (const f of this._flashes) this._drawFlash(f);
  }

  _drawActive(entry) {
    const ctx = this.ctx;
    const x = ACTIVE_X;
    const y = ACTIVE_Y;
    const w = ACTIVE_W;
    const h = ACTIVE_H;
    const ratio = entry.event.duration > 0
      ? Math.max(0, Math.min(1, 1 - (entry.endAt - this._now()) / entry.event.duration))
      : 1;
    const remain = Math.max(0, entry.endAt - this._now());
    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(20, 18, 28, 0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // Time-progress bar
    ctx.fillStyle = entry.id === 'full_moon' ? '#d4a82a'
                  : entry.id === 'meteor_shower' ? '#a85a3a'
                  : '#6a8aaa';
    ctx.fillRect(x, y + h - 3, w * ratio, 3);
    // Text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(entry.event.name, x + 6, y + h / 2 - 2);
    ctx.fillStyle = '#dcdcd0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${remain.toFixed(0)}s`, x + w - 6, y + h / 2 - 2);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  _drawFlash(f) {
    const ctx = this.ctx;
    const fadeT = Math.max(0, f.t - FLASH_HOLD_S);
    const alpha = f.t < FLASH_HOLD_S
      ? 1
      : Math.max(0, 1 - fadeT / FLASH_FADE_S);
    const x = (this.ctx.canvas.width - FLASH_W) / 2;
    const y = 60;
    const w = FLASH_W;
    const h = FLASH_H;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.type === 'end' ? 'rgba(60, 60, 70, 0.85)' : 'rgba(212, 168, 42, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const label = f.type === 'end' ? '结束: ' : '';
    ctx.fillText(label + f.text, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /**
   * Override the time source for tests / main.js clock injection.
   * Defaults to a wall-clock millisecond read.
   */
  _now() {
    if (this._nowFn) return this._nowFn();
    return performance.now() / 1000;
  }
}
