/**
 * Crops — 8 种作物定义 (种子 → 收获)
 *
 * 生长模型:
 *   每个 tile 的作物有一个 progress ∈ [0, 1]
 *   满 1.0 阶段(SEEDLING=0.25, GROWING=0.5, MATURE=0.75, READY=1.0)时升级
 *   基础生长速度 = growthDays 决定的总时长(秒)
 *   每秒推进 progress += 1 / (baseGrowthTime / currentMultiplier)
 *   缺水:wateredAt + needsWaterAfter 秒内未浇水 → 暂停生长
 *   施肥:fertilizedWith → multiplier 提升生长速度(直到收获或时间衰减)
 *
 * v1.0.0 — 初始 8 作物
 */
'use strict';

import { getItem } from '../resources/catalog.js';

export const CROP_STAGE = Object.freeze({
  SEED:    'seed',      // 刚播种
  SEEDLING:'seedling',  // 幼苗
  GROWING: 'growing',   // 生长期
  MATURE:  'mature',    // 成熟但未结果
  READY:   'ready'      // 可收获
});

export const STAGE_THRESHOLD = Object.freeze({
  [CROP_STAGE.SEED]:     0.00,
  [CROP_STAGE.SEEDLING]: 0.25,
  [CROP_STAGE.GROWING]:  0.50,
  [CROP_STAGE.MATURE]:   0.75,
  [CROP_STAGE.READY]:    1.00
});

/**
 * 8 作物 — 名称/生长参数/产量
 *   id              — 物品 id (收获后)
 *   seedId          — 种子物品 id
 *   displayName     — 中文显示名
 *   color           — 渲染主色
 *   growthDays      — 完整生长周期(秒) — 游戏时间,1 天 = 30 秒
 *   waterDrain      — 每次浇水后,水量持续时间(秒)
 *   needsWaterAfter — 种下后多少秒开始需要浇水
 *   yieldMin/Max    — 收获随机数量
 */
export const CROPS = Object.freeze({
  carrot: {
    id: 'carrot', seedId: 'carrot_seed', displayName: '胡萝卜', color: '#d4802a',
    growthDays: 3, waterDrain: 60, needsWaterAfter: 30,
    yieldMin: 1, yieldMax: 2,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#d4802a', ready: '#e88a2a' }
  },
  berries: {
    id: 'berries', seedId: 'berry_seed', displayName: '浆果', color: '#8a2a4a',
    growthDays: 2, waterDrain: 70, needsWaterAfter: 25,
    yieldMin: 2, yieldMax: 4,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#a83a5a', ready: '#8a2a4a' }
  },
  corn: {
    id: 'corn', seedId: 'corn_seed', displayName: '玉米', color: '#e8c84a',
    growthDays: 4, waterDrain: 60, needsWaterAfter: 35,
    yieldMin: 1, yieldMax: 3,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#c8c84a', ready: '#e8c84a' }
  },
  tomato: {
    id: 'tomato', seedId: 'tomato_seed', displayName: '番茄', color: '#d43a3a',
    growthDays: 3, waterDrain: 55, needsWaterAfter: 30,
    yieldMin: 1, yieldMax: 3,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#d44a3a', ready: '#d43a3a' }
  },
  potato: {
    id: 'potato', seedId: 'potato_seed', displayName: '土豆', color: '#b8956a',
    growthDays: 4, waterDrain: 60, needsWaterAfter: 35,
    yieldMin: 1, yieldMax: 3,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#b8956a', ready: '#c8a070' }
  },
  watermelon: {
    id: 'watermelon', seedId: 'watermelon_seed', displayName: '西瓜', color: '#5ad47a',
    growthDays: 6, waterDrain: 80, needsWaterAfter: 50,
    yieldMin: 1, yieldMax: 2,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#5ad47a', ready: '#3aaa5a' }
  },
  pumpkin: {
    id: 'pumpkin', seedId: 'pumpkin_seed', displayName: '南瓜', color: '#e88838',
    growthDays: 6, waterDrain: 80, needsWaterAfter: 50,
    yieldMin: 1, yieldMax: 2,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#7aaa3a', mature: '#e89040', ready: '#e88838' }
  },
  wheat: {
    id: 'wheat', seedId: 'wheat_seed', displayName: '小麦', color: '#d4b84a',
    growthDays: 3, waterDrain: 50, needsWaterAfter: 25,
    yieldMin: 2, yieldMax: 4,
    stages: { seed: '#7a5a3a', seedling: '#5a8a3a', growing: '#a8a040', mature: '#d4b84a', ready: '#e8c84a' }
  }
});

/**
 * Resolve crop by seed id.
 * Returns null if seedId is not a known crop seed.
 */
export function cropFromSeed(seedId) {
  for (const crop of Object.values(CROPS)) {
    if (crop.seedId === seedId) return crop;
  }
  return null;
}

/**
 * Resolve crop by its yield id.
 * Returns null if no crop yields that id.
 */
export function cropFromYield(yieldId) {
  for (const crop of Object.values(CROPS)) {
    if (crop.id === yieldId) return crop;
  }
  return null;
}

/**
 * All seed item ids (for inventory filtering).
 */
export function allSeedIds() {
  return Object.values(CROPS).map(c => c.seedId);
}

/**
 * Given a seed item, return the crop definition.
 * Throws if seedId is not a known seed.
 */
export function getCropBySeed(seedId) {
  const c = cropFromSeed(seedId);
  if (!c) throw new Error(`Unknown crop seed: ${seedId}`);
  return c;
}

/**
 * Get color of a crop at a given progress [0, 1].
 * Returns the stage color (one of seed/seedling/growing/mature/ready).
 */
export function colorAtProgress(crop, progress) {
  const stage = stageForProgress(progress);
  return crop.stages[stage];
}

/**
 * Given a progress value, return the matching stage.
 * - 0.00 - 0.249 → seed
 * - 0.25 - 0.499 → seedling
 * - 0.50 - 0.749 → growing
 * - 0.75 - 0.99  → mature
 * - 1.00         → ready
 */
export function stageForProgress(progress) {
  if (progress >= STAGE_THRESHOLD[CROP_STAGE.READY])    return CROP_STAGE.READY;
  if (progress >= STAGE_THRESHOLD[CROP_STAGE.MATURE])   return CROP_STAGE.MATURE;
  if (progress >= STAGE_THRESHOLD[CROP_STAGE.GROWING])  return CROP_STAGE.GROWING;
  if (progress >= STAGE_THRESHOLD[CROP_STAGE.SEEDLING]) return CROP_STAGE.SEEDLING;
  return CROP_STAGE.SEED;
}

/**
 * Default crop growth time (seconds) for crops without explicit growthDays.
 * (Currently all crops declare growthDays; this is a fallback safety net.)
 */
export const DEFAULT_GROWTH_DAYS = 4;

/**
 * Convert crop growthDays to in-game seconds.
 * Game convention: 1 day = 30 real seconds.
 */
export function growthSeconds(crop) {
  return (crop.growthDays || DEFAULT_GROWTH_DAYS) * 30;
}
