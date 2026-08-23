/**
 * ResourceEntity — one harvestable node on the world map.
 *
 * v1.1.0 — three-stage growth system (M2.10e) + depletion (M2.10d):
 *   - growthStages in def: array of { def, duration }; duration -1 = terminal
 *   - currentStageIndex, _rootId, stageStartedAt tracked on entity
 *   - update(now) advances to next stage when duration elapsed (loops to
 *     fast-forward through multiple stages in one call)
 *   - harvest(inv, now) uses current stage's def.drops, returns
 *       { granted, currentStage, growthReset, transformedTo, regrowAt,
 *         harvestCount, maxHarvests, depleted }
 *   - harvestCount + maxHarvests for depletable resources
 *   - depletedTransformsTo: post-maxHarvests target
 *
 * v1.0.1 — regrow support:
 *   - regrowTime in def: 0 = no regrow, >0 = regrow after N seconds
 *   - getVisualState()   'full' | 'depleted' | 'regrowing'
 *   - regrowFraction()   0..1 progress toward regrow
 */
'use strict';

import {
  getResource,
  isGrowthCapable,
  getStageCount,
  getStageDef,
  isDepletable,
  getMaxHarvests,
  getDepletedTransformsTo
} from './catalog.js';

export class ResourceEntity {
  constructor({ id, x, y, size, rngSeed, now = Date.now() } = {}) {
    const def = getResource(id);
    // For growth-capable resources, initialize at stage 0 (sprout/etc).
    // The user-facing `id` reflects the current visual stage.
    const initialStageIdx = 0;
    const initialDef = isGrowthCapable(def.id) ? getStageDef(def.id, initialStageIdx) : def;
    this._rootId       = def.id;            // never changes; the resource kind
    this.id            = initialDef.id;     // current stage's def id (mutable)
    this.x             = x;
    this.y             = y;
    this.size          = size ?? initialDef.size;
    this.color         = initialDef.color;
    this.icon          = initialDef.icon;
    this.def           = initialDef;         // current stage def (mutable)
    this.hp            = initialDef.hp;
    this.harvestTime   = initialDef.harvestTime;
    this.blockMovement = !!initialDef.blockMovement;
    this.drops         = initialDef.drops;
    this.regrowTime    = initialDef.regrowTime || 0;  // seconds; 0 = permanent depletion

    // Growth stage tracking
    this.isGrowthCapable     = isGrowthCapable(def.id);
    this.stageCount          = getStageCount(def.id);
    this.currentStageIndex   = initialStageIdx;
    this.stageStartedAt      = now;

    // Depletion tracking
    this.isDepletable   = isDepletable(def.id);
    this.harvestCount   = 0;
    this.maxHarvests    = getMaxHarvests(def.id);

    // Regrow state
    this.depleted  = false;
    this.regrowAt  = 0;

    this._rng      = mulberry32(rngSeed ?? hashSeed(x, y, this._rootId));
  }

  /**
   * Stage 0 of a growth-capable resource is trivially not terminal;
   * for single-stage resources, only stage 0 exists so it's terminal.
   * Terminal stage means the entity never auto-advances via update().
   */
  get isTerminalStage() {
    if (!this.isGrowthCapable) return true;
    return this.currentStageIndex >= this.stageCount - 1;
  }

