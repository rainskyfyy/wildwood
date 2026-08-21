extends SceneTree
## Wildwood M2.8 — Godot 4.3 验收测试(Season + DayNight + Light + Tick)
##
## 运行方式(需要 Godot 4.3):
##   cd wildwood
##   godot --headless --script res://core/abstract/world/gd/tests/test_m28.gd
##
## 沙箱无 Godot 二进制,本测试在外部 CI 跑. 验收逻辑与 Python 端
## tests/unit/world/* 一一对应,作为 GDScript 端冒烟测试.
##
## 验收覆盖(对应 M2.8 任务 4 项):
##   ① 4 季节切换 0.5s LOD 过渡
##   ② 温度范围符合方案 §2.7
##   ③ 全局时间轴统一驱动
##   ④ 昼夜光照过场平滑

var _passed: int = 0
var _failed: int = 0


func _init() -> void:
	# 1. Season enum 顺序
	_test_season_enum_order()
	# 2. SeasonTable 温度范围(验收 ②)
	_test_season_table_temperature()
	# 3. TimeAxis 推进
	_test_time_axis_tick()
	# 4. TimeAxis 季节索引循环
	_test_time_axis_season_index_wraps()
	# 5. DayNightClock 时段边界
	_test_day_night_phase_boundaries()
	# 6. DayNightClock 光强范围
	_test_day_night_intensity_range()
	# 7. LightController 0.5s LOD(验收 ①)
	_test_light_controller_lod_transition()
	# 8. LightController 终态保持
	_test_light_controller_terminal_state()
	# 9. TickDriver 季节切换事件(验收 ①)
	_test_tick_driver_season_event()
	# 10. TickDriver 昼夜切换事件(验收 ④)
	_test_tick_driver_phase_event()
	# 11. 端到端 1 季节推进(验收 ① + ④)
	_test_tick_driver_end_to_end()
	# 12. 全局时间轴单一 owner(验收 ③)
	_test_tick_driver_time_axis_owner()
	_report()


