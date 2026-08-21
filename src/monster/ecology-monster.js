/**
 * EcologyMonster — extends M2.14 Monster with FLEE and GRAZE states.
 *
 * Adds three behaviors needed by the predator-prey loop:
 *   - FLEE: predator in detectRange → pick a tile away from the
 *           predator, A*-path there for a few seconds, then re-evaluate.
 *   - GRAZE: grazer (rabbit, cow) without nearby food tile or
 *            predator → wander a shorter radius and pause more often.
 *   - HUNT: same as CHASE in M2.14, but prefers prey species over
 *            the player when both are in range.
 *
 * Inheritance is shallow: we re-use Monster's _move + animator and
 * only override _think + add FLEE/GRAZE tick handlers. The renderer
 * still sees a Monster (extends) and can use the same sprite cache.
 *
 * Prey targeting: each EcologyMonster knows its `diet` (from
 * ecology-monsters.json). When in HUNT state, it looks for the
 * nearest entity whose type is in `diet` before defaulting to the
 * player.
 *
 * The findNearest callback is bound by EcologyManager and includes
 * the calling monster as the search origin: findNearest(species,
 * maxDist, fromEntity).
 */

'use strict';

import { Monster, MonsterState } from './monster.js';
import { findPath, chebyshev } from './pathfinding.js';

// New state names — kept as strings to match M2.14.
export const EcologyState = Object.freeze({
  ...MonsterState,
  FLEE:  'flee',
  GRAZE: 'graze',
  HUNT:  'hunt'
});

export class EcologyMonster extends Monster {
  /**
   * @param {Object} opts — same as Monster, plus:
   * @param {string[]} [opts.diet=[]]        species this monster eats
   * @param {string[]} [opts.threats=[]]     species this monster flees from
   * @param {string}   [opts.trophic='grazer']
   * @param {Function} [opts.findNearest]    (species, maxDist, fromEntity) => entity|null
   * @param {Function} [opts.findFleeTarget] (threatEntity) => {x,y}|null
   */
  constructor(opts) {
    super(opts);
    this.diet = opts.diet || [];
    this.threats = opts.threats || [];
    this.trophic = opts.trophic || 'grazer';
    this.findNearest = opts.findNearest || (() => null);
    this.findFleeTarget = opts.findFleeTarget || (() => null);
    // FLEE state
    this._fleePath = null;
    this._fleeTimer = 0;
    // GRAZE state
    this._grazeTimer = 0;
    // HUNT state (just an alias for CHASE with a prey target)
    this._huntTarget = null;
  }

  /**
   * Override think() to insert FLEE / GRAZE logic before the
   * base IDLE / WANDER / CHASE flow.
   */
  _think(dt, player) {
    // 1. Threat check (FLEE has highest priority).
    const threat = this._findNearestThreat();
    if (threat) {
      if (this.state !== EcologyState.FLEE) this._enterFlee(threat);
    } else if (this.state === EcologyState.FLEE) {
      this._enterIdle();
    }

    // 2. Prey check (predators only). Skip if currently fleeing.
    if (this.trophic === 'predator' && this.state !== EcologyState.FLEE) {
      const prey = this._findNearestPrey();
      const distToPlayer = player
        ? chebyshev(
            Math.floor(this.x), Math.floor(this.y),
            Math.floor(player.x), Math.floor(player.y)
          )
        : Infinity;
      const distToPrey = prey
        ? chebyshev(
            Math.floor(this.x), Math.floor(this.y),
            Math.floor(prey.x), Math.floor(prey.y)
          )
        : Infinity;
      const bestDist = Math.min(distToPlayer, distToPrey);
      if (bestDist <= this.detectRange) {
        if (this.state !== EcologyState.HUNT) this._enterHunt();
        // Pick whichever is closer.
        this._huntTarget = (prey && distToPrey < distToPlayer) ? prey : player;
      } else if (this.state === EcologyState.HUNT) {
        this._enterIdle();
      }
    }

    // 3. Default tick by state.
    switch (this.state) {
      case EcologyState.FLEE:  this._tickFlee(dt);  break;
      case EcologyState.GRAZE: this._tickGraze(dt); break;
      case EcologyState.HUNT:  this._tickHunt(dt, player);  break;
      default:
        // IDLE / WANDER / CHASE from M2.14 base class.
        super._think(dt, player);
    }
  }

  // ── FLEE ───────────────────────────────────────────────────────

  _enterFlee(threat) {
    this.state = EcologyState.FLEE;
    this._fleePath = null;
    this._fleeTimer = 2.5 + this.rng() * 1.5;
  }

  _tickFlee(dt) {
    this._fleeTimer -= dt;
    // Repath every 0.6s, or when we consumed the path.
    if (!this._fleePath || this._fleePath.length === 0) {
      const threat = this._findNearestThreat();
      if (!threat || this._fleeTimer <= 0) {
        this._enterIdle();
        return;
      }
      const target = this.findFleeTarget(threat);
      if (!target) {
        this._enterIdle();
        return;
      }
      this._fleePath = findPath(
        this.world,
        { x: Math.floor(this.x), y: Math.floor(this.y) },
        target
      );
      if (!this._fleePath) {
        this._enterIdle();
      }
    }
  }

  _findNearestThreat() {
    let best = null;
    let bestDist = Infinity;
    for (const t of this.threats) {
      const e = this.findNearest(t, this.detectRange, this);
      if (!e) continue;
      const d = chebyshev(
        Math.floor(this.x), Math.floor(this.y),
        Math.floor(e.x), Math.floor(e.y)
      );
      if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  // ── GRAZE ──────────────────────────────────────────────────────

  _enterGraze() {
    this.state = EcologyState.GRAZE;
    this._grazeTimer = 1.0 + this.rng() * 2.0;
  }

  _tickGraze(dt) {
    this._grazeTimer -= dt;
    if (this._grazeTimer <= 0) {
      // 60% of the time, take another graze step; 40%, idle.
      if (this.rng() < 0.6) {
        this._enterGraze();
      } else {
        this._enterIdle();
      }
    }
  }

  // ── HUNT ───────────────────────────────────────────────────────

  _enterHunt() {
    this.state = EcologyState.HUNT;
    this._huntTarget = null;
    this._chaseRefresh = 0;
  }

  _tickHunt(dt, player) {
    const target = this._huntTarget || player;
    if (!target) { this._enterIdle(); return; }
    this._chaseRefresh -= dt;
    if (this._chaseRefresh <= 0 || !this._chasePath || this._chasePath.length === 0) {
      this._chasePath = findPath(
        this.world,
        { x: Math.floor(this.x), y: Math.floor(this.y) },
        { x: Math.floor(target.x), y: Math.floor(target.y) }
      );
      this._chaseRefresh = 0.4;
      if (!this._chasePath) this._enterWander();
    }
  }

  // ── PREY lookup ────────────────────────────────────────────────

  _findNearestPrey() {
    let best = null;
    let bestDist = Infinity;
    for (const species of this.diet) {
      const e = this.findNearest(species, this.detectRange * 1.5, this);
      if (!e) continue;
      const d = chebyshev(
        Math.floor(this.x), Math.floor(this.y),
        Math.floor(e.x), Math.floor(e.y)
      );
      if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  /**
   * Override _currentTarget so FLEE uses the flee path.
   */
  _currentTarget() {
    if (this.state === EcologyState.FLEE) {
      if (this._fleePath && this._fleePath.length > 0) return this._fleePath[0];
      return null;
    }
    if (this.state === EcologyState.GRAZE) return null; // stand still
    return super._currentTarget();
  }
}
