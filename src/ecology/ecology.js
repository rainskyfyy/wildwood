/**
 * EcologyManager — owns all ecology entities and ticks the population
 * model each frame.
 *
 * Responsibilities:
 *   - Spawn initial population per (biome, species) bucket at session
 *     start. Spawn positions are deterministic but spread.
 *   - Run the per-tick population update (Population + FoodChain).
 *   - Run the per-frame AI tick for every ecology entity (the same
 *     logic as MonsterManager but bound to the ecology model).
 *   - Provide a depth-sorted list of visible entities for the
 *     renderer.
 *   - Translate population counts to entity count: when the bucket
 *     grows, spawn new entities near the herd; when it shrinks,
 *     remove entities.
 *
 * Population ↔ entity sync:
 *   - We do NOT keep the entity count exactly equal to the bucket
 *     count at all times. Instead, on each `prune()`, we trim excess
 *     entities to match `floor(bucket.count)`, and on `grow()` we
 *     top up to that number.
 *   - This trades a 1-tick visual lag for a fast, allocation-free
 *     spawn pipeline. The HUD displays the bucket count, which is
 *     authoritative.
 *
 * Prey lookup:
 *   - The manager exposes `findNearest(species, maxDist, fromEntity)`
 *     which EcologyMonster calls during FLEE / HUNT.
 *   - Spatial index is a flat chunk grid (chunk = 8 tiles) for O(1)
 *     neighborhood scan. Rebuilt each frame from scratch (cheap:
 *     < 100 entities typical).
 */

'use strict';

import { EcologyMonster, EcologyState } from '../monster/ecology-monster.js';
import { Population } from './population.js';
import { FoodChain } from './food-chain.js';
import { getBiome } from '../world/biome-config.js';

const CHUNK = 8;

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

/**
 * Build the reverse predator map: for each species, who threatens it.
 * E.g. rabbit → [fox, wolf], fox → [wolf], wolf → [].
 */
function buildThreatMap(foodChain) {
  const threats = new Map();
  for (const [pred, info] of Object.entries(foodChain)) {
    for (const prey of (info.eats || [])) {
      if (!threats.has(prey)) threats.set(prey, []);
      threats.get(prey).push(pred);
    }
  }
  return threats;
}

