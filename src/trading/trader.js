/**
 * Trader — the village trading post. Stateless logic over the price
 * engine and the player's inventory.
 *
 * A trade is two legs:
 *   1. `preview(sellItem, count, inventory, state)` — read-only,
 *      returns the quote (no state mutation).
 *   2. `execute(sellItem, count, inventory, state)` — removes the
 *      sell items from inventory, adds the buy items, updates the
 *      state via `applyTrade` + `setScarcity`.
 *
 * If the buy side has nowhere to go, the trade is rejected (caller
 * should display a "背包已满" hint).
 */
'use strict';
import { quote, applyTrade, setScarcity, stockFor, traderStock } from './price-engine.js';

/**
 * @param {Object} ctx
 * @param {import('../resources/inventory.js').Inventory} ctx.inventory
 * @param {Object} ctx.state — TradeState (mutated in-place)
 * @param {Object} [ctx.allowedItems] — subset of stock; defaults to full
 */
export function preview(sellItem, count, ctx) {
  if (count <= 0) return null;
  if (!stockFor(sellItem)) return { reason: 'not_in_stock' };
  if (ctx.allowedItems && !ctx.allowedItems.includes(sellItem)) {
    return { reason: 'not_in_stock' };
  }
  const have = ctx.inventory.countOf(sellItem);
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
  // Remove the sell items: walk the inventory and drain.
  let remaining = count;
  for (let i = 0; i < ctx.inventory.slots.length && remaining > 0; i++) {
    const s = ctx.inventory.slots[i];
    if (!s || s.itemId !== sellItem) continue;
    const take = Math.min(remaining, s.count);
    ctx.inventory.remove(i, take);
    remaining -= take;
  }
  // Add the buy items.
  const added = ctx.inventory.add(q.buyItem, q.buyCount);
  applyTrade(ctx.state, sellItem, count);
  // Refresh scarcity snapshot for next quote.
  for (const itemId of traderStock()) {
    setScarcity(ctx.state, itemId, ctx.inventory.countOf(itemId));
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
export function availableOffers(inventory) {
  return traderStock().filter(id => inventory.countOf(id) > 0);
}

export { quote, applyTrade, setScarcity, stockFor, traderStock };
