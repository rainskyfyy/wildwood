#!/usr/bin/env node
// first-paint-collect.mjs
// 用途: perf-ci step 9 用 puppeteer-core + 系统 Chrome 采首屏时间 (FCP / LCP / TBT / TTFB)
//       用于工作台 firstPaint 卡的"实测"填值 (M3.10 验收:首屏 ≤ 3s)
//
// 用法:
//   # 自检模式(沙箱 / perf-ci step 9,无 Chrome 时): 校验 puppeteer-core 可解析,打印 4 项指标 schema
//   node scripts/first-paint-collect.mjs --self-test
//
//   # 真实采集模式(perf-ci step 9,setup-chrome 之后): 启 Chrome,导航到 URL,采 4 项指标
//   node scripts/first-paint-collect.mjs --url https://staging.example.com/wildwood/ --output .perf-ci-reports/first-paint/
//
//   # CI 一行命令(由 .github/workflows/perf-ci.yml 调):
//   node scripts/first-paint-collect.mjs --url "$PERF_CI_URL" --output .perf-ci-reports/first-paint/
//
// 沙箱内无 Chrome binary,本脚本默认只跑 self-test,真实采集在 CI 由 actions/setup-chrome 提供。

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argv, exit, stdout, stderr } from 'node:process';
import { execSync, spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname, '..');
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, '.perf-ci-reports', 'first-paint');

// M3.10 4 项首屏指标 schema
const M310_METRICS = [
  { id: 'fcp',  name: 'First Contentful Paint',   unit: 'ms', target: 1800,  budget: 3000, weight: 'high' },
  { id: 'lcp',  name: 'Largest Contentful Paint',  unit: 'ms', target: 2500,  budget: 3000, weight: 'high' },
  { id: 'tbt',  name: 'Total Blocking Time',       unit: 'ms', target: 200,   budget: 600,  weight: 'high' },
  { id: 'ttfb', name: 'Time To First Byte',        unit: 'ms', target: 800,   budget: 1800, weight: 'mid'  },
];

// 1. 校验 puppeteer-core 是否可用(不强制 require,只在 real mode 引入)
function tryLoadPuppeteer() {
  try {
    // 用 createRequire 兼容 ESM
    const { createRequire } = require('node:module');
    const req = createRequire(import.meta.url);
    return req('puppeteer-core');
  } catch (e) {
    return null;
  }
}

// 2. 找系统 Chrome 路径
function findChrome() {
  const candidates = process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/opt/google/chrome/chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
  for (const p of candidates) {
    try {
      const r = spawnSync(p, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return p;
    } catch { /* keep scanning */ }
  }
  return null;
}

// 3. 解析 argv
function parseArgs(args) {
  const out = { selfTest: false, url: null, output: DEFAULT_OUTPUT_DIR, runs: 3 };
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--url')     out.url = args[++i];
    else if (a === '--output')  out.output = args[++i];
    else if (a === '--runs')    out.runs = parseInt(args[++i], 10);
  }
  return out;
}

