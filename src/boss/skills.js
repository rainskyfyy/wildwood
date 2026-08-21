/**
 * Boss Skills — 4 reusable skill behaviors for the v0.5.2 Boss system.
 *
 * Each skill is a pure function that takes a context (boss, player,
 * world, rng) and returns a result describing what happened:
 *
 *   { kind, damage, vfx, summoned }
 *
 * The BossManager is responsible for applying `damage` to the player,
 * emitting the `vfx` for the renderer, and adding `summoned` to the
 * monster roster. Skills themselves are deterministic given (ctx) so
 * they are easy to unit-test.
 *
 * Skill kinds:
 *   charge  — boss dashes toward the player for `duration` seconds,
 *             dealing `damageMul * boss.atk` damage on hit (one-time)
 *   roar    — boss emits a wave; deals 0 damage but applies a 3-second
 *             slow effect on the player (vfx = "wave" + a 3s slow)
 *   aoe     — area-of-effect around the boss; deals `damageMul * boss.atk`
 *             damage to all entities in `range` tiles
 *   summon  — spawns `count` minions of `minionType` in a ring around
 *             the boss; the BossManager feeds the minion into the
 *             MonsterManager roster
 *
 * v0.5.2 — current scope: pure functions, no side effects. Caller
 *   (BossManager) handles all state mutations and notifications.
 */
'use strict';

/**
 * Common skill context: { boss, player, world, rng, now, monsters }
 *   boss    — the Monster instance (with config, x, y, atk, etc.)
 *   player  — Player instance (must have takeDamage, x, y)
 *   world   — WorldGrid (for isWalkable in summon placement)
 *   rng     — () => [0, 1) for any randomized placement
 *   now     — current time in ms
 *   monsters— MonsterManager (for summon)
 */

/**
 * Chebyshev distance helper.
 */
function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function hypot(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Charge: dash toward the player for `duration` seconds at `speed`
 * tiles/s, dealing damage on contact (Chebyshev ≤ attackRange).
 *
 * Returns:
 *   { kind: 'charge', damage, vfx, dx, dy, duration }
 * The caller (BossManager) decides whether to apply the damage —
 * typically only if the player is still in range at the END of the
 * dash. Here we report the **expected** damage based on a single
 * contact, since the dash's per-frame hit detection is done in
 * BossManager._tickSkill.
 */
export function charge(ctx) {
  const { boss, player } = ctx;
  const skill = boss._activeSkill;
  const dx = player.x - boss.x;
  const dy = player.y - boss.y;
  const dist = Math.hypot(dx, dy);
  const ux = dist > 0 ? dx / dist : 0;
  const uy = dist > 0 ? dy / dist : 0;
  const damage = Math.round((boss.atk || 10) * (skill.damageMul || 1.5));
  return {
    kind: 'charge',
    damage,
    vfx: { type: 'dash', ux, uy, duration: skill.duration || 0.6 },
    dx: ux * (skill.speed || 10.0) * (skill.duration || 0.6),
    dy: uy * (skill.speed || 10.0) * (skill.duration || 0.6)
  };
}

/**
 * Roar: emits a wave around the boss. Damage = 0, but slows the player
 * for 3 seconds (passed to caller as vfx.duration).
 */
export function roar(ctx) {
  const { boss } = ctx;
  const skill = boss._activeSkill;
  return {
    kind: 'roar',
    damage: 0,
    vfx: {
      type: 'wave',
      radius: skill.range || 4,
      duration: skill.duration || 0.4,
      slowDuration: 3.0,
      slowFactor: 0.5
    }
  };
}

/**
 * AOE: damage in a radius around the boss. Caller should apply damage
 * only if the player is in range (we report the full damage; the
 * BossManager checks distance before applying).
 */
export function aoe(ctx) {
  const { boss } = ctx;
  const skill = boss._activeSkill;
  const damage = Math.round((boss.atk || 10) * (skill.damageMul || 1.0));
  return {
    kind: 'aoe',
    damage,
    vfx: {
      type: 'shockwave',
      radius: skill.range || 3,
      duration: 0.5
    }
  };
}

/**
 * Summon: find up to `count` walkable tiles in a ring around the boss
 * and return them. The BossManager will spawn minions at those tiles.
 */
export function summon(ctx) {
  const { boss, world, rng } = ctx;
  const skill = boss._activeSkill;
  const count = Math.max(1, skill.count || 1);
  const range = Math.max(1, skill.range || 3);
  const minionType = skill.minionType || 'spider';
  const cx = Math.floor(boss.x);
  const cy = Math.floor(boss.y);
  const out = [];
  // Generate up to 12 ring candidates and pick the first `count` walkable ones.
  for (let tries = 0; tries < 24 && out.length < count; tries++) {
    const ang = rng() * Math.PI * 2;
    const r = range * (0.6 + rng() * 0.4);
    const tx = cx + Math.round(Math.cos(ang) * r);
    const ty = cy + Math.round(Math.sin(ang) * r);
    if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
    if (!world.isWalkable(tx, ty)) continue;
    // Reject duplicates.
    if (out.some(p => p.x === tx && p.y === ty)) continue;
    out.push({ x: tx + 0.5, y: ty + 0.5, typeId: minionType });
  }
  return {
    kind: 'summon',
    damage: 0,
    vfx: { type: 'summon', count: out.length },
    summoned: out
  };
}

/**
 * Skill registry: id → function. Look up by `boss._activeSkill.type`.
 */
export const Skills = Object.freeze({
  charge,
  roar,
  aoe,
  summon
});

/**
 * Run a skill by its type. Returns null if the type is unknown.
 */
export function runSkill(type, ctx) {
  const fn = Skills[type];
  if (!fn) return null;
  return fn(ctx);
}

/**
 * Apply an AOE result to the player. Used by BossManager after
 * `aoe()` returns. Returns the damage applied (0 if player was out of
 * range, full damage otherwise).
 */
export function applyAoeToPlayer(result, boss, player) {
  if (!result || result.kind !== 'aoe') return 0;
  const dist = chebyshev(
    Math.floor(boss.x), Math.floor(boss.y),
    Math.floor(player.x), Math.floor(player.y)
  );
  if (dist > (result.vfx.radius || 3)) return 0;
  if (player.hp <= 0) return 0;
  return player.takeDamage(result.damage) ? result.damage : result.damage;
}

/**
 * Apply a charge result. Damage applied if the player is within the
 * boss's attack range when the charge finishes (BossManager checks
 * this per-frame during the dash).
 */
export function applyChargeHitToPlayer(result, boss, player) {
  if (!result || result.kind !== 'charge') return 0;
  if (player.hp <= 0) return 0;
  const dist = chebyshev(
    Math.floor(boss.x), Math.floor(boss.y),
    Math.floor(player.x), Math.floor(player.y)
  );
  if (dist > boss.attackRange) return 0;
  player.takeDamage(result.damage);
  return result.damage;
}

/**
 * Apply a roar slow to the player. vfx.slowDuration / slowFactor are
 * attached to the player for the duration.
 */
export function applyRoarSlowToPlayer(result, player) {
  if (!result || result.kind !== 'roar') return;
  if (player.hp <= 0) return;
  player.slowFactor = result.vfx.slowFactor || 0.5;
  player.slowUntil = (player._now ? player._now() : Date.now()) + (result.vfx.slowDuration || 3) * 1000;
}

/**
 * Default helper: how long does the slow last? Used to clear it.
 */
export function isPlayerSlowed(player, now) {
  if (!player.slowUntil) return false;
  return now < player.slowUntil;
}
