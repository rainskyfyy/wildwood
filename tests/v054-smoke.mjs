/**
 * v0.5.4 NPC 村落 + 交易 + 随从 — 单元测试
 *
 * 覆盖:
 *   - piglin / village: 村庄生成、猪屋分布、状态机
 *   - price-engine: 价格浮动(供需)
 *   - trader: 交易执行
 *   - follower: 招募、寻路、战斗
 *
 * 全部用纯 Node 环境运行,无 jsdom。
 */
'use strict';
import { generateVillage, VILLAGE_CONFIG, buildingAt, traderBuilding } from '../src/npc/village.js';
import { Piglin, PiglinState, PIGLIN_CONST } from '../src/npc/piglin.js';
import {
  newTradeState, traderStock, stockFor, priceMultiplier,
  quote, applyTrade, setScarcity, previewMultiplier
} from '../src/trading/price-engine.js';
import { preview, execute, availableOffers } from '../src/trading/trader.js';
import { Follower, MAX_FOLLOWERS } from '../src/follower/follower.js';
import { FollowerManager } from '../src/follower/follower-manager.js';
import { InventoryService } from '../src/services/InventoryService.js';

// ── 假世界(只覆盖 isWalkable + getTile + width/height)─────────────
function makeWorld(opts = {}) {
  const W = opts.width || 80;
  const H = opts.height || 60;
  const seed = opts.seed || 20260822;
  // 默认全部可走;挑一些位置设置为 'forest'
  const tiles = new Array(W * H).fill('plains');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 中间放一片森林,让 village 能找到
      if (x >= 20 && x < 60 && y >= 15 && y < 45) tiles[y * W + x] = 'forest';
    }
  }
  return {
    width: W,
    height: H,
    seed,
    getTile(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return tiles[y * W + x];
    },
    isWalkable(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      // 留出边缘 2 圈
      if (x < 2 || y < 2 || x > W - 3 || y > H - 3) return false;
      const t = tiles[y * W + x];
      return t != null;  // all defined biomes are walkable in this fake
    },
    idx(x, y) { return y * W + x; }
  };
}

// 假 inventory(v0.6.0b InventoryService 单向接口)
//   - trader API 现在要求 ctx.invSvc(InventoryService 实例)
//   - 用真实 InventoryService 包装空 Inventory,而不是手写 mock
//   - 测试通过 inv.countOf / inv.addItem / { invSvc: inv, state } 跟 trader 交互
function makeInventory() {
  const svc = new InventoryService();
  // 跟旧手写 mock 一致:log x8, twine x4, stone x6, berries x3, carrot x5, mushroom x2
  // 这些是「交易前玩家 bag 内的标准库存」,很多 group 依赖 (e.g. "1:1 交易 log 总数不变")
  svc.addItem('log',      8);
  svc.addItem('twine',    4);
  svc.addItem('stone',    6);
  svc.addItem('berries',  3);
  svc.addItem('carrot',   5);
  svc.addItem('mushroom', 2);
  return svc;
}

// ── Test helpers ──────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.error('✗', label); }
}
function eq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { pass++; }
  else { fail++; failures.push(label); console.error('✗', label, 'expected', b, 'got', a); }
}
function group(name, fn) {
  console.log(`\n[${name}]`);
  fn();
}

// ── Tests ─────────────────────────────────────────────────────────
group('village: 生成村庄', () => {
  const world = makeWorld();
  const v = generateVillage(world, { seed: 1, preferredBiome: 'forest' });
  assert(v.piglins.length >= 3 && v.piglins.length <= 5, '猪人数量在 3-5 之间');
  assert(v.buildings.length === v.piglins.length + 1, '建筑数 = 猪人数 + 1(交易中心)');
  assert(v.buildings.some(b => b.kind === 'trader'), '存在交易中心');
  assert(v.buildings.filter(b => b.kind === 'house').length === v.piglins.length, '每个猪人对应一栋猪屋');
  assert(v.origin != null, '找到了 origin');
  // 猪屋是 2x2
  for (const b of v.buildings) {
    if (b.kind === 'house') {
      assert(b.w === 2 && b.h === 2, '猪屋是 2x2');
    }
  }
});

