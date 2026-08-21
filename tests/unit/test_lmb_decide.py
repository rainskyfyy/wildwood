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

import time

import pytest

from core.abstract.gameplay.lmb_decide import (
    Action,
    ActionType,
    DecideContext,
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
    assert {TargetType.GATHER, TargetType.ATTACK, TargetType.NONE} == set(TargetType)


def test_action_type_enumeration_has_three_values() -> None:
    assert {ActionType.MOVE, ActionType.ATTACK, ActionType.GATHER} == set(ActionType)


# ---------------------------------------------------------------------------
# Task 2: decide_lmb_action 4 base scenarios
# ---------------------------------------------------------------------------

def test_decide_no_candidate_returns_move() -> None:
    """ACC-1: 0 候选 → MOVE 到点击点。"""
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=[],
        click_pos=(3.0, 1.0),
    )
    assert a.type == ActionType.MOVE
    assert a.target_pos == (3.0, 1.0)
    assert a.target_id is None


def test_decide_close_gather_target_returns_gather() -> None:
    """ACC-2: 1.0 米内有 gather → GATHER。"""
    cand = [Target(id="g1", pos=(0.8, 0.0), type=TargetType.GATHER)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.0, 0.0),  # 点远了,但目标在 gather 射程内
    )
    assert a.type == ActionType.GATHER
    assert a.target_id == "g1"


def test_decide_close_attack_target_returns_attack() -> None:
    """ACC-3: 1.0 米内有 attack → ATTACK。"""
    cand = [Target(id="a1", pos=(0.5, 0.0), type=TargetType.ATTACK)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.0, 0.0),
    )
    assert a.type == ActionType.ATTACK
    assert a.target_id == "a1"


def test_decide_mixed_targets_prefers_attack() -> None:
    """ACC-4: 攻击与采集同射程 → ATTACK 优先。"""
    cand = [
        Target(id="g1", pos=(0.8, 0.0), type=TargetType.GATHER),
        Target(id="a1", pos=(1.0, 0.0), type=TargetType.ATTACK),
    ]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.0, 0.0),
    )
    assert a.type == ActionType.ATTACK
    assert a.target_id == "a1"


# ---------------------------------------------------------------------------
# Task 3: 10 acceptance scenarios + 4 edge cases
# ---------------------------------------------------------------------------

def test_acc05_no_candidate_unreachable_click_returns_move() -> None:
    """ACC-5: 0 候选 + 越界点击 → MOVE(纯逻辑不卡碰撞)。"""
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=[],
        click_pos=(100.0, 100.0),
    )
    assert a.type == ActionType.MOVE
    assert a.target_pos == (100.0, 100.0)


def test_acc06_far_attack_target_in_attack_range_returns_move() -> None:
    """ACC-6: 距离 > 移动射程 + 目标在攻击射程内 → MOVE(让角色靠近)。

    玩家 (0,0),攻击目标 (3.5, 0) — 3.5 米 > move_range 4.0? 等下,3.5 < 4.0 算移动射程内。
    改成:玩家 (0,0),目标 (5.0, 0) — 5 米 > 4 米移动射程,3 米 > 2 米攻击射程。
    改用 attack_range=3,move_range=4 来构造"远但可攻"。
    """
    cand = [Target(id="a1", pos=(5.0, 0.0), type=TargetType.ATTACK)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(5.0, 0.0),
        ctx=DecideContext(move_range=4.0, attack_range=3.0, gather_range=1.5),
    )
    assert a.type == ActionType.MOVE
    assert a.target_pos == (5.0, 0.0)


def test_acc07_far_gather_target_in_gather_range_returns_move() -> None:
    """ACC-7: 距离 > 移动射程 + 目标在采集射程内 → MOVE。

    但这其实是矛盾条件 — 采集射程 ≤ 移动射程。本测试构造"目标在采集射程
    外、但玩家打算点它"的场景,验证返 MOVE。
    """
    cand = [Target(id="g1", pos=(1.6, 0.0), type=TargetType.GATHER)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(1.6, 0.0),
    )
    # 1.6 > gather_range=1.5 → 不可采集
    assert a.type == ActionType.MOVE
    assert a.target_pos == (1.6, 0.0)


def test_acc08_multiple_gather_picks_nearest() -> None:
    """ACC-8: 多个 gather → 最近。"""
    cand = [
        Target(id="g_far", pos=(1.4, 0.0), type=TargetType.GATHER),
        Target(id="g_near", pos=(0.3, 0.0), type=TargetType.GATHER),
    ]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.0, 0.0),
    )
    assert a.type == ActionType.GATHER
    assert a.target_id == "g_near"


