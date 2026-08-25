#!/usr/bin/env node
/**
 * check-ui-tokens.mjs — Wildwood UI 设计 Token 一致性检查。
 *
 * v0.8.18-P1 批量:校验本轮视觉修复是否符合 tokens.css 规范:
 *   - 0/2px 圆角(tokens: --r-0 / --r-2),禁用 4px/6px 软圆角;
 *   - 2px 硬阴影(tokens: --shadow-2),禁用 8px 软阴影;
 *   - 关闭按钮统一为 DOM .Dialog-Close ×(P1-13);
 *   - 菜单版本号来自 src/version.js(动态),不再硬编码 v0.4(P1-12);
 *   - canvas HUD 已冻结 + @deprecated + 警告日志(P1-11)。
 *
 * 用法: node tools/check-ui-tokens.mjs
 * 退出码: 0 = 全部通过; 1 = 存在违规(列出条目)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let violations = [];
let checkCount = 0;
const ok = (msg) => { checkCount++; console.log(`  ✓ ${msg}`); };
const bad = (msg) => violations.push(msg);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------- P1-11: canvas HUD 冻结 ----------
console.log('[P1-11] canvas HUD frozen');
{
  const hud = read('src/hud/hud.js');
  if (hud.includes('@deprecated')) ok('src/hud/hud.js 带 @deprecated 标记');
  else bad('P1-11: src/hud/hud.js 缺少 @deprecated 标记');
  if (/console\.warn\(['"].*DEPRECATED/i.test(hud)) ok('src/hud/hud.js 含 DEPRECATED 警告日志');
  else bad('P1-11: src/hud/hud.js 缺少 console.warn DEPRECATED 警告');
}

// ---------- P1-12: menu.js token 对齐 + 动态版本 ----------
console.log('[P1-12] net menu tokens + version');
{
  const menu = read('src/net/menu.js');
  if (menu.includes("from '../version.js'")) ok('menu.js 引用 src/version.js');
  else bad('P1-12: menu.js 未 import src/version.js');
  if (menu.includes('VERSION_PREFIX') && menu.includes('VERSION')) ok('menu.js 使用动态版本号');
  else bad('P1-12: menu.js 未使用动态版本号');
  if (/border-radius:\s*4px/.test(menu)) bad('P1-12: menu.js 仍含 4px 圆角');
  else ok('menu.js 无 4px 圆角');
  if (/border-radius:\s*6px/.test(menu)) bad('P1-12: menu.js 仍含 6px 圆角');
  else ok('menu.js 无 6px 圆角');
  if (/box-shadow:\s*0\s+8px/.test(menu)) bad('P1-12: menu.js 仍含 8px 软阴影');
  else ok('menu.js 无 8px 软阴影');
  if (menu.includes("Wildwood · v0.4") || menu.includes("'Wildwood · v0.4'")) bad('P1-12: menu.js 仍硬编码 v0.4');
  else ok('menu.js 无硬编码 v0.4');
}

// ---------- P1-13: 关闭按钮统一 .Dialog-Close ----------
console.log('[P1-13] unified close button');
{
  const trade = read('src/trading/trade-ui.js');
  if (trade.includes('Dialog-Close')) ok('trade-ui.js 使用 .Dialog-Close 组件');
  else bad('P1-13: trade-ui.js 未使用 .Dialog-Close 组件');
  if (/\.trade-close\s*\{/.test(trade)) bad('P1-13: trade-ui.js 仍残留自绘 .trade-close 样式');
  else ok('trade-ui.js 已移除自绘 .trade-close');
  // DOM 版各面板关闭按钮应统一 .Dialog-Close
  for (const [rel, label] of [
    ['src/ui/screens/screens.js', 'screens.js'],
    ['src/ui/cooking/cooking.js', 'cooking.js'],
    ['src/ui/codex/codex.js', 'codex.js'],
    ['src/ui/npc/npc.js', 'npc.js'],
  ]) {
    const c = read(rel);
    if (c.includes('Dialog-Close')) ok(`${label} 使用 .Dialog-Close`);
    else bad(`P1-13: ${label} 未使用 .Dialog-Close`);
  }
}

// ---------- P1-14: craft 按钮 disabled 语义 ----------
console.log('[P1-14] craft button disabled semantics');
{
  const screens = read('src/ui/screens/screens.js');
  if (/canCraft/.test(screens) && /setAttribute\('disabled'/.test(screens))
    ok('screens.js DOM 合成按钮实现 canCraft + disabled');
  else bad('P1-14: screens.js 合成按钮缺 canCraft/disabled 语义');
  if (screens.includes("canCraft ? '合成' : '材料不足'"))
    ok('screens.js 合成按钮文案:可用“合成”/不足“材料不足”');
  else bad('P1-14: screens.js 合成按钮文案不一致');
  const canvas = read('src/hud/crafting-panel.js');
  if (canvas.includes("can ? '合成' : '材料不足'"))
    ok('canvas crafting-panel 文案与 DOM 一致');
  else bad('P1-14: canvas crafting-panel 文案与 DOM 不一致');
}

// ---------- 版本号来源 ----------
console.log('[version] src/version.js');
{
  const v = read('src/version.js');
  if (/export const VERSION = '0\.8\.18'/.test(v)) ok('src/version.js 导出 VERSION=0.8.18');
  else bad('version: src/version.js 未导出 0.8.18');
}

// ---------- 汇总 ----------
console.log('\n====================================');
if (violations.length === 0) {
  console.log(`RESULT: PASS (${checkCount} 项检查全部通过)`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL — ${violations.length} 项违规:`);
  for (const v of violations) console.log(`  ✗ ${v}`);
  process.exit(1);
}
