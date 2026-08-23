/**
 * TickStateService — v0.8.2a
 *
 * 5Hz 全局 tick 状态的**唯一** mutation 入口。基于 v0.8.0a 装配层
 * pass-through 冻结约定,UI 面板 / 数据可视化只读访问走 pass-through
 * (`game.tickStateView`),任何写必须走本 service(挂载到
 * `game.tickStateSvc`)。
 *
 * 角色对照(v0.8.2a):
 *   - `game.tickStateSvc`  ← 唯一 mutation 入口(setRate / pause /
 *                             resume / start / stop / fireOnce /
 *                             subscribe)
 *   - `game.tickStateView` ← 唯一 read 入口(getState / subscribe
 *                             delegate),挂到装配层后被 v0.8.0a 字段级
 *                             freeze 锁住引用;UI 代码只走 view。
 *
 * 兼容性:
 *   - 替换了 src/ui/sync/tickState.js 里 IIFE 维护的私有 intervalId /
 *     tickMs / paused / tickCount / subscribers 状态;tickState.js 改为
 *     薄壳 IIFE,装配完成后所有方法委托到本 service(保持 window.__tickState
 *     仍可用,但内部走 svc)。
 *   - 仍 emit 'tick' 到 `window.__hudBus`,与 v0.5.x trading.js /
 *     npc.js 兼容(roadmap v0.7.2a 计划砍掉,本任务保留以免破坏现有 UI)。
 *
 * 设计原则:
 *   - 不可自动启动 — 装配层显式 `tickStateSvc.start()`(避免模块副作用)。
 *   - 不依赖 window — 全部状态封闭在实例里(window 桥接在 tickState.js
 *     IIFE 负责)。
 *   - 内部状态(`_tickMs / _paused / _tickCount / _subscribers / _intervalId`)
 *     是实例 own props,不受 v0.8.0a 字段级 freeze 影响 — 装配层只锁
 *     `game.tickStateSvc` 引用,实例内部 mutation 是合法 svc 行为。
 *   - 'use strict' 顶部声明:订阅者回调内 mutation 抛错也会冒泡
 *     (单个订阅者 try/catch 在 _tick 内,不影响其他订阅者)。
 *
 * Run: `node tests/m8.2a-tickstate-bridge.mjs`
 */
'use strict';

const DEFAULT_TICK_MS = 200;   // 5Hz
const MIN_TICK_MS = 16;         // 60Hz 上限(防止调过快烧 CPU)

/**
 * @typedef {Object} TickStateSnapshot
 * @property {number}  rate         — 当前 tick 间隔 ms
 * @property {boolean} paused       — 是否已 pause
 * @property {boolean} running      — setInterval 是否激活
 * @property {number}  tickCount    — 已 tick 次数(单调)
 * @property {number}  subscribers  — 当前订阅者数量
 * @property {number}  uptime       — 距 startTime 的 ms
 */