  /**
   * @param inventory Inventory to add drops to (must have .add or .addItem)
   * @param now       current time in ms
   * @returns { granted, currentStage, growthReset, transformedTo, regrowAt,
   *            harvestCount, maxHarvests, depleted }
   */
  harvest(inventory, now = Date.now()) {
    const _add = (inventory.addItem || inventory.add).bind(inventory);
    if (this.depleted) {
      return {
        granted: [],
        currentStage: this.currentStageIndex,
        growthReset: false,
        transformedTo: null,
        regrowAt: 0,
        harvestCount: this.harvestCount,
        maxHarvests: this.maxHarvests,
        depleted: this.depleted
      };
    }
    const currentStage = this.currentStageIndex;
    const granted = [];
    for (const drop of this.drops) {
      if (this._rng() < drop.chance) {
        const r = _add(drop.itemId, drop.count);
        granted.push({ itemId: drop.itemId, count: r.added, leftover: r.leftover });
      }
    }
    this.harvestCount++;
    const maxH = getMaxHarvests(this._rootId);

    // For growth-capable resources, every harvest resets growth to stage 0,
    // but the regrow window uses the *harvested* stage's regrowTime.
    const growthReset = this.isGrowthCapable;
    const harvestedRegrowTime = this.regrowTime;
    if (this.isGrowthCapable) {
      this._resetToStage0(now);
    }

    // Depletion: if maxHarvests reached, decide between transform (immediate)
    // and permanent depletion (regrowAt=0).
    if (this.isDepletable && this.harvestCount >= maxH) {
      const target = getDepletedTransformsTo(this._rootId);
      if (target) {
        // Transform to target resource; entity's harvestCount resets to 0
        // because the new resource starts fresh.
        this._transformTo(target, now);
        return {
          granted,
          currentStage,
          growthReset,
          transformedTo: target,
          regrowAt: this.regrowAt,
          harvestCount: this.harvestCount,   // 0 after transform
          maxHarvests: this.maxHarvests,     // target's max (Infinity for rock)
          depleted: this.depleted           // true if target has regrowTime
        };
      } else {
        // Permanent depletion.
        this.depleted = true;
        this.regrowAt = 0;
        return {
          granted,
          currentStage,
          growthReset,
          transformedTo: null,
          regrowAt: 0,
          harvestCount: this.harvestCount,   // = maxH
          maxHarvests: this.maxHarvests,
          depleted: true
        };
      }
    }

    // Standard regrow: depleted during regrow window, then respawns.
    // regrowTime=0 means different things in different contexts:
    //   - growth-capable entity that was reset to stage 0 (e.g. tree
    //     harvested at stage 2): NOT depleted — stage 0 has no regrow
    //     delay because update() will grow it. The regrow cycle is
    //     driven by the stage progression, not the regrow window.
    //   - non-growth-capable (or growth-capable entity that wasn't
    //     reset) with regrowTime=0: PERMANENTLY depleted — the resource
    //     is gone for good until something else restores it.
    // Depleted window: depends on the HARVESTED stage's regrowTime:
    //   harvestedRegrowTime > 0: entity is depleted for that long
    //     (regrowth via timer; for non-growth-capable, this is the
    //     standard regrow; for growth-capable, the entity is "dead" at
    //     stage 0 until the timer fires and re-spawns at stage 0).
    //   harvestedRegrowTime == 0 + growth-capable: NOT depleted — the
    //     entity is at stage 0 and will regrow through stage progression.
    //   harvestedRegrowTime == 0 + non-growth-capable: PERMANENTLY
    //     depleted — the resource is gone for good.
    if (harvestedRegrowTime > 0) {
      this.depleted = true;
      this.regrowAt = now + harvestedRegrowTime * 1000;
    } else if (this.isGrowthCapable) {
      this.depleted = false;
      this.regrowAt = 0;
    } else {
      this.depleted = true;
      this.regrowAt = 0;
    }
    return {
      granted,
      currentStage,
      growthReset,
      transformedTo: null,
      regrowAt: this.regrowAt,
      harvestCount: this.harvestCount,
      maxHarvests: this.maxHarvests,
      depleted: this.depleted
    };
  }

  _resetToStage0(now) {
    this.currentStageIndex = 0;
    this.stageStartedAt = now;
    const def0 = getStageDef(this._rootId, 0);
    this.id = def0.id;
    this.def = def0;
    this.drops = def0.drops;
    this.color = def0.color;
    this.icon = def0.icon;
    this.size = def0.size ?? this.size;
    // regrowTime stays as the parent def's value (set in constructor);
    // resetting to stage 0 changes visuals/drops but NOT the regrow window.
    this.harvestTime = def0.harvestTime;
    this.hp = def0.hp;
    this.depleted = false;
    this.regrowAt = 0;
    this.harvestCount = 0;
  }

