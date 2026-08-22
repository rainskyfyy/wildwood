/**
 * Piglin — friendly NPC entity.
 *
 * Sub-tile position + facing + AI states for daily life:
 *   - HOME   : at/near their house, doing nothing
 *   - WANDER : walking around the village during the day
 *   - SLEEP  : at night, return to house and stay there
 *   - DEAD   : after 3 hp loss, drops loot and is removed
 *
 * Affection (好感度):
 *   - 0..3 hearts (3 = full). Gained by feeding food items (one per
 *     food unit fed, up to 3).
 *   - When affection reaches 3, this piglin is eligible to be
 *     recruited as the player's follower.
 *
 * Per-piglin PRNG (mulberry32) keeps movement deterministic.
 */
'use strict';
import { findPath, chebyshev } from '../monster/pathfinding.js';
import itemsRaw from '../resources/items.json' with { type: 'json' };

const ITEMS = (() => {
  const out = {};
  for (const k of Object.keys(itemsRaw)) {
    if (k === '_meta') continue;
    out[k] = itemsRaw[k];
  }
  return out;
})();

function getItemCategory(id) {
  const it = ITEMS[id];
  return it ? it.category : null;
}

const BODY_HALF = 0.3;
const MAX_AFFECTION = 3;
const MAX_HP = 3;

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

export const PiglinState = Object.freeze({
  HOME:   'home',
  WANDER: 'wander',
  SLEEP:  'sleep',
  DEAD:   'dead'
});

/**
 * @param {Object} opts
 * @param {string} opts.typeId — 'piglin'
 * @param {Object} opts.config — entry from piglins.json
 * @param {import('../world/generator.js').WorldGrid} opts.world
 * @param {number} opts.x — house tile x (top-left)
 * @param {number} opts.y — house tile y (top-left)
 * @param {number} opts.seed
 * @param {Object} [opts.houseTiles] — {x, y, w, h} tile footprint
 */
export class Piglin {
  constructor({ typeId, config, world, x, y, seed, houseTiles }) {
    this.typeId = typeId;
    this.config = config;
    this.world = world;
    // house anchor (top-left of house footprint)
    this.houseX = x;
    this.houseY = y;
    this.houseTiles = houseTiles || { x, y, w: config.houseWidth, h: config.houseHeight };
    // start inside the house, jittered
    this.x = x + houseTiles.w / 2;
    this.y = y + houseTiles.h / 2;
    this.rng = mulberry32(seed);
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.affection = 0;          // 0..MAX_AFFECTION
    this.state = PiglinState.SLEEP; // start at home; day cycle will flip
    this.facing = 'down';
    this.action = 'idle';
    this._wanderDest = null;
    this._wanderTimer = 0;
    this._stateTimer = 0;
    // For chat bubble.
    this._bubble = null;            // {text, expiresAt}
    // For dropping loot on death (filled at damage time).
    this._pendingLoot = [];
  }

  /** Tile center of the house. */
  houseCenter() {
    const t = this.houseTiles;
    return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  }

  /**
   * Apply damage. If hp drops to 0, transition to DEAD and queue a
   * small "loot" drop of 1-2 items the player can pick up. Returns
   * the loot array (caller spawns the world drop orbs).
   */
  damage(by = 1, killerRef = null) {
    if (this.state === PiglinState.DEAD) return [];
    this.hp = Math.max(0, this.hp - by);
    if (this.hp <= 0) {
      this.state = PiglinState.DEAD;
      // Drop a small gift on death — keeps the loop generous.
      this._pendingLoot = [
        { itemId: 'twine', count: 1 },
        { itemId: 'berries', count: 1 }
      ];
    }
    return this._pendingLoot;
  }

  /**
   * Reset affection and HP after the player has had their chance to
   * collect the dead piglin's loot. Used to "revive" a defeated
   * piglin so the village repopulates over time.
   */
  revive(seedNewCycle = false) {
    this.hp = this.maxHp;
    this.affection = 0;
    this.state = PiglinState.HOME;
    this._wanderDest = null;
    this._pendingLoot = [];
    if (seedNewCycle) this.rng = mulberry32((this.rng() * 0xffffffff) | 0);
  }

  /** Try to feed a food item. Returns true if accepted. */
  feed(itemId) {
    if (this.state === PiglinState.DEAD) return false;
    if (this.affection >= MAX_AFFECTION) return false;
    const category = getItemCategory(itemId);
    if (category !== 'food') return false;
    this.affection = Math.min(MAX_AFFECTION, this.affection + 1);
    this._sayRandom('feedingThanks');
    return true;
  }

  /** Whether this piglin is willing to be recruited. */
  isRecruitable() {
    return this.state !== PiglinState.DEAD && this.affection >= MAX_AFFECTION;
  }

  _sayRandom(kind) {
    const arr = this.config[kind] || this.config.greetingLines;
    if (!arr || arr.length === 0) return;
    this._bubble = {
      text: arr[(this.rng() * arr.length) | 0],
      expiresAt: performance.now() + 2400
    };
  }

