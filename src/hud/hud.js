/**
 * HUD coordinator — draws vitals + hotbar + minimap.
 *
 * Owns the input singleton's per-frame updates and the layer order:
 * vitals (top-left) → minimap (top-right) → hotbar (bottom-center).
 */

'use strict';

import { Vitals } from './vitals.js';
import { Hotbar } from './hotbar.js';
import { Minimap } from './minimap.js';

export class HUD {
  constructor(ctx, input, world) {
    this.vitals = new Vitals(ctx);
    this.hotbar = new Hotbar(ctx, input);
    this.minimap = new Minimap(ctx, { x: 0, y: 0, w: 160, h: 120 });
  }

  /** Per-frame input edge processing. */
  update() {
    this.hotbar.update();
  }

  /**
   * @param {number} cw canvas width
   * @param {number} ch canvas height
   * @param {{hp, hunger, sanity}} vitals
   * @param {import('../world/generator.js').WorldGrid} world
   * @param {import('../player/camera.js').Camera} camera
   */
  draw(cw, ch, vitals, world, camera) {
    this.vitals.draw(vitals);
    this.minimap.x = cw - 160 - 12;
    this.minimap.y = 12;
    this.minimap.draw(world, camera);
    this.hotbar.draw(cw, ch);
  }
}
