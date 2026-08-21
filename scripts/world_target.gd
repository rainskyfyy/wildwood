extends Area2D
class_name WorldTarget
## 可交互目标占位 (M2.1):鼠标 / LMB 智能判别用的世界对象。
##
## 设计:
##   - 挂在一个 Area2D 上,持有 id / world_pos / target_type("attack" | "gather" | "none")
##   - 颜色/形状由 demo 场景配置(M2.14 替换为真实 sprite)
##   - World.get_candidates() 用 group "world_target" 扫描

@export var target_id: String = ""
@export var target_type: String = "none"  # "attack" / "gather" / "none"


func _ready() -> void:
	if target_id == "":
		target_id = name  # 缺省用节点名
	add_to_group("world_target")


## 提供给 LMB 判别用的元组(与 lmb_decide.gd 候选格式 1:1)。
func to_candidate() -> Dictionary:
	return {
		"id": target_id,
		"pos": position / 32.0,  # WorldTarget.position 是像素,LMB 判别用米
		"type": target_type,
	}
