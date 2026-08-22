// Integration smoke: import the same modules main.js loads, and
// confirm InventoryService can wire them together without runtime
// errors. We stub the bits that need DOM/canvas and exercise the
// real game-logic modules end-to-end.
import { InventoryService } from '../src/services/InventoryService.js';
import { Gather } from '../src/resources/gather.js';
import { craft } from '../src/resources/crafting.js';
import { CookingPot, findCookableRecipes, computeInventoryStats } from '../src/cooking/cooking.js';
import { preview, execute, availableOffers } from '../src/trading/trader.js';
import { newTradeState, setScarcity, traderStock } from '../src/trading/price-engine.js';
import { Follower, FollowerManager } from '../src/follower/follower-manager.js';
import { TradeUI } from '../src/trading/trade-ui.js';

let pass = 0, fail = 0;
const log = [];
function it(name, fn) {
  try { fn(); pass++; log.push(`  ✓ ${name}`); }
  catch (e) { fail++; log.push(`  ✗ ${name}\n    ${e.message}`); }
}
function eq(a, b) { if (a !== b) throw new Error(`expected ${b}, got ${a}`); }

console.log('\n── integration: main.js wiring smoke ──');

it('TradeUI instantiates with invSvc only', () => {
  const invSvc = new InventoryService();
  // TradeUI touches `document` only on .open(); constructor must work
  // without DOM.
  const ui = new TradeUI({ invSvc, state: newTradeState() });
  eq(typeof ui.isOpen(), 'boolean');
  eq(ui.isOpen(), false);
});

it('full pipeline: gather → craft → trade with a single InventoryService', () => {
  const invSvc = new InventoryService();
  // Start with seed loot
  invSvc.addItem('log', 4);
  invSvc.addItem('twine', 2);
  invSvc.addItem('stone', 1);

  // Craft a torch (consumes 1 log + 1 twine, grants 1 torch).
  const torch = craft([['log', ''], ['', 'twine']], 'hand', invSvc);
  ok(torch.ok, `craft failed: ${JSON.stringify(torch)}`);
  eq(invSvc.countOf('log'), 3);
  eq(invSvc.countOf('twine'), 1);
  eq(invSvc.countOf('torch'), 1);

  // Trading post: sell 1 log, get 1 log back (v0.5.4 1:1 barter).
  // Without setScarcity the multiplier is exactly 1.0 — predictability
  // beats realism for a smoke test.
  const state = newTradeState();
  const r = execute('log', 1, { invSvc, state });
  ok(r.ok, `trade failed: ${JSON.stringify(r)}`);
  eq(r.buyCount, 1);
  eq(invSvc.countOf('log'), 3);

  // Cooking: no recipes in v0.5.4 data, but the pot still wires up.
  const pot = new CookingPot({ invSvc });
  pot.put('berries');
  pot.put('carrot');
  const cookable = findCookableRecipes(pot, invSvc);
  eq(cookable.length, 0, 'v0.5.4 has zero cooking recipes');

  // Follower: recruit a stub piglin, kill it, loot via service.
  const piglin = {
    x: 0, y: 0, facing: 'down',
    affection: 3, maxHp: 3, hp: 3,
    isRecruitable() { return true; }
  };
  const mgr = new FollowerManager({
    world: { isWalkable: () => true },
    player: { x: 0, y: 0 },
    invSvc
  });
  mgr.recruit(piglin);
  mgr.damageFollower(3);
  eq(mgr.size(), 0, 'follower should be cleared after death');
  eq(invSvc.countOf('twine'), 2, 'death loot adds 1 twine → was 1, now 2');
  eq(invSvc.countOf('carrot'), 1);
});

function ok(v, msg = '') { if (!v) throw new Error(`assertion failed ${msg}`); }

console.log('\n' + log.join('\n'));
console.log(`\nIntegration: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
