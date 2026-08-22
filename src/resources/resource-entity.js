/**
 * ResourceEntity — one harvestable node on the world map.
 *
 * v1.0.1 — regrow support:
 *   - regrowTime in def: 0 = no regrow, >0 = regrow after N seconds
 *   - harvest() sets regrowAt = now + regrowTime*1000
 *   - update(now)        returns true if this entity just respawned
 *   - getVisualState()   'full' | 'depleted' | 'regrowing'
 *   - regrowFraction()   0..1 progress toward regrow
 *
 * v1.0.3 — depletion + transform:
 *   - Depletable resources have maxHarvests; harvestCount increments each
 *     successful harvest. Once harvestCount >= maxHarvests, the entity
 *     transitions to a permanent depleted state and never regrows.
 *   - If the resource def has depletedTransformsTo (e.g. gold_ore → rock),
 *     the entity mutates in place: id / def / icon / color / drops / size
 *     are reloaded from the target resource def, and the entity behaves
 *     as the new resource thereafter (with its own regrow and harvest
 *     semantics). This keeps the same world position useful for the
 *     player (a gold vein turns into a regular rock after exhaustion).
 *   - harvest() now also returns {harvestCount, maxHarvests, depleted}
 *     so callers (HUD, banner) can show progress and depletion events.
 *   - Non-depletable resources (no maxHarvests, or Infinity) keep the
 *     v1.0.1 regrow-only behavior unchanged.
 *
 * v1.0.4 — three-stage growth:
 *   - A growth-capable resource (with `growthStages` array) automatically
 *     advances through up to 3 stages based on time alone. The spawner
 *     creates an entity by its "root" resource id (e.g. `tree`), but
 *     the entity's runtime `id` field is the *current* stage's def id
 *     (e.g. `tree_sprout` at stage 0, `tree` at stage 1, `tree_old` at
 *     stage 2). All def-derived fields (def, color, icon, drops, size,
 *     hp, harvestTime, blockMovement) track the current stage.
 *   - The "root" id (the spawn-time id, e.g. `tree`) is stored in
 *     `_rootId` and is what regrow returns to. This way, harvesting a
 *     stage-2 `tree_old` resets the entity back to stage-0 `tree_sprout`
 *     with the same root `tree`, completing a full growth cycle.
 *   - update(now) auto-advances to the next stage when the current
 *     stage's duration has elapsed. Terminal stages (duration = -1)
 *     stay where they are until harvested.
 *   - For non-growth-capable resources, behavior is unchanged.
 */
'use strict';

import {
  getResource,
  getMaxHarvests,
  getDepletedTransformsTo,
  isGrowthCapable,
  getStageDef,
  getGrowthStages
} from './catalog.js';

export class ResourceEntity {
  /**
   * @param id       root resource id (e.g. 'tree', 'rock'). For growth-capable
   *                 resources the entity will start at stage 0.
   * @param x, y     world position (tile coords)
   * @param size     optional override for visual size
   * @param rngSeed  seed for deterministic drops
   * @param now      optional current time for stageStartedAt init
   */
  constructor({ id, x, y, size, rngSeed, now = Date.now() } = {}) {
    this._rootId = id;                       // the "logical" resource id (e.g. 'tree')
    this._init(x, y, size, rngSeed, now);
  }

  /**
   * Internal: initialize or reset to stage 0. Used by constructor and after
   * a harvest that completes a growth cycle.
   */
  _init(x, y, sizeOverride, rngSeed, now) {
    // Determine initial stage (0 for growth-capable, 0 for single-stage).
    this.currentStageIndex = 0;
    this._loadStageDef(0, sizeOverride);
    this.x = x;
    this.y = y;
    this.depleted = false;
    this.regrowAt = 0;
    this.harvestCount = 0;
    this.stageStartedAt = now;               // when stage 0 began
    this._rng = mulberry32(rngSeed ?? hashSeed(x, y, this._rootId, now | 0));
  }

