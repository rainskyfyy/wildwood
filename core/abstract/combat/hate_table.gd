extends RefCounted
class_name WildwoodHateTable
## Hate table with exponential decay + persistence — Godot 4.3 mirror of
## core/abstract/combat/hate_table.py.
##
## V(t) = V(0) * exp(-k * t), k = HATE_DECAY_PER_SEC.
## After 5s, value drops to ~70% of original.

const HATE_DECAY_PER_SEC: float = 0.071335  # -ln(0.7) / 5.0
const HATE_EPSILON: float = 0.01

var decay_per_sec: float = HATE_DECAY_PER_SEC
var epsilon: float = HATE_EPSILON
var entries: Dictionary = {}  # {target_id_str: float}

func add(target_id: int, amount: float) -> void:
	if amount <= 0:
		return
	var key := str(target_id)
	entries[key] = entries.get(key, 0.0) + amount

func tick(dt: float) -> void:
	if dt <= 0.0 or entries.is_empty():
		return
	var factor: float = exp(-decay_per_sec * dt)
	var culled: Array = []
	for key in entries.keys():
		var nv: float = entries[key] * factor
		if nv < epsilon:
			culled.append(key)
		else:
			entries[key] = nv
	for k in culled:
		entries.erase(k)

func top() -> Array:
	# returns [target_id, value] or [] if empty
	if entries.is_empty():
		return []
	var best_id: int = 0
	var best_v: float = -1.0
	for key in entries.keys():
		var v: float = entries[key]
		if v > best_v:
			best_v = v
			best_id = int(key)
	return [best_id, best_v]

func get_value(target_id: int) -> float:
	return entries.get(str(target_id), 0.0)

func size() -> int:
	return entries.size()

func to_dict() -> Dictionary:
	return {
		"decay_per_sec": decay_per_sec,
		"epsilon": epsilon,
		"entries": entries.duplicate(),
	}

static func from_dict(data: Dictionary) -> WildwoodHateTable:
	var ht := WildwoodHateTable.new()
	ht.decay_per_sec = float(data.get("decay_per_sec", HATE_DECAY_PER_SEC))
	ht.epsilon = float(data.get("epsilon", HATE_EPSILON))
	ht.entries = {}
	for key in (data.get("entries", {}) as Dictionary).keys():
		ht.entries[key] = float(data["entries"][key])
	return ht


# ---------------------------------------------------------------------
# HateTableSet — per-monster hate tables
# ---------------------------------------------------------------------

class_name WildwoodHateTableSet
extends RefCounted

var tables: Dictionary = {}  # {monster_id_str: WildwoodHateTable}

func ensure(monster_id: int) -> WildwoodHateTable:
	var key := str(monster_id)
	if not tables.has(key):
		tables[key] = WildwoodHateTable.new()
	return tables[key]

func add_hate(monster_id: int, target_id: int, amount: float) -> void:
	ensure(monster_id).add(target_id, amount)

func tick(dt: float) -> void:
	for t in tables.values():
		(t as WildwoodHateTable).tick(dt)

func get_value(monster_id: int, target_id: int) -> float:
	var t: WildwoodHateTable = tables.get(str(monster_id), null)
	if t == null:
		return 0.0
	return t.get_value(target_id)

func top(monster_id: int) -> Array:
	var t: WildwoodHateTable = tables.get(str(monster_id), null)
	if t == null:
		return []
	return t.top()

func to_dict() -> Dictionary:
	var d: Dictionary = {}
	for k in tables.keys():
		d[k] = (tables[k] as WildwoodHateTable).to_dict()
	return d

static func from_dict(data: Dictionary) -> WildwoodHateTableSet:
	var s := WildwoodHateTableSet.new()
	s.tables = {}
	for k in data.keys():
		s.tables[k] = WildwoodHateTable.from_dict(data[k])
	return s
