// scripts/bundle-analyze.mjs (M3.10 t-code-02 适配版)
// 用途: M3.10 包体分析,总包 ≤ 12MB,首屏 chunk ≤ 4MB
//       t-code-02 适配: .pck 拆分后,main.pck 计入 firstChunk
// 变更:
//   isFirst 增加 main.pck 判定(原: center / index.html / critical)
//   firstChunk 预算从 4MB 不变,只是计数规则放宽
// 历史:
//   - 2026-08-20 v1: center / index.html / critical 三类
//   - 2026-08-20 v2: 加 main.pck(t-code-02 .pck 拆分后,首屏核心打包)

import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUILD_DIR  = process.argv[2] || './build/web';
const TOTAL_MAX  = 12 * 1024;   // KB
const FIRST_MAX  = 4  * 1024;   // KB
const BIG_FILE   = 200;         // KB,单文件超此值报警

const EXTS = ['.pck', '.wasm', '.js', '.html', '.css', '.png', '.jpg', '.webp', '.json'];

// ===== firstChunk 计入规则 (t-code-02 适配) =====
// - index.html: 首屏 HTML 自身
// - main.pck: t-code-02 拆分后的首屏核心 .pck
//   (lobby + 中心 9 宫格 neighbor + 当前群系 far,见 design/t-code-02-pck-split-design.md)
// - center 路径: M2.7 9 宫格中心 chunk 资源
// - critical 路径: t-code-05 抽离出的关键 CSS
function isFirstChunkFile(rel) {
  if (rel.endsWith('index.html')) return true;
  if (rel.endsWith('main.pck')) return true;        // ← t-code-02 新增
  if (rel.includes('/center/') || rel.includes('\\center\\')) return true;
  if (rel.includes('critical')) return true;
  // wildwood.js (Godot 引擎 runtime JS) 自身也属首屏
  if (rel.endsWith('wildwood.js')) return true;
  return false;
}

function fmtKB(b) { return (b / 1024).toFixed(1) + ' KB'; }

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else if (EXTS.includes(extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

function gzSize(buf) {
  return gzipSync(buf).length;
}

// 按 .pck 文件名归类(用于报告哪个 .pck 超预算)
function classifyPck(rel) {
  if (!rel.endsWith('.pck')) return null;
  const base = rel.split(/[\\/]/).pop();
  return base.replace('.pck', '');
}

async function analyze() {
  const files = await walk(BUILD_DIR);
  const rows = [];
  let total = 0, totalGz = 0;
  let firstChunk = 0;
  const pckBuckets = {};  // {pck_name: {raw, gz, isFirst}}

  for (const f of files) {
    const s = await stat(f);
    const buf = await readFile(f);
    const gz = gzSize(buf);
    const rel = f.replace(BUILD_DIR, '');
    const isFirst = isFirstChunkFile(rel);
    rows.push({ rel, raw: s.size, gz, isFirst });
    total += s.size;
    totalGz += gz;
    if (isFirst) firstChunk += s.size;

    const pckName = classifyPck(rel);
    if (pckName) {
      if (!pckBuckets[pckName]) pckBuckets[pckName] = { raw: 0, gz: 0, isFirst: false };
      pckBuckets[pckName].raw += s.size;
      pckBuckets[pckName].gz += gz;
      if (isFirst) pckBuckets[pckName].isFirst = true;
    }
  }
  rows.sort((a, b) => b.raw - a.raw);

  const report = {
    buildDir: BUILD_DIR,
    totalRawKB: +(total / 1024).toFixed(1),
    totalGzKB: +(totalGz / 1024).toFixed(1),
    firstChunkKB: +(firstChunk / 1024).toFixed(1),
    passes: { total: total / 1024 < TOTAL_MAX, first: firstChunk / 1024 < FIRST_MAX },
    bigFiles: rows.filter(r => r.raw / 1024 > BIG_FILE).map(r => r.rel),
    pckBreakdown: Object.entries(pckBuckets).map(([name, b]) => ({
      name,
      rawKB: +(b.raw / 1024).toFixed(1),
      gzKB: +(b.gz / 1024).toFixed(1),
      isFirst: b.isFirst,
    })).sort((a, b) => b.rawKB - a.rawKB),
    firstChunkRule: 'isFirst: main.pck | center/ | critical | index.html | wildwood.js',
    files: rows.slice(0, 50),
  };

  console.log('==== M3.10 Bundle Report (t-code-02 adapted) ====');
  console.log('总包:', fmtKB(total), '(gz:', fmtKB(totalGz), ')/ 上限', TOTAL_MAX, 'KB →', report.passes.total ? '✓' : '✗');
  console.log('首屏 chunk:', fmtKB(firstChunk), '/ 上限', FIRST_MAX, 'KB →', report.passes.first ? '✓' : '✗');
  console.log('  规则:', report.firstChunkRule);
  if (report.pckBreakdown.length) {
    console.log('\n.pck 拆分:');
    for (const p of report.pckBreakdown) {
      const tag = p.isFirst ? '[首屏]' : '[按需]';
      console.log(`  ${tag} ${p.name.padEnd(28)} ${String(p.rawKB).padStart(8)} KB (gz: ${p.gzKB} KB)`);
    }
  }
  if (report.bigFiles.length) {
    console.log('\n大文件(> ' + BIG_FILE + ' KB):');
    for (const f of report.bigFiles) console.log('  - ' + f);
  }

  await writeFile('./bundle-report.json', JSON.stringify(report, null, 2));

  if (!report.passes.total || !report.passes.first) {
    console.error('\n✗ 包体超限,PR 阻断');
    process.exit(1);
  }
}

analyze().catch(err => { console.error(err); process.exit(2); });
