"""M2.7 4 大群系定义 — 任务书 + 项目总方案 §2.6

群系表:

| 群系 | 主色 | 特征资源 / 怪物 |
|------|------|------------------|
| 森林 | 暖黄绿 #7d8b4d | 浆果 / 树苗 / 兔子 / 蜘蛛 |
| 平原 | 草绿   #5a6b3a | 草 / 芦苇 / 牛 / 食人花 |
| 矿区 | 灰蓝   #5a7080 | 矿石 / 燧石 / 猎犬 / 巨鹿 |
| 雪原 | 蓝白   #8fb4c0 | 矿石 / 冰 / 企鹅 / 触须 |

设计要点:
- 共享元素库 4 类(grass/rock/tree/mushroom) — 任务书硬约束
- 仅替换主色 + 组合比例 — 任务书硬约束
- 特征资源/怪物由 M2.14 资产清单统一出(2026-08-20 拍板)
- M2.7 数据层不内置任何像素/帧
- 沙漠/沼泽留 M3(任务拆分表 §3 标注)
- "矿区"替代"沙漠"(任务书) — 矿石更贴合矿区主题
"""
from dataclasses import dataclass, field, asdict
from typing import List, Dict
from core.abstract.biome.elements import SHARED_ELEMENTS


@dataclass(frozen=True)
class Biome:
    """群系定义(不含像素)"""
    id: str                       # 群系 ID (forest/plains/mines/snow)
    display_name: str             # 人类可读名
    primary_color_hex: str        # 主色(必须在 24 色板内)
    shared_elements: tuple        # 共享元素 ID 列表(总是 4 类)
    density: dict                 # 元素组合比例(grass/rock/tree/mushroom → float)
    signature_resources: tuple    # 特征资源 M2.14 ID
    signature_monsters: tuple     # 特征怪物 M2.14 ID
    description: str = ""         # 群系描述(给玩家/UI 用)


# 4 大群系(密度比之和 = 1.0,允许 ±0.05 误差)
Forest = Biome(
    id="forest",
    display_name="森林",
    primary_color_hex="#7d8b4d",  # leaf_green 暖黄绿
    shared_elements=tuple(SHARED_ELEMENTS),
    density={
        "grass":    0.60,  # 草地密 — 林下空地
        "tree":     0.30,  # 树高密度
        "rock":     0.05,  # 散落岩石
        "mushroom": 0.05,  # 蘑菇点缀
    },
    signature_resources=(
        "m2.14.resource.berry_bush",   # 浆果灌木
        "m2.14.resource.sapling",      # 树苗
    ),
    signature_monsters=(
        "m2.14.monster.rabbit",        # 兔子(passive)
        "m2.14.monster.spider",        # 蜘蛛(hostile)
    ),
    description="林下空地与针叶林。浆果采集首选,黄昏后蜘蛛出没。",
)

Plains = Biome(
    id="plains",
    display_name="平原",
    primary_color_hex="#5a6b3a",  # forest_moss 草绿
    shared_elements=tuple(SHARED_ELEMENTS),
    density={
        "grass":    0.80,  # 草地极密
        "tree":     0.08,  # 少量孤立树
        "rock":     0.07,  # 散岩
        "mushroom": 0.05,  # 蘑菇
    },
    signature_resources=(
        "m2.14.resource.grass_tuft",   # 草(可收)
        "m2.14.resource.reed",         # 芦苇
    ),
    signature_monsters=(
        "m2.14.monster.cow",           # 牛(被动)
        "m2.14.monster.plant_tentacle",# 食人花(主动)
    ),
    description="开阔草地与零星树。牛群聚集,食人花伪装于草丛。",
)