  /** Greet when a player is within range; throttled by `_stateTimer`. */
  maybeGreet(player, rangeTiles = 4) {
    if (this.state === PiglinState.DEAD) return;
    if (this._bubble && performance.now() < this._bubble.expiresAt) return;
    if (this._stateTimer > 0) return;
    const d = chebyshev(Math.floor(this.x), Math.floor(this.y),
                        Math.floor(player.x), Math.floor(player.y));
    if (d > rangeTiles) return;
    this._sayRandom('greetingLines');
    this._stateTimer = 2.5 + this.rng() * 1.5;
  }

  /**
   * Per-frame update.
   * @param {number} dt seconds
   * @param {Object} ctx
   * @param {boolean} ctx.isDay — true for daytime, false for night
   * @param {Object} [ctx.target] — player to chase when in CHASE
   *                               (not used in v0.5.4; reserved)
   */
  update(dt, ctx = {}) {
    if (this.state === PiglinState.DEAD) return;
    this._stateTimer = Math.max(0, this._stateTimer - dt);
    // Day/night flip.
    if (ctx.isDay) {
      if (this.state === PiglinState.SLEEP) {
        this.state = PiglinState.WANDER;
        this._wanderTimer = 0;
        this._wanderDest = null;
      }
    } else {
      if (this.state !== PiglinState.SLEEP) {
        this.state = PiglinState.SLEEP;
        this._wanderDest = null;
        // head home
        const h = this.houseCenter();
        this._wanderDest = { x: Math.floor(h.x), y: Math.floor(h.y) };
      }
    }
    switch (this.state) {
      case PiglinState.WANDER: this._tickWander(dt); break;
      case PiglinState.SLEEP:  this._tickSleep(dt);  break;
      case PiglinState.HOME:   this._tickHome(dt);   break;
    }
    this._move(dt);
  }

  _tickHome(dt) {
    this._wanderTimer -= dt;
    if (this._wanderTimer <= 0) {
      this.state = PiglinState.WANDER;
      this._wanderDest = null;
    }
  }

  _tickWander(dt) {
    this._wanderTimer -= dt;
    if (!this._wanderDest) {
      this._wanderDest = this._pickWanderDest();
      this._wanderTimer = 3 + this.rng() * 3;
    }
    if (this._wanderTimer <= 0) {
      this._enterHome();
    }
  }

  _enterHome() {
    this.state = PiglinState.HOME;
    this._wanderTimer = 4 + this.rng() * 4;
    const h = this.houseCenter();
    this.x = h.x;
    this.y = h.y;
  }

  _tickSleep(dt) {
    // walk back to house, then idle inside.
    const h = this.houseCenter();
    const hx = Math.floor(h.x), hy = Math.floor(h.y);
    if (Math.floor(this.x) !== hx || Math.floor(this.y) !== hy) {
      // re-plan to home if drifted.
      if (!this._wanderDest ||
          this._wanderDest.x !== hx || this._wanderDest.y !== hy) {
        this._wanderDest = { x: hx, y: hy };
      }
    } else {
      this._wanderDest = null;
      this.action = 'idle';
    }
  }

  _pickWanderDest() {
    const ox = Math.floor(this.x), oy = Math.floor(this.y);
    for (let tries = 0; tries < 8; tries++) {
      const dx = Math.floor((this.rng() * 2 - 1) * 4);
      const dy = Math.floor((this.rng() * 2 - 1) * 4);
      const nx = ox + dx, ny = oy + dy;
      if (nx === ox && ny === oy) continue;
      if (this.world.isWalkable(nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }

  _move(dt) {
    if (!this._wanderDest) return;
    const tx = this._wanderDest.x + 0.5, ty = this._wanderDest.y + 0.5;
    let dx = tx - this.x, dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) {
      this._wanderDest = null;
      this.action = 'idle';
      return;
    }
    const step = this.config.walkSpeed * dt;
    dx = (dx / dist) * Math.min(step, dist);
    dy = (dy / dist) * Math.min(step, dist);
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
    this.action = 'walk';
    // axis-separated solve
    const nx = this.x + dx;
    if (!this.collidesAt(nx, this.y)) this.x = nx;
    const ny = this.y + dy;
    if (!this.collidesAt(this.x, ny)) this.y = ny;
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

  /** Effective hp max used by AI. */
  effectiveHp() { return this.hp; }

  /** Whether this piglin is alive. */
  isAlive() { return this.state !== PiglinState.DEAD; }

  /** Public read-only: current chat bubble (or null). */
  bubble() {
    if (!this._bubble) return null;
    if (performance.now() > this._bubble.expiresAt) {
      this._bubble = null;
      return null;
    }
    return this._bubble;
  }

  /** Serialize for save (just enough to restore). */
  serialize() {
    return {
      typeId: this.typeId,
      houseX: this.houseX,
      houseY: this.houseY,
      houseW: this.houseTiles.w,
      houseH: this.houseTiles.h,
      hp: this.hp,
      affection: this.affection,
      seed: (this.rng() * 0xffffffff) | 0
    };
  }
}

export const PIGLIN_CONST = Object.freeze({
  MAX_AFFECTION,
  MAX_HP
});
