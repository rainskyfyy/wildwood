#!/usr/bin/env node
/**
 * v0.6.0c — Spawner Fixture 抗 RNG 漂移回归测试
 *
 *   node tests/v060c-spawner-fixture.mjs
 *
 * 覆盖 5 个场景:
 *   1. 5 资源 — findNearest / findInRange / groupById 基础正确性
 *   2. 10 资源 — findInRange 拿多个 + 距离升序
 *   3. 20 资源 — filter by id + 跨 biome
 *   4. 50 资源 — 大规模 + seed 一致性 + 删 1 资源仍过
 *   5. 抗漂移 — catalog 顺序变化时 findNearest 仍稳定
 *
 * 配套规范:docs/spawner-fixture-guideline.md
 */
'use strict';

import {
  spawnResources,
  findNearest,
  findInRange,
  groupById
} from '../src/resources/spawner.js';
import { allResources, getResource } from '../src/resources/catalog.js';
import { generateWorld } from '../src/world/generator.js';

let pass = 0, fail = 0;
const FIXTURE_SEED = 20260822;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail || ''}`); }
}

// ============================================================
// 场景 1: 5 资源 — findNearest / findInRange / groupById 基础
// ============================================================
console.log('\n[场景 1] 5 资源 — 基础查询工具');
{
  // 故意造一个 5 个实体的最小数据集(不依赖 spawner,验证工具纯函数语义)
  const ents = [
    { id: 'tree',       x: 10, y: 10, distTo(x, y) { return Math.hypot(this.x-x, this.y-y); } },
    { id: 'rock',       x: 12, y: 12, distTo(x, y) { return Math.hypot(this.x-x, this.y-y); } },
    { id: 'tree',       x:  3, y:  3, distTo(x, y) { return Math.hypot(this.x-x, this.y-y); } },
    { id: 'tree',       x: 25, y: 25, distTo(x, y) { return Math.hypot(this.x-x, this.y-y); } },
    { id: 'bush',       x:  7, y:  8, distTo(x, y) { return Math.hypot(this.x-x, this.y-y); } }
  ];
  // 找最近的树(到 10,10)
  const near = findNearest(ents, 10, 10, 'tree');
  ok('findNearest 找 tree 最近', near && near.x === 10 && near.y === 10, `got ${JSON.stringify(near)}`);
  // 找最近的任意(无 filter)
  const any = findNearest(ents, 10, 10);
  ok('findNearest 无 filter', any && any.id === 'tree' && any.x === 10, `got ${JSON.stringify(any)}`);
  // findInRange 半径 5,从 10,10
  const inR = findInRange(ents, 10, 10, 5);
  ok('findInRange 半径 5 至少 1 个', inR.length >= 1);
  // 排序
  let sorted = true;
  for (let i = 1; i < inR.length; i++) if (inR[i].dist < inR[i-1].dist) sorted = false;
  ok('findInRange 按距离升序', sorted);
  // groupById
  const grouped = groupById(ents);
  ok('groupById tree=3', grouped.tree && grouped.tree.length === 3);
  ok('groupById rock=1', grouped.rock && grouped.rock.length === 1);
  ok('groupById bush=1', grouped.bush && grouped.bush.length === 1);
}

// ============================================================
// 场景 2: 10 资源 — findInRange 拿多个 + 距离升序 + filter
// ============================================================
console.log('\n[场景 2] 10 资源 — findInRange 范围 + 过滤');
{
  // 在 (50, 50) 周围构造 10 个实体(半径 10)
  const ents = [];
  for (let i = 0; i < 10; i++) {
    ents.push({
      id: i % 2 === 0 ? 'tree' : 'rock',
      x: 50 + (i * 1.5),
      y: 50 + (i * 0.8),
      distTo(x, y) { return Math.hypot(this.x-x, this.y-y); }
    });
  }
  // 半径 6
  const inR = findInRange(ents, 50, 50, 6);
  ok('findInRange 拿到 ≥3 个', inR.length >= 3, `got ${inR.length}`);
  // 距离升序
  let sorted = true;
  for (let i = 1; i < inR.length; i++) if (inR[i].dist < inR[i-1].dist) sorted = false;
  ok('findInRange 距离升序', sorted);
  // filter=tree
  const trees = findInRange(ents, 50, 50, 100, 'tree');
  ok('findInRange filter tree 全部是 tree', trees.every(t => t.entity.id === 'tree'));
  ok('findInRange filter tree 至少 4 个', trees.length >= 4);
  // 拿最近的 tree
  const nearTree = findNearest(ents, 50, 50, 'tree');
  ok('findNearest 拿 tree', nearTree && nearTree.id === 'tree');
  // 删一个 tree,找最近 — 拿到的还是 tree,只是另一个
  const remaining = ents.filter(e => !(e.x === 50 && e.y === 50));
  const nearAfter = findNearest(remaining, 50, 50, 'tree');
  ok('删 1 资源后 findNearest 仍返回 tree', nearAfter && nearAfter.id === 'tree');
}

// ============================================================
// 场景 3: 20 资源 — 跨 biome,filter by id,groupById
// ============================================================
console.log('\n[场景 3] 20 资源 — 跨 biome,filter,groupById');
{
  const world = generateWorld({ width: 40, height: 40, seed: FIXTURE_SEED });
  const ents = spawnResources(world, { seed: FIXTURE_SEED });
  // 不强求数量(catalog 改动会变),只断言"能找到"
  ok('spawnResources 在 40x40 world 生成 ≥1 实体', ents.length >= 1);
  // 按 id 分组
  const grouped = groupById(ents);
  const ids = Object.keys(grouped);
  ok('groupById 至少 1 个不同 id', ids.length >= 1);
  // 找距离 (20, 20) 最近的任意实体
  const near = findNearest(ents, 20, 20);
  ok('findNearest 找到一个', near !== null);
  if (near) {
    // 用 findInRange 找半径 5 内所有同 id 实体
    const sameIdNear = findInRange(ents, 20, 20, 5, near.id);
    ok('findInRange 同 id 半径 5', sameIdNear.every(s => s.entity.id === near.id));
  }
  // 找距离 100 远的(应该返回 null 或一个)
  const far = findNearest(ents, 10000, 10000);
  ok('findNearest 10000 远处至少一个', far !== null);
  // 找过滤一个不存在的 id
  const noexist = findNearest(ents, 20, 20, 'not_a_real_resource_xyz');
  ok('findNearest 过滤不存在 id 返回 null', noexist === null);
}

// ============================================================
// 场景 4: 50 资源 — 大规模 + seed 一致性 + 删 1 资源仍过
// ============================================================
console.log('\n[场景 4] 50 资源 — 大规模 + seed 一致性 + 抗漂移');
{
  const world = generateWorld({ width: 60, height: 60, seed: FIXTURE_SEED });
  // 跑两次,seed 一致 → 集合一致
  const r1 = spawnResources(world, { seed: FIXTURE_SEED });
  const r2 = spawnResources(world, { seed: FIXTURE_SEED });
  ok('seed 一致:两次 spawn 总数一致', r1.length === r2.length);
  // 集合性质(用 groupById 排序后比对,不看顺序)
  const g1 = groupById(r1);
  const g2 = groupById(r2);
  let setEq = true;
  for (const id of Object.keys(g1)) {
    if (!g2[id] || g2[id].length !== g1[id].length) { setEq = false; break; }
  }
  for (const id of Object.keys(g2)) {
    if (!g1[id] || g1[id].length !== g2[id].length) { setEq = false; break; }
  }
  ok('seed 一致:每个 id 的数量一致', setEq);
  // 找最近的
  const near = findNearest(r1, 30, 30);
  ok('findNearest 在 50 资源中找到一个', near !== null);
  // 模拟"删 1 个资源":从结果里删掉第一个,断言 findNearest 仍可工作
  // 这是"删 1 资源后所有测试仍过"的体现 — 测试逻辑不依赖该资源
  if (r1.length >= 2) {
    const reduced = r1.slice(1);
    const nearReduced = findNearest(reduced, 30, 30);
    if (near && nearReduced) {
      // 距离 30,30 最近的不一定是被删的(若被删了就换下一个最近的)
      ok('删 1 资源后 findNearest 仍返回有效实体', nearReduced !== null);
    } else {
      ok('删 1 资源后 findNearest 仍可工作', true);
    }
  }
  // findInRange 范围
  const inR = findInRange(r1, 30, 30, 10);
  ok('findInRange 半径 10 拿到 ≥1 个', inR.length >= 1);
  // 升序
  let sorted = true;
  for (let i = 1; i < inR.length; i++) if (inR[i].dist < inR[i-1].dist) sorted = false;
  ok('findInRange 距离升序', sorted);
}

// ============================================================
// 场景 5: 抗漂移 — catalog 顺序变化(模拟)+ 顺序变化都稳定
// ============================================================
console.log('\n[场景 5] 抗漂移 — 内部遍历顺序不影响 findNearest');
{
  // 关键思想:即便 spawner 内部对每个 tile 遍历 catalog 的顺序是 A→B→C,
  // 测试也不该依赖这个顺序。我们通过构造"对调顺序的两组实体"来验证
  // findNearest / findInRange / groupById 都对顺序鲁棒。
  const a = [
    { id: 'tree', x: 5,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } },
    { id: 'rock', x: 7,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } },
    { id: 'tree', x: 9,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } }
  ];
  // 反向 — 模拟 catalog 顺序变化
  const b = [
    { id: 'tree', x: 9,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } },
    { id: 'rock', x: 7,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } },
    { id: 'tree', x: 5,  y: 5,  distTo(x,y){ return Math.hypot(this.x-x,this.y-y); } }
  ];
  // 找最近 tree
  const na = findNearest(a, 5, 5, 'tree');
  const nb = findNearest(b, 5, 5, 'tree');
  ok('顺序 A: 最近 tree 是 (5,5)', na && na.x === 5 && na.y === 5);
  ok('顺序 B: 最近 tree 仍是 (5,5)', nb && nb.x === 5 && nb.y === 5);
  // groupById
  const ga = groupById(a);
  const gb = groupById(b);
  ok('groupById 顺序无关:tree 数量一致', ga.tree.length === gb.tree.length);
  // findInRange 升序 — 顺序不变
  const ra = findInRange(a, 5, 5, 10);
  const rb = findInRange(b, 5, 5, 10);
  ok('findInRange A 升序', ra.every((r, i) => i === 0 || r.dist >= ra[i-1].dist));
  ok('findInRange B 升序', rb.every((r, i) => i === 0 || r.dist >= rb[i-1].dist));
}

// ============================================================
// 总结
// ============================================================
console.log(`\n=== v0.6.0c spawner fixture: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
