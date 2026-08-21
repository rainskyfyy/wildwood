/**
 * Camera — viewport follow with screen culling.
 *
 * The camera holds a center point in world (tile) coords and an
 * orthogonal `scale` (default 1.0). `viewBounds()` returns the world
 * tile range visible on screen; the renderer uses this to skip tiles
 * outside the viewport (cull).
 *
 * Coordinates: the camera center is the world point that should appear
 * in the middle of the canvas. The renderer translates by
 * `canvas_w/2 - cameraXToScreen(camera.x)` etc.
 */

'use strict';

import { TILE_W_HALF, TILE_H_HALF } from '../render/isometric.js';

export class Camera {
  constructor({ viewportWidth, viewportHeight, scale = 1.0 } = {}) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.scale = scale;
    this.x = 0; // world x (tile units)
    this.y = 0; // world y (tile units)
  }

  follow(target) {
    // Smooth lerp — frame-rate friendly.
    const k = 0.18;
    this.x += (target.x - this.x) * k;
    this.y += (target.y - this.y) * k;
  }

  /**
   * World (tile) bounds visible on screen. Add a 1-tile margin so
   * partial tiles at the edge still get drawn.
   */
  viewBounds() {
    // Half-width in tiles, accounting for iso 2:1 ratio.
    const halfW = (this.viewportWidth / 2) / TILE_W_HALF + 1;
    const halfH = (this.viewportHeight / 2) / TILE_H_HALF + 1;
    return {
      x0: Math.floor(this.x - halfW),
      x1: Math.ceil(this.x + halfW),
      y0: Math.floor(this.y - halfH),
      y1: Math.ceil(this.y + halfH)
    };
  }
}
