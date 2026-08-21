/**
 * HUD coordinator — vitals + hotbar + minimap + inventory/crafting panels.
 */
'use strict';
import { Vitals } from './vitals.js';
import { Hotbar } from './hotbar.js';
import { Minimap } from './minimap.js';
import { InventoryPanel } from './inventory-panel.js';
import { CraftingPanel } from './crafting-panel.js';

export class HUD {
  constructor(ctx, input, world, inventory) {
    this.vitals  = new Vitals(ctx);
    this.hotbar  = new Hotbar(ctx, input, inventory);
    this.minimap = new Minimap(ctx, { x: 0, y: 0, w: 160, h: 120 });
    this.inventoryPanel = new InventoryPanel(ctx, inventory);
    this.craftingPanel  = new CraftingPanel(ctx, inventory);
  }

  update() {
    this.hotbar.update();
  }

  /** Per-frame UI edge processing (panel toggles). */
  processPanelToggles() {
    if (this.input.consumePressed('i')) {
      this.inventoryPanel.toggle();
      if (this.inventoryPanel.visible) this.craftingPanel.hide();
    }
    if (this.input.consumePressed('c')) {
      this.craftingPanel.toggle();
      if (this.craftingPanel.visible) this.inventoryPanel.hide();
    }
    if (this.input.consumePressed('escape')) {
      this.inventoryPanel.hide();
      this.craftingPanel.hide();
    }
  }

  /** Returns true if the click was consumed by a panel. */
  handlePanelClick(mx, my, cw, ch) {
    if (this.inventoryPanel.visible &&
        this.inventoryPanel.onClick(mx, my, cw, ch)) return true;
    if (this.craftingPanel.visible &&
        this.craftingPanel.onClick(mx, my, ch, this.hotbar.inventory.selected)) return true;
    return false;
  }

  draw(cw, ch, vitals, world, camera) {
    this.vitals.draw(vitals);
    this.minimap.x = cw - 160 - 12;
    this.minimap.y = 12;
    this.minimap.draw(world, camera);
    this.hotbar.draw(cw, ch);
    this.inventoryPanel.draw(cw, ch);
    this.craftingPanel.draw(cw, ch, this.hotbar.inventory.selected);
  }
}
