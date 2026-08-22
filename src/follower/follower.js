/**
 * Follower — a recruited piglin that follows the player.
 *
 * Differs from the resident piglin in three ways:
 *   - follows the player (path-replan every 0.4s)
 *   - fights monsters on the player's behalf (basic chase + melee)
 *   - has 3 hp (mirrors the piglin's home roster) and drops loot on
 *     death; on death, affection resets to 0 and the piglin is
 *     removed from the active follower roster
 *
 * The follower borrows the same `Piglin` class for hp/affection/feed
 * logic and the same `Monster` A* walking style. We compose, not
 * inherit — `Follower` wraps a `Piglin` instance and adds combat.
 */
'use strict';
import { findPath, chebyshev } from '../monster/pathfinding.js';

const BODY_HALF = 0.3;
const FOLLOWER_HP = 3;
const FOLLOW_DIST = 2.0;       // tiles — follow distance from player
const MELEE_RANGE = 1.2;
const ATTACK_COOLDOWN = 0.7;   // seconds
const MOVE_SPEED = 5.0;        // tiles/sec (a bit faster than player for catch-up)

/**
 * @param {Object} opts
 * @param {Object} opts.piglin — a Piglin instance (already at 3 affection)
 * @param {Object} opts.player — { x, y } (will be updated each frame)
 * @param {Object} opts.world  — WorldGrid
 * @param {Object} [opts.getMonsters] — () => Monster[] (or null)
 */
export class Follower {
  constructor({ piglin, player, world, getMonsters = null }) {
    this.piglin = piglin;
    this.player = player;
    this.world = world;
    this.getMonsters = getMonsters;
    this.x = piglin.x;
    this.y = piglin.y;
    this.facing = piglin.facing || 'down';
    this.action = 'idle';
    this.hp = FOLLOWER_HP;
    this.maxHp = FOLLOWER_HP;
    this.alive = true;
    this._path = null;
    this._pathRefresh = 0;
    this._atkCooldown = 0;
    this._currentTarget = null;
    this._deathLoot = null;
  }

  /** Total affection is whatever the underlying piglin tracks. */
  affection() { return this.piglin.affection; }

  /** Is this follower dead? */
  isDead() { return !this.alive; }

  /**
   * Per-frame update. Order:
   *   1. if we have an enemy target, keep chasing it (combat)
   *   2. else, follow the player at FOLLOW_DIST
   *   3. if a monster enters melee range, attack it
   */
  update(dt) {
    if (!this.alive) return;
    this._atkCooldown = Math.max(0, this._atkCooldown - dt);
    // Refresh monster target pick.
    this._currentTarget = this._pickTarget();
    if (this._currentTarget) {
      this._chaseOrAttack(dt, this._currentTarget);
    } else {
      this._followPlayer(dt);
    }
  }

  _pickTarget() {
    if (!this.getMonsters) return null;
    const monsters = this.getMonsters();
    if (!monsters || monsters.length === 0) return null;
    const px = this.player.x, py = this.player.y;
    let best = null, bestDist = 6.0; // only fight within 6 tiles of player
    for (const m of monsters) {
      if (m.state === 'dead' || m.hp <= 0) continue;
      const d = chebyshev(Math.floor(m.x), Math.floor(m.y), Math.floor(px), Math.floor(py));
      if (d <= bestDist) {
        bestDist = d;
        best = m;
      }
    }
    return best;
  }

