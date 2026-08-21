/**
 * ResourceEntity — one harvestable node on the world map.
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
    this.depleted  = false;
    this._rng      = mulberry32(rngSeed ?? hashSeed(x, y, id));
  }

  harvest(inventory) {
    if (this.depleted) return [];
    this.depleted = true;
    const granted = [];
    for (const drop of this.drops) {
      if (this._rng() < drop.chance) {
        const r = inventory.add(drop.itemId, drop.count);
        granted.push({ itemId: drop.itemId, count: r.added, leftover: r.leftover });
      }
    }
    return granted;
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

function hashSeed(x, y, id) {
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1) ^ (hashStr(id) * 0x9e3779b1);
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
