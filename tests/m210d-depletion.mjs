/**
 * m210d-depletion.mjs — Resource depletion + transform tests.
 *
 * Covers the v1.0.3 feature:
 *   - 4 new depletable resources (coal / gold_ore / gem_vein / tin_ore)
 *   - maxHarvests reached -> permanent depleted (no regrow)
 *   - depletedTransformsTo (gold_ore→rock, gem_vein→rock) in-place transform
 *   - Non-depletable resources are unaffected
 *   - Depleted entities are not picked by gather.findInRange
 *   - harvest() returns the new payload (harvestCount, maxHarvests, depleted, transformedTo)
 *
 * Run: node tests/m210d-depletion.mjs
 */
'use strict';

import {
  validateCatalog,
  allResources,
  allItems,
  isDepletable,
  getMaxHarvests,
  getDepletedTransformsTo
} from '../src/resources/catalog.js';

import { ResourceEntity } from '../src/resources/resource-entity.js';
import { Inventory }      from '../src/resources/inventory.js';
import { Gather }         from '../src/resources/gather.js';
import { InventoryService } from '../src/services/InventoryService.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}
function section(name) { console.log(`\n[${name}]`); }

// ============================================================
// §1 — catalog: 4 depletable resources
// ============================================================
section('catalog: 4 depletable mines resources');

const allR = allResources();
assert(allR.length === 23, `共 23 资源 (v1.0.4 + 6 三阶段) (实际 ${allR.length})`);
assert(validateCatalog() === true, 'validateCatalog 通过');

const newIds = ['coal', 'gold_ore', 'gem_vein', 'tin_ore'];
for (const id of newIds) {
  const r = allR.find(x => x.id === id);
  assert(r != null, `${id} 存在`);
  assert(isDepletable(id), `${id} 是 depletable`);
  assert(Number.isFinite(getMaxHarvests(id)), `${id} maxHarvests 有限`);
  assert(getMaxHarvests(id) >= 1, `${id} maxHarvests >= 1`);
  assert(r.biomes.includes('mines'), `${id} 在 mines 群系`);
  assert(r.regrowTime > 0, `${id} regrowTime > 0 (允许等 regrow 再采)`);
}

assert(!isDepletable('tree'), 'tree 不是 depletable');
assert(!isDepletable('rock'), 'rock 不是 depletable');
assert(!isDepletable('iron_ore'), 'iron_ore 不是 depletable (沿用 v1.0.1)');
assert(getMaxHarvests('tree') === Infinity, 'tree maxHarvests = Infinity');

// drops checks
const goldDef = allR.find(x => x.id === 'gold_ore');
assert(goldDef.drops.some(d => d.itemId === 'gold_nugget'), 'gold_ore 掉 gold_nugget');
const coalDef = allR.find(x => x.id === 'coal');
assert(coalDef.drops.some(d => d.itemId === 'coal'), 'coal 掉 coal');
const gemDef = allR.find(x => x.id === 'gem_vein');
assert(gemDef.drops.some(d => d.itemId === 'gem'), 'gem_vein 掉 gem');
const tinDef = allR.find(x => x.id === 'tin_ore');
assert(tinDef.drops.some(d => d.itemId === 'tin'), 'tin_ore 掉 tin');

// items checks
const allI = allItems();
assert(allI.length >= 23, `至少 23 物品 (v1.0.4 + 3 种子) (实际 ${allI.length})`);
for (const id of ['coal', 'gold_nugget', 'gem', 'tin']) {
  const it = allI.find(x => x.id === id);
  assert(it != null, `item ${id} 存在`);
  assert(it.category === 'material', `${id} 是 material`);
  assert(it.stackMax === 20, `${id} stackMax = 20`);
}

// transform targets
assert(getDepletedTransformsTo('gold_ore') === 'rock', 'gold_ore 枯竭后变 rock');
assert(getDepletedTransformsTo('gem_vein') === 'rock', 'gem_vein 枯竭后变 rock');
assert(getDepletedTransformsTo('coal') === null, 'coal 枯竭后不变身');
assert(getDepletedTransformsTo('tin_ore') === null, 'tin_ore 枯竭后不变身');

// ============================================================
// §2 — resource-entity: harvestCount + regrow flow
// ============================================================
section('resource-entity: harvest count and regrow semantics');

