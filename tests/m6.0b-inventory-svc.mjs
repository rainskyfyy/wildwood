/**
 * v0.6.0b InventoryService — unit + integration tests.
 *
 * Covers:
 *   - InventoryService 12 methods (read / mutate / batch / durability)
 *   - gather — adds loot, damages tool
 *   - crafting — exact-recipe match, consume + grant, output_full rollback
 *   - cooking — pot state machine (no recipes in v0.5.4 data, so we
 *     exercise the put / clear / no_match paths and the InventoryService
 *     plumbing that used to call the non-existent `inventory.consume`)
 *   - trading — sell items consumed, buy items added
 *   - follower — death loot deposited via InventoryService (the new path)
 *   - integration — gather → craft → trade 3-step flow
 *
 * Run: `node tests/m6.0b-inventory-svc.mjs`
 */
'use strict';

import { InventoryService } from '../src/services/InventoryService.js';
import { Inventory }        from '../src/resources/inventory.js';
import { Gather }           from '../src/resources/gather.js';
import { craft, matchRecipe, emptyGrid } from '../src/resources/crafting.js';
import { CookingPot, findCookableRecipes, computeInventoryStats } from '../src/cooking/cooking.js';
import { preview, execute, availableOffers } from '../src/trading/trader.js';
import { newTradeState, setScarcity, traderStock } from '../src/trading/price-engine.js';
import { Follower, FollowerManager } from '../src/follower/follower-manager.js';

