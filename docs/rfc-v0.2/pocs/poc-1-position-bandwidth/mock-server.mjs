// PoC-1 mock 服务端:接收 bot 上报,200ms 广播一次真实位置
// 简化:同进程,无网络,无 WebSocket。

export function mockServer({ broadcastIntervalMs = 200, maxSpeed = 6.0 } = {}) {
  const positions = new Map();   // botId -> {x, y, lastTick}
  const rttSamples = [];          // 每条广播的 rtt 样本
  const rejected = [];            // 被服务端 reject 的上报
  const broadcasts = [];          // 每条广播的字节数
  const reportBytes = [];         // 每条上报的字节数
  const tickLog = [];             // [{tick, x, y, by, ok}]

  let tick = 0;
  let broadcastTimer = null;
  let lastBroadcastTick = 0;
  let pendingByBot = new Map();   // botId -> [tick, sendTs]

  function validateClientMove(botId, x, y, prevX, prevY, dt) {
    const dx = Math.abs(x - prevX);
    const dy = Math.abs(y - prevY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= maxSpeed * dt + 0.5;  // 0.5 容差
  }

  return {
    /** 客户端上报入口 — 对应 compressG_ACTION(MOVE) → 服务端 applyG_ACTION */
    receiveReport(botId, x, y, intentTick, sendTs) {
      const prev = positions.get(botId) ?? { x, y, lastTick: intentTick };
      const dt = (intentTick - prev.lastTick) / 1000;  // tick 是 ms
      const ok = validateClientMove(botId, x, y, prev.x, prev.y, dt);

      // 模拟 MessagePack 字节数:tick(8) + x/y(8) + idLen + id + 2 schema 字节
      const bytes = 8 + 8 + 2 + botId.length + 4;
      reportBytes.push(bytes);

      if (!ok) {
        rejected.push({ botId, intentTick, reason: 'OVER_SPEED' });
        return { ok: false, reason: 'OVER_SPEED' };
      }
      positions.set(botId, { x, y, lastTick: intentTick });
      const arr = pendingByBot.get(botId) ?? [];
      arr.push([intentTick, sendTs]);
      pendingByBot.set(botId, arr);
      tickLog.push({ tick: intentTick, x, y, by: botId, ok: true });
      return { ok: true };
    },

    /** 服务端广播入口 — 对应 compressG_STATE */
    broadcast() {
      const payload = [];
      for (const [id, p] of positions) {
        payload.push({ id, x: p.x, y: p.y });
      }
      // 模拟字节:4 N 字段 + N * 12 字节每条
      const bytes = 4 + payload.length * 12;
      broadcasts.push(bytes);
      const now = Date.now();
      for (const [id, arr] of pendingByBot) {
        if (arr.length) {
          const [intentTick, sendTs] = arr[arr.length - 1];
          rttSamples.push(now - sendTs);
          pendingByBot.set(id, []);
        }
      }
      lastBroadcastTick = Date.now();
    },

    metrics() {
      const totalReport = reportBytes.reduce((a, b) => a + b, 0);
      const totalBroadcast = broadcasts.reduce((a, b) => a + b, 0);
      const sortedRtt = [...rttSamples].sort((a, b) => a - b);
      const p50 = sortedRtt[Math.floor(sortedRtt.length * 0.5)] ?? 0;
      const p95 = sortedRtt[Math.floor(sortedRtt.length * 0.95)] ?? 0;
      return {
        totalReports: reportBytes.length,
        totalBroadcasts: broadcasts.length,
        totalReportBytes: totalReport,
        totalBroadcastBytes: totalBroadcast,
        reportBytesPerSec: totalReport / (DURATION_REF_S || 60),
        broadcastBytesPerSec: totalBroadcast / (DURATION_REF_S || 60),
        totalBytesPerSec: (totalReport + totalBroadcast) / (DURATION_REF_S || 60),
        rttP50Ms: p50,
        rttP95Ms: p95,
        rejectedCount: rejected.length,
        rejectedSample: rejected.slice(0, 3),
        tickLogCount: tickLog.length,
      };
    },

    async start() {
      tick = 0;
      broadcastTimer = setInterval(() => this.broadcast(), broadcastIntervalMs);
    },

    async stop() {
      if (broadcastTimer) clearInterval(broadcastTimer);
    },
  };
}

// 占位:实际值在 index.mjs 算后通过 metrics().totalBytesPerSec 修正
const DURATION_REF_S = 60;
