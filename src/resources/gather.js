/**
 * Gather — interaction state machine for harvesting resources.
 *
 * v1.0.1 — tool integration:
 *   - Constructor takes `selectedItemProvider` returning the currently
 *     selected hotbar item id (or null). Used to apply tool bonuses and
 *     to consume durability on a successful gather.
 *   - On 'complete' event, if a tool was used, the hotbar tool's
 *     durability is decremented by 1. The event payload now also
 *     includes `toolUsed: itemId | null` and `toolStatus: 'compatible'
 *     | 'wrong_tool' | 'no_tool_required' | 'tool_required' | 'na'`.
 *
 * v0.6.0b — InventoryService:
 *   - Constructor takes `invSvc` (InventoryService) instead of raw
 *     Inventory. Tool durability is now `invSvc.damageToolById(id, 1)`
 *     (looks up the slot by itemId) instead of findIndex + damageTool.
 *   - The entity's `harvest(invSvc, now)` callback is responsible for
 *     using the service to grant loot; gather itself only mutates the
 *     tool stack.
 */
'use strict';

import { checkTool } from './catalog.js';

export const DEFAULT_RANGE = 1.75;
export const GATHER_IDLE       = 'idle';
export const GATHER_GATHERING  = 'gathering';
export const GATHER_JUST_DONE  = 'just_done';

export class Gather {
  constructor({ entities, invSvc, range = DEFAULT_RANGE, onEvent = null,
                selectedItemProvider = null } = {}) {
    this.entities  = entities;
    this.invSvc    = invSvc;
    this.range     = range;
    this.onEvent   = onEvent;
    this.selectedItemProvider = selectedItemProvider || (() => null);
    this.state     = GATHER_IDLE;
    this.target    = null;
    this.progress  = 0;
    this.lastLoot  = null;
    this.lastToolStatus = null;
  }

  findInRange(x, y) {
    let best = null;
    let bestDist = this.range;
    for (const e of this.entities) {
      if (e.depleted) continue;
      const d = e.distTo(x, y);
      if (d <= bestDist) { best = e; bestDist = d; }
    }
    return best;
  }

  click(x, y) {
    const e = this.findInRange(x, y);
    if (!e) {
      if (this.state === GATHER_GATHERING) this._cancel();
      return false;
    }
    if (this.state === GATHER_GATHERING && this.target === e) return true;
    this._start(e);
    return true;
  }

  /**
   * @param player  Player or {x,y}
   * @param dt      delta time seconds
   * @param now     current time in ms (for regrow / break timing)
   */
  update(player, dt, now = Date.now()) {
    if (this.state === GATHER_JUST_DONE) {
      this.state = GATHER_IDLE;
      return;
    }
    if (this.state !== GATHER_GATHERING) return;
    if (this.target == null || this.target.depleted) {
      this._cancel();
      return;
    }
    const d = this.target.distTo(player.x, player.y);
    if (d > this.range) { this._cancel(); return; }
    this.progress += dt;
    if (this.progress >= this.target.harvestTime) {
      const selectedId = this.selectedItemProvider();
      const toolStatus = checkTool(this.target.id, selectedId);
      this.lastToolStatus = toolStatus;
      const loot = this.target.harvest(this.invSvc, now);
      this.lastLoot = loot.granted;
      // Damage the equipped tool if one is in use and a tool is appropriate.
      // 'compatible' or 'no_tool_required' both pass; 'wrong_tool' / 'tool_required' do not consume durability.
      let toolUsed = null;
      if ((toolStatus === 'compatible' || toolStatus === 'no_tool_required')
          && selectedId != null
          && this.invSvc.findSlotByItem(selectedId) >= 0) {
        this.invSvc.damageToolById(selectedId, 1);
        toolUsed = selectedId;
      }
      this._emit('complete', {
        entity: this.target,
        loot: loot.granted,
        regrowAt: loot.regrowAt,
        toolUsed,
        toolStatus
      });
      this.state = GATHER_JUST_DONE;
      this.target = null;
      this.progress = 0;
    }
  }

  progressFraction() {
    if (this.state !== GATHER_GATHERING || !this.target) return 0;
    return Math.min(1, this.progress / this.target.harvestTime);
  }

  _start(e) {
    this.state = GATHER_GATHERING;
    this.target = e;
    this.progress = 0;
    this._emit('start', { entity: e });
  }

  _cancel() {
    if (this.state === GATHER_GATHERING) this._emit('cancel', { entity: this.target });
    this.state = GATHER_IDLE;
    this.target = null;
    this.progress = 0;
  }

  _emit(name, payload) {
    if (typeof this.onEvent === 'function') this.onEvent(name, payload);
  }
}
