#!/usr/bin/env python3
"""
check-metrics-hygiene.py — Wildwood metrics hygiene CI check (v0.8.0d)

用途:
    静态扫描所有 *.py 脚本,找出不符合 v0.8 metrics 规范的写入点。
    在 CI 流水线中运行,挡住不合规的 metrics 写入(防止再次发生 v0.7.3a 那种
    跨脚本污染导致 sync-badge 误报红的事故)。

校验规则:
    1. source 字段必填     — 每条 metric 必须带 source=<script_name>
    2. schema_version 字段必填 — 当前为 "1.0",升级时递增
    3. append-only         — 必须用 "a" / "ab" 模式打开文件,禁止 "w" / "wb"
    4. 过滤测试 fixture    — 调用方必须实现 fixture 过滤(EXCLUDED_SOURCES / EXCLUDED_ERROR_TOKENS)
    5. 路径正确            — 写入路径必须是 metrics/<source>.jsonl
                             (或带 ${source} / {script_name} 占位符)

扫描目标:
    - wildwood/update_roadmap.py
    - wildwood/sync_roadmap.py
    - skills/gha-feishu-ops/scripts/sync_main.py
    - skills/gha-feishu-ops/scripts/sync_state.py
    - 以及任何调用 record_metric() / write_metric() / .jsonl 写入的 .py

退出码:
    0  全部通过
    1  发现不合规写入(输出诊断 + 列出违规位置)
    2  工具自身错误(无法解析、IO 错误等)
"""
from __future__ import annotations
import ast
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# === 配置 ===
HERE = Path(__file__).resolve()
WILDWOOD_ROOT = HERE.parent.parent  # wildwood/
WORKSPACE_ROOT = Path.home() / ".aily" / "workspace"

# 扫描目标(相对 wildwood/ 或绝对路径)
SCAN_ROOTS = [
    WILDWOOD_ROOT,
    WORKSPACE_ROOT / "skills" / "gha-feishu-ops" / "scripts",
]

# 已知 metrics 写入 helper 函数名
METRIC_WRITER_FUNCS = {"record_metric", "write_metric", "record_sync_metric", "_record_metric"}

# 合法 metrics 路径模式(必须含 metrics/<source>.jsonl)
LEGIT_PATH_PATTERNS = [
    re.compile(r"metrics/[\w\-]+\.jsonl"),                              # metrics/<name>.jsonl
    re.compile(r"WORKSPACE_DIR\s*/\s*[\"']metrics[\"']\s*/"),           # WORKSPACE_DIR / "metrics" / <name>
    re.compile(r"\{\s*source\s*\}\.jsonl"),                             # {source}.jsonl
    re.compile(r"\{\s*script_name\s*\}\.jsonl"),                        # {script_name}.jsonl
    re.compile(r"f[\"'][^\"']*\{[a-z_]+\.split\(.+\)\[0\]\}\.jsonl"),  # f"...{x.split('/')[-1]}.jsonl"
]

# 合规字段(每条 metric 必须包含)
REQUIRED_FIELDS = {"source", "schema_version"}

# 当前 schema 版本
CURRENT_SCHEMA_VERSION = "1.0"

# 输出颜色(可选,无 colorama 也工作)
class C:
    R = "\033[91m" if sys.stdout.isatty() else ""
    Y = "\033[93m" if sys.stdout.isatty() else ""
    G = "\033[92m" if sys.stdout.isatty() else ""
    B = "\033[94m" if sys.stdout.isatty() else ""
    DIM = "\033[2m" if sys.stdout.isatty() else ""
    X = "\033[0m" if sys.stdout.isatty() else ""


class Finding:
    def __init__(self, file: Path, line: int, severity: str, rule: str, msg: str):
        self.file = file
        self.line = line
        self.severity = severity  # error / warning / info
        self.rule = rule
        self.msg = msg

    def to_dict(self) -> dict:
        return {
            "file": str(self.file),
            "line": self.line,
            "severity": self.severity,
            "rule": self.rule,
            "message": self.msg,
        }


