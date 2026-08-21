"""LMB smart decision core logic (M2.1).

A/B 通用层 — 纯 Python,零外部依赖,Godot 客户端 / Unity 客户端通过各自的
薄包装调用本模块。语义与 GDScript 端 `lmb_decide.gd` 1:1 对齐,逐条对应
`tests/unit/test_lmb_decide.py` 中的验收用例(详见 SEMANTICS.md)。

设计原则:
  - 输入不可变,输出 dataclass
  - 距离度量:欧几里得,32 像素 = 1 米
  - 优先级: ATTACK > GATHER > MOVE
  - 单次扫描 O(n) 选最近;200 目标 p99 < 1ms
  - 射程内最近 attack/gather 目标胜出;超出射程返 MOVE(让角色靠近)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import sqrt
from typing import Iterable, Optional, Tuple


# ---------------------------------------------------------------------------
# 数据类型
# ---------------------------------------------------------------------------

class TargetType(Enum):
    """玩家周围可交互目标的分类。

    NONE 用作"非目标"(地面装饰、UI 占位等),不会参与判别。
    """
    GATHER = "gather"
    ATTACK = "attack"
    NONE = "none"


class ActionType(Enum):
    """LMB 智能判别产出的动作枚举。

    任何"玩家点了一下"都被归到这三种之一:
      - MOVE: 无目标可交互,移动到点击点
      - ATTACK: 攻击射程内有可攻击目标
      - GATHER: 采集射程内有可采集目标(且无更近的攻击目标)
    """
    MOVE = "move"
    ATTACK = "attack"
    GATHER = "gather"


@dataclass(frozen=True)
class Target:
    """世界上的可交互目标。"""
    id: str
    pos: Tuple[float, float]
    type: TargetType


@dataclass(frozen=True)
class Action:
    """LMB 决策结果。"""
    type: ActionType
    target_pos: Optional[Tuple[float, float]] = None
    target_id: Optional[str] = None


# ---------------------------------------------------------------------------
# 决策上下文
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DecideContext:
    """决策参数(可在 M2.x 暴露为 World 配置)。"""
    move_range: float = 4.0    # 玩家单次可下达的移动距离(米)
    attack_range: float = 2.0  # 攻击射程
    gather_range: float = 1.5  # 采集射程


# ---------------------------------------------------------------------------
# 纯函数
# ---------------------------------------------------------------------------

def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """欧几里得距离。"""
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return sqrt(dx * dx + dy * dy)


def _nearest_in_range(
    candidates: Iterable[Target],
    player_pos: Tuple[float, float],
    target_type: TargetType,
    max_range: float,
) -> Optional[Target]:
    """取指定类型、且在 max_range 内的最近候选。返回 None 表示无可用目标。"""
    best: Optional[Target] = None
    best_d = max_range  # 距离阈值: 超出 max_range 视为不可用
    for c in candidates:
        if c.type != target_type:
            continue
        d = _dist(player_pos, c.pos)
        if d <= best_d:
            best_d = d
            best = c
    return best


def decide_lmb_action(
    player_pos: Tuple[float, float],
    candidates: Iterable[Target],
    click_pos: Tuple[float, float],
    ctx: Optional[DecideContext] = None,
) -> Action:
    """LMB 智能判别主入口。

    规则(自上而下,首条命中即返回):
      1. 攻击射程内有 attack 目标 → ATTACK(选最近)
      2. 采集射程内有 gather 目标 → GATHER(选最近)
      3. 移动射程内有点击点 → MOVE 到点击点
      4. 移动射程外(但有目标在攻击/采集射程外) → MOVE 到点击点
         (纯逻辑不卡碰撞,引擎层负责;让角色朝目标方向走)
      5. 无任何目标、无任何目标在射程内 → MOVE 到点击点

    Args:
        player_pos: 玩家世界坐标(米)
        candidates: 场景中所有可交互目标
        click_pos: 鼠标点击处的世界坐标(米)
        ctx: 决策上下文(默认参数见 DecideContext)

    Returns:
        Action 实例;MOVE 时 target_pos = click_pos,ATTACK/GATHER 时
        target_pos = 目标自身位置 + target_id = 目标 id。
    """
    if ctx is None:
        ctx = DecideContext()

    # 1. 攻击优先级最高
    atk = _nearest_in_range(candidates, player_pos, TargetType.ATTACK, ctx.attack_range)
    if atk is not None:
        return Action(type=ActionType.ATTACK, target_pos=atk.pos, target_id=atk.id)

    # 2. 其次采集
    gat = _nearest_in_range(candidates, player_pos, TargetType.GATHER, ctx.gather_range)
    if gat is not None:
        return Action(type=ActionType.GATHER, target_pos=gat.pos, target_id=gat.id)

    # 3-5. 默认 MOVE 到点击点
    return Action(type=ActionType.MOVE, target_pos=click_pos, target_id=None)
