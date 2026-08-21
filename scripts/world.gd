extends Node2D
## 世界渲染:从 WorldSnapshot.Entities spawn 资源,接收 S2C_WorldDelta 更新 HP
##
## 任务 M2.2 验收 ④ 联机下资源 HP 同步
## 任务 M2.1 验收 ③ 玩家位置/朝向同步

const PlayerScript = preload("res://scripts/player.gd")
const ResourceScript = preload("res://scripts/resource.gd")

var _net = null  # WildwoodSession(主场景传入)
var _player: Node = null
var _resources: Dictionary = {}  # entity_id -> ResourceScript
var _gather_progress: ProgressBar = null
var _gather_target_eid: int = 0
var _gather_start_ms: int = 0
const GATHER_DURATION_MS: int = 1500


func _ready() -> void:
	_gather_progress = ProgressBar.new()
	_gather_progress.max_value = GATHER_DURATION_MS
	_gather_progress.value = 0
	_gather_progress.size = Vector2(80, 12)
	_gather_progress.visible = false
	_gather_progress.modulate = Color(0, 1, 0)
	_gather_progress.position = Vector2(-40, -50)  # 在 player 上方
	add_child(_gather_progress)


func setup(net, player: Node) -> void:
	_net = net
	_player = player
	if _player != null and _player.has_method("setup"):
		_player.setup(_net)
	# 绑定进度条到 player 头顶
	if _player != null and _gather_progress != null:
		_gather_progress.reparent(_player)
		_gather_progress.position = Vector2(-40, -50)
		_player.set("_gather_bar", _gather_progress)


# 收到 S2C_RoomJoined → 用 WorldSnapshot.Entities spawn 资源
func on_room_joined(snapshot) -> void:
	clear_resources()
	if snapshot == null:
		return
	for e in snapshot.get("Entities", []):
		_spawn_resource(e)


func _spawn_resource(e: Dictionary) -> void:
	var eid: int = e.get("EntityId", 0)
	if eid == 0:
		return
	if _resources.has(eid):
		return
	var r: Node = ResourceScript.new()
	r.name = "Resource_%d" % eid
	add_child(r)
	var pos: Vector2 = Vector2(e.get("Position", {}).get("X", 0.0), e.get("Position", {}).get("Y", 0.0))
	r.position = pos
	r.setup(eid, e.get("PrefabId", 0), e.get("Hp", 1), e.get("MaxHp", 1))
	_resources[eid] = r


# 收到 S2C_WorldDelta → 更新资源 HP / 玩家位置
func on_world_delta(delta: Dictionary) -> void:
	for e in delta.get("EntityUpdates", []):
		var eid: int = e.get("EntityId", 0)
		var kind: int = e.get("Kind", 0)
		# 0 = player(待定), 1 = resource
		if eid == 0:
			continue
		if kind == 1:  # ENTITY_KIND_RESOURCE
			if _resources.has(eid):
				_resources[eid].on_hp_changed(e.get("Hp", 0), e.get("MaxHp", 1))
		# else: player 更新走 _player.on_world_delta_player
	# 玩家位置更新
	if _player != null and _player.has_method("on_world_delta_player"):
		for e in delta.get("EntityUpdates", []):
			var kind: int = e.get("Kind", 0)
			if kind == 0:  # ENTITY_KIND_PLAYER
				var pid: String = e.get("PlayerId", "")
				var pos: Vector2 = Vector2(e.get("Position", {}).get("X", 0.0), e.get("Position", {}).get("Y", 0.0))
				_player.on_world_delta_player(pid, pos.x, pos.y, e.get("Facing", 0))
	# events: GATHER_DONE
	for ev in delta.get("Events", []):
		if ev.get("EventKind", 0) == 3:  # WORLD_EVENT_GATHER_DONE
			var target: int = ev.get("TargetEntityId", 0)
			# 移除资源(若 HP=0 且不可重生)
			if _resources.has(target):
				_resources[target].queue_free()
				_resources.erase(target)
			if _player != null and _player.has_method("on_gather_done"):
				_player.on_gather_done(target)


# 智能判别辅助:player 调用
func find_nearest_gatherable(mouse_pos: Vector2, max_dist: float) -> int:
	var nearest_id: int = 0
	var nearest_d2: float = max_dist * max_dist
	for eid in _resources.keys():
		var r: Node = _resources[eid]
		var d2: float = (r.position - mouse_pos).length_squared()
		if d2 < nearest_d2:
			nearest_d2 = d2
			nearest_id = eid
	return nearest_id


func clear_resources() -> void:
	for eid in _resources.keys():
		_resources[eid].queue_free()
	_resources.clear()