export class TickStateService {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.defaultMs=200]
   * @param {number} [opts.minMs=16]
   * @param {() => number} [opts.now] — performance.now 替代,测试用
   * @param {(type:string, detail:any) => void} [opts.emitHudBus] — 默认
   *   emit 到 `window.__hudBus('tick', detail)`;测试可注入
   *   noop 或 spy。
   */
  constructor({ defaultMs = DEFAULT_TICK_MS, minMs = MIN_TICK_MS, now, emitHudBus } = {}) {
    this._defaultMs = defaultMs;
    this._minMs = minMs;
    this._now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this._emitHudBus = emitHudBus || null;   // 装配层装配时由 tickState.js 注入

    // 内部状态(实例 own props,装配层字段级 freeze 不影响)
    this._tickMs = defaultMs;
    this._paused = false;
    this._tickCount = 0;
    this._startTime = 0;
    this._intervalId = null;
    this._subscribers = [];
  }

  // ─── Read(公开只读 view 也用这些 getter)────────────────

  /** @returns {number} 当前 tick 间隔 ms */
  get rate() { return this._tickMs; }

  /** @returns {boolean} */
  get paused() { return this._paused; }

  /** @returns {number} 已 tick 次数 */
  get tickCount() { return this._tickCount; }

  /** @returns {boolean} */
  get running() { return this._intervalId != null; }

  /** @returns {number} 当前订阅者数量 */
  get subscriberCount() { return this._subscribers.length; }

  /**
   * 一次性快照。返回值是 plain object(非 frozen),装配层 view 会再
   * freeze 一层保证 UI 拿到的不可写。
   * @returns {TickStateSnapshot}
   */
  getState() {
    return {
      rate: this._tickMs,
      paused: this._paused,
      running: this._intervalId != null,
      tickCount: this._tickCount,
      subscribers: this._subscribers.length,
      uptime: this._intervalId != null
        ? this._now() - this._startTime
        : 0,
    };
  }

  // ─── Mutate(单一入口)─────────────────────────────

  /**
   * 启动 tick 主循环。多次调用幂等。
   */
  start() {
    if (this._intervalId != null) return;
    this._startTime = this._now();
    this._intervalId = setInterval(() => this._tick(), this._tickMs);
  }

  /**
   * 完全停止 tick。`start()` 之前不可恢复(tickCount 保留)。
   */
  stop() {
    if (this._intervalId != null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * 动态调整频率(Hz × 1000 = ms)。若正在运行则重启以生效。
   * @param {number} ms
   */
  setRate(ms) {
    const next = Math.max(this._minMs, Math.floor(Number(ms) || this._defaultMs));
    if (next === this._tickMs) return;
    this._tickMs = next;
    if (this._intervalId != null) {
      clearInterval(this._intervalId);
      this._startTime = this._now();
      this._intervalId = setInterval(() => this._tick(), this._tickMs);
    }
  }

  /** 暂停 tick(订阅者不再被调用,直到 resume)。 */
  pause() {
    this._paused = true;
  }

  /** 恢复 tick。 */
  resume() {
    this._paused = false;
  }

  /**
   * 手动触发一次 tick(用于演示/测试/进度推进)。pause 时仍会触发
   * (与 setInterval 行为一致 — pause 仅影响周期触发)。
   * @returns {Object|null} 触发时推送给订阅者的 detail,或 null(无订阅者)
   */
  fireOnce() {
    return this._tick();
  }

  /**
   * 注入 hudBus 转发器(默认从 tickState.js 桥接 window.__hudBus.emit)。
   * 装配层装配完成、调用 `tickStateSvc.start()` 之前调用一次即可。
   * @param {(type:string, detail:any) => void} fn
   */
  setHudBusEmitter(fn) {
    this._emitHudBus = fn;
  }

  /**
   * 订阅 tick。返回 unsubscribe 函数。
   * @param {(detail: {t:number, n:number, ms:number, immediate?:boolean}) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._subscribers.push(fn);
    // 立即推一次,新订阅者无需等下一个 tick
    try {
      fn({ t: 0, n: this._tickCount, ms: this._tickMs, immediate: true });
    } catch (_) { /* ignore subscriber throw on immediate */ }
    return () => {
      const i = this._subscribers.indexOf(fn);
      if (i >= 0) this._subscribers.splice(i, 1);
    };
  }

  // ─── 内部 tick 循环 ────────────────────────────────────

  _tick() {
    if (this._paused) return null;
    this._tickCount += 1;
    const t = this._now() - this._startTime;
    const detail = { t, n: this._tickCount, ms: this._tickMs };
    // 1. 通知订阅者(单个抛错不影响其他)
    for (let i = 0; i < this._subscribers.length; i++) {
      try {
        this._subscribers[i](detail);
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[TickStateService] subscriber error', e);
        }
      }
    }
    // 2. 兼容:转发到 hudBus('tick')(v0.5.x trading.js / npc.js 订阅)
    if (this._emitHudBus) {
      try { this._emitHudBus('tick', detail); } catch (_) { /* ignore */ }
    }
    return detail;
  }
}

/**
 * 工厂 — 取代 IIFE 形式,与 InventoryService / EventService 等保持一致。
 * @param {Object} [opts]
 */
export function createTickStateService(opts) {
  return new TickStateService(opts);
}

export { DEFAULT_TICK_MS, MIN_TICK_MS };
