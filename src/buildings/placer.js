/**
 * Building placement — validates, places, removes buildings and tracks
 * tile occupation.
 *
 * Layer model:
 *   - `WorldGrid.occupants` is a Uint8Array of the same dimensions as
 *     `tiles`. 0 = empty, >0 = building entity id (1-based index into
 *     the BuildingManager.buildings array, +1 so 0 stays free).
 *   - `isWalkable` is updated to also check occupants, so the player
 *     cannot walk through placed buildings.
 *   - Each Building has a unique id, a type id, a top-left (tx, ty),
 *     a size [w, h], current/max hp, and the entity id stored in
 *     the grid.
 *
 * Range rule (per spec):
 *   - Player can only place within 2 tiles of themselves.
 *   - Use Chebyshev distance: max(|dx|, |dy|) <= 2.
 *
 * Validation flow (canPlace):
 *   1. tile is in world bounds
 *   2. tile is walkable (biome + not occupied)
 *   3. all building tiles fit in world bounds
 *   4. all building tiles are walkable / not occupied
 *   5. building is within range of player
 *
 * Removal:
 *   - free all tiles the building occupied
 *   - splice from the buildings array (entity id is recycled only
 *     when an id falls off the high-water mark; we keep the array
 *     compact by shifting).
 */

'use strict';

import { getBuilding } from './building-config.js';

/** Chebyshev distance: largest of |dx|, |dy|. */
export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

let _nextEntityId = 1;

/**
 * Allocate a fresh entity id. 1-based so 0 stays "empty" in the
 * occupants Uint8Array.
 */
function allocEntityId() {
  return _nextEntityId++;
}

/**
 * Reset the global id counter — used by smoke tests between runs to
 * keep output stable.
 */
export function _resetEntityIds() {
  _nextEntityId = 1;
}

/**
 * A placed building instance.
 *
 * Coordinates: `tx`, `ty` is the top-left tile. Size `[w, h]` extends
 * right (x+) and down (y+). Total tiles = w * h.
 */
export class Building {
  constructor({ typeId, tx, ty, w, h, hp, maxHp, entityId }) {
    this.id = typeId;            // building type id (string)
    this.typeId = typeId;        // alias for clarity at call sites
    this.tx = tx;                // top-left tile x
    this.ty = ty;                // top-left tile y
    this.w = w;
    this.h = h;
    this.hp = hp;
    this.maxHp = maxHp;
    this.entityId = entityId;    // 1-based; matches WorldGrid.occupants
  }

  /** Center of the building's footprint in tile coords (floating). */
  center() {
    return { x: this.tx + this.w / 2, y: this.ty + this.h / 2 };
  }

  /** All tile coordinates this building occupies. */
  tiles() {
    const out = [];
    for (let dy = 0; dy < this.h; dy++) {
      for (let dx = 0; dx < this.w; dx++) {
        out.push({ x: this.tx + dx, y: this.ty + dy });
      }
    }
    return out;
  }

  /** True if (x, y) is within the building's footprint. */
  contains(x, y) {
    return x >= this.tx && x < this.tx + this.w
        && y >= this.ty && y < this.ty + this.h;
  }
}

/**
 * Manages all placed buildings and the world occupants array.
 *
 * Usage:
 *   const mgr = new BuildingManager(world);
 *   const result = mgr.canPlace('campfire', tx, ty, player);
 *   if (result.ok) mgr.place('campfire', tx, ty, player);
 *   mgr.remove(building);
 */
export class BuildingManager {
  constructor(world) {
    this.world = world;
    /** @type {Building[]} in placement order */
    this.buildings = [];
    /** Highest entity id ever issued (for compactness on remove). */
    this._highWater = 0;
  }

  /**
   * Validate a placement. Returns {ok: true} or {ok: false, reason: string}.
   *
   * @param {string} typeId
   * @param {number} tx — top-left tile x
   * @param {number} ty — top-left tile y
   * @param {{x:number, y:number}} player — player position in tile coords
   * @param {number} [maxRange=2] — Chebyshev range from player
   * @returns {{ok:boolean, reason?:string}}
   */
  canPlace(typeId, tx, ty, player, maxRange = 2) {
    const def = getBuilding(typeId);
    if (!def) return { ok: false, reason: `unknown building: ${typeId}` };
    const [w, h] = def.size;

    // 1. top-left in bounds
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) {
      return { ok: false, reason: 'out of bounds' };
    }
    // 2. all building tiles in bounds
    if (tx + w > this.world.width || ty + h > this.world.height) {
      return { ok: false, reason: 'footprint out of bounds' };
    }
    // 3. all tiles walkable and unoccupied
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.world.isWalkable(x, y)) {
          return { ok: false, reason: `tile (${x},${y}) not walkable` };
        }
        if (this.world.isOccupied(x, y)) {
          return { ok: false, reason: `tile (${x},${y}) already occupied` };
        }
      }
    }
    // 4. range — building's top-left within `maxRange` of player
    //    (cheaper than iterating footprint; close enough for 1x1 / 2x1 cases)
    const dist = chebyshev(tx, ty, Math.floor(player.x), Math.floor(player.y));
    if (dist > maxRange) {
      return { ok: false, reason: `out of range (dist=${dist}, max=${maxRange})` };
    }
    return { ok: true };
  }

  /**
   * Place a building. Throws if invalid; check `canPlace` first if
   * the input might be invalid.
   *
   * @returns {Building}
   */
  place(typeId, tx, ty, _player) {
    const def = getBuilding(typeId);
    if (!def) throw new Error(`unknown building type: ${typeId}`);
    const [w, h] = def.size;
    const entityId = allocEntityId();
    const b = new Building({
      typeId, tx, ty, w, h,
      hp: def.hp, maxHp: def.hp,
      entityId
    });
    // Mark occupants.
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.world.occupy(tx + dx, ty + dy, entityId);
      }
    }
    this.buildings.push(b);
    if (entityId > this._highWater) this._highWater = entityId;
    return b;
  }

  /**
   * Remove a building; frees its tiles. Building entity becomes
   * "stale" but the entity id is never reused within a session.
   *
   * @param {Building} b
   * @returns {boolean} true if found and removed
   */
  remove(b) {
    const idx = this.buildings.indexOf(b);
    if (idx < 0) return false;
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        this.world.free(b.tx + dx, b.ty + dy);
      }
    }
    this.buildings.splice(idx, 1);
    return true;
  }

  /**
   * Apply damage to a building. Returns the building if destroyed
   * (hp <= 0); null if still alive. Auto-removes destroyed buildings.
   *
   * @param {Building} b
   * @param {number} amount
   * @returns {Building|null}
   */
  damage(b, amount) {
    b.hp -= amount;
    if (b.hp <= 0) {
      this.remove(b);
      return b; // the destroyed instance
    }
    return null;
  }

  /**
   * Number of currently placed buildings.
   */
  count() {
    return this.buildings.length;
  }
}
