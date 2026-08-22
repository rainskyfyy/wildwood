/**
 * NPC manager — owns the piglin roster + per-frame ticks.
 *
 * Thin wrapper around an array of Piglins plus the building list
 * (houses + trading post) produced by `generateVillage`. Renderer
 * queries `visible(camera)` to get pigs that should be drawn.
 *
 * Provides:
 *   - spawnVillage(world, opts)  → initializes the roster in-place
 *   - update(dt, ctx)            → ticks all pigs (day/night, AI)
 *   - visible(camera)            → list of pigs to draw
 *   - greetNearby(player)        → triggers chat bubbles on close pigs
 *   - findPiglinAt(tile)         → interaction target helper
 */
'use strict';
import { generateVillage, buildingAt, traderBuilding } from './village.js';
import { Piglin, PiglinState } from './piglin.js';

export class NPCManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} [opts.seed]
   */
  constructor({ world, seed } = {}) {
    this.world = world;
    this.seed = seed;
    this.piglins = [];
    this.buildings = [];
    this.villageOrigin = null;
  }

  /**
   * Build a piglin village and store its entities. Idempotent:
   * re-calling clears the previous roster.
   */
  spawnVillage(opts = {}) {
    const seed = opts.seed ?? this.seed ?? this.world.seed;
    const result = generateVillage(this.world, { seed, ...opts });
    this.piglins = result.piglins;
    this.buildings = result.buildings;
    this.villageOrigin = result.origin;
    return result;
  }

  /**
   * Per-frame update.
   * @param {number} dt seconds
   * @param {Object} ctx
   * @param {boolean} ctx.isDay
   * @param {Object} [ctx.player]
   */
  update(dt, ctx = {}) {
    for (const p of this.piglins) p.update(dt, ctx);
  }

  /**
   * Trigger greetings for any piglin within `range` of the player.
   * Greetings are throttled per-piglin by `Piglin._stateTimer`.
   */
  greetNearby(player, range = 4) {
    if (!player) return;
    for (const p of this.piglins) p.maybeGreet(player, range);
  }

  /** Pigs visible in the camera (used for culling before draw). */
  visible(camera) {
    const b = camera.viewBounds();
    const out = [];
    for (const p of this.piglins) {
      if (p.state === PiglinState.DEAD) continue;
      if (p.x < b.x0 - 1 || p.x > b.x1 + 1) continue;
      if (p.y < b.y0 - 1 || p.y > b.y1 + 1) continue;
      out.push(p);
    }
    return out;
  }

  /** Find the piglin whose tile contains (tx, ty) — used for click-to-interact. */
  findPiglinAt(tx, ty) {
    for (const p of this.piglins) {
      if (p.state === PiglinState.DEAD) continue;
      if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) return p;
    }
    return null;
  }

  /** Get the trading post tile center, or null. */
  traderCenter() {
    const t = traderBuilding(this.buildings);
    if (!t) return null;
    return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  }

  /** Mark buildings as walkable=false for the pathfinder. */
  buildingOccupiedTiles() {
    const out = new Set();
    for (const b of this.buildings) {
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          out.add((b.y + dy) * 4096 + (b.x + dx));
        }
      }
    }
    return out;
  }

  /** Reset for save reload. */
  serialize() {
    return {
      villageOrigin: this.villageOrigin,
      buildings: this.buildings,
      piglins: this.piglins.map(p => p.serialize())
    };
  }
}

export { Piglin, PiglinState, buildingAt, traderBuilding };
