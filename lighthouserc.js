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
        'categories:performance': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'first-contentful-paint':   ['error', { maxNumericValue: 1800 }],
        'total-blocking-time':      ['warn',  { maxNumericValue: 200 }],
        'mainthread-work-breakdown': ['warn', { maxNumericValue: 1500 }],
        'uses-text-compression':    ['warn', {}],
        'uses-responsive-images':   ['warn', {}],
        'unused-javascript':        ['warn', { maxNumericValue: 50 }]
      }
    },
    upload: {
      target: 'temporary-public-storage'
    }
  }
};