  /**
   * Load the def-derived fields for a given stage. For single-stage resources
   * the only valid stage is 0.
   */
  _loadStageDef(stageIndex, sizeOverride) {
    const def = getStageDef(this._rootId, stageIndex);
    this.currentStageIndex = stageIndex;
    this.id = def.id;                        // current visible resource id
    this.color = def.color;
    this.icon = def.icon;
    this.def = def;
    this.hp = def.hp;
    this.harvestTime = def.harvestTime;
    this.blockMovement = !!def.blockMovement;
    this.drops = def.drops;
    this.regrowTime = def.regrowTime || 0;
    this.maxHarvests = getMaxHarvests(this._rootId);  // root-level (depletion is per-root, not per-stage)
    this.size = sizeOverride ?? def.size;
  }

  get isDepletable() {
    return Number.isFinite(this.maxHarvests) && this.maxHarvests > 0;
  }

  get isGrowthCapable() {
    return isGrowthCapable(this._rootId);
  }

  get stageCount() {
    return isGrowthCapable(this._rootId) ? 3 : 1;
  }

  get isTerminalStage() {
    if (!this.isGrowthCapable) return true;
    return this.currentStageIndex === 2;     // last stage is always terminal
  }

  /**
   * Progress (0..1) within the current stage. For terminal stages
   * (duration = -1), returns 1. For non-growth-capable resources, returns 1.
   */
  getStageProgress(now = Date.now()) {
    if (!this.isGrowthCapable) return 1;
    const stages = this.def;                 // any def will do — we read growthStages from the root
    // get growthStages from the root catalog entry
    const gs = this._getGrowthStages();
    const cur = gs[this.currentStageIndex];
    if (!cur || cur.duration === -1) return 1;
    const total = cur.duration * 1000;
    const elapsed = now - this.stageStartedAt;
    if (elapsed <= 0) return 0;
    return Math.max(0, Math.min(1, elapsed / total));
  }

  _getGrowthStages() {
    return getGrowthStages(this._rootId);
  }

  /**
   * @param inventory Inventory to add drops to
   * @param now       current time in ms (Date.now() or performance.now())
   * @returns {granted, regrowAt, harvestCount, maxHarvests, depleted,
   *           transformedTo, currentStage, growthReset}
   *   - granted:         array of {itemId, count, leftover} (may be empty if already depleted)
   *   - regrowAt:        ms timestamp when this entity will respawn (0 = never / permanent)
   *   - harvestCount:    updated count AFTER this harvest
   *   - maxHarvests:     same as the def (Infinity for non-depletable)
   *   - depleted:        true if the entity is permanently exhausted after this call
   *   - transformedTo:   resource id the entity transformed into (null if no transform)
   *   - currentStage:    0/1/2 — the stage that was harvested
   *   - growthReset:     true if this was a growth-capable entity that just
   *                      completed a cycle (harvesting the terminal stage resets
   *                      the entity back to stage 0)
   */
  harvest(inventory, now = Date.now()) {
    if (this.depleted) {
      return {
        granted: [],
        regrowAt: 0,
        harvestCount: this.harvestCount,
        maxHarvests: this.maxHarvests,
        depleted: true,
        transformedTo: null,
        currentStage: this.currentStageIndex,
        growthReset: false
      };
    }
    const harvestedStage = this.currentStageIndex;
    const granted = [];
    for (const drop of this.drops) {
      if (this._rng() < drop.chance) {
        const r = inventory.add(drop.itemId, drop.count);
        granted.push({ itemId: drop.itemId, count: r.added, leftover: r.leftover });
      }
    }
    this.harvestCount += 1;
    let transformedTo = null;
    let regrowAt = 0;
    let depleted = false;
    let growthReset = false;

    // Depletion (root-level, applies to all stages of a growth-capable resource too)
    if (this.isDepletable && this.harvestCount >= this.maxHarvests) {
      const target = getDepletedTransformsTo(this._rootId);
      if (target && target !== this._rootId) {
        // In-place transform. Reset to a fresh root, stage 0.
        const wasRoot = this._rootId;
        this._rootId = target;
        this._init(this.x, this.y, undefined, undefined, now);
        transformedTo = this._rootId;
        // Newly transformed resource: schedule its own regrow (if any).
        if (this.regrowTime > 0) {
          this.depleted = true;
          regrowAt = now + this.regrowTime * 1000;
          this.regrowAt = regrowAt;
        } else {
          this.depleted = false;
          regrowAt = 0;
          this.regrowAt = 0;
        }
        return {
          granted, regrowAt,
          harvestCount: this.harvestCount,
          maxHarvests: this.maxHarvests,
          depleted: this.depleted,
          transformedTo,
          currentStage: harvestedStage,
          growthReset: false
        };
      }
      // No transform: permanently depleted, never regrows.
      this.depleted = true;
      this.regrowAt = 0;
      regrowAt = 0;
      depleted = true;
    } else if (this.isGrowthCapable) {
      // Growth-capable + not at depletion max: reset to stage 0 (full cycle).
      // Capture the harvested stage's regrowTime BEFORE _init overwrites it
      // (stage 0 is a different def). Using stage 0's regrowTime would let
      // players spam-harvest a mature tree and immediately re-pick it as a
      // sapling — we want the harvested stage's wait to gate re-pick.
      growthReset = true;
      const harvestedRegrowTime = this.regrowTime;
      this._init(this.x, this.y, undefined, undefined, now);
      if (harvestedRegrowTime > 0) {
        this.depleted = true;
        regrowAt = now + harvestedRegrowTime * 1000;
        this.regrowAt = regrowAt;
      } else {
        this.depleted = false;
        regrowAt = 0;
        this.regrowAt = 0;
      }
    } else if (this.regrowTime > 0) {
      // Non-growth-capable, non-depletable, with regrow.
      this.depleted = true;
      regrowAt = now + this.regrowTime * 1000;
      this.regrowAt = regrowAt;
    } else {
      // Non-regrowable, non-depletable, non-growth: permanent.
      this.depleted = true;
      this.regrowAt = 0;
      regrowAt = 0;
      depleted = true;
    }
    return {
      granted,
      regrowAt,
      harvestCount: this.harvestCount,
      maxHarvests: this.maxHarvests,
      // Reflect the entity's current depleted state (covers the regrow-mid case
      // where this.depleted=true mid-cycle but the local was not flipped).
      depleted: this.depleted,
      transformedTo,
      currentStage: harvestedStage,
      growthReset
    };
  }

