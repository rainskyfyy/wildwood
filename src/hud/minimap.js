/**
 * Minimap — top-right corner thumbnail of the world.
 *
 * Draws the full world as a small grid of biome-colored squares
 * (one per tile), with the camera viewport shown as a translucent
 * rectangle overlay so the player can see where they are.
 *
 * Dimensions: 160x120 px by default; one tile = 1 px, so a 160x120
 * world is shown — for larger worlds we downsample. M4 demo uses a
 * 80x60 world (small enough to fit at 1:1).
 */

'use strict';

import { getBiome } from '../world/biome-config.js';

const DEFAULT_W = 160;
const DEFAULT_H = 120;

export class Minimap {
  constructor(ctx, { x, y, w = DEFAULT_W, h = DEFAULT_H } = {}) {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  /**
   * @param {import('../world/generator.js').WorldGrid} world
   * @param {import('../player/camera.js').Camera} camera
   */
  draw(world, camera) {
    const ctx = this.ctx;
    // Frame.
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(this.x - 3, this.y - 3, this.w + 6, this.h + 18);
    // Title strip.
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(this.x - 3, this.y - 3, this.w + 6, 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('地图 / ' + this._currentBiomeLabel(world, camera), this.x, this.y + 3);

    // World → minimap scale.
    const sx = this.w / world.width;
    const sy = this.h / world.height;

    // World tiles.
    const img = ctx.getImageData(this.x, this.y + 12, this.w, this.h);
    const data = img.data;
    for (let wy = 0; wy < world.height; wy++) {
      for (let wx = 0; wx < world.width; wx++) {
        const id = world.getTile(wx, wy);
        const biome = getBiome(id);
        const rgb = hexToRgb(biome.primary);
        // Map (wx, wy) to minimap pixel. Use a 2x2 footprint so each
        // minimap pixel covers a 2x2 world tile area (4:1 reduction).
        const px = Math.floor(wx * sx);
        const py = Math.floor(wy * sy);
        const i = (py * this.w + px) * 4;
        if (i + 3 < data.length) {
          data[i]     = rgb.r;
          data[i + 1] = rgb.g;
          data[i + 2] = rgb.b;
          data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, this.x, this.y + 12);

    // Camera viewport overlay.
    const bounds = camera.viewBounds();
    const ox = this.x + bounds.x0 * sx;
    const oy = this.y + 12 + bounds.y0 * sy;
    const ow = (bounds.x1 - bounds.x0) * sx;
    const oh = (bounds.y1 - bounds.y0) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, ow, oh);

    // Player dot.
    const px = this.x + camera.x * sx;
    const py = this.y + 12 + camera.y * sy;
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _currentBiomeLabel(world, camera) {
    const id = world.getTile(Math.floor(camera.x), Math.floor(camera.y));
    return id ? getBiome(id).name : '?';
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}
