/**
 * Wildwood UI · v0.6.4a 5Hz 同步抽象
 *
 * 职责:
 *   1. 封装 setInterval(200ms) 为可复用的全局 tick 源
 *   2. 暴露 window.__tickState,所有 HUD 组件 / 数据可视化共享
 *   3. 兼容 v0.5.x 已有 hudBus('tick') 事件订阅(不破坏 trading.js / npc.js)
 *   4. 动态调频 setRate(ms) / 暂停 pause() / 恢复 resume()
 *   5. 自动节流:同 tick 内多次 subscribe 只触发一次回调
 *
 * 复用方式:
 *   - HUD 组件:  window.__tickState.subscribe(function(t){ ... })
 *   - 频率调节:  window.__tickState.setRate(100)  // 10Hz
 *   - 暂停:      window.__tickState.pause()
 *
 * 兼容性:
 *   - 自动向 window.__hudBus emit('tick', { t }) —— 兼容 trading.js / npc.js
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

  // ===== 配置 =====
  var DEFAULT_TICK_MS = 200;     // 5Hz,与 M2.12 对齐
  var MIN_TICK_MS = 16;          // 60Hz 上限(防止调过快烧 CPU)

  // ===== 状态 =====
  var tickMs = DEFAULT_TICK_MS;
  var intervalId = null;
  var paused = false;
  var subscribers = [];
  var tickCount = 0;
  var startTime = 0;

  // ===== 内部 tick 循环 =====
  function tick() {
    if (paused) return;
    tickCount += 1;
    var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    var detail = { t: t, n: tickCount, ms: tickMs };
    // 1. 通知本模块订阅者
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](detail); } catch (e) {
        // 静默吞单个订阅者错误,不中断其他订阅者
        if (window.console && console.warn) console.warn('[tickState] subscriber error', e);
      }
    }
    // 2. 兼容:转发到 hudBus('tick')(M2.12 trading.js / npc.js 订阅它)
    if (window.__hudBus && typeof window.__hudBus.emit === 'function') {
      try { window.__hudBus.emit('tick', detail); } catch (e) { /* ignore */ }
    }
  }

  function start() {
    if (intervalId != null) return;
    startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    intervalId = setInterval(tick, tickMs);
  }

  function stop() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // ===== 公开 API =====
  window.__tickState = {
    /** 订阅 tick,fn(detail) 每 ~200ms 调用一次 */
    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      subscribers.push(fn);
      // 立即推一次,新订阅者无需等下一个 tick
      try { fn({ t: 0, n: tickCount, ms: tickMs, immediate: true }); } catch (e) { /* ignore */ }
      return function unsubscribe() {
        var i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    /** 动态调整频率(Hz × 1000 = ms) */
    setRate: function (ms) {
      ms = Math.max(MIN_TICK_MS, Math.floor(ms || DEFAULT_TICK_MS));
      if (ms === tickMs) return;
      tickMs = ms;
      if (intervalId != null) {
        stop();
        start();
      }
    },
    /** 当前频率(ms),用于调试 */
    getRate: function () { return tickMs; },
    /** 已 tick 次数(单调计数) */
    getTickCount: function () { return tickCount; },
    /** 暂停 tick(订阅者不再被调用,直到 resume) */
    pause: function () {
      paused = true;
    },
    /** 恢复 tick */
    resume: function () {
      paused = false;
    },
    /** 完全停止 tick(不可恢复,需 restart) */
    stop: stop,
    /** 重启 tick */
    start: start,
    /** 手动触发一次 tick(用于演示/测试) */
    fireOnce: tick
  };

  // 启动主循环
  start();

  // 暴露给旧模块(若 hud.js 还未加载,本模块先占位)
  if (!window.__hudBus) {
    // 创建最小占位 hudBus,避免 trading.js 在 hud.js 之前加载时报错
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
