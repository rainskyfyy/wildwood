/**
 * Minimap — 小地图 (M2.12 DOM 版)
 *
 * M2.12 changes vs M4 Canvas 绘制:
 *   - 不再画主 canvas 的 ctx,改为在 .MinimapCanvas(200x200 DOM 元素)上画
 *   - 玩家点(中央)/队友点(4 队伍色)/POI 点(琥珀菱形)用绝对定位的 <div>
 *     来自 M1.8 components.css 的 .Minimap-PlayerDot/-PartyDot/-POIDot
 *   - 摄像机视口框:用 <div> 绝对定位 + border 表示
 *   - 节流由 HUD.draw 负责
 *
 * 容器结构(M1.7 .Anchor-BR):
 *   <div class="Anchor-BR">
 *     <div class="Minimap">
 *       <canvas class="MinimapCanvas" width="200" height="200"></canvas>
 *       <div class="Minimap-PlayerDot"></div>
 *       <div class="Minimap-PartyDot Minimap-PartyDot-Party-2" style="top:30%;left:40%"></div>
 *       ...
 *       <div class="Minimap-Compass">...</div>
 *     </div>
 *   </div>
 *
 * 性能:
 *   - 200x200 像素 = 40000 像素,每 200ms 重画,5Hz,无性能压力
 *   - 不用 putImageData 整块重写,逐 fillRect 也可(5Hz 下都够快)
 */

'use strict';

import { getBiome } from '../world/biome-config.js';

const DEFAULT_W = 200;
const DEFAULT_H = 200;

export class Minimap {
  constructor(containerEl, opts) {
    opts = opts || {};
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.w = opts.w || DEFAULT_W;
    this.h = opts.h || DEFAULT_H;

    this.container = containerEl || null;
    this.minimapEl = this.container ? this.container.querySelector('.Minimap') : null;
    this.canvasEl = this.minimapEl ? this.minimapEl.querySelector('.MinimapCanvas') : null;
    this.ctx = this.canvasEl ? this.canvasEl.getContext('2d') : null;

    // 摄像机视口框 DOM(动态创建,因为 M1.8 components.css 没提供)
    if (this.minimapEl && !this.minimapEl.querySelector('.Minimap-ViewportRect')) {
      var rect = document.createElement('div');
      rect.className = 'Minimap-ViewportRect';
      // 最小样式(不影响 M1.8 视觉)
      rect.style.position = 'absolute';
      rect.style.border = '1px solid rgba(255, 255, 255, 0.85)';
      rect.style.pointerEvents = 'none';
      rect.style.boxSizing = 'border-box';
      this.minimapEl.appendChild(rect);
      this.viewportRectEl = rect;
    } else {
      this.viewportRectEl = null;
    }
  }

  /**
   * @param {import('../world/generator.js').WorldGrid} world
   * @param {import('../player/camera.js').Camera} camera
   */
  draw(world, camera) {
    if (!this.ctx || !world) return;
    var ctx = this.ctx;
    var w = this.canvasEl.width;
    var h = this.canvasEl.height;
    // 1. 清屏
    ctx.clearRect(0, 0, w, h);
    // 2. 画世界(按 4:1 缩放,80x60 世界 → 200x200 小地图,1:2.5)
    var sx = w / world.width;
    var sy = h / world.height;
    for (var wy = 0; wy < world.height; wy++) {
      for (var wx = 0; wx < world.width; wx++) {
        var id = world.getTile(wx, wy);
        if (!id) continue;
        var biome = getBiome(id);
        ctx.fillStyle = biome.primary;
        var px = Math.floor(wx * sx);
        var py = Math.floor(wy * sy);
        var pw = Math.max(1, Math.ceil(sx));
        var ph = Math.max(1, Math.ceil(sy));
        ctx.fillRect(px, py, pw, ph);
      }
    }
    // 3. 摄像机视口框(在 MinimapCanvas 内)
    var bounds = camera.viewBounds();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      bounds.x0 * sx,
      bounds.y0 * sy,
      (bounds.x1 - bounds.x0) * sx,
      (bounds.y1 - bounds.y0) * sy
    );
    // 4. 玩家点(琥珀)
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(camera.x * sx, camera.y * sy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. 外部视口框(在 .Minimap 容器上叠一个 div,便于响应式)
    if (this.viewportRectEl) {
      var ox = (bounds.x0 / world.width) * 100;
      var oy = (bounds.y0 / world.height) * 100;
      var ow = ((bounds.x1 - bounds.x0) / world.width) * 100;
      var oh = ((bounds.y1 - bounds.y0) / world.height) * 100;
      this.viewportRectEl.style.left = ox + '%';
      this.viewportRectEl.style.top = oy + '%';
      this.viewportRectEl.style.width = ow + '%';
      this.viewportRectEl.style.height = oh + '%';
    }
  }
}
