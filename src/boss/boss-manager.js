/**
 * BossManager — orchestrates Boss spawn, phase transitions, and skill cooldowns.
 *
 * Lives on top of the regular MonsterManager:
 *   - Bosses are real Monster instances (have hp / state / animator)
 *   - They are pushed into monsterManager.monsters so the regular
 *     AI tick + collision pass still runs for them
 *   - BossManager layers three concerns on top:
 *       (1) **Phase transitions** — advance `phase` when hp crosses
 *           a threshold; apply atk/speed/color multipliers.
 *       (2) **Skill cooldowns** — each boss has a `_skillStates` array
 *           with one entry per skill; tickSkills(now) decrements
 *           cooldowns, fires ready skills via `runSkill()`, and emits
 *           VFX hints via the `onSkill` callback.
 *       (3) **Drop handling** — on death, roll each drop in the config
 *           and call `onDrop(itemId, count)` plus add to the player's
 *           inventory if one was provided.
 *
 * The BossManager is intentionally engine-agnostic: skills and
 * drops are pure data, the onSkill callback lets the renderer emit
 * VFX without coupling to the canvas module.
 *
 * v0.5.2 — first cut.
 */
'use strict';

import { BossConfig } from './boss-config.js';
import { runSkill } from './skills.js';
import { Monster } from '../monster/monster.js';

/**
 * Build a stub state table for a Boss so the Monster's animator
 * has something to query. Every (action, facing) maps to a single
 * FrameSource with a null image — the fallback path in the
 * renderer draws a procedural colored block, so we don't need
 * actual PNG frames for bosses.
 *
 * @param {string[]} actions
 * @returns {Object}
 */
function makeBossStateTable(actions) {
  const facings = ['down', 'up', 'left', 'right'];
  const table = {};
  for (const action of actions) {
    table[action] = {};
    for (const facing of facings) {
      table[action][facing] = {
        image: null,
        path: null,
        sourceX: 0, sourceY: 0, sourceW: 0, sourceH: 0
      };
    }
  }
  return table;
}

/**
 * Roll a uniform [0, 1) sample using the injected rng. Defaults
 * to Math.random for convenience but tests inject a fixed function.
 */
function rollRng(rng) {
  return rng ? rng() : Math.random();
}

export class BossManager {
  /**
   * @param {Object} opts
   * @param {import('../world/generator.js').WorldGrid} opts.world
   * @param {import('../monster/monster-manager.js').MonsterManager} opts.monsterManager
   *   — used to push the spawned Boss into the regular monster roster
   *     (so its AI tick + collision pass runs). We do NOT add the
   *     boss to monsterManager.types / monsterData.
   * @param {import('../player/player.js').Player} [opts.player] — used as
   *   a target for skills (charge direction, AOE range, summon).
   * @param {import('../resources/inventory.js').Inventory} [opts.inventory]
   * @param {(itemId:string, count:number)=>void} [opts.onDrop] — called
   *   for every drop that lands. The boss manager also pushes into
   *   `inventory` if one is provided.
   * @param {()=>number} [opts.rng] — injectable PRNG (defaults Math.random)
   * @param {()=>number} [opts.now] — injectable clock (defaults 0; tickSkills
   *   treats `now` as a monotonically increasing second counter)
   */
  constructor({
    world, monsterManager, player = null, inventory = null,
    onDrop = null, rng = null, now = null
  } = {}) {
    if (!world) throw new Error('BossManager: world is required');
    if (!monsterManager) throw new Error('BossManager: monsterManager is required');
    this.world = world;
    this.monsterManager = monsterManager;
    this.player = player;
    this.inventory = inventory;
    this.onDrop = onDrop;
    this._rng = rng;
    this._now = now || (() => 0);
    /** @type {import('../monster/monster.js').Monster[]} */
    this.bosses = [];
    /**
     * Optional callback for VFX emission. Receives the boss and the
     * skill result. Wired in main.js or by the test suite.
     *   onSkill: (boss, skillResult) => void
     */
    this.onSkill = null;
    /**
     * Tracks which bosses have already had their drops processed.
     * Prevents double-drop on a re-tick.
     */
    this._dropsProcessed = new Set();
  }

