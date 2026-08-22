// PoC-5 fetchPatch:模拟网络下载(可被 progress callback 中断)
//
// 真实场景:用 fetch + 重试 3 次。本 PoC 简化:用 setTimeout 模拟。

export function fetchPatch(plan, { onProgress, criticalIds = [] } = {}) {
  const total = plan.toFetch.length;
  let completed = 0;
  return new Promise(resolve => {
    const tick = () => {
      completed += 1;
      if (onProgress) onProgress(completed, total);
      if (completed < total) {
        setTimeout(tick, 1);
      } else {
        resolve({ ok: true, failedCritical: [], failedOptional: [], completed });
      }
    };
    setTimeout(tick, 0);
  });
}
