/**
 * v0.6.0a — 启动入口
 * 加载顺序(HTML <script>):assembly.js → runtime.js → main.js
 * 业务拆分详见 ./assembly.js(装配)和 ./runtime.js(主循环)。
 */
'use strict';

import { assembleGame } from './assembly.js';
import { startRuntime } from './runtime.js';

export function bootGame(canvas, opts = {}) {
  const ctx = assembleGame(canvas, opts);
  const stop = startRuntime(ctx);
  return { ...ctx, stop };
}
