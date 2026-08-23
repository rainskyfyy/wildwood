/**
 * main.js — v0.6.0a
 *
 * 入口:装配 → 启动帧循环。
 *
 * 调用方:HTML <script type="module" src="src/main.js"> 加载后
 * 在 window.bootGame 暴露 bootGame(canvas, opts)。
 *
 * opts 同 v0.5:
 *   - mode = 'offline' (default) | 'host' | 'join'
 *   - client       — RelayClient(已连接)
 *   - session      — Session(已 host/join 完成)
 *   - playerName   — 玩家名
 */
'use strict';

import { assembleGame } from './assembly.js';
import { startRuntime } from './runtime.js';

/**
 * 启动 Wildwood 游戏。
 * @param {HTMLCanvasElement} canvas
 * @param {Object} [opts]
 * @returns {{ game: Object, runtime: Object }}
 *   - game: 装配好的游戏状态对象
 *   - runtime: 帧循环控制句柄(stop / running)
 */
export function bootGame(canvas, opts = {}) {
  const game = assembleGame(canvas, opts);
  const runtime = startRuntime(game);
  return { game, runtime };
}

// 暴露到 window,供非 module 化的旧入口与 e2e 测试使用
if (typeof window !== 'undefined') {
  window.bootGame = bootGame;
}
