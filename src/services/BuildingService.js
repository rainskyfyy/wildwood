/**
 * BuildingService — the ONE way to mutate or query placed buildings.
 * Placement, removal, damage, hit-test — everything funnels through
 * the service so the v0.7 联机层 WorldState.serialize can persist
 * the building set as a flat array.
 *
 * Design contract:
 *   - Owns a single BuildingManager instance.
 *   - Mutate: place / remove / removeAt / damage.
 *   - Read:   canPlace / findAt / list / count / buildings (getter).
 *   - Pass-through `buildingMgr` (render / Multiplayer only) returns
 *     the same underlying instance; mutation MUST go through service.
 *
 * v0.7.0a — wraps BuildingManager v0.5.2.
 */
'use strict';

import { BuildingManager, Building, chebyshev } from '../buildings/placer.js';

export class BuildingService {
  /**
   * @param {Object} [opts]
   * @param {import('../world/generator.js').WorldGrid} [opts.world]
   * @param {BuildingManager} [opts.buildingMgr] — reuse existing
   */
  constructor({ world = null, buildingMgr = null } = {}) {
    this._mgr = buildingMgr || new BuildingManager(world);
  }

  // ─── Lifecycle / delegation ──────────────────────────────

  /** Direct access to the underlying BuildingManager (render / Multiplayer). */
  get buildingMgr() { return this._mgr; }

  /** Currently-placed buildings. Read-only by convention. */
  get buildings() { return this._mgr.buildings; }

  /** Chebyshev distance utility (re-exported for callers). */
  static chebyshev(ax, ay, bx, by) { return chebyshev(ax, ay, bx, by); }

  // ─── Read ────────────────────────────────────────────────

  /**
   * Validate a placement. Returns {ok:true} or {ok:false, reason}.
   * @param {string} typeId
   * @param {number} tx
   * @param {number} ty
   * @param {{x:number, y:number}} player
   * @param {number} [maxRange=2]
   * @returns {{ok:boolean, reason?:string}}
   */
  canPlace(typeId, tx, ty, player, maxRange = 2) {
    return this._mgr.canPlace(typeId, tx, ty, player, maxRange);
  }

  /**
   * Hit-test: which building (if any) contains tile (x, y)?
   * @param {number} x
   * @param {number} y
   * @returns {Building|null}
   */
  findAt(x, y) {
    for (const b of this._mgr.buildings) {
      if (b.contains(x, y)) return b;
    }
    return null;
  }

  /**
   * Snapshot the current building list. Shallow copy.
   * @returns {Building[]}
   */
  list() { return this._mgr.buildings.slice(); }

  /**
   * Number of placed buildings.
   * @returns {number}
   */
  count() { return this._mgr.buildings.length; }

  // ─── Mutate ──────────────────────────────────────────────

  /**
   * Place a building after a `canPlace` check. Returns:
   *   {ok:true, building} or {ok:false, reason}
   * Does NOT throw on invalid placement (unlike the bare manager).
   *
   * @param {string} typeId
   * @param {number} tx
   * @param {number} ty
   * @param {{x:number, y:number}} player
   * @returns {{ok:boolean, building?:Building, reason?:string}}
   */
  place(typeId, tx, ty, player) {
    const check = this._mgr.canPlace(typeId, tx, ty, player);
    if (!check.ok) return { ok: false, reason: check.reason };
    try {
      const b = this._mgr.place(typeId, tx, ty, player);
      return { ok: true, building: b };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * Remove a building. Returns true on success.
   * @param {Building} b
   * @returns {boolean}
   */
  remove(b) { return this._mgr.remove(b); }

  /**
   * Remove the building under tile (x, y), if any. Convenience
   * for right-click-to-destroy without first finding the building.
   * @param {number} x
   * @param {number} y
   * @returns {Building|null} removed building or null
   */
  removeAt(x, y) {
    const b = this.findAt(x, y);
    if (!b) return null;
    return this._mgr.remove(b) ? b : null;
  }

  /**
   * Apply damage to a building; auto-removes at 0 hp.
   * @param {Building} b
   * @param {number} amount
   * @returns {Building|null} destroyed instance or null
   */
  damage(b, amount) { return this._mgr.damage(b, amount); }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Snapshot for save/load. Returns:
   *   { schema: 1, buildings: [{typeId,tx,ty,w,h,hp,maxHp,entityId}, ...] }
   *
   * Note: entityId is preserved so world.occupants can be re-applied
   * by the host on loadSnapshot. We do NOT serialize `nextEntityId` —
   * host computes its own counter from the high-water mark on load.
   */
  serialize() {
    return {
      schema: 1,
      buildings: this._mgr.buildings.map(b => ({
        typeId: b.typeId,
        tx: b.tx, ty: b.ty,
        w: b.w, h: b.h,
        hp: b.hp, maxHp: b.maxHp,
        entityId: b.entityId
      }))
    };
  }

  /**
   * Load a snapshot. Throws on schema mismatch.
   * Caller is responsible for clearing world.occupants first.
   * @param {Object} snap
   * @param {import('../world/generator.js').WorldGrid} world — used
   *   to re-occupy tiles for each loaded building.
   */
  loadSnapshot(snap, world) {
    if (!snap || snap.schema !== 1) {
      throw new Error(`BuildingService.loadSnapshot: unsupported schema ${snap?.schema}`);
    }
    if (!world) throw new Error('BuildingService.loadSnapshot: world is required');
    this._mgr.buildings.length = 0;
    let maxEntityId = 0;
    for (const d of snap.buildings || []) {
      const b = new Building({
        typeId: d.typeId,
        tx: d.tx, ty: d.ty,
        w: d.w, h: d.h,
        hp: d.hp, maxHp: d.maxHp,
        entityId: d.entityId
      });
      this._mgr.buildings.push(b);
      for (let dy = 0; dy < d.h; dy++) {
        for (let dx = 0; dx < d.w; dx++) {
          world.occupy(d.tx + dx, d.ty + dy, d.entityId);
        }
      }
      if (d.entityId > maxEntityId) maxEntityId = d.entityId;
    }
    this._mgr._highWater = maxEntityId;
  }
}

/**
 * Factory — replaces `new BuildingManager(world)` at construction
 * sites that already want the service. Existing main.js can keep
 * using `new BuildingManager(world)` and wrap it in
 * `new BuildingService({ world, buildingMgr })`.
 */
export function createBuildingService(opts) {
  return new BuildingService(opts);
}
