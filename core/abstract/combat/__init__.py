# Combat module — attack, hit, FSM AI, hate table, weapon stats.
from core.abstract.combat.combat_simulator import (
    AIState,
    ARCHETYPES,
    AttackEvent,
    DETECT_DURATION,
    EntityState,
    HitEvent,
    LEASH_RADIUS,
    PATROL_RADIUS,
    RETREAT_HP_FRAC,
    WEAPONS,
    WeaponStats,
    fire_player_attack,
    make_monster,
    make_player,
    tick,
)
from core.abstract.combat.hate_table import (
    HATE_DECAY_PER_SEC,
    HATE_EPSILON,
    HateTable,
    HateTableSet,
)

__all__ = [
    "AIState", "ARCHETYPES", "AttackEvent", "DETECT_DURATION", "EntityState",
    "HitEvent", "LEASH_RADIUS", "PATROL_RADIUS", "RETREAT_HP_FRAC",
    "WEAPONS", "WeaponStats", "fire_player_attack", "make_monster", "make_player",
    "tick", "HATE_DECAY_PER_SEC", "HATE_EPSILON", "HateTable", "HateTableSet",
]
