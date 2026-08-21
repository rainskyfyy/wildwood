/**
 * Isometric projection helpers — 45° top-down diamond view.
 *
 * Coordinate spaces:
 *   world tile (x, y)  →  screen pixel (sx, sy)
 *   sx = (x - y) * TILE_W_HALF
 *   sy = (x + y) * TILE_H_HALF
 *
 * Tile dims (TILE_SIZE=32):
 *   W on screen = 32,  H on screen = 16   → 2:1 ratio
 *
 * We treat the player as also occupying a tile (x, y) with a sub-tile offset
 * for smooth movement; the same projection is reused.
 */

'use strict';

export const TILE_SIZE = 32;
export const TILE_W_HALF = TILE_SIZE / 2;       // 16
export const TILE_H_HALF = TILE_SIZE / 4;       // 8

/**
 * Tile (tx, ty) → screen center (sx, sy) for its top face.
 */
export function tileToScreen(tx, ty) {
  return {
    x: (tx - ty) * TILE_W_HALF,
    y: (tx + ty) * TILE_H_HALF
  };
}

/**
 * World (sub-tile) position → screen pixel.
 * The player uses fractional tile coords (e.g. 12.4) so this is the
 * "draw the sprite at the right place" helper.
 */
export function worldToScreen(wx, wy) {
  return {
    x: (wx - wy) * TILE_W_HALF,
    y: (wx + wy) * TILE_H_HALF
  };
}

/**
 * Screen pixel → tile (tx, ty). Used by mouse picking (not used by M4 yet
 * but cheap to include for future M5 interaction).
 */
export function screenToTile(sx, sy) {
  return {
    x: (sx / TILE_W_HALF + sy / TILE_H_HALF) * 0.5,
    y: (sy / TILE_H_HALF - sx / TILE_W_HALF) * 0.5
  };
}

/**
 * Depth sort key for an entity at (wx, wy). Larger = drawn later (in front).
 * In iso view, the tile further "down-right" appears in front.
 */
export function depthKey(wx, wy) {
  return wx + wy;
}
