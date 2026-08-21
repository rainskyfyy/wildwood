extends RefCounted
class_name SaveMetadata

## 存档元数据(M1.3 占位,M1.4 数据层抽象 + M2.6 落盘)
##
## 描述一次存档的元信息,不包含实际世界数据。
## 字段设计遵循方案 §3.3.1 数据层抽象:JSON-friendly
## (基础类型 + 字符串 + 嵌套字典)便于 B 线 Unity/JSON 共享。
##
## 版本号使用整数递增,加载时按版本号走迁移路径;
## 当前定义的是 v1 契约,后续 M2.6 持久化时按此格式写入。

const SCHEMA_VERSION: int = 1

var schema_version: int = SCHEMA_VERSION
var save_id: String = ""
var created_at_unix: int = 0
var player_count: int = 0
var world_seed: int = 0
var game_day: int = 0  # 当前世界天数,M2.8 季节循环用


func _init(
	p_save_id: String = "",
	p_created_at: int = 0,
	p_player_count: int = 1,
	p_world_seed: int = 0,
	p_game_day: int = 0
) -> void:
	schema_version = SCHEMA_VERSION
	save_id = p_save_id
	created_at_unix = p_created_at
	player_count = p_player_count
	world_seed = p_world_seed
	game_day = p_game_day


## 序列化为字典(JSON-friendly)
func to_dict() -> Dictionary:
	return {
		"schema_version": schema_version,
		"save_id": save_id,
		"created_at_unix": created_at_unix,
		"player_count": player_count,
		"world_seed": world_seed,
		"game_day": game_day,
	}


## 从字典反序列化(版本校验)
static func from_dict(data: Dictionary) -> SaveMetadata:
	if not data.has("schema_version"):
		push_error("SaveMetadata.from_dict: missing schema_version")
		return null
	var v: int = int(data["schema_version"])
	if v != SCHEMA_VERSION:
		push_error("SaveMetadata.from_dict: unsupported schema_version %d (expected %d)" % [v, SCHEMA_VERSION])
		return null
	return SaveMetadata.new(
		String(data.get("save_id", "")),
		int(data.get("created_at_unix", 0)),
		int(data.get("player_count", 1)),
		int(data.get("world_seed", 0)),
		int(data.get("game_day", 0)),
	)


## 校验元数据合法性(可序列化为存档前的最后一道关卡)
func is_valid() -> bool:
	if save_id.is_empty():
		return false
	if created_at_unix <= 0:
		return false
	if player_count < 1 or player_count > 4:
		return false  # 方案 §2.2 4 人小队上限
	if world_seed < 0:
		return false
	if game_day < 0:
		return false
	return true
