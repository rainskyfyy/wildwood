/**
 * Monster entity — sub-tile position, AI state machine, animation
 * driver, and per-frame movement.
 *
 * Position is in fractional world units (e.g. 12.4, 7.7); the monster
 * treats the same 1×1 tile footprint as the player, with a 4-corner
 * collision check for slide-along-walls behavior.
 *
 * AI state machine (M2.14 baseline; M2.15+ will add ATTACK and DEAD):
 *   IDLE   — standing still, occasional look-around
 *   WANDER — short random walk, then re-enter IDLE
 *   CHASE  — A* pathfinding to the player, refreshed every few frames
 *
 * Animation strategy:
 *   Each monster is configured with a `stateTable` of (action, facing)
 *   → FrameSource. Idle vs walk are the two states we use in M2.14;
 *   attack/death are wired but not exercised yet (the M2.14a assets
 *   include them so future milestones need no model changes).
 *
 * Determinism: RNG is seeded per-monster at spawn; the first frame is
 * fully determined by the world's seed + the monster's spawn index.
 */

'use strict';

import { Animator, buildStateTableAnimator } from '../animation/animator.js';
import { findPath, chebyshev } from './pathfinding.js';

// Mulberry32 PRNG — same as M4 world gen so spawns are reproducible.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// State enum — kept as strings for debuggability.
export const MonsterState = Object.freeze({
  IDLE:   'idle',
  WANDER: 'wander',
  CHASE:  'chase'
});

/** Default per-tile corner offsets; monsters have a 0.6-tile body. */
const BODY_HALF = 0.3;

export class Monster {
  /**
   * @param {Object} opts
   * @param {string} opts.typeId           — key into the monsters.json table
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} opts.config            — entry from monsters.json
   * @param {number} opts.x — initial tile x (fractional allowed)
   * @param {number} opts.y — initial tile y
   * @param {number} [opts.seed]            — per-monster PRNG seed
   * @param {Object} [opts.stateTable]      — {action:{facing:FrameSource}}
   */
  constructor({ typeId, world, config, x, y, seed = 1, stateTable = null }) {
    this.typeId = typeId;
    this.world = world;
    this.config = config;
    this.x = x;
    this.y = y;
    this.rng = mulberry32(seed);

    this.hp = config.hp;
    this.maxHp = config.hp;
    this.atk = config.atk;
    this.speed = config.speed;
    this.detectRange = config.detectRange;
    this.attackRange = config.attackRange;
    this.wanderRadius = config.wanderRadius;
    this.size = config.size || 0.7;
    this.color = config.color || '#7a3a4a';

    this.state = MonsterState.IDLE;
    this.facing = 'down';
    this.action = 'idle';

    // Idle pause timer (seconds left in current idle).
    this._idleTimer = 0.5 + this.rng() * 0.8;
    // Wander destination (tile coords) and re-plan timer.
    this._wanderDest = null;
    this._wanderTimer = 0;
    // Chase path (tile steps from current to player) and refresh tick.
    this._chasePath = null;
    this._chaseRefresh = 0;

    this.animator = stateTable
      ? buildStateTableAnimator(stateTable, {
        fps: config.fps ?? 8,
        defaultAction: 'idle',
        defaultFacing: 'down'
      })
      : new Animator({ frameCount: 1, fps: config.fps ?? 8 });

    // Bind for the AI tick callback.
    this._think = this._think.bind(this);
  }

  /**
   * Per-frame update. `dt` seconds; `player` is the player entity
   * (must expose `.x` and `.y`).
   *
   * Order: think → animate → move (resolved through collision).
   */
  update(dt, player) {
    this._think(dt, player);
    this.animator.tick(dt);
    this._move(dt);
  }

  /**
   * 4-state AI tick. Decides whether to switch state and re-plans
   * movement destinations accordingly.
   */
  _think(dt, player) {
    if (!player) return;
    const dist = chebyshev(
      Math.floor(this.x), Math.floor(this.y),
      Math.floor(player.x), Math.floor(player.y)
    );

    // Player in detect range → chase.
    if (dist <= this.detectRange) {
      if (this.state !== MonsterState.CHASE) {
        this._enterChase();
      }
    } else if (this.state === MonsterState.CHASE) {
      // Lost the player → wander toward last known area.
      this._enterWander();
    }

    switch (this.state) {
      case MonsterState.IDLE:   this._tickIdle(dt, player);   break;
      case MonsterState.WANDER: this._tickWander(dt, player); break;
      case MonsterState.CHASE:  this._tickChase(dt, player);  break;
    }
  }

