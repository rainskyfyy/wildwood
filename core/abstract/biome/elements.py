"""M2.7 共享元素库 — 任务书硬约束:4 群系共用(草地/岩石/树/蘑菇)

设计原则:
- 只定义视觉骨架(skeleton_shape 是 ASCII 描述,不内置像素)
- 具体像素由 M2.14 资产清单统一出(2026-08-20 拍板)
- source_ref 指向 M2.14 资源 ID,便于 M2.14 落地后直接对接
- 网格大小遵循美术风格指南 §网格规范:
  - 资源(灌木/矿石/蘑菇) 32×32 px(蘑菇 16×16 因尺寸小)
  - 树/大型资源 32×32 px
"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class ElementSpec:
    """元素视觉骨架(不含像素)"""
    id: str                 # 元素 ID (grass/rock/tree/mushroom)
    display_name: str       # 人类可读名
    grid_size: int          # 网格大小(px, 16/32/64)
    skeleton_shape: str     # ASCII 像素排布描述(纯文字,不内置像素)
    source_ref: str         # M2.14 资产清单 ID(留待 M2.14 出图对接)


# 4 大共享元素 — 4 群系共用
SHARED_ELEMENTS: List[str] = ["grass", "rock", "tree", "mushroom"]


# 元素骨架定义
_ELEMENTS: dict = {
    "grass": ElementSpec(
        id="grass",
        display_name="草地",
        grid_size=32,
        # 32×32 草地贴片:左下角深绿根部 + 右下角浅绿叶尖 + 2 颗种子点
        skeleton_shape=(
            "..##..##..##..##..##..##..##..##\n"
            ".####.####.####.####.####.####.##\n"
            "##..####..####..####..####..####.\n"
            ".##.##..##.##.##..##.##.##..##..\n"
        ),
        source_ref="m2.14.element.grass",
    ),
    "rock": ElementSpec(
        id="rock",
        display_name="岩石",
        grid_size=32,
        # 32×32 岩石:梯形剪影(底宽顶窄),内部高光分割两块
        skeleton_shape=(
            "....####....\n"
            "...######...\n"
            "..########..\n"
            "..##.####.##\n"
            ".##########.\n"
        ),
        source_ref="m2.14.element.rock",
    ),
    "tree": ElementSpec(
        id="tree",
        display_name="树",
        grid_size=32,
        # 32×32 树:深棕树干 8px 居中 + 浅绿树冠 24px 顶部 + 阴影
        skeleton_shape=(
            "....######....\n"
            "...########...\n"
            "..##########..\n"
            "..##########..\n"
            "...########...\n"
            "....####......\n"
            "....####......\n"
            "....####......\n"
        ),
        source_ref="m2.14.element.tree",
    ),
    "mushroom": ElementSpec(
        id="mushroom",
        display_name="蘑菇",
        grid_size=16,
        # 16×16 蘑菇:伞盖 12px + 茎 4px(4 行总高)
        skeleton_shape=(
            "....####......\n"
            "..##########..\n"
            "..##########..\n"
            "....####......\n"
            "....####......\n"
            "....####......\n"
            "....####......\n"
            "....####......\n"
        ),
        source_ref="m2.14.element.mushroom",
    ),
}


def get_element(eid: str) -> ElementSpec:
    """按 ID 取元素骨架;不存在抛 KeyError"""
    if eid not in _ELEMENTS:
        raise KeyError(f"unknown element: {eid!r}; valid: {list(_ELEMENTS)}")
    return _ELEMENTS[eid]


def list_elements() -> List[ElementSpec]:
    """返回全部 4 个元素骨架"""
    return list(_ELEMENTS.values())


def validate_shared_elements() -> list:
    """库完整性校验:返回违例列表(空 = 全部合规)"""
    violations = []
    if set(SHARED_ELEMENTS) != set(_ELEMENTS.keys()):
        violations.append(
            f"SHARED_ELEMENTS ({SHARED_ELEMENTS}) != registered ({list(_ELEMENTS)})"
        )
    for eid, elem in _ELEMENTS.items():
        if elem.grid_size not in (16, 32, 64):
            violations.append(f"{eid}: bad grid_size {elem.grid_size}")
        if not elem.skeleton_shape:
            violations.append(f"{eid}: empty skeleton")
        if not elem.source_ref.startswith("m2.14."):
            violations.append(f"{eid}: source_ref must start with m2.14.")
    return violations
