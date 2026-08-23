/**
 * Cooking Renderer — 烹饪锅 UI (4 槽 + 预览)
 *
 * 纯 Canvas 2D 渲染,不依赖 DOM。
 * 由 main.js 在打开烹饪面板时调用,负责绘制:
 *   - 4 槽食材格子
 *   - 鼠标悬停高亮
 *   - 预览区(匹配食谱 + 品质 + food value/count)
 *   - "烹饪"按钮
 *
 * 交互 (由 caller 路由):
 *   onClick(x, y): 处理槽位点击 / 按钮点击
 *
 * v1.0.0
 */
'use strict';

import { COOKING_SLOTS } from './cooking.js';
import { getItem } from '../resources/catalog.js';
import { qualityColor, qualityName } from './quality.js';

const SLOT_SIZE = 48;
const SLOT_PAD  = 6;
const PANEL_W   = 280;
const PANEL_H   = 280;
const PANEL_BG  = 'rgba(20, 14, 8, 0.95)';
const SLOT_BG   = 'rgba(60, 40, 24, 0.9)';
const SLOT_BORDER = '#8a5a2a';
const SLOT_HOVER  = 'rgba(120, 90, 50, 0.95)';
const FONT_LABEL  = '12px sans-serif';
const FONT_BIG    = 'bold 14px sans-serif';

/**
 * Compute the panel rect given screen dimensions.
 */
export function cookingPanelRect(canvasWidth, canvasHeight) {
  return {
    x: (canvasWidth - PANEL_W) / 2,
    y: (canvasHeight - PANEL_H) / 2,
    w: PANEL_W,
    h: PANEL_H
  };
}

/**
 * Draw the cooking pot UI.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} pot - CookingPot instance
 * @param {Object} preview - { recipe, quality, foodValue, foodCount, slots }
 * @param {Object} mouse - { x, y } (or null)
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {Object} - hit map for click routing
 *   { slotRects: [{x,y,w,h,index}], cookBtn: {x,y,w,h}, panelRect }
 */
export function drawCookingPanel(ctx, pot, preview, mouse, canvasWidth, canvasHeight) {
  const panel = cookingPanelRect(canvasWidth, canvasHeight);

  // Panel background
  ctx.save();
  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = '#d4a64a';
  ctx.lineWidth = 2;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  // Title
  ctx.fillStyle = '#d4a64a';
  ctx.font = FONT_BIG;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('烹饪锅', panel.x + panel.w / 2, panel.y + 10);

  // Slots: 2x2 grid
  const slotRects = [];
  const slotsStartX = panel.x + 18;
  const slotsStartY = panel.y + 50;
  for (let i = 0; i < COOKING_SLOTS; i++) {
    const r = Math.floor(i / 2);
    const c = i % 2;
    const sx = slotsStartX + c * (SLOT_SIZE + SLOT_PAD);
    const sy = slotsStartY + r * (SLOT_SIZE + SLOT_PAD);
    const rect = { x: sx, y: sy, w: SLOT_SIZE, h: SLOT_SIZE, index: i };
    slotRects.push(rect);

    const isHover = mouse && rectHit(mouse.x, mouse.y, rect);
    ctx.fillStyle = isHover ? SLOT_HOVER : SLOT_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = SLOT_BORDER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Item icon
    const id = pot.slots[i];
    if (id) {
      drawItemIcon(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, id);
      try {
        const it = getItem(id);
        ctx.fillStyle = '#ffffff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(it.name, rect.x + 2, rect.y + rect.h - 2);
      } catch (_) {}
    }
  }

  // Preview
  const previewY = slotsStartY + 2 * (SLOT_SIZE + SLOT_PAD) + 4;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#d4a64a';
  ctx.font = FONT_BIG;
  ctx.fillText('预览', panel.x + 18, previewY);

  ctx.font = FONT_LABEL;
  ctx.fillStyle = '#cccccc';
  if (preview && preview.recipe) {
    ctx.fillText(`食谱: ${preview.recipe.name}`, panel.x + 18, previewY + 22);
    ctx.fillText(`品质: ${qualityName(preview.quality)}`, panel.x + 18, previewY + 40);
    ctx.fillStyle = qualityColor(preview.quality);
    ctx.fillText(`食物值: ${preview.foodValue}`, panel.x + 130, previewY + 40);
    ctx.fillText(`产出: ${preview.foodCount} 份`, panel.x + 18, previewY + 58);
  } else if (preview && preview.slots.some(s => s)) {
    ctx.fillStyle = '#cc6644';
    ctx.fillText('无匹配食谱', panel.x + 18, previewY + 22);
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '10px sans-serif';
    ctx.fillText('尝试:肉+水+盐 / 浆果+蜂蜜 / 蔬菜+水+盐...', panel.x + 18, previewY + 40);
  } else {
    ctx.fillStyle = '#888888';
    ctx.fillText('拖拽食材到上方格子', panel.x + 18, previewY + 22);
  }

  // Cook button
  const btnY = panel.y + panel.h - 40;
  const btnW = 100, btnH = 28;
  const btnX = panel.x + (panel.w - btnW) / 2;
  const cookBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
  const isHoverBtn = mouse && rectHit(mouse.x, mouse.y, cookBtn);
  const canCook = !!(preview && preview.recipe);
  ctx.fillStyle = canCook
    ? (isHoverBtn ? '#d4a64a' : '#a8753a')
    : '#555555';
  ctx.fillRect(cookBtn.x, cookBtn.y, cookBtn.w, cookBtn.h);
  ctx.strokeStyle = canCook ? '#f0c850' : '#777777';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cookBtn.x, cookBtn.y, cookBtn.w, cookBtn.h);
  ctx.fillStyle = canCook ? '#1a0e08' : '#999999';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('烹饪', cookBtn.x + cookBtn.w / 2, cookBtn.y + cookBtn.h / 2);

  // Close hint
  ctx.fillStyle = '#888888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('(按 C 关闭)', panel.x + panel.w - 10, panel.y + 12);

  // Unlocked counter
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`已解锁食谱: ${pot.unlocked.size}`, panel.x + 18, panel.y + 28);

  ctx.restore();

  return { slotRects, cookBtn, panelRect: panel };
}

