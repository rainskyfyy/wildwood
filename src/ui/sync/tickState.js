/**
 * Wildwood UI · v0.6.4a 5Hz 同步抽象(v0.8.2a 薄壳化)
 *
 * 角色(v0.8.2a 起):
 *   - IIFE 维护 `window.__tickState` 全局对象(向后兼容 v0.6.4a
 *     起的 NPCAffinityBar.js / trading.js / npc.js 等消费者)。
 *   - **所有状态(tickMs/paused/tickCount/intervalId/subscribers)
 *     委托给装配层创建的 `TickStateService`**。IIFE 不再持有
 *     私有 interval 状态。
 *   - 装配层 `assembleGame()` 完成时调用 `__tickState.__bindService(svc)`,
 *     所有 mutation 方法(setRate / pause / resume / start / stop /
 *     fireOnce / subscribe)立刻转发到 svc。
 *   - 装配前(裸 demo / 单元测试场景)IIFE 自建一个内部 svc,提供
 *     默认 5Hz 行为,保证零装配也能跑。
 *
 * 桥接边界(必读):
 *   - UI 组件 / 数据可视化 → 拿 `game.tickStateView` 读状态、订阅 tick
 *   - 管理代码 / 调试面板 → 拿 `game.tickStateSvc` 改状态
 *   - `window.__tickState` 是过渡桥,只用于 IIFE 注入或独立 demo;
 *     装配完成后,它的所有方法都委托 svc。
 *   - UI 代码**禁止** import `TickStateService` 直接调 setRate —
 *     漂移检测 `tools/check-fixture-drift.mjs` 会扫到这种引用。
 *
 * 兼容性:
 *   - 自动向 window.__hudBus emit('tick', { t }) — 兼容 trading.js / npc.js
 *   - M2.12 hud.js 仍可独立运行(若它先初始化)
 *   - 此模块后于 hud.js 加载时,会接管 tick 主循环
 *
 * 安全:
 *   - 不依赖 ESM,普通 <script> 加载
 *   - 无 DOM 时不抛错
 *   - 多次加载幂等(检测已存在 __tickState 跳过)
 */

