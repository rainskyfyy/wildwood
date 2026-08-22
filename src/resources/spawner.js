/**
 * Spawner — scatter harvestable ResourceEntity per tile, biome-gated.
 *
 * v0.6.0c: 暴露 sort-by-dist 查询工具(findNearest / findInRange / pickById),
 *   防止测试写"spawn 顺序第 N 个"导致 catalog 增删后假阳性 fail。
 *   详见 docs/spawner-fixture-guideline.md。
 *
 * 内部遍历顺序(tile 先行后列 → catalog 顺序)固定且确定,但 **API 不承诺**:
 *   返回数组 `out` 的下标含义不在对外契约里。所有跨 spawn 顺序的查询
 *   必须走下面三个工具之一。
 */
'use strict';

import { ResourceEntity } from './resource-entity.js';
import { resourcesForBiome } from './catalog.js';
import { getBiome } from '../world/biome-config.js';

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

function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 主函数:在每个 walkable tile 上按 density 撒资源。
 * 返回 ResourceEntity[]。**注意**:数组下标语义不保证跨 catalog 改动稳定。
 *   - 同一 seed + 同一 catalog → 数组内容(实体集合)稳定
 *   - 但**遍历顺序**依赖 catalog 的内部顺序与 tile 遍历方向;增删资源
 *     不应让测试用 `out[0]`/`out.find(...)` 拿特定 id 的第一个(应改用
 *     findNearest / pickById)
 */
export function spawnResources(world, { seed, biomeFilter = null } = {}) {
  const rng = mulberry32((seed ?? world.seed) ^ 0xCAFE);
  const out = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const biomeId = world.getTile(x, y);
      if (!biomeId) continue;
      if (biomeFilter && biomeId !== biomeFilter) continue;
      if (!getBiome(biomeId).walkable) continue;
      const eligible = resourcesForBiome(biomeId);
      for (const def of eligible) {
        if (rng() < def.density) {
          out.push(new ResourceEntity({
            id: def.id,
            x: x + 0.5 + (rng() - 0.5) * 0.4,
            y: y + 0.5 + (rng() - 0.5) * 0.4,
            size: def.size * (0.9 + rng() * 0.2),
            rngSeed: (Math.floor(x * 1000 + y) ^ hashStr(def.id)) >>> 0
          }));
        }
      }
    }
  }
  return out;
}

// =====================================================================
// 查询工具(纯函数)— v0.6.0c 抗 RNG 漂移硬约束
// =====================================================================
//
// **所有**需要"从一组 ResourceEntity 里挑一个/几个"的代码,都应走这三个
// 函数中的一个。它们只看坐标距离与 id,**不依赖** spawner 返回数组的下标。
// 这样无论 catalog 增删、tile 遍历顺序怎么变,测试断言都不会假阳性 fail。

/**
 * 找距离 (x, y) 最近的一个实体。
 * @param {ResourceEntity[]} entities — 任意一组(spawner 输出的、或局部过滤的)
 * @param {number} x
 * @param {number} y
 * @param {string|null} [filter] — 可选 id 过滤;非 null 时只考虑 `e.id === filter`
 * @returns {ResourceEntity|null} 没找到返回 null
 *
 * **正确用法**:
 *   const target = findNearest(ents, player.x, player.y, 'tree');
 * **错误用法**(会被 v0.6.0c 文档明确禁止):
 *   const target = ents.find(e => e.id === 'tree' && e.distTo(px,py) < 30);
 *   // 上面的 .find 拿到的是"spawn 顺序的第一个 tree",不是"最近的 tree"
 *   // 删一个资源 / 改 catalog 顺序,这个测试就崩
 */
export function findNearest(entities, x, y, filter = null) {
  let best = null;
  let bestDist = Infinity;
  for (const e of entities) {
    if (filter !== null && filter !== undefined && e.id !== filter) continue;
    const d = e.distTo(x, y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/**
 * 找距离 (x, y) 在 maxRadius 内的全部实体,按距离升序返回。
 * @param {ResourceEntity[]} entities
 * @param {number} x
 * @param {number} y
 * @param {number} maxRadius
 * @param {string|null} [filter]
 * @returns {Array<{entity: ResourceEntity, dist: number}>} 距离升序
 */
export function findInRange(entities, x, y, maxRadius, filter = null) {
  const out = [];
  for (const e of entities) {
    if (filter !== null && filter !== undefined && e.id !== filter) continue;
    const d = e.distTo(x, y);
    if (d <= maxRadius) {
      out.push({ entity: e, dist: d });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/**
 * 按 id 分组取全部实体(保留相对顺序,但通过 id 字典访问,不依赖下标)。
 * @param {ResourceEntity[]} entities
 * @returns {Object<string, ResourceEntity[]>}
 */
export function groupById(entities) {
  const out = Object.create(null);
  for (const e of entities) {
    if (!out[e.id]) out[e.id] = [];
    out[e.id].push(e);
  }
  return out;
}
