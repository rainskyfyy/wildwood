"""
Wildwood 生存属性 — SurvivalSystem 30Hz tick 推进

外部条件(ambient_temperature / fire / wet / shelter / time_of_day / monster_proximity / food)驱动
4 维属性按 30Hz tick 推进。
"""

from __future__ import annotations

from typing import Optional

from .stats import SurvivalStats, SurvivalContext


# 30Hz tick 周期
TICK_HZ = 30
TICK_DT = 1.0 / TICK_HZ  # ≈ 0.0333 秒

# === 衰减/恢复速率(单位:点/秒) ===

# 饥饿:满饱 → 0 大约需要 30 分钟(1800s)走完
HUNGER_DRAIN_PER_SEC = 100.0 / 1800.0  # ≈ 0.0556/s

# 温度平衡:牛顿冷却,alpha = 0.05/tick ≈ 1.5/s
# (T_target - T) * alpha 收敛到环境温度
TEMP_BALANCE_ALPHA = 1.5

# 温度火堆加成:每秒 +2°C
TEMP_FIRE_BONUS_PER_SEC = 2.0

# 温度淋雨惩罚:每秒 -1°C
TEMP_WET_PENALTY_PER_SEC = 1.0

# 精神衰减(基础):每秒 -0.1
SANITY_DRAIN_BASE_PER_SEC = 0.1

# 精神衰减(怪物近):每秒 -0.3(全速)
SANITY_DRAIN_MONSTER_PER_SEC = 0.3

# 精神衰减(饥饿 < 30%):每秒 -0.2
SANITY_DRAIN_HUNGRY_PER_SEC = 0.2

# 精神衰减(夜晚):每秒 -0.15
SANITY_DRAIN_NIGHT_PER_SEC = 0.15

# 精神恢复(休息 + 精神 < 50):每秒 +0.5
SANITY_REST_RECOVERY_PER_SEC = 0.5

# HP 再生条件:饱腹 > 50 + 精神 > 50 + 温度适中(0~35°C)
HP_REGEN_INTERVAL_SEC = 5.0  # 每 5 秒回 1
HP_REGEN_AMOUNT = 1.0

# HP 衰减(饥饿归零):每秒 -2
HP_DRAIN_STARVING_PER_SEC = 2.0

# HP 衰减(温度极端):温度 < -5 或 > 40,每秒 -3
HP_DRAIN_TEMP_EXTREME_PER_SEC = 3.0
TEMP_HP_DRAIN_LOW = -5.0
TEMP_HP_DRAIN_HIGH = 40.0

# HP 衰减(精神归零):每秒 -1
HP_DRAIN_INSANE_PER_SEC = 1.0


def is_night(time_of_day: float) -> bool:
    """夜晚时段:time_of_day < 0.25 || time_of_day > 0.75(0=午夜,0.5=正午)。"""
    return time_of_day < 0.25 or time_of_day > 0.75


def _temperature_target(
    ambient: float,
    is_near_fire: bool,
    is_wet: bool,
    is_in_shelter: bool,
) -> float:
    """
    温度目标值(平衡点)。
    庇护所内温度更稳定,火堆加成,淋雨惩罚。
    """
    target = ambient
    if is_near_fire:
        # 火堆附近:目标温度 = max(ambient, 20)
        target = max(target, 20.0)
    if is_in_shelter:
        # 庇护所:目标温度向中性 15°C 拉一点
        target = target * 0.5 + 15.0 * 0.5
    return target


