/**
 * screenToWorld — inverse iso projection for click-to-world routing.
 * Pure function; no canvas side effects.
 */
'use strict';
import { TILE_W_HALF, TILE_H_HALF, worldToScreen } from './isometric.js';

/**
 * @param {number} mx    mouse x in canvas coords
 * @param {number} my    mouse y in canvas coords
 * @param {HTMLCanvasElement} canvas
 * @param {{x:number,y:number}} player
 * @param {{x:number,y:number}} camera
 * @returns {{x:number, y:number}} world (tile) coords
 */
export function screenToWorld(mx, my, canvas, player, camera) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const camScreen = worldToScreen(camera.x, camera.y);
  const wx = mx - (cx - camScreen.x);
  const wy = my - (cy - camScreen.y);
  // iso -> tile: x = (wx/TW + wy/TH), y = (wy/TH - wx/TW)
  const tx = (wx / TILE_W_HALF + wy / TILE_H_HALF) / 2;
  const ty = (wy / TILE_H_HALF - wx / TILE_W_HALF) / 2;
  return { x: tx, y: ty };
}
