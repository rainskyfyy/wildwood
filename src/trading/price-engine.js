/**
 * Price engine — bartering price table + supply/demand drift.
 *
 * The trade system is **barter-only**: the trader offers a fixed
 * price table mapping each `sellItem` (what the player gives) to a
 * `buyItem` (what the trader returns). Prices are not gold; they
 * are item ratios.
 *
 * Two pieces of state affect the price at trade time:
 *   - per-item-id `tradeCount` (how many times the player has
 *     already traded this sellItem with this trader). Each trade
 *     drives the price DOWN by `STEP` units (0.05 = 5%) until it
 *     floors at `MIN_MULT`.
 *   - per-item-id `scarcity` (how many of the buyItem the player
 *     has in inventory already). Higher scarcity in the player's
 *     bag means the trader won't drive the price down as much.
 *
 * This produces the "supply & demand" feel:
 *   - "I just sold 10 carrots, the trader is fed up with carrots"
 *   - "I have too many mushrooms in my bag, the trader is more
 *      generous on this one"
 *
 * Everything is pure functions of state — easy to test, no DOM.
 */
'use strict';

// Per-trade price drop (5% per prior trade of the same item).
const STEP = 0.05;
// Floor: trader will never give less than 60% of base value.
const MIN_MULT = 0.6;
// Ceiling: same item never above 1.5x base value.
const MAX_MULT = 1.5;
// Items the piglin trader will accept (player sells):
const TRADER_STOCK = {
  log:    { buy: 'log',         base: 1,  givePerUnit: 1.0 },   // 1:1
  twine:  { buy: 'twine',       base: 1,  givePerUnit: 1.0 },
  stone:  { buy: 'stone',       base: 1,  givePerUnit: 1.0 },
  flint:  { buy: 'flint',       base: 1,  givePerUnit: 1.0 },
  carrot: { buy: 'berries',     base: 2,  givePerUnit: 1.0 },  // 2 carrots = 1 berry
  mushroom: { buy: 'berries',   base: 2,  givePerUnit: 1.0 },  // 2 mushrooms = 1 berry
  berries: { buy: 'log',        base: 3,  givePerUnit: 1.0 },  // 3 berries = 1 log
  petals: { buy: 'twine',       base: 2,  givePerUnit: 1.0 },  // 2 petals = 1 twine
  ice:    { buy: 'flint',       base: 1,  givePerUnit: 1.0 }
};

/**
 * @typedef {Object} TradeState
 * @property {Object<string, number>} tradeCount  — sellItem → times traded
 * @property {Object<string, number>} [scarcity]  — buyItem → how many in bag
 */

/**
 * Build a fresh trade state.
 */
export function newTradeState() {
  return { tradeCount: {}, scarcity: {} };
}

/**
 * The set of items the trader is willing to buy.
 */
export function traderStock() {
  return Object.keys(TRADER_STOCK);
}

/**
 * @returns {Object|null} the stock row for `sellItem` (itemId the player gives),
 *   or null if the trader doesn't accept it.
 */
export function stockFor(sellItem) {
  return TRADER_STOCK[sellItem] || null;
}

/**
 * Compute the current effective multiplier for a sell item.
 * @param {string} sellItem
 * @param {TradeState} state
 * @returns {number} a number in [MIN_MULT, MAX_MULT]
 */
export function priceMultiplier(sellItem, state) {
  const stock = stockFor(sellItem);
  if (!stock) return 0;
  const trades = state.tradeCount[sellItem] || 0;
  // Demand-side: prior trades of this item -> lower price.
  let mult = 1.0 - trades * STEP;
  // Scarcity of the buy item the trader would give: if the player
  // already has 0 of it, trader is "happier" to give extras (slight
  // upcharge). If the player is overflowing, trader is "fed up"
  // (downcharge). Capped ±0.2 to avoid runaway.
  //
  // No scarcity signal (player hasn't opened the trade UI yet, or
  // the inventory hasn't been scanned) → leave mult exactly at the
  // demand-only value, so the first trade is a fair 1:1 / 2:1.
  const buyItem = stock.buy;
  if (Object.prototype.hasOwnProperty.call(state.scarcity, buyItem)) {
    const sc = Math.max(0, state.scarcity[buyItem] || 0);
    const scarcityAdjust = Math.max(-0.2, Math.min(0.2, 0.1 - sc * 0.04));
    mult += scarcityAdjust;
  }
  if (mult < MIN_MULT) mult = MIN_MULT;
  if (mult > MAX_MULT) mult = MAX_MULT;
  return mult;
}

/**
 * Quote a single trade: how many `buyItem` the trader will give
 * for `count` units of `sellItem`, given current state.
 *
 * The trader's offer is `floor(count * base.givePerUnit * mult)`.
 * Returns null for unknown sellItem.
 */
export function quote(sellItem, count, state) {
  const stock = stockFor(sellItem);
  if (!stock || count <= 0) return null;
  const mult = priceMultiplier(sellItem, state);
  const give = Math.max(0, Math.floor(count * stock.givePerUnit * mult));
  return {
    sellItem,
    sellCount: count,
    buyItem: stock.buy,
    buyCount: give,
    multiplier: mult
  };
}

/**
 * Apply a trade to the state — increments `tradeCount` and stores
 * the latest scarcity. Returns the new state (mutates in place
 * for convenience; tests can compare before/after).
 */
export function applyTrade(state, sellItem, count) {
  const stock = stockFor(sellItem);
  if (!stock || count <= 0) return state;
  state.tradeCount[sellItem] = (state.tradeCount[sellItem] || 0) + 1;
  return state;
}

/**
 * Update the player's-bag scarcity snapshot. Call this whenever the
 * inventory changes; the engine reads it lazily on the next quote.
 */
export function setScarcity(state, buyItem, count) {
  if (count < 0) count = 0;
  state.scarcity[buyItem] = count;
  return state;
}

/** Pure helper: read the multiplier without mutating state (for UI hints). */
export function previewMultiplier(sellItem, state) {
  return priceMultiplier(sellItem, state);
}