  _enterChase() {
    this.state = MonsterState.CHASE;
    this._chasePath = null;
    this._chaseRefresh = 0;
  }

  _enterWander() {
    this.state = MonsterState.WANDER;
    this._wanderDest = null;
    this._wanderTimer = 1.5 + this.rng() * 2.0;
  }

  _enterIdle() {
    this.state = MonsterState.IDLE;
    this._idleTimer = 0.5 + this.rng() * 1.2;
    this.action = 'idle';
    this.animator.setState({ action: 'idle' });
  }

  _tickIdle(dt, player) {
    this._idleTimer -= dt;
    if (this._idleTimer <= 0) {
      this._enterWander();
    }
  }

  _tickWander(dt, player) {
    this._wanderTimer -= dt;
    if (!this._wanderDest) {
      this._wanderDest = this._pickWanderDest();
    }
    if (!this._wanderDest || this._wanderTimer <= 0) {
      this._enterIdle();
      return;
    }
    // If we reach the wander dest, idle.
    const tx = this._wanderDest.x, ty = this._wanderDest.y;
    if (Math.floor(this.x) === tx && Math.floor(this.y) === ty) {
      this._wanderDest = null;
      this._enterIdle();
    }
  }

  _pickWanderDest() {
    const ox = Math.floor(this.x), oy = Math.floor(this.y);
    const r = Math.max(1, this.wanderRadius);
    for (let tries = 0; tries < 6; tries++) {
      const dx = Math.floor((this.rng() * 2 - 1) * r);
      const dy = Math.floor((this.rng() * 2 - 1) * r);
      const nx = ox + dx, ny = oy + dy;
      if (nx === ox && ny === oy) continue;
      if (this.world.isWalkable(nx, ny)) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  _tickChase(dt, player) {
    this._chaseRefresh -= dt;
    if (this._chaseRefresh <= 0 || !this._chasePath || this._chasePath.length === 0) {
      // Re-plan every 0.4s, or when the previous path is consumed.
      this._chasePath = findPath(
        this.world,
        { x: Math.floor(this.x), y: Math.floor(this.y) },
        { x: Math.floor(player.x), y: Math.floor(player.y) }
      );
      this._chaseRefresh = 0.4;
      if (!this._chasePath) {
        // No path — fall back to wander so we don't lock up.
        this._enterWander();
      }
    }
  }

  /**
   * Move one frame toward the current target, with axis-separated
   * collision. Mirrors Player.collidesAt so monsters slide along
   * walls and respect building occupants.
   */
  _move(dt) {
    const target = this._currentTarget();
    if (!target) return;
    const tx = target.x + 0.5, ty = target.y + 0.5;
    let dx = tx - this.x, dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) return;
    const step = this.speed * dt;
    if (step >= dist) {
      // Will arrive this frame — full step, then snap.
      dx = dx / dist * step;
      dy = dy / dist * step;
    } else {
      dx = dx / dist * step;
      dy = dy / dist * step;
    }
    // Update facing — prefer the larger axis.
    if (Math.abs(dx) > Math.abs(dy)) {
      this.facing = dx > 0 ? 'right' : 'left';
    } else if (dy !== 0) {
      this.facing = dy > 0 ? 'down' : 'up';
    }
    this.action = (Math.abs(dx) + Math.abs(dy) > 0.001) ? 'walk' : 'idle';
    this.animator.setState({ action: this.action, facing: this.facing });
    // Axis-separated solve.
    const nx = this.x + dx;
    if (!this.collidesAt(nx, this.y)) this.x = nx;
    const ny = this.y + dy;
    if (!this.collidesAt(this.x, ny)) this.y = ny;
  }

  _currentTarget() {
    if (this.state === MonsterState.WANDER) return this._wanderDest;
    if (this.state === MonsterState.CHASE && this._chasePath && this._chasePath.length > 0) {
      return this._chasePath[0];
    }
    return null;
  }

  /**
   * 4-corner tile collision check (mirrors Player.collidesAt).
   * Rejects out-of-world, unwalkable biome, and building-occupied
   * tiles. Monsters vs monsters is handled at the manager layer
   * (so two monsters don't perfectly stack on the same tile).
   */
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
   * Get the current sprite for rendering. Returns null if no state
   * table is configured (caller should fall back to a procedural
   * draw using `this.color` and `this.size`).
   */
  getSprite() {
    if (!this.animator.stateResolver) return null;
    return this.animator.getImage();
  }

  /**
   * Tile center for depth sorting. Uses integer floor for stability.
   */
  tilePos() {
    return { x: Math.floor(this.x), y: Math.floor(this.y) };
  }
}
