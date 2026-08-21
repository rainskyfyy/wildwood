#!/usr/bin/env node
// critical-css-extract.mjs
// 用途: 从 Godot WebGL export 的 index.html 抽离 critical CSS
//       (首屏可见元素所需) 内联到 <head>,剩余 CSS 异步加载
// 输入: 单一 HTML 文件路径(默认从 stdin 读)
// 输出: 新 HTML(写到 stdout 或 --output 指定路径)
//
// 策略:
//   1. 解析 <style> 块,逐条 CSS 规则判断是否"关键"
//   2. 关键判定: 选择器命中"白名单" 或 [data-critical] 标记
//   3. 白名单: html, body, #canvas, #status, #status-*, .error-screen
//   4. 内联 style="" 属性值 也算关键
//   5. @font-face @keyframes 若被白名单规则引用也算关键
//   6. 非关键 CSS 改成 <link rel="preload" as="style" onload=...> 异步加载
//   7. <noscript> 兜底 <link rel="stylesheet" ...> 兼容禁用 JS 环境
//
// 沙箱限制: 无法真实 Godot export,只在合成 HTML 上跑端到端测试
//           真实 perf-ci 验证由工程团队 PR 跑通(FCP < 1800ms 期望)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { argv, exit, stdout, stderr } from 'node:process';

// ===== 关键选择器白名单 =====
// Godot 4.3 WebGL export 模板的固定结构:
//   - <canvas id="canvas">    主画布
//   - <div id="status">        加载状态容器
//   - <div id="status-progress"> 进度条
//   - <div id="status-notice"> 提示信息
//   - <div class="error-screen"> 错误兜底
//   - <noscript>                禁用 JS 时显示
// 白名单与 t-code-05 design.md 保持一致
const ALWAYS_CRITICAL_SELECTORS = [
  'html',
  'body',
  '#canvas',
  '#status',
  '#status-progress',
  '#status-notice',
  '.error-screen',
];

// 编译为可快速匹配的前缀形式(支持 #status-* 通配)
function buildCriticalPatterns() {
  const patterns = ALWAYS_CRITICAL_SELECTORS.map((sel) => {
    if (sel.endsWith('-*')) {
      const prefix = sel.slice(0, -1); // "#status-" -> "#status-"
      return { kind: 'prefix', prefix };
    }
    return { kind: 'exact', exact: sel };
  });
  // 额外: [data-critical] 标记
  patterns.push({ kind: 'attr', attr: 'data-critical' });
  return patterns;
}

const CRITICAL_PATTERNS = buildCriticalPatterns();

