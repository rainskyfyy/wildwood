/**
 * Quality — 烹饪品质分级
 *
 * 品质等级:
 *   NORMAL  — 普通 (默认)
 *   GOOD    — 优秀 (额外加成 +25% food value)
 *   PERFECT — 完美 (额外加成 +50% food value,且 +1 份)
 *
 * 计算依据(基于 4 槽中食材):
 *   - 食材种类数 (1-4 种,>=3 = 完美基础)
 *   - 食材新鲜度 (cooked_xxx 的 freshness 比例)
 *   - 是否含 high-grade 食材 (meat, honey, egg)
 *   - 是否含 "垃圾" 食材 (rotten — 暂无,预留)
 *
 * 规则表(可调):
 *   >= 3 种不同 + 含 meat/honey/egg + 全 fresh → PERFECT
 *   >= 2 种 + 全 fresh                          → GOOD
 *   否则                                          → NORMAL
 *
 * 严格 4 槽使用:
 *   4 槽用满,且 pattern 长度正好匹配 → 完美(1.5x food)
 *   pattern 长度匹配但有空格       → 普通
 *
 * v1.0.0
 */
'use strict';

import { getItem } from '../resources/catalog.js';

export const QUALITY = Object.freeze({
  NORMAL:  'normal',
  GOOD:    'good',
  PERFECT: 'perfect'
});

export const QUALITY_RANK = Object.freeze({
  [QUALITY.NORMAL]:  1,
  [QUALITY.GOOD]:    2,
  [QUALITY.PERFECT]: 3
});

/**
 * 优秀食材 — 提升品质
 * honey / meat / egg / salt
 */
const PREMIUM_INGREDIENTS = new Set(['honey', 'meat', 'egg', 'salt']);

/**
 * Compute the quality of a dish given the input slots and matched recipe.
 *
 * @param {string[]} inputCells  - 4 槽中的 itemId 数组(可能含 '' 占位)
 * @param {string[]} recipePattern - 食谱 pattern (1D 数组)
 * @param {Object}   inventoryStats - { avgFreshness: 0..1 } 食材平均新鲜度
 * @returns {string} QUALITY.NORMAL | GOOD | PERFECT
 */
export function computeQuality(inputCells, recipePattern, inventoryStats) {
  const nonEmpty = inputCells.filter(c => c !== '');
  const patternLen = recipePattern.filter(c => c !== '').length;
  const unique = new Set(nonEmpty);

  // 完美条件:用满 pattern、>=3 种食材、含 premium、平均新鲜度 >= 0.7
  if (patternLen >= 3 && unique.size >= 3) {
    const hasPremium = nonEmpty.some(id => PREMIUM_INGREDIENTS.has(id));
    const freshOk = (inventoryStats?.avgFreshness ?? 1) >= 0.7;
    if (hasPremium && freshOk) return QUALITY.PERFECT;
  }

  // 优秀条件:2+ 种食材 + 高新鲜度
  if (unique.size >= 2 && (inventoryStats?.avgFreshness ?? 1) >= 0.5) {
    return QUALITY.GOOD;
  }

  return QUALITY.NORMAL;
}

/**
 * Food value multiplier for a quality tier.
 *   NORMAL  → 1.0
 *   GOOD    → 1.25
 *   PERFECT → 1.5  (and +1 extra serving, applied by caller)
 */
export function qualityMult(quality) {
  if (quality === QUALITY.PERFECT) return 1.5;
  if (quality === QUALITY.GOOD)   return 1.25;
  return 1.0;
}

/**
 * Compute output count for a quality tier.
 *   NORMAL  → base
 *   GOOD    → base
 *   PERFECT → base + 1
 */
export function qualityBonus(quality, base = 1) {
  if (quality === QUALITY.PERFECT) return base + 1;
  return base;
}

/**
 * Quality display color (for UI).
 */
export function qualityColor(quality) {
  if (quality === QUALITY.PERFECT) return '#f0c850';
  if (quality === QUALITY.GOOD)   return '#88e088';
  return '#cccccc';
}

/**
 * Quality display name (Chinese).
 */
export function qualityName(quality) {
  if (quality === QUALITY.PERFECT) return '完美';
  if (quality === QUALITY.GOOD)   return '优秀';
  return '普通';
}
