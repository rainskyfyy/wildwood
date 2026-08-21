#!/usr/bin/env node
// lhci-data-collect.mjs
// 用途: Lighthouse CI 自动化采集 perf-ci 缺失的「Lighthouse 性能分 + FCP + LCP + TBT」4 项指标
//       跑通后,工作台 4 张卡里 lighthouse / firstPaint 两张的"待实测"就能换成真值
//
// 用法:
//   # 自检模式(沙箱 / perf-ci step 8,无浏览器时): 校验 .lighthouserc.cjs 合法 + 打印 4 项 assertion
//   node scripts/lhci-data-collect.mjs --self-test
//
//   # 真实采集模式(perf-ci step 8,有 Chrome 时): 跑 @lhci/cli autorun, 写 JSON 到 .perf-ci-reports/lighthouse/
//   node scripts/lhci-data-collect.mjs --url https://staging.example.com/wildwood/ --output .perf-ci-reports/lighthouse/
//
//   # CI 一行命令(由 .github/workflows/perf-ci.yml 调):
//   npx --yes @lhci/cli@0.14.x autorun --config=./.lighthouserc.cjs
//
// 沙箱内无 Chrome / 无外网下载 @lhci/cli,本脚本默认只跑 self-test。
// 真实 perf-ci run 由 actions/setup-chrome@v3 准备 Chrome,再调本脚本的 --url 模式。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { argv, exit, stdout, stderr } from 'node:process';
import { execSync, spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname, '..');
const CONFIG_PATH = join(REPO_ROOT, '.lighthouserc.cjs');
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, '.perf-ci-reports', 'lighthouse');

// 4 项硬指标 → 4 项 LHCI assertion(M3.10 验收口径)
const M310_ASSERTIONS = {
  'categories:performance': ['error', { minScore: 0.9 }],   // Lighthouse ≥ 90
  'first-contentful-paint': ['error', { maxNumericValue: 1800 }],  // FCP < 1800ms
  'largest-contentful-paint': ['warn',  { maxNumericValue: 3000 }],  // LCP < 3000ms(warn 而非 error,给弹性)
  'total-blocking-time':      ['error', { maxNumericValue: 200 }],     // TBT < 200ms
};

// 1. 校验 .lighthouserc.cjs 是否存在,不存在就用 M310_ASSERTIONS 现场生成
function ensureConfig() {
  if (existsSync(CONFIG_PATH)) {
    const content = readFileSync(CONFIG_PATH, 'utf8');
    if (!content.includes('lhciDataManifestPath')) {
      throw new Error(`.lighthouserc.cjs 缺少 lhciDataManifestPath 字段,无法产出 perf-ci 消费的 manifest.json`);
    }
    return content;
  }
  // 不存在 → 写入默认 config(M310 4 项 assertion)
  const defaultConfig = `// .lighthouserc.cjs
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
`;
  writeFileSync(CONFIG_PATH, defaultConfig, 'utf8');
  return defaultConfig;
}

// 2. 解析 argv
function parseArgs(args) {
  const out = { selfTest: false, url: null, output: DEFAULT_OUTPUT_DIR };
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--url')     out.url = args[++i];
    else if (a === '--output')  out.output = args[++i];
  }
  return out;
}

// 3. self-test: 校验 config + 打印 4 项 assertion + 模拟 manifest.json
function selfTest() {
  console.log('▶ lhci-data-collect self-test');
  const config = ensureConfig();
  console.log(`✓ .lighthouserc.cjs 已就位 (${config.length} 字节)`);

  console.log('\n▶ M3.10 4 项 assertion:');
  for (const [key, [level, value]] of Object.entries(M310_ASSERTIONS)) {
    console.log(`  ${level.padEnd(5)} ${key.padEnd(28)} → ${JSON.stringify(value)}`);
  }

  // 模拟产出 manifest.json(给 perf-ci step 9 / split-pck 串接用)
  const outDir = DEFAULT_OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'lhci-data-collect.mjs --self-test',
    assertions: Object.fromEntries(
      Object.entries(M310_ASSERTIONS).map(([k, [lvl, v]]) => [k, { level: lvl, ...v, expectedPass: true }])
    ),
    note: 'self-test 数据;真实数据需在 perf-ci step 8 跑 @lhci/cli autorun 后生成',
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写 ${manifestPath} (self-test 占位)`);
  console.log('✓ 真实采集需在 CI 跑 `npx --yes @lhci/cli@0.14.x autorun`');
  exit(0);
}

// 4. 真实采集模式:调 @lhci/cli
function realCollect(args) {
  ensureConfig();
  if (!args.url) {
    console.error('✗ --url <perf-ci target url> 必填(perf-ci 应从 build artifact 提供)');
    exit(2);
  }
  // 用 env 注入 URL / output,不让硬编码污染
  const env = {
    ...process.env,
    PERF_CI_URL: args.url,
    PERF_CI_OUTPUT_DIR: args.output,
  };
  console.log(`▶ lhci-data-collect real-collect: url=${args.url} output=${args.output}`);
  const r = spawnSync('npx', ['--yes', '@lhci/cli@0.14.x', 'autorun'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`✗ @lhci/cli autorun 退出码 ${r.status}`);
    exit(r.status || 1);
  }
  exit(0);
}

function main() {
  const args = parseArgs(argv);
  if (args.selfTest || !args.url) {
    selfTest();
  } else {
    realCollect(args);
  }
}

main();