(function () {
  'use strict';

  if (window.__tickState) {
    return; // 幂等:避免重复加载
  }

  // ─── 默认占位 svc(装配前,允许独立运行)────────────────
  // 装配层 assembleGame 完成后会调 __bindService(realSvc),占位 svc
  // 被替换;之后所有方法转发到 realSvc。
  const { createTickStateService } = (function () {
    // 这里走动态 import 拿 svc 类,避免硬依赖 ESM。
    // 但因为本文件是 IIFE 不是 ESM,实际不能 import。改成占位实现,
    // 装配层用真实 svc 替换。
    return { createTickStateService: null };
  })();

  /**
   * 占位 svc(装配前用)— 行为和真 svc 一致:start/setRate/pause/resume/
   * subscribe / fireOnce 全部自己实现,只差没有 setHudBusEmitter 这种
   * 装配钩子。装配后被真 svc 替换。
   */
  function createPlaceholderService() {
    return {
      _tickMs: 200,
      _paused: false,
      _tickCount: 0,
      _intervalId: null,
      _subscribers: [],
      _startTime: 0,
      _emitHudBus: null,
      get rate() { return this._tickMs; },
      get paused() { return this._paused; },
      get tickCount() { return this._tickCount; },
      get running() { return this._intervalId != null; },
      get subscriberCount() { return this._subscribers.length; },
      getState() {
        return {
          rate: this._tickMs,
          paused: this._paused,
          running: this._intervalId != null,
          tickCount: this._tickCount,
          subscribers: this._subscribers.length,
          uptime: this._intervalId != null
            ? (performance.now ? performance.now() : Date.now()) - this._startTime
            : 0,
        };
      },
      start() {
        if (this._intervalId != null) return;
        this._startTime = performance.now ? performance.now() : Date.now();
        this._intervalId = setInterval(() => this._tick(), this._tickMs);
      },
      stop() {
        if (this._intervalId != null) {
          clearInterval(this._intervalId);
          this._intervalId = null;
        }
      },
      setRate(ms) {
        const next = Math.max(16, Math.floor(Number(ms) || 200));
        if (next === this._tickMs) return;
        this._tickMs = next;
        if (this._intervalId != null) {
          clearInterval(this._intervalId);
          this._startTime = performance.now ? performance.now() : Date.now();
          this._intervalId = setInterval(() => this._tick(), this._tickMs);
        }
      },
      pause() { this._paused = true; },
      resume() { this._paused = false; },
      fireOnce() { return this._tick(); },
      subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        this._subscribers.push(fn);
        try { fn({ t: 0, n: this._tickCount, ms: this._tickMs, immediate: true }); } catch (_) {}
        return () => {
          const i = this._subscribers.indexOf(fn);
          if (i >= 0) this._subscribers.splice(i, 1);
        };
      },
      setHudBusEmitter(fn) { this._emitHudBus = fn; },
      _tick() {
        if (this._paused) return null;
        this._tickCount += 1;
        const t = (performance.now ? performance.now() : Date.now()) - this._startTime;
        const detail = { t, n: this._tickCount, ms: this._tickMs };
        for (let i = 0; i < this._subscribers.length; i++) {
          try { this._subscribers[i](detail); } catch (e) {
            if (window.console && console.warn) console.warn('[tickState] subscriber error', e);
          }
        }
        if (this._emitHudBus) {
          try { this._emitHudBus('tick', detail); } catch (_) { /* ignore */ }
        }
        return detail;
      }
    };
  }

  // 启动占位 svc(无装配时的默认行为)
  let _svc = createPlaceholderService();
  let _hudBusEmitterBound = false;
  _svc.start();

  // ─── window.__tickState 公开 API(全部委托 _svc)────────────

  const _api = {
    /** @returns {{rate,paused,running,tickCount,subscribers,uptime}} */
    getState() { return Object.freeze(_svc.getState()); },

    /** 订阅 tick */
    subscribe(fn) { return _svc.subscribe(fn); },

    /** 动态调整频率(ms) */
    setRate(ms) { _svc.setRate(ms); },

    /** 当前频率 */
    getRate() { return _svc.rate; },

    /** 已 tick 次数 */
    getTickCount() { return _svc.tickCount; },

    /** 暂停 */
    pause() { _svc.pause(); },

    /** 恢复 */
    resume() { _svc.resume(); },

    /** 完全停止(不可恢复,需 restart) */
    stop() { _svc.stop(); },

    /** 重启 */
    start() { _svc.start(); },

    /** 手动触发一次 */
    fireOnce() { return _svc.fireOnce(); },

    /**
     * v0.8.2a:装配层调用,绑定真实 svc。占位 svc 被替换。
     * 调用前若占位 svc 已 start,会 stop 然后迁移状态。
     * @param {Object} realSvc — TickStateService 实例
     * @param {Object} [opts]
     * @param {boolean} [opts.migrateSubscribers=true] — 占位 svc 的
     *   订阅者迁移到 realSvc(独立 demo 已订阅的回调不丢)
     * @param {boolean} [opts.restart=true] — 替换后由 realSvc 启动
     */
    __bindService(realSvc, opts) {
      if (!realSvc || typeof realSvc.getState !== 'function') {
        throw new TypeError('__bindService: realSvc must be a TickStateService');
      }
      opts = opts || {};
      const migrateSubs = opts.migrateSubscribers !== false;
      const restart = opts.restart !== false;

      // 1. 停掉占位 svc
      if (_svc && _svc.running) _svc.stop();
      // 2. 迁移订阅者(若占位 svc 有人在跑 demo 时已订阅)
      if (migrateSubs && _svc && _svc._subscribers && _svc._subscribers.length) {
        for (const fn of _svc._subscribers) {
          realSvc.subscribe(fn);
        }
      }
      // 3. 桥接 hudBus('tick')(装配前 tickState.js IIFE 自己转发)
      if (!_hudBusEmitterBound) {
        realSvc.setHudBusEmitter(emitHudBus);
        _hudBusEmitterBound = true;
      }
      // 4. 切换 + 启动
      _svc = realSvc;
      if (restart) realSvc.start();
    },

    /**
     * 内部 / 测试用:返回当前底层 svc 引用(只读,UI 不该拿)。
     * 漂移检测会扫 UI 代码是否调用了此方法 — 抓到就报警告。
     */
    __service() { return _svc; },

    /**
     * 内部 / 测试用:重置回占位 svc(测试隔离用)。
     * 装配后不应调用,会断开已绑定的真实 svc。
     */
    __reset() {
      if (_svc && _svc.running) _svc.stop();
      _svc = createPlaceholderService();
      _hudBusEmitterBound = false;
      _svc.start();
    }
  };

  // ─── hudBus 桥接(占位 svc / 真实 svc 启动时都生效)──────

  function emitHudBus(type, detail) {
    if (window.__hudBus && typeof window.__hudBus.emit === 'function') {
      try { window.__hudBus.emit(type, detail); } catch (_) { /* ignore */ }
    }
  }

  // 占位 svc 自身没启 hudBus emit,这里手动给占位 svc 注入
  _svc.setHudBusEmitter(emitHudBus);

  window.__tickState = _api;

  // 占位 hudBus(若 hud.js 还未加载)
  if (!window.__hudBus) {
    var placeholder = document.createTextNode(null);
    window.__hudBus = {
      emit: function (type, detail) {
        var evt;
        try { evt = new CustomEvent(type, { detail: detail, bubbles: false }); }
        catch (e) { evt = document.createEvent('CustomEvent'); evt.initCustomEvent(type, false, false, detail); }
        placeholder.dispatchEvent(evt);
      },
      on: function (type, handler) {
        placeholder.addEventListener(type, function (e) { handler(e.detail); });
      },
      off: function (type, handler) {
        placeholder.removeEventListener(type, handler);
      }
    };
  }
})();
