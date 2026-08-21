"""
M2.4 survival system — 端到端集成测试

覆盖 4 维 + 3 modifier 联动,模拟实际游戏场景。
"""

from __future__ import annotations

import pytest

from core.abstract.survival import (
    SurvivalStats,
    SurvivalContext,
    Season,
    SurvivalSystem,
    is_critical,
    get_speed_modifier,
    should_show_illusion,
    TICK_DT,
)
from core.abstract.survival.tick import TICK_HZ


def run_seconds(sys: SurvivalSystem, seconds: float) -> None:
    count = int(seconds * TICK_HZ)
    for _ in range(count):
        sys.tick()


class TestScenarioNormalPlayer:
    """场景 A:正常玩家,30Hz tick 1 分钟后状态稳定。"""

    def test_normal_player_1min_stable(self):
        s = SurvivalStats()
        c = SurvivalContext()  # 默认 20°C
        sys = SurvivalSystem(s, c)
        run_seconds(sys, 60.0)
        # 1 分钟后:
        #  - 饥饿掉约 60 × 0.0556 ≈ 3.3 (从 100 掉到 96.7)
        #  - 精神掉约 60 × 0.1 = 6 (从 100 掉到 94)
        #  - 温度仍约 20 (中性)
        #  - HP 几乎不掉
        assert s.hunger < 100.0
        assert s.hunger > 95.0
        assert s.sanity < 100.0
        assert s.sanity > 90.0
        assert abs(s.temperature - 20.0) < 1.0
        assert s.hp == 100.0  # 没有扣血条件
        # modifier 全 1
        assert get_speed_modifier(s) == 1.0
        assert is_critical(s) is False
        assert should_show_illusion(s) is False


class TestScenarioArcticWinter:
    """场景 B:极端寒冬(ambient=-15, 无火, 无庇护所),10 秒后温度 < 0, modifier = 0.5。"""

    def test_arctic_winter_freezing_modifier(self):
        s = SurvivalStats(temperature=20.0)
        c = SurvivalContext(
            ambient_temperature=-15.0,
            is_near_fire=False,
            is_in_shelter=False,
            is_wet=False,
        )
        sys = SurvivalSystem(s, c)
        run_seconds(sys, 10.0)
        # 10 秒后温度应已 < 0 (从 20 向 -15 收敛)
        assert s.temperature < 0.0
        # modifier 0.5
        assert get_speed_modifier(s) == 0.5
        # 警示触发(温度 < 5°C)
        assert is_critical(s) is True


class TestScenarioStarvation:
    """场景 C:持续不进食,40 分钟后饥饿归零 + 精神归零 → HP 持续扣血直至死亡。"""

    def test_hunger_then_mental_then_hp_drain_to_death(self):
        s = SurvivalStats(hp=100.0, hunger=100.0, sanity=100.0, temperature=20.0)
        c = SurvivalContext(season=Season.SUMMER.value)
        sys = SurvivalSystem(s, c)
        # 100/0.0556 ≈ 1800s 饥饿归零
        # 100/0.1 = 1000s 精神归零(精神归零后开始扣血 -1/s)
        # 饥饿归零后扣血 -2/s
        # 精神归零时刻(1000s)HP 已经扣了 0(那时饥饿未归零)
        # 1000s 之后精神持续 -1/s,1800s 之后饥饿也开始 -2/s
        # 跑 40 分钟 = 2400s,玩家必死
        run_seconds(sys, 2400.0)
        assert sys.is_dead is True
        assert s.hp <= 0.0


class TestScenarioInsanityIllusion:
    """场景 D:精神归零 → 幻象 + 警示。"""

    def test_insanity_triggers_illusion_and_critical(self):
        s = SurvivalStats(sanity=100.0, hp=100.0, hunger=100.0, temperature=20.0)
        c = SurvivalContext(
            time_of_day=0.0,  # 午夜
            monster_proximity=1.0,  # 被怪物包围
        )
        sys = SurvivalSystem(s, c)
        # 基础 0.1 + 怪物 0.3 + 夜晚 0.15 = 0.55/s
        # 100 / 0.55 ≈ 182s 精神归零
        run_seconds(sys, 200.0)
        assert s.sanity <= 0.0
        # 幻象触发
        assert should_show_illusion(s) is True
        # 警示触发(精神 = 0)
        assert is_critical(s) is True
        # 精神归零 + 仍在极端环境 → HP 也在掉
        # 200s 时精神刚归零,扣血才几秒,HP 应该只掉 1-2
        # 但因为饥饿还没扣(0.0556/s × 200 ≈ 11),HP 应该几乎满
        # 我们只检查 HP 仍 < 100
        assert s.hp < 100.0


