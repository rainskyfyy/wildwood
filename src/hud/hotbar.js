/**
 * Hotbar — 快捷栏 (M2.12 DOM 版)
 *
 * M2.12 changes vs M4 Canvas 绘制:
 *   - 不再画 ctx,改为读 M1.8 .HotbarSlot 组件的 DOM 类切换
 *   - 选中:加 HotbarSlot-Active 移 HotbarSlot-Default(components.css 决定视觉)
 *   - update() 仍然读 input.consumePressed,数字键 1-5 切选中
 *   - 节流由 HUD.draw 负责
 *
 * 容器结构(M1.7 .Anchor-BL):
 *   <div class="Anchor-BL">
 *     <div class="HotbarSlot HotbarSlot-Default"><span class="HotbarSlot-Key">1</span></div>
 *     <div class="HotbarSlot HotbarSlot-Active"> <span class="HotbarSlot-Key">2</span></div>
 *     ...
 *   </div>
 *
 * 注意:demo.html 内 src/ui/hud.js 已经有自己的 keydown 监听做切槽,
 * 这里保留 input.consumePressed 是为了与 M4 main.js 直接兼容(两路并存)
 */

'use strict';

const SLOT_COUNT = 5;  // M4 默认 5 槽(数字键 1-5);demo.html 7 槽中 6/7 是 disabled

export class Hotbar {
  constructor(containerEl, input) {
    this.input = input;
    this.selected = 0;
    this.container = containerEl || null;
    // 缓存所有 HotbarSlot 元素引用
    this.slots = this.container
      ? Array.prototype.slice.call(this.container.querySelectorAll('.HotbarSlot'))
      : [];
    // 同步初始选中(demo.html 现状:第 2 槽 active)
    this._syncDom();
  }

  /** 每帧调用:消费数字键 1-5 的 keydown edge. */
  update() {
    if (!this.input) return;
    for (var i = 0; i < SLOT_COUNT; i++) {
      if (this.input.consumePressed(String(i + 1))) {
        this.selected = i;
      }
    }
    this._syncDom();
  }

  /** @param {number} canvasWidth, canvasHeight — 兼容签名,本类不依赖 */
  draw(canvasWidth, canvasHeight) {
    this._syncDom();
  }

  /** DOM 同步:selected → HotbarSlot-Active,其余 HotbarSlot-Default. */
  _syncDom() {
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      if (s.getAttribute('aria-disabled') === 'true') continue;  // 跳过 6/7
      if (i === this.selected) {
        s.classList.add('HotbarSlot-Active');
        s.classList.remove('HotbarSlot-Default');
      } else {
        s.classList.remove('HotbarSlot-Active');
        s.classList.add('HotbarSlot-Default');
      }
    }
  }
}
