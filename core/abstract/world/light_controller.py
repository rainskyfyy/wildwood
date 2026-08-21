"""
Wildwood M2.8 — LightController(0.5s LOD 平滑过渡)

M2.8 验收 ①④:
  - 4 季节切换 0.5s LOD 过渡
  - 昼夜光照过场平滑

设计:
  - 维护 from/to RGB + from/to intensity
  - start_transition(to_rgb, to_intensity) 触发过渡
  - update(dt) 推进插值, 完成后停在终态
  - 默认 0.5s 线性插值(肉眼难分 ease, 简单稳)
  - 颜色用整数 RGB 0..255; 内部用浮点插值, 输出再取整

可同时处理:
  - 季节切换(全局光照色调)
  - 昼夜切换(光强 + 时段色调)
  - 任意自定义过渡(将来怪物 / 天气 等)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

from core.abstract.world.constants import (
    DEFAULT_DAYNIGHT_TRANSITION_SECONDS,
    DEFAULT_SEASON_TRANSITION_SECONDS,
)


RGB = Tuple[int, int, int]
RGBF = Tuple[float, float, float]


def _rgb_to_rgb_f(rgb: RGB) -> RGBF:
    return (float(rgb[0]), float(rgb[1]), float(rgb[2]))


def _lerp_rgb_f(a: RGBF, b: RGBF, t: float) -> RGBF:
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


@dataclass
class _Transition:
    from_rgb: RGBF
    to_rgb: RGBF
    from_intensity: float
    to_intensity: float
    duration: float
    elapsed: float = 0.0
    in_progress: bool = True

    def progress(self) -> float:
        if self.duration <= 0:
            return 1.0
        return _clamp01(self.elapsed / self.duration)

    def is_done(self) -> bool:
        return self.elapsed >= self.duration


class LightController:
    """0.5s LOD 平滑过渡控制器.

    使用:
      c = LightController(initial_rgb=(255,250,245), initial_intensity=1.0)
      c.start_transition((180,215,245), 0.7)  # 切到 winter
      while not done:
          c.update(dt)
          apply(c.current_rgb, c.current_intensity)
    """

    __slots__ = (
        "_current_rgb",
        "_current_intensity",
        "_transition",
    )

    def __init__(
        self,
        initial_rgb: RGB = (255, 250, 245),
        initial_intensity: float = 1.0,
    ) -> None:
        for c in initial_rgb:
            if not 0 <= c <= 255:
                raise ValueError(f"initial_rgb channel {c} out of 0..255")
        if not 0.0 <= initial_intensity <= 1.0:
            raise ValueError(
                f"initial_intensity must be in [0,1], got {initial_intensity}"
            )
        self._current_rgb: RGBF = _rgb_to_rgb_f(initial_rgb)
        self._current_intensity: float = initial_intensity
        self._transition: _Transition | None = None

    # ---- 公开 API --------------------------------------------------------

    @property
    def current_rgb(self) -> RGB:
        """当前 RGB, 0..255 int tuple. 已四舍五入."""
        r, g, b = self._current_rgb
        return (int(round(r)), int(round(g)), int(round(b)))

    @property
    def current_intensity(self) -> float:
        """当前光强 0..1."""
        return self._current_intensity

    @property
    def is_in_transition(self) -> bool:
        return self._transition is not None and self._transition.in_progress

    def start_transition(
        self,
        target_rgb: RGB,
        target_intensity: float,
        duration: float = DEFAULT_SEASON_TRANSITION_SECONDS,
    ) -> None:
        """开始一次过渡: 终点 RGB + 终点光强, 时长秒.

        立即截取 from = current, 写入 to. 若已有过渡, 从当前位置继续(不重置).
        """
        for c in target_rgb:
            if not 0 <= c <= 255:
                raise ValueError(
                    f"target_rgb channel {c} out of 0..255"
                )
        if not 0.0 <= target_intensity <= 1.0:
            raise ValueError(
                f"target_intensity must be in [0,1], got {target_intensity}"
            )
        if duration <= 0:
            # 立即到位(零时长)
            self._current_rgb = _rgb_to_rgb_f(target_rgb)
            self._current_intensity = target_intensity
            self._transition = None
            return
        self._transition = _Transition(
            from_rgb=self._current_rgb,
            to_rgb=_rgb_to_rgb_f(target_rgb),
            from_intensity=self._current_intensity,
            to_intensity=target_intensity,
            duration=float(duration),
        )

    def update(self, real_dt: float) -> None:
        """推进过渡. 完成后停在终态, transition=None."""
        if real_dt < 0:
            raise ValueError(f"real_dt must be >= 0, got {real_dt}")
        t = self._transition
        if t is None:
            return
        t.elapsed += real_dt
        if t.is_done():
            self._current_rgb = t.to_rgb
            self._current_intensity = t.to_intensity
            self._transition = None
            return
        p = t.progress()
        self._current_rgb = _lerp_rgb_f(t.from_rgb, t.to_rgb, p)
        self._current_intensity = _lerp(
            t.from_intensity, t.to_intensity, p
        )

    def force_finish(self) -> None:
        """强制结束过渡(调试/快进用)."""
        t = self._transition
        if t is None:
            return
        self._current_rgb = t.to_rgb
        self._current_intensity = t.to_intensity
        self._transition = None

    def __repr__(self) -> str:
        rgb = self.current_rgb
        return (
            f"LightController(rgb={rgb}, intensity={self._current_intensity:.3f}, "
            f"in_transition={self.is_in_transition})"
        )


# 暴露 0.5s 默认值的命名常量(便于 LightController 用户复用)
LIGHT_TRANSITION_SEASON = DEFAULT_SEASON_TRANSITION_SECONDS
LIGHT_TRANSITION_DAYNIGHT = DEFAULT_DAYNIGHT_TRANSITION_SECONDS
