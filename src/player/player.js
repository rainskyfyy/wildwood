/**
 * Player controller — handles movement + tile-level collision.
 *
 * Position is in world (sub-tile) units: player at (12.4, 7.7) is inside
 * tile (12, 7). Speed is in tiles per second; collision rounds the
 * candidate position to integer tiles and consults the world's
 * `isWalkable` map.
 *
 * Direction is recorded for sprite facing (down by default).
 *
 * v0.5.2 — combat extension:
 *   - hp / maxHp (default 100/100)
 *   - atk (default 20) — applied by `attack()` to the target monster
 *   - takeDamage(amount) — reduces hp; returns true if alive, false if dead
 *   - attackCooldown (0.4s) — limits attack speed
 *
 * Combat integration:
 *   - `attack(target)` — target is a Monster (has takeDamage + distTo)
 *   - Returns true if the attack landed (in range + cooldown ready)
 *   - Otherwise returns false (no damage applied)
 */
'use strict';
import { Input } from '../utils/input.js';
export const DEFAULT_SPEED = 4.0; // tiles per second
export const DEFAULT_HP    = 100;
export const DEFAULT_ATK   = 20;
export const ATTACK_RANGE  = 1.5;
export const ATTACK_COOLDOWN = 0.4;
export class Player {
  constructor({ world, x = 10, y = 10, speed = DEFAULT_SPEED,
                hp = DEFAULT_HP, atk = DEFAULT_ATK } = {}) {
    this.world = world;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.facing = 'down';

    // v0.5.2 — combat
    this.maxHp = hp;
    this.hp = hp;
    this.atk = atk;
    this._attackTimer = 0;
  }
  /**
   * Step the player by `dt` seconds, given the input singleton.
   * Collision is axis-separated: solve X, then Y, so we slide along walls.
   */
  update(dt, input) {
    if (this._attackTimer > 0) this._attackTimer -= dt;
    const dx = input.axisH();
    const dy = input.axisV();
    if (dx === 0 && dy === 0) return;
    // Normalize diagonal speed.
    const len = Math.hypot(dx, dy) || 1;
    const stepX = (dx / len) * this.speed * dt;
    const stepY = (dy / len) * this.speed * dt;
    // X axis
    let nx = this.x + stepX;
    if (!this.collidesAt(nx, this.y)) {
      this.x = nx;
    }
    // Y axis
    let ny = this.y + stepY;
    if (!this.collidesAt(this.x, ny)) {
      this.y = ny;
    }
    // Facing — prefer the larger axis; default to last facing.
    if (Math.abs(dx) > Math.abs(dy)) {
      this.facing = dx > 0 ? 'right' : 'left';
    } else if (dy !== 0) {
      this.facing = dy > 0 ? 'down' : 'up';
    }
  }
  /**
   * Test if the player's body (1x1 tile footprint) collides at
   * fractional world coords (nx, ny). Rounds to the 4 corner tiles.
   */
  collidesAt(nx, ny) {
    const left   = Math.floor(nx - 0.3);
    const right  = Math.floor(nx + 0.3);
    const top    = Math.floor(ny - 0.3);
    const bottom = Math.floor(ny + 0.3);
    return !this.world.isWalkable(left, top)
        || !this.world.isWalkable(right, top)
        || !this.world.isWalkable(left, bottom)
        || !this.world.isWalkable(right, bottom);
  }
  /**
   * Apply damage to the player. Returns true if alive, false if dead.
   * Once dead, subsequent calls return false (no-op).
   */
  takeDamage(amount) {
    if (this.hp <= 0) return false;
    if (amount <= 0) return true;
    this.hp = Math.max(0, this.hp - amount);
    return this.hp > 0;
  }
  /**
   * Heal up (used after events / sleeping). Clamps to maxHp.
   */
  heal(amount) {
    if (amount <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }
  /**
   * Attack a target monster. The target must expose a `takeDamage(amount)`
   * method (Monster does) and an x/y position.
   *
   * Returns true if the attack hit (in range + cooldown ready), false
   * otherwise. The hit damage is `this.atk` plus any active event
   * multiplier passed in.
   *
   * @param {Object} target — must have x, y, takeDamage
   * @param {number} [bonus=0] — flat bonus to add (e.g. event multiplier)
   * @returns {boolean}
   */
  attack(target, bonus = 0) {
    if (!target || this.hp <= 0) return false;
    if (this._attackTimer > 0) return false;
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist > ATTACK_RANGE) return false;
    const total = Math.max(1, (this.atk | 0) + (bonus | 0));
    target.takeDamage(total);
    this._attackTimer = ATTACK_COOLDOWN;
    return true;
  }
  /**
   * True if the player can attack this frame (cooldown done).
   */
  canAttack() {
    return this.hp > 0 && this._attackTimer <= 0;
  }
}
