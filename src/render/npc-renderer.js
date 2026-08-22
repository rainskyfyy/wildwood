/**
 * NPC renderer — draws piglins, village buildings, and followers.
 *
 * v0.5.4 doesn't have M3.13 art for piglins yet, so we use a
 * procedural piglin sprite: small pig head + body, color from
 * `piglin.config.color`. Chat bubble floats above the head when
 * `piglin.bubble()` returns one.
 *
 * Houses are drawn as 2x2 footprint boxes with a roof tint.
 * The trading post is drawn with a striped awning to stand out.
 *
 * Public API:
 *   drawPiglin(ctx, sx, sy, piglin)
 *   drawFollower(ctx, sx, sy, follower)
 *   drawBuilding(ctx, sx, sy, building)   — for village buildings
 *   drawBubble(ctx, sx, sy, text)
 */
'use strict';
import { TILE_W_HALF, TILE_H_HALF } from './isometric.js';

/**
 * Draw a piglin NPC at the given screen coords.
 * The piglin is centered on the tile (x, y).
 */
export function drawPiglin(ctx, screenX, screenY, piglin) {
  const cfg = piglin.config || { color: '#c87a8a', size: 0.7 };
  const sz = cfg.size || 0.7;
  const w = 8 * sz, h = 14 * sz;
  // Body (rounded rect).
  ctx.fillStyle = cfg.color;
  ctx.fillRect(screenX - w / 2, screenY - h, w, h * 0.7);
  // Head.
  ctx.beginPath();
  ctx.arc(screenX, screenY - h * 0.95, w * 0.55, 0, Math.PI * 2);
  ctx.fill();
  // Snout.
  ctx.fillStyle = '#e6a0b4';
  ctx.beginPath();
  ctx.ellipse(screenX, screenY - h * 0.85, w * 0.32, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes.
  ctx.fillStyle = '#000';
  ctx.fillRect(screenX - 1.5, screenY - h - 1, 1, 1);
  ctx.fillRect(screenX + 0.5, screenY - h - 1, 1, 1);
  // Affection hearts (0..3) above the head.
  if (piglin.affection > 0 && piglin.state !== 'dead') {
    drawHearts(ctx, screenX, screenY - h - 8, piglin.affection);
  }
  // HP bar (only when damaged).
  if (piglin.hp < piglin.maxHp && piglin.state !== 'dead') {
    const barW = 18, barH = 2;
    const bx = screenX - barW / 2, by = screenY - h - 4;
    ctx.fillStyle = '#400';
    ctx.fillRect(bx, by, barW, barH);
    const ratio = Math.max(0, piglin.hp / piglin.maxHp);
    ctx.fillStyle = ratio > 0.5 ? '#4c4' : ratio > 0.25 ? '#da4' : '#d44';
    ctx.fillRect(bx, by, barW * ratio, barH);
  }
  // Chat bubble.
  const b = piglin.bubble && piglin.bubble();
  if (b) {
    drawBubble(ctx, screenX, screenY - h - 18, b.text);
  }
}

/**
 * Draw a recruited follower (looks like a piglin with a small "!"
 * indicator to mark it as the player's companion).
 */
export function drawFollower(ctx, screenX, screenY, follower) {
  const pig = follower.piglin;
  drawPiglin(ctx, screenX, screenY, pig);
  // Heart icon to mark as the player's follower.
  const sz = (pig.config && pig.config.size) || 0.7;
  const h = 14 * sz;
  ctx.fillStyle = '#ff6b8a';
  ctx.beginPath();
  const x = screenX + 6, y = screenY - h - 4;
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - 3, y - 3, x - 5, y + 1, x, y + 4);
  ctx.bezierCurveTo(x + 5, y + 1, x + 3, y - 3, x, y);
  ctx.fill();
}

/**
 * Draw a 2x2 village building (house or trader).
 *
 * The "anchor" is the top-left tile center; we draw a small hut
 * covering that footprint.
 */
export function drawBuilding(ctx, screenX, screenY, building) {
  if (building.kind === 'trader') {
    drawTraderPost(ctx, screenX, screenY, building);
  } else {
    drawHouse(ctx, screenX, screenY, building);
  }
}

