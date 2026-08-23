#!/usr/bin/env node
/**
 * tools/__demo__/fixture-drift-demo.mjs
 *
 * 演示 fixture 抗漂移 CI check 检测的 4 类反模式 + 正确写法。
 *
 * 用法:
 *   node tools/check-fixture-drift.mjs tools/__demo__/fixture-drift-demo.mjs
 *   node tools/check-fixture-drift.mjs tools/__demo__/
 *
 * 期望:5 个 AP-001/002/003/004 finding,正确写法不报。
 */

import { spawnResources } from '../../src/resources/spawner.js';
import { findNearest, findInRange, groupById } from '../../src/resources/spawner.js';

// ── BAD:AP-001 ─ find() 谓词里带 distTo ─────────────────────
// M2.10c 踩过这个:catalog 改一个资源,find 拿到的不是"最近的",
// 而是"spawn 数组里第一个且在范围内的"。测试静默失效。
const gent = spawnResources(world, { seed: 20260822 });
const target = gent.find(e => e.id === 'tree' && e.distTo(0, 0) < 30);

// ── BAD:AP-002 ─ find() 后直接 [0] ─────────────────────────
// Array.prototype.find() 返回单元素,不是数组。
// [0] 取的是该元素对象的第一个属性 — 类型错或读错字段。
const near = gent.find(e => e.id === 'tree')[0];

// ── BAD:AP-003 ─ filter() 后 [0] ───────────────────────────
// filter 保留 spawn 顺序,[0] 拿的是 spawn 第一个,无语义。
const firstTree = gent.filter(e => e.id === 'tree')[0];

// ── BAD:AP-004 ─ spawner 输出直接 [N] ───────────────────────
// 直接假设 spawn 顺序,跨 catalog 改动无稳定性。
const alsoFirst = gent[0];

// ── GOOD:正确写法(不触发任何 finding) ─────────────────────
// 1. 找最近 — 用 findNearest
const nearest = findNearest(gent, 0, 0, 'tree');

// 2. 范围 + 升序 — 用 findInRange
const nearby = findInRange(gent, 0, 0, 30, 'tree');

// 3. 按 id 分组 — 用 groupById
const grouped = groupById(gent);
const treeCount = (grouped.tree || []).length;

// 4. filter + sort + [0]  — GOOD,sort 后下标有语义
const trees = gent.filter(e => e.id === 'tree');
trees.sort((a, b) => a.distTo(0, 0) - b.distTo(0, 0));
const closest = trees[0];                  // GOOD:sort 后的 [0]
const secondClosest = trees[1];            // GOOD:sort 后的 [1]

// 5. existence check — bare find 不带 distTo,OK
const hasTree = gent.find(e => e.id === 'tree');
if (hasTree) console.log('has tree');
