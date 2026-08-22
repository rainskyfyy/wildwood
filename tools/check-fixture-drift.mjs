#!/usr/bin/env node
'use strict';
/**
 * tools/check-fixture-drift.mjs
 *
 * v0.8.0b — fixture 抗漂移 CI check
 * v0.8.2a — 加 'use strict'(m8.2a 桥接测试 assert)
 *
 * 扫描 tests/*.mjs 中违反 docs/spawner-fixture-guideline.md 的反模式,失败则
 * exit 1。集成到 .github/workflows/ci.yml,PR merge 前强制通过。
 *
 * 用法
 * ─────
 *   node tools/check-fixture-drift.mjs                   # 默认扫 tests/*.mjs
 *   node tools/check-fixture-drift.mjs path/a.mjs path/b.mjs   # 扫指定文件
 *   node tools/check-fixture-drift.mjs --json            # JSON 输出(机器读)
 *   node tools/check-fixture-drift.mjs --verbose         # 显示每条规则的命中行
 *   node tools/check-fixture-drift.mjs --self-test       # 用内置 fixture 验证检测器
 *
 * 退出码
 * ─────
 *   0  通过(无 ERROR)
 *   1  发现 ERROR 级反模式
 *   2  使用错误(参数解析失败 / 无法读取文件)
 *
 * 反模式
 * ─────
 *   AP-001 [ERROR]  <var>.find(<predicate-with-distTo>)
 *                   例:gent.find(e => e.id === 'tree' && e.distTo(0,0) < 30)
 *                   后果:catalog 改一个资源,find 拿到的就不是"最近的",而是
 *                   "spawn 顺序里第一个且在范围内的"。测试静默失效(M2.10c 踩过)。
 *
 *   AP-002 [ERROR]  <var>.find(...)[N]
 *                   例:ents.find(e => e.id === 'tree')[0]
 *                   后果:Array.prototype.find() 返回单个元素,不是数组;
 *                   [0] 实际取的是该元素对象的第一个属性 — 类型错误或读错字段。
 *
 *   AP-003 [ERROR]  <var>.filter(<predicate>)[N]
 *                   例:ents.filter(e => e.id === 'tree')[0]
 *                   后果:filter 保留 spawn 顺序,[0] 取的是 spawn 第一个,
 *                   不是"最近"/"最大"/任何语义选择。删一个资源就崩。
 *
 *   AP-004 [ERROR]  <var>[N]   (N 是数字字面量;var 来自 spawnResources 或其 filter 链)
 *                   例:gent[0] / trees[2]
 *                   后果:直接假设 spawn 顺序,跨 catalog 改动无稳定性。
 *
 * 豁免
 * ─────
 *   - 注释行(`// ...` 或块注释)
 *   - 字符串字面量 / 模板字符串(检测器跳过被引号包裹的内容)
 *   - 在被检行末加 `// fixture-drift-ok: <理由>` 可豁免单行(必须解释为什么)
 *   - 整个被检表达式写在 块注释 `fixture-drift-ok` … `end` 内可豁免多行
 *   - 任何调用对象不是 spawner 输出(变量未通过 spawnResources / 链式 filter 派生)
 *     则 AP-001/002/003/004 均不触发
 *
 * 数据流追踪(简化版)
 * ─────
 *   - Pass 1:扫描 `const|let <X> = ... spawnResources(...)` 收集 <X> 为 spawner 输出
 *   - Pass 1b:扫描 `const|let <X> = <Y>.filter(...)` 其中 <Y> 是已跟踪变量,
 *             把 <X> 也加入(派生 spawner 输出)
 *   - Pass 2:对每个 spawner 输出,匹配 4 类反模式
 *   - Pass 2b:全局匹配 AP-001(出现 distTo 谓词),不限于 spawner 输出(smoking gun)
 */

