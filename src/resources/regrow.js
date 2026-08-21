/**
 * RegrowManager — ticks all ResourceEntity regrow timers and emits
 * one-shot events for entities that just respawned.
 *
 *   const mgr = new RegrowManager(entities, onRegrow);
 *   mgr.update(now);
 *
 * Now source is injectable so tests can use a virtual clock without
 * monkey-patching Date.now() / performance.now().
 */
'use strict';

export class RegrowManager {
  constructor({ entities, onRegrow = null, now = () => Date.now() } = {}) {
    this.entities = entities;
    this.onRegrow = onRegrow;
    this.now = now;
    this._lastRespawnCount = 0;
  }

  /**
   * Tick all entities. Returns the list of entities that respawned
   * this frame (may be empty).
   */
  update(now) {
    const t = now ?? this.now();
    const respawned = [];
    for (const e of this.entities) {
      if (e.update(t)) respawned.push(e);
    }
    this._lastRespawnCount = respawned.length;
    if (respawned.length && typeof this.onRegrow === 'function') {
      for (const e of respawned) this.onRegrow(e);
    }
    return respawned;
  }

  lastRespawnCount() { return this._lastRespawnCount; }
}
