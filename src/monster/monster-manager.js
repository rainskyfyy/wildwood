/**
 * MonsterManager — spawns, ticks, and renders monsters for a session.
 *
 * Responsibilities:
 *   - Parse monsters.json at construction time.
 *   - Spawn N monsters per type at deterministic positions (no two
 *     monsters share a tile, no monster spawns on an unwalkable tile
 *     or on a building).
 *   - Per-frame update: every monster thinks + moves; monster-vs-
 *     monster overlap is resolved by an axis-separation pass.
 *   - Provides a depth-sorted list of monsters visible to the camera
 *     so the renderer can interleave them with decor/buildings/player.
 *
 * Asset loading is **lazy** by design: each monster only loads its
 * (action, facing) PNG when the manager first tries to draw it. The
 * M2.14a assets are 7–10 MB each (8 MB × 5 monsters × 8 states =
 * ~320 MB worst case), so we never preload them all — the demo would
 * take forever to boot. Each monster pulls images on demand through
 * the shared `image-loader` cache.
 *
 * Public API (consumed by main.js):
 *   const mgr = new MonsterManager({ world, monsterData, onLoadImage });
 *   mgr.spawnDefaults();
 *   mgr.update(dt, player);
 *   for (const m of mgr.visible(camera)) { ... }
 */

'use strict';

import { Monster } from './monster.js';

// Tile corner offsets match Monster.collidesAt.
const BODY_HALF = 0.3;