class SurvivalSystem:
    """
    生存属性运行时系统 — 30Hz tick 推进。

    用法:
        sys = SurvivalSystem(stats, context)
        # 每 1/30 秒调一次
        for _ in range(30):  # 模拟 1 秒
            sys.tick()
    """

    def __init__(
        self,
        stats: SurvivalStats,
        context: Optional[SurvivalContext] = None,
    ) -> None:
        self.stats = stats
        self.context = context or SurvivalContext()
        # 内部计时(防止外部 dt 漂移)
        self._time_accum = 0.0
        # 死亡标志(HP <= 0 时为 True,tick 停止推进)
        self.is_dead = False
        # HP 再生计时器
        self._hp_regen_timer = 0.0

    def tick(self, dt: float = TICK_DT) -> None:
        """
        推进一个 tick(默认 1/30 秒 = 33.3ms)。

        死亡后不再推进。等 M2.5 复活机制接入。
        """
        if self.is_dead or not self.context.is_alive:
            return

        self._advance_hunger(dt)
        self._advance_sanity(dt)
        self._advance_temperature(dt)
        self._advance_hp(dt)

        # 写后 clamp,确保不越界
        self.stats.clamp()

        # 死亡判定
        if self.stats.hp <= 0.0:
            self.is_dead = True
            self.context.is_alive = False

    # === 内部:4 维推进 ===

    def _advance_hunger(self, dt: float) -> None:
        """饱腹:基础衰减 + 温度极端加速衰减 + 进食恢复。"""
        drain = HUNGER_DRAIN_PER_SEC * dt
        # 寒冷(< 5°C)或炎热(> 30°C)时饥饿加速(身体调节消耗)
        if self.stats.temperature < 5.0 or self.stats.temperature > 30.0:
            drain *= 1.5
        self.stats.hunger = max(0.0, self.stats.hunger - drain)

    def _advance_sanity(self, dt: float) -> None:
        """
        精神:基础衰减 + 怪物近 + 饥饿 < 30% + 夜晚。

        休息时:
          - 精神 < 50 → 恢复
          - 精神 ≥ 50 → 停止衰减(不扣不增)
        非休息时:正常按多因子叠加衰减。
        """
        # 休息优先级最高
        if self.context.resting:
            if self.stats.sanity < 50.0:
                # 精神 < 50 时恢复
                self.stats.sanity = min(
                    self.stats.sanity_max,
                    self.stats.sanity + SANITY_REST_RECOVERY_PER_SEC * dt,
                )
            # 不论精神是否 < 50,休息时停止衰减,直接 return
            return

        # 非休息:多因子叠加衰减
        drain = SANITY_DRAIN_BASE_PER_SEC * dt
        if self.context.monster_proximity > 0.5:
            drain += SANITY_DRAIN_MONSTER_PER_SEC * dt
        if self.stats.hunger < self.stats.hunger_max * 0.30:
            drain += SANITY_DRAIN_HUNGRY_PER_SEC * dt
        if is_night(self.context.time_of_day):
            drain += SANITY_DRAIN_NIGHT_PER_SEC * dt
        self.stats.sanity = max(0.0, self.stats.sanity - drain)

    def _advance_temperature(self, dt: float) -> None:
        """
        温度:牛顿冷却向环境温度收敛 + 火堆/淋雨/庇护所修正。
        """
        target = _temperature_target(
            self.context.ambient_temperature,
            self.context.is_near_fire,
            self.context.is_wet,
            self.context.is_in_shelter,
        )
        # alpha * dt 控制收敛速度
        alpha = min(1.0, TEMP_BALANCE_ALPHA * dt)
        new_temp = self.stats.temperature + (target - self.stats.temperature) * alpha
        # 额外修正
        if self.context.is_near_fire:
            new_temp += TEMP_FIRE_BONUS_PER_SEC * dt
        if self.context.is_wet:
            new_temp -= TEMP_WET_PENALTY_PER_SEC * dt
        self.stats.temperature = new_temp

    def _advance_hp(self, dt: float) -> None:
        """
        HP:再生(饱腹>50 + 精神>50 + 温度适中)+ 衰减(饥饿归零 / 温度极端 / 精神归零)。
        """
        # 再生
        can_regen = (
            self.stats.hunger > self.stats.hunger_max * 0.50
            and self.stats.sanity > self.stats.sanity_max * 0.50
            and TEMP_HP_DRAIN_LOW <= self.stats.temperature <= TEMP_HP_DRAIN_HIGH
            and self.stats.hp < self.stats.hp_max
        )
        if can_regen:
            self._hp_regen_timer += dt
            if self._hp_regen_timer >= HP_REGEN_INTERVAL_SEC:
                self.stats.hp = min(
                    self.stats.hp_max, self.stats.hp + HP_REGEN_AMOUNT
                )
                self._hp_regen_timer -= HP_REGEN_INTERVAL_SEC
        else:
            self._hp_regen_timer = 0.0

        # 衰减
        drain = 0.0
        if self.stats.hunger <= 0.0:
            drain += HP_DRAIN_STARVING_PER_SEC * dt
        if (
            self.stats.temperature < TEMP_HP_DRAIN_LOW
            or self.stats.temperature > TEMP_HP_DRAIN_HIGH
        ):
            drain += HP_DRAIN_TEMP_EXTREME_PER_SEC * dt
        if self.stats.sanity <= 0.0:
            drain += HP_DRAIN_INSANE_PER_SEC * dt

        if drain > 0:
            self.stats.hp = max(0.0, self.stats.hp - drain)
