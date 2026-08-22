/**
 * Village — generates a piglin village in the forest biome.
 *
 * Layout:
 *   - 3..5 piglin houses (each is a 2x2 tile footprint)
 *   - 1 trading post (a 2x2 tile footprint, marked with a different id)
 *   - 1 piglin per house
 *   - all buildings placed near each other (forming a small plaza)
 *   - 1 trading post in the center, houses radiating outward
 *
 * The generator walks the forest biome and finds a square clearing
 * big enough for the village footprint (default 7x7), then snaps
 * buildings to a 2x2 grid inside it. The chosen origin is
 * deterministic for a given world + seed.
 */
'use strict';
import { Piglin } from './piglin.js';
import piglinsRaw from './data/piglins.json' with { type: 'json' };

const PIGLIN_CFG = (() => {
  const out = {};
  for (const k of Object.keys(piglinsRaw)) {
    if (k === '_meta') continue;
    out[k] = piglinsRaw[k];
  }
  return out;
})();

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

/**
 * Find a forest tile inside the world with a 7x7 walkable clearing.
 * Tries a handful of random candidate origins; returns the best one
 * (or null if nothing fits).
 */
function findVillageOrigin(world, rng, cfg, opts = {}) {
  const W = world.width, H = world.height;
  const pad = 2;
  const clearing = 7;
  // M5: 'forest' is a real biome again (re-introduced in v0.5.1).
  // The piglin village lives in forest clearings.
  const preferredBiome = opts.preferredBiome || 'forest';
  const candidates = [];
  // 60 random tries; keep the one with the most preferred-biome neighbors.
  for (let i = 0; i < 60; i++) {
    const x = pad + Math.floor(rng() * (W - clearing - pad * 2));
    const y = pad + Math.floor(rng() * (H - clearing - pad * 2));
    if (!canPlaceVillage(world, x, y, clearing)) continue;
    const biomeCount = countPreferredBiomeTiles(world, x, y, clearing, preferredBiome);
    candidates.push({ x, y, biomeCount });
  }
  if (candidates.length === 0) return null;
  // Highest biome count first; break ties by first appearance.
  candidates.sort((a, b) => b.biomeCount - a.biomeCount);
  // Refuse to spawn a "village" in a biome with no preferred biome
  // tiles — pigs live in marsh/forest clearings, not deserts.
  if (candidates[0].biomeCount === 0) return null;
  return { x: candidates[0].x, y: candidates[0].y };
}

function canPlaceVillage(world, x, y, sz) {
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      if (!world.isWalkable(x + dx, y + dy)) return false;
    }
  }
  return true;
}

function countPreferredBiomeTiles(world, x, y, sz, preferredBiome) {
  let n = 0;
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      if (world.getTile(x + dx, y + dy) === preferredBiome) n++;
    }
  }
  return n;
}

/**
 * Generate a piglin village in the world.
 * @param {Object} world
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.houseCount] — 3..5, defaults to 4
 * @returns {{piglins: Piglin[], buildings: Array, origin: {x:number,y:number}|null}}
 *   - piglins: Piglin[] spawned (one per house)
 *   - buildings: array of building descriptors for the renderer
 *       { kind: 'house'|'trader', x, y, w, h }
 *   - origin: top-left of the 7x7 plaza, or null if no spot found
 */
export function generateVillage(world, opts = {}) {
  const seed = opts.seed ?? world.seed;
  const houseCount = Math.max(3, Math.min(5, opts.houseCount ?? 4));
  const rng = mulberry32((seed ^ 0xABCDEF) >>> 0);
  const origin = findVillageOrigin(world, rng, PIGLIN_CFG.piglin, opts);
  if (!origin) {
    return { piglins: [], buildings: [], origin: null };
  }
  // Plaza center: origin + (3, 3)
  const cx = origin.x + 3, cy = origin.y + 3;
  // 4 outer "slots" around the plaza — N, E, S, W.
  // For 3..5 houses we use 4 cardinal slots + (optionally) one
  // diagonal so the spread is balanced.
  const slots = [
    { x: origin.x + 2,        y: origin.y },          // N
    { x: origin.x + 4,        y: origin.y },          // N (second)
    { x: origin.x + 6,        y: origin.y + 2 },      // E
    { x: origin.x + 6,        y: origin.y + 4 },      // E (second)
    { x: origin.x + 2,        y: origin.y + 5 },      // S
    { x: origin.x + 4,        y: origin.y + 5 },      // S (second)
    { x: origin.x,            y: origin.y + 2 },      // W
    { x: origin.x,            y: origin.y + 4 }       // W (second)
  ];
  // Trading post is the center 2x2 of the plaza.
  const traderSlot = { x: cx - 1, y: cy - 1, w: 2, h: 2 };
  const buildings = [{
    kind: 'trader',
    x: traderSlot.x, y: traderSlot.y, w: 2, h: 2
  }];
  // Pick `houseCount` slots (shuffle deterministically).
  const shuffled = slots.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = shuffled.slice(0, houseCount);
  // Build piglins.
  const piglins = [];
  for (let i = 0; i < chosen.length; i++) {
    const s = chosen[i];
    const w = 2, h = 2;
    // Validate the chosen slot is still walkable (it was at scan time
    // but a previous building could have occupied it; for the first
    // pass this won't happen but keep the guard for future changes).
    if (!canPlaceFootprint(world, s.x, s.y, w, h)) continue;
    buildings.push({ kind: 'house', x: s.x, y: s.y, w, h });
    const cfg = PIGLIN_CFG.piglin;
    const p = new Piglin({
      typeId: 'piglin',
      config: cfg,
      world,
      x: s.x, y: s.y,
      seed: (seed ^ ((s.x * 73856093) ^ (s.y * 19349663) ^ (i + 1) * 0x9E3779B1)) >>> 0,
      houseTiles: { x: s.x, y: s.y, w, h }
    });
    piglins.push(p);
  }
  return { piglins, buildings, origin };
}

function canPlaceFootprint(world, x, y, w, h) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (!world.isWalkable(x + dx, y + dy)) return false;
    }
  }
  return true;
}

export const VILLAGE_CONFIG = Object.freeze({
  HOUSE_FOOTPRINT: { w: 2, h: 2 },
  TRADER_FOOTPRINT: { w: 2, h: 2 },
  PLAZA_SIZE: 7
});

/** Get the building under a tile, or null. */
export function buildingAt(buildings, tx, ty) {
  for (const b of buildings) {
    if (tx >= b.x && tx < b.x + b.w
     && ty >= b.y && ty < b.y + b.h) return b;
  }
  return null;
}

/** Get the trading-post building, if any. */
export function traderBuilding(buildings) {
  for (const b of buildings) if (b.kind === 'trader') return b;
  return null;
}
