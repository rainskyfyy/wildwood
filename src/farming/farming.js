/**
 * Farming — 核心: 耕地状态机 + 工具交互 + 作物生长
 *
 * Tile 状态:
 *   GRASS  — 默认草地
 *   TILLED — 已犁地(可播种)
 *   PLANTED— 已播种(progress < 1.0,可能 dry/wet)
 *   READY  — 可收获(progress >= 1.0)
 *
 * 工具交互 (传入 inventory + 选中的工具/种子/水/肥):
 *   till(tx, ty)            用 hoe 犁地  → TILLED
 *   plant(tx, ty, seedId)   用 seed 播种 → PLANTED
 *   water(tx, ty)           用 watering_can 浇水
 *   fertilize(tx, ty, fid)  施肥
 *   harvest(tx, ty)         收获 READY 状态的作物 → 物品入背包
 *   removePlant(tx, ty)     拔除未成熟的作物(返还种子)
 *
 * 自动 tick:
 *   每帧 update(dt) — 让所有 PLANTED/READY 地块的 progress 推进
 *   缺水暂停生长, 施肥加速
 *
 * 序列化: save() / load() — localStorage 持久化(可选)
 *
 * v1.0.0 — 初始实现
 */
'use strict';

import { CROPS, cropFromSeed, getCropBySeed, stageForProgress, growthSeconds, CROP_STAGE, STAGE_THRESHOLD } from './crops.js';
import { FERTILIZERS, getFertilizer, combineFertilizer, currentFertilizerMult } from './fertilizer.js';
import { isTool, getToolType, getItem } from '../resources/catalog.js';

export const TILE_STATE = Object.freeze({
  GRASS:   'grass',
  TILLED:  'tilled',
  PLANTED: 'planted',
  READY:   'ready'
});

/**
 * @typedef {Object} FarmTile
 * @property {number} tx
 * @property {number} ty
 * @property {string} state     - GRASS / TILLED / PLANTED / READY
 * @property {string} [cropId]  - CROPS key
 * @property {number} [progress] - 0..1 (only for PLANTED / READY)
 * @property {number} [wateredAt] - real-time ms
 * @property {number} [plantedAt] - real-time ms
 * @property {Object} [fertilizer] - { id, tier, mult, appliedAt }
 * @property {boolean} [dehydrated] - 缺水标记
 */

export class FarmSystem {
  /**
   * @param {object} opts
   * @param {{width:number, height:number}} opts.world
   * @param {object} opts.inventory  - Inventory instance
   * @param {Function} [opts.onEvent] - (name, payload) => void
   *   events: 'tilled' / 'planted' / 'watered' / 'fertilized' / 'harvested' / 'withered' / 'removed'
   */
  constructor({ world, inventory, onEvent }) {
    if (!world) throw new Error('FarmSystem requires world');
    if (!inventory) throw new Error('FarmSystem requires inventory');
    this.world = world;
    this.inventory = inventory;
    this.onEvent = onEvent || (() => {});
    /** @type {Map<string, FarmTile>} key = `${tx},${ty}` */
    this.tiles = new Map();
  }

  // ─── Tile access ───────────────────────────────────────────

  _key(tx, ty) { return `${tx},${ty}`; }

  /**
   * Get a tile snapshot. Returns a plain object (immutable copy) for safe
   * inspection. Returns a frozen GRASS descriptor for unknown tiles.
   */
  getTile(tx, ty) {
    const t = this.tiles.get(this._key(tx, ty));
    if (t) return Object.freeze({ ...t });
    return Object.freeze({ tx, ty, state: TILE_STATE.GRASS });
  }

  /** True if the tile is anything but grass. */
  isCultivated(tx, ty) {
    const t = this.tiles.get(this._key(tx, ty));
    return !!(t && t.state !== TILE_STATE.GRASS);
  }

  /**
   * Get all tiles in a bounding box (for rendering + tick).
   * @returns {FarmTile[]}
   */
  tilesInBounds(x0, y0, x1, y1) {
    const out = [];
    for (const t of this.tiles.values()) {
      if (t.tx < x0 || t.tx > x1 || t.ty < y0 || t.ty > y1) continue;
      out.push(Object.freeze({ ...t }));
    }
    return out;
  }

