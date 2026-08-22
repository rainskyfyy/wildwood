/**
 * MonsterService — the ONE way to spawn, mutate, or query monsters.
 * Spawn defaults, per-frame update with event multipliers, damage
 * funnel, hit-test, render-resolution, persistence — all behind
 * the service so the v0.7 联机层 WorldState.serialize can carry
 * the monster roster as a single list.
 *
 * Design contract:
 *   - Owns a single MonsterManager instance.
 *   - Mutate: spawnOne / spawnDefaults / damage / kill.
 *   - Read:   list / visible / findNearest / count / monsters (getter) / resolveSprite.
 *   - update() takes the active event multiplier so callers don't
 *     have to remember to read it from EventService and apply it
 *     monster-by-monster (that was the v0.6.0a hand-rolled path in
 *     runtime.js).
 *   - Pass-through `monsterMgr` (render / Multiplayer only) returns
 *     the same underlying instance; mutation MUST go through service.
 *
 * v0.7.0a — wraps MonsterManager v0.5.2.
 */
'use strict';

import { MonsterManager } from '../monster/monster-manager.js';

export class MonsterService {
  /**
   * @param {Object} [opts] — forwarded to MonsterManager
   * @param {MonsterManager} [opts.monsterMgr] — reuse existing
   */
  constructor(opts = {}) {
    const { monsterMgr, ...rest } = opts;
    this._mgr = monsterMgr || new MonsterManager(rest);
  }

  // ─── Lifecycle / delegation ──────────────────────────────

  /** Direct access to the underlying MonsterManager (render / Multiplayer). */
  get monsterMgr() { return this._mgr; }

  /** Live monster list. Read-only by convention. */
  get monsters() { return this._mgr.monsters; }

  // ─── Read ────────────────────────────────────────────────

  /**
   * Snapshot the current monster list. Shallow copy.
   * @returns {Array<import('../monster/monster.js').Monster>}
   */
  list() { return this._mgr.monsters.slice(); }

  /**
   * Number of currently-spawned monsters.
   * @returns {number}
   */
  count() { return this._mgr.monsters.length; }

  /**
   * Visible monsters in the camera view. Pass-through.
   * @param {import('../player/camera.js').Camera} camera
   * @returns {Array}
   */
  visible(camera) { return this._mgr.visible(camera); }

  /**
   * Resolve a sprite for a monster (with procedural fallback).
   * @param {import('../monster/monster.js').Monster} m
   * @returns {HTMLImageElement|HTMLCanvasElement}
   */
  resolveSprite(m) { return this._mgr.resolveSprite(m); }

