/**
 * Player controller — handles movement + tile-level collision.
 *
 * Position is in world (sub-tile) units: player at (12.4, 7.7) is inside
 * tile (12, 7). Speed is in tiles per second; collision rounds the
 * candidate position to integer tiles and consults the world's
 * `isWalkable` map.
 *
 * Direction is recorded for sprite facing (down by default).
 */

'use strict';

import { Input } from '../utils/input.js';

export const DEFAULT_SPEED = 4.0; // tiles per second

export class Player {
  constructor({ world, x = 10, y = 10, speed = DEFAULT_SPEED } = {}) {
    this.world = world;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.facing = 'down';
  }

  /**
   * Step the player by `dt` seconds, given the input singleton.
   * Collision is axis-separated: solve X, then Y, so we slide along walls.
   */
  update(dt, input) {
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
}
