/**
 * BossConfig — load + freeze the bosses.json catalog.
 *
 * v0.5.2 — 4 seasonal bosses:
 *   spring_deer (春季巨鹿)   — marsh  (formerly "forest")
 *   summer_queen (夏季蚁后)  — desert
 *   autumn_bear (秋季熊獾)   — marsh  ("草原" 群系在 v0.4 已合并到 marsh)
 *   winter_dragon (冬季冰龙) — snow
 *
 * Each boss has 2-3 phases, a skill list (charge/roar/aoe/summon),
 * and a drops table that BossManager converts into inventory items.
 *
 * Public API:
 *   getBoss(id)          — full config (frozen)
 *   allBosses()          — list of all 4 configs
 *   bossesForBiome(id)   — subset whose .biome === id
 */
'use strict';
import bossesRaw from '../data/bosses.json' with { type: 'json' };

const _stripMeta = (o) => {
  const out = {};
  for (const k of Object.keys(o)) if (k !== '_meta') out[k] = o[k];
  return out;
};

const _BOSSES = Object.freeze(_stripMeta(bossesRaw));

/**
 * Get a boss config by id. Throws on unknown id.
 */
export function getBoss(id) {
  const b = _BOSSES[id];
  if (!b) throw new Error(`Unknown boss: ${id}`);
  return b;
}

/**
 * Return all 4 boss configs as an array.
 */
export function allBosses() {
  return Object.values(_BOSSES);
}

/**
 * Filter bosses by their preferred biome.
 */
export function bossesForBiome(biomeId) {
  return allBosses().filter(b => b.biome === biomeId);
}

/**
 * BossConfig — namespace object so callers can use `BossConfig.bosses`.
 * Useful for tests that want a static map of all 4 bosses.
 */
export const BossConfig = Object.freeze({
  bosses: _BOSSES,
  get: getBoss,
  all: allBosses,
  forBiome: bossesForBiome
});

/**
 * Validate the loaded boss catalog. Throws on schema errors.
 * Same pattern as catalog.js validateCatalog().
 */
export function validateBossConfig() {
  const ids = new Set();
  for (const b of Object.values(_BOSSES)) {
    if (ids.has(b.id)) throw new Error(`Duplicate boss id: ${b.id}`);
    ids.add(b.id);
    for (const field of ['name', 'biome', 'hp', 'atk', 'speed', 'phases', 'skills', 'drops']) {
      if (b[field] === undefined || b[field] === null) {
        throw new Error(`Boss "${b.id}" missing field "${field}"`);
      }
    }
    if (b.phases.length < 2 || b.phases.length > 3) {
      throw new Error(`Boss "${b.id}" must have 2-3 phases, got ${b.phases.length}`);
    }
    for (let i = 0; i < b.phases.length; i++) {
      const ph = b.phases[i];
      if (typeof ph.hpThreshold !== 'number' || ph.hpThreshold <= 0 || ph.hpThreshold > 1.0) {
        throw new Error(`Boss "${b.id}" phase[${i}].hpThreshold must be (0, 1], got ${ph.hpThreshold}`);
      }
    }
    if (b.phases[0].hpThreshold !== 1.0) {
      throw new Error(`Boss "${b.id}" phase[0].hpThreshold must be 1.0, got ${b.phases[0].hpThreshold}`);
    }
    for (const s of b.skills) {
      if (!s.id || !s.type) throw new Error(`Boss "${b.id}" skill missing id/type`);
      if (typeof s.cooldown !== 'number' || s.cooldown <= 0) {
        throw new Error(`Boss "${b.id}" skill "${s.id}" cooldown must be > 0`);
      }
      const validTypes = ['charge', 'roar', 'aoe', 'summon'];
      if (!validTypes.includes(s.type)) {
        throw new Error(`Boss "${b.id}" skill "${s.id}" type must be one of ${validTypes.join(',')}, got ${s.type}`);
      }
    }
    for (const d of b.drops) {
      if (!d.itemId) throw new Error(`Boss "${b.id}" drop missing itemId`);
      if (typeof d.count !== 'number' || d.count <= 0) {
        throw new Error(`Boss "${b.id}" drop "${d.itemId}" count must be > 0`);
      }
    }
  }
  return true;
}
