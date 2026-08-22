/**
 * Processing Renderer — 加工站 UI (晒肉架 / 发酵桶)
 *
 * 简化版,跟 cooking UI 类似: 1 个 input 槽 + 进度条 + 取出按钮
 * 但只 1 个槽位 (1x1 grid)。
 *
 * 纯 Canvas 2D 渲染。
 *
 * v1.0.0
 */
'use strict';

import { getItem } from '../resources/catalog.js';
import { PROC_STATE } from './processing.js';

const SLOT_SIZE = 48;
const PANEL_W   = 240;
const PANEL_H   = 200;
const PANEL_BG  = 'rgba(20, 14, 8, 0.95)';

/**
 * Compute the panel rect.
 */
export function processingPanelRect(canvasWidth, canvasHeight) {
  return {
    x: (canvasWidth - PANEL_W) / 2,
    y: (canvasHeight - PANEL_H) / 2,
    w: PANEL_W,
    h: PANEL_H
  };
}

/**
 * @returns { stationName, inputRects, takeBtn, panelRect }
 */
export function drawProcessingPanel(ctx, station, mouse, canvasWidth, canvasHeight) {
  const panel = processingPanelRect(canvasWidth, canvasHeight);

  ctx.save();
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  const isBarrel = station.station === 'fermenting_barrel';
  ctx.strokeStyle = isBarrel ? '#7a5a3a' : '#8a5a2a';
  ctx.lineWidth = 2;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  // Title
  ctx.fillStyle = '#d4a64a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(isBarrel ? '发酵桶' : '晒肉架',
    panel.x + panel.w / 2, panel.y + 10);

  // Single slot
  const slotX = panel.x + (panel.w - SLOT_SIZE) / 2;
  const slotY = panel.y + 50;
  const slotRect = { x: slotX, y: slotY, w: SLOT_SIZE, h: SLOT_SIZE };
  const isHover = mouse && mouse.x >= slotRect.x && mouse.x < slotRect.x + slotRect.w
    && mouse.y >= slotRect.y && mouse.y < slotRect.y + slotRect.h;
  ctx.fillStyle = isHover ? 'rgba(120, 90, 50, 0.95)' : 'rgba(60, 40, 24, 0.9)';
  ctx.fillRect(slotRect.x, slotRect.y, slotRect.w, slotRect.h);
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(slotRect.x, slotRect.y, slotRect.w, slotRect.h);

  if (station.state === PROC_STATE.PROCESSING) {
    // show input icon dimmed + progress overlay
    if (station.inputItemId) {
      drawItemIcon(ctx, slotRect.x + slotRect.w / 2, slotRect.y + slotRect.h / 2,
        station.inputItemId, 0.6);
    }
    // progress bar inside slot
    const pct = station.progressFraction(Date.now());
    ctx.fillStyle = 'rgba(212, 166, 74, 0.4)';
    ctx.fillRect(slotRect.x + 2, slotRect.y + slotRect.h - 8, slotRect.w - 4, 6);
    ctx.fillStyle = '#d4a64a';
    ctx.fillRect(slotRect.x + 2, slotRect.y + slotRect.h - 8, (slotRect.w - 4) * pct, 6);

    // status text
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const elapsed = ((Date.now() - station.startedAt) / 1000).toFixed(1);
    ctx.fillText(`处理中: ${elapsed}s / ${station.durationSec}s`,
      panel.x + panel.w / 2, slotRect.y + slotRect.h + 6);
  } else if (station.state === PROC_STATE.READY) {
    // show output icon
    if (station.outputRecipe) {
      drawItemIcon(ctx, slotRect.x + slotRect.w / 2, slotRect.y + slotRect.h / 2,
        station.outputRecipe.output.itemId, 1.0);
    }
    ctx.fillStyle = '#88e088';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('✓ 完成 — 点击取出', panel.x + panel.w / 2, slotRect.y + slotRect.h + 6);
  } else {
    // EMPTY
    ctx.fillStyle = '#888888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('放入物品', panel.x + panel.w / 2, slotRect.y + slotRect.h + 6);

    ctx.fillStyle = '#aaaaaa';
    ctx.font = '9px sans-serif';
    ctx.fillText(isBarrel
      ? '可放入: 浆果/小麦/蜂蜜/南瓜'
      : '可放入: 生肉', panel.x + panel.w / 2, slotRect.y + slotRect.h + 22);
  }

  // Take button (only when READY)
  let takeBtn = null;
  if (station.state === PROC_STATE.READY) {
    const btnY = panel.y + panel.h - 36;
    const btnW = 80, btnH = 24;
    const btnX = panel.x + (panel.w - btnW) / 2;
    takeBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
    const isHoverBtn = mouse && mouse.x >= btnX && mouse.x < btnX + btnW
      && mouse.y >= btnY && mouse.y < btnY + btnH;
    ctx.fillStyle = isHoverBtn ? '#d4a64a' : '#a8753a';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.fillStyle = '#1a0e08';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('取出', btnX + btnW / 2, btnY + btnH / 2);
  }

  // Close hint
  ctx.fillStyle = '#888888';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('(按 ESC 关闭)', panel.x + panel.w - 8, panel.y + 12);

  ctx.restore();
  return { slotRect, takeBtn, panelRect: panel };
}

function drawItemIcon(ctx, cx, cy, itemId, alpha = 1.0) {
  let it;
  try { it = getItem(itemId); } catch (_) { return; }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = it.color || '#888888';
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ch = it.name ? it.name.charAt(0) : '?';
  ctx.fillText(ch, cx, cy + 1);
  ctx.restore();
}

function _rectHit(mx, my, r) {
  return mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
}

/**
 * Hit-test a click against the processing panel.
 *
 * Behavior:
 *   - EMPTY state: click on slot with a hotbar item selected → put (start timer)
 *   - READY state: click on slot OR take button → take() the output
 *   - PROCESSING state: clicks are noops
 *
 * @returns {Object|null} - { action, itemId, count } or null
 */
export function processingPanelOnClick(mx, my, hitMap, station, inventory, hotbarSlotIndex) {
  if (!hitMap) return null;
  if (!_rectHit(mx, my, hitMap.panelRect)) return null;

  // Take button (only in READY)
  if (hitMap.takeBtn && _rectHit(mx, my, hitMap.takeBtn)) {
    if (station.state === PROC_STATE.READY) {
      const r = station.take();
      if (r.ok && inventory) {
        inventory.add(r.itemId, r.count);
        return { action: 'take', itemId: r.itemId, count: r.count };
      }
    }
    return { action: 'noop' };
  }

  // Slot click
  if (_rectHit(mx, my, hitMap.slotRect)) {
    if (station.state === PROC_STATE.EMPTY) {
      const stack = inventory && inventory.slots ? inventory.slots[hotbarSlotIndex] : null;
      if (stack) {
        const r = station.put(stack.itemId);
        if (r.ok) {
          inventory.consume(stack.itemId, 1);
          return { action: 'put', itemId: stack.itemId, recipe: r.recipe };
        }
        return { action: 'no_recipe', itemId: stack.itemId };
      }
      return { action: 'noop' };
    }
    if (station.state === PROC_STATE.READY) {
      const r = station.take();
      if (r.ok && inventory) {
        inventory.add(r.itemId, r.count);
        return { action: 'take', itemId: r.itemId, count: r.count };
      }
      return { action: 'noop' };
    }
    return { action: 'noop' };
  }

  return null;
}