Mines = Biome(
    id="mines",
    display_name="矿区",
    primary_color_hex="#5a7080",  # steel_blue 灰蓝
    shared_elements=tuple(SHARED_ELEMENTS),
    density={
        "grass":    0.30,  # 草地少(地表荒凉)
        "rock":     0.45,  # 岩石高密度(主特征)
        "tree":     0.10,  # 稀疏枯树
        "mushroom": 0.15,  # 矿区毒蘑菇
    },
    signature_resources=(
        "m2.14.resource.ore_iron",     # 铁矿石
        "m2.14.resource.flint",        # 燧石
    ),
    signature_monsters=(
        "m2.14.monster.hound",         # 猎犬(群体来袭)
        "m2.14.monster.deerclops",     # 巨鹿(Boss)
    ),
    description="裸露岩层与矿井。燧石与铁矿裸露地表,猎犬群常出没。",
)

Snow = Biome(
    id="snow",
    display_name="雪原",
    primary_color_hex="#8fb4c0",  # ice_cyan 冰青(蓝白基底)
    shared_elements=tuple(SHARED_ELEMENTS),
    density={
        "grass":    0.20,  # 雪下草
        "rock":     0.30,  # 冰岩
        "tree":     0.20,  # 针叶树
        "mushroom": 0.30,  # 冰蘑菇群
    },
    signature_resources=(
        "m2.14.resource.ore_iron",     # 矿石(同矿区)
        "m2.14.resource.ice",          # 冰(可融)
    ),
    signature_monsters=(
        "m2.14.monster.pengull",       # 企鹅(被动)
        "m2.14.monster.plant_tentacle",# 冰下触须(主动)
    ),
    description="永冻苔原与冰柱。夜间温度骤降至 -10°C,触须潜伏于冰下。",
)


BIOMES: Dict[str, Biome] = {
    "forest": Forest,
    "plains": Plains,
    "mines":  Mines,
    "snow":   Snow,
}


def get_biome(bid: str) -> Biome:
    """按 ID 取群系;不存在抛 KeyError"""
    if bid not in BIOMES:
        raise KeyError(f"unknown biome: {bid!r}; valid: {list(BIOMES)}")
    return BIOMES[bid]


def list_biomes() -> List[Biome]:
    """返回全部群系"""
    return list(BIOMES.values())


def primary_color_of(bid: str) -> str:
    """便捷:取群系主色"""
    return get_biome(bid).primary_color_hex


def biome_to_dict(b: Biome) -> dict:
    """Biome → dict(可 JSON 序列化)"""
    return {
        "id": b.id,
        "display_name": b.display_name,
        "primary_color_hex": b.primary_color_hex,
        "shared_elements": list(b.shared_elements),
        "density": dict(b.density),
        "signature_resources": list(b.signature_resources),
        "signature_monsters": list(b.signature_monsters),
        "description": b.description,
    }


def biome_from_dict(d: dict) -> Biome:
    """dict → Biome(从 JSON 反序列化)"""
    return Biome(
        id=d["id"],
        display_name=d["display_name"],
        primary_color_hex=d["primary_color_hex"],
        shared_elements=tuple(d["shared_elements"]),
        density=dict(d["density"]),
        signature_resources=tuple(d["signature_resources"]),
        signature_monsters=tuple(d["signature_monsters"]),
        description=d.get("description", ""),
    )


def validate_biomes() -> list:
    """4 群系完整性校验(色板/共享元素/M2.14 引用/密度)"""
    from core.abstract.biome.palette import PALETTE
    violations = []
    for bid, b in BIOMES.items():
        if b.primary_color_hex not in PALETTE.values():
            violations.append(f"{bid}: primary {b.primary_color_hex} not in 24-color palette")
        if set(b.shared_elements) != set(SHARED_ELEMENTS):
            violations.append(f"{bid}: shared_elements != SHARED_ELEMENTS")
        for k in b.density:
            if k not in SHARED_ELEMENTS:
                violations.append(f"{bid}: density key {k!r} not in shared elements")
        total = sum(b.density.values())
        if abs(total - 1.0) >= 0.05:
            violations.append(f"{bid}: density sum {total:.3f} not ~1.0")
        for ref in list(b.signature_resources) + list(b.signature_monsters):
            if not ref.startswith("m2.14."):
                violations.append(f"{bid}: ref {ref!r} must start with m2.14.")
    return violations
