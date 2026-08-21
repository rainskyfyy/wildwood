"""Hate table with exponential decay + persistence helpers.

A HateTable is a {target_id: hate_value} mapping that decays each tick.
Used to decide which target a monster preferentially chases/attacks.

M2.10 验收 ③: 仇恨表持久化 — to_dict/from_dict is the persistence boundary.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Iterator, Tuple

# Hate value of 0.7 (≈ 70% of current) after 5 seconds → half-life ≈ 10.85s.
# V(t) = V(0) * exp(-k * t), with V(5) = 0.7 * V(0) → k = -ln(0.7)/5 ≈ 0.0713.
HATE_DECAY_PER_SEC = -math.log(0.7) / 5.0  # ≈ 0.071335

# Below this threshold the entry is culled (keeps the table bounded).
HATE_EPSILON = 0.01


@dataclass
class HateTable:
    """Single-target hate list keyed by attacker id."""
    decay_per_sec: float = HATE_DECAY_PER_SEC
    epsilon: float = HATE_EPSILON
    entries: Dict[int, float] = field(default_factory=dict)

    def add(self, target_id: int, amount: float) -> None:
        if amount <= 0:
            return
        self.entries[target_id] = self.entries.get(target_id, 0.0) + amount

    def tick(self, dt: float) -> None:
        if dt <= 0 or not self.entries:
            return
        factor = math.exp(-self.decay_per_sec * dt)
        culled: list[int] = []
        for tid, v in self.entries.items():
            nv = v * factor
            if nv < self.epsilon:
                culled.append(tid)
            else:
                self.entries[tid] = nv
        for tid in culled:
            del self.entries[tid]

    def top(self) -> Tuple[int, float] | None:
        if not self.entries:
            return None
        tid, v = max(self.entries.items(), key=lambda kv: kv[1])
        return tid, v

    def get(self, target_id: int) -> float:
        return self.entries.get(target_id, 0.0)

    def __iter__(self) -> Iterator[Tuple[int, float]]:
        return iter(self.entries.items())

    def __len__(self) -> int:
        return len(self.entries)

    def to_dict(self) -> dict:
        return {
            "decay_per_sec": self.decay_per_sec,
            "epsilon": self.epsilon,
            "entries": {str(k): v for k, v in self.entries.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> "HateTable":
        ht = cls(
            decay_per_sec=float(data.get("decay_per_sec", HATE_DECAY_PER_SEC)),
            epsilon=float(data.get("epsilon", HATE_EPSILON)),
        )
        raw = data.get("entries", {})
        for k, v in raw.items():
            ht.entries[int(k)] = float(v)
        return ht


@dataclass
class HateTableSet:
    """Per-monster hate tables, keyed by monster id."""
    tables: Dict[int, HateTable] = field(default_factory=dict)

    def ensure(self, monster_id: int) -> HateTable:
        if monster_id not in self.tables:
            self.tables[monster_id] = HateTable()
        return self.tables[monster_id]

    def add(self, monster_id: int, target_id: int, amount: float) -> None:
        self.ensure(monster_id).add(target_id, amount)

    def tick(self, dt: float) -> None:
        for t in self.tables.values():
            t.tick(dt)

    def get(self, monster_id: int, target_id: int) -> float:
        t = self.tables.get(monster_id)
        if t is None:
            return 0.0
        return t.get(target_id)

    def top(self, monster_id: int) -> Tuple[int, float] | None:
        t = self.tables.get(monster_id)
        return None if t is None else t.top()

    def to_dict(self) -> dict:
        return {str(mid): t.to_dict() for mid, t in self.tables.items()}

    @classmethod
    def from_dict(cls, data: dict) -> "HateTableSet":
        s = cls()
        for k, v in data.items():
            s.tables[int(k)] = HateTable.from_dict(v)
        return s