def test_acc09_multiple_attack_picks_nearest() -> None:
    """ACC-9: 多个 attack → 最近。"""
    cand = [
        Target(id="a_far", pos=(1.9, 0.0), type=TargetType.ATTACK),
        Target(id="a_near", pos=(0.4, 0.0), type=TargetType.ATTACK),
    ]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.0, 0.0),
    )
    assert a.type == ActionType.ATTACK
    assert a.target_id == "a_near"


def test_acc10_attack_just_outside_range_returns_move() -> None:
    """ACC-10: 攻击目标刚好在 attack_range 边界外 → MOVE。

    玩家 (0,0),目标 (2.01, 0) — 2.01 > attack_range=2.0 → 不可攻击 → MOVE。
    """
    cand = [Target(id="a1", pos=(2.01, 0.0), type=TargetType.ATTACK)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(2.01, 0.0),
    )
    assert a.type == ActionType.MOVE
    assert a.target_pos == (2.01, 0.0)


# ---------- 边界用例 ----------

def test_edge_player_on_target_distance_zero() -> None:
    """玩家与目标完全重合(距离 0) → ATTACK/GATHER(正确触发,非除零)。"""
    cand = [Target(id="a1", pos=(0.0, 0.0), type=TargetType.ATTACK)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(0.0, 0.0),
    )
    assert a.type == ActionType.ATTACK
    assert a.target_id == "a1"


def test_edge_negative_coordinates() -> None:
    """负坐标区域行为正常(无符号 bug)。"""
    cand = [Target(id="g1", pos=(-0.5, -0.5), type=TargetType.GATHER)]
    a = decide_lmb_action(
        player_pos=(-1.0, -1.0),
        candidates=cand,
        click_pos=(-1.0, -1.0),
    )
    assert a.type == ActionType.GATHER
    assert a.target_id == "g1"


def test_edge_floating_point_just_inside_range() -> None:
    """浮点容差:1.4999 vs 1.5 — 1.4999 应被算作射程内。"""
    cand = [Target(id="g1", pos=(1.4999, 0.0), type=TargetType.GATHER)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(1.4999, 0.0),
    )
    assert a.type == ActionType.GATHER


def test_edge_floating_point_just_outside_range() -> None:
    """浮点容差:1.5001 vs 1.5 — 1.5001 应被算作射程外 → MOVE。"""
    cand = [Target(id="g1", pos=(1.5001, 0.0), type=TargetType.GATHER)]
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=cand,
        click_pos=(1.5001, 0.0),
    )
    assert a.type == ActionType.MOVE


def test_edge_empty_candidates_with_negative_click() -> None:
    """空 candidates + 负向点击 → MOVE。"""
    a = decide_lmb_action(
        player_pos=(0.0, 0.0),
        candidates=[],
        click_pos=(-5.0, -3.0),
    )
    assert a.type == ActionType.MOVE
    assert a.target_pos == (-5.0, -3.0)


# ---------------------------------------------------------------------------
# Task 4: 性能基准 — 200 候选 x 1000 次,p99 < 1ms(预算 200ms 的 0.5%)
# ---------------------------------------------------------------------------

def test_decide_perf_under_1ms_p99_with_200_candidates() -> None:
    """性能基准:200 候选目标,1000 次决策,p99 < 1ms。

    200ms 响应预算的 0.5% 留给核心判别,给输入处理 / sprite 更新 / 网络
    留 99.5% 缓冲。
    """
    import random
    random.seed(42)
    # 100 attack + 100 gather,均匀分布在 8 米内
    cand = []
    for i in range(100):
        cand.append(Target(
            id=f"a_{i}",
            pos=(random.uniform(-8.0, 8.0), random.uniform(-8.0, 8.0)),
            type=TargetType.ATTACK,
        ))
    for i in range(100):
        cand.append(Target(
            id=f"g_{i}",
            pos=(random.uniform(-8.0, 8.0), random.uniform(-8.0, 8.0)),
            type=TargetType.GATHER,
        ))

    samples: list[float] = []
    for _ in range(1000):
        # 玩家位置/点击位置也随机
        px = random.uniform(-8.0, 8.0)
        py = random.uniform(-8.0, 8.0)
        cx = random.uniform(-8.0, 8.0)
        cy = random.uniform(-8.0, 8.0)
        t0 = time.perf_counter()
        decide_lmb_action((px, py), cand, (cx, cy))
        samples.append((time.perf_counter() - t0) * 1000.0)  # ms

    samples.sort()
    p99 = samples[int(0.99 * len(samples))]
    p50 = samples[int(0.50 * len(samples))]
    # 报告实际值(失败时能看到)
    print(f"\n[M2.1 perf] p50={p50:.4f}ms  p99={p99:.4f}ms  max={samples[-1]:.4f}ms")
    assert p99 < 1.0, f"p99 {p99:.4f}ms exceeds 1ms budget"
