/**
 * Trader — the village trading post. Stateless logic over the price
 * engine and the player's inventory.
 *
 * A trade is two legs:
 *   1. `preview(sellItem, count, ctx)` — read-only,
 *      returns the quote (no state mutation).
 *   2. `execute(sellItem, count, ctx)` — removes the
 *      sell items from inventory, adds the buy items, updates the
 *      state via `applyTrade` + `setScarcity`.
 *
 * If the buy side has nowhere to go, the trade is rejected (caller
 * should display a "背包已满" hint).
 *
 * v0.6.0b — InventoryService:
 *   `ctx.inventory` is now an InventoryService. The hand-rolled drain
 *   loop (walking slots) is replaced with `consumeByItem`; the buy
 *   leg uses `addItem`. No more direct access to `invSvc.slots` from
 *   this module.
 */
'use strict';
import { quote, applyTrade, setScarcity, stockFor, traderStock } from './price-engine.js';

/**
 * @param {Object} ctx
 * @param {import('../services/InventoryService.js').InventoryService} ctx.invSvc
 * @param {Object} ctx.state — TradeState (mutated in-place)
 * @param {Object} [ctx.allowedItems] — subset of stock; defaults to full
 */
export function preview(sellItem, count, ctx) {
  if (count <= 0) return null;
  if (!stockFor(sellItem)) return { reason: 'not_in_stock' };
  if (ctx.allowedItems && !ctx.allowedItems.includes(sellItem)) {
    return { reason: 'not_in_stock' };
  }
  const have = ctx.invSvc.countOf(sellItem);
  if (have < count) return { reason: 'insufficient', have, need: count };
  return quote(sellItem, count, ctx.state);
}

/**
 * Execute a trade. Mutates inventory + state. Returns the trade
 * result or an error code.
 */
export function execute(sellItem, count, ctx) {
  const q = preview(sellItem, count, ctx);
  if (!q) return { ok: false, reason: 'invalid' };
  if (q.reason === 'not_in_stock') return { ok: false, reason: 'not_in_stock' };
  if (q.reason === 'insufficient') {
    return { ok: false, reason: 'insufficient', have: q.have, need: q.need };
  }
  // Remove sell items via the service.
  const removed = ctx.invSvc.consumeByItem(sellItem, count);
  if (removed < count) {
    // Roll back the partial consume — should not normally happen
    // because `preview` already verified `have >= count`, but be safe.
    ctx.invSvc.addItem(sellItem, removed);
    return { ok: false, reason: 'insufficient', have: removed, need: count };
  }
  // Add the buy items.
  const added = ctx.invSvc.addItem(q.buyItem, q.buyCount);
  applyTrade(ctx.state, sellItem, count);
  // Refresh scarcity snapshot for next quote.
  for (const itemId of traderStock()) {
    setScarcity(ctx.state, itemId, ctx.invSvc.countOf(itemId));
  }
  return {
    ok: true,
    sellItem, sellCount: count,
    buyItem: q.buyItem, buyCount: q.buyCount,
    added: added.added,
    leftover: added.leftover,
    multiplier: q.multiplier
  };
}

/** Convenience: list of items the trader will accept from the player. */
export function availableOffers(invSvc) {
  return traderStock().filter(id => invSvc.countOf(id) > 0);
}

export { quote, applyTrade, setScarcity, stockFor, traderStock };