  /**
   * Find the nearest live monster to `pos` (in world tile coords).
   * Skips DEAD / hp<=0 by default.
   *
   * @param {{x:number, y:number}} pos
   * @param {Object} [opts]
   * @param {boolean} [opts.aliveOnly=true] — skip dead monsters
   * @param {number} [opts.maxDist=Infinity]
   * @returns {import('../monster/monster.js').Monster|null}
   */
  findNearest(pos, { aliveOnly = true, maxDist = Infinity } = {}) {
    let best = null, bestD = maxDist;
    for (const m of this._mgr.monsters) {
      if (aliveOnly && (m.state === 'DEAD' || m.hp <= 0)) continue;
      const d = Math.hypot(m.x - pos.x, m.y - pos.y);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  // ─── Mutate ──────────────────────────────────────────────

  /**
   * Spawn the default roster (1 of each type, deterministic tiles).
   * Used by demo.html at boot.
   */
  spawnDefaults() { this._mgr.spawnDefaults(); }

  /**
   * Spawn a single monster of `typeId` at fractional world coords.
   * @param {string} typeId
   * @param {number} x
   * @param {number} y
   * @param {number} [instanceIndex=0]
   * @returns {import('../monster/monster.js').Monster|null}
   */
  spawnOne(typeId, x, y, instanceIndex = 0) {
    return this._mgr.spawnOne(typeId, x, y, instanceIndex);
  }

  /**
   * Apply damage to a monster. Returns the remaining hp (0 if
   * killed) or null if the monster is invalid. Dead monsters stay
   * in the list with state=DEAD until `kill()` sweeps them.
   *
   * @param {import('../monster/monster.js').Monster} m
   * @param {number} amount
   * @returns {number|null}
   */
  damage(m, amount) {
    if (!m || typeof m.hp !== 'number') return null;
    m.hp -= amount;
    if (m.hp <= 0) {
      m.hp = 0;
      if (typeof m.onDeath === 'function') m.onDeath();
    }
    return m.hp;
  }

  /**
   * Remove a monster from the live list (set DEAD then splice).
   * Idempotent: removing a non-existent monster is a no-op.
   *
   * @param {import('../monster/monster.js').Monster} m
   * @returns {boolean}
   */
  kill(m) {
    if (!m) return false;
    const idx = this._mgr.monsters.indexOf(m);
    if (idx < 0) return false;
    m.state = 'DEAD';
    this._mgr.monsters.splice(idx, 1);
    return true;
  }

  // ─── Per-frame update with event multiplier ──────────────

  /**
   * Per-frame tick. Caller (runtime.js) hands in the active event
   * multiplier; the service applies it to every monster's
   * effectiveAtk / effectiveSpeed before stepping.
   *
   * @param {number} dt
   * @param {{x:number, y:number}} player
   * @param {{atk:number, speed:number}} [multiplier] — defaults to {1,1}
   */
  update(dt, player, multiplier = { atk: 1, speed: 1 }) {
    const m = multiplier || { atk: 1, speed: 1 };
    const atkMul = (typeof m.atk === 'number') ? m.atk : 1;
    const speedMul = (typeof m.speed === 'number') ? m.speed : 1;
    for (const mon of this._mgr.monsters) {
      mon.effectiveAtk = Math.max(
        1, Math.round((mon.config?.atk || 1) * (atkMul))
      );
      mon.effectiveSpeed = (mon.config?.speed || 1) * (speedMul);
    }
    this._mgr.update(dt, player);
  }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Snapshot for save/load. Returns:
   *   { schema: 1, monsters: [{typeId,x,y,hp,maxHp,facing,state,seed}, ...] }
   *
   * We capture enough to rebuild a Monster-like object on load; the
   * action-state machine is reset to 'idle' on load (deeper
   * rehydration is out of scope for v0.7).
   */
  serialize() {
    return {
      schema: 1,
      seed: this._mgr.seed,
      monsters: this._mgr.monsters.map(m => ({
        typeId: m.typeId,
        x: m.x, y: m.y,
        hp: m.hp, maxHp: m.maxHp,
        facing: m.facing,
        state: m.state,
        seed: m.seed
      }))
    };
  }

  /**
   * Load a snapshot. Throws on schema mismatch.
   * Resets the live list and re-spawns each monster at its stored
   * (x, y). We use the existing spawnOne path so the state table
   * cache is preserved.
   *
   * @param {Object} snap
   * @param {number} [instanceIndexBase=0] — for reproducible seeds
   */
  loadSnapshot(snap, instanceIndexBase = 0) {
    if (!snap || snap.schema !== 1) {
      throw new Error(`MonsterService.loadSnapshot: unsupported schema ${snap?.schema}`);
    }
    this._mgr.monsters.length = 0;
    let i = instanceIndexBase;
    for (const d of snap.monsters || []) {
      const m = this._mgr.spawnOne(d.typeId, d.x, d.y, i++);
      if (!m) continue;
      m.hp = d.hp;
      m.maxHp = d.maxHp;
      m.facing = d.facing;
      m.state = d.state;
    }
  }
}

/**
 * Factory — replaces `new MonsterManager(...)` at construction
 * sites that already want the service. Existing main.js can keep
 * using `new MonsterManager(...)` and wrap it in
 * `new MonsterService({ monsterMgr })`.
 */
export function createMonsterService(opts) {
  return new MonsterService(opts);
}
