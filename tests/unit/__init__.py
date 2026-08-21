"""Unit tests for LMB smart decision (M2.1).

TDD discipline: write a failing test first, watch it fail, then implement.

Scope:
  - Task 1: data types (Target/Action)
  - Task 2: decide_lmb_action core 4 scenarios
  - Task 3: 10 acceptance scenarios + 4 edge cases
  - Task 4: perf benchmark p99 < 1ms (200 candidates x 1000 iters)

Note: this file is the single source of truth for M2.1 acceptance. GDScript
binding lmb_decide.gd MUST stay 1:1 semantically; SEMANTICS.md maps each test
to the GDScript equivalent for the GUT suite that runs in CI.
"""

import pytest

from core.abstract.gameplay.lmb_decide import (
    Action,
    ActionType,
    Target,
    TargetType,
    decide_lmb_action,
)


# ---------------------------------------------------------------------------
# Task 1: data types
# ---------------------------------------------------------------------------

def test_target_and_action_types_exist() -> None:
    t = Target(id="t1", pos=(0.0, 0.0), type=TargetType.GATHER)
    a = Action(type=ActionType.MOVE, target_pos=(1.0, 1.0))
    assert t.type == TargetType.GATHER
    assert a.type == ActionType.MOVE
    assert t.id == "t1"
    assert t.pos == (0.0, 0.0)
    assert a.target_pos == (1.0, 1.0)


def test_target_type_enumeration_has_three_values() -> None:
    # NONE is reserved for "not a target" (e.g. floor tiles).
    assert {TargetType.GATHER, TargetType.ATTACK, TargetType.NONE} == set(TargetType)


def test_action_type_enumeration_has_three_values() -> None:
    # 三个动作:移动 / 攻击 / 采集
    assert {ActionType.MOVE, ActionType.ATTACK, ActionType.GATHER} == set(ActionType)