group('village: 村庄都在森林群系内', () => {
  const world = makeWorld();
  const v = generateVillage(world, { seed: 1, preferredBiome: 'forest' });
  if (v.origin) {
    // origin 所在 7x7 区域全部应是 forest
    let allForest = true;
    for (let dy = 0; dy < VILLAGE_CONFIG.PLAZA_SIZE; dy++) {
      for (let dx = 0; dx < VILLAGE_CONFIG.PLAZA_SIZE; dx++) {
        if (world.getTile(v.origin.x + dx, v.origin.y + dy) !== 'forest') {
          allForest = false; break;
        }
      }
    }
    assert(allForest, '7x7 plaza 全部在 forest 内');
  }
});

group('village: 确定性(同 seed 同结果)', () => {
  const world1 = makeWorld();
  const world2 = makeWorld();
  const a = generateVillage(world1, { seed: 42, preferredBiome: 'forest' });
  const b = generateVillage(world2, { seed: 42, preferredBiome: 'forest' });
  eq(a.origin, b.origin, '相同 seed 产生相同 origin');
  eq(a.piglins.length, b.piglins.length, '相同 seed 产生相同猪人数量');
});

group('village: 没有可走森林时不生成', () => {
  const W = 30, H = 30;
  // 全部沙漠,无森林 — village 不应生成
  const world = {
    width: W, height: H, seed: 1,
    getTile() { return 'plains'; },
    isWalkable(x, y) {
      return x >= 0 && y >= 0 && x < W && y < H;
    },
    idx(x, y) { return y * W + x; }
  };
  const v = generateVillage(world, { seed: 1, preferredBiome: 'forest' });
  eq(v.piglins.length, 0, '没有森林时 village 不生成猪人');
  eq(v.buildings.length, 0, '没有森林时不生成建筑');
});