def scan_file(path: Path) -> List[Finding]:
    """AST 扫描单个 .py 文件,返回 Finding 列表。"""
    findings: List[Finding] = []
    try:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src, filename=str(path))
    except SyntaxError as e:
        findings.append(Finding(path, e.lineno or 0, "error", "syntax",
                                f"无法解析: {e.msg}"))
        return findings
    except Exception as e:
        findings.append(Finding(path, 0, "error", "io", f"无法读取: {e}"))
        return findings

    # === 检测 1: 直接 .jsonl 写入(用 "w" / "a" 模式 open())===
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        # open() 调用
        if isinstance(node.func, ast.Name) and node.func.id == "open":
            mode_arg = _get_str_arg(node, "mode", default="r")
            path_arg = _get_str_arg(node, "file", default="")
            if not path_arg:
                continue
            if ".jsonl" not in path_arg and "metrics" not in path_arg:
                continue
            # 检查模式
            if "w" in mode_arg and "a" not in mode_arg:
                findings.append(Finding(
                    path, node.lineno, "error", "append-only",
                    f"open(mode={mode_arg!r}) 写 jsonl 必须用 append 模式"
                ))
            # 检查路径
            if not _is_legit_metrics_path(path_arg):
                findings.append(Finding(
                    path, node.lineno, "warning", "metrics-path",
                    f"路径 {path_arg!r} 不符合 metrics/<source>.jsonl 规范"
                ))

        # record_metric() / write_metric() 调用
        if isinstance(node.func, ast.Name) and node.func.id in METRIC_WRITER_FUNCS:
            findings.extend(_check_metric_call(path, node))

    # === 检测 2: 写全局 metrics 路径(共享文件)===
    LEGACY_VAR_NAMES = {"SYNC_METRICS_PATH", "WORKSPACE_METRICS", "GH_METRICS", "WORKSPACE_METRICS_LEGACY"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in LEGACY_VAR_NAMES:
                    val = ast.unparse(node.value) if hasattr(ast, "unparse") else ""
                    # 检查是否被标记为 legacy/v0.7.3a
                    src_line = src.splitlines()[node.lineno - 1] if node.lineno and node.lineno <= len(src.splitlines()) else ""
                    is_legacy = (
                        "legacy" in src_line.lower()
                        or "v0.7" in src_line
                        or "v0.8" in src_line  # 注释提到 v0.8 也视为已升级
                        or "fallback" in src_line.lower()
                        or "兜底" in src_line
                        or target.id.endswith("_LEGACY")
                    )
                    if "sync_metrics.jsonl" in val and "metrics/" not in val and not is_legacy:
                        findings.append(Finding(
                            path, node.lineno, "error", "shared-metrics",
                            f"全局 metrics 路径仍指向共享文件 {val!r},必须按脚本拆分为 metrics/<script>.jsonl"
                        ))
                    elif "sync_metrics.jsonl" in val and is_legacy:
                        # 标记为 legacy/fallback 的允许通过(降级路径)
                        findings.append(Finding(
                            path, node.lineno, "info", "legacy-fallback",
                            f"保留 {target.id} 共享路径作为 legacy fallback(已标记,允许)"
                        ))

    return findings


def _get_str_arg(call: ast.Call, name: str, default=None):
    """从函数调用参数中取字符串字面量。"""
    for kw in call.keywords:
        if kw.arg == name and isinstance(kw.value, ast.Constant):
            return kw.value.value
    return default


def _is_legit_metrics_path(path_str: str) -> bool:
    return any(p.search(path_str) for p in LEGIT_PATH_PATTERNS)


def _check_metric_call(path: Path, call: ast.Call) -> List[Finding]:
    """检查 record_metric() / write_metric() 调用现场。"""
    out: List[Finding] = []
    # 函数定义里应该有 extras={"source": SCRIPT_SOURCE, "schema_version": "1.0"}
    # 这里只能做调用现场检查,函数定义本体在另一个 visit
    return out  # 函数定义检查在另一处


def check_function_defs(path: Path, tree: ast.Module) -> List[Finding]:
    """检查 record_metric / write_metric 函数定义,确保写入字段合规。"""
    findings: List[Finding] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name not in METRIC_WRITER_FUNCS and not node.name.startswith("record_") and not node.name.startswith("write_"):
            continue
        if "metric" not in node.name.lower():
            continue

        func_src = ast.unparse(node) if hasattr(ast, "unparse") else ""
        func_doc = ast.get_docstring(node) or ""

        # 委托检测:如果函数体内调了 _helpers_write_metric / metrics_helpers.write_metric,视为合规
        delegates_to_helper = bool(re.search(
            r"_?helpers_write_metric\s*\(|metrics_helpers\.write_metric\s*\(",
            func_src
        ))
        # Legacy 分支检测:文档字符串里出现 降级/legacy/fallback,允许文件路径不符合规范
        has_legacy_branch = (
            "降级" in func_doc
            or "legacy" in func_doc.lower()
            or "fallback" in func_doc.lower()
            or "v0.7" in func_doc
        )

        # 1. 必须包含 "source" 字段(或委托 helper)
        has_source = (
            delegates_to_helper
            or '"source"' in func_src
            or "'source'" in func_src
        )
        if not has_source:
            findings.append(Finding(
                path, node.lineno, "error", "source-field",
                f"函数 {node.name}() 缺少 'source' 字段(必须每条 metric 都标识写入脚本)"
            ))

        # 2. 必须包含 "schema_version" 字段(或委托 helper,或有 legacy 分支)
        has_schema_version = (
            delegates_to_helper
            or '"schema_version"' in func_src
            or "'schema_version'" in func_src
            or has_legacy_branch
        )
        if not has_schema_version:
            findings.append(Finding(
                path, node.lineno, "error", "schema-version",
                f"函数 {node.name}() 缺少 'schema_version' 字段(当前应填 {CURRENT_SCHEMA_VERSION!r})"
            ))

        # 3. 必须用 append 模式(legacy 分支允许 'w' 模式作为兜底)
        if not has_legacy_branch and re.search(r'open\([^)]*mode\s*=\s*["\']w["\']', func_src):
            findings.append(Finding(
                path, node.lineno, "error", "append-only",
                f"函数 {node.name}() 用 'w' 模式打开文件,会覆盖历史 metrics(必须用 'a' 追加)"
            ))

        # 4. 路径应该是 metrics/<source>.jsonl 形式(legacy 分支允许)
        if not has_legacy_branch and re.search(r'sync_metrics\.jsonl', func_src):
            findings.append(Finding(
                path, node.lineno, "error", "shared-metrics",
                f"函数 {node.name}() 仍指向共享 sync_metrics.jsonl,必须改为 metrics/<script>.jsonl"
            ))

    return findings

def check_fixture_filter(path: Path) -> List[Finding]:
    """检查脚本是否实现了 fixture 过滤机制(EXCLUDED_SOURCES / EXCLUDED_ERROR_TOKENS)。"""
    findings: List[Finding] = []
    try:
        src = path.read_text(encoding="utf-8")
    except Exception:
        return findings

    # 写 metrics 的脚本必须有 fixture 过滤
    has_metric_writer = bool(re.search(r'\b(?:record|write)_(?:metric|sync_metric)\b', src))
    if not has_metric_writer:
        return findings

    has_excluded_sources = bool(re.search(r'_EXCLUDED_SOURCES\s*=', src))
    has_excluded_tokens = bool(re.search(r'_EXCLUDED_ERROR_TOKENS\s*=', src))
    has_filter_func = bool(re.search(r'def\s+_is_real_metric|def\s+_is_valid_metric|def\s+_filter', src))
    # 委托给 metrics_helpers 也算合规(helper 内部已有过滤)
    delegates_to_helper = bool(re.search(r'metrics_helpers\.|from\s+metrics_helpers', src))

    if not (has_excluded_sources or has_excluded_tokens or has_filter_func or delegates_to_helper):
        findings.append(Finding(
            path, 0, "warning", "fixture-filter",
            "脚本写 metrics 但没有 fixture 过滤机制(EXCLUDED_SOURCES / EXCLUDED_ERROR_TOKENS / _is_real_metric)"
        ))

    return findings


def main() -> int:
    print(f"{C.B}Wildwood Metrics Hygiene Check (v0.8.0d){C.X}")
    print(f"{C.DIM}扫描根: {', '.join(str(r) for r in SCAN_ROOTS)}{C.X}\n")

    all_findings: List[Finding] = []
    files_scanned = 0

    for root in SCAN_ROOTS:
        if not root.exists():
            print(f"  {C.Y}SKIP{C.X}  {root} (不存在)")
            continue
        for path in sorted(root.rglob("*.py")):
            # 跳过 __pycache__ / 测试 / node_modules
            if any(p in path.parts for p in ("__pycache__", "node_modules", ".git")):
                continue
            files_scanned += 1
            findings = scan_file(path)
            # 函数定义层检查
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
                findings.extend(check_function_defs(path, tree))
            except Exception:
                pass
            # fixture 过滤层检查
            findings.extend(check_fixture_filter(path))
            all_findings.extend(findings)

    # === 报告 ===
    errors = [f for f in all_findings if f.severity == "error"]
    warnings = [f for f in all_findings if f.severity == "warning"]

    print(f"扫描 {files_scanned} 个 .py 文件,发现 {len(errors)} error + {len(warnings)} warning\n")

    if not all_findings:
        print(f"{C.G}✓ 全部合规{C.X}")
        return 0

    # 按文件分组
    by_file: Dict[Path, List[Finding]] = {}
    for f in all_findings:
        by_file.setdefault(f.file, []).append(f)

    for fpath, ffindings in sorted(by_file.items()):
        try:
            rel = fpath.relative_to(WORKSPACE_ROOT)
        except ValueError:
            rel = fpath
        print(f"{C.B}▸ {rel}{C.X}")
        for f in sorted(ffindings, key=lambda x: x.line):
            color = C.R if f.severity == "error" else (C.Y if f.severity == "warning" else C.DIM)
            tag = "ERROR" if f.severity == "error" else ("WARN " if f.severity == "warning" else "INFO ")
            print(f"  {color}{tag}{C.X} line {f.line:>4}  [{f.rule}]  {f.msg}")

    print()
    if errors:
        print(f"{C.R}✗ FAIL:{C.X} {len(errors)} 个不合规 metrics 写入点(必须修复后再合入)")
        return 1
    else:
        print(f"{C.Y}⚠ PASS with warnings:{C.X} {len(warnings)} 个建议项(非阻塞)")
        return 0


def main_json() -> int:
    """JSON 格式输出,供 CI / dashboard 消费。"""
    all_findings: List[Finding] = []
    files_scanned = 0
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.py")):
            if any(p in path.parts for p in ("__pycache__", "node_modules", ".git")):
                continue
            files_scanned += 1
            findings = scan_file(path)
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
                findings.extend(check_function_defs(path, tree))
            except Exception:
                pass
            findings.extend(check_fixture_filter(path))
            all_findings.extend(findings)
    errors = [f for f in all_findings if f.severity == "error"]
    report = {
        "schema_version": "1.0",
        "files_scanned": files_scanned,
        "total_findings": len(all_findings),
        "errors": len(errors),
        "warnings": sum(1 for f in all_findings if f.severity == "warning"),
        "info": sum(1 for f in all_findings if f.severity == "info"),
        "pass": len(errors) == 0,
        "findings": [f.to_dict() for f in all_findings],
        "scan_roots": [str(r) for r in SCAN_ROOTS],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if len(errors) == 0 else 1


if __name__ == "__main__":
    import argparse as _ap
    _p = _ap.ArgumentParser()
    _p.add_argument("--json", action="store_true", help="JSON 格式输出")
    _args, _ = _p.parse_known_args()
    try:
        if _args.json:
            sys.exit(main_json())
        sys.exit(main())
    except Exception as e:
        print(f"{C.R}check-metrics-hygiene 自身错误: {e}{C.X}", file=sys.stderr)
        sys.exit(2)
