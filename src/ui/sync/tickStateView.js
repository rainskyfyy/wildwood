/**
 * tickStateView.js — v0.8.2a
 *
 * TickStateService 的 UI 只读视图。装配层把本 view 挂到
 * `game.tickStateView`,v0.8.0a 字段级 freeze 锁住引用;UI 组件
 * (HUD / 数据可视化 / 调试面板)只能通过 view 读状态、订阅 tick。
 *
 * 桥接边界(配合装配层):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ assembly.js 装配阶段(单次)                  │
 *   │  - new TickStateService() → game.tickStateSvc│
 *   │  - new TickStateView(svc) → game.tickStateView│
 *   │  - freezePassThroughs(game, [...svc, view]) │
 *   │  - tickStateSvc.start()                     │
 *   └─────────────────────────────────────────────┘
 *            │                       │
 *            ▼                       ▼
 *   ┌────────────────┐      ┌────────────────────┐
 *   │ game.tickStateSvc│      │ game.tickStateView  │
 *   │  唯一 mutation  │      │  唯一 read          │
 *   │  (svc 写)       │      │  (pass-through 读)  │
 *   └────────────────┘      └────────────────────┘
 *            ▲                       ▲
 *   UI 不直接持有                UI 组件全部
 *   (只有装配层持有)             通过此 view 读
 *
 * 反模式(漂移检测会抓):
 *   ❌ UI 组件 import `TickStateService` 直接调 setRate/pause/resume
 *      → 绕过 view,但事实上能跑(view 没禁)。漂移检测会警告
 *      "src/ui/* 引用了 svc"。
 *   ❌ 测试 fixture 直接 mutate `tickState._tickMs = 50` 等私有字段
 *      → 漂移检测会抓 `_tickMs` / `_paused` 等带下划线字段访问。
 *   ❌ 测试 fixture 在 UI 端调 `view.setRate(100)` 期望工作
 *      → view 显式抛 `ReadOnlyViewError`,测试应改用 svc。
 *
 * Run: `node tests/m8.2a-tickstate-bridge.mjs`
 */
'use strict';

import { TickStateService } from '../../services/TickStateService.js';

/** 视图层调用 setRate / pause / resume 时抛的错误。 */
export class ReadOnlyViewError extends TypeError {
  constructor(method) {
    super(
      `TickStateView.${method}() is read-only; ` +
      `mutate via game.tickStateSvc.${method}()`
    );
    this.name = 'ReadOnlyViewError';
  }
}

export class TickStateView {
  /**
   * @param {TickStateService} svc — 装配层注入
   */
  constructor(svc) {
    if (!svc || typeof svc.getState !== 'function' || typeof svc.subscribe !== 'function') {
      throw new TypeError('TickStateView: svc must be a TickStateService instance');
    }
    this._svc = svc;
  }

  /**
   * 一次性快照。返回值 frozen — UI 端即便直接写 `s.rate = 99` 也无效。
   * @returns {Readonly<TickStateSnapshot>}
   */
  getState() {
    return Object.freeze(this._svc.getState());
  }

  /**
   * 订阅 tick,等同 svc.subscribe。
   * 注:虽然 subscribe 在 svc 看来是 mutation(改 _subscribers),
   * 但 UI 视角只是"读" — 委托给 svc 完成实际 mutation。
   * @param {(detail: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    return this._svc.subscribe(fn);
  }

  // ─── 显式拒绝写 ────────────────────────────────────
  // 任何写方法都抛 ReadOnlyViewError。fixture / 测试 / 调试面板想改状态
  // 必须走 game.tickStateSvc。这样漂移检测扫 UI 代码时,如果发现
  // 它 import svc 直接 setRate,就报警告(规约 UI 走 view);如果发现
  // 它在 view 上调 setRate,运行时直接抛错(双保险)。

  /** @throws {ReadOnlyViewError} */
  setRate() { throw new ReadOnlyViewError('setRate'); }
  /** @throws {ReadOnlyViewError} */
  pause()   { throw new ReadOnlyViewError('pause'); }
  /** @throws {ReadOnlyViewError} */
  resume()  { throw new ReadOnlyViewError('resume'); }
  /** @throws {ReadOnlyViewError} */
  start()   { throw new ReadOnlyViewError('start'); }
  /** @throws {ReadOnlyViewError} */
  stop()    { throw new ReadOnlyViewError('stop'); }
  /** @throws {ReadOnlyViewError} */
  fireOnce(){ throw new ReadOnlyViewError('fireOnce'); }
  /** @throws {ReadOnlyViewError} */
  setHudBusEmitter() { throw new ReadOnlyViewError('setHudBusEmitter'); }
}

export function createTickStateView(svc) {
  return new TickStateView(svc);
}
