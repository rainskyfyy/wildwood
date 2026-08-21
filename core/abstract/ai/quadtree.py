"""Quadtree spatial partition for O(log n + k) neighbor queries.

Used by M2.10 战斗系统 to limit melee/missile checks to nearby entities.
Header-only — no side-effects, no logging. Pure stdlib.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, List, Protocol

# Tuning constants — exposed so tests can reference the same values.
NODE_CAPACITY = 8
MAX_DEPTH = 8


@dataclass(frozen=True)
class AABB:
    """Axis-aligned bounding box. Immutable."""
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        return self.max_y - self.min_y

    @property
    def cx(self) -> float:
        return (self.min_x + self.max_x) * 0.5

    @property
    def cy(self) -> float:
        return (self.min_y + self.max_y) * 0.5

    def intersects(self, other: "AABB") -> bool:
        # Standard AABB overlap test.
        return (
            self.min_x <= other.max_x
            and self.max_x >= other.min_x
            and self.min_y <= other.max_y
            and self.max_y >= other.min_y
        )

    def contains_point(self, x: float, y: float) -> bool:
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y

    def quad_index(self, x: float, y: float) -> int:
        """Which child quadrant (0..3) does point (x,y) fall into.
        Layout: 0=NE 1=NW 2=SE 3=SW. Caller must pre-check point is inside."""
        east = x >= self.cx
        north = y < self.cy  # y-down world
        if east and north:
            return 0
        if not east and north:
            return 1
        if east and not north:
            return 2
        return 3

    def child_bounds(self, idx: int) -> "AABB":
        cx, cy = self.cx, self.cy
        if idx == 0:  # NE
            return AABB(cx, self.min_y, self.max_x, cy)
        if idx == 1:  # NW
            return AABB(self.min_x, self.min_y, cx, cy)
        if idx == 2:  # SE
            return AABB(cx, cy, self.max_x, self.max_y)
        # SW
        return AABB(self.min_x, cy, cx, self.max_y)


class SpatialEntity(Protocol):
    """Anything the Quadtree can store. Must expose an `aabb` property."""
    @property
    def aabb(self) -> AABB: ...


@dataclass
class _Node:
    bounds: AABB
    depth: int
    entities: List[SpatialEntity] = field(default_factory=list)
    children: List["_Node | None"] = field(default_factory=lambda: [None, None, None, None])
    divided: bool = False


class Quadtree:
    """Quadtree with fixed capacity per node and max depth.

    Behaviour:
    - Insert: places entity in deepest node whose bounds contain it and has
      room; on overflow subdivides (bounded by MAX_DEPTH).
    - Query: returns entities whose AABB intersects the query bounds.
      O(log n + k) typical, O(n) worst case (all entities in one node).
    """

    def __init__(self, bounds: AABB, capacity: int = NODE_CAPACITY, max_depth: int = MAX_DEPTH) -> None:
        self.root = _Node(bounds=bounds, depth=0)
        self.size = capacity
        self.max_depth = max_depth

    def insert(self, entity: SpatialEntity) -> bool:
        return self._insert(self.root, entity)

    def _insert(self, node: _Node, entity: SpatialEntity) -> bool:
        if not node.bounds.intersects(entity.aabb):
            return False

        if not node.divided:
            if len(node.entities) < self.size or node.depth >= self.max_depth:
                node.entities.append(entity)
                return True
            self._subdivide(node)

        for q in range(4):
            child = node.children[q]
            if child is not None and self._insert(child, entity):
                return True
        # Entity straddles multiple children — keep at this level so it isn't lost.
        node.entities.append(entity)
        return True

    def _subdivide(self, node: _Node) -> None:
        for q in range(4):
            node.children[q] = _Node(bounds=node.bounds.child_bounds(q), depth=node.depth + 1)
        # Re-distribute existing entities into children.
        kept: List[SpatialEntity] = []
        for e in node.entities:
            placed = False
            for q in range(4):
                child = node.children[q]
                if child is not None and self._insert(child, e):
                    placed = True
                    break
            if not placed:
                kept.append(e)
        node.entities = kept
        node.divided = True

    def query(self, range_bounds: AABB) -> List[SpatialEntity]:
        out: List[SpatialEntity] = []
        self._query(self.root, range_bounds, out, is_root=True)
        return out

    def _query(self, node: _Node, range_bounds: AABB, out: List[SpatialEntity], is_root: bool = False) -> None:
        # Root may hold entities that cross its boundary — always check them.
        if not is_root and not node.bounds.intersects(range_bounds):
            return
        for e in node.entities:
            if e.bounds.intersects(range_bounds):
                out.append(e)
        if node.divided:
            for q in range(4):
                child = node.children[q]
                if child is not None:
                    self._query(child, range_bounds, out)

    def clear(self) -> None:
        """Reset by re-rooting. Entities are gone; references released."""
        self.root = _Node(bounds=self.root.bounds, depth=0)


# Helper used by combat_simulator to build a Quadtree from a list of entities.
def build_quadtree(entities: Iterable[SpatialEntity], world_bounds: AABB) -> Quadtree:
    qt = Quadtree(world_bounds)
    for e in entities:
        qt.insert(e)
    return qt