const entCoal1 = new ResourceEntity({ id: 'coal', x: 0, y: 0, size: 0.7, rngSeed: 42 });
assert(entCoal1.maxHarvests === 4, 'coal.maxHarvests = 4');
assert(entCoal1.harvestCount === 0, '初始 harvestCount = 0');
assert(!entCoal1.depleted, '初始 not depleted');

const invCoal1 = new Inventory();
const rCoal1 = entCoal1.harvest(invCoal1, 1000);
assert(rCoal1.harvestCount === 1, '第 1 采后 harvestCount = 1');
assert(rCoal1.maxHarvests === 4, '返回 maxHarvests = 4');
assert(rCoal1.depleted === true, '第 1 采后 depleted = true (regrowing)');
assert(entCoal1.depleted === true, '实体 depleted = true');
assert(entCoal1.regrowAt > 0, 'regrowAt 已设置');
assert(rCoal1.granted.length >= 1, 'granted 非空');

// tick regrow
entCoal1.update(entCoal1.regrowAt + 1);
assert(entCoal1.depleted === false, 'regrow 后 depleted = false');
assert(entCoal1.harvestCount === 1, 'regrow 后 harvestCount 保持 1');

// ============================================================
// §3 — depletion: 4 hits on coal -> permanent
// ============================================================
section('depletion: 4 hits on coal -> permanent depleted');

const entCoal2 = new ResourceEntity({ id: 'coal', x: 0, y: 0, rngSeed: 99 });
// regrowTime=180 (默认) — 每次采后等 regrow 才能再采
const invCoal2 = new Inventory();
for (let i = 0; i < 4; i++) {
  const r = entCoal2.harvest(invCoal2, 2000 + i);
  if (i < 3) {
    assert(r.harvestCount === i + 1, `第 ${i + 1} 采后 harvestCount = ${i + 1}`);
    assert(r.depleted === true, `第 ${i + 1} 采后 depleted = true (regrow 待 schedule)`);
    assert(entCoal2.regrowAt > 0, `第 ${i + 1} 采后 regrowAt > 0`);
    // 跳过 regrow
    entCoal2.update(entCoal2.regrowAt + 1);
    assert(!entCoal2.depleted, `第 ${i + 1} 采 regrow 后 not depleted`);
  } else {
    // 第 4 采,达到 maxHarvests
    assert(r.harvestCount === 4, `第 4 采后 harvestCount = 4`);
    assert(r.depleted === true, `第 4 采后 depleted = true`);
    assert(r.transformedTo === null, 'coal 不变身');
    assert(entCoal2.depleted === true, '实体 depleted = true');
    assert(entCoal2.regrowAt === 0, 'regrowAt = 0 (永久枯竭)');
  }
}

// 5th harvest should be a no-op
const invCoal2b = new Inventory();
const r5 = entCoal2.harvest(invCoal2b, 5000);
assert(r5.granted.length === 0, '枯竭后第 5 采 granted 为空');
assert(r5.depleted === true, '枯竭后 depleted 仍 true');
assert(r5.harvestCount === 4, '枯竭后 harvestCount 不再增加');

// ============================================================
// §4 — transform: gold_ore → rock after 2 harvests
// ============================================================
section('transform: gold_ore × 2 → rock');

const entGold = new ResourceEntity({ id: 'gold_ore', x: 5, y: 5, rngSeed: 7 });
assert(entGold.id === 'gold_ore', '初始 id = gold_ore');
assert(entGold.icon === 'gold_ore', '初始 icon = gold_ore');
assert(entGold.maxHarvests === 2, 'gold_ore maxHarvests = 2');

const invGold = new Inventory();
// 第 1 采
const rGold1 = entGold.harvest(invGold, 3000);
assert(rGold1.harvestCount === 1, 'gold 第 1 采 harvestCount = 1');
assert(rGold1.transformedTo === null, '第 1 采不触发 transform');
assert(rGold1.depleted === true, '第 1 采 depleted = true (regrow)');
assert(entGold.depleted === true, '实体 depleted = true');
assert(entGold.regrowAt > 0, 'regrow 已 schedule');

// 跳过 regrow
entGold.update(entGold.regrowAt + 1);
assert(!entGold.depleted, 'regrow 后 not depleted');
assert(entGold.harvestCount === 1, 'regrow 后 harvestCount 保持');