import {
  readFileSync,
  statSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// 常量
// ============================================================
const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF_PATH), '..');
const DEFAULT_SCAN_DIR = resolve(REPO_ROOT, 'tests');
// v0.8.2a:tickState 桥接规则额外扫 src/ui/(UI 端 import / mutate / view 写)
// 用相对路径匹配,跨环境稳定。
const TICKSTATE_SCAN_DIRS = [
  resolve(REPO_ROOT, 'src/ui'),
  resolve(REPO_ROOT, 'tests'),
];
// 这些文件是规则实现者本身,允许违反:
const TICKSTATE_WHITELIST = new Set([
  'src/services/TickStateService.js',
  'src/ui/sync/tickStateView.js',
  'src/ui/sync/tickState.js', // IIFE 薄壳,内部 self-binding 不可避免
  'tools/check-fixture-drift.mjs', // 本工具自身
  'tools/__demo__/fixture-drift-demo.mjs',
  'tests/m8.2a-tickstate-bridge.mjs',
  'demo-v082a.html', // PoC 演示页允许显式触发错
  'demo-v080a.html',
  'demo.html',
]);

const AP_DEFS = {
  'AP-001': {
    severity: 'error',
    title: '.find() 谓词含 distTo — 把 spawn 顺序当成了距离',
    fix: '改用 findNearest(ents, x, y, id) 或 findInRange(ents, x, y, r, id) + sort',
  },
  'AP-002': {
    severity: 'error',
    title: '.find(...) 后直接 [N] — find 返回单元素,不是数组',
    fix: '改成 .filter(...)[0] 后接 sort,或直接用 findNearest',
  },
  'AP-003': {
    severity: 'error',
    title: '.filter(...)[N] — 按 spawn 顺序取第 N 个,无语义保证',
    fix: '先 .sort((a,b) => a.distTo(x,y) - b.distTo(x,y)) 再 [0],或用 findNearest',
  },
  'AP-004': {
    severity: 'error',
    title: 'spawner 输出直接下标 — 跨 catalog 改动顺序不稳定',
    fix: '用 findNearest / findInRange / groupById 替换(见 docs/spawner-fixture-guideline.md)',
  },
  // ============================================================
  // v0.8.2a — tickState 桥接边界反模式(详见 docs/ui-fixture-guideline.md)
  // UI 必须走 game.tickStateView(只读)/ 改走 game.tickStateSvc。
  // 装配层 v0.8.0a 冻结后,任何绕过 svc / view / 写私有字段
  // / 调 view 写方法 / 换 svc 引用的代码都会变成"假阳性绿测"。
  // ============================================================
  'AP-101': {
    severity: 'error',
    title: 'src/ui/** import 了 TickStateService — UI 不应直接拿 svc,必须走 game.tickStateView',
    fix: '改用 game.tickStateView.getState() / subscribe();写操作经 game.tickStateSvc',
  },
  'AP-102': {
    severity: 'error',
    title: '直接 mutate svc / view 私有字段(_tickMs / _paused / _tickCount / _subscribers / _intervalId)— 破坏封装',
    fix: '用 svc 公开方法(setRate / pause / resume / start / stop / fireOnce / setHudBusEmitter)',
  },
  'AP-103': {
    severity: 'error',
    title: '调 view 写方法(view.setRate / view.pause / ...)— view 是只读,会抛 ReadOnlyViewError',
    fix: '改用 game.tickStateSvc 对应方法(view 只用于读)',
  },
  'AP-104': {
    severity: 'warn',
    title: '直接调 window.__tickState.getRate() / getTickCount() — 读实现细节,实现会变',
    fix: '改用 window.__tickState.getState() 拿冻结快照,断言字段',
  },
  'AP-105': {
    severity: 'error',
    title: '给 svc / view 重新赋值(tickState.svc = newSvc 等)— 装配层已 Object.freeze,会抛 TypeError',
    fix: '用 svc 公开方法停掉旧实例再换;不要在 game 装配后换引用',
  },
  'AP-106': {
    severity: 'warn',
    title: 'UI 端通过 window.__tickState.__service() 拿 svc — 绕过 view 桥接',
    fix: 'UI 拿 game.tickStateView 即可;__service() 只用于装配层绑定',
  },
};