  // ─── Tools ─────────────────────────────────────────────────

  /**
   * Use a tool at the given world tile. Returns:
   *   { ok: true, action: 'tilled' | 'planted' | ... }
   *   { ok: false, reason: 'invalid_tile' | 'wrong_tool' | 'tile_occupied' | 'no_seed' | 'no_water' | 'no_fertilizer' | 'no_inventory_room' | 'tile_state' | 'not_ready' | 'unknown' }
   */
  useToolAt(tx, ty, toolId, heldItemId) {
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) {
      return { ok: false, reason: 'invalid_tile' };
    }
    const tile = this.tiles.get(this._key(tx, ty)) || { tx, ty, state: TILE_STATE.GRASS };
    const inv  = this.inventory;

    // 1. Hoe → till GRASS into TILLED
    if (toolId && isTool(toolId) && getToolType(toolId) === 'hoe') {
      if (tile.state !== TILE_STATE.GRASS) {
        return { ok: false, reason: 'tile_state', detail: tile.state };
      }
      this.tiles.set(this._key(tx, ty), {
        tx, ty, state: TILE_STATE.TILLED, tilledAt: Date.now()
      });
      this.onEvent('tilled', { tx, ty });
      return { ok: true, action: 'tilled' };
    }

    // 2. Watering can + TILLED/PLANTED → water
    if (toolId && isTool(toolId) && getToolType(toolId) === 'water') {
      if (tile.state === TILE_STATE.GRASS) {
        return { ok: false, reason: 'tile_state', detail: 'grass' };
      }
      this._setWatered(tx, ty);
      this.onEvent('watered', { tx, ty });
      return { ok: true, action: 'watered' };
    }

    // 3. Held seed + TILLED → plant
    if (heldItemId && cropFromSeed(heldItemId)) {
      if (tile.state !== TILE_STATE.TILLED) {
        return { ok: false, reason: 'tile_state', detail: tile.state };
      }
      const r = inv.consume(heldItemId, 1);
      if (r.leftover > 0) return { ok: false, reason: 'no_seed' };
      const crop = getCropBySeed(heldItemId);
      this.tiles.set(this._key(tx, ty), {
        tx, ty,
        state: TILE_STATE.PLANTED,
        cropId: crop.id,
        progress: 0,
        plantedAt: Date.now(),
        wateredAt: 0,
        dehydrated: true,
        fertilizer: null
      });
      this.onEvent('planted', { tx, ty, seedId: heldItemId, cropId: crop.id });
      return { ok: true, action: 'planted', cropId: crop.id };
    }

    // 4. Held fertilizer + TILLED/PLANTED → fertilize
    if (heldItemId && getFertilizer(heldItemId)) {
      if (tile.state === TILE_STATE.GRASS) {
        return { ok: false, reason: 'tile_state', detail: 'grass' };
      }
      const r = inv.consume(heldItemId, 1);
      if (r.leftover > 0) return { ok: false, reason: 'no_fertilizer' };
      const updated = combineFertilizer(tile.fertilizer, heldItemId);
      this.tiles.set(this._key(tx, ty), { ...tile, fertilizer: updated });
      this.onEvent('fertilized', { tx, ty, fertilizer: updated });
      return { ok: true, action: 'fertilized' };
    }

    // 5. Empty hand (or non-farming tool) on READY → harvest
    if (tile.state === TILE_STATE.READY) {
      return this.harvest(tx, ty);
    }

