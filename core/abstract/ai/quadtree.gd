extends RefCounted
class_name WildwoodQuadtree
## Quadtree spatial partition — Godot 4.3 GDScript mirror of
## core/abstract/ai/quadtree.py. 1:1 semantics, used by CombatDirector.
##
## Tuning constants (must match Python):
##   NODE_CAPACITY = 8
##   MAX_DEPTH = 8

const NODE_CAPACITY: int = 8
const MAX_DEPTH: int = 8

# AABB stored as Dictionary: {min_x, min_y, max_x, max_y}
# Entity payload: anything with .aabb: Dictionary property

# Internal node: {bounds: AABB, depth: int, entities: Array, children: Array[Node|null], divided: bool}
var _root: Dictionary
var _size: int

func _init(bounds: Dictionary, capacity: int = NODE_CAPACITY, max_depth: int = MAX_DEPTH) -> void:
	_root = _make_node(bounds, 0)
	_size = capacity
	# max_depth is read in _insert via _max_depth field
	_root["max_depth"] = max_depth

static func _make_node(bounds: Dictionary, depth: int) -> Dictionary:
	return {
		"bounds": bounds.duplicate(),
		"depth": depth,
		"entities": [],
		"children": [null, null, null, null],
		"divided": false,
		"max_depth": MAX_DEPTH,
	}

static func aabb_intersects(a: Dictionary, b: Dictionary) -> bool:
	return (
		a["min_x"] <= b["max_x"] and a["max_x"] >= b["min_x"]
		and a["min_y"] <= b["max_y"] and a["max_y"] >= b["min_y"]
	)

static func aabb_cx(b: Dictionary) -> float:
	return (b["min_x"] + b["max_x"]) * 0.5

static func aabb_cy(b: Dictionary) -> float:
	return (b["min_y"] + b["max_y"]) * 0.5

static func child_bounds(b: Dictionary, idx: int) -> Dictionary:
	var cx_v: float = aabb_cx(b)
	var cy_v: float = aabb_cy(b)
	match idx:
		0: # NE
			return {"min_x": cx_v, "min_y": b["min_y"], "max_x": b["max_x"], "max_y": cy_v}
		1: # NW
			return {"min_x": b["min_x"], "min_y": b["min_y"], "max_x": cx_v, "max_y": cy_v}
		2: # SE
			return {"min_x": cx_v, "min_y": cy_v, "max_x": b["max_x"], "max_y": b["max_y"]}
		_: # SW
			return {"min_x": b["min_x"], "min_y": cy_v, "max_x": cx_v, "max_y": b["max_y"]}

func insert(entity) -> bool:
	return _insert(_root, entity)

func _insert(node: Dictionary, entity) -> bool:
	if not aabb_intersects(node["bounds"], entity.aabb):
		return false
	if not node["divided"]:
		if node["entities"].size() < _size or node["depth"] >= node["max_depth"]:
			node["entities"].append(entity)
			return true
		_subdivide(node)
	for q in range(4):
		var child = node["children"][q]
		if child != null and _insert(child, entity):
			return true
	# Straddles children — keep at this level
	node["entities"].append(entity)
	return true

func _subdivide(node: Dictionary) -> void:
	for q in range(4):
		node["children"][q] = _make_node(child_bounds(node["bounds"], q), node["depth"] + 1)
		node["children"][q]["max_depth"] = node["max_depth"]
	var kept: Array = []
	for e in node["entities"]:
		var placed := false
		for q in range(4):
			var child = node["children"][q]
			if child != null and _insert(child, e):
				placed = true
				break
		if not placed:
			kept.append(e)
	node["entities"] = kept
	node["divided"] = true

func query(range_bounds: Dictionary) -> Array:
	var out: Array = []
	_query(_root, range_bounds, out, true)
	return out

func _query(node: Dictionary, range_bounds: Dictionary, out: Array, is_root: bool) -> void:
	if not is_root and not aabb_intersects(node["bounds"], range_bounds):
		return
	for e in node["entities"]:
		if aabb_intersects(e.aabb, range_bounds):
			out.append(e)
	if node["divided"]:
		for q in range(4):
			var child = node["children"][q]
			if child != null:
				_query(child, range_bounds, out, false)

func clear() -> void:
	_root = _make_node(_root["bounds"], 0)
	_root["max_depth"] = MAX_DEPTH
