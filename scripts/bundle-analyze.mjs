// scripts/bundle-analyze.mjs (v1 — isFirst 无 main.pck)
// 用途: M3.10 包体分析,总包 ≤ 12MB,首屏 chunk ≤ 4MB
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUILD_DIR  = process.argv[2] || './build/web';
const TOTAL_MAX  = 12 * 1024;   // KB
const FIRST_MAX  = 4  * 1024;   // KB
const BIG_FILE   = 200;         // KB,单文件超此值报警

const EXTS = ['.pck', '.wasm', '.js', '.html', '.css', '.png', '.jpg', '.webp', '.json'];

// ===== firstChunk 计入规则 (v1) =====
function isFirstChunkFile(rel) {
  if (rel.endsWith('index.html')) return true;
  if (rel.includes('/center/') || rel.includes('\\center\\')) return true;
  if (rel.includes('critical')) return true;
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

async function analyze() {
  const files = await walk(BUILD_DIR);
  const rows = [];
  let total = 0, totalGz = 0;
  let firstChunk = 0;

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
  }
  rows.sort((a, b) => b.raw - a.raw);

  const report = {
    buildDir: BUILD_DIR,
    totalRawKB: +(total / 1024).toFixed(1),
    totalGzKB: +(totalGz / 1024).toFixed(1),
    firstChunkKB: +(firstChunk / 1024).toFixed(1),
    passes: { total: total / 1024 < TOTAL_MAX, first: firstChunk / 1024 < FIRST_MAX },
    bigFiles: rows.filter(r => r.raw / 1024 > BIG_FILE).map(r => r.rel),
    firstChunkRule: 'isFirst: center/ | critical | index.html | wildwood.js',
    files: rows.slice(0, 50),
  };

  console.log('==== M3.10 Bundle Report ====');
  console.log('总包:', fmtKB(total), '(gz:', fmtKB(totalGz), ')/ 上限', TOTAL_MAX, 'KB →', report.passes.total ? '✓' : '✗');
  console.log('首屏 chunk:', fmtKB(firstChunk), '/ 上限', FIRST_MAX, 'KB →', report.passes.first ? '✓' : '✗');

  await writeFile('./bundle-report.json', JSON.stringify(report, null, 2));

  if (!report.passes.total || !report.passes.first) {
    console.error('\n✗ 包体超限,PR 阻断');
    process.exit(1);
  }
}

analyze().catch(err => { console.error(err); process.exit(2); });
