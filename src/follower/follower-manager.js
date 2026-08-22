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
 * The death loot is deposited into the player's inventory via the
 * InventoryService (replaces the previous silent-drop behavior).
 *
 * v0.6.0b — InventoryService:
 *   - Constructor takes `invSvc` and threads it into the Follower so
 *     death loot ends up in the inventory instead of being dropped on
 *     the floor (the prior version returned the loot list but no one
 *     ever picked it up).
 */
'use strict';
import { Follower, MAX_FOLLOWERS } from './follower.js';

export class FollowerManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} opts.player
   * @param {Function} [opts.getMonsters]
   * @param {import('../services/InventoryService.js').InventoryService} opts.invSvc
   */
  constructor({ world, player, getMonsters = null, invSvc = null } = {}) {
    this.world = world;
    this.player = player;
    this.getMonsters = getMonsters;
    this.invSvc = invSvc;
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
      getMonsters: this.getMonsters,
      invSvc: this.invSvc
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
   * follower died (and was deposited into the inventory by the
   * Follower itself via the InventoryService).
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