  /**
   * Tick regrow timer AND stage progression. Returns true if any state
   * transition just happened (respawn / stage advance / depletion transform).
   * Stage progression uses a while-loop so a single update() can fast-forward
   * through multiple stages when `now` jumps far ahead.
   */
  update(now) {
    let changed = false;

    // Regrow check (depleted → respawn OR depletion transform).
    if (this.depleted) {
      if (this.regrowAt === 0) return false;  // permanent depletion
      if (now < this.regrowAt) return false;
      // Time to regrow / transform.
      if (this.isDepletable && this.harvestCount >= getMaxHarvests(this._rootId)) {
        const target = getDepletedTransformsTo(this._rootId);
        if (target) {
          this._transformTo(target, now);
          changed = true;
        } else {
          // Stay depleted (no transform target) — clear depleted flag.
          this.depleted = false;
          this.regrowAt = 0;
          this.harvestCount = 0;
          changed = true;
        }
      } else {
        // Plain regrow: clear depleted, keep stage.
        this.depleted = false;
        this.regrowAt = 0;
        // Re-seed RNG so regrown entity has deterministic drops next time.
        this._rng = mulberry32(hashSeed(this.x, this.y, this._rootId, now | 0));
        changed = true;
      }
    }

    // Stage progression (only for growth-capable, non-terminal).
    // Fast-forwards through multiple stages in a single update() call:
    // subtracts each completed stage's duration from a running "elapsed"
    // counter, then snaps the entity directly to the final stage with
    // stageStartedAt = now - remaining_elapsed.
    if (this.isGrowthCapable && !this.isTerminalStage && !this.depleted) {
      const stages = this._getStagesSafe();
      if (stages) {
        let elapsedMs = now - this.stageStartedAt;
        let stageIdx = this.currentStageIndex;
        while (stages[stageIdx]
               && stages[stageIdx].duration > 0
               && elapsedMs >= stages[stageIdx].duration * 1000
               && stageIdx < this.stageCount - 1) {
          elapsedMs -= stages[stageIdx].duration * 1000;
          stageIdx++;
        }
        if (stageIdx !== this.currentStageIndex) {
          // Snap to the final stage in this fast-forward.
          const defFinal = getStageDef(this._rootId, stageIdx);
          this.currentStageIndex = stageIdx;
          this.stageStartedAt = now - elapsedMs;
          this.id = defFinal.id;
          this.def = defFinal;
          this.drops = defFinal.drops;
          this.color = defFinal.color;
          this.icon = defFinal.icon;
          this.size = defFinal.size ?? this.size;
          // regrowTime is the CURRENT stage's regrowTime (changes with
          // stage progression). When the entity is at the mature stage
          // (e.g. tree at stage 1, regrowTime=60), harvesting it will
          // enter a 60s depleted window. At sprout/old stages, regrowTime
          // is 0 and the cycle is via stage progression.
          this.regrowTime = defFinal.regrowTime || 0;
          this.harvestTime = defFinal.harvestTime;
          this.hp = defFinal.hp;
          this.depleted = false;
          this.regrowAt = 0;
          this.harvestCount = 0;
          changed = true;
        }
      }
    }

    return changed;
  }

  _getStagesSafe() {
    // Avoid import cycle: get growth stages via catalog's getGrowthStages.
    // We re-derive to keep the entity self-contained.
    const r = getResource(this._rootId);
    return r && r.growthStages;
  }

  _advanceStage(now) {
    const next = this.currentStageIndex + 1;
    const defNext = getStageDef(this._rootId, next);
    this.currentStageIndex = next;
    this.stageStartedAt = now;
    this.id = defNext.id;
    this.def = defNext;
    this.drops = defNext.drops;
    this.color = defNext.color;
    this.icon = defNext.icon;
    this.size = defNext.size ?? this.size;
    this.regrowTime = defNext.regrowTime || 0;
    this.harvestTime = defNext.harvestTime;
    this.hp = defNext.hp;
    this.depleted = false;
    this.regrowAt = 0;
    this.harvestCount = 0;
  }

  _transformTo(newRootId, now) {
    const def = getResource(newRootId);
    if (!def) return;
    this._rootId = newRootId;
    this.id = def.id;
    this.def = def;
    this.drops = def.drops;
    this.color = def.color;
    this.icon = def.icon;
    this.size = def.size ?? this.size;
    this.regrowTime = def.regrowTime || 0;
    this.harvestTime = def.harvestTime;
    this.hp = def.hp;
    this.isGrowthCapable = isGrowthCapable(newRootId);
    this.stageCount = getStageCount(newRootId);
    this.currentStageIndex = 0;
    this.stageStartedAt = now;
    this.isDepletable = isDepletable(newRootId);
    this.harvestCount = 0;
    this.maxHarvests = getMaxHarvests(newRootId);
    // If the new resource has a regrowTime, the entity starts in
    // "regrowing" state (depleted) so the visual semantic matches and
    // the test expectations (gold_ore → rock, gem_vein → rock) hold.
    if (this.regrowTime > 0) {
      this.depleted = true;
      this.regrowAt = now + this.regrowTime * 1000;
    } else {
      this.depleted = false;
      this.regrowAt = 0;
    }
    this._rng = mulberry32(hashSeed(this.x, this.y, this._rootId, now | 0));
  }

  regrowFraction(now) {
    if (!this.depleted || this.regrowAt === 0) return 1;
    const total = this.regrowTime * 1000;
    const elapsed = total - (this.regrowAt - now);
    if (elapsed <= 0) return 0;
    return Math.max(0, Math.min(1, elapsed / total));
  }

  getVisualState() {
    if (!this.depleted) return 'full';
    if (this.regrowAt === 0) return 'depleted';
    return 'regrowing';
  }

  distTo(x, y) {
    const dx = this.x - x;
    const dy = this.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(x, y, id, salt = 0) {
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1) ^ (hashStr(id) * 0x9e3779b1) ^ (salt * 0x85ebca6b);
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
