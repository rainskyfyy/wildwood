// lighthouserc.js
// M3.10 性能 assertion：对应 4 条验收标准
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:8080/',            // 首屏
        'http://localhost:8080/lobby'        // 4 人联机大厅
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        throttlingMethod: 'provided',
        // 不限速：CI 环境本就接近生产桌面
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0
        },
        screenEmulation: {
          mobile: false,
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
          disabled: false
        }
      }
    },
    assert: {
      assertions: {
        // A1: Lighthouse 性能 ≥ 90
        'categories:performance': ['error', { minScore: 0.9 }],
        // A3: 首屏 < 3s（LCP < 3000ms）
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'first-contentful-paint':   ['error', { maxNumericValue: 1800 }],
        // A1: 总阻塞时间 < 200ms
        'total-blocking-time':      ['warn',  { maxNumericValue: 200 }],
        // A4 资源懒加载（脚本执行 < 1.5s，避免阻塞主线程太久）
        'mainthread-work-breakdown': ['warn', { maxNumericValue: 1500 }],
        // 最佳实践
        'uses-text-compression':    ['warn', {}],
        'uses-responsive-images':   ['warn', {}],
        'unused-javascript':        ['warn', { maxNumericValue: 50 }]  // KB
      }
    },
    upload: {
      target: 'temporary-public-storage'
    }
  }
};