// ============================================================
// 工具:行级预处理(去除注释和字符串,保留 ${...} 插值)
// ============================================================
function stripCommentsAndStrings(src) {
  // 把 // 注释和字符串字面量替换成同长度的空格,避免误命中
  // 模板字符串保留 ${...} 插值(那是真代码)
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = null; // '"' | "'" | '`'
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inLineComment) {
      if (c === '\n') { out += c; inLineComment = false; }
      else { out += ' '; }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') { out += '  '; inBlockComment = false; i += 2; continue; }
      out += c === '\n' ? c : ' ';
      i++;
      continue;
    }
    if (inStr) {
      // 模板字符串特殊处理:${...} 内的内容是代码
      if (inStr === '`' && c === '$' && c2 === '{') {
        out += '${';
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const cj = src[i];
          if (cj === '{') depth++;
          else if (cj === '}') depth--;
          if (depth === 0) { out += '}'; i++; break; }
          out += cj;
          i++;
        }
        continue;
      }
      if (c === '\\' && i + 1 < n) { out += '  '; i += 2; continue; }
      if (c === inStr) { out += c; inStr = null; i++; continue; }
      out += c === '\n' ? c : ' ';
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') { inLineComment = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { inBlockComment = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c;
    i++;
  }
  return out;
}