  _chaseOrAttack(dt, target) {
    const tx = target.x, ty = target.y;
    const d = chebyshev(Math.floor(this.x), Math.floor(this.y), Math.floor(tx), Math.floor(ty));
    if (d <= MELEE_RANGE) {
      // Melee swing.
      this.action = 'attack';
      this._faceToward(tx, ty);
      if (this._atkCooldown <= 0) {
        if (typeof target.damage === 'function') {
          target.damage(1);
        } else if (typeof target.hp === 'number') {
          target.hp = Math.max(0, target.hp - 1);
        }
        this._atkCooldown = ATTACK_COOLDOWN;
      }
      return;
    }
    // Re-plan path periodically.
    this._pathRefresh -= dt;
    if (this._pathRefresh <= 0 || !this._path || this._path.length === 0) {
      this._path = findPath(
        this.world,
        { x: Math.floor(this.x), y: Math.floor(this.y) },
        { x: Math.floor(tx), y: Math.floor(ty) }
      );
      this._pathRefresh = 0.4;
      if (!this._path) {
        // can't reach — drift toward player
        this._stepToward(dt, this.player.x, this.player.y);
        return;
      }
    }
    if (this._path && this._path.length > 0) {
      const next = this._path[0];
      const arrived = this._stepToward(dt, next.x + 0.5, next.y + 0.5);
      if (arrived) this._path.shift();
    }
  }

  _followPlayer(dt) {
    const dx = this.player.x - this.x;
    const dy = this.player.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= FOLLOW_DIST) {
      this.action = 'idle';
      return;
    }
    // Re-plan path if not already current.
    this._pathRefresh -= dt;
    const targetTile = {
      x: Math.floor(this.player.x),
      y: Math.floor(this.player.y)
    };
    const curTile = { x: Math.floor(this.x), y: Math.floor(this.y) };
    if (this._pathRefresh <= 0 || !this._path || this._path.length === 0) {
      this._path = findPath(this.world, curTile, targetTile);
      this._pathRefresh = 0.4;
    }
    if (this._path && this._path.length > 0) {
      const next = this._path[0];
      const arrived = this._stepToward(dt, next.x + 0.5, next.y + 0.5);
      if (arrived) this._path.shift();
    } else {
      // No path: drift toward player directly.
      this._stepToward(dt, this.player.x, this.player.y);
    }
  }

  /**
   * Move one step toward (tx, ty). Returns true if the step fully
   * consumed the distance (caller can pop the path step).
   */
  _stepToward(dt, tx, ty) {
    let dx = tx - this.x, dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) return true;
    const step = MOVE_SPEED * dt;
    const use = Math.min(step, dist);
    dx = (dx / dist) * use;
    dy = (dy / dist) * use;
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
    this.action = 'walk';
    const nx = this.x + dx;
    if (!this.collidesAt(nx, this.y)) this.x = nx;
    const ny = this.y + dy;
    if (!this.collidesAt(this.x, ny)) this.y = ny;
    return use >= dist;
  }

  _faceToward(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
  }

  collidesAt(nx, ny) {
    const left   = Math.floor(nx - BODY_HALF);
    const right  = Math.floor(nx + BODY_HALF);
    const top    = Math.floor(ny - BODY_HALF);
    const bottom = Math.floor(ny + BODY_HALF);
    return !this.world.isWalkable(left, top)
        || !this.world.isWalkable(right, top)
        || !this.world.isWalkable(left, bottom)
        || !this.world.isWalkable(right, bottom);
  }

  /**
   * Apply damage to the follower. If hp drops to 0, dies — affection
   * resets and a small loot drop is queued (caller should spawn the
   * world drop orbs). Returns the loot list, or [].
   */
  damage(by = 1) {
    if (!this.alive) return [];
    this.hp = Math.max(0, this.hp - by);
    if (this.hp <= 0) {
      this.alive = false;
      this._deathLoot = [
        { itemId: 'twine', count: 1 },
        { itemId: 'carrot', count: 1 }
      ];
      // Reset affection on the underlying piglin.
      if (this.piglin) {
        this.piglin.affection = 0;
        this.piglin.hp = this.piglin.maxHp;
      }
    }
    return this._deathLoot || [];
  }

  /** Tile center for depth sort. */
  tilePos() { return { x: Math.floor(this.x), y: Math.floor(this.y) }; }
}

/** Cap of 1 active follower. */
export const MAX_FOLLOWERS = 1;