// 第 2 采 — 触发 transform
const rGold2 = entGold.harvest(invGold, 4000);
assert(rGold2.transformedTo === 'rock', 'transformedTo = rock');
assert(rGold2.depleted === true, 'transform 后实体 depleted (rock 有 regrowTime=240)');
assert(rGold2.harvestCount === 0, 'transform 后 harvestCount 重置为 0 (新资源,未采)');
assert(entGold.id === 'rock', '实体 id 变为 rock');
assert(entGold.icon === 'rock', '实体 icon 变为 rock');
assert(entGold.maxHarvests === Infinity, 'rock 不是 depletable (maxHarvests = Infinity)');
assert(entGold.harvestCount === 0, 'transform 后 harvestCount 已被 _loadDef 重置');
assert(entGold.depleted === true, 'transform 后实体处于 regrowing 状态 (rock 有 regrowTime)');
assert(entGold.regrowAt > 0, 'transform 后 regrowAt > 0 (rock 会 regrow)');

// 等 rock regrow
entGold.update(entGold.regrowAt + 1);
assert(!entGold.depleted, 'rock regrow 后 not depleted');

// 继续采 rock,应该走 regrow 流程
const rGold3 = entGold.harvest(invGold, 5000);
assert(rGold3.harvestCount === 1, 'rock 第 1 采 harvestCount = 1');
assert(rGold3.depleted === true, 'rock 第 1 采 depleted = true (regrow)');
assert(rGold3.transformedTo === null, 'rock 不再 transform');

// ============================================================
// §5 — transform: gem_vein → rock after 1 harvest
// ============================================================
section('transform: gem_vein × 1 → rock');

const entGem = new ResourceEntity({ id: 'gem_vein', x: 10, y: 10, rngSeed: 13 });
assert(entGem.maxHarvests === 1, 'gem_vein maxHarvests = 1');

const invGem = new Inventory();
const rGem = entGem.harvest(invGem, 6000);
assert(rGem.transformedTo === 'rock', 'gem_vein 立即 transform 到 rock');
assert(rGem.harvestCount === 0, 'gem transform 后 harvestCount = 0 (新资源)');
assert(entGem.id === 'rock', '实体变 rock');
assert(entGem.maxHarvests === Infinity, 'rock 不枯竭');

// ============================================================
// §6 — non-depletable still regrows forever
// ============================================================
section('non-depletable: rock still regrows forever');
// v1.0.4: tree is now growth-capable, so it can no longer serve as the
// "non-depletable" exemplar. Use rock (non-depletable, non-growth-capable,
// regrowTime=120) instead.

const entRock = new ResourceEntity({ id: 'rock', x: 20, y: 20, rngSeed: 21, now: 0 });
assert(!entRock.isDepletable, 'rock isDepletable = false');
assert(!entRock.isGrowthCapable, 'rock isGrowthCapable = false');
assert(entRock.maxHarvests === Infinity, 'rock.maxHarvests = Infinity');

const invRock = new Inventory();
for (let i = 0; i < 5; i++) {
  const r = entRock.harvest(invRock, 7000 + i * 1000);
  assert(r.harvestCount === i + 1, `rock 第 ${i + 1} 采 harvestCount = ${i + 1}`);
  assert(r.maxHarvests === Infinity, `rock 第 ${i + 1} 采 maxHarvests = Infinity`);
  assert(r.depleted === true, `rock 第 ${i + 1} 采 payload depleted = true (mid-regrow)`);
  assert(r.transformedTo === null, `rock 第 ${i + 1} 采不 transform`);
  assert(entRock.depleted === true, `rock 第 ${i + 1} 采后 entity depleted (mid-regrow)`);
  entRock.update(entRock.regrowAt + 1);
  assert(!entRock.depleted, `rock regrow ${i + 1} 后 not depleted`);
  assert(entRock.id === 'rock', `rock id 保持不变 (${i + 1})`);
}

// §6b — growth-capable entity behavior (v1.0.4+)
section('growth-capable: tree harvest resets to stage 0 with harvested-stage regrowTime');
const entTree = new ResourceEntity({ id: 'tree', x: 21, y: 21, rngSeed: 22, now: 0 });
assert(entTree.isGrowthCapable, 'tree isGrowthCapable = true');
assert(entTree.currentStageIndex === 0, 'tree init at stage 0 (tree_sprout)');
entTree.update(31 * 1000);   // advance to stage 1
assert(entTree.currentStageIndex === 1, 'tree advanced to stage 1');
const rT1 = entTree.harvest(new Inventory(), 32 * 1000);
assert(rT1.growthReset, 'tree stage 1 harvest growthReset=true');
assert(entTree.currentStageIndex === 0, 'tree reset to stage 0 after harvest');
assert(entTree.id === 'tree_sprout', 'tree id reset to tree_sprout');
assert(entTree._rootId === 'tree', 'tree rootId unchanged');
assert(entTree.depleted === true, 'tree depleted for 60s (harvested stage 1 regrowTime)');
assert(entTree.regrowAt === 32 * 1000 + 60 * 1000, 'tree regrowAt = harvestTime + 60s');

