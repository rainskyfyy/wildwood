/**
 * FollowerManager — owns the active follower roster (max 1).
 *
 * Wraps a `Follower` instance and provides:
 *   - `recruit(piglin)` — promote a piglin to follower (if < cap)
 *   - `dismiss()` — send the current follower back to the village
 *   - `update(dt)` — tick the follower
 *   - `damage(by)` — apply damage; returns the loot if it dies
 *
 * On death, the underlying piglin is "un-recruited" (affection → 0,
 * hp reset) so the player can re-feed and recruit it again later.
 */
'use strict';
import { Follower, MAX_FOLLOWERS } from './follower.js';

export class FollowerManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} opts.player
   * @param {Function} [opts.getMonsters]
   */
  constructor({ world, player, getMonsters = null } = {}) {
    this.world = world;
    this.player = player;
    this.getMonsters = getMonsters;
    /** @type {Follower|null} */
    this.follower = null;
  }

  /** Currently-following piglin, or null. */
  current() { return this.follower; }

  /** Try to recruit a piglin. Returns the Follower on success, or null. */
  recruit(piglin) {
    if (this.follower) return null;
    if (!piglin || !piglin.isRecruitable || !piglin.isRecruitable()) return null;
    this.follower = new Follower({
      piglin,
      player: this.player,
      world: this.world,
      getMonsters: this.getMonsters
    });
    // Park the piglin's "home" near the player so it doesn't try
    // to walk back to the village every tick.
    piglin.state = 'home';
    return this.follower;
  }

  /** Send the current follower back to the village roster. */
  dismiss() {
    if (!this.follower) return null;
    const f = this.follower;
    this.follower = null;
    return f;
  }

  /**
   * Per-frame tick. Also propagates damage to the follower if the
   * player got hit by something (caller can call `damageFollower`
   * explicitly to AOE-damage it).
   */
  update(dt) {
    if (!this.follower) return;
    this.follower.update(dt);
    if (!this.follower.alive) {
      // Defer loot pickup to caller; we just clear our slot.
      this.follower = null;
    }
  }

  /**
   * Apply damage to the follower. Returns the loot list if the
   * follower died (caller spawns world drop orbs). Empty list otherwise.
   */
  damageFollower(by = 1) {
    if (!this.follower) return [];
    const loot = this.follower.damage(by);
    if (!this.follower.alive) {
      this.follower = null;
    }
    return loot;
  }

  /** Whether there is room for another follower (always false in v0.5.4). */
  canRecruit() { return this.follower == null; }

  /** Active count (0 or 1). */
  size() { return this.follower ? 1 : 0; }

  max() { return MAX_FOLLOWERS; }
}

export { Follower, MAX_FOLLOWERS };