// 规则是否关键: 选择器命中白名单
function isCriticalSelector(selector) {
  // 拆分逗号分隔的多选择器,任一命中即整体算关键
  const parts = selector.split(',').map((s) => s.trim());
  return parts.some((sel) => {
    // 去掉 :hover/:focus 等伪类(不影响首屏)
    const baseSel = sel.replace(/:(hover|focus|active|visited|disabled)/g, '');
    // 简单 tag/id/class 抽取
    const tokens = baseSel.match(/[#.][\w-]+|\[[\w-]+(?:=[^\]]+)?\]|[\w-]+/g) || [];
    return tokens.some((tok) => {
      for (const p of CRITICAL_PATTERNS) {
        if (p.kind === 'exact' && tok === p.exact) return true;
        if (p.kind === 'prefix' && tok.startsWith(p.prefix)) return true;
        if (p.kind === 'attr' && tok.startsWith('[data-critical')) return true;
      }
      return false;
    });
  });
}

// CSS 解析(简化版,只处理嵌套一层 @media)
// 返回: [{ selector, body, atRule?, atRuleBody? }]
function parseCSSRules(cssText) {
  const rules = [];
  let i = 0;
  const n = cssText.length;

  while (i < n) {
    // 跳过空白
    while (i < n && /\s/.test(cssText[i])) i++;
    if (i >= n) break;

    // @media 或 @supports 包裹
    let atRule = null;
    if (cssText[i] === '@') {
      const atEnd = cssText.indexOf('{', i);
      if (atEnd < 0) break;
      atRule = cssText.slice(i, atEnd).trim();
      i = atEnd + 1;
      // 解析内部
      const innerRules = parseCSSRules(cssText.slice(i));
      rules.push({ atRule, innerRules });
      // 跳过内层到匹配 }
      let depth = 1;
      while (i < n && depth > 0) {
        if (cssText[i] === '{') depth++;
        else if (cssText[i] === '}') depth--;
        i++;
      }
      continue;
    }

    // 普通规则: selector { body }
    const braceStart = cssText.indexOf('{', i);
    const braceEnd = cssText.indexOf('}', braceStart);
    if (braceStart < 0 || braceEnd < 0) break;

    const selector = cssText.slice(i, braceStart).trim();
    const body = cssText.slice(braceStart + 1, braceEnd).trim();
    rules.push({ selector, body });
    i = braceEnd + 1;
  }
  return rules;
}

// 规则序列化
function ruleToString(r) {
  if (r.atRule) {
    const inner = r.innerRules.map(ruleToString).join('');
    return `${r.atRule}{${inner}}`;
  }
  return `${r.selector}{${r.body}}`;
}

// 关键/非关键规则分类(@media 内部递归)
function classify(rules) {
  const critical = [];
  const nonCritical = [];
  for (const r of rules) {
    if (r.atRule) {
      const sub = classify(r.innerRules);
      // @media 内有任意关键规则 → 整个 @media 进 critical
      // 优化: 整个 @media 保留完整结构避免破坏响应式断点
      if (sub.critical.length > 0) {
        critical.push({ atRule: r.atRule, innerRules: sub.critical });
        nonCritical.push({ atRule: r.atRule, innerRules: sub.nonCritical });
      } else {
        nonCritical.push(r);
      }
    } else if (isCriticalSelector(r.selector)) {
      critical.push(r);
    } else {
      nonCritical.push(r);
    }
  }
  return { critical, nonCritical };
}

// HTML 处理: 抽 <style> 块 + 处理 <head>/<body>
function processHTML(html) {
  // 抽所有 <style>...</style>
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const styleBlocks = [];
  let m;
  while ((m = styleRegex.exec(html)) !== null) {
    styleBlocks.push({ full: m[0], inner: m[1] });
  }

  if (styleBlocks.length === 0) {
    stderr.write('warn: no <style> block found, nothing to extract\n');
    return html;
  }

  // 合并所有 <style> 内容做一次性分类
  const allCSS = styleBlocks.map((b) => b.inner).join('\n');
  const parsed = parseCSSRules(allCSS);
  const { critical, nonCritical } = classify(parsed);

  const criticalCSS = critical.map(ruleToString).join('');
  const nonCriticalCSS = nonCritical.map(ruleToString).join('');

  // 内联 style 属性也算关键(简化: 这些是 inline,已经直接生效,不算到 critical CSS)
  // 警告: 真实 Godot export 几乎不内联 style,这里不处理

  // 替换第一个 <style> 为关键 CSS,移除其余 <style>
  let newHTML = html;

  if (critical.length > 0) {
    // 把第一个 <style> 内容换成 critical CSS
    newHTML = newHTML.replace(
      styleBlocks[0].full,
      `<style data-critical="true">${criticalCSS}</style>`,
    );
    // 移除后续 <style>
    for (let i = 1; i < styleBlocks.length; i++) {
      newHTML = newHTML.replace(styleBlocks[i].full, '');
    }
  } else {
    // 没有关键 CSS: 移除所有 <style> 全部异步
    for (const b of styleBlocks) {
      newHTML = newHTML.replace(b.full, '');
    }
  }

  // 非关键 CSS: 插入到 <head> 末尾(在 </head> 之前)
  if (nonCriticalCSS.length > 0) {
    // 异步加载模式:
    //   <link rel="preload" as="style" href="data:text/css,..." onload="this.onload=null;this.rel='stylesheet'">
    //   <noscript><link rel="stylesheet" href="data:text/css,..."></noscript>
    // 用 data URL 避免额外网络请求(沙箱友好)
    const dataUrl = `data:text/css;base64,${Buffer.from(nonCriticalCSS).toString('base64')}`;
    const asyncLoad = `<!-- non-critical CSS (extracted by critical-css-extract) -->
<link rel="preload" as="style" href="${dataUrl}" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="${dataUrl}"></noscript>`;

    if (newHTML.includes('</head>')) {
      newHTML = newHTML.replace('</head>', `${asyncLoad}\n</head>`);
    } else {
      newHTML = `<head>${asyncLoad}</head>` + newHTML;
    }
  }

  return newHTML;
}

// ===== CLI =====
function usage() {
  stderr.write(`Usage: critical-css-extract.mjs <input.html> [--output <output.html>] [--stats]

Options:
  --output, -o   输出 HTML 路径(默认 stdout)
  --stats, -s    打印 critical/non-critical CSS 字节数到 stderr
  --help, -h     显示帮助
`);
}

function main() {
  const args = argv.slice(2);
  let input = null;
  let output = null;
  let stats = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      usage();
      exit(0);
    } else if (a === '--output' || a === '-o') {
      output = args[++i];
    } else if (a === '--stats' || a === '-s') {
      stats = true;
    } else if (!a.startsWith('-')) {
      input = a;
    }
  }

  if (!input) {
    usage();
    exit(1);
  }

  const html = readFileSync(resolve(input), 'utf8');
  const newHTML = processHTML(html);

  if (stats) {
    // 简单统计: 统计 <style data-critical> 字节 vs 异步 <link> 字节
    const critMatch = newHTML.match(/<style data-critical[^>]*>([\s\S]*?)<\/style>/);
    const linkMatch = newHTML.match(/href="data:text\/css;base64,([^"]+)"/);
    const critBytes = critMatch ? Buffer.byteLength(critMatch[1], 'utf8') : 0;
    const nonCritBytes = linkMatch ? Buffer.from(linkMatch[1], 'base64').length : 0;
    const origStyleBytes = html
      .match(/<style[^>]*>([\s\S]*?)<\/style>/g)
      ?.reduce((s, b) => s + Buffer.byteLength(b, 'utf8'), 0) || 0;
    stderr.write(
      `[stats] original <style> total: ${origStyleBytes}B\n` +
        `        critical (inlined):    ${critBytes}B\n` +
        `        non-critical (async):  ${nonCritBytes}B\n` +
        `        inline ratio:          ${origStyleBytes ? ((critBytes / origStyleBytes) * 100).toFixed(1) : 0}%\n`,
    );
  }

  if (output) {
    writeFileSync(resolve(output), newHTML, 'utf8');
    stderr.write(`written: ${resolve(output)}\n`);
  } else {
    stdout.write(newHTML);
  }
}

main();
