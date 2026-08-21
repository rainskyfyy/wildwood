extends Node
## 全局死亡与复活信号 (M2.5)
##
## 单例 Autoload 风格 — 用静态方法代替全局变量;
## 客户端 + 房间服务(GO 端)都通过这套事件对接。
##
## 用法:
##   WildwoodSurvivalSignals.player_entered_ghost.connect(_on_player_ghosted)
##   WildwoodSurvivalSignals.player_revived.connect(_on_player_revived)
##   WildwoodSurvivalSignals.remains_spawned.connect(_on_remains_spawned)
class_name WildwoodSurvivalSignals

# 玩家进入鬼魂态(HP=0, 开始 10s 倒计时)
# payload: { player_id, ghost_until_ms (server_time), position: Vector2 }
signal player_entered_ghost(payload: Dictionary)

# 玩家被队友救起(从 GHOST 回到 ALIVE)
# payload: { player_id, reviver_id, position: Vector2, hp_pct }
signal player_revived(payload: Dictionary)

# 玩家进入濒死(超时, 遗物已生成)
# payload: { player_id, position: Vector2, remains_id }
signal player_died(payload: Dictionary)

# 遗物生成(超时未救起, 遗物坐标广播)
# payload: { remains_id, owner_player_id, position: Vector2, world_pos: Vector2, lifetime_ms }
signal remains_spawned(payload: Dictionary)

# 遗物被队友拾取(濒死玩家回城)
# payload: { remains_id, picker_id, owner_player_id }
signal remains_picked(payload: Dictionary)

# 遗物超时消失
# payload: { remains_id }
signal remains_expired(payload: Dictionary)

# 玩家槽位视觉状态(供 HUD 灰显 50% 透明)
# payload: { player_id, slot_state: int, alpha_pct }
signal slot_visual_state_changed(payload: Dictionary)

# 静默 helper(用于在测试中确认信号是否触发,但避免打印刷屏)
static func debug_describe(payload: Dictionary) -> String:
	var parts: Array[String] = []
	for k in payload.keys():
		parts.append("%s=%s" % [k, str(payload[k])])
	return "{ " + ", ".join(parts) + " }"
