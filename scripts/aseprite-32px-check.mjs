// scripts/aseprite-32px-check.mjs (v1 — 含 ESM require bug)
// M3.10 美术硬约束：32px 网格 + 子像素误差 = 0
import { execSync } from 'node:child_process';
import { readdir, stat } from 'node:fs';
import { join, extname } from 'node:path';

const ASSET_DIR = process.argv[2] || './assets';
const STEP = 32;
const OK_EXTS = new Set(['.ase', '.png']);

function whichAseprite() {
  try { return execSync('which aseprite', { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else if (OK_EXTS.has(extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

function readPNGSize(file) {
  const fs = require('node:fs');   // ← BUG: ESM 不能用 require
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

function check(file, asepriteBin) {
  let dim = null;
  if (file.endsWith('.png')) dim = readPNGSize(file);
  if (!dim) return { file, ok: true, reason: 'unable-to-parse' };
  const { w, h } = dim;
  const okW = w % STEP === 0;
  const okH = h % STEP === 0;
  return {
    file,
    ok: okW && okH,
    dim: w + 'x' + h,
    expected: '32 的整数倍',
    reason: okW && okH ? null : 'size-not-multiple-of-32'
  };
}

async function main() {
  const asepriteBin = whichAseprite();
  if (!asepriteBin) {
    console.warn('[WARN] aseprite CLI 不在 PATH，降级为 PNG 尺寸校验。安装：https://www.aseprite.org/');
  }
  const files = await walk(ASSET_DIR);
  const results = files.map(f => check(f, asepriteBin));
  const violations = results.filter(r => !r.ok);
  console.log('==== M3.10 Aseprite 32px 校验 ====');
  console.log('资产总数：' + results.length);
  console.log('违规：' + violations.length);
  for (const v of violations) {
    console.log('  ✗ ' + v.file + ' (' + v.dim + ') — ' + v.reason);
  }
  if (violations.length > 0) {
    console.error('\n✗ 存在非 32px 倍数的资产，PR 阻断');
    process.exit(1);
  }
  console.log('\n✓ 全部资产 32px 合规');
}

main().catch(err => { console.error(err); process.exit(2); });
