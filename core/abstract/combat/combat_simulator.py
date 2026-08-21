"""Combat simulator — runs a deterministic tick loop with FSM AI + Quadtree.

This is the canonical reference used by the GDScript mirror
(`core/abstract/ai/quadtree.gd` and `core/abstract/combat/hate_table.gd`).
The Godot runtime consumes the same numbers to render hit FX / damage labels.

M2.10 验收 ①②③④.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple

from core.abstract.ai.quadtree import AABB, Quadtree, build_quadtree
from core.abstract.combat.hate_table import HateTable, HateTableSet, HATE_DECAY_PER_SEC


# -----------------------------------------------------------------------------
# AI state machine
# -----------------------------------------------------------------------------

class AIState(str, Enum):
    PATROL = "patrol"
    DETECT = "detect"   # just noticed a target; lock-on 0.5s before chasing
    CHASE = "chase"
    ATTACK = "attack"
    RETREAT = "retreat"  # low HP, run home / away


# World constants
DETECT_DURATION = 0.5  # s — must be visible to the player as the "!" indicator
PATROL_RADIUS = 96.0   # px around spawn — patrol wander radius
LEASH_RADIUS = 320.0   # px — give up chase if target is farther than this
RETREAT_HP_FRAC = 0.20  # below 20% HP, retreat
ATTACK_RANGE = 32.0   # px — within this distance a monster can hit
HURT_STUN_DURATION = 0.3  # s — 受击顿帧


# -----------------------------------------------------------------------------
# Weapon stats
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class WeaponStats:
    name: str
    damage: float
    cooldown: float        # s — LMB attack interval
    range_px: float        # px — hitbox reach
    arc_deg: float         # degrees — hitbox cone (or 360 for full circle)
    knockback_px: float    # px — knockback on hit
    crit_chance: float     # 0..1
    crit_multiplier: float # >= 1


WEAPONS: Dict[str, WeaponStats] = {
    "fist":   WeaponStats("fist",   5.0,  0.5, 28.0, 90.0,  4.0,  0.05, 2.0),
    "dagger": WeaponStats("dagger", 8.0,  0.4, 30.0, 60.0,  6.0,  0.10, 2.0),
    "axe":    WeaponStats("axe",    18.0, 0.9, 36.0, 110.0, 12.0, 0.05, 2.5),
    "sword":  WeaponStats("sword",  14.0, 0.7, 40.0, 90.0,  10.0, 0.08, 2.2),
    "spear":  WeaponStats("spear",  12.0, 0.8, 64.0, 30.0,  14.0, 0.06, 2.3),
    "torch":  WeaponStats("torch",  6.0,  0.6, 30.0, 80.0,  2.0,  0.04, 1.5),
}


# -----------------------------------------------------------------------------
# Live entities
# -----------------------------------------------------------------------------

@dataclass
class EntityState:
    """Mutable state for a player or monster entity in the simulator."""
    eid: int
    pos_x: float
    pos_y: float
    hp: float
    max_hp: float
    team: str                       # "player" or "monster"
    monster_id: Optional[int] = None  # set if team == "monster"
    archetype: str = ""             # e.g. "treant"; empty for players
    radius: float = 12.0
    spawn_x: float = 0.0
    spawn_y: float = 0.0
    # Combat bookkeeping
    hurt_stun_left: float = 0.0
    invuln_left: float = 0.0
    # Monster AI
    ai_state: AIState = AIState.PATROL
    detect_timer: float = 0.0
    attack_cooldown: float = 0.0
    patrol_target_x: float = 0.0
    patrol_target_y: float = 0.0
    is_dead: bool = False
    # Player weapon
    weapon: str = "fist"
    attack_cooldown_left: float = 0.0
    # Client-side attack-frame broadcast (single tick; consumed by FX layer)
    last_attack_id: int = 0

    @property
    def aabb(self) -> AABB:
        return AABB(self.pos_x - self.radius, self.pos_y - self.radius,
                    self.pos_x + self.radius, self.pos_y + self.radius)

    @property
    def bounds(self) -> AABB:
        return self.aabb


# -----------------------------------------------------------------------------
# Attack event
# -----------------------------------------------------------------------------

@dataclass
class AttackEvent:
    """One melee swing. Multiple HitEvents can be derived from this."""
    attacker_id: int
    weapon_name: str
    hitbox: AABB
    damage: float
    knockback_px: float
    is_crit: bool
    frame_time: float


@dataclass
class HitEvent:
    """Emitted when a hitbox actually intersects a target."""
    attacker_id: int
    target_id: int
    damage: float
    is_crit: bool
    knockback_x: float
    knockback_y: float
    stunned: bool


# -----------------------------------------------------------------------------
# Hit resolution
# -----------------------------------------------------------------------------

def _resolve_attack(
    attacker: EntityState,
    weapon: WeaponStats,
    target_dir_x: float,
    target_dir_y: float,
    candidates: Sequence[EntityState],
    frame_time: float,
) -> Tuple[AttackEvent, List[HitEvent], List[EntityState]]:
    """Resolve a single melee swing.

    Returns (attack_event, hit_events, hit_targets).
    - Builds an oriented hitbox in front of the attacker.
    - Filters candidates by team/angle/cone.
    - Applies damage + knockback + hate + hurt-stun.
    """
    # 1. Build hitbox
    if weapon.name == "fist":
        # Fist uses a circular hitbox centered on the attacker
        hitbox = AABB(
            attacker.pos_x - weapon.range_px,
            attacker.pos_y - weapon.range_px,
            attacker.pos_x + weapon.range_px,
            attacker.pos_y + weapon.range_px,
        )
    else:
        # Oriented hitbox: extend from attacker in the swing direction
        reach = weapon.range_px
        half_arc = math.radians(weapon.arc_deg * 0.5)
        hx = target_dir_x * reach
        hy = target_dir_y * reach
        half_w = reach * max(math.sin(half_arc), 0.1)
        if abs(hx) + abs(hy) < 1e-6:
            hx, hy = 0.0, -1.0
        perp_x, perp_y = -hy, hx
        pn = math.hypot(perp_x, perp_y) or 1.0
        perp_x /= pn
        perp_y /= pn
        cx = attacker.pos_x + hx * 0.5
        cy = attacker.pos_y + hy * 0.5
        ex = cx + perp_x * half_w
        ey = cy + perp_y * half_w
        wx = cx - perp_x * half_w
        wy = cy - perp_y * half_w
        hitbox = AABB(
            min(attacker.pos_x, ex, wx),
            min(attacker.pos_y, ey, wy),
            max(attacker.pos_x, ex, wx),
            max(attacker.pos_y, ey, wy),
        )

    # 2. Crit roll
    rng = random.Random(int(frame_time * 1000) ^ attacker.eid)
    is_crit = rng.random() < weapon.crit_chance
    damage = weapon.damage * (weapon.crit_multiplier if is_crit else 1.0)

    # 3. Build Quadtree of *candidates* — for the test we feed all live entities.
    world_bounds = AABB(-2000, -2000, 2000, 2000)
    tree = build_quadtree(candidates, world_bounds)
    nearby = tree.query(hitbox)

    # 4. Filter: cone test (or pass-through for fist full-circle)
    hits: List[HitEvent] = []
    hit_targets: List[EntityState] = []
    for tgt in nearby:
        if tgt.eid == attacker.eid:
            continue
        if tgt.team == attacker.team:
            continue
        if tgt.is_dead:
            continue
        # Cone: only count entities within ±arc/2 of swing direction
        if weapon.name != "fist":
            dx = tgt.pos_x - attacker.pos_x
            dy = tgt.pos_y - attacker.pos_y
            d = math.hypot(dx, dy)
            if d < 1e-6:
                continue
            nx, ny = dx / d, dy / d
            dot = nx * target_dir_x + ny * target_dir_y
            cos_half = math.cos(math.radians(weapon.arc_deg * 0.5))
            if dot < cos_half:
                continue
        # Apply hit
        knock_dir_x = tgt.pos_x - attacker.pos_x
        knock_dir_y = tgt.pos_y - attacker.pos_y
        nd = math.hypot(knock_dir_x, knock_dir_y) or 1.0
        knock_dir_x /= nd
        knock_dir_y /= nd
        kb = weapon.knockback_px * (1.5 if is_crit else 1.0)
        if tgt.invuln_left <= 0:
            tgt.hp -= damage
            tgt.hurt_stun_left = HURT_STUN_DURATION
            tgt.invuln_left = 0.1
        hits.append(HitEvent(
            attacker_id=attacker.eid,
            target_id=tgt.eid,
            damage=damage,
            is_crit=is_crit,
            knockback_x=knock_dir_x * kb,
            knockback_y=knock_dir_y * kb,
            stunned=True,
        ))
        hit_targets.append(tgt)

    atk = AttackEvent(
        attacker_id=attacker.eid,
        weapon_name=weapon.name,
        hitbox=hitbox,
        damage=damage,
        knockback_px=weapon.knockback_px,
        is_crit=is_crit,
        frame_time=frame_time,
    )
    return atk, hits, hit_targets


# -----------------------------------------------------------------------------
# Monster AI tick
# -----------------------------------------------------------------------------

def _monster_think(
    monster: EntityState,
    players: List[EntityState],
    hates: HateTableSet,
    dt: float,
    rng: random.Random,
) -> None:
    """Single monster brain step. Updates ai_state + position.

    5-state FSM: PATROL → DETECT → CHASE → ATTACK → RETREAT (→ CHASE or PATROL).
    """
    if monster.is_dead:
        return
    if monster.hurt_stun_left > 0:
        monster.hurt_stun_left = max(0.0, monster.hurt_stun_left - dt)
        return

    # Update hate decay
    hates.tables.get(monster.eid, HateTable()).tick(dt)

    # 1. Pick current target — hate table top, fallback to nearest player
    target: Optional[EntityState] = None
    top = hates.top(monster.eid)
    if top is not None:
        tid, _hate = top
        for p in players:
            if not p.is_dead and p.eid == tid:
                target = p
                break
    if target is None:
        detect_range = 192.0
        best_d = float("inf")
        for p in players:
            if p.is_dead:
                continue
            d = math.hypot(p.pos_x - monster.pos_x, p.pos_y - monster.pos_y)
            if d < detect_range and d < best_d:
                best_d = d
                target = p

    has_target = target is not None
    dist = float("inf")
    if has_target:
        assert target is not None
        dist = math.hypot(target.pos_x - monster.pos_x, target.pos_y - monster.pos_y)

    # HP gating for RETREAT
    if monster.hp / monster.max_hp <= RETREAT_HP_FRAC and monster.ai_state != AIState.RETREAT:
        monster.ai_state = AIState.RETREAT

    prev_state = monster.ai_state

    # 2. State transitions
    if monster.ai_state == AIState.PATROL:
        if has_target:
            monster.ai_state = AIState.DETECT
        else:
            _monster_patrol(monster, dt, rng)
    elif monster.ai_state == AIState.DETECT:
        if not has_target:
            monster.ai_state = AIState.PATROL
        else:
            monster.detect_timer -= dt
            if monster.detect_timer <= 0:
                monster.ai_state = AIState.CHASE
    elif monster.ai_state == AIState.CHASE:
        if not has_target:
            monster.ai_state = AIState.PATROL
        elif dist > LEASH_RADIUS:
            hates.tables.pop(monster.eid, None)
            monster.ai_state = AIState.PATROL
        elif dist <= ATTACK_RANGE:
            monster.ai_state = AIState.ATTACK
        else:
            assert target is not None
            _monster_chase(monster, target, dt)
    elif monster.ai_state == AIState.ATTACK:
        if not has_target:
            monster.ai_state = AIState.PATROL
        elif dist > ATTACK_RANGE * 1.2:
            monster.ai_state = AIState.CHASE
        else:
            monster.attack_cooldown -= dt
            if monster.attack_cooldown <= 0:
                assert target is not None
                if target.invuln_left <= 0:
                    target.hp -= 4.0
                    target.hurt_stun_left = HURT_STUN_DURATION
                    target.invuln_left = 0.15
                ux = target.pos_x - monster.pos_x
                uy = target.pos_y - monster.pos_y
                nd = math.hypot(ux, uy) or 1.0
                ux /= nd
                uy /= nd
                target.pos_x += ux * 12.0
                target.pos_y += uy * 12.0
                hates.add(monster.eid, target.eid, 8.0)
                monster.attack_cooldown = 1.0
    elif monster.ai_state == AIState.RETREAT:
        if monster.hp <= 0:
            monster.is_dead = True
            return
        dx = monster.spawn_x - monster.pos_x
        dy = monster.spawn_y - monster.pos_y
        d = math.hypot(dx, dy)
        if d < 4.0:
            monster.hp = min(monster.max_hp, monster.hp + 2.0 * dt)
            if monster.hp / monster.max_hp > RETREAT_HP_FRAC * 2.0:
                monster.ai_state = AIState.PATROL
        else:
            spd = 60.0
            monster.pos_x += dx / d * spd * dt
            monster.pos_y += dy / d * spd * dt

    # 3. Just-entered DETECT: reset timer
    if monster.ai_state == AIState.DETECT and prev_state != AIState.DETECT:
        monster.detect_timer = DETECT_DURATION

    # 4. Death cleanup
    if monster.hp <= 0:
        monster.is_dead = True


def _monster_patrol(monster: EntityState, dt: float, rng: random.Random) -> None:
    """Wander near spawn point."""
    dx = monster.patrol_target_x - monster.pos_x
    dy = monster.patrol_target_y - monster.pos_y
    d = math.hypot(dx, dy)
    spd = 24.0
    if d < 4.0:
        for _ in range(4):
            ang = rng.random() * math.tau
            r = rng.random() * PATROL_RADIUS
            nx = monster.spawn_x + math.cos(ang) * r
            ny = monster.spawn_y + math.sin(ang) * r
            if 0 < nx < 2000 and 0 < ny < 2000:
                monster.patrol_target_x = nx
                monster.patrol_target_y = ny
                break
    else:
        monster.pos_x += dx / d * spd * dt
        monster.pos_y += dy / d * spd * dt


def _monster_chase(monster: EntityState, target: EntityState, dt: float) -> None:
    """Move toward target at chase speed."""
    dx = target.pos_x - monster.pos_x
    dy = target.pos_y - monster.pos_y
    d = math.hypot(dx, dy) or 1.0
    spd = 64.0
    monster.pos_x += dx / d * spd * dt
    monster.pos_y += dy / d * spd * dt


# -----------------------------------------------------------------------------
# Public driver
# -----------------------------------------------------------------------------

def tick(
    entities: List[EntityState],
    hates: HateTableSet,
    dt: float,
    *,
    server_time: float,
    rng: Optional[random.Random] = None,
) -> Dict[int, List[HitEvent]]:
    """Advance the simulator one tick.

    Returns a map: attacker_id → list of HitEvents generated this tick.
    """
    if rng is None:
        rng = random.Random(int(server_time * 1000))

    players = [e for e in entities if e.team == "player"]
    monsters = [e for e in entities if e.team == "monster"]

    # 1. Monster AI
    for m in monsters:
        _monster_think(m, players, hates, dt, rng)

    # 2. Tick player cooldowns
    for p in players:
        if p.attack_cooldown_left > 0:
            p.attack_cooldown_left = max(0.0, p.attack_cooldown_left - dt)
        p.invuln_left = max(0.0, p.invuln_left - dt)

    return {}


def fire_player_attack(
    entities: Sequence[EntityState],
    hates: HateTableSet,
    attacker: EntityState,
    dir_x: float,
    dir_y: float,
    *,
    server_time: float,
) -> Tuple[AttackEvent, List[HitEvent]]:
    """Execute one player attack swing.

    Caller is responsible for ensuring the player is alive and not in cooldown.
    Returns (attack_event, hit_events). Damage is applied here. Hate is added.
    """
    weapon = WEAPONS[attacker.weapon]
    nd = math.hypot(dir_x, dir_y) or 1.0
    dir_x, dir_y = dir_x / nd, dir_y / nd

    atk, hits, hit_targets = _resolve_attack(
        attacker, weapon, dir_x, dir_y, list(entities), server_time,
    )
    for tgt in hit_targets:
        for h in hits:
            if h.target_id == tgt.eid:
                tgt.pos_x += h.knockback_x
                tgt.pos_y += h.knockback_y
                break
        if tgt.team == "monster" and tgt.monster_id is not None:
            hates.add(tgt.monster_id, attacker.eid, atk.damage)
        if tgt.hp <= 0:
            tgt.is_dead = True
    attacker.attack_cooldown_left = weapon.cooldown
    attacker.last_attack_id += 1
    return atk, hits


# -----------------------------------------------------------------------------
# Convenience archetype
# -----------------------------------------------------------------------------

ARCHETYPES: Dict[str, Dict[str, float]] = {
    "treant": dict(max_hp=120.0, radius=18.0, patrol_speed=18.0, chase_speed=44.0, attack_cd=1.4),
    "spider": dict(max_hp=42.0,  radius=12.0, patrol_speed=30.0, chase_speed=78.0, attack_cd=0.8),
    "bat":    dict(max_hp=22.0,  radius=10.0, patrol_speed=24.0, chase_speed=70.0, attack_cd=0.6),
    "hound":  dict(max_hp=64.0,  radius=14.0, patrol_speed=28.0, chase_speed=92.0, attack_cd=0.7),
    "merm":   dict(max_hp=80.0,  radius=14.0, patrol_speed=20.0, chase_speed=58.0, attack_cd=1.0),
}


def make_monster(eid: int, archetype: str, x: float, y: float) -> EntityState:
    spec = ARCHETYPES[archetype]
    return EntityState(
        eid=eid,
        pos_x=x,
        pos_y=y,
        spawn_x=x,
        spawn_y=y,
        hp=spec["max_hp"],
        max_hp=spec["max_hp"],
        team="monster",
        monster_id=eid,
        archetype=archetype,
        radius=spec["radius"],
        attack_cooldown=spec["attack_cd"],
    )


def make_player(eid: int, x: float, y: float, weapon: str = "fist") -> EntityState:
    return EntityState(
        eid=eid,
        pos_x=x,
        pos_y=y,
        hp=100.0,
        max_hp=100.0,
        team="player",
        radius=12.0,
        weapon=weapon,
    )