group('piglin: 状态机', () => {
  const world = makeWorld();
  const p = new Piglin({
    typeId: 'piglin',
    config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
              houseWidth: 2, houseHeight: 2,
              greetingLines: ['hi'], feedingThanks: ['yum'],
              followAccept: ['ok'] },
    world, x: 30, y: 25,
    seed: 7,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  eq(p.state, PiglinState.SLEEP, '初始状态 = SLEEP');
  p.update(0.1, { isDay: true });
  eq(p.state, PiglinState.WANDER, 'isDay 时变 WANDER');
  p.update(0.1, { isDay: false });
  eq(p.state, PiglinState.SLEEP, 'isDay=false 时回 SLEEP');
});

group('piglin: 喂食增加好感度', () => {
  const world = makeWorld();
  const p = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 25, seed: 1,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  eq(p.affection, 0, '初始好感 0');
  assert(p.feed('berries') === true, 'berries 喂食成功');
  eq(p.affection, 1, '好感 +1');
  assert(p.feed('carrot') === true, 'carrot 喂食成功');
  eq(p.affection, 2, '好感 +1');
  assert(p.feed('log') === false, '非食物(log)不接受');
  eq(p.affection, 2, 'log 不增加好感');
  assert(p.feed('mushroom') === true, 'mushroom 喂食成功');
  eq(p.affection, 3, '好感 +1,达到上限');
  assert(p.feed('berries') === false, '已满不再接受');
  assert(p.isRecruitable(), '3 颗心后可招募');
});

group('piglin: 3 命上限,死亡掉落', () => {
  const world = makeWorld();
  const p = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 25, seed: 1,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  assert(p.damage(1).length === 0, '扣 1 命未死');
  assert(p.damage(1).length === 0, '再扣 1 命未死');
  const loot = p.damage(1);
  assert(loot.length >= 1, '扣第 3 命死亡,掉落物品');
  assert(p.state === PiglinState.DEAD, '状态变 DEAD');
  assert(p.isAlive() === false, 'isAlive() === false');
});

group('price-engine: 基础价格', () => {
  const s = newTradeState();
  const mult = priceMultiplier('log', s);
  assert(mult >= 0.95 && mult <= 1.05, '无交易历史时 mult ≈ 1.0');
  eq(priceMultiplier('unknown', s), 0, '未知物品 mult = 0');
  const q = quote('log', 4, s);
  assert(q && q.buyCount === 4, '4 个木头换 4 个木头 (1:1 基础)');
});

group('price-engine: 多次同种交易后价格递减', () => {
  const s = newTradeState();
  applyTrade(s, 'carrot', 1);
  applyTrade(s, 'carrot', 1);
  applyTrade(s, 'carrot', 1);
  const m = priceMultiplier('carrot', s);
  assert(m < 1.0, '3 次交易后 carrot mult < 1.0');
  assert(m >= 0.6, 'mult 不会跌破 0.6');
});

group('price-engine: 卖出物品越多价格越低', () => {
  const s1 = newTradeState();
  const s10 = newTradeState();
  for (let i = 0; i < 10; i++) applyTrade(s10, 'log', 1);
  const m1 = priceMultiplier('log', s1);
  const m10 = priceMultiplier('log', s10);
  assert(m10 < m1, '10 次交易后 mult 比 0 次低');
});

group('price-engine: scarcity 影响', () => {
  const s = newTradeState();
  setScarcity(s, 'berries', 0);
  const m0 = priceMultiplier('carrot', s);
  setScarcity(s, 'berries', 10);
  const m10 = priceMultiplier('carrot', s);
  assert(m0 > m10, '玩家 bag 缺 berries 时 mult 更高(刺激交易)');
});

group('trader: 交易执行(1:1)', () => {
  const inv = makeInventory();
  const state = newTradeState();
  const r = execute('log', 2, { invSvc: inv, state });
  assert(r.ok, '交易成功');
  eq(r.buyItem, 'log', '木头换木头(1:1)');
  // 1:1 交易:移除 2 log 后再加 2 log,总数不变
  eq(inv.countOf('log'), 8, '1:1 交易 log 总数不变');
  eq(r.buyCount, 2, 'buyCount = 2');
});

group('trader: 不等价比率', () => {
  // 2 carrot = 1 berry(基础)
  const inv = makeInventory();
  const state = newTradeState();
  const r = execute('carrot', 4, { invSvc: inv, state });
  assert(r.ok, '交易成功');
  eq(r.buyItem, 'berries', 'carrot 换 berries');
  // 第一次交易 mult 应接近 1.0+scarcity,至少 1
  assert(r.buyCount >= 1, 'buyCount >= 1');
  // 4 carrot 移除
  const r2 = execute('carrot', 1, { invSvc: inv, state });
  assert(r2.ok, '再交易 1 carrot 成功');
});

group('trader: 物品不足时拒绝', () => {
  const inv = makeInventory();
  const state = newTradeState();
  const r = execute('mushroom', 99, { invSvc: inv, state });
  assert(r.ok === false, '物品不足时交易失败');
  eq(r.reason, 'insufficient', '拒绝原因 = insufficient');
});

group('trader: 不可交易物品拒绝', () => {
  const inv = makeInventory();
  inv.addItem('petals', 5);
  // 先尝试 petals —— 但 'petals' 在 stockFor 里有,所以会执行
  // 改成不可交易的物品
  inv.addItem('torch', 1);
  const state = newTradeState();
  const r = execute('torch', 1, { invSvc: inv, state });
  assert(r.ok === false, 'torch 不被接受');
  eq(r.reason, 'not_in_stock', '拒绝原因 = not_in_stock');
});

group('trader: 多次交易后 buy count 递减', () => {
  const inv = makeInventory();
  inv.addItem('carrot', 30);
  const state = newTradeState();
  // 第一次 2 carrot → 1 berry
  const r1 = execute('carrot', 2, { invSvc: inv, state });
  assert(r1.ok && r1.buyCount >= 1, '第一次交易 buy >= 1');
  // 多次交易后 mult 下降,但因为 floor(2*1*0.85)=1 还能换
  for (let i = 0; i < 6; i++) execute('carrot', 2, { invSvc: inv, state });
  const r2 = execute('carrot', 2, { invSvc: inv, state });
  assert(r2.ok, '后续交易仍能执行');
  assert(r2.multiplier < 1.0, 'mult 已下降');
});

group('trader: availableOffers 过滤', () => {
  const inv = makeInventory();
  const offers = availableOffers(inv);
  assert(offers.includes('log'), 'log 在 offer 列表');
  assert(offers.includes('carrot'), 'carrot 在 offer 列表');
  // 假定 pet/torch/iron_ore 不在玩家 inventory 里
  assert(!offers.includes('iron_ore'), 'iron_ore 不在(玩家没有)');
});

group('follower: 招募限制 1 个', () => {
  const world = makeWorld();
  const player = { x: 40, y: 30 };
  const fm = new FollowerManager({ world, player, getMonsters: () => [] });
  const pig1 = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 25, seed: 1,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  pig1.affection = 3;
  const pig2 = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 35, y: 25, seed: 2,
    houseTiles: { x: 35, y: 25, w: 2, h: 2 }
  });
  pig2.affection = 3;
  const f1 = fm.recruit(pig1);
  assert(f1 != null, '第一个招募成功');
  const f2 = fm.recruit(pig2);
  assert(f2 == null, '第二个招募失败(已满)');
});