function rectHit(mx, my, r) {
  return mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
}

/**
 * Hit-test a click against the panel's hit-map (returned by drawCookingPanel).
 *
 * Behavior (mirrors CraftingPanel two-click flow):
 *   - click on a filled slot → removeFromSlot
 *   - click on an empty slot with a hotbar item selected → put
 *   - click on empty slot with no hotbar selection → noop
 *   - click on cook button → cook (consumes inputs, produces output)
 *
 * @param {number} mx - mouse x (canvas coords)
 * @param {number} my - mouse y
 * @param {Object} hitMap - result of last drawCookingPanel call
 *   { slotRects, cookBtn, panelRect }
 * @param {Object} pot - CookingPot instance
 * @param {Object} inventory - Inventory instance
 * @param {number} hotbarSlotIndex - currently selected hotbar slot
 * @returns {string|null} - 'clicked' if a click was consumed, null otherwise
 */
export function cookingPanelOnClick(mx, my, hitMap, pot, inventory, hotbarSlotIndex) {
  if (!hitMap) return null;
  // Test panel rect first (so clicks outside don't trigger anything)
  if (!rectHit(mx, my, hitMap.panelRect)) return null;

  // Cook button
  if (hitMap.cookBtn && rectHit(mx, my, hitMap.cookBtn)) {
    pot.cook({ avgFreshness: 1.0 });
    return 'cooked';
  }

  // Slot hit
  for (const rect of hitMap.slotRects) {
    if (!rectHit(mx, my, rect)) continue;
    if (pot.slots[rect.index]) {
      // Return removed item to inventory (refund on click)
      const removed = pot.removeFromSlot(rect.index);
      if (removed && inventory) {
        inventory.add(removed, 1);
      }
      return 'slot_removed';
    }
    // Empty slot — try to place the selected hotbar item
    const stack = inventory && inventory.slots ? inventory.slots[hotbarSlotIndex] : null;
    if (stack) {
      const r = pot.put(stack.itemId);
      if (r.ok) {
        // Consume one from hotbar (use slot-indexed remove)
        inventory.remove(hotbarSlotIndex, 1);
        return 'slot_added';
      }
    }
    return 'slot_noop';
  }
  return null;
}

function drawItemIcon(ctx, cx, cy, itemId) {
  let it;
  try { it = getItem(itemId); } catch (_) { return; }
  ctx.save();
  ctx.fillStyle = it.color || '#888888';
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Use first character (Chinese-friendly fallback)
  const ch = it.name ? it.name.charAt(0) : '?';
  ctx.fillText(ch, cx, cy + 1);
  ctx.restore();
}