class TestScenarioFireShelter:
    """场景 E:篝火 + 庇护所,玩家在严冬中可保持温度。"""

    def test_fire_shelter_keeps_warm_in_arctic(self):
        s = SurvivalStats(temperature=10.0, hp=80.0, hunger=80.0, sanity=80.0)
        c = SurvivalContext(
            ambient_temperature=-15.0,
            is_near_fire=True,
            is_in_shelter=True,
        )
        sys = SurvivalSystem(s, c)
        run_seconds(sys, 30.0)
        # 庇护所 + 火堆 → 温度向 20°C 拉
        # 30 秒后温度应明显高于初始
        assert s.temperature > 10.0
        # 火堆 + 庇护所的目标温度 = (max(-15, 20) × 0.5 + 15 × 0.5)
        # = (20 × 0.5 + 7.5) = 17.5
        # 加上 +2/s 火堆加成(30s = +60,但会被 clamp 到 100)
        # 实际温度应接近 20°C 上限
        assert s.temperature > 15.0
        # modifier 仍 1.0 (温度 > 0)
        assert get_speed_modifier(s) == 1.0
        # HP 应该再生(饱腹 > 50, 精神 > 50, 温度适中)
        # 30s 精神基础衰减 0.1/s × 30 = 3 → 精神 77(仍 > 50)
        # 30s 不够 5s × 3 = 15s 才能再生 1 HP
        # 但 _hp_regen_timer 累积 30s,达到 5s 一次 → 30/5 = 6 次
        # 实际再生 6 HP
        # 注意:由于 _hp_regen_timer 是累加的,达到 5s 立即再生 1,然后减 5s
        # 30s 应该再生 6 HP
        # 但精神每秒 -0.1 仍在掉(80 → 77),仍 > 50,条件满足
        assert s.hp >= 80.0  # 应该 >= 80(因为再生)


class TestScenarioComplexCompound:
    """场景 F:复合 modifier,所有 modifier 同时触发。"""

    def test_all_modifiers_triggered_takes_min(self):
        # 温度低 + HP 低 + 精神低
        s = SurvivalStats(
            hp=20.0,  # 20% < 30%
            hunger=80.0,
            sanity=29.0,  # < 30%
            temperature=-5.0,  # < 0
        )
        # 速度 modifier:0.5(freezing) / 0.8(low hp) → 0.5
        assert get_speed_modifier(s) == 0.5
        # 警示:HP 20% < 30%, 精神 29% < 30% → True
        assert is_critical(s) is True
        # 幻象:精神 29% < 30% → True
        assert should_show_illusion(s) is True


class TestScenarioRestingRecovery:
    """场景 G:玩家休息,精神和 HP 恢复(需要足够时间让 HP 再生条件满足)。"""

    def test_rest_recovery(self):
        s = SurvivalStats(
            hp=20.0,
            hunger=80.0,  # > 50
            sanity=20.0,  # < 50,休息时会恢复
            temperature=20.0,
        )
        c = SurvivalContext(resting=True, is_near_fire=True)
        sys = SurvivalSystem(s, c)
        # 精神 0.5/s 恢复 → 20 → 50 需要 60s
        # 精神 > 50 后,HP 再生条件满足(饱腹>50, 精神>50, 温度适中)
        # 再生 5s +1HP,所以需要 60s + 5s 至少 = 65s
        # 跑 200s 让精神完全恢复,HP 再生多次
        run_seconds(sys, 200.0)
        # 精神应明显恢复
        assert s.sanity > 50.0
        # HP 也应再生(200s - 60s = 140s,140/5 = 28 次再生)
        # 但 hunger 也在掉(0.0556/s × 200 = 11.1)→ 仍 > 50
        # sanity 完全恢复后,饱腹仍 > 50
        # HP 再生条件持续满足 → HP 应该 = 20 + min(28, 80) = 48
        assert s.hp > 30.0  # 至少再生 10 HP


class TestScenarioHostileEnvironment:
    """场景 H:恶劣环境(高湿+寒冷+怪物近+饥饿),玩家 30 分钟内死亡。"""

    def test_30min_death_in_hostile_env(self):
        s = SurvivalStats(hp=100.0, hunger=100.0, sanity=100.0, temperature=20.0)
        c = SurvivalContext(
            ambient_temperature=-10.0,
            is_near_fire=False,
            is_in_shelter=False,
            is_wet=True,
            monster_proximity=0.8,
            time_of_day=0.0,  # 夜晚
        )
        sys = SurvivalSystem(s, c)
        # 跑 30 分钟 = 1800s
        run_seconds(sys, 1800.0)
        # 30 分钟内死亡(湿润 +1/s 温度下降,温度归零后更冷)
        # 精神 100/0.55 ≈ 182s 归零,扣血 0.55/s 起作用
        # 温度下降 < 5°C 警示,< 0°C 减速 50%
        # 1800s 内必然死亡
        assert sys.is_dead is True
        assert s.hp <= 0.0


class TestScenarioInitialStateSurvives:
    """场景 I:默认状态(满血满饱+中性温度+无外部威胁)无衰减。"""

    def test_perfect_state_no_change(self):
        s = SurvivalStats()
        c = SurvivalContext()  # 完美环境
        sys = SurvivalSystem(s, c)
        run_seconds(sys, 60.0)
        # 饥饿/精神会自然衰减(基础公式)
        # 但 HP 不衰减
        assert s.hp == 100.0
        # 温度仍中性
        assert abs(s.temperature - 20.0) < 0.1
