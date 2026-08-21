/**
 * HUD coordinator — wires Vitals / Hotbar / Minimap to M1.8 DOM components.
 *
 * M2.12 changes vs M4 Canvas 绘制:
 *   - Vitals/Hotbar/Minimap 不再画 ctx,改为读 M1.8 组件的 DOM 操作
 *   - draw() 内部 5Hz 节流(每 200ms 才更新一次 DOM),防止每帧操作 DOM 掉帧
 *   - 锚定区 DOM 已在 demo.html 内由 src/ui/hud.js 初始化,本类只更新
 *
 * API 兼容 main.js:draw(cw, ch, vitals, world, camera) / update() 签名不变
 */

'use strict';

import { Vitals } from './vitals.js';
import { Hotbar } from './hotbar.js';
import { Minimap } from './minimap.js';

const HUD_TICK_MS = 200;  // 5Hz 节流

export class HUD {
  constructor(ctx, input, world) {
    // ctx 仍保留签名兼容(可能 M5 main.js 还会传),但不画
    this.ctx = ctx;
    this.input = input;
    this.world = world;
    this.lastTickMs = 0;

    // 锚定区 DOM 引用(M1.7 .stage > .UILayer)
    var uiLayer = document.querySelector('.UILayer');
    if (!uiLayer) {
      // fallback:不抛错,M4 demo 可能没加载 src/ui/hud.js
      // 这种情况下 HUD 退化为 noop,Canvas 不会被画(但 main.js 仍可继续)
    }
    this.vitals = new Vitals(document.querySelector('.Anchor-TL'));
    this.hotbar = new Hotbar(document.querySelector('.Anchor-BL'), input);
    this.minimap = new Minimap(document.querySelector('.Anchor-BR'), { x: 0, y: 0, w: 200, h: 200 });

    // 与 src/ui/hud.js 顶层 EventTarget 总线打通
    this.hudBus = typeof window !== 'undefined' ? window.__hudBus : null;
  }

  /** Per-frame input edge processing(快捷栏数字键 1-5). */
  update() {
    if (this.hotbar) this.hotbar.update();
  }

  /**
   * @param {number} cw canvas width
   * @param {number} ch canvas height
   * @param {{hp:{cur,max}, hunger:{cur,max}, sanity:{cur,max}}} vitals
   * @param {import('../world/generator.js').WorldGrid} world
   * @param {import('../player/camera.js').Camera} camera
   */
  draw(cw, ch, vitals, world, camera) {
    // 5Hz 节流:每 200ms 才更新一次 DOM(M1.8 组件的 css 自身带 200ms transition)
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastTickMs < HUD_TICK_MS) return;
    this.lastTickMs = now;

    if (this.vitals)  this.vitals.draw(vitals);
    if (this.minimap) this.minimap.draw(world, camera);
    if (this.hotbar)  this.hotbar.draw(cw, ch);

    // 状态变化推给顶层 hudBus(M2.11 图鉴系统会订阅)
    if (this.hudBus && vitals) {
      this.hudBus.emit('vitals:change', {
        hp:     { cur: vitals.hp.cur,     max: vitals.hp.max },
        hunger: { cur: vitals.hunger.cur, max: vitals.hunger.max },
        sanity: { cur: vitals.sanity.cur, max: vitals.sanity.max }
      });
    }
  }
}
