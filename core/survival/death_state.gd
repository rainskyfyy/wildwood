extends Node
## 死亡状态机 (M2.5 验收 ①②③④ 核心)
##
## 状态机:
##   ALIVE → (HP=0) → GHOST(10s) → 队友接触 → ALIVE (满血)
##                                → 超时    → DEAD + remains
##
## 用法:
##   var state = WildwoodDeathState.new(player_id, Vector2(x, y))
##   add_child(state)
##   state.bind_hp_bridge(hp_bridge)  # 监听 HP=0
##   state._process(delta) 在主循环驱动
##
## 重要:本类只跟踪一个玩家;4 人小队需要 4 个实例
class_name WildwoodDeathState

const C := preload("res://core/survival/death_constants.gd")
const SIG := preload("res://core/survival/survival_signals.gd")
const HB := preload("res://core/survival/hp_provider.gd")

# ---------------- 玩家身份 ----------------

var player_id: String = ""
var spawn_position: Vector2 = Vector2.ZERO
var current_position: Vector2 = Vector2.ZERO

# ---------------- 状态机内部 ----------------

var _state: int = C.STATE_ALIVE
var _state_entered_at_ms: int = 0
var _hp_bridge: WildwoodHpBridge = null
var _ghost_window: WildwoodGhostWindow = null

# ---------------- 复活记录(用于测试 + UI) ----------------

var revive_count: int = 0           # 一局内被队友救起的次数
var last_reviver_id: String = ""    # 上一个救起你的人
var died_at_ms: int = 0             # 最近一次 HP=0 的时刻(用于复盘)
var died_position: Vector2 = Vector2.ZERO
var remains_id: int = -1            # 濒死后生成的遗物 id(若无则 -1)
var invuln_until_ms: int = 0        # 复活无敌帧结束时刻

# ---------------- 初始化 ----------------

func _init(p_player_id: String, p_spawn_position: Vector2) -> void:
	player_id = p_player_id
	spawn_position = p_spawn_position
	current_position = p_spawn_position

func _ready() -> void:
	_ghost_window = WildwoodGhostWindow.new()
	add_child(_ghost_window)
	_ghost_window.tick.connect(_on_ghost_tick)
	_ghost_window.expired.connect(_on_ghost_expired)

# ---------------- 外部 API ----------------

func bind_hp_bridge(bridge: WildwoodHpBridge) -> void:
	_hp_bridge = bridge
	if _hp_bridge and _hp_bridge.get_provider() != null:
		# 接 on_hp_depleted 回调
		_hp_bridge.get_provider().on_hp_depleted = Callable(self, "_on_hp_depleted")

func unbind_hp_bridge() -> void:
	_hp_bridge = null

func get_state() -> int:
	return _state

func is_alive() -> bool:
	return _state == C.STATE_ALIVE

func is_ghost() -> bool:
	return _state == C.STATE_GHOST

func is_dead() -> bool:
	return _state == C.STATE_DEAD

func get_ghost_remaining_ms() -> int:
	if _state != C.STATE_GHOST:
		return 0
	return _ghost_window.remaining_ms()

# ---------------- 主动触发(供测试 / 调试) ----------------

## 模拟 HP 减到 0 — 测试用
func force_hp_zero() -> void:
	_on_hp_depleted(player_id)

## 由外部伤害系统调用(真实游戏路径)
func take_damage(amount: int) -> void:
	if _hp_bridge == null:
		push_warning("[DeathState] no HP bridge bound, take_damage ignored")
		return
	if _state != C.STATE_ALIVE:
		return  # GHOST / DEAD 不能再受伤
	if invuln_until_ms > 0:
		return  # 复活无敌帧
	_hp_bridge.damage(player_id, amount)

# ---------------- 队友接触复活(外部 API) ----------------

## reviver_id 在 REVIVE_TOUCH_PX 范围内
## 成功复活:GHOST → ALIVE,血量满,广播 player_revived
## 失败:不在 GHOST 态 / 距离过远 / revive_id == player_id
func try_revive(reviver_id: String, reviver_position: Vector2) -> bool:
	if _state != C.STATE_GHOST:
		return false
	if reviver_id == player_id:
		return false  # 不能自己救自己
	var d: float = reviver_position.distance_to(died_position)
	if d > C.REVIVE_TOUCH_PX:
		return false
	# 成功
	_enter_alive(reviver_id)
	return true

# ---------------- 主循环 tick ----------------

func _process(delta: float) -> void:
	if _hp_bridge == null:
		return
	# mock provider 衰减(真实 M2.4 不需要此路径)
	if _state == C.STATE_ALIVE:
		_hp_bridge.tick_ms(player_id, delta * 1000.0)

# ---------------- HP 桥接回调 ----------------

func _on_hp_depleted(_pid: String) -> void:
	if _state != C.STATE_ALIVE:
		return  # 已经在 GHOST / DEAD,不重复触发
	_enter_ghost()

# ---------------- 状态转移 ----------------

func _enter_ghost() -> void:
	_state = C.STATE_GHOST
	died_at_ms = Time.get_ticks_msec()
	died_position = current_position
	_ghost_window.start(C.GHOST_WINDOW_MS)
	SIG.player_entered_ghost.emit({
		"player_id": player_id,
		"ghost_until_ms": died_at_ms + C.GHOST_WINDOW_MS,
		"position": died_position,
	})
	SIG.slot_visual_state_changed.emit({
		"player_id": player_id,
		"slot_state": C.STATE_GHOST,
		"alpha_pct": 50,
	})

func _enter_alive(reviver_id: String) -> void:
	_state = C.STATE_ALIVE
	_state_entered_at_ms = Time.get_ticks_msec()
	revive_count += 1
	last_reviver_id = reviver_id
	remains_id = -1
	# 满血 + 无敌帧
	if _hp_bridge != null:
		_hp_bridge.set_current(player_id, _hp_bridge.get_max(player_id))
	invuln_until_ms = _state_entered_at_ms + C.REVIVE_INVULN_MS
	# 当前玩家站到队友身边(队友接触复活,位置取中点)
	current_position = died_position
	_ghost_window.stop()
	SIG.player_revived.emit({
		"player_id": player_id,
		"reviver_id": reviver_id,
		"position": current_position,
		"hp_pct": C.REVIVE_HP_PCT,
	})
	SIG.slot_visual_state_changed.emit({
		"player_id": player_id,
		"slot_state": C.STATE_ALIVE,
		"alpha_pct": 100,
	})

func _enter_dead(remains_id_: int) -> void:
	_state = C.STATE_DEAD
	remains_id = remains_id_
	_ghost_window.stop()
	SIG.player_died.emit({
		"player_id": player_id,
		"position": died_position,
		"remains_id": remains_id_,
	})
	SIG.slot_visual_state_changed.emit({
		"player_id": player_id,
		"slot_state": C.STATE_DEAD,
		"alpha_pct": 50,
	})

# ---------------- 鬼魂窗口回调 ----------------

func _on_ghost_tick(_remaining_ms: int) -> void:
	# 这里可以广播 ghost_remaining_ms 给 UI(HUD 倒计时)
	# 实际协议层:WorldDelta 的 player_status 字段会刷新
	pass

func _on_ghost_expired() -> void:
	if _state != C.STATE_GHOST:
		return
	# 超时 → 濒死 + 遗物
	# remains_id 由 RemainsManager 分配;此处先 _enter_dead 用 -1 占位
	# 真实链路:RemainsManager.spawn_for_player() → 调 _enter_dead(remains_id)
	_enter_dead(-1)
	# 然后由外部 RemainsManager 接 player_died 信号 → 分配 id → SIG.remains_spawned
