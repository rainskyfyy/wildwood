/**
 * @deprecated Wildwood HUD — CANVAS 版本,已冻结,不再维护。
 *
 * DOM 版本才是权威实现:
 *   - 权威 HUD  → src/ui/hud.js(三围条 / 时间 / 小地图 / 背包 / 合成面板)
 *   - 本文件    → src/hud/hud.js(旧 canvas 浮层),已废弃,仅保留以防外部引用。
 *
 * 原因(v0.8.18-P1-11):
 *   - 新旧两套 HUD 并存造成维护双份、视觉不一致;
 *   - 本 canvas 版本存在已知缺陷(如 Minimap 期望 DOM containerEl 却收到 ctx,
 *     见 src/hud/vitals.js:6 的说明),无法随 DOM 版同步演进。
 * 处置:文件保留不删除,但标记废弃;新代码一律改用 src/ui/hud.js。
 * 集成切换(src/assembly.js:198 改接 DOM HUD)由高级开发子任务 B 负责,跨 PR 协调。
 *
 * HUD coordinator — vitals + hotbar + minimap + inventory/crafting panels.
 *
 * v0.4 audio: `setAudio(audioInt)` wires UI sounds (open/close/click)
 * to the integration layer; otherwise HUD is unchanged.
 */
'use strict';
if (typeof console !== 'undefined' && console.warn) {
  console.warn('[wildwood] src/hud/hud.js is DEPRECATED — use the DOM HUD at src/ui/hud.js instead.');
}
import { Vitals } from './vitals.js';
import { Hotbar } from './hotbar.js';
import { Minimap } from './minimap.js';
import { InventoryPanel } from './inventory-panel.js';
import { CraftingPanel } from './crafting-panel.js';

export class HUD {
  constructor(ctx, input, world, inventory) {
    this.input = input;
    this.vitals  = new Vitals(ctx);
    this.hotbar  = new Hotbar(ctx, input, inventory);
    this.minimap = new Minimap(ctx, { x: 0, y: 0, w: 160, h: 120 });
    this.inventoryPanel = new InventoryPanel(ctx, inventory);
    this.craftingPanel  = new CraftingPanel(ctx, inventory);
    this._audioApi = null;
  }

  /** v0.4 — attach the audio integration object so the HUD can play UI sounds. */
  setAudio(audioInt) {
    this._audioApi = audioInt;
  }

  update() {
    this.hotbar.update();
  }

  /** Per-frame UI edge processing (panel toggles). */
  processPanelToggles() {
    let anyToggle = false;
    if (this.input.consumePressed('i')) {
      this.inventoryPanel.toggle();
      if (this.inventoryPanel.visible) this.craftingPanel.hide();
      anyToggle = true;
    }
    if (this.input.consumePressed('c')) {
      this.craftingPanel.toggle();
      if (this.craftingPanel.visible) this.inventoryPanel.hide();
      anyToggle = true;
    }
    if (this.input.consumePressed('escape')) {
      if (this.inventoryPanel.visible || this.craftingPanel.visible) {
        this.inventoryPanel.hide();
        this.craftingPanel.hide();
        this._audioApi && this._audioApi.notify('ui_close');
      }
    }
    // v0.4 — hotbar slot select 1..5 plays a click
    for (let i = 1; i <= 5; i++) {
      if (this.input.consumePressed(String(i))) {
        this._audioApi && this._audioApi.notify('ui_click');
      }
    }
  }

  /** Returns true if the click was consumed by a panel. */
  handlePanelClick(mx, my, cw, ch) {
    if (this.inventoryPanel.visible &&
        this.inventoryPanel.onClick(mx, my, cw, ch)) {
      this._audioApi && this._audioApi.notify('ui_click');
      return true;
    }
    if (this.craftingPanel.visible &&
        this.craftingPanel.onClick(mx, my, ch, this.hotbar.inventory.selected)) {
      this._audioApi && this._audioApi.notify('ui_click');
      return true;
    }
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
