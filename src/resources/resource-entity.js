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
 */
'use strict';

import { getResource, getMaxHarvests, getDepletedTransformsTo } from './catalog.js';

export class ResourceEntity {
  constructor({ id, x, y, size, rngSeed } = {}) {
    this._loadDef(id, size);
    this.x         = x;
    this.y         = y;
    this.depleted  = false;
    this.regrowAt  = 0;                         // ms timestamp; 0 = not regrowing
    this.harvestCount = 0;
    this._rng      = mulberry32(rngSeed ?? hashSeed(x, y, id));
  }

  /**
   * Internal: load (or reload) all def-derived fields from the catalog.
   * Used by the constructor and by the transform-on-deplete step.
   */
  _loadDef(id, sizeOverride) {
    const def = getResource(id);
    this.id        = def.id;
    this.color     = def.color;
    this.icon      = def.icon;
    this.def       = def;
    this.hp        = def.hp;
    this.harvestTime = def.harvestTime;
    this.blockMovement = !!def.blockMovement;
    this.drops     = def.drops;
    this.regrowTime  = def.regrowTime || 0;     // seconds; 0 = no regrow
    this.maxHarvests = getMaxHarvests(id);      // Infinity if not depletable
    this.size      = sizeOverride ?? def.size;
  }

  get isDepletable() {
    return Number.isFinite(this.maxHarvests) && this.maxHarvests > 0;
  }

  /**
   * @param inventory Inventory to add drops to
   * @param now       current time in ms (Date.now() or performance.now())
   * @returns {granted, regrowAt, harvestCount, maxHarvests, depleted, transformedTo}
   *   - granted:         array of {itemId, count, leftover} (may be empty if already depleted)
   *   - regrowAt:        ms timestamp when this entity will respawn (0 = never / permanent)
   *   - harvestCount:    updated count AFTER this harvest
   *   - maxHarvests:     same as the def (Infinity for non-depletable)
   *   - depleted:        true if the entity is permanently exhausted after this call
   *   - transformedTo:   resource id the entity transformed into (null if no transform)
   */
  harvest(inventory, now = Date.now()) {
    if (this.depleted) {
      return {
        granted: [],
        regrowAt: 0,
        harvestCount: this.harvestCount,
        maxHarvests: this.maxHarvests,
        depleted: true,
        transformedTo: null
      };
    }
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
    if (this.isDepletable && this.harvestCount >= this.maxHarvests) {
      // Permanent depletion. If we have a transform target, mutate into it.
      const target = getDepletedTransformsTo(this.id);
      if (target && target !== this.id) {
        this._loadDef(target);          // mutate in place: new def, drops, icon, ...
        this.harvestCount = 0;          // reset for the new resource type
        this._rng = mulberry32(hashSeed(this.x, this.y, this.id, now | 0));
        transformedTo = this.id;
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
          granted,
          regrowAt,
          harvestCount: this.harvestCount,
          maxHarvests: this.maxHarvests,
          depleted: this.depleted,
          transformedTo
        };
      }
      // No transform: mark permanently depleted, no regrow.
      this.depleted = true;
      this.regrowAt = 0;
      regrowAt = 0;
    } else if (this.regrowTime > 0) {
      // Depletable but not yet at max, OR non-depletable: schedule regrow.
      this.depleted = true;
      regrowAt = now + this.regrowTime * 1000;
      this.regrowAt = regrowAt;
    } else {
      // Depletable (no transform) reached max OR non-regrowable: permanent.
      this.depleted = true;
      this.regrowAt = 0;
      regrowAt = 0;
    }
    return {
      granted,
      regrowAt,
      harvestCount: this.harvestCount,
      maxHarvests: this.maxHarvests,
      depleted: this.depleted,
      transformedTo
    };
  }

  /**
   * Tick regrow timer. Returns true if this entity just respawned
   * (so callers can emit a one-shot "regrow" event for VFX/audio).
   */
  update(now) {
    if (!this.depleted) return false;
    if (this.regrowAt === 0) return false;          // permanent depletion
    if (now < this.regrowAt) return false;
    this.depleted = false;
    this.regrowAt = 0;
    // Re-seed RNG so regrown entity has deterministic drops next time.
    this._rng = mulberry32(hashSeed(this.x, this.y, this.id, now | 0));
    return true;
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
