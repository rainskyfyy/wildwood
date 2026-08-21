extends GutTest

## SaveMetadata 的 GUT 单元测试
##
## 覆盖 M1.4 占位数据层 schema 的契约:
## - 构造与默认值
## - to_dict / from_dict 往返
## - 字段合法性校验
## - 版本号契约
## - 反序列化对错误输入的拒绝

func test_default_values() -> void:
	var m := SaveMetadata.new()
	assert_eq(m.schema_version, SaveMetadata.SCHEMA_VERSION, "默认 schema_version 应对齐常量")
	assert_eq(m.save_id, "", "默认 save_id 应为空")
	assert_eq(m.created_at_unix, 0, "默认时间戳为 0")
	assert_eq(m.player_count, 1, "默认玩家数 1")
	assert_eq(m.world_seed, 0, "默认种子为 0")
	assert_eq(m.game_day, 0, "默认天数为 0")

func test_constructor_assigns_fields() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 4, 12345, 7)
	assert_eq(m.save_id, "save_001", "save_id")
	assert_eq(m.created_at_unix, 1700000000, "时间戳")
	assert_eq(m.player_count, 4, "4 人小队")
	assert_eq(m.world_seed, 12345, "种子")
	assert_eq(m.game_day, 7, "天数")


func test_to_dict_contains_all_fields() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 4, 12345, 7)
	var d := m.to_dict()
	assert_true(d.has("schema_version"), "含 schema_version")
	assert_true(d.has("save_id"), "含 save_id")
	assert_true(d.has("created_at_unix"), "含 created_at_unix")
	assert_true(d.has("player_count"), "含 player_count")
	assert_true(d.has("world_seed"), "含 world_seed")
	assert_true(d.has("game_day"), "含 game_day")
	assert_eq(d["save_id"], "save_001", "save_id 字段值正确")

func test_round_trip_preserves_data() -> void:
	var original := SaveMetadata.new("save_xyz", 1700000000, 4, 999, 14)
	var dict := original.to_dict()
	var restored := SaveMetadata.from_dict(dict)
	assert_not_null(restored, "应能反序列化")
	assert_eq(restored.save_id, "save_xyz", "save_id 往返")
	assert_eq(restored.created_at_unix, 1700000000, "时间戳往返")
	assert_eq(restored.player_count, 4, "玩家数往返")
	assert_eq(restored.world_seed, 999, "种子往返")
	assert_eq(restored.game_day, 14, "天数往返")
	assert_eq(restored.schema_version, SaveMetadata.SCHEMA_VERSION, "schema_version 往返")


func test_from_dict_rejects_missing_version() -> void:
	# 缺 schema_version 应返回 null
	var restored := SaveMetadata.from_dict({"save_id": "x"})
	assert_null(restored, "缺 schema_version 应返回 null")

func test_from_dict_rejects_wrong_version() -> void:
	# 版本不匹配应返回 null
	var restored := SaveMetadata.from_dict({
		"schema_version": 999,
		"save_id": "x",
		"created_at_unix": 1,
		"player_count": 1,
		"world_seed": 0,
		"game_day": 0,
	})
	assert_null(restored, "schema_version=999 应被拒")


func test_is_valid_accepts_good_data() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 4, 12345, 7)
	assert_true(m.is_valid(), "完整有效数据应通过")

func test_is_valid_rejects_empty_id() -> void:
	var m := SaveMetadata.new("", 1700000000, 4, 12345, 7)
	assert_false(m.is_valid(), "空 save_id 应被拒")

func test_is_valid_rejects_zero_time() -> void:
	var m := SaveMetadata.new("save_001", 0, 4, 12345, 7)
	assert_false(m.is_valid(), "时间戳 0 应被拒")

func test_is_valid_rejects_player_count_above_4() -> void:
	# 方案 §2.2:4 人小队上限
	var m := SaveMetadata.new("save_001", 1700000000, 5, 12345, 7)
	assert_false(m.is_valid(), "5 人违反 4 人上限")

func test_is_valid_rejects_player_count_below_1() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 0, 12345, 7)
	assert_false(m.is_valid(), "0 人非法")

func test_is_valid_accepts_all_legal_player_counts() -> void:
	# 1 / 2 / 3 / 4 都应通过
	for n in [1, 2, 3, 4]:
		var m := SaveMetadata.new("save_%d" % n, 1700000000, n, 12345, 7)
		assert_true(m.is_valid(), "%d 人应合法" % n)

func test_is_valid_rejects_negative_seed() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 4, -1, 7)
	assert_false(m.is_valid(), "负种子应被拒")

func test_is_valid_rejects_negative_day() -> void:
	var m := SaveMetadata.new("save_001", 1700000000, 4, 12345, -1)
	assert_false(m.is_valid(), "负天数应被拒")
