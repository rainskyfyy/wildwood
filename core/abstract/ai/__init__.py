# AI module — spatial partitioning and movement helpers.
from core.abstract.ai.quadtree import (
    AABB,
    NODE_CAPACITY,
    MAX_DEPTH,
    Quadtree,
    SpatialEntity,
    build_quadtree,
)

__all__ = ["AABB", "NODE_CAPACITY", "MAX_DEPTH", "Quadtree", "SpatialEntity", "build_quadtree"]