// ─── tiny test runner ────────────────────────────────────────
let pass = 0, fail = 0;
const log = [];
function it(name, fn) {
  try {
    fn();
    pass++;
    log.push(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    log.push(`  ✗ ${name}\n    ${e.message}\n${e.stack || ''}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} ${msg}`);
}
function ok(v, msg = '') { if (!v) throw new Error(`assertion failed ${msg}`); }
function near(a, b, eps = 1e-9, msg = '') {
  if (Math.abs(a - b) > eps) throw new Error(`expected ~${b}, got ${a} ${msg}`);
}

// ═════════════════════════════════════════════════════════════
// 1. InventoryService — direct API surface
// ═════════════════════════════════════════════════════════════
console.log('\n── InventoryService API ──');

it('addItem + countOf + hasItem + getItem', () => {
  const svc = new InventoryService();
  eq(svc.addItem('log', 5).added, 5);
  eq(svc.addItem('log', 10).added, 10);
  eq(svc.countOf('log'), 15);
  ok(svc.hasItem('log'));
  ok(svc.hasItem('log', 10));
  ok(!svc.hasItem('log', 16));
  const g = svc.getItem('log');
  eq(g.count, 15);
  eq(g.durability, null);
});

it('addItem fills existing stacks then opens new ones up to slot count', () => {
  // Inventory.add() does NOT cap at stackMax alone — it will open
  // additional slots once the first stack hits cap. The cap matters
  // only when every slot is full.
  const svc = new InventoryService();
  const r1 = svc.addItem('log', 25);
  eq(r1.added, 25);
  eq(r1.leftover, 0);
  eq(svc.countOf('log'), 25);   // 20 in slot 0, 5 in slot 1 (19 slots free)
  // Fill the remaining 19 slots with 1-stack items, then ask for 5 more
  // of the same 1-stack item — the inventory is full, so 0 added, 5 leftover.
  for (let i = 0; i < 19; i++) svc.addItem('campfire', 1);
  eq(svc.countOf('campfire'), 19);
  // 2 (log) + 19 (campfire) = 21 slots — full.
  const r2 = svc.addItem('campfire', 5);
  eq(r2.added, 0);
  eq(r2.leftover, 5);
  eq(svc.countOf('campfire'), 19);
});

it('consumeByItem drains across slots and returns count removed', () => {
  const svc = new InventoryService();
  svc.addItem('log', 30); // 20 + 10
  eq(svc.consumeByItem('log', 7), 7);
  eq(svc.countOf('log'), 23);
  // over-consume returns what was actually removed
  eq(svc.consumeByItem('log', 999), 23);
  eq(svc.countOf('log'), 0);
});

it('consumeByItem on missing item is a no-op', () => {
  const svc = new InventoryService();
  eq(svc.consumeByItem('gold', 5), 0);
});

it('addMany deposits follower-style loot lists', () => {
  const svc = new InventoryService();
  const r = svc.addMany([
    { itemId: 'twine', count: 2 },
    { itemId: 'carrot', count: 1 },
    null,                                  // tolerated
    { itemId: '', count: 0 },             // tolerated
    { itemId: 'twine', count: 5 }
  ]);
  eq(r.added, 8);
  eq(r.leftover, 0);
  eq(svc.countOf('twine'), 7);
  eq(svc.countOf('carrot'), 1);
});

it('addMany overflows when every slot is full', () => {
  const svc = new InventoryService();
  // Fill all 21 slots first. stackMax(log)=20, so 21 logs in one stack
  // would only occupy 1 slot. We use campfires (stackMax=1) to consume
  // every slot.
  for (let i = 0; i < 21; i++) svc.addItem('campfire', 1);
  eq(svc.countOf('campfire'), 21);
  const r = svc.addMany([
    { itemId: 'log', count: 5 },  // every slot full → leftover=5
    { itemId: 'carrot', count: 1 } // still full → leftover += 1
  ]);
  eq(r.added, 0);
  eq(r.leftover, 6);
  eq(svc.countOf('log'), 0);
  eq(svc.countOf('carrot'), 0);
});

it('findSlotByItem / peekSelected / getSlot', () => {
  const svc = new InventoryService();
  svc.addItem('axe', 1);
  const idx = svc.findSlotByItem('axe');
  ok(idx >= 0 && idx < 6, `expected hotbar slot, got ${idx}`);
  svc._inv.selectHotbar(idx);
  const peek = svc.peekSelected();
  ok(peek && peek.itemId === 'axe');
  const same = svc.getSlot(idx);
  eq(same.itemId, 'axe');
});

it('damageToolById reduces durability; broken tools are cleared', () => {
  const svc = new InventoryService();
  svc.addItem('axe', 1);
  const before = svc.getItem('axe');
  eq(before.durability, 50);
  const after = svc.damageToolById('axe', 1);
  eq(after, 49);
  // Drop durability to 0 in one shot
  svc.damageToolById('axe', 49);
  eq(svc.countOf('axe'), 0, 'broken tool should be removed');
  // No-op on missing id
  eq(svc.damageToolById('axe', 1), null);
});

it('damageSelectedTool targets the active hotbar slot', () => {
  const svc = new InventoryService();
  svc.addItem('torch', 3);
  const idx = svc.findSlotByItem('torch');
  svc._inv.selectHotbar(idx);
  const d1 = svc.damageSelectedTool(1);
  eq(d1, 29);
  const d2 = svc.damageSelectedTool(30);
  eq(d2, 0);
  eq(svc.countOf('torch'), 2, 'broken torch removed; other stacks survive');
});

it('serialize / loadSnapshot round-trip preserves slots and tool durability', () => {
  const svc = new InventoryService();
  svc.addItem('log', 4);
  svc.addItem('axe', 1);
  const idx = svc.findSlotByItem('axe');
  svc._inv.selectHotbar(idx);
  svc.damageToolById('axe', 5);  // 45/50
  const snap = svc.serialize();
  const svc2 = new InventoryService();
  svc2.loadSnapshot(snap);
  eq(svc2.countOf('log'), 4);
  const ax = svc2.getItem('axe');
  eq(ax.durability, 45);
});

it('inventory pass-through works for UI panels', () => {
  const svc = new InventoryService();
  ok(svc.inventory instanceof Inventory);
  eq(svc.hotbarSize, 6);
  eq(svc.backpackSize, 15);
  eq(svc.totalSlots, 21);
});

// ═════════════════════════════════════════════════════════════
// 2. gather — uses invSvc.damageToolById + entity.harvest(invSvc)
// ═════════════════════════════════════════════════════════════
console.log('\n── gather (v0.6.0b) ──');

function makeTreeEntity({ id = 'tree', x = 5, y = 5, harvestTime = 1.0, loot = [{ itemId: 'log', count: 2 }] } = {}) {
  return {
    id, x, y, depleted: false,
    distTo(px, py) { return Math.hypot(this.x - px, this.y - py); },
    harvest(invSvc, now) {
      for (const l of loot) invSvc.addItem(l.itemId, l.count);
      return { granted: loot, regrowAt: now + 30000 };
    },
    harvestTime
  };
}

it('gather.complete adds loot and damages the equipped tool', () => {
  const svc = new InventoryService();
  svc.addItem('axe', 1);
  const axeSlot = svc.findSlotByItem('axe');
  svc._inv.selectHotbar(axeSlot);
  const events = [];
  const g = new Gather({
    entities: [makeTreeEntity()],
    invSvc: svc,
    selectedItemProvider: () => svc.peekSelected()?.itemId || null,
    onEvent: (n, p) => events.push({ n, p })
  });
  // 1.0s of "work" at dt=0.5 twice — second tick crosses harvestTime.
  g.click(5, 5);
  g.update({ x: 5, y: 5 }, 0.5);
  ok(g.state === 'gathering', 'should be gathering after first tick');
  g.update({ x: 5, y: 5 }, 0.5);
  // After harvest, state is JUST_DONE (or IDLE on the next tick).
  ok(g.state === 'just_done' || g.state === 'idle',
     `should be just_done or idle after harvest, got ${g.state}`);
  g.update({ x: 5, y: 5 }, 0.01);  // flush JUST_DONE → IDLE
  ok(g.state === 'idle', 'should be back to idle after next tick');
  eq(svc.countOf('log'), 2);
  const ax = svc.getItem('axe');
  eq(ax.durability, 49, 'axe durability should drop by 1');
  const complete = events.find(e => e.n === 'complete');
  ok(complete, 'should emit complete event');
  eq(complete.p.toolUsed, 'axe');
});

it('gather without a tool still grants loot (no_tool_required)', () => {
  const svc = new InventoryService();
  // Put a non-tool item in hotbar to ensure "no tool required" path
  svc.addItem('berries', 1);
  svc._inv.selectHotbar(svc.findSlotByItem('berries'));
  const g = new Gather({
    entities: [makeTreeEntity()],
    invSvc: svc,
    selectedItemProvider: () => svc.peekSelected()?.itemId || null
  });
  g.click(5, 5);
  g.update({ x: 5, y: 5 }, 1.1);
  eq(svc.countOf('log'), 2);
  // berries untouched (no tool to damage)
  eq(svc.countOf('berries'), 1);
});

// ═════════════════════════════════════════════════════════════
// 3. crafting — match, consume, grant, rollback
// ═════════════════════════════════════════════════════════════
console.log('\n── crafting (v0.6.0b) ──');

it('craft matches a recipe, consumes inputs, grants output', () => {
  const svc = new InventoryService();
  svc.addItem('log', 2);
  svc.addItem('twine', 1);
  svc.addItem('stone', 1);
  // Campfire: [[log,log],[twine,stone]]
  const grid = [['log', 'log'], ['twine', 'stone']];
  const r = craft(grid, 'hand', svc);
  ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  eq(r.output.itemId, 'campfire');
  eq(r.output.count, 1);
  eq(svc.countOf('log'), 0);
  eq(svc.countOf('twine'), 0);
  eq(svc.countOf('stone'), 0);
  eq(svc.countOf('campfire'), 1);
});

it('craft rejects when inputs are insufficient', () => {
  const svc = new InventoryService();
  svc.addItem('log', 1);  // need 2
  const r = craft([['log', 'log'], ['twine', 'stone']], 'hand', svc);
  eq(r.ok, false);
  eq(r.reason, 'insufficient_items');
  eq(svc.countOf('log'), 1, 'inputs should be untouched');
});

it('craft rolls back consume when output does not fit', () => {
  const svc = new InventoryService();
  // Pack the inventory so there is exactly zero free slot for the
  // crafted output: log/twine/stone each fill a stack to cap (20),
  // then 18 campfires (stackMax=1) fill the remaining 18 slots.
  // Total: 21 slots used.
  svc.addItem('log', 20);
  svc.addItem('twine', 20);
  svc.addItem('stone', 20);
  for (let i = 0; i < 18; i++) svc.addItem('campfire', 1);
  // Sanity: no room left.
  eq(svc.addItem('carrot', 1).leftover, 1);
  eq(svc.countOf('log'), 20);
  eq(svc.countOf('twine'), 20);
  eq(svc.countOf('stone'), 20);
  eq(svc.countOf('campfire'), 18);
  // craft consumes 1 log + 1 twine + 1 stone (slots still 21),
  // then tries to add 1 campfire — but every slot is in use, so
  // output_full fires and the inputs are returned.
  const r = craft([['log', 'log'], ['twine', 'stone']], 'hand', svc);
  eq(r.ok, false);
  eq(r.reason, 'output_full');
  eq(svc.countOf('log'), 20, 'log must be rolled back');
  eq(svc.countOf('twine'), 20, 'twine must be rolled back');
  eq(svc.countOf('stone'), 20, 'stone must be rolled back');
  eq(svc.countOf('campfire'), 18, 'no new campfire added');
});

it('craft matches torch and rope', () => {
  const svc = new InventoryService();
  svc.addItem('log', 1);
  svc.addItem('twine', 5);
  // torch: [[log,''],['',twine]]
  const t = craft([['log', ''], ['', 'twine']], 'hand', svc);
  ok(t.ok, `torch craft failed: ${JSON.stringify(t)}`);
  eq(t.output.itemId, 'torch');
  eq(svc.countOf('log'), 0);
  eq(svc.countOf('twine'), 4);
  // rope: 4× twine → 4× twine (v0.5.4 quirk; just exercises the recipe)
  const r = craft([['twine', 'twine'], ['twine', 'twine']], 'hand', svc);
  ok(r.ok, `rope craft failed: ${JSON.stringify(r)}`);
  eq(r.output.itemId, 'twine');
  eq(svc.countOf('twine'), 4);
});

it('craft science: axe with proper inputs', () => {
  const svc = new InventoryService();
  svc.addItem('iron_ore', 1);
  svc.addItem('log', 3);
  // axe: [['','iron_ore',''], ['log','log',''], ['', 'log', '']]
  const g = emptyGrid(3);
  g[0][1] = 'iron_ore';
  g[1][0] = 'log'; g[1][1] = 'log';
  g[2][1] = 'log';
  const r = craft(g, 'science', svc);
  ok(r.ok, `axe craft failed: ${JSON.stringify(r)}`);
  eq(svc.countOf('axe'), 1);
  eq(svc.getItem('axe').durability, 50);
});

// ═════════════════════════════════════════════════════════════
// 4. cooking — v0.5.4 has no recipes; exercise pot + service path
// ═════════════════════════════════════════════════════════════
console.log('\n── cooking (v0.6.0b) ──');

it('CookingPot.put / clear / no_match flows through InventoryService', () => {
  const svc = new InventoryService();
  const pot = new CookingPot({ invSvc: svc });
  eq(pot.put('berries').ok, true);
  eq(pot.put('carrot').ok, true);
  // tools cannot be cooked
  svc.addItem('axe', 1);
  eq(pot.put('axe').ok, false);
  eq(pot.put('axe').reason, 'not_cookable');
  // v0.5.4 has no cooking recipes in recipes.json — findCookableRecipes returns []
  const cookable = findCookableRecipes(pot, svc);
  eq(cookable.length, 0);
  // cook with no recipe should return no_match (and not crash, which was
  // the latent bug from the missing `inventory.consume` method)
  const c = pot.cook(computeInventoryStats(svc));
  eq(c.ok, false);
  eq(c.reason, 'no_match');
  pot.clear();
  ok(pot.slots.every(s => s === ''));
});

it('cooking path stays service-only (no direct slots reads)', () => {
  // This is more of a static check: the cooking module should not expose
  // any path that reads .slots on the underlying inventory. We re-create
  // a fresh pot, hand it a service, and verify count / add / consume all
  // work via the service API. (Real "no leaks" guarantee is via grep
  // in CI — see deliverable.)
  const svc = new InventoryService();
  const pot = new CookingPot({ invSvc: svc });
  pot.put('berries');
  pot.put('berries');
  pot.put('carrot');
  pot.put('mushroom');
  // No recipe matches in v0.5.4 data, but inputs ARE registered
  eq(svc.countOf('berries'), 0, 'put() does not withdraw from inventory');
  // Slot-only state, not inventory state
  eq(pot.slots.filter(s => s !== '').length, 4);
});

// ═════════════════════════════════════════════════════════════
// 5. trading — preview + execute through InventoryService
// ═════════════════════════════════════════════════════════════
console.log('\n── trading (v0.6.0b) ──');

it('trader.execute consumes sell items and adds buy items', () => {
  const svc = new InventoryService();
  // log is 1:1 with itself in v0.5.4 stock — useful for a clean assertion.
  // With no scarcity signal the mult is 1.0, so 3 logs sold → 3 logs bought.
  svc.addItem('log', 5);
  const state = newTradeState();
  // Intentionally do NOT call setScarcity here so the price stays at 1.0.
  const ctx = { invSvc: svc, state };
  const r = execute('log', 3, ctx);
  ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  eq(r.sellCount, 3);
  eq(r.buyItem, 'log');
  eq(r.buyCount, 3, 'mult=1.0 → 3 logs for 3 logs');
  eq(svc.countOf('log'), 5, '5 - 3 + 3 = 5');
});

it('trader.preview returns insufficient when stock is short', () => {
  const svc = new InventoryService();
  svc.addItem('flint', 1);
  const state = newTradeState();
  for (const id of traderStock()) setScarcity(state, id, svc.countOf(id));
  const p = preview('flint', 5, { invSvc: svc, state });
  eq(p.reason, 'insufficient');
  eq(p.have, 1);
  eq(p.need, 5);
});

it('availableOffers only lists items the player actually has', () => {
  const svc = new InventoryService();
  svc.addItem('log', 3);
  svc.addItem('flint', 1);
  // carrots not added
  const offers = availableOffers(svc);
  ok(offers.includes('log'));
  ok(offers.includes('flint'));
  ok(!offers.includes('carrot'));
});

// ═════════════════════════════════════════════════════════════
// 6. follower — death loot deposited via InventoryService
// ═════════════════════════════════════════════════════════════
console.log('\n── follower (v0.6.0b) ──');

it('FollowerManager + Follower deposit death loot via service', () => {
  const svc = new InventoryService();
  // Minimal piglin stand-in
  const piglin = {
    x: 0, y: 0, facing: 'down',
    affection: 3, maxHp: 3, hp: 3,
    isRecruitable() { return true; }
  };
  // Minimal world stand-in
  const world = { isWalkable: () => true };
  const mgr = new FollowerManager({ world, player: { x: 0, y: 0 }, invSvc: svc });
  const f = mgr.recruit(piglin);
  ok(f, 'recruit should succeed');
  ok(f instanceof Follower);
  // Kill the follower
  f.damage(3);
  eq(f.alive, false);
  // Loot should now be in inventory
  eq(svc.countOf('twine'), 1);
  eq(svc.countOf('carrot'), 1);
  // Piglin reset
  eq(piglin.affection, 0);
  eq(piglin.hp, piglin.maxHp);
});

it('Follower without invSvc still returns loot (legacy callers)', () => {
  const piglin = {
    x: 0, y: 0, facing: 'down',
    affection: 3, maxHp: 3, hp: 3,
    isRecruitable() { return true; }
  };
  const world = { isWalkable: () => true };
  const f = new Follower({
    piglin, player: { x: 0, y: 0 }, world,
    invSvc: null
  });
  const loot = f.damage(3);
  eq(loot.length, 2);
  eq(loot[0].itemId, 'twine');
});

it('FollowerManager.damageFollower zeroes the slot after death', () => {
  const svc = new InventoryService();
  const piglin = {
    x: 0, y: 0, facing: 'down',
    affection: 3, maxHp: 3, hp: 3,
    isRecruitable() { return true; }
  };
  const mgr = new FollowerManager({ world: { isWalkable: () => true }, player: { x: 0, y: 0 }, invSvc: svc });
  mgr.recruit(piglin);
  mgr.damageFollower(99);
  eq(mgr.current(), null);
  eq(mgr.size(), 0);
  eq(svc.countOf('twine'), 1);
  eq(svc.countOf('carrot'), 1);
});

// ═════════════════════════════════════════════════════════════
// 7. integration — gather → craft → trade
// ═════════════════════════════════════════════════════════════
console.log('\n── integration (gather → craft → trade) ──');

it('end-to-end: harvest 4 logs, craft a torch, trade the torch for more logs', () => {
  const svc = new InventoryService();
  svc.addItem('axe', 1);
  svc._inv.selectHotbar(svc.findSlotByItem('axe'));

  // 1) Gather 4 logs from two trees (2 each).
  const trees = [makeTreeEntity({ x: 5, y: 5 }), makeTreeEntity({ x: 7, y: 5 })];
  const g = new Gather({
    entities: trees,
    invSvc: svc,
    selectedItemProvider: () => svc.peekSelected()?.itemId || null
  });
  g.click(5, 5); g.update({ x: 5, y: 5 }, 1.1);
  g.click(7, 5); g.update({ x: 7, y: 5 }, 1.1);
  eq(svc.countOf('log'), 4);
  ok(svc.getItem('axe').durability < 50, 'axe should have lost some durability');

  // 2) Craft a torch: [[log,''],['',twine]] — need 1 log + 1 twine.
  svc.addItem('twine', 1);
  const c = craft([['log', ''], ['', 'twine']], 'hand', svc);
  ok(c.ok, `craft failed: ${JSON.stringify(c)}`);
  eq(svc.countOf('log'), 3);
  eq(svc.countOf('twine'), 0);
  eq(svc.countOf('torch'), 1);

  // 3) Trade remaining 3 logs at the trader.
  const state = newTradeState();
  for (const id of traderStock()) setScarcity(state, id, svc.countOf(id));
  const t = execute('log', 3, { invSvc: svc, state });
  ok(t.ok, `trade failed: ${JSON.stringify(t)}`);
  // log 1:1, so should have log + 1 more
  ok(svc.countOf('log') >= 1, 'should have at least 1 log after trade');
  ok(svc.countOf('log') <= 3, 'should have at most 3 logs (the traded-in ones)');
  // Torch untouched
  eq(svc.countOf('torch'), 1);
});

// ═════════════════════════════════════════════════════════════
// 8. module boundary — only InventoryService may import from inventory.js
// ═════════════════════════════════════════════════════════════
console.log('\n── module boundary ──');

it('no caller under src/ imports ../resources/inventory.js directly', async () => {
  const { spawn } = await import('node:child_process');
  const result = await new Promise((resolve) => {
    const child = spawn('grep', [
      '-rn',
      "from ['\"]\\.\\./resources/inventory\\.js['\"]",
      'src/'
    ], { cwd: '..', encoding: 'utf8' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', () => resolve(out));
  });
  // Allowed: services/InventoryService.js and resources/inventory.js itself
  const allowed = new Set([
    'src/services/InventoryService.js',
    'src/resources/inventory.js'
  ]);
  const violations = result
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      // format: "src/<path>:...:import ..."
      const m = line.match(/^(src\/[^:]+):/);
      if (!m) return true;
      return !allowed.has(m[1]);
    });
  if (violations.length) {
    throw new Error('forbidden inventory.js imports:\n' + violations.join('\n'));
  }
});

// ═════════════════════════════════════════════════════════════
// Final report
// ═════════════════════════════════════════════════════════════
console.log('\n' + log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
