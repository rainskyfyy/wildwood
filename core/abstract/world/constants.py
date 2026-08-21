"""
Wildwood M2.8 — 不可变常量

来源:项目总方案 §2.6 (生物群系) + §2.7 (全季节) + M2.8 任务验收标准。
本文件不依赖任何其他模块,可被任意子模块 import。
"""

# --- 时间尺度 -------------------------------------------------------------

# 一游戏日 = 多少现实秒(默认 24 分钟, 与 Don't Starve 同量级, 可调)
DEFAULT_REAL_SECONDS_PER_DAY = 24.0 * 60.0  # 1440s = 24min

# 一游戏季节 = 多少游戏日
DAYS_PER_SEASON = 30

# 一游戏日 = 多少小时
HOURS_PER_DAY = 24
MINUTES_PER_HOUR = 60
SECONDS_PER_MINUTE = 60

# 一游戏小时 = 多少现实秒
REAL_SECONDS_PER_HOUR = DEFAULT_REAL_SECONDS_PER_DAY / HOURS_PER_DAY  # 60s

# 4 季节(M2.8 + 方案 §2.7 顺序,索引 0..3 不可变)
SEASONS_PER_YEAR = 4

# 季节索引表(必须与 Season enum 顺序一致;此处用常量数组,避免循环 import)
SEASON_ORDER = ("spring", "summer", "autumn", "winter")

# --- 光照过渡(M2.8 验收 ①) ----------------------------------------------

# 4 季节切换 LOD 过渡时长(秒)
DEFAULT_SEASON_TRANSITION_SECONDS = 0.5

# 昼夜切换过场时长(秒) — 黄昏/黎明持续 1 个游戏小时 = 60 现实秒;这里用更短以让"过场"明显
DEFAULT_DAYNIGHT_TRANSITION_SECONDS = 0.5

# --- 昼夜时段(24h 内) ----------------------------------------------------

DAY_HOUR_DAWN_START = 5    # 05:00 dawn 开始
DAY_HOUR_DAY_START = 8     # 08:00 进入 day
DAY_HOUR_DUSK_START = 17   # 17:00 dusk 开始
DAY_HOUR_NIGHT_START = 20  # 20:00 进入 night

# 完整 24h 划分为 4 段,每段小时数
DAWN_HOURS = DAY_HOUR_DAY_START - DAY_HOUR_DAWN_START          # 3
DAY_HOURS = DAY_HOUR_DUSK_START - DAY_HOUR_DAY_START           # 9
DUSK_HOURS = DAY_HOUR_NIGHT_START - DAY_HOUR_DUSK_START        # 3
NIGHT_HOURS = HOURS_PER_DAY - (
    DAY_HOUR_DUSK_START - DAY_HOUR_DAWN_START
)                                                              # 9 (20→05)

# --- 光照强度(0=深夜黑,1=正午亮) ----------------------------------------

# 简化版昼夜光照:黎明从 0 → 1 线性,正午保持 1,黄昏从 1 → 0 线性,夜晚保持 0
LIGHT_INTENSITY_DAY_FULL = 1.0
LIGHT_INTENSITY_NIGHT_FULL = 0.0

# --- 温度范围(方案 §2.7, 单位 °C) ----------------------------------------

TEMP_SPRING_MIN, TEMP_SPRING_MAX = 15.0, 25.0
TEMP_SUMMER_MIN, TEMP_SUMMER_MAX = 25.0, 40.0
TEMP_AUTUMN_MIN, TEMP_AUTUMN_MAX = 10.0, 20.0
TEMP_WINTER_MIN, TEMP_WINTER_MAX = -10.0, 5.0

# --- 季节光照色调(方案 §2.7) --------------------------------------------
# 暖粉/明黄/橙金/冷蓝 — 用 RGB 近似(0-255)表示,美术可微调

SEASON_TINT_SPRING = (255, 200, 215)  # 暖粉
SEASON_TINT_SUMMER = (255, 230, 130)  # 明黄
SEASON_TINT_AUTUMN = (240, 175, 80)   # 橙金
SEASON_TINT_WINTER = (180, 215, 245)  # 冷蓝

# --- 时段光照色调(供昼夜过场用) -----------------------------------------
# 黎明偏粉,白天冷白(让季节色叠加),黄昏偏橙,夜晚偏蓝黑

DAWN_TINT = (255, 220, 200)
DAY_TINT = (255, 250, 245)
DUSK_TINT = (255, 165, 90)
NIGHT_TINT = (40, 50, 90)

# --- 季节关键机制标签(方案 §2.7 "关键机制"列) ---------------------------

SEASON_FEATURES = {
    "spring": ("rain", "mushroom_growth"),
    "summer": ("heatstroke", "cactus_fruit"),
    "autumn": ("leaf_fall", "harvest"),
    "winter": ("freeze", "campfire_required", "snow_blind"),
}