// 4. self-test: 打印 4 项指标 schema + 模拟 manifest.json
function selfTest() {
  console.log('▶ first-paint-collect self-test');
  const puppeteer = tryLoadPuppeteer();
  console.log(puppeteer ? '✓ puppeteer-core 已装' : '::warning::puppeteer-core 未装;real mode 需 `npm i -D puppeteer-core`');

  const chrome = findChrome();
  console.log(chrome ? `✓ Chrome 路径: ${chrome}` : '::warning::系统未找到 Chrome;real mode 需 `actions/setup-chrome@v3`');

  console.log('\n▶ M3.10 4 项首屏指标:');
  console.log('  id    | name                          | target | budget | weight');
  console.log('  ------+-------------------------------+--------+--------+--------');
  for (const m of M310_METRICS) {
    console.log(`  ${m.id.padEnd(5)} | ${m.name.padEnd(29)} | ${String(m.target).padStart(6)} | ${String(m.budget).padStart(6)} | ${m.weight}`);
  }

  // 模拟产出 manifest.json
  const outDir = DEFAULT_OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'first-paint-collect.mjs --self-test',
    runs: 0,
    metrics: M310_METRICS,
    samples: [],
    summary: { fcp: null, lcp: null, tbt: null, ttfb: null, status: 'self-test (no real chrome run)' },
    note: 'self-test 数据;真实数据需在 perf-ci step 9 跑 puppeteer-core + setup-chrome 后生成',
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写 ${manifestPath} (self-test 占位)`);
  console.log('✓ 真实采集需在 CI 跑 `actions/setup-chrome@v3` 后调 `node scripts/first-paint-collect.mjs --url $URL`');
  exit(0);
}

// 5. 真实采集模式:启 puppeteer-core,采 4 项指标
async function realCollect(args) {
  if (!args.url) {
    console.error('✗ --url <perf-ci target url> 必填(perf-ci 应从 build artifact 提供)');
    exit(2);
  }
  const puppeteer = tryLoadPuppeteer();
  if (!puppeteer) {
    console.error('✗ puppeteer-core 未装;real mode 需 `npm i -D puppeteer-core` 后再跑');
    exit(3);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error('✗ 系统未找到 Chrome;perf-ci step 9 需先 `actions/setup-chrome@v3`');
    exit(4);
  }
  console.log(`▶ first-paint-collect real-collect: url=${args.url} runs=${args.runs} chrome=${chrome}`);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const samples = [];
  try {
    for (let r = 0; r < args.runs; r++) {
      const page = await browser.newPage();
      const t0 = Date.now();
      const client = await page.target().createCDPSession();
      await client.send('Performance.enable');
      await page.goto(args.url, { waitUntil: 'networkidle0', timeout: 30000 });
      // 等 1.5s 让 LCP 稳定(标准做法)
      await new Promise(rs => setTimeout(rs, 1500));
      const perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paint = performance.getEntriesByType('paint');
        const lcp = performance.getEntriesByType('largest-contentful-paint').slice(-1)[0];
        return {
          ttfb: nav ? nav.responseStart - nav.requestStart : null,
          fcp:  paint.find(p => p.name === 'first-contentful-paint')?.startTime || null,
          lcp:  lcp ? lcp.startTime : null,
        };
      });
      // TBT 需要 longtask 数据,粗算 >50ms 部分
      const tbt = await page.evaluate(() => {
        const tasks = performance.getEntriesByType('longtask') || [];
        return tasks.reduce((acc, t) => acc + Math.max(0, t.duration - 50), 0);
      });
      const elapsed = Date.now() - t0;
      const sample = {
        run: r + 1,
        elapsedMs: elapsed,
        fcp:  Math.round(perf.fcp  || 0),
        lcp:  Math.round(perf.lcp  || 0),
        ttfb: Math.round(perf.ttfb || 0),
        tbt:  Math.round(tbt),
      };
      samples.push(sample);
      console.log(`  run ${r + 1}/${args.runs}: ${JSON.stringify(sample)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // 算中位数(p50),M3.10 验收用 p50 而非 mean
  const median = (arr) => {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const summary = {
    fcp:  median(samples.map(s => s.fcp)),
    lcp:  median(samples.map(s => s.lcp)),
    tbt:  median(samples.map(s => s.tbt)),
    ttfb: median(samples.map(s => s.ttfb)),
    status: 'real-collect',
  };

  const outDir = args.output;
  mkdirSync(outDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: `first-paint-collect.mjs url=${args.url} runs=${args.runs}`,
    runs: args.runs,
    metrics: M310_METRICS,
    samples,
    summary,
    // 4 项是否过预算(M3.10:首屏 ≤ 3s → fcp < 3000)
    pass: {
      fcp:  summary.fcp  !== null && summary.fcp  < M310_METRICS[0].budget,
      lcp:  summary.lcp  !== null && summary.lcp  < M310_METRICS[1].budget,
      tbt:  summary.tbt  !== null && summary.tbt  < M310_METRICS[2].budget,
      ttfb: summary.ttfb !== null && summary.ttfb < M310_METRICS[3].budget,
    },
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写 ${manifestPath}`);
  console.log(`  summary: ${JSON.stringify(summary)}`);

  // exit code: 任一不通过就 fail
  const allPass = Object.values(manifest.pass).every(Boolean);
  exit(allPass ? 0 : 1);
}

function main() {
  const args = parseArgs(argv);
  if (args.selfTest || !args.url) {
    selfTest();
  } else {
    realCollect(args).catch(e => { console.error(e); exit(99); });
  }
}

main();
