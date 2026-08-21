/**
 * Event registry — 3 random events: full_moon, meteor_shower, earthquake.
 *
 * Each event is a frozen data object describing:
 *   - id          — short key
 *   - name        — display name (zh-CN, English fallback)
 *   - duration    — how long the event stays active (seconds)
 *   - description — short player-facing copy
 *   - effects     — declarative side effects; the EventManager reads
 *                   this and applies them on trigger / update.
 *
 * Effects conventions (so the manager doesn't need to know each event):
 *
 *   full_moon:
 *     { kind: 'monster_attr', atkMul: 2.0, speedMul: 1.2 }
 *     → multiplies every monster's atk and speed while active
 *
 *   meteor_shower:
 *     { kind: 'meteor_fall', count: 6, minRarity: 'rare', dropRadius: 1.5 }
 *     → drops rare-mineral items at random walkable tiles
 *
 *   earthquake:
 *     { kind: 'cave_poi', count: 1, radius: 1.0, expiresWith: true }
 *     → spawns a temporary cave POI that disappears when the event ends
 *
 * v0.5.2 — first cut.
 */
'use strict';

/**
 * Validate an event config has the fields we rely on.
 * @param {string} id
 * @param {Object} e
 */
function validateEvent(id, e) {
  if (!e || typeof e !== 'object') {
    throw new Error(`EventRegistry: event "${id}" must be an object`);
  }
  if (typeof e.duration !== 'number' || e.duration <= 0) {
    throw new Error(`EventRegistry: event "${id}" needs positive duration`);
  }
  if (!e.effects || !Array.isArray(e.effects) || e.effects.length === 0) {
    throw new Error(`EventRegistry: event "${id}" needs non-empty effects[]`);
  }
}

const _events = {
  full_moon: {
    id: 'full_moon',
    name: '满月',
    nameEn: 'Full Moon',
    duration: 60,  // 1 night (in-game minute = 1s by default; tweak later)
    description: '怪物狂暴，攻击力翻倍。',
    effects: [
      { kind: 'monster_attr', atkMul: 2.0, speedMul: 1.2 }
    ]
  },

  meteor_shower: {
    id: 'meteor_shower',
    name: '陨石雨',
    nameEn: 'Meteor Shower',
    duration: 45,
    description: '陨石坠落，落地后留下稀有矿物。',
    effects: [
      { kind: 'meteor_fall', count: 6, dropRadius: 1.5, itemPool: [
        'iron_ore', 'gold_ore', 'crystal_shard', 'ancient_core'
      ] }
    ]
  },

  earthquake: {
    id: 'earthquake',
    name: '地震',
    nameEn: 'Earthquake',
    duration: 90,
    description: '地表裂开，限时洞穴入口出现。',
    effects: [
      { kind: 'cave_poi', count: 1, radius: 1.0, expiresWith: true }
    ]
  }
};

// Validate everything at module load (fail fast on misconfigured data).
for (const [id, e] of Object.entries(_events)) validateEvent(id, e);

/**
 * Frozen event table. Exposed via EventRegistry.events; tests and
 * the EventManager read but should not mutate.
 */
export const events = Object.freeze(_events);

/**
 * Single point of access for event metadata. Frozen so the
 * manager / tests can't accidentally clobber the registry.
 */
export const EventRegistry = Object.freeze({
  events,
  /**
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    return _events[id] || null;
  },
  all() {
    return Object.values(_events);
  }
});