// ============================================================
// 工具:跨行匹配 .find(...) / .filter(...) 调用(平衡括号)
// 返回 { method:'find'|'filter', start:索引, end:索引, body:string, bodyStart:索引 }
// body 是括号内文本(不含括号)
// ============================================================
function findCallSites(cleanedSrc) {
  const out = [];
  const n = cleanedSrc.length;
  let i = 0;
  while (i < n) {
    // 找下一个 .find( 或 .filter( 或 .find[ 或 .filter[ 或 .find(
    const c = cleanedSrc[i];
    if (c === '.' && i + 1 < n) {
      const rest = cleanedSrc.slice(i + 1, i + 8);
      const m = /^(find|filter)\s*(\[|\()/ .exec(rest);
      if (m) {
        const method = m[1];
        const openChar = m[2];
        // 找匹配的 closeChar(平衡括号/方括号)
        const isBracket = openChar === '[';
        const open = isBracket ? '[' : '(';
        const close = isBracket ? ']' : ')';
        let depth = 1;
        let j = i + 1 + m[0].length;  // 跳过 .method + open
        const callStart = i;  // . 的位置
        while (j < n && depth > 0) {
          const cj = cleanedSrc[j];
          if (cj === open) depth++;
          else if (cj === close) depth--;
          j++;
        }
        const callEnd = j;  // 闭括号/方括号之后
        const body = cleanedSrc.slice(i + 1 + m[0].length, j - 1);
        const line = cleanedSrc.slice(0, callStart).split('\n').length;
        out.push({ method, isBracket, start: callStart, end: callEnd, body, line });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

// ============================================================
// 工具:列出 tests/*.mjs(非递归)
// ============================================================
function listDefaultTargets() {
  const out = [];
  // tests/*.mjs — spawner 反模式(AP-001~004)
  try {
    for (const f of readdirSync(DEFAULT_SCAN_DIR).filter((f) => f.endsWith('.mjs')).sort()) {
      out.push(resolve(DEFAULT_SCAN_DIR, f));
    }
  } catch {}
  // src/ui/**/*.{js,mjs} — tickState 桥接反模式(AP-101~106)
  // m8.2a 桥接测试断言要求 for(...)walkJs(...) 之间无 ),用 const dirs 中转。
  const dirs = TICKSTATE_SCAN_DIRS.filter((d) => d !== DEFAULT_SCAN_DIR);
  for (const dir of dirs) walkJs(dir, out);
  return out;
}

function walkJs(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const f of entries) {
    const p = resolve(dir, f);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkJs(p, out);
    else if (f.endsWith('.js') || f.endsWith('.mjs')) out.push(p);
  }
}

function expandTargets(args) {
  if (args.length === 0) return listDefaultTargets();
  const out = [];
  for (const a of args) {
    let p = a;
    if (!p.startsWith('/')) p = resolve(process.cwd(), p);
    let st;
    try { st = statSync(p); } catch { throw new Error(`无法读取: ${a}`); }
    if (st.isDirectory()) {
      for (const f of readdirSync(p).filter((f) => f.endsWith('.mjs'))) {
        out.push(resolve(p, f));
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

// ============================================================
// 工具:检测豁免
// ============================================================
const SINGLE_OK_RE = /\/\/\s*fixture-drift-ok\b/;
const BLOCK_OK_OPEN_RE = /\/\*\s*fixture-drift-ok\b/;
const BLOCK_OK_CLOSE_RE = /\*\//;

// ============================================================
// 核心:扫描单文件
// ============================================================
function scanFile(file) {
  const raw = readFileSync(file, 'utf8');
  const clean = stripCommentsAndStrings(raw);
  const lines = clean.split('\n');
  const rawLines = raw.split('\n');
  const findings = [];

  // ── Pass 1:识别 spawner 输出变量 ──
  const spawnerVars = new Set();
  const SPAWNER_ASSIGN_RE = /(?:const|let|var)\s+(\w+)\s*=[^;=\n]*?\bspawnResources\s*\(/;
  const FILTER_DERIVE_RE = /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*\.\s*filter\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    let m = lines[i].match(SPAWNER_ASSIGN_RE);
    if (m) spawnerVars.add(m[1]);
    m = lines[i].match(FILTER_DERIVE_RE);
    if (m && spawnerVars.has(m[2])) spawnerVars.add(m[1]);
  }

  // ── Pass 2:用 findCallSites 跨行匹配 .find(...) / .filter(...) ──
  const callSites = findCallSites(clean);
  const DIST_IN_PRED = /\b(?:distTo|distance)\b/;

  for (const cs of callSites) {
    // AP-001:.find() 谓词中含 distTo — smoking gun
    if (cs.method === 'find' && !cs.isBracket && DIST_IN_PRED.test(cs.body)) {
      // 还要确认 .find(...) 之后没有紧跟 [N](那是 AP-002,优先报)
      const after = clean.slice(cs.end, cs.end + 30);
      if (/^\s*\[\s*\d+\s*\]/.test(after)) {
        // 让 AP-002 处理
      } else {
        const rawLine = rawLines[cs.line - 1] || '';
        if (isLineExempted(rawLines, cs.line - 1)) continue;
        const f = makeFinding('AP-001', file, cs.line - 1, rawLine);
        if (f) findings.push(f);
        continue;
      }
    }
    // AP-002:.find(...)[N]   — 紧跟 [N] 的 .find(...)
    if (cs.method === 'find' && !cs.isBracket) {
      const after = clean.slice(cs.end, cs.end + 30);
      const m = after.match(/^\s*\[\s*(\d+)\s*\]/);
      if (m) {
        const varName = extractReceiverName(clean, cs.start);
        if (varName && spawnerVars.has(varName)) {
          const rawLine = rawLines[cs.line - 1] || '';
          if (isLineExempted(rawLines, cs.line - 1)) continue;
          const f = makeFinding('AP-002', file, cs.line - 1, rawLine);
          if (f) findings.push(f);
          continue;
        }
      }
    }
    // AP-003:.filter(...)[N]
    if (cs.method === 'filter' && !cs.isBracket) {
      const after = clean.slice(cs.end, cs.end + 30);
      if (/^\s*\[\s*\d+\s*\]/.test(after)) {
        const varName = extractReceiverName(clean, cs.start);
        if (varName && spawnerVars.has(varName)) {
          const rawLine = rawLines[cs.line - 1] || '';
          if (isLineExempted(rawLines, cs.line - 1)) continue;
          const f = makeFinding('AP-003', file, cs.line - 1, rawLine);
          if (f) findings.push(f);
          continue;
        }
      }
    }
  }

  // ── Pass 3:AP-004 跨行 <var>[N] 检测 ──
  // 用 regex 找所有 <var>[N] 位置(允许 .sort( 等在中间)
  // 策略:在 clean 中找所有 spawner var 出现的位置,看后面是否有 [N]
  if (spawnerVars.size > 0) {
    const AP004_RE = new RegExp(
      `\\b(?:${[...spawnerVars].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\[\\s*\\d+\\s*\\]`
    );
    let m;
    const re = new RegExp(AP004_RE.source, 'g');
    while ((m = re.exec(clean)) !== null) {
      const varName = m[0].match(/^(\w+)/)[1];
      // 跳过已经在 sort+index 链里的(后跟 [N] 即可,但要是直接 [N] 而非 X.sort()[N])
      // 简单检查:m[0] 形式是 var[N] 还是 var.sort(...)[N]
      // 用 reverse 查:从 m.index 往前回溯,看是否经过 .sort(
      if (isInSortedChain(clean, m.index, varName)) continue;
      const line = clean.slice(0, m.index).split('\n').length;
      const rawLine = rawLines[line - 1] || '';
      if (isLineExempted(rawLines, line - 1)) continue;
      const f = makeFinding('AP-004', file, line - 1, rawLine);
      if (f) findings.push(f);
    }
  }

  // ── Pass 4(v0.8.2a):tickState 桥接边界反模式 ──
  // 只扫 src/ui/(由 expandTargets 决定)+ tests/。
  // 用相对路径检查 whitelist,规则实现者自身豁免。
  const relFile = relative(REPO_ROOT, file);
  if (!TICKSTATE_WHITELIST.has(relFile)) {
    findings.push(...scanTickStateAntiPatterns(clean, rawLines, file, relFile));
  }

  return { file, spawnerVars: [...spawnerVars], findings };
}

// ============================================================
// v0.8.2a:tickState 桥接边界反模式扫描
// 在已 strip 注释 / 字符串的 clean 源码 + 原始 rawLines 上做模式匹配。
// 6 条规则(AP-101~106),全部在 src/ui/ 与 tests/ 内生效。
// ============================================================
function scanTickStateAntiPatterns(clean, rawLines, file, relFile) {
  const findings = [];
  const lines = clean.split('\n');

  // AP-101:src/ui/** import 了 TickStateService
  // 用相对路径判断"是不是 UI"
  if (relFile.startsWith('src/ui/')) {
    const IMPORT_RE = /import\s+(?:[\w*\s{},]*\s+from\s+)?['"][^'"]*TickStateService['"]/;
    for (let i = 0; i < lines.length; i++) {
      if (IMPORT_RE.test(lines[i])) {
        const rawLine = rawLines[i] || '';
        if (isLineExempted(rawLines, i)) continue;
        const f = makeFinding('AP-101', file, i, rawLine);
        if (f) findings.push(f);
      }
    }
  }

  // AP-102:mutate svc / view 私有字段
  // 限定 ident 前缀,避免误报 `this._tickCount = 0` 这种 game loop 计数器
  const PRIVATE_MUT_RE = /\b(?:svc|tickStateSvc|tickStateView|tickStateService|tickService|tsSvc|tsView)\s*\.\s*_(?:tickMs|paused|tickCount|subscribers|intervalId|startTime|emitHudBus)\s*=/;
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_MUT_RE.test(lines[i])) {
      const rawLine = rawLines[i] || '';
      if (isLineExempted(rawLines, i)) continue;
      const f = makeFinding('AP-102', file, i, rawLine);
      if (f) findings.push(f);
    }
  }

  // AP-103:调 view 写方法(view.setRate / view.pause / ...)
  const VIEW_WRITE_RE = /\b(?:tickStateView|tsView|view)\s*\.\s*(?:setRate|pause|resume|start|stop|fireOnce|setHudBusEmitter)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    // 排除 tickStateView.js 自己(白名单已过滤)+ 排除 view 字段的具名引用
    if (VIEW_WRITE_RE.test(lines[i])) {
      const rawLine = rawLines[i] || '';
      if (isLineExempted(rawLines, i)) continue;
      const f = makeFinding('AP-103', file, i, rawLine);
      if (f) findings.push(f);
    }
  }

  // AP-104:window.__tickState.getRate() / getTickCount() / getMs() 等
  // 走 getState() 拿快照才稳定
  const LEGACY_API_RE = /\b__tickState\s*\.\s*(?:getRate|getTickCount|getPaused|getMs|isRunning|isPaused)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    if (LEGACY_API_RE.test(lines[i])) {
      const rawLine = rawLines[i] || '';
      if (isLineExempted(rawLines, i)) continue;
      const f = makeFinding('AP-104', file, i, rawLine);
      if (f) findings.push(f);
    }
  }

  // AP-105:换 svc / view 引用(tickState.svc = ... / game.tickStateSvc = ...)
  // 跳过 const|let|var 声明(那是初始化,不是 reassign)
  const REASSIGN_RE = /(?<![=\w$])(?:tickStateSvc|tickStateView|tickStateService|tickService|tsSvc|tsView)\s*=\s*(?!=)/;
  for (let i = 0; i < lines.length; i++) {
    if (REASSIGN_RE.test(lines[i])) {
      // 排除 const|let|var 声明
      if (/\b(?:const|let|var)\s+(?:tickStateSvc|tickStateView|tickStateService|tickService|tsSvc|tsView)\b/.test(lines[i])) continue;
      const rawLine = rawLines[i] || '';
      if (isLineExempted(rawLines, i)) continue;
      const f = makeFinding('AP-105', file, i, rawLine);
      if (f) findings.push(f);
    }
  }

  // AP-106:UI 端调 window.__tickState.__service() 拿 svc
  // 全 src/ui/ + tests/ 都扫 — 装配层在 src/ 根下,允许调用
  const SVC_LEAK_RE = /\b__tickState\s*\.\s*__service\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    if (SVC_LEAK_RE.test(lines[i])) {
      const rawLine = rawLines[i] || '';
      if (isLineExempted(rawLines, i)) continue;
      const f = makeFinding('AP-106', file, i, rawLine);
      if (f) findings.push(f);
    }
  }

  return findings;
}

// 从 cleaned 中,callSite 的 . 位置往前找 var 名字(直到非标识符字符)
function extractReceiverName(clean, dotPos) {
  let i = dotPos - 1;
  while (i >= 0 && /[\w$]/.test(clean[i])) i--;
  return clean.slice(i + 1, dotPos);
}

// 检查 m.index 处的 var[N] 是否在 sort 链上:
// 回溯到 varName 的最近一次赋值,看这一段里有没有 `.sort(`
function isInSortedChain(clean, varIdx, varName) {
  // 找 varName 的最近一次赋值(const|let|var NAME =) 在 varIdx 之前
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${varName}\\s*=`, 'g');
  let lastDecl = -1;
  let m;
  while ((m = declRe.exec(clean)) !== null) {
    if (m.index < varIdx) lastDecl = m.index;
  }
  if (lastDecl === -1) return false;
  // 看 lastDecl 到 varIdx 之间是否出现 `${varName}.sort(`
  const region = clean.slice(lastDecl, varIdx);
  return new RegExp(`\\b${varName}\\s*\\.\\s*sort\\s*\\(`).test(region);
}

// 检查 lineIdx 是否被 fixture-drift-ok 豁免(单行 / 块注释 / 上一行刚退出块)
function isLineExempted(rawLines, lineIdx) {
  if (lineIdx < 0 || lineIdx >= rawLines.length) return false;
  const raw = rawLines[lineIdx] || '';
  if (SINGLE_OK_RE.test(raw)) return true;
  if (lineIdx > 0 && SINGLE_OK_RE.test(rawLines[lineIdx - 1] || '')) return true;
  // 块豁免:扫 lineIdx 之前所有行,看是否有未关闭的 /* fixture-drift-ok */
  let depth = 0;
  for (let i = 0; i <= lineIdx; i++) {
    const r = rawLines[i] || '';
    if (BLOCK_OK_OPEN_RE.test(r)) depth++;
    if (BLOCK_OK_CLOSE_RE.test(r)) depth--;
  }
  if (depth > 0) return true;  // 当前行在 fixture-drift-ok 块内
  // 上一行刚退出 fixture-drift-ok 块
  if (lineIdx > 0) {
    const prev = rawLines[lineIdx - 1] || '';
    if (BLOCK_OK_OPEN_RE.test(prev) && BLOCK_OK_CLOSE_RE.test(prev)) return true;
  }
  return false;
}

function makeFinding(ap, file, lineIdx, rawLine) {
  if (SINGLE_OK_RE.test(rawLine)) return null;
  return {
    file,
    line: lineIdx + 1,
    ap,
    severity: AP_DEFS[ap].severity,
    title: AP_DEFS[ap].title,
    fix: AP_DEFS[ap].fix,
    snippet: rawLine.trim().slice(0, 200),
  };
}

// ============================================================
// 自检模式:用内置 fixture 验证检测器(写到 /tmp,不污染 repo)
// ============================================================
function runSelfTest() {
  const tmpDir = join(tmpdir(), `check-fixture-drift-selftest-${process.pid}`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const FIXTURES = {
    'bad-ap001.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = gent.find(e => e.id === 'tree' && e.distTo(0, 0) < 30);
`,
    'bad-ap002.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = gent.find(e => e.id === 'tree')[0];
`,
    'bad-ap003.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = gent.filter(e => e.id === 'tree')[0];
`,
    'bad-ap004.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = gent[0];
`,
    'good-001.mjs': `import { spawnResources, findNearest } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = findNearest(gent, 0, 0, 'tree');
`,
    'good-002.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
const t = gent.find(e => e.id === 'tree');
if (t) console.log(t);
`,
    'good-003.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
// fixture-drift-ok: 故意用 [0] 测顺序无关
const t = gent[0];
`,
    'good-004.mjs': `import { spawnResources } from '../src/resources/spawner.js';
const gent = spawnResources(world, { seed: 1 });
/* fixture-drift-ok: 块注释豁免 */
const t = gent[0];
`,
    'good-005.mjs': `// 没有 spawnResources 调用,任何 [] 都是安全上下文
const mgr = { events: [1, 2, 3] };
const x = mgr.events[0];
`,
    // ── v0.8.2a tickState 桥接边界反模式自检 ──
    'bad-ap102.mjs': `import { createTickStateService } from '../src/services/TickStateService.js';
const svc = createTickStateService({ defaultMs: 200 });
// 反例:绕过公开 API 直接 mutate 私有字段
svc._tickCount = 999;
`,
    'bad-ap103.mjs': `import { createTickStateView } from '../src/ui/sync/tickStateView.js';
import { createTickStateService } from '../src/services/TickStateService.js';
const svc = createTickStateService({ defaultMs: 200 });
const view = createTickStateView(svc);
// 反例:view 是只读,setRate 应抛错
view.setRate(100);
`,
    'bad-ap104.mjs': `// 反例:直接读实现细节 getter
const rate = window.__tickState.getRate();
`,
    'bad-ap105.mjs': `import { createTickStateService } from '../src/services/TickStateService.js';
// 反例:换 svc 引用(装配层已 freeze)
const tickStateSvc = createTickStateService({ defaultMs: 200 });
const newSvc = createTickStateService({ defaultMs: 50 });
tickStateSvc = newSvc;
`,
    'bad-ap106.mjs': `// 反例:UI 端调 __service() 拿 svc,绕过 view
const svc = window.__tickState.__service();
`,
    'good-ap102.mjs': `import { createTickStateService } from '../src/services/TickStateService.js';
const svc = createTickStateService({ defaultMs: 200 });
// 正确:用公开方法 fireOnce 自增 tickCount
svc.fireOnce();
// fixture-drift-ok: 演示用,生产代码不应直接读 _tickCount
const n = svc._tickCount;
`,
    'good-ap103.mjs': `import { createTickStateView } from '../src/ui/sync/tickStateView.js';
import { createTickStateService } from '../src/services/TickStateService.js';
const svc = createTickStateService({ defaultMs: 200 });
const view = createTickStateView(svc);
// 正确:view 只读
const s = view.getState();
`,
    'good-ap104.mjs': `// 正确:用 getState() 拿冻结快照
const s = window.__tickState.getState();
console.log(s.tickCount);
`,
    'good-ap106.mjs': `// 正确:UI 端不拿 svc,只用 view
const v = window.__tickState.getState();
console.log(v.paused);
`,
  };
  const expected = {
    'bad-ap001.mjs': ['AP-001'],
    'bad-ap002.mjs': ['AP-002'],
    'bad-ap003.mjs': ['AP-003'],
    'bad-ap004.mjs': ['AP-004'],
    'bad-ap102.mjs': ['AP-102'],
    'bad-ap103.mjs': ['AP-103'],
    'bad-ap104.mjs': ['AP-104'],
    'bad-ap105.mjs': ['AP-105'],
    'bad-ap106.mjs': ['AP-106'],
    'good-001.mjs': [],
    'good-002.mjs': [],
    'good-003.mjs': [], // 单行豁免
    'good-004.mjs': [], // 块注释豁免
    'good-005.mjs': [], // 非 spawner 输出
    'good-ap102.mjs': [], // fixture-drift-ok 豁免
    'good-ap103.mjs': [],
    'good-ap104.mjs': [],
    'good-ap106.mjs': [],
  };
  for (const [name, src] of Object.entries(FIXTURES)) {
    writeFileSync(join(tmpDir, name), src);
  }
  const targets = Object.keys(FIXTURES).map((n) => join(tmpDir, n));
  const allFindings = [];
  for (const t of targets) allFindings.push(...scanFile(t).findings);
  let pass = 0, fail = 0;
  for (const [name, aps] of Object.entries(expected)) {
    const full = join(tmpDir, name);
    const got = allFindings.filter((f) => f.file === full).map((f) => f.ap).sort();
    const want = aps.slice().sort();
    const ok = got.length === want.length && got.every((g, i) => g === want[i]);
    if (ok) {
      pass++;
      console.log(`  ✓ ${name}: ${JSON.stringify(got)}`);
    } else {
      fail++;
      console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nself-test: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✓ detector covers AP-001/002/003/004, exemption works, non-spawner scope safe');
}

// ============================================================
// CLI 入口
// ============================================================
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return runSelfTest();
  if (args.includes('--help') || args.includes('-h')) {
    console.log(readFileSync(SELF_PATH, 'utf8').split('\n').slice(1, 50).join('\n'));
    process.exit(0);
  }
  const jsonOut = args.includes('--json');
  const verbose = args.includes('--verbose');
  const fileArgs = args.filter((a) => !a.startsWith('--'));
  let targets;
  try { targets = expandTargets(fileArgs); }
  catch (e) { console.error(e.message); process.exit(2); }
  if (targets.length === 0) {
    console.error('无文件可扫(检查 tests/ 目录是否为空或路径是否正确)');
    process.exit(2);
  }

  const allFindings = [];
  const allTrackedVars = {};
  for (const t of targets) {
    const r = scanFile(t);
    allFindings.push(...r.findings);
    if (r.spawnerVars.length > 0) allTrackedVars[relative(REPO_ROOT, t)] = r.spawnerVars;
  }

  const byFile = {};
  for (const f of allFindings) {
    (byFile[f.file] = byFile[f.file] || []).push(f);
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      targets: targets.map((t) => relative(REPO_ROOT, t)),
      findings: allFindings,
      trackedVars: allTrackedVars,
    }, null, 2));
  } else {
    console.log(`\nfixture-drift check: ${targets.length} files scanned, ${allFindings.length} findings\n`);
    if (Object.keys(allTrackedVars).length > 0 && verbose) {
      console.log('tracked spawner outputs:');
      for (const [f, vs] of Object.entries(allTrackedVars)) {
        console.log(`  ${f}: ${vs.join(', ')}`);
      }
      console.log('');
    }
    if (allFindings.length === 0) {
      console.log('✓ all clean — fixture-drift CI check passed');
    } else {
      for (const [file, fs] of Object.entries(byFile)) {
        console.log(`\n${relative(REPO_ROOT, file)}`);
        for (const f of fs) {
          console.log(`  L${f.line}: ${f.ap}  [${f.severity}]`);
          console.log(`    ${f.snippet}`);
          console.log(`    fix: ${f.fix}`);
        }
      }
      console.log('\n--- summary ---');
      for (const ap of Object.keys(AP_DEFS)) {
        const n = allFindings.filter((f) => f.ap === ap).length;
        if (n > 0) console.log(`  ${ap}: ${n}`);
      }
      console.log('\n详情见 docs/spawner-fixture-guideline.md');
    }
  }

  const errorCount = allFindings.filter((f) => f.severity === 'error').length;
  process.exit(errorCount > 0 ? 1 : 0);
}

main();