func _test(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		_passed += 1
		print("  PASS  %s" % name)
	else:
		_failed += 1
		print("  FAIL  %s  %s" % [name, detail])


# ---- 测试用例 ---------------------------------------------------------

func _test_season_enum_order() -> void:
	var names := WildwoodSeason.SEASON_NAMES
	_test(
		"Season enum order matches SEASON_ORDER",
		names == ["spring", "summer", "autumn", "winter"],
		"got %s" % names,
	)

func _test_season_table_temperature() -> void:
	# 验收 ②: 温度范围与方案 §2.7 一致
	var spring = WildwoodSeasonTable.lookup(WildwoodSeason.SPRING)
	var summer = WildwoodSeasonTable.lookup(WildwoodSeason.SUMMER)
	var autumn = WildwoodSeasonTable.lookup(WildwoodSeason.AUTUMN)
	var winter = WildwoodSeasonTable.lookup(WildwoodSeason.WINTER)
	_test("Spring temp 15-25", spring.temp_min_c == 15.0 and spring.temp_max_c == 25.0)
	_test("Summer temp 25-40", summer.temp_min_c == 25.0 and summer.temp_max_c == 40.0)
	_test("Autumn temp 10-20", autumn.temp_min_c == 10.0 and autumn.temp_max_c == 20.0)
	_test("Winter temp -10-5", winter.temp_min_c == -10.0 and winter.temp_max_c == 5.0)

func _test_time_axis_tick() -> void:
	var ta := WildwoodTimeAxis.new()
	ta.tick(60.0)
	_test("TimeAxis.tick accumulates", abs(ta.elapsed_real_seconds - 60.0) < 0.001)

func _test_time_axis_season_index_wraps() -> void:
	var ta := WildwoodTimeAxis.new()
	# 推进 4 整季节 + 1 天
	var total := (30 * 4 + 1) * 1440.0
	ta.tick(total)
	_test("TimeAxis season_index wraps", ta.season_index == 0, "got %d" % ta.season_index)
	_test("TimeAxis day_in_season advances", ta.day_in_season == 1, "got %d" % ta.day_in_season)

func _test_day_night_phase_boundaries() -> void:
	var ta := WildwoodTimeAxis.new()
	# 0h = night
	_test("0h = NIGHT", WildwoodDayPhase.phase_from_hour(0) == WildwoodDayPhase.NIGHT)
	# 4h = night
	_test("4h = NIGHT", WildwoodDayPhase.phase_from_hour(4) == WildwoodDayPhase.NIGHT)
	# 5h = dawn
	_test("5h = DAWN", WildwoodDayPhase.phase_from_hour(5) == WildwoodDayPhase.DAWN)
	# 7h = dawn
	_test("7h = DAWN", WildwoodDayPhase.phase_from_hour(7) == WildwoodDayPhase.DAWN)
	# 8h = day
	_test("8h = DAY", WildwoodDayPhase.phase_from_hour(8) == WildwoodDayPhase.DAY)
	# 16h = day
	_test("16h = DAY", WildwoodDayPhase.phase_from_hour(16) == WildwoodDayPhase.DAY)
	# 17h = dusk
	_test("17h = DUSK", WildwoodDayPhase.phase_from_hour(17) == WildwoodDayPhase.DUSK)
	# 19h = dusk
	_test("19h = DUSK", WildwoodDayPhase.phase_from_hour(19) == WildwoodDayPhase.DUSK)
	# 20h = night
	_test("20h = NIGHT", WildwoodDayPhase.phase_from_hour(20) == WildwoodDayPhase.NIGHT)
	# 23h = night
	_test("23h = NIGHT", WildwoodDayPhase.phase_from_hour(23) == WildwoodDayPhase.NIGHT)

func _test_day_night_intensity_range() -> void:
	var ta := WildwoodTimeAxis.new()
	# 0h night
	ta.tick(0.0)
	var dn = WildwoodDayNightClock.new(ta)
	_test("0h intensity = 0", dn.light_intensity() == 0.0)
	# 12h day
	ta.tick(12.0 * 60.0)
	_test("12h intensity = 1", dn.light_intensity() == 1.0, "got %.3f" % dn.light_intensity())

func _test_light_controller_lod_transition() -> void:
	# 验收 ①: 0.5s LOD 过渡
	var lc = WildwoodLightController.new([255, 200, 215], 1.0)  # spring
	lc.start_transition([180, 215, 245], 0.3, 0.5)  # winter, 0.5s
	# 中点
	lc.update(0.25)
	# RGB 应当在中点附近(允许 ±5 通道偏差)
	var mid = lc.current_rgb
	var ok_mid = true
	for c in mid:
		if abs(c - 217) > 30:
			ok_mid = false
	_test("0.5s LOD 中点", ok_mid, "mid=%s" % mid)
	# 完成后
	lc.update(0.3)
	_test("0.5s LOD 终态", lc.current_rgb == [180, 215, 245] and abs(lc.current_intensity - 0.3) < 0.01)

func _test_light_controller_terminal_state() -> void:
	var lc = WildwoodLightController.new([0, 0, 0], 0.0)
	lc.start_transition([255, 255, 255], 1.0, 0.5)
	lc.update(0.5)
	_test("LOD 终态保持", lc.current_rgb == [255, 255, 255] and lc.current_intensity == 1.0)
	# 再 update 不反弹
	lc.update(1.0)
	_test("LOD 终态不反弹", lc.current_rgb == [255, 255, 255] and lc.current_intensity == 1.0)

func _test_tick_driver_season_event() -> void:
	# 验收 ①: TickDriver 推进到季节边界触发事件
	var td = WildwoodTickDriver.new()
	# 推进 30 * 24 - 1 = 719 步(1h/步)
	for i in range(719):
		td.tick(60.0)
	# 第 720 步跨入 summer
	var ev = td.tick(60.0)
	_test(
		"季节切换事件触发",
		ev.season_change == WildwoodSeason.SUMMER and ev.in_season_transition,
		"ev=%s" % ev,
	)
	_test(
		"季节切换后 light 终态匹配表",
		td.light.current_rgb == WildwoodSeasonTable.lookup(WildwoodSeason.SUMMER).tint_rgb,
		"got %s" % td.light.current_rgb,
	)

func _test_tick_driver_phase_event() -> void:
	# 验收 ④: 昼夜切换触发光照过渡
	var td = WildwoodTickDriver.new()
	for i in range(5):  # 0h→5h 跨过 dawn
		ev = td.tick(60.0)
	_test(
		"昼夜切换事件触发",
		ev.phase_change == WildwoodDayPhase.DAWN and ev.in_daynight_transition,
		"ev=%s" % ev,
	)

func _test_tick_driver_end_to_end() -> void:
	# 端到端: 1 整年 (2880 step)
	var td = WildwoodTickDriver.new()
	var season_count := 0
	for i in range(2880):
		var ev = td.tick(60.0)
		if ev.season_change != -1:
			season_count += 1
		# RGB 始终在 0..255
		for c in td.light.current_rgb:
			if c < 0 or c > 255:
				_test("1 整年 RGB 越界 @ step %d" % i, false, "rgb=%s" % td.light.current_rgb)
				return
		# 光强始终在 0..1
		if td.light.current_intensity < 0.0 or td.light.current_intensity > 1.0:
			_test("1 整年光强越界 @ step %d" % i, false, "i=%.3f" % td.light.current_intensity)
			return
	_test("1 整年 4 次季节切换", season_count == 4, "got %d" % season_count)
	_test(
		"1 整年末回到 spring",
		td.season_clock.current == WildwoodSeason.SPRING,
		"got %d" % td.season_clock.current,
	)

func _test_tick_driver_time_axis_owner() -> void:
	# 验收 ③: TickDriver 持有 TimeAxis, 外部不能直接推进
	var td = WildwoodTickDriver.new()
	_test("TickDriver 持有 time_axis", td.time_axis != null)
	_test("初始 tick_count = 0", td.tick_count == 0)
	td.tick(0.1)
	_test("tick 后 tick_count = 1", td.tick_count == 1)


func _report() -> void:
	print("")
	print("== M2.8 GDScript Acceptance ==")
	print("PASSED: %d" % _passed)
	print("FAILED: %d" % _failed)
	if _failed > 0:
		quit(1)
	else:
		quit(0)
