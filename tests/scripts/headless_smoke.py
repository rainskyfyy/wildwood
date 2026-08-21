#!/usr/bin/env python3
"""M2.1 headless smoke — 跑 10 验收场景 + 关键边界。

沙箱无 Godot 二进制时,这是 LMB 智能判别的端到端冒烟测试。等价于 GUT 在
CI 跑的场景(详见 `core/abstract/gameplay/SEMANTICS.md`)。脚本退出码 0 = 全过。
"""
from __future__ import annotations

import sys
from pathlib import Path

# 仓库根目录入 sys.path(脚本放 tests/scripts/)
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from core.abstract.gameplay.lmb_decide import (  # noqa: E402
    ActionType,
    DecideContext,
    Target,
    TargetType,
    decide_lmb_action,
)


# 10 验收场景 + 关键边界
SCENARIOS: list[tuple[str, str, tuple, list, tuple, dict | None, ActionType]] = [
    # (名称, 描述, player_pos, candidates, click_pos, ctx, 期望 action_type)
    (
        "ACC-01 no candidate",
        "0 候选 → MOVE",
        (0.0, 0.0), [], (3.0, 1.0), None, ActionType.MOVE,
    ),
    (
        "ACC-02 close gather",
        "0.8 米内 gather → GATHER",
        (0.0, 0.0), [Target("g1", (0.8, 0.0), TargetType.GATHER)], (2.0, 0.0), None, ActionType.GATHER,
    ),
    (
        "ACC-03 close attack",
        "0.5 米内 attack → ATTACK",
        (0.0, 0.0), [Target("a1", (0.5, 0.0), TargetType.ATTACK)], (2.0, 0.0), None, ActionType.ATTACK,
    ),
    (
        "ACC-04 mixed pref attack",
        "同射程 ATTACK 优先",
        (0.0, 0.0), [
            Target("g1", (0.8, 0.0), TargetType.GATHER),
            Target("a1", (1.0, 0.0), TargetType.ATTACK),
        ], (2.0, 0.0), None, ActionType.ATTACK,
    ),
    (
        "ACC-05 no cand + far click",
        "0 候选 + 远点击 → MOVE(不卡碰撞)",
        (0.0, 0.0), [], (100.0, 100.0), None, ActionType.MOVE,
    ),
    (
        "ACC-06 far attack → MOVE",
        "目标在攻击射程外 → MOVE",
        (0.0, 0.0), [Target("a1", (5.0, 0.0), TargetType.ATTACK)],
        (5.0, 0.0),
        DecideContext(move_range=4.0, attack_range=3.0, gather_range=1.5),
        ActionType.MOVE,
    ),
    (
        "ACC-07 gather out of range → MOVE",
        "目标刚好在 gather 射程外 → MOVE",
        (0.0, 0.0), [Target("g1", (1.6, 0.0), TargetType.GATHER)],
        (1.6, 0.0), None, ActionType.MOVE,
    ),
    (
        "ACC-08 multi gather nearest",
        "多个 gather 选最近",
        (0.0, 0.0), [
            Target("g_far", (1.4, 0.0), TargetType.GATHER),
            Target("g_near", (0.3, 0.0), TargetType.GATHER),
        ], (2.0, 0.0), None, ActionType.GATHER,
    ),
    (
        "ACC-09 multi attack nearest",
        "多个 attack 选最近",
        (0.0, 0.0), [
            Target("a_far", (1.9, 0.0), TargetType.ATTACK),
            Target("a_near", (0.4, 0.0), TargetType.ATTACK),
        ], (2.0, 0.0), None, ActionType.ATTACK,
    ),
    (
        "ACC-10 attack just outside range → MOVE",
        "目标刚好在 attack 边界外 → MOVE",
        (0.0, 0.0), [Target("a1", (2.01, 0.0), TargetType.ATTACK)],
        (2.01, 0.0), None, ActionType.MOVE,
    ),
    # 边界
    (
        "EDGE-01 distance zero",
        "距离 0(完全重合) → ATTACK",
        (0.0, 0.0), [Target("a1", (0.0, 0.0), TargetType.ATTACK)],
        (0.0, 0.0), None, ActionType.ATTACK,
    ),
    (
        "EDGE-02 negative coords",
        "负坐标区域",
        (-1.0, -1.0), [Target("g1", (-0.5, -0.5), TargetType.GATHER)],
        (-1.0, -1.0), None, ActionType.GATHER,
    ),
    (
        "EDGE-03 fp just inside 1.4999",
        "浮点 1.4999 < 1.5 → GATHER",
        (0.0, 0.0), [Target("g1", (1.4999, 0.0), TargetType.GATHER)],
        (1.4999, 0.0), None, ActionType.GATHER,
    ),
    (
        "EDGE-04 fp just outside 1.5001",
        "浮点 1.5001 > 1.5 → MOVE",
        (0.0, 0.0), [Target("g1", (1.5001, 0.0), TargetType.GATHER)],
        (1.5001, 0.0), None, ActionType.MOVE,
    ),
    (
        "EDGE-05 empty cand + neg click",
        "空 candidates + 负向点击 → MOVE",
        (0.0, 0.0), [], (-5.0, -3.0), None, ActionType.MOVE,
    ),
]


def main() -> int:
    failed = 0
    for name, desc, player_pos, cands, click_pos, ctx, expected in SCENARIOS:
        action = decide_lmb_action(player_pos, cands, click_pos, ctx)
        if action.type == expected:
            print(f"  ✓ {name}: {desc}")
        else:
            print(f"  ✗ {name}: expected {expected.value}, got {action.type.value}", file=sys.stderr)
            failed += 1
    total = len(SCENARIOS)
    passed = total - failed
    print(f"\n[M2.1 smoke] {passed}/{total} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
