/**
 * EventManager — activates, ticks, and tears down random events.
 *
 * Lifecycle for one event:
 *   trigger(id, now)
 *     → push onto _active; call _applyEffects() which spawns POIs,
 *       inserts monster_attr multipliers, drops meteors, etc.
 *     → fires onNotice({type:'start', event}) so HUD can flash a banner.
 *
 *   update(now)
 *     → for each active event, if (now - startAt) >= duration,
 *       call _removeEffects() and pop it. Fires onNotice({type:'end'}).
 *
 *   Trigger rules:
 *     - Only one event may be active at a time (new trigger() while
 *       one is running replaces the old one cleanly).
 *
 * Reading state:
 *   - isActive(id)            — true while that event is running
 *   - activeCount()           — number of active events
 *   - activeEffects           — flat list of effect objects from all
 *                               currently active events (used by
 *                               MonsterManager to apply multipliers)
 *   - getMonsterMultiplier()  — composite (atk, speed) returned to
 *                               the player-attack pipeline
 *   - pois                   — POI objects spawned by active events
 *                              (caves, meteor crash sites, etc.)
 *
 * The manager is engine-agnostic: it mutates the world only via
 * injected references and the `onNotice` callback.
 *
 * v0.5.2 — first cut.
 */
'use strict';

import { EventRegistry } from './events.js';

let _nextPoiId = 1;

/**
 * Try to find a walkable tile near (cx, cy) for spawning a POI or
 * a meteor. Walks a small spiral; returns null if nothing walkable
 * is found in `radius` tiles.
 */
