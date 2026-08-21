/**
 * BossBar — top-of-screen HP bar for the most-engaged boss.
 *
 * Tracks the boss with the highest current aggro (closest / lowest
 * HP). When a boss is engaged, renders a horizontal HP bar with
 * phase tick marks (one per phase boundary). Phase ticks light up
 * as phases advance.
 *
 * Engine-agnostic: takes a BossManager-like object with
 * `.bosses` (each boss has .hp, .maxHp, .phase, .config.phases,
 * .state, .config.name, .config.color).
 *
 * v0.5.2 — first cut.
 */
'use strict';

const BAR_W = 360;
const BAR_H = 18;
const BAR_PAD_X = 12;
const BAR_PAD_Y = 12;
const PHASE_TICK_H = 6;
const BORDER_COLOR = '#0e0d12';
const BAR_BG = 'rgba(20, 18, 28, 0.78)';
const BAR_FG_LOW = '#c43a3a';
const BAR_FG_MID = '#d4a82a';
const BAR_FG_HIGH = '#6ec474';

/**
 * Pick the boss we should display — alive, on the screen-side of
 * the player (we just use hp > 0 + state != dead), and prefer
 * the one with the lowest HP ratio (most engaged). Returns null
 * if no boss is alive.
 */
function pickActiveBoss(bossManager) {
  if (!bossManager || !bossManager.bosses) return null;
  const alive = bossManager.bosses.filter(
    b => b && b.hp > 0 && b.state !== 'dead'
  );
  if (alive.length === 0) return null;
  // Sort by ascending hp/maxHp ratio (lowest first = most engaged).
  return alive.slice().sort((a, b) => {
    const ra = a.maxHp > 0 ? a.hp / a.maxHp : 1;
    const rb = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    return ra - rb;
  })[0];
}

export class BossBar {
  constructor(ctx) {
    this.ctx = ctx;
    this._lastBossId = null;
  }

  /**
   * Draw the boss bar. Returns the boss currently displayed (or
   * null) so callers can do extra UI (e.g. a phase-change flash).
   */
  draw(bossManager, cameraWidth) {
    if (!this.ctx) return null;
    const boss = pickActiveBoss(bossManager);
    if (!boss) {
      this._lastBossId = null;
      return null;
    }
    this._lastBossId = boss.config ? boss.config.id : null;
    const ctx = this.ctx;
    const phases = (boss.config && boss.config.phases) || [];
    const x = BAR_PAD_X;
    const y = BAR_PAD_Y;
    const w = BAR_W;
    const h = BAR_H;
    const ratio = boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;

    // Background panel
    ctx.save();
    ctx.fillStyle = BAR_BG;
    ctx.fillRect(x - 4, y - 4, w + 8, h + 12);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 12);

    // HP fill — color shifts as HP drops
    const fillColor = ratio > 0.5 ? BAR_FG_HIGH
                    : ratio > 0.25 ? BAR_FG_MID
                    : BAR_FG_LOW;
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w * ratio, h);

    // Boss name + current phase
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'top';
    const name = (boss.config && boss.config.name) || 'Boss';
    const phaseLabel = phases.length > 0
      ? ` · 阶段 ${(boss.phase | 0) + 1}/${phases.length}`
      : '';
    ctx.fillText(name + phaseLabel, x + 2, y + h + 1);

    // Phase tick marks — placed at hpThreshold * w for each phase
    // (phase 0 is the implicit "100%" mark, so skip it).
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 1; i < phases.length; i++) {
      const t = phases[i].hpThreshold;
      if (t == null) continue;
      const tx = x + w * t;
      ctx.fillRect(tx - 1, y - 2, 2, h + 4);
    }
    // Glow the last-crossed phase tick
    if (phases.length > 0 && boss.phase > 0) {
      const t = phases[boss.phase].hpThreshold;
      if (t != null) {
        const tx = x + w * t;
        ctx.fillStyle = '#ffe27a';
        ctx.fillRect(tx - 2, y - 4, 4, h + 8);
      }
    }

    ctx.restore();
    return boss;
  }
}
