#!/usr/bin/env node
// split-pck.mjs
// 用途: 沙箱内 t-code-02 .pck 拆分模拟器
//       Godot 4.3 不官方支持多 .pck 导出,本脚本是 dry-run 拆包规则验证
//       真实拆 .pck 二进制由工程团队 PR 跑通(沙箱无 Godot binary)
//
// 用法:
//   node split-pck.mjs <resource-list.json> [--current-biome forest] [--current-season spring]
//
// resource-list.json 格式:
//   [
//     { "path": "res://lobby/scene.tscn", "bytes": 1234 },
//     { "path": "res://biomes/forest/tree_1.png", "bytes": 8192 },
//     ...
//   ]
//
// 输出: 每个 .pck 桶的资源列表 + 字节统计 + main.pck 体积估算

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit, stdout, stderr } from 'node:process';

// ===== 拆包规则 (与 design/t-code-02-pck-split-design.md §3 对齐) =====
function classifyResource(resourcePath, currentBiome, currentSeason) {
  const p = resourcePath.replace(/^res:\/\//, '');

  // 1. lobby → main.pck (lobby 永远首屏)
  if (p.startsWith('lobby/') || p.startsWith('ui/lobby/')) {
    return { bucket: 'main.pck', reason: 'lobby 永远首屏' };
  }

  // 2. center 9 宫格 neighbor → main.pck
  if (p.startsWith('center/') || p.includes('/center/')) {
    return { bucket: 'main.pck', reason: '中心 9 宫格常驻' };
  }

  // 3. 当前群系 far → main.pck (玩家能看到)
  //    其它群系 → biome_<name>.pck
  if (p.startsWith('biomes/')) {
    const biomeName = p.split('/')[1];
    if (biomeName === currentBiome) {
      return { bucket: 'main.pck', reason: `当前群系 ${currentBiome} 可见` };
    }
    return { bucket: `biome_${biomeName}.pck`, reason: `非当前群系,按需加载` };
  }

  // 4. 季节: 当前季节 → main.pck,其它 → season_<name>.pck
  if (p.startsWith('seasons/')) {
    const seasonName = p.split('/')[1];
    if (seasonName === currentSeason) {
      return { bucket: 'main.pck', reason: `当前季节 ${currentSeason} 可见` };
    }
    return { bucket: `season_${seasonName}.pck`, reason: `非当前季节,按需加载` };
  }

  // 5. 其它 (脚本/场景/共享资源) → main.pck
  //    理由: 共享代码和场景通常 < 1MB,放 main.pck 简化加载
  return { bucket: 'main.pck', reason: '默认共享资源' };
}


function main() {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    stderr.write(
      `Usage: split-pck.mjs <resource-list.json> [--current-biome NAME] [--current-season NAME]

Default: --current-biome forest --current-season spring
Output: bucket breakdown with byte totals + main.pck size check
`);
    exit(args.length === 0 ? 1 : 0);
  }

  const inputPath = resolve(args[0]);
  const resources = JSON.parse(readFileSync(inputPath, 'utf8'));

  let currentBiome = 'forest';
  let currentSeason = 'spring';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--current-biome') currentBiome = args[++i];
    else if (args[i] === '--current-season') currentSeason = args[++i];
  }

  // 按 bucket 分类
  const buckets = {};
  for (const r of resources) {
    const { bucket, reason } = classifyResource(r.path, currentBiome, currentSeason);
    if (!buckets[bucket]) buckets[bucket] = { resources: [], totalBytes: 0, reasons: new Set() };
    buckets[bucket].resources.push({ path: r.path, bytes: r.bytes, reason });
    buckets[bucket].totalBytes += r.bytes;
    buckets[bucket].reasons.add(reason);
  }

  // 排序输出
  const sorted = Object.entries(buckets).sort((a, b) => b[1].totalBytes - a[1].totalBytes);

  stdout.write(`==== t-code-02 .pck Split (current: biome=${currentBiome}, season=${currentSeason}) ====\n\n`);
  let mainPckBytes = 0;
  const MAIN_PCK_BUDGET = 4 * 1024 * 1024;  // 4MB

  for (const [name, info] of sorted) {
    const isMain = name === 'main.pck';
    if (isMain) mainPckBytes = info.totalBytes;
    const tag = isMain ? '[首屏]' : '[按需]';
    const reasonsStr = Array.from(info.reasons).join(', ');
    stdout.write(`${tag} ${name.padEnd(28)} ${(info.totalBytes / 1024).toFixed(1).padStart(8)} KB (${info.resources.length} resources, 原因: ${reasonsStr})\n`);
  }

  stdout.write(`\nmain.pck 体积: ${(mainPckBytes / 1024).toFixed(1)} KB / 预算 ${MAIN_PCK_BUDGET / 1024} KB (4MB)\n`);
  if (mainPckBytes < MAIN_PCK_BUDGET) {
    stdout.write(`✓ main.pck < 4MB (t-code-02 验收)\n`);
  } else {
    stdout.write(`✗ main.pck 超 4MB (差距: +${((mainPckBytes - MAIN_PCK_BUDGET) / 1024).toFixed(1)} KB)\n`);
    exit(1);
  }

  // 总体积
  const totalBytes = Object.values(buckets).reduce((s, b) => s + b.totalBytes, 0);
  stdout.write(`\n总 .pck 体积: ${(totalBytes / 1024).toFixed(1)} KB / 预算 ${(12 * 1024).toFixed(0)} KB (12MB 总包)\n`);

  // 写出 main.pck 资源列表 (供 Godot PostExportFeature 真正拆 .pck 时读)
  if (buckets['main.pck']) {
    const mainList = buckets['main.pck'].resources.map(r => r.path);
    stdout.write(`\nmain.pck 资源数: ${mainList.length} (供 Godot 端读此列表拆 .pck)\n`);
  }
}

main();