function findWalkableNear(world, cx, cy, radius = 4) {
  if (!world || typeof world.isWalkable !== 'function') return null;
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (world.isWalkable(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export class EventManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {import('../boss/boss-manager.js').BossManager} [opts.bossManager]
   * @param {import('../monster/monster-manager.js').MonsterManager} [opts.monsterManager]
   * @param {()=>number} [opts.rng] — injectable PRNG
   * @param {()=>number} [opts.now] — injectable clock
   * @param {(notice:Object)=>void} [opts.onNotice] — called on start/end
   * @param {(itemId:string, count:number, x:number, y:number)=>void} [opts.onMeteorDrop]
   *   — called for each meteor-fall item. Lets the host game spawn
   *     a real entity instead of just logging.
   */
  constructor({
    world, bossManager = null, monsterManager = null,
    rng = null, now = null,
    onNotice = null, onMeteorDrop = null
  } = {}) {
    if (!world) throw new Error('EventManager: world is required');
    this.world = world;
    this.bossManager = bossManager;
    this.monsterManager = monsterManager;
    this._rng = rng;
    this._now = now || (() => 0);
    this._onNotice = onNotice;
    this._onMeteorDrop = onMeteorDrop;
    /**
     * Active events: array of { id, event, startAt, endAt, spawnedPois[] }
     * Only one entry at a time by design.
     */
    this._active = [];
    /**
     * Public POI list (caves, meteor impact sites, etc.).
     * Mutated on trigger/update; the renderer / main.js reads it.
     */
    this.pois = [];
    /**
     * Active effect objects (flat list across all active events).
     * Read by MonsterManager to apply atkMul / speedMul.
     */
    this.activeEffects = [];
  }

  /**
   * Activate an event. If another is already running, tear it down
   * first (replacement semantics — only one event at a time).
   * @param {string} id
   * @param {number} now
   * @returns {boolean} true on success
   */
  trigger(id, now) {
    const event = EventRegistry.get(id);
    if (!event) return false;
    // Replace any running event.
    while (this._active.length > 0) {
      const old = this._active.pop();
      this._removeEffects(old);
    }
    const entry = {
      id: event.id,
      event,
      startAt: now,
      endAt: now + event.duration,
      spawnedPois: []
    };
    this._active.push(entry);
    this._applyEffects(entry);
    // Rebuild activeEffects so getMonsterMultiplier() reflects the
    // new event immediately (without waiting for the next update()).
    this.activeEffects = [];
    for (const e of this._active) {
      for (const eff of e.event.effects || []) {
        this.activeEffects.push(eff);
      }
    }
    if (typeof this._onNotice === 'function') {
      this._onNotice({ type: 'start', event });
    }
    return true;
  }

  /**
   * Tick the active events; expire any that have passed their
   * endAt. Re-entrant and idempotent.
   * @param {number} now
   */
  update(now) {
    if (this._active.length === 0) return;
    const remaining = [];
    for (const entry of this._active) {
      if (now >= entry.endAt) {
        this._removeEffects(entry);
        if (typeof this._onNotice === 'function') {
          this._onNotice({ type: 'end', event: entry.event });
        }
      } else {
        remaining.push(entry);
      }
    }
    this._active = remaining;
    // Rebuild activeEffects from the new active set.
    this.activeEffects = [];
    for (const e of this._active) {
      for (const eff of e.event.effects || []) {
        this.activeEffects.push(eff);
      }
    }
  }

  /**
   * True iff the named event is currently running.
   */
  isActive(id) {
    return this._active.some(e => e.id === id);
  }

  /**
   * Number of currently active events. By design, this is 0 or 1.
   */
  activeCount() {
    return this._active.length;
  }

  /**
   * Composite monster stat multiplier from all active events.
   * Returns { atk: 1, speed: 1 } when no event is active.
   * @returns {{atk:number, speed:number}}
   */
  getMonsterMultiplier() {
    let atk = 1, speed = 1;
    for (const eff of this.activeEffects) {
      if (eff.kind === 'monster_attr') {
        if (typeof eff.atkMul === 'number') atk *= eff.atkMul;
        if (typeof eff.speedMul === 'number') speed *= eff.speedMul;
      }
    }
    return { atk, speed };
  }

  // ── internal ─────────────────────────────────────────────────

  /**
   * Apply the declarative effects of a freshly-triggered event.
   * Each effect kind is handled here in a small switch.
   */
  _applyEffects(entry) {
    for (const eff of entry.event.effects || []) {
      switch (eff.kind) {
        case 'monster_attr':
          // Already represented via activeEffects; the MonsterManager
          // reads it on its tick. No mutation needed here.
          break;
        case 'meteor_fall': {
          const cx = Math.floor(this.world.width / 2);
          const cy = Math.floor(this.world.height / 2);
          const pool = eff.itemPool || ['iron_ore'];
          for (let i = 0; i < (eff.count || 0); i++) {
            const tile = findWalkableNear(this.world, cx, cy, 8);
            if (!tile) break;
            const itemId = pool[Math.floor(this._rngOrRandom() * pool.length)];
            const id = _nextPoiId++;
            const poi = {
              id, kind: 'meteor', x: tile.x, y: tile.y,
              itemId, radius: eff.dropRadius || 1.0,
              eventId: entry.id
            };
            this.pois.push(poi);
            entry.spawnedPois.push(poi);
            if (typeof this._onMeteorDrop === 'function') {
              this._onMeteorDrop(itemId, 1, tile.x, tile.y);
            }
          }
          break;
        }
        case 'cave_poi': {
          const cx = Math.floor(this.world.width / 2);
          const cy = Math.floor(this.world.height / 2);
          for (let i = 0; i < (eff.count || 0); i++) {
            const tile = findWalkableNear(this.world, cx, cy, 6);
            if (!tile) break;
            const id = _nextPoiId++;
            const poi = {
              id, kind: 'cave', x: tile.x, y: tile.y,
              radius: eff.radius || 1.0,
              expiresWith: !!eff.expiresWith,
              eventId: entry.id
            };
            this.pois.push(poi);
            entry.spawnedPois.push(poi);
          }
          break;
        }
        default:
          // Unknown effect kinds are ignored (forward-compat hook).
          break;
      }
    }
  }

  /**
   * Reverse the effects of an event when it expires. Anything
   * flagged `expiresWith: true` is removed from `this.pois`.
   */
  _removeEffects(entry) {
    if (!entry.spawnedPois || entry.spawnedPois.length === 0) return;
    const ids = new Set(entry.spawnedPois.map(p => p.id));
    this.pois = this.pois.filter(p => !ids.has(p.id) || !p.expiresWith);
  }

  _rngOrRandom() {
    return this._rng ? this._rng() : Math.random();
  }
}