function drawHouse(ctx, screenX, screenY, building) {
  // building is centered on its top-left tile; the actual box
  // extends one tile to the right and one tile down (iso-wise).
  const w = TILE_W_HALF * 2;
  const h = TILE_H_HALF * 2;
  // Wall (rounded rect).
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_H_HALF);
  ctx.lineTo(screenX + w, screenY + TILE_H_HALF);
  ctx.lineTo(screenX, screenY + TILE_H_HALF + h);
  ctx.lineTo(screenX - w, screenY + TILE_H_HALF);
  ctx.closePath();
  ctx.fill();
  // Roof (triangle on top).
  ctx.fillStyle = '#a85a2a';
  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_H_HALF - 8);
  ctx.lineTo(screenX + w, screenY + TILE_H_HALF);
  ctx.lineTo(screenX - w, screenY + TILE_H_HALF);
  ctx.closePath();
  ctx.fill();
  // Door.
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(screenX - 1.5, screenY + h * 0.4, 3, 4);
}

function drawTraderPost(ctx, screenX, screenY, building) {
  const w = TILE_W_HALF * 2;
  const h = TILE_H_HALF * 2;
  // Counter / booth.
  ctx.fillStyle = '#5a4a3a';
  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_H_HALF);
  ctx.lineTo(screenX + w, screenY + TILE_H_HALF);
  ctx.lineTo(screenX, screenY + TILE_H_HALF + h);
  ctx.lineTo(screenX - w, screenY + TILE_H_HALF);
  ctx.closePath();
  ctx.fill();
  // Striped awning — alternating red/yellow.
  ctx.fillStyle = '#c84a3a';
  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_H_HALF - 10);
  ctx.lineTo(screenX + w, screenY + TILE_H_HALF);
  ctx.lineTo(screenX - w, screenY + TILE_H_HALF);
  ctx.closePath();
  ctx.fill();
  // Yellow stripe in the middle.
  ctx.fillStyle = '#d4a64a';
  ctx.beginPath();
  ctx.moveTo(screenX, screenY - TILE_H_HALF - 5);
  ctx.lineTo(screenX + w * 0.5, screenY + TILE_H_HALF - 2);
  ctx.lineTo(screenX - w * 0.5, screenY + TILE_H_HALF - 2);
  ctx.closePath();
  ctx.fill();
  // Open sign.
  ctx.fillStyle = '#f0e0a0';
  ctx.fillRect(screenX - 3, screenY + h * 0.1, 6, 4);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 4px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⇄', screenX, screenY + h * 0.1 + 3.5);
  ctx.textAlign = 'left';
}

function drawHearts(ctx, x, y, count) {
  const startX = x - (count - 1) * 4;
  for (let i = 0; i < count; i++) {
    const hx = startX + i * 8;
    ctx.fillStyle = '#ff6b8a';
    ctx.beginPath();
    ctx.moveTo(hx, y);
    ctx.bezierCurveTo(hx - 3, y - 3, hx - 5, y + 1, hx, y + 4);
    ctx.bezierCurveTo(hx + 5, y + 1, hx + 3, y - 3, hx, y);
    ctx.fill();
  }
}

/**
 * Draw a chat bubble above an entity.
 *  - screenX/Y: world position of the entity (top of sprite).
 *  - text: a short string.
 */
export function drawBubble(ctx, screenX, screenY, text) {
  if (!text) return;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padding = 4;
  const w = Math.min(120, ctx.measureText(text).width + padding * 2);
  const h = 14;
  const x = screenX - w / 2;
  const y = screenY - h - 2;
  // Bubble background.
  ctx.fillStyle = 'rgba(240,240,240,0.95)';
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(screenX - 3, y + h);
  ctx.lineTo(screenX, y + h + 4);
  ctx.lineTo(screenX + 3, y + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(240,240,240,0.95)';
  ctx.fill();
  ctx.stroke();
  // Text.
  ctx.fillStyle = '#3a2a1a';
  ctx.fillText(text, screenX, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
