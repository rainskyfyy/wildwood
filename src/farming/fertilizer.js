/**
 * Fertilizer — 4 种肥料配置
 *
 * 肥料效果:
 *   - 提高生长 multiplier (fertilizerMult)
 *   - 持续 1 个完整生长周期,或直到收获
 *   - 多重施肥:取最高 tier 的 fertilizerMult(不叠加)
 *
 * 4 肥料(从 items.json):
 *   compost         tier 1 mult 1.25
 *   bonemeal        tier 2 mult 1.5
 *   bird_guano      tier 3 mult 1.75
 *   mixed_fertilizer tier 4 mult 2.0
 *
 * v1.0.0 — 初始 4 肥料
 */
'use strict';

import { getItem } from '../resources/catalog.js';

export const FERTILIZERS = Object.freeze({
  compost: {
    id: 'compost', tier: 1, mult: 1.25,
    displayName: '腐殖土', color: '#5a3a1a',
    description: '基础有机肥,小幅提升生长速度'
  },
  bonemeal: {
    id: 'bonemeal', tier: 2, mult: 1.5,
    displayName: '骨粉', color: '#e8e0d0',
    description: '研磨骨骼制成,中等生长加速'
  },
  bird_guano: {
    id: 'bird_guano', tier: 3, mult: 1.75,
    displayName: '鸟粪', color: '#d4c8a0',
    description: '富含氮,强力生长加速'
  },
  mixed_fertilizer: {
    id: 'mixed_fertilizer', tier: 4, mult: 2.0,
    displayName: '混合肥', color: '#7a5a3a',
    description: '混合多种肥料,最高生长加速'
  }
});

/**
 * Resolve a fertilizer definition by item id.
 * Returns null if id is not a known fertilizer.
 */
export function getFertilizer(itemId) {
  return FERTILIZERS[itemId] || null;
}

/**
 * All fertilizer item ids (for inventory filtering).
 */
export function allFertilizerIds() {
  return Object.keys(FERTILIZERS);
}

/**
 * Given the currently-fertilized state and a new fertilizer id,
 * return the new (potentially upgraded) fertilizer state.
 *
 * Multi-fertilizer: 总是取最高 tier (不叠加)
 */
export function combineFertilizer(currentState, newFertId) {
  const next = getFertilizer(newFertId);
  if (!next) return currentState;
  if (!currentState) {
    return { id: next.id, tier: next.tier, mult: next.mult, appliedAt: Date.now() };
  }
  const cur = getFertilizer(currentState.id);
  if (!cur || next.tier > cur.tier) {
    return { id: next.id, tier: next.tier, mult: next.mult, appliedAt: Date.now() };
  }
  return currentState;
}

/**
 * Get the current growth multiplier from a fertilizer state.
 * Returns 1.0 if no fertilizer or state is stale.
 */
export function currentFertilizerMult(fertState) {
  if (!fertState) return 1.0;
  return getFertilizer(fertState.id)?.mult || 1.0;
}