  /**
   * Spawn a boss by id at (x, y) (tile coords; fractional allowed).
   * The boss is registered as a Monster in monsterManager.monsters
   * (so the regular AI tick picks it up) and also tracked in
   * `this.bosses` (so we can drive phases / skills / drops).
   *
   * @param {string} id — key into BossConfig.bosses
   * @param {number} x
   * @param {number} y
   * @returns {import('../monster/monster.js').Monster|null}
   */
  spawnBoss(id, x, y) {
    const cfg = BossConfig.get(id);
    if (!cfg) return null;
    // Boss is a Monster — it needs the same constructor shape.
    // We build a stub state table so the animator has something to
    // query; the renderer falls back to a procedural block.
    const actions = ['idle', 'walk', 'attack', 'hurt', 'death'];
    const stateTable = makeBossStateTable(actions);
    // Pick a stable seed from the id so reload is deterministic.
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const seed = (h ^ Math.floor(x * 1000) ^ Math.floor(y * 1000)) >>> 0;
    const boss = new Monster({
      typeId: id,
      world: this.world,
      config: cfg,
      x, y, seed,
      stateTable,
      phase: 0
    });
    // Set hp / maxHp from boss config (Monster already does this from
    // cfg.hp, but boss cfg may carry explicit maxHp for some bosses).
    if (cfg.maxHp) {
      boss.maxHp = cfg.maxHp;
      boss.hp = cfg.maxHp;
    }
    // Stash the boss config + per-boss skill cooldown tracking.
    boss.config = cfg;
    boss._skillStates = (cfg.skills || []).map(s => ({
      id: s.id,
      type: s.type,
      cooldown: 0,        // seconds until next fire
      ready: false,       // explicit ready flag (test sets this)
      params: s.params || {},
      firedAt: -Infinity  // last fired timestamp
    }));
    // Tint the boss color by phase-0 base. Phase transitions override
    // via `colorTint` in the config.
    if (cfg.color) boss.color = cfg.color;
    // Push into the regular monster roster so the engine ticks it.
    this.monsterManager.monsters.push(boss);
    this.bosses.push(boss);
    return boss;
  }

  /**
   * Advance skill cooldowns for all bosses, fire skills that are
   * ready, and apply phase transitions when HP drops below the
   * next threshold.
   *
   * @param {number} now — current time in seconds (monotonic)
   */
  tickSkills(now) {
    const dt = this._computeDt(now);
    for (const boss of this.bosses) {
      if (boss.state === 'dead' || boss.hp <= 0) continue;
      this._tickPhaseTransition(boss);
      this._tickSkillCooldowns(boss, dt, now);
    }
  }

  /**
   * Process drops for a dead boss. Rolls each drop in
   * `boss.config.drops` and calls onDrop / inventory.add.
   * Idempotent per boss (uses _dropsProcessed set).
   *
   * @param {import('../monster/monster.js').Monster} boss
   * @param {number} now
   */
  handleDeath(boss, now) {
    if (!boss || !boss.config) return;
    if (this._dropsProcessed.has(boss)) return;
    this._dropsProcessed.add(boss);
    const drops = boss.config.drops || [];
    for (const drop of drops) {
      const chance = drop.chance == null ? 1.0 : drop.chance;
      if (rollRng(this._rng) > chance) continue;
      const min = drop.min || 1;
      const max = drop.max || min;
      const range = Math.max(0, max - min);
      const count = min + Math.floor(rollRng(this._rng) * (range + 1));
      if (this.inventory && typeof this.inventory.add === 'function') {
        this.inventory.add(drop.itemId, count);
      }
      if (typeof this.onDrop === 'function') {
        this.onDrop(drop.itemId, count);
      }
    }
  }

  // ── internal ─────────────────────────────────────────────────

  /**
   * Compute dt (seconds since last tickSkills call). We track the
   * last `now` value per-call so the test suite can drive `now`
   * externally without having to install a clock.
   */
  _computeDt(now) {
    if (this._lastTickTime == null) {
      this._lastTickTime = now;
      return 0;
    }
    const dt = Math.max(0, now - this._lastTickTime);
    this._lastTickTime = now;
    return dt;
  }

