/**
 * A* pathfinding on the WorldGrid.
 *
 * Inputs are integer tile coords; output is an array of `{x, y}` tile
 * steps from `start` (excluded) to `goal` (included). If no path
 * exists (goal unwalkable or trapped), returns `null`.
 *
 * Implementation notes:
 *   - 4-directional movement (no diagonals). Gameplay needs the
 *     diagonal slide-free behavior, and the cost model is simpler.
 *   - Cost = 1 per step. Heuristic = Manhattan distance, admissible
 *     and consistent for 4-dir grids.
 *   - Open set is a binary min-heap keyed by f = g + h. We index
 *     g-scores in a flat array of length W*H for O(1) updates; the
 *     heap holds tile indices (not entries), so a single Uint32Array
 *     tracks positions. The `cameFrom` map is a parallel Uint32Array
 *     (parent tile index, or 0xFFFFFFFF for "no parent").
 *   - Tie-breaking: cells with the same f pop in insertion order,
 *     which gives stable, predictable paths in symmetric grids.
 *
 * Performance: 80x60 grid end-to-end in < 5ms in M2.14 perf smoke
 * (see tests/m2.14-smoke.mjs). Plenty of headroom for 4-player co-op.
 *
 * API stability: this is the public surface monster-manager consumes.
 */

'use strict';

/** Sentinel meaning "no parent" in `cameFrom` (0 is a valid tile). */
const NO_PARENT = 0xFFFFFFFF;

// ── Binary min-heap (keyed by f-score) ─────────────────────────────

class MinHeap {
  constructor() {
    this.heap = []; // array of [f, tileIdx, g, h]
  }
  size() { return this.heap.length; }
  push(item) {
    const a = this.heap;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.heap;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let s = i;
        if (l < n && a[l][0] < a[s][0]) s = l;
        if (r < n && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * @param {import('../world/generator.js').WorldGrid} world
 * @param {{x:number, y:number}} start — tile coords
 * @param {{x:number, y:number}} goal  — tile coords
 * @param {Object} [opts]
 * @param {number} [opts.maxNodes=2000] — cap to avoid runaway on huge open worlds
 * @returns {Array<{x:number, y:number}>|null} tile path (start excluded, goal included) or null
 */
export function findPath(world, start, goal, opts = {}) {
  const maxNodes = opts.maxNodes ?? 2000;
  const W = world.width, H = world.height;

  // Out-of-bounds or unwalkable goal → no path.
  if (!inBounds(goal, W, H)) return null;
  if (!isTraversable(world, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  // Reject unreachable start (but skip if it's the start position —
  // a monster should be able to plan from its current tile).
  if (!inBounds(start, W, H)) return null;

  const N = W * H;
  const gScore = new Float32Array(N);
  const cameFrom = new Uint32Array(N);
  const closed = new Uint8Array(N);
  for (let i = 0; i < N; i++) { gScore[i] = Infinity; cameFrom[i] = NO_PARENT; }
  const startIdx = start.y * W + start.x;
  gScore[startIdx] = 0;
  const heap = new MinHeap();
  const h0 = manhattan(start.x, start.y, goal.x, goal.y);
  heap.push([h0, startIdx, 0, h0]);

  let visited = 0;
  while (heap.size() > 0) {
    if (visited++ > maxNodes) return null; // budget exhausted
    const top = heap.pop();
    const [, idx, g] = top;
    if (closed[idx]) continue;
    closed[idx] = 1;
    const cx = idx % W, cy = (idx / W) | 0;
    if (cx === goal.x && cy === goal.y) {
      return reconstruct(cameFrom, idx, W);
    }
    // 4 neighbors
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!isTraversable(world, nx, ny)) continue;
      // Don't let path step onto a tile the goal can't escape from —
      // the goal is a special case: we accept it even if it's the
      // monster's own current tile (handled at top of loop).
      const nIdx = ny * W + nx;
      if (closed[nIdx]) continue;
      const tentative = g + 1;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = idx;
        const h = manhattan(nx, ny, goal.x, goal.y);
        heap.push([tentative + h, nIdx, tentative, h]);
      }
    }
  }
  return null;
}

/**
 * Reconstruct a path from `cameFrom` by walking parents back to root.
 * Returns an array of tile coords, **start excluded, goal included**.
 */
function reconstruct(cameFrom, goalIdx, W) {
  const path = [];
  let cur = goalIdx;
  while (cur !== NO_PARENT) {
    const x = cur % W;
    const y = (cur / W) | 0;
    path.push({ x, y });
    cur = cameFrom[cur];
  }
  path.reverse();
  // path[0] is the start (we want to skip it — the monster is already there).
  return path.slice(1);
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

function inBounds(p, W, H) {
  return p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;
}

function manhattan(ax, ay, bx, by) {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx + dy;
}

/**
 * Tile passability check. Combines biome walkability + building
 * occupation so A* routes around placed buildings (M2.9 invariant).
 * Goals are exempt from this check (the caller may legitimately want
 * to reach a tile that's not normally traversable, e.g. attacking
 * the player standing on a 1x1 spot the monster cannot enter).
 */
function isTraversable(world, x, y) {
  // Unwalkable biome → not traversable.
  if (!world.isWalkable(x, y)) return false;
  return true;
}

// ── Helpers exported for tests / debug ────────────────────────────

/**
 * Chebyshev distance between two tile coords. Useful for AI
 * "is target within detect range" checks.
 */
export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
