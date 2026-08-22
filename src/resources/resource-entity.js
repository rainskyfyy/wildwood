/**
 * ResourceEntity — one harvestable node on the world map.
 *
 * v1.0.1 — regrow support:
 *   - regrowTime in def: 0 = no regrow, >0 = regrow after N seconds
 *   - harvest() sets regrowAt = now + regrowTime*1000
 *   - update(now)        returns true if this entity just respawned
 *   - getVisualState()   'full' | 'depleted' | 'regrowing'
 *   - regrowFraction()   0..1 progress toward regrow
 */
'use strict';

import { getResource } from './catalog.js';

export class ResourceEntity {
  constructor({ id, x, y, size, rngSeed } = {}) {
    const def = getResource(id);
    this.id        = def.id;
    this.x         = x;
    this.y         = y;
    this.size      = size ?? def.size;
    this.color     = def.color;
    this.icon      = def.icon;
    this.def       = def;
    this.hp        = def.hp;
    this.harvestTime = def.harvestTime;
    this.blockMovement = !!def.blockMovement;
    this.drops     = def.drops;
    this.regrowTime  = def.regrowTime || 0;   // seconds; 0 = permanent depletion
    this.depleted  = false;
    this.regrowAt  = 0;                         // ms timestamp; 0 = not regrowing
    this._rng      = mulberry32(rngSeed ?? hashSeed(x, y, id));
  }

  /**
   * @param inventory Inventory to add drops to
   * @param now       current time in ms (Date.now() or performance.now())
   * @returns {granted[], regrowAt: number}  regrowAt = 0 if no regrow
   */
  harvest(inventory, now = Date.now()) {
    if (this.depleted) return { granted: [], regrowAt: 0 };
    const granted = [];
    for (const drop of this.drops) {
      if (this._rng() < drop.chance) {
        const r = inventory.add(drop.itemId, drop.count);
        granted.push({ itemId: drop.itemId, count: r.added, leftover: r.leftover });
      }
    }
    if (this.regrowTime > 0) {
      this.depleted = true;
      this.regrowAt = now + this.regrowTime * 1000;
    } else {
      this.depleted = true;
      this.regrowAt = 0;
    }
    return { granted, regrowAt: this.regrowAt };
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
