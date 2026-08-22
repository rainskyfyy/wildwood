/**
 * Drying Rack — 晒肉架: 生肉 → 肉干,保质期 3×
 *
 * 任何 processing station 的状态机:
 *   EMPTY     — 空,等待放入物品
 *   PROCESSING— 正在处理(配方计时)
 *   READY     — 处理完成,等待取出
 *
 * 每个建筑实例:
 *   - id (entityId)
 *   - typeId (building type)
 *   - station (加工站类型: 'drying_rack' / 'fermenting_barrel')
 *   - inputItemId (放入的物品)
 *   - outputRecipe (匹配的加工配方)
 *   - startedAt (开始处理时间戳)
 *   - state
 *
 * tick(now): 推进 PROCESSING 状态,完成时切到 READY
 * put(itemId): 玩家放入物品,匹配配方,启动处理
 * take(): 玩家取出产出物,清空建筑
 *
 * 同一时间只处理一个 item。
 *
 * v1.0.0
 */
'use strict';

import { recipesForStation, getItem } from '../resources/catalog.js';

export const PROC_STATE = Object.freeze({
  EMPTY:      'empty',
  PROCESSING: 'processing',
  READY:      'ready'
});

/**
 * Station config — processTime defaults per station, in seconds.
 *   drying_rack       — 30s
 *   fermenting_barrel — 60s
 */
export const STATION_PROCESS_TIME = Object.freeze({
  drying_rack: 30,
  fermenting_barrel: 60
});

/**
 * Find a processing recipe whose pattern matches a single input item.
 */
function findRecipe(station, inputItemId) {
  for (const r of recipesForStation(station)) {
    const nonEmpty = r.pattern.filter(c => c !== '');
    if (nonEmpty.length === 1 && nonEmpty[0] === inputItemId) return r;
  }
  return null;
}

/**
 * A single processing station instance (drying_rack or fermenting_barrel).
 */
export class ProcessingStation {
  /**
   * @param {Object} opts
   * @param {string} opts.station  - 'drying_rack' | 'fermenting_barrel'
   * @param {string} [opts.entityId] - building entityId (assigned later)
   * @param {Object} [opts.snapshot] - for loadSnapshot
   */
  constructor({ station, entityId, snapshot } = {}) {
    if (!STATION_PROCESS_TIME[station]) {
      throw new Error(`Unknown processing station: ${station}`);
    }
    this.station = station;
    this.entityId = entityId || null;
    this.state = PROC_STATE.EMPTY;
    this.inputItemId = null;
    this.outputRecipe = null;
    this.startedAt = 0;
    this.durationSec = 0;
    if (snapshot) this.loadSnapshot(snapshot);
  }

  /**
   * Try to put an item into this station.
   * @param {string} itemId
   * @returns {ok: true, recipe} or {ok: false, reason}
   */
  put(itemId) {
    if (this.state !== PROC_STATE.EMPTY) {
      return { ok: false, reason: 'not_empty' };
    }
    const recipe = findRecipe(this.station, itemId);
    if (!recipe) {
      return { ok: false, reason: 'no_recipe', itemId };
    }
    this.inputItemId = itemId;
    this.outputRecipe = recipe;
    this.startedAt = Date.now();
    this.durationSec = recipe.processTime || STATION_PROCESS_TIME[this.station];
    this.state = PROC_STATE.PROCESSING;
    return { ok: true, recipe };
  }

  /**
   * Tick the station forward.
   * @param {number} now - Date.now() (or shim)
   * @returns {'advanced' | 'completed' | 'idle'}
   */
  tick(now) {
    if (this.state !== PROC_STATE.PROCESSING) return 'idle';
    const elapsed = (now - this.startedAt) / 1000;
    if (elapsed >= this.durationSec) {
      this.state = PROC_STATE.READY;
      return 'completed';
    }
    return 'advanced';
  }

  /**
   * Take the output. Returns:
   *   { ok: true, itemId, count, recipe }
   *   { ok: false, reason: 'not_ready' }
   */
  take() {
    if (this.state !== PROC_STATE.READY) {
      return { ok: false, reason: 'not_ready' };
    }
    const r = this.outputRecipe;
    const result = {
      ok: true,
      itemId: r.output.itemId,
      count: r.output.count,
      recipe: r
    };
    // reset
    this.state = PROC_STATE.EMPTY;
    this.inputItemId = null;
    this.outputRecipe = null;
    this.startedAt = 0;
    this.durationSec = 0;
    return result;
  }

  /**
   * Progress fraction [0..1] of the current processing.
   */
  progressFraction(now) {
    if (this.state !== PROC_STATE.PROCESSING) return 0;
    const elapsed = (now - this.startedAt) / 1000;
    return Math.min(1, elapsed / this.durationSec);
  }

  /**
   * Get the freshness multiplier for the input — drying rack triples the
   * freshness duration of meat (jerky has freshness 240 vs meat 80).
   * Returns 1.0 for non-dried items.
   */
  static freshMultiplier(inputId, outputId) {
    if (inputId === 'meat' && outputId === 'jerky') return 3.0;
    return 1.0;
  }

  serialize() {
    return {
      v: 1,
      station: this.station,
      entityId: this.entityId,
      state: this.state,
      inputItemId: this.inputItemId,
      outputRecipeId: this.outputRecipe?.id || null,
      startedAt: this.startedAt,
      durationSec: this.durationSec
    };
  }

  loadSnapshot(snap) {
    if (!snap || snap.v !== 1) return;
    this.state = snap.state || PROC_STATE.EMPTY;
    this.inputItemId = snap.inputItemId || null;
    this.startedAt = snap.startedAt || 0;
    this.durationSec = snap.durationSec || 0;
    if (snap.outputRecipeId) {
      const recs = recipesForStation(this.station);
      this.outputRecipe = recs.find(r => r.id === snap.outputRecipeId) || null;
    } else {
      this.outputRecipe = null;
    }
    this.entityId = snap.entityId || this.entityId;
  }
}

/**
 * Manager for multiple processing stations indexed by entityId.
 * Used by main.js to look up the right station when a building is clicked.
 */
export class ProcessingManager {
  constructor() {
    /** @type {Map<string, ProcessingStation>} */
    this.stations = new Map();
  }

  register(entityId, station) {
    station.entityId = entityId;
    this.stations.set(entityId, station);
  }

  unregister(entityId) {
    this.stations.delete(entityId);
  }

  get(entityId) {
    return this.stations.get(entityId) || null;
  }

  tickAll(now) {
    for (const s of this.stations.values()) s.tick(now);
  }

  serializeAll() {
    const out = {};
    for (const [id, s] of this.stations) {
      out[id] = s.serialize();
    }
    return out;
  }

  loadAll(snap) {
    if (!snap) return;
    for (const [id, s] of snap) {
      const st = new ProcessingStation({
        station: s.station,
        snapshot: s
      });
      this.register(id, st);
    }
  }
}