export class MonsterManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} opts.monsterData  — full parsed monsters.json
   * @param {Function} [opts.loadImage] — (path) => Image; defaults to a no-op that returns null
   * @param {Function} [opts.isReady]   — (path) => boolean
   * @param {Function} [opts.getOrFallback] — (path, builder) => Image|Canvas
   * @param {number} [opts.seed=1337]
   */
  constructor({
    world,
    monsterData,
    loadImage = () => null,
    isReady = () => false,
    getOrFallback = (_p, b) => b(),
    seed = 1337
  } = {}) {
    this.world = world;
    this.monsterData = monsterData;          // { bat: {...}, treant: {...}, ... }
    // Filter out underscore-prefixed meta keys; only real monsters
    // get spawned. This means the JSON can carry _meta / _schema
    // without breaking spawnDefaults().
    this.types = Object.keys(monsterData).filter(
      k => !k.startsWith('_')
    );
    this.loadImage = loadImage;
    this.isReady = isReady;
    this.getOrFallback = getOrFallback;
    this.seed = seed;
    /** @type {Monster[]} */
    this.monsters = [];
    /** state tables cache, keyed by `${typeId}|${action}|${facing}` → FrameSource */
    this._stateTableCache = new Map();
  }

  /**
   * Spawn the default roster: 1 of each monster type, in different
   * biomes. Used by demo.html to give the player something to fight.
   * The spawn positions are deterministic but spread so no two
   * monsters share a tile.
   */
  spawnDefaults() {
    // Pick a spawn tile per type by scanning the world for a
    // walkable, unoccupied spot in a specific biome (if specified).
    for (let i = 0; i < this.types.length; i++) {
      const typeId = this.types[i];
      const cfg = this.monsterData[typeId];
      const tile = this._findSpawnTile(cfg);
      if (!tile) continue; // no valid tile in this world — skip
      this.spawnOne(typeId, tile.x + 0.5, tile.y + 0.5, i);
    }
  }

  /**
   * Find a walkable spawn tile for a monster, respecting its
   * `preferredBiome` if any, and avoiding existing monsters.
   */
  _findSpawnTile(cfg) {
    const W = this.world.width, H = this.world.height;
    const pref = cfg.preferredBiome || null;
    const startSeed = (cfg.name
      ? hashStr(cfg.name) ^ this.seed
      : Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const rng = mulberry32(startSeed);
    // 200 random attempts is plenty for an 80x60 map.
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * W);
      const y = Math.floor(rng() * H);
      if (!this.world.isWalkable(x, y)) continue;
      if (pref && this.world.getTile(x, y) !== pref) continue;
      if (this._isTileOccupiedByMonster(x, y)) continue;
      return { x, y };
    }
    // Fallback: any walkable tile.
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * W);
      const y = Math.floor(rng() * H);
      if (!this.world.isWalkable(x, y)) continue;
      if (this._isTileOccupiedByMonster(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  _isTileOccupiedByMonster(x, y) {
    for (const m of this.monsters) {
      const mt = m.tilePos();
      if (mt.x === x && mt.y === y) return true;
    }
    return false;
  }

  /**
   * Spawn a single monster of `typeId` at fractional world coords.
   * `instanceIndex` is used to seed the monster's PRNG so multiple
   * instances of the same type are reproducible.
   *
   * @returns {Monster|null} the spawned monster, or null if the
   *   type is unknown.
   */
  spawnOne(typeId, x, y, instanceIndex = 0) {
    const cfg = this.monsterData[typeId];
    if (!cfg) return null;
    const stateTable = this._buildStateTable(typeId, cfg);
    const seed = (this.seed ^ (hashStr(typeId) + instanceIndex * 9173)) >>> 0;
    const m = new Monster({
      typeId, world: this.world, config: cfg, x, y, seed, stateTable
    });
    this.monsters.push(m);
    return m;
  }

  /**
   * Build the (action × facing) → FrameSource table for a monster.
   * Each (action, facing) maps to a single PNG (M2.14a asset layout).
   * Loads are triggered through the injected loader so the demo
   * remains responsive even if the PNG hasn't arrived yet.
   */
  _buildStateTable(typeId, cfg) {
    const cached = this._stateTableCache.get(typeId);
    if (cached) return cached;
    const table = {};
    for (const action of cfg.actions || ['idle', 'walk']) {
      table[action] = {};
      for (const facing of ['down', 'up', 'left', 'right']) {
        const path = this._framePath(typeId, facing, action);
        // Kick off the load (no-op if the loader doesn't care).
        this.loadImage(path);
        table[action][facing] = {
          image: null,           // resolved at draw-time via getOrFallback
          path,
          sourceX: 0,
          sourceY: 0,
          sourceW: 0,            // unknown; loader yields natural size
          sourceH: 0
        };
      }
    }
    this._stateTableCache.set(typeId, table);
    return table;
  }

  /**
   * Resolve the on-disk path for a single monster frame.
   * Mirrors the M2.14a layout under assets/art/monsters/.
   */
  _framePath(typeId, facing, action) {
    return `./assets/art/monsters/${typeId}_20frames/${typeId}_${facing}_${action}.png`;
  }

  /**
   * Per-frame tick: think + move + axis-separate monster-on-monster.
   */
  update(dt, player) {
    for (const m of this.monsters) m.update(dt, player);
    this._resolveOverlaps();
  }

  /**
   * Push apart any two monsters whose bodies overlap. Iterative
   * relaxation — a single pass is enough for 5–10 monsters; expand
   * to 2–3 passes if a future milestone has higher density.
   */
  _resolveOverlaps() {
    for (let i = 0; i < this.monsters.length; i++) {
      const a = this.monsters[i];
      for (let j = i + 1; j < this.monsters.length; j++) {
        const b = this.monsters[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const minDist = 2 * BODY_HALF + 0.05;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= minDist) continue;
        const push = (minDist - dist) * 0.5;
        const ux = dx / dist, uy = dy / dist;
        if (!a.collidesAt(a.x - ux * push, a.y - uy * push)) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (!b.collidesAt(b.x + ux * push, b.y + uy * push)) {
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }

  /**
   * Filter the roster to those whose tile is in or near the camera
   * view bounds. The caller (main.js render pass) sorts by depthKey
   * and interweaves with decor/buildings/player.
   *
   * @param {import('../player/camera.js').Camera} camera
   * @returns {Monster[]}
   */
  visible(camera) {
    const b = camera.viewBounds();
    const out = [];
    for (const m of this.monsters) {
      const t = m.tilePos();
      if (t.x < b.x0 - 1 || t.x > b.x1 + 1) continue;
      if (t.y < b.y0 - 1 || t.y > b.y1 + 1) continue;
      out.push(m);
    }
    return out;
  }

  /**
   * Resolve the current sprite for a monster, applying the fallback
   * chain: M2.14a PNG → procedural diamond placeholder.
   *
   * @param {Monster} m
   * @returns {HTMLImageElement|HTMLCanvasElement}
   */
  resolveSprite(m) {
    const table = this._stateTableCache.get(m.typeId);
    if (!table) return this._proceduralFallback(m);
    const byAction = table[m.action];
    const entry = (byAction && byAction[m.facing]) || (byAction && byAction.down) || null;
    if (!entry) return this._proceduralFallback(m);
    // entry.image is null (we deferred resolution to keep state
    // tables serializable). Resolve now through the loader chain.
    return this.getOrFallback(entry.path, () => this._proceduralFallback(m));
  }

  /**
   * Procedural fallback used when the M2.14a PNG is missing or
   * still loading. A small colored diamond so the demo never blanks.
   */
  _proceduralFallback(m) {
    if (m._fallback && m._fallback.key === m.color) return m._fallback.cv;
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d');
    const cx = 16, cy = 16;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx - 8, cy);
    ctx.closePath();
    ctx.fill();
    // Eye dot so you can tell the facing.
    ctx.fillStyle = '#fff';
    let ex = cx, ey = cy - 2;
    if (m.facing === 'down')  ey = cy + 2;
    if (m.facing === 'left')  ex = cx - 3;
    if (m.facing === 'right') ex = cx + 3;
    ctx.fillRect(ex, ey, 2, 2);
    m._fallback = { key: m.color, cv };
    return cv;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
