// .lighthouserc.cjs
// LHCI 配置文件,M3.10 4 项硬指标 assertion 落点
// 由 scripts/lhci-data-collect.mjs --self-test 现场生成
module.exports = {
  ci: {
    collect: {
      url: process.env.PERF_CI_URL || 'http://localhost:8080/',
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless=new',
        onlyCategories: ['performance'],
        emulatedFormFactor: 'desktop',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 3000 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: process.env.PERF_CI_OUTPUT_DIR || '.perf-ci-reports/lighthouse/',
    },
  },
  // 1=展示用 lhciData 写入
  // 2=用于 perf-ci 跨 step 取数(.perf-ci-reports/lighthouse/manifest.json)
};