export class EcologyManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {Object} opts.ecologyData     parsed ecology.json
   * @param {Object} opts.ecologyMonsters parsed ecology-monsters.json
   * @param {Function} [opts.loadImage]
   * @param {Function} [opts.isReady]
   * @param {Function} [opts.getOrFallback]
   * @param {number} [opts.seed=1337]
   * @param {number} [opts.ticksPerSecond=2]  ecology ticks per real second
   */
  constructor({
    world,
    ecologyData,
    ecologyMonsters,
    loadImage = () => null,
    isReady = () => false,
    getOrFallback = (_p, b) => b(),
    seed = 1337,
    ticksPerSecond = 2
  } = {}) {
    this.world = world;
    this.ecologyData = ecologyData;
    this.ecologyMonsters = ecologyMonsters;
    this.loadImage = loadImage;
    this.isReady = isReady;
    this.getOrFallback = getOrFallback;
    this.seed = seed;
    this.ticksPerSecond = ticksPerSecond;
    this.ticksPerDay = (ecologyData && ecologyData._meta && ecologyData._meta.ticksPerDay) || 240;

    this.foodChain = new FoodChain(ecologyData || { foodChain: {} });
    this.threats = buildThreatMap((ecologyData && ecologyData.foodChain) || {});

    /** @type {Map<string, Population>} */
    this.populations = new Map();
    /** @type {EcologyMonster[]} */
    this.entities = [];
    /** chunkIndex: chunkKey (x,y) → array of entities */
    this._chunks = new Map();

    this._tickAccum = 0;
    this._frameCount = 0;
    this._stateTableCache = new Map();
  }

  /**
   * Initialize populations for every biome that has at least one
   * species with carryingCapacity > 0. Each population is created
   * at ~40% of K so the system has a realistic starting state.
   */
  initialize() {
    const biomes = (this.ecologyData && this.ecologyData.biomes) || {};
    for (const [biome, params] of Object.entries(biomes)) {
      const cap = params.carryingCapacity || {};
      const birth = params.birthRate || {};
      const death = params.deathRate || {};
      for (const species of Object.keys(cap)) {
        const K = cap[species];
        if (K <= 0) continue;
        const initial = Math.max(0, Math.floor(K * 0.4));
        if (initial === 0) continue;
        const pop = new Population({
          biome,
          species,
          initial,
          capacity: K,
          birthRate: birth[species] || 0,
          deathRate: death[species] || 0,
          rng: mulberry32((this.seed ^ hashStr(biome) ^ hashStr(species)) >>> 0)
        });
        this.populations.set(this._key(biome, species), pop);
      }
    }
    // Initial spawn — round to floor(initial/2) for visible critters.
    for (const pop of this.populations.values()) {
      this._syncEntities(pop, Math.max(1, Math.floor(pop.count / 2)));
    }
    this._rebuildChunks();
  }

  /**
   * Per-frame update. AI tick happens every frame; population
   * model tick happens at `ticksPerSecond` Hz.
   *
   * @param {number} dt  seconds since last frame
   * @param {Object} player  player entity (for HUNT target)
   */
  update(dt, player) {
    // Always tick AI for visible entities.
    for (const e of this.entities) e.update(dt, player);
    this._resolveOverlaps();

    // Population tick at lower rate.
    this._tickAccum += dt;
    const interval = 1 / Math.max(0.1, this.ticksPerSecond);
    while (this._tickAccum >= interval) {
      this._tickAccum -= interval;
      this._stepPopulation();
    }
    this._frameCount++;
  }

  /**
   * Run one population tick. Order:
   *   1. Compute predation losses from current populations.
   *   2. Tick every Population bucket with its loss.
   *   3. Sync entities (spawn/remove) to match new counts.
   */
  _stepPopulation() {
    const losses = this.foodChain.computePredation(this.populations);
    for (const pop of this.populations.values()) {
      const k = this._key(pop.biome, pop.species);
      const loss = losses.get(k) || 0;
      pop.tick(loss);
    }
    // Sync entities to current populations. We cap sync to once
    // every few ticks for perf — visual lag of 1-2 ticks is fine.
    if ((this._frameCount % 4) === 0) {
      for (const pop of this.populations.values()) {
        this._syncEntities(pop, pop.count);
      }
      this._rebuildChunks();
    }
  }

  /**
   * Reconcile entity count for one population. If `target` is
   * larger than current, spawn `target - current` new entities.
   * If smaller, remove the excess.
   */
  _syncEntities(pop, target) {
    const owned = this.entities.filter(
      e => e._ecologyBiome === pop.biome && e.typeId === pop.species
    );
    const have = owned.length;
    if (have < target) {
      for (let i = have; i < target; i++) {
        const tile = this._findBiomeSpawnTile(pop.biome, owned);
        if (!tile) break;
        this._spawnOne(pop.biome, pop.species, tile.x + 0.5, tile.y + 0.5, owned.length + i);
      }
    } else if (have > target) {
      // Remove from the end. Pick the farthest from (40, 30) for
      // visual fairness (don't deplete where the player is).
      const cx = this.world.width / 2, cy = this.world.height / 2;
      owned.sort((a, b) => {
        const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
        const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
        return db - da;
      });
      const toRemove = owned.slice(0, have - target);
      for (const e of toRemove) {
        const idx = this.entities.indexOf(e);
        if (idx >= 0) this.entities.splice(idx, 1);
      }
    }
  }

  _spawnOne(biome, species, x, y, instanceIndex) {
    const cfg = this.ecologyMonsters[species];
    if (!cfg) return null;
    const stateTable = this._buildStateTable(species, cfg);
    const seed = (this.seed ^ hashStr(species) ^ (instanceIndex * 9173)) >>> 0;
    const diet = cfg.diet || [];
    const threats = this.threats.get(species) || [];
    const e = new EcologyMonster({
      typeId: species,
      world: this.world,
      config: cfg,
      x, y,
      seed,
      stateTable,
      diet,
      threats,
      trophic: cfg.trophic || 'grazer',
      findNearest: (sp, md, from) => this.findNearest(sp, md, from),
      findFleeTarget: (threat) => this._pickFleeTileAwayFrom(threat)
    });
    e._ecologyBiome = biome;
    this.entities.push(e);
    return e;
  }

  _buildStateTable(species, cfg) {
    const cached = this._stateTableCache.get(species);
    if (cached) return cached;
    const table = {};
    for (const action of cfg.actions || ['idle', 'walk']) {
      table[action] = {};
      for (const facing of ['down', 'up', 'left', 'right']) {
        const path = this._framePath(species, facing, action);
        this.loadImage(path);
        table[action][facing] = {
          image: null, path, sourceX: 0, sourceY: 0, sourceW: 0, sourceH: 0
        };
      }
    }
    this._stateTableCache.set(species, table);
    return table;
  }

  _framePath(species, facing, action) {
    return `./assets/art/monsters/${species}_20frames/${species}_${facing}_${action}.png`;
  }

  /**
   * Find a walkable tile in `biome` that isn't already occupied by
   * an entity of the same species.
   */
  _findBiomeSpawnTile(biome, alreadyHere) {
    const W = this.world.width, H = this.world.height;
    const rng = mulberry32((this.seed ^ hashStr(biome) ^ (alreadyHere.length * 31)) >>> 0);
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * W);
      const y = Math.floor(rng() * H);
      if (this.world.getTile(x, y) !== biome) continue;
      if (!this.world.isWalkable(x, y)) continue;
      let occ = false;
      for (const e of alreadyHere) {
        if (Math.floor(e.x) === x && Math.floor(e.y) === y) { occ = true; break; }
      }
      if (occ) continue;
      return { x, y };
    }
    return null;
  }

  _pickFleeTileAwayFrom(threat) {
    const ox = Math.floor(this.world.width / 2);
    const oy = Math.floor(this.world.height / 2);
    // Flee away from the threat, but biased toward world center so
    // critters don't strand themselves on a corner.
    const tx = Math.floor(threat.x), ty = Math.floor(threat.y);
    const dx = Math.floor(this.world.width / 2) - tx;
    const dy = Math.floor(this.world.height / 2) - ty;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    for (let r = 6; r >= 2; r--) {
      const px = Math.round(ox + ux * r);
      const py = Math.round(oy + uy * r);
      if (this.world.isWalkable(px, py)) return { x: px, y: py };
    }
    return null;
  }

  _resolveOverlaps() {
    const HALF = 0.3;
    for (let i = 0; i < this.entities.length; i++) {
      const a = this.entities[i];
      for (let j = i + 1; j < this.entities.length; j++) {
        const b = this.entities[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const minDist = 2 * HALF + 0.05;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= minDist) continue;
        const push = (minDist - dist) * 0.5;
        const ux = dx / dist, uy = dy / dist;
        if (!a.collidesAt(a.x - ux * push, a.y - uy * push)) {
          a.x -= ux * push; a.y -= uy * push;
        }
        if (!b.collidesAt(b.x + ux * push, b.y + uy * push)) {
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
  }

  _rebuildChunks() {
    this._chunks.clear();
    for (const e of this.entities) {
      const cx = Math.floor(e.x / CHUNK);
      const cy = Math.floor(e.y / CHUNK);
      const k = `${cx},${cy}`;
      if (!this._chunks.has(k)) this._chunks.set(k, []);
      this._chunks.get(k).push(e);
    }
  }

  _key(biome, species) { return `${biome}|${species}`; }

  /**
   * Find the nearest entity of `species` within `maxDist` tiles.
   * Used by EcologyMonster for FLEE / HUNT.
   *
   * @param {string} species
   * @param {number} maxDist
   * @param {EcologyMonster} fromEntity  the entity doing the search
   * @returns {EcologyMonster|null}
   */
  findNearest(species, maxDist, fromEntity) {
    if (this.entities.length === 0) return null;
    const originX = fromEntity ? fromEntity.x : this.world.width / 2;
    const originY = fromEntity ? fromEntity.y : this.world.height / 2;
    const cx = Math.floor(originX / CHUNK);
    const cy = Math.floor(originY / CHUNK);
    const radius = Math.ceil(maxDist / CHUNK) + 1;
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const k = `${cx + dx},${cy + dy}`;
        const list = this._chunks.get(k);
        if (!list) continue;
        for (const e of list) {
          if (e.typeId !== species) continue;
          if (e === fromEntity) continue;
          const ddx = e.x - originX, ddy = e.y - originY;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) { bestD2 = d2; best = e; }
        }
      }
    }
    return best;
  }

  visible(camera) {
    const b = camera.viewBounds();
    const out = [];
    for (const e of this.entities) {
      const t = e.tilePos();
      if (t.x < b.x0 - 1 || t.x > b.x1 + 1) continue;
      if (t.y < b.y0 - 1 || t.y > b.y1 + 1) continue;
      out.push(e);
    }
    return out;
  }

  resolveSprite(e) {
    const table = this._stateTableCache.get(e.typeId);
    if (!table) return this._proceduralFallback(e);
    const byAction = table[e.action];
    const entry = (byAction && byAction[e.facing]) || (byAction && byAction.down) || null;
    if (!entry) return this._proceduralFallback(e);
    return this.getOrFallback(entry.path, () => this._proceduralFallback(e));
  }

  _proceduralFallback(m) {
    if (m._fallback && m._fallback.key === m.color) return m._fallback.cv;
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d');
    const cx = 16, cy = 16;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx + 7, cy);
    ctx.lineTo(cx, cy + 9);
    ctx.lineTo(cx - 7, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    let ex = cx, ey = cy - 2;
    if (m.facing === 'down')  ey = cy + 2;
    if (m.facing === 'left')  ex = cx - 3;
    if (m.facing === 'right') ex = cx + 3;
    ctx.fillRect(ex, ey, 2, 2);
    m._fallback = { key: m.color, cv };
    return cv;
  }

  /**
   * Snapshot of all populations for HUD or tests.
   * @returns {Array<{biome, species, count, capacity, lastTick}>}
   */
  snapshot() {
    const out = [];
    for (const pop of this.populations.values()) {
      out.push({ ...pop.snapshot(), lastTick: pop.lastTick() });
    }
    return out;
  }

  /**
   * Total entity count by species (sums across biomes). Useful for
   * tests and dev HUD.
   * @returns {Record<string, number>}
   */
  entityCounts() {
    const out = {};
    for (const e of this.entities) {
      out[e.typeId] = (out[e.typeId] || 0) + 1;
    }
    return out;
  }
}
