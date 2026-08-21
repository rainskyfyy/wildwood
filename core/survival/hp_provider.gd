extends Node
## HP 桥接接口 (M2.5 与 M2.4 衔接点)
##
## 设计目的:
##   1. M2.5(死亡与复活)需要监听 "HP=0" 事件来切到 GHOST 态
##   2. M2.4(HP/饱腹/精神/温度) 还没做 — 不能在 M2.5 里写死 HP 系统
##   3. 这个接口是抽象:真实实现由 M2.4 注入;当前用 mock 自测
##
## 用法:
##   - 默认: HpBridge 自动挂 mock provider,验收 4 项独立可测
##   - M2.4 完成:在主场景 _ready() 里调 HpBridge.set_provider(real_provider)
class_name WildwoodHpBridge

# ---------------- 单例 ----------------

static var _instance: WildwoodHpBridge = null

static func instance() -> WildwoodHpBridge:
	if _instance == null:
		_instance = WildwoodHpBridge.new()
		_instance.name = "WildwoodHpBridge"
	return _instance

# ---------------- 抽象 provider 类 ----------------

## HP provider 契约:
##   - get_current(player_id) -> int
##   - get_max(player_id) -> int
##   - set_current(player_id, value) -> void  (复活时设回满血)
##   - damage(player_id, amount) -> void      (外部伤害入口,M2.4 接入)
##   - emit_died(player_id)                  (HP=0 时主动触发,内部机制)
class HpProvider:
	extends RefCounted
	func get_current(_player_id: String) -> int:
		return 0
	func get_max(_player_id: String) -> int:
		return 100
	func set_current(_player_id: String, _value: int) -> void:
		pass
	func damage(_player_id: String, _amount: int) -> void:
		pass
	## HP provider 主动检测到 HP ≤ 0 时调用,告诉 death_state
	## 真实 M2.4 实现:每次 damage 后检查, ≤ 0 时回调
	## mock 实现:HP 减到 0 时回调
	## 用 Callable 绑定而不是 signal:为了和 GDScript signal 风格对齐
	## 实际上下挂 signal 更优雅,但 mock 简单起见用 Callable
	var on_hp_depleted: Callable = Callable()

# ---------------- Mock provider(自测用) ----------------

class MockHpProvider:
	extends HpProvider
	## mock 状态下:1 ms = 1 HP(由 MOCK_HP_DROP_RATE 决定)
	## 给 player_id 注入初始 HP,然后可以快速触发死亡
	var _hp: Dictionary = {}            # player_id -> int
	var _max_hp: Dictionary = {}        # player_id -> int
	var _elapsed_ms: Dictionary = {}    # player_id -> 上次 update 累计 ms
	var _drop_rate: float = 1.0         # ms -> HP

	func _init(drop_rate_per_ms: float = 1.0) -> void:
		_drop_rate = drop_rate_per_ms

	func register(player_id: String, hp: int = 100) -> void:
		_hp[player_id] = hp
		_max_hp[player_id] = hp
		_elapsed_ms[player_id] = 0.0

	func get_current(player_id: String) -> int:
		if not _hp.has(player_id):
			return 0
		return int(_hp[player_id])

	func get_max(player_id: String) -> int:
		if not _max_hp.has(player_id):
			return 100
		return _max_hp[player_id]

	func set_current(player_id: String, value: int) -> void:
		_hp[player_id] = value

	func damage(player_id: String, amount: int) -> void:
		if not _hp.has(player_id):
			return
		_hp[player_id] = max(0, int(_hp[player_id]) - amount)
		_check_zero(player_id)

	## mock 自动衰减 — 由 DeathState 在 _process 里调用
	func tick_ms(player_id: String, delta_ms: float) -> void:
		if not _hp.has(player_id):
			return
		_elapsed_ms[player_id] += delta_ms
		var drop: int = int(_elapsed_ms[player_id] * _drop_rate)
		if drop > 0:
			_elapsed_ms[player_id] -= float(drop) / _drop_rate
			_hp[player_id] = max(0, int(_hp[player_id]) - drop)
			_check_zero(player_id)

	func _check_zero(player_id: String) -> void:
		if _hp[player_id] <= 0 and on_hp_depleted.is_valid():
			on_hp_depleted.call(player_id)

# ---------------- 当前 provider ----------------

var _provider: HpProvider = null

func _init() -> void:
	# 默认挂 mock provider,验收可独立跑
	var mock: MockHpProvider = MockHpProvider.new(
		WildwoodDeathConstants.HP_DROP_RATE_MOCK_PER_MS)
	_provider = mock

func set_provider(provider: HpProvider) -> void:
	_provider = provider

func get_provider() -> HpProvider:
	return _provider

# ---------------- 透传方法 ----------------

func register(player_id: String, hp: int = 100) -> void:
	# 仅 MockHpProvider 实现了;真实 provider 可能不需要
	if _provider.has_method("register"):
		_provider.call("register", player_id, hp)

func get_current(player_id: String) -> int:
	return _provider.get_current(player_id)

func get_max(player_id: String) -> int:
	return _provider.get_max(player_id)

func set_current(player_id: String, value: int) -> void:
	_provider.set_current(player_id, value)

func damage(player_id: String, amount: int) -> void:
	_provider.damage(player_id, amount)

func tick_ms(player_id: String, delta_ms: float) -> void:
	if _provider.has_method("tick_ms"):
		_provider.call("tick_ms", player_id, delta_ms)
