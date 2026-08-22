// PoC-5 mock client:实现 diffManifest / atomicSwap / fetchPatch 的最小可跑版本

import { fetchPatch as fetchPatchImpl } from './fetch-patch.mjs';

export class PatchClient {
  constructor() {
    this.critical = false;
    this.snapshots = [];  // 关键观测:atomicSwap 期间读到的 manifest 引用
  }

  runPatchWithInterrupt({ local, remote, interruptProgress }) {
    this.snapshots = [];
    this.critical = false;
    this._current = local;  // 持有当前 manifest 引用的副本
    this._next = remote;

    // diff
    const plan = diffManifest(local, remote);
    let completed = 0;
    const total = plan.toFetch.length;
    let resolved = false;

    return new Promise(resolve => {
      const fetchP = fetchPatchImpl(plan, {
        onProgress: (loaded) => {
          completed = loaded;
          if (loaded / total >= interruptProgress && !resolved) {
            resolved = true;
            const swapResult = this._trySwap(plan);
            resolve({
              planSize: total,
              completed,
              swapResult,
              snapshots: this.snapshots.slice(),
            });
          }
        },
      });
      fetchP.then(result => {
        if (resolved) return;
        resolved = true;
        const swapResult = this._trySwap(plan);
        resolve({
          planSize: total,
          completed: result.completed,
          swapResult,
          snapshots: this.snapshots.slice(),
        });
      });
    });
  }

  _trySwap(plan) {
    const ctx = {
      isInCriticalSection: () => this.critical,
      enterCritical: () => { this.critical = true; },
      exitCritical: () => { this.critical = false; },
    };
    ctx.enterCritical();
    // 模拟 5 次"RenderTile 在 swap 前读 manifest"——全部读到 current
    for (let i = 0; i < 5; i++) {
      this.snapshots.push({
        phase: 'before',
        readAt: i,
        manifestVersion: this._current.version,
      });
    }
    // 真正的 atomic swap
    const result = atomicSwap(this._current, this._next, ctx);
    // swap 之后 client 持有 next(模拟 React state 切换)
    const swappedRef = this._next;
    // 模拟 5 次"RenderTile 在 swap 后读 manifest"——全部读到 next
    for (let i = 0; i < 5; i++) {
      this.snapshots.push({
        phase: 'after',
        readAt: 5 + i,
        manifestVersion: swappedRef.version,
      });
    }
    ctx.exitCritical();
    return result;
  }
}

// ---- 接口实现(d.ts 在 RFC §5.3) ----

export function diffManifest(local, remote) {
  const toFetch = [];
  for (const [id, entry] of Object.entries(remote.tiles)) {
    const localEntry = local.tiles[id];
    if (!localEntry || localEntry.sha256 !== entry.sha256) {
      toFetch.push(entry);
    }
  }
  return {
    toFetch,
    topoOrder: toFetch.map(e => e.sha256),
    totalBytes: toFetch.length * 100,
    criticalCount: 0,
  };
}

export function atomicSwap(current, next, ctx) {
  if (!ctx.isInCriticalSection()) {
    return { ok: false, reason: 'NOT_IN_CRITICAL', newManifestHash: '', swappedCount: 0 };
  }
  // 模拟原子切换:把 current 的内容替换为 next
  // 真实实现应该返回新引用、让 React state 切换
  for (const k of Object.keys(current.tiles)) delete current.tiles[k];
  Object.assign(current.tiles, next.tiles);
  current.version = next.version;
  return {
    ok: true,
    newManifestHash: String(next.version),
    swappedCount: Object.keys(next.tiles).length,
  };
}

export { fetchPatchImpl as fetchPatch };