group('follower: 没满 3 颗心不能招募', () => {
  const world = makeWorld();
  const player = { x: 40, y: 30 };
  const fm = new FollowerManager({ world, player, getMonsters: () => [] });
  const pig = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 25, seed: 1,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  pig.affection = 2;  // only 2 hearts
  const f = fm.recruit(pig);
  assert(f == null, '2 颗心不能招募');
});

group('follower: 死亡清空 slot', () => {
  const world = makeWorld();
  const player = { x: 40, y: 30 };
  const fm = new FollowerManager({ world, player, getMonsters: () => [] });
  const pig = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 25, seed: 1,
    houseTiles: { x: 30, y: 25, w: 2, h: 2 }
  });
  pig.affection = 3;
  const f = fm.recruit(pig);
  const loot = fm.damageFollower(3);
  assert(loot.length >= 1, '死亡掉落物品');
  assert(fm.current() == null, 'slot 已清空');
  assert(pig.affection === 0, '原 piglin 好感清零');
});

group('follower: 寻路跟随玩家', () => {
  const world = makeWorld();
  const player = { x: 50, y: 30 };
  const fm = new FollowerManager({ world, player, getMonsters: () => [] });
  const pig = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 30, y: 30, seed: 1,
    houseTiles: { x: 30, y: 30, w: 2, h: 2 }
  });
  pig.affection = 3;
  const f = fm.recruit(pig);
  // 多帧更新,follower 应该会朝 player 移动
  const x0 = f.x, y0 = f.y;
  for (let i = 0; i < 30; i++) {
    fm.update(0.1);
  }
  const dx = f.x - x0, dy = f.y - y0;
  assert(Math.abs(dx) > 5 || Math.abs(dy) > 0, `follower 移动了 dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  // 应在玩家附近(放宽到 8,因为 A* 路径可能略有绕路)
  const d = Math.hypot(f.x - player.x, f.y - player.y);
  assert(d < 8, `最终距离 player = ${d.toFixed(2)} < 8`);
});

group('follower: 战斗中协助玩家', () => {
  const world = makeWorld();
  const player = { x: 40, y: 30 };
  // 假怪物
  const monsters = [{
    x: 42, y: 30, hp: 3, maxHp: 3, state: 'idle',
    damage(by) { this.hp -= by; }
  }];
  const fm = new FollowerManager({ world, player, getMonsters: () => monsters });
  const pig = new Piglin({
    typeId: 'piglin', config: { hp: 3, walkSpeed: 2.2, color: '#c87a8a',
                                houseWidth: 2, houseHeight: 2,
                                greetingLines: [], feedingThanks: [],
                                followAccept: [] },
    world, x: 38, y: 30, seed: 1,
    houseTiles: { x: 38, y: 30, w: 2, h: 2 }
  });
  pig.affection = 3;
  const f = fm.recruit(pig);
  // 多帧让 follower 攻击
  const hp0 = monsters[0].hp;
  for (let i = 0; i < 30; i++) {
    fm.update(0.2);
  }
  assert(monsters[0].hp < hp0, `怪物 hp 下降: ${hp0} → ${monsters[0].hp}`);
});

group('follower: 跟随者 1 个上限', () => {
  eq(MAX_FOLLOWERS, 1, 'MAX_FOLLOWERS === 1');
});

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n========================================`);
console.log(`v0.5.4 测试结果: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('失败用例:');
  for (const f of failures) console.log('  -', f);
  process.exit(1);
}
process.exit(0);
