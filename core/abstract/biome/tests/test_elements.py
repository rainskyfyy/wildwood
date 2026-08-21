"""M2.7 共享元素库测试 — 任务书硬约束:4 群系共用(草地/岩石/树/蘑菇)

只定义视觉骨架(skeleton),不内置任何具体像素。
具体像素由 M2.14 资产清单统一出(2026-08-20 拍板:复用,不重复生产)。
"""
import pytest
from core.abstract.biome.elements import (
    SHARED_ELEMENTS, ElementSpec, get_element, list_elements,
    validate_shared_elements,
)


def test_shared_elements_count_four():
    """4 大群系共享 4 类基础元素:草地/岩石/树/蘑菇"""
    assert len(SHARED_ELEMENTS) == 4
    assert set(SHARED_ELEMENTS) == {"grass", "rock", "tree", "mushroom"}


def test_each_element_has_skeleton():
    """每个元素都有视觉骨架(grid_size + skeleton_shape)"""
    for eid in SHARED_ELEMENTS:
        elem = get_element(eid)
        assert elem.id == eid
        assert elem.grid_size in (16, 32, 64), f"{eid}: bad grid_size {elem.grid_size}"
        assert isinstance(elem.skeleton_shape, str) and elem.skeleton_shape, \
            f"{eid}: empty skeleton"
        # M2.14 资产 ID 引用(留空=待 M2.14 出图)
        assert elem.source_ref.startswith("m2.14."), \
            f"{eid}: source_ref must be m2.14.*, got {elem.source_ref!r}"


def test_list_elements_returns_all_four():
    """list_elements 返回全部 4 个元素"""
    elems = list_elements()
    assert len(elems) == 4
    ids = {e.id for e in elems}
    assert ids == set(SHARED_ELEMENTS)


def test_validate_shared_elements_passes():
    """库完整性校验通过(色板存在/网格对齐 32px 倍数/M2.14 引用存在)"""
    violations = validate_shared_elements()
    assert violations == [], f"violations: {violations}"


def test_get_element_unknown_raises():
    """查不存在的元素抛 KeyError"""
    with pytest.raises(KeyError):
        get_element("nonexistent_xyz")


def test_grass_uses_32px_grid():
    """草地 32×32 网格(场景基础)"""
    grass = get_element("grass")
    assert grass.grid_size == 32


def test_tree_uses_32px_grid():
    """树 32×32 网格(资源基础)"""
    tree = get_element("tree")
    assert tree.grid_size == 32


def test_rock_uses_32px_grid():
    """岩石 32×32 网格"""
    rock = get_element("rock")
    assert rock.grid_size == 32


def test_mushroom_uses_16px_grid():
    """蘑菇 16×16 细节网格(美术风格指南 §网格规范 资源条目)"""
    mushroom = get_element("mushroom")
    assert mushroom.grid_size == 16


def test_no_pixel_data_in_skeleton():
    """骨架不内置任何像素/帧 — M2.7 数据层不重复生产 M2.14 资产"""
    for eid in SHARED_ELEMENTS:
        elem = get_element(eid)
        # skeleton_shape 必须是 ASCII 描述(像素排布说明),不能是 bytes
        assert isinstance(elem.skeleton_shape, str)
        # ElementSpec 不应有 pixels/frames/sprite_path 字段
        assert not hasattr(elem, "pixels")
        assert not hasattr(elem, "frames")
        assert not hasattr(elem, "sprite_path")
