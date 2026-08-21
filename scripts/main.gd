extends Node
## Main scene root script.
##
## This is the entry point when the game launches. It bootstraps the runtime,
## then loads the main menu / gameplay as defined by [code]project.godot[/code].
##
## M1.1 scope: only a stub that prints a version line and quits on Escape.
## Real gameplay scenes (HUD, world, inventory) are delivered in M2.x.

const PROJECT_VERSION: String = "0.1.0"

func _ready() -> void:
	print("[Wildwood %s] boot OK" % PROJECT_VERSION)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_tree().quit()
