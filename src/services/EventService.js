/**
 * EventService — the ONE way to mutate or query the active event.
 * The runtime layer and HUD call into this service instead of
 * touching EventManager directly, so the public surface is stable
 * for v0.7 联机层 WorldState.serialize.
 *
 * Design contract:
 *   - Owns a single EventManager instance.
 *   - Mutation methods are explicit: trigger / update / cancel.
 *   - Read methods: isActive / activeCount / getMonsterMultiplier /
 *     getActiveEffects / listPois.
 *   - `pois` and `activeEffects` are exposed as getters so callers
 *     can iterate without going through the manager.
 *   - Pass-through `eventMgr` (UI / render layer only) returns the
 *     same underlying instance — fields are read-only by convention;
 *     mutation MUST go through the service.
 *
 * v0.7.0a — wraps EventManager v0.5.2.
 */
'use strict';

import { EventManager } from '../events/event-manager.js';

export class EventService {
  /**
   * @param {Object} [opts] — forwarded to EventManager
   * @param {EventManager} [opts.eventMgr] — reuse an existing manager
   */
  constructor(opts = {}) {
    const { eventMgr, ...rest } = opts;
    this._mgr = eventMgr || new EventManager(rest);
  }

  // ─── Lifecycle / delegation ──────────────────────────────

  /** Direct access to the underlying EventManager (render layer only). */
  get eventMgr() { return this._mgr; }

  /** Active POIs (caves, meteor impact sites). Read-only by convention. */
  get pois() { return this._mgr.pois; }

  /** Active effect objects (flat list across all active events). */
  get activeEffects() { return this._mgr.activeEffects; }

  // ─── Read ────────────────────────────────────────────────

  /**
   * True iff the named event is currently running.
   * @param {string} id
   * @returns {boolean}
   */
  isActive(id) { return this._mgr.isActive(id); }

  /**
   * Number of currently active events (0 or 1 by design).
   * @returns {number}
   */
  activeCount() { return this._mgr.activeCount(); }

  /**
   * Composite monster stat multiplier from all active events.
   * @returns {{atk:number, speed:number}}
   */
  getMonsterMultiplier() { return this._mgr.getMonsterMultiplier(); }

  /**
   * Active effect objects (alias for `activeEffects` getter).
   * @returns {Array<Object>}
   */
  getActiveEffects() { return this._mgr.activeEffects; }

  /**
   * Snapshot the current POI list. Returns a shallow copy so callers
   * can iterate without worrying about mutation during the loop.
   * @returns {Array<Object>}
   */
  listPois() { return this._mgr.pois.slice(); }

  // ─── Mutate ──────────────────────────────────────────────

  /**
   * Activate an event. If another is running, it is torn down first
   * (replacement semantics). Returns true on success.
   * @param {string} id
   * @param {number} now
   * @returns {boolean}
   */
  trigger(id, now) { return this._mgr.trigger(id, now); }

  /**
   * Tick the active event; expire any past `endAt`. Re-entrant.
   * @param {number} now
   */
  update(now) { this._mgr.update(now); }

  /**
   * Force-cleanup the currently-active event (if any). Used by
   * cancel-button / scene change.
   * @returns {boolean} true if an event was cancelled
   */
  cancel() {
    if (this._mgr.activeCount() === 0) return false;
    // EventManager exposes internal _active; reach in once to drain
    // and remove effects. (trigger() with an unknown id is a no-op,
    // so we mutate _active directly via the documented internals.)
    while (this._mgr.activeCount() > 0) {
      // trigger() replacement logic needs an entry; we hand-roll
      // by calling the manager's internal removal via a no-op
      // approach: toggle through update(now) at far future.
      this._mgr.update(Number.POSITIVE_INFINITY);
    }
    return true;
  }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Snapshot for save/load. Returns:
   *   { schema: 1, active: [...], pois: [...], nextPoiId: number }
   */
  serialize() {
    return {
      schema: 1,
      active: this._mgr._active.map(e => ({
        id: e.id,
        startAt: e.startAt,
        endAt: e.endAt,
        spawnedPoiIds: (e.spawnedPois || []).map(p => p.id)
      })),
      pois: this._mgr.pois.map(p => ({ ...p })),
      nextPoiId: this._mgr._nextPoiId
    };
  }

  /**
   * Load a snapshot. Throws on schema mismatch.
   * @param {Object} snap
   */
  loadSnapshot(snap) {
    if (!snap || snap.schema !== 1) {
      throw new Error(`EventService.loadSnapshot: unsupported schema ${snap?.schema}`);
    }
    // Reset state and rehydrate.
    this._mgr._active.length = 0;
    this._mgr.pois.length = 0;
    this._mgr.activeEffects.length = 0;
    if (snap.pois) {
      for (const p of snap.pois) this._mgr.pois.push({ ...p });
    }
    if (typeof snap.nextPoiId === 'number') {
      this._mgr._nextPoiId = snap.nextPoiId;
    }
    // active[] is harder to rehydrate without a re-trigger; for v0.7
    // snapshot/replay is out of scope, so we leave _active empty and
    // let the host re-trigger if it wants the event running again.
  }
}

/**
 * Factory — replaces `new EventManager(...)` at construction sites
 * that already want the service. Existing main.js can keep using
 * `new EventManager(...)` and wrap it in `new EventService({ eventMgr })`.
 */
export function createEventService(opts) {
  return new EventService(opts);
}
