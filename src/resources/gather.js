/**
 * Gather — interaction state machine for harvesting resources.
 */
'use strict';

export const DEFAULT_RANGE = 1.75;
export const GATHER_IDLE       = 'idle';
export const GATHER_GATHERING  = 'gathering';
export const GATHER_JUST_DONE  = 'just_done';

export class Gather {
  constructor({ entities, inventory, range = DEFAULT_RANGE, onEvent = null } = {}) {
    this.entities  = entities;
    this.inventory = inventory;
    this.range     = range;
    this.onEvent   = onEvent;
    this.state     = GATHER_IDLE;
    this.target    = null;
    this.progress  = 0;
    this.lastLoot  = null;
  }

  findInRange(x, y) {
    let best = null;
    let bestDist = this.range;
    for (const e of this.entities) {
      if (e.depleted) continue;
      const d = e.distTo(x, y);
      if (d <= bestDist) { best = e; bestDist = d; }
    }
    return best;
  }

  click(x, y) {
    const e = this.findInRange(x, y);
    if (!e) {
      if (this.state === GATHER_GATHERING) this._cancel();
      return false;
    }
    if (this.state === GATHER_GATHERING && this.target === e) return true;
    this._start(e);
    return true;
  }

  update(player, dt) {
    if (this.state === GATHER_JUST_DONE) {
      this.state = GATHER_IDLE;
      return;
    }
    if (this.state !== GATHER_GATHERING) return;
    if (this.target == null || this.target.depleted) {
      this._cancel();
      return;
    }
    const d = this.target.distTo(player.x, player.y);
    if (d > this.range) { this._cancel(); return; }
    this.progress += dt;
    if (this.progress >= this.target.harvestTime) {
      const loot = this.target.harvest(this.inventory);
      this.lastLoot = loot;
      this._emit('complete', { entity: this.target, loot });
      this.state = GATHER_JUST_DONE;
      this.target = null;
      this.progress = 0;
    }
  }

  progressFraction() {
    if (this.state !== GATHER_GATHERING || !this.target) return 0;
    return Math.min(1, this.progress / this.target.harvestTime);
  }

  _start(e) {
    this.state = GATHER_GATHERING;
    this.target = e;
    this.progress = 0;
    this._emit('start', { entity: e });
  }

  _cancel() {
    if (this.state === GATHER_GATHERING) this._emit('cancel', { entity: this.target });
    this.state = GATHER_IDLE;
    this.target = null;
    this.progress = 0;
  }

  _emit(name, payload) {
    if (typeof this.onEvent === 'function') this.onEvent(name, payload);
  }
}
