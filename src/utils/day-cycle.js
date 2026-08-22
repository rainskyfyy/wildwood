/**
 * Day cycle — minimal 8-minute day + 4-minute night for v0.5.4.
 *
 * Drives the piglin state machine (HOME/WANDER vs SLEEP). Bigger
 * features (sky tint, lighting, season tags) come later.
 *
 * Constants:
 *   - DAY_LEN   = 8 * 60   seconds in a day period (8 minutes)
 *   - NIGHT_LEN = 4 * 60   seconds in a night period (4 minutes)
 *   - cycleLen  = DAY_LEN + NIGHT_LEN
 */
'use strict';

export const DAY_LEN = 8 * 60;       // 480 s
export const NIGHT_LEN = 4 * 60;     // 240 s
export const CYCLE_LEN = DAY_LEN + NIGHT_LEN;

export class DayCycle {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.t0] — initial time-of-day offset (s)
   * @param {number} [opts.scale] — multiplier (debug: 10x faster)
   */
  constructor({ t0 = 0, scale = 1 } = {}) {
    this.t = t0;
    this.scale = scale;
  }

  /** Advance time by dt seconds. */
  update(dt) {
    this.t = (this.t + dt * this.scale) % CYCLE_LEN;
  }

  /** True during the day period. */
  isDay() {
    return this.t < DAY_LEN;
  }

  /** True during the night period. */
  isNight() {
    return this.t >= DAY_LEN;
  }

  /** 0..1 progress through the current period (day or night). */
  periodProgress() {
    return this.isDay() ? (this.t / DAY_LEN) : ((this.t - DAY_LEN) / NIGHT_LEN);
  }

  /** 0..1 progress through the full 24h-style cycle. */
  cycleProgress() {
    return this.t / CYCLE_LEN;
  }

  /** Total elapsed real time (mod cycle). */
  elapsed() {
    return this.t;
  }

  /**
   * Display label — e.g. "Day · 12:32" or "Night · 02:14".
   * The hour hand progresses 0..24 across the full cycle.
   */
  describe() {
    const totalHours = (this.t / CYCLE_LEN) * 24;
    const hh = Math.floor(totalHours);
    const mm = Math.floor((totalHours - hh) * 60);
    const tag = this.isDay() ? 'Day' : 'Night';
    return `${tag} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