  /**
   * Tick both regrow timer AND stage progression. Returns true if either
   * the entity just respawned (regrow) OR just advanced a stage.
   */
  update(now) {
    let changed = false;
    // 1) Regrow first (entity was depleted, now respawns).
    if (this.depleted && this.regrowAt !== 0 && now >= this.regrowAt) {
      this.depleted = false;
      this.regrowAt = 0;
      this._rng = mulberry32(hashSeed(this.x, this.y, this._rootId, now | 0));
      changed = true;
    }
    // 2) Stage progression (only for non-depleted, non-terminal stages).
    //    Chain advances so an offline player catching up after N seconds
    //    reaches the correct terminal stage in a single update() call.
    //    Carry forward the unused time from each consumed stage so the
    //    next stage's elapsed counter is correct.
    if (!this.depleted && this.isGrowthCapable && !this.isTerminalStage) {
      const gs = this._getGrowthStages();
      let advanced = false;
      let unused = now - this.stageStartedAt;   // ms available for the next stage
      while (this.currentStageIndex < 2) {
        const cur = gs[this.currentStageIndex];
        if (!cur || cur.duration <= 0) break;
        const need = cur.duration * 1000;
        if (unused < need) break;                // not enough time for this stage
        // Consume this stage's full duration; leftover goes to the next.
        unused -= need;
        const next = this.currentStageIndex + 1;
        this._loadStageDef(next, undefined);
        this.stageStartedAt = now - unused;       // next stage's "began at" so elapsed = unused
        this._rng = mulberry32(hashSeed(this.x, this.y, this._rootId, now | 0, next));
        advanced = true;
        if (this.isTerminalStage) break;
      }
      if (advanced) changed = true;
    }
    return changed;
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

function hashSeed(x, y, id, salt = 0, salt2 = 0) {
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1) ^ (hashStr(id) * 0x9e3779b1) ^ (salt * 0x85ebca6b) ^ (salt2 * 0xc2b2ae35);
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