    return { ok: false, reason: 'unknown' };
  }

  /**
   * Harvest a READY tile. Returns yield (itemId, count) or { ok:false }.
   */
  harvest(tx, ty) {
    const tile = this.tiles.get(this._key(tx, ty));
    if (!tile || tile.state !== TILE_STATE.READY) {
      return { ok: false, reason: 'not_ready' };
    }
    const crop = CROPS[tile.cropId];
    if (!crop) return { ok: false, reason: 'unknown' };
    const count = crop.yieldMin + Math.floor(Math.random() * (crop.yieldMax - crop.yieldMin + 1));
    const r = this.inventory.add(crop.id, count);
    if (r.leftover > 0) {
      return { ok: false, reason: 'no_inventory_room' };
    }
    this.tiles.delete(this._key(tx, ty));
    this.onEvent('harvested', { tx, ty, cropId: crop.id, count });
    return { ok: true, action: 'harvested', itemId: crop.id, count };
  }

  /**
   * Remove a non-ready plant — returns 1 seed of the original type to inventory
   * (consolation for replanting).
   */
  removePlant(tx, ty) {
    const tile = this.tiles.get(this._key(tx, ty));
    if (!tile || tile.state !== TILE_STATE.PLANTED) {
      return { ok: false, reason: 'not_planted' };
    }
    const crop = CROPS[tile.cropId];
    if (crop) this.inventory.add(crop.seedId, 1);
    this.tiles.delete(this._key(tx, ty));
    this.onEvent('removed', { tx, ty, returnedSeed: crop?.seedId });
    return { ok: true, action: 'removed', returnedSeed: crop?.seedId };
  }

  /**
   * Right-click handler — depends on tile state.
   *   GRASS  → no-op
   *   TILLED → cancel (back to GRASS, no return)
   *   PLANTED → removePlant
   *   READY  → harvest
   */
  rightClick(tx, ty) {
    const tile = this.tiles.get(this._key(tx, ty));
    if (!tile) return { ok: false, reason: 'grass' };
    if (tile.state === TILE_STATE.TILLED) {
      this.tiles.delete(this._key(tx, ty));
      this.onEvent('cancelled', { tx, ty });
      return { ok: true, action: 'cancelled' };
    }
    if (tile.state === TILE_STATE.PLANTED) return this.removePlant(tx, ty);
    if (tile.state === TILE_STATE.READY)   return this.harvest(tx, ty);
    return { ok: false, reason: 'grass' };
  }

  // ─── Tick ──────────────────────────────────────────────────

  _setWatered(tx, ty) {
    const tile = this.tiles.get(this._key(tx, ty));
    if (!tile) return;
    tile.wateredAt = Date.now();
    tile.dehydrated = false;
  }

  /**
   * Per-frame update. Advances growth on all PLANTED/READY tiles.
   * dt = seconds elapsed
   */
  update(dt) {
    const now = Date.now();
    for (const tile of this.tiles.values()) {
      if (tile.state !== TILE_STATE.PLANTED && tile.state !== TILE_STATE.READY) continue;
      const crop = CROPS[tile.cropId];
      if (!crop) continue;

      // 1. Water check
      const sinceWater = (now - (tile.wateredAt || tile.plantedAt)) / 1000;
      const dry = sinceWater > crop.waterDrain;
      if (dry && !tile.dehydrated) tile.dehydrated = true;
      if (tile.dehydrated) continue;  // 缺水暂停生长

      // 2. Growth progress
      const baseSec = growthSeconds(crop);
      const mult = currentFertilizerMult(tile.fertilizer);
      const secPerUnit = baseSec / mult;
      const delta = dt / secPerUnit;
      const newProgress = Math.min(1.0, tile.progress + delta);
      tile.progress = newProgress;

      // 3. Stage transition
      if (newProgress >= 1.0) {
        tile.state = TILE_STATE.READY;
        this.onEvent('ready', { tx: tile.tx, ty: tile.ty, cropId: crop.id });
      }
    }
  }

  // ─── Serialization ─────────────────────────────────────────

  serialize() {
    const tiles = [];
    for (const t of this.tiles.values()) {
      tiles.push({
        tx: t.tx, ty: t.ty, state: t.state,
        cropId: t.cropId, progress: t.progress,
        wateredAt: t.wateredAt, plantedAt: t.plantedAt,
        dehydrated: !!t.dehydrated,
        fertilizer: t.fertilizer || null
      });
    }
    return { v: 1, tiles };
  }

  loadSnapshot(snap) {
    if (!snap || snap.v !== 1) return;
    this.tiles.clear();
    for (const t of snap.tiles) {
      this.tiles.set(this._key(t.tx, t.ty), { ...t });
    }
  }

  // ─── Statistics ────────────────────────────────────────────

  countByState() {
    const out = { grass: 0, tilled: 0, planted: 0, ready: 0 };
    for (const t of this.tiles.values()) {
      out[t.state] = (out[t.state] || 0) + 1;
    }
    return out;
  }
}
