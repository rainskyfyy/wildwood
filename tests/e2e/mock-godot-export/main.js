// Wildwood mock web bootstrap - M1.3 E2E target
//
// 真实 Godot web export 的 main.js 走 emscripten 加载 .wasm/.pck;
// 这里只模拟它的 DOM 行为,让 Playwright 跑通验收点 ③。
// 真正的 web build(M1.2 + M3.10)就绪后,这个文件会被 Godot 生成的 main.js 覆盖。

(function () {
  'use strict';

  var statusEl = document.getElementById('boot-status');
  var overlayEl = document.getElementById('overlay');

  function setBootStatus(state, label) {
    if (!statusEl) return;
    statusEl.setAttribute('data-boot-status', state);
    statusEl.textContent = label;
    if (state === 'ready' && overlayEl) {
      overlayEl.setAttribute('data-ready', 'true');
    }
  }

  // 启动序列:loading → fetching → ready
  // 真实 Godot 的 wasm fetch + instantiate 耗时几百毫秒到几秒不等,
  // 这里用 setTimeout 模拟这个过程,Playwright 默认等 5s 内 ready
  setBootStatus('loading', 'Loading…');

  setTimeout(function () {
    setBootStatus('fetching', 'Fetching engine…');

    // 在 canvas 上画一个简单标识(供截图回归)
    var canvas = document.getElementById('wildwood-canvas');
    if (canvas && canvas.getContext) {
      try {
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#c47a3d';
        ctx.fillRect(canvas.width / 2 - 24, canvas.height / 2 - 24, 48, 48);
        ctx.fillStyle = '#f5e7c8';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Wildwood M1.3', canvas.width / 2, canvas.height / 2 + 60);
      } catch (e) {
        // canvas 2d 不可用不影响 boot status 切到 ready
        console.warn('MOCK: canvas 2d unavailable, %s', e && e.message);
      }
    }

    setTimeout(function () {
      setBootStatus('ready', 'Ready');
      // 暴露给 Playwright 用的钩子
      window.__WILDWOOD_BOOT_OK__ = true;
      window.__WILDWOOD_BUILD_VERSION__ = '0.1.0-mock';
    }, 200);
  }, 150);

  // 标记当前为 mock,Playwright 端按需过滤
  window.__WILDWOOD_MOCK__ = true;
})();