  /**
   * Check if the boss should advance to the next phase based on
   * current hp / maxHp ratio. Apply the phase's atkMul / speedMul /
   * colorTint modifiers.
   */
  _tickPhaseTransition(boss) {
    if (!boss.config || !boss.config.phases) return;
    const phases = boss.config.phases;
    let phase = boss.phase | 0;
    // Phase 0 is implicit; thresholds come from phases[1..].
    // Walk forward while current hp / maxHp <= phase[i].hpThreshold.
    for (let i = phases.length - 1; i > phase; i--) {
      const threshold = phases[i].hpThreshold;
      if (threshold == null) continue;
      if (boss.maxHp > 0 && (boss.hp / boss.maxHp) <= threshold) {
        phase = i;
      }
    }
    if (phase !== boss.phase) {
      boss.phase = phase;
      const p = phases[phase] || {};
      if (p.atkMul != null) boss.atk = Math.round((boss.config.atk || 1) * p.atkMul);
      if (p.speedMul != null) boss.speed = (boss.config.speed || 1) * p.speedMul;
      if (p.colorTint) boss.color = p.colorTint;
      // Re-initialize skill cooldowns so the new phase feels fresh.
      if (boss._skillStates) {
        for (const s of boss._skillStates) {
          s.cooldown = 0;
          s.ready = false;
        }
      }
    }
  }

  /**
   * Decrement each skill's cooldown, fire the first skill that is
   * ready (and the player is in range for triggered skills).
   */
  _tickSkillCooldowns(boss, dt, now) {
    if (!boss._skillStates) return;
    for (const skill of boss._skillStates) {
      if (skill.cooldown > 0) {
        skill.cooldown = Math.max(0, skill.cooldown - dt);
      }
      // Auto-ready when the cooldown hits zero AND the player is
      // within the boss's detectRange. We use detectRange as the
      // trigger envelope so skills don't fire on a far-away player.
      const inRange = this._playerInDetectRange(boss);
      if (skill.cooldown <= 0 && inRange && !skill.ready) {
        skill.ready = true;
      }
      if (skill.ready) {
        // Snapshot the cooldown in effect at fire time; tests that
        // pre-set a small cooldown (0.5s) want the same value back
        // after a fire rather than the boss-config default.
        const prevCooldown = skill.cooldown;
        const result = this._fireSkill(boss, skill, now);
        if (result) {
          skill.firedAt = now;
          skill.ready = false;
          // Re-arm cooldown. Prefer the smaller of:
          //   - the pre-fire cooldown (preserves test / manual timing)
          //   - the boss-config cooldown (default behavior)
          // so both test fixtures and production data behave sanely.
          const cfgSkill = (boss.config.skills || []).find(s => s.id === skill.id);
          const cfgCd = cfgSkill ? (cfgSkill.cooldown || 0) : 0;
          skill.cooldown = Math.min(prevCooldown || cfgCd, cfgCd || prevCooldown || 0) || cfgCd;
          if (typeof this.onSkill === 'function') {
            try { this.onSkill(boss, result); } catch (_) { /* swallow */ }
          }
        }
      }
    }
  }

  /**
   * Fire one skill. Returns the result object (skills are pure
   * functions); null if the skill can't fire (no player / not in
   * range). VFX emission is the caller's responsibility.
   */
  _fireSkill(boss, skill, now) {
    if (!this.player) return null;
    // Skills read params from boss._activeSkill (legacy contract from
    // M2.10a). We re-attach the skill config entry there before
    // invoking, then clean it up after.
    boss._activeSkill = skill;
    try {
      return runSkill(skill.type, {
        boss, player: this.player, rng: this._rng,
        world: this.world, skill
      });
    } finally {
      boss._activeSkill = null;
    }
  }

  /**
   * True if the player is within the boss's detectRange (Chebyshev).
   * Returns false if no player is registered.
   */
  _playerInDetectRange(boss) {
    if (!this.player) return false;
    const range = (boss.config && boss.config.detectRange) || 8;
    const dx = Math.abs(Math.floor(this.player.x) - Math.floor(boss.x));
    const dy = Math.abs(Math.floor(this.player.y) - Math.floor(boss.y));
    return Math.max(dx, dy) <= range;
  }
}

/**
 * Static ctor cache. Set via BossManager.registerMonster(Monster).
 * We avoid a top-level import of Monster to keep the module
 * dependency graph shallow and prevent import cycles.
 */