// ============================================================
// §7 — gather integration: depleted entities skipped
// ============================================================
section('gather integration: depleted entities skipped');

// 用 regrowTime=0 + depletable 测试永久枯竭
const entCoal3 = new ResourceEntity({ id: 'coal', x: 5, y: 0, rngSeed: 3 });
entCoal3.regrowTime = 0;
const gather2 = new Gather({
  entities: [entCoal3],
  invSvc: new InventoryService({ inventory: new Inventory() }),
  selectedItemProvider: () => 'pickaxe',
  onEvent: () => {}
});

// 第 1 采:depleted=true, regrowAt=0(因 regrowTime=0)
gather2.click(5, 0);
gather2.update({ x: 5, y: 0 }, entCoal3.harvestTime + 0.1, 10000);
if (gather2.state === 'just_done') {
  gather2.state = 'idle';
}
assert(entCoal3.depleted === true, 'coal3 第 1 采后 depleted');
assert(entCoal3.regrowAt === 0, 'coal3 regrowAt = 0 (regrowTime=0)');
assert(entCoal3.harvestCount === 1, 'coal3 harvestCount = 1');

// 继续采 3 次,因已 depleted,应都被 no-op
for (let i = 0; i < 3; i++) {
  gather2.click(5, 0);
  if (gather2.target != null) {
    gather2.update({ x: 5, y: 0 }, entCoal3.harvestTime + 0.1, 11000 + i);
  } else {
    // target 是 null,因为 findInRange 跳过了 depleted 实体
  }
  if (gather2.state === 'just_done') {
    gather2.state = 'idle';
  }
}
assert(entCoal3.depleted === true, 'coal3 永久枯竭');
assert(entCoal3.regrowAt === 0, 'coal3 regrowAt = 0');

// findInRange 不应找到枯竭实体
const found = gather2.findInRange(5, 0);
assert(found === null, 'findInRange 不返回枯竭实体');

// ============================================================
// §8 — catalog validation: edge cases
// ============================================================
section('catalog validation: edge cases');

assert(getDepletedTransformsTo('nonexistent') === null, '未知 id 的 transform = null');
assert(getMaxHarvests('nonexistent') === Infinity, '未知 id 的 maxHarvests = Infinity');
assert(isDepletable('nonexistent') === false, '未知 id 不 depletable');

// ============================================================
// §9 — payload shape (gather complete event)
// ============================================================
section('gather complete event payload');

const entTin = new ResourceEntity({ id: 'tin_ore', x: 0, y: 0, rngSeed: 5 });
const invTin = new Inventory();
const completed = [];
const gather3 = new Gather({
  entities: [entTin],
  invSvc: new InventoryService({ inventory: invTin }),
  selectedItemProvider: () => 'pickaxe',
  onEvent: (name, payload) => { if (name === 'complete') completed.push(payload); }
});
gather3.click(0, 0);
gather3.update({ x: 0, y: 0 }, entTin.harvestTime + 0.1, 12000);
assert(completed.length === 1, '1 个 complete 事件');
const c = completed[0];
// v0.6.0b: gather emits { entity, loot, regrowAt, toolUsed, toolStatus }.
// Harvest metadata (harvestCount / maxHarvests / depleted / transformedTo)
// is reachable via the entity and via c.entity.id staying 'tin_ore'
// (no transform for tin).
assert(c.entity.harvestCount === 1, 'payload 含 harvestCount (via c.entity)');
assert(c.entity.maxHarvests === 3, 'payload 含 maxHarvests (tin=3) (via c.entity)');
assert(c.entity.depleted === true, 'payload 含 depleted (via c.entity)');
assert(c.entity.id === 'tin_ore', 'payload 含 transformedTo (无变身: c.entity.id 保持 tin_ore)');

// ============================================================
// §10 — summary
// ============================================================
console.log(`\n=== ${passed} passed / ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
