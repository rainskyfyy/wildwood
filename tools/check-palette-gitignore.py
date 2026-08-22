#!/usr/bin/env python3
"""
check-palette-gitignore.py
==========================

CI 校验: 仓库 .gitignore 必须覆盖常见的"开发工具产物", 防止污染 Git 仓库。

v0.7 历史教训:
  - 多次出现 __pycache__/、*.pyc、.DS_Store 等文件被意外提交
  - 这些是开发工具产物, 不应该出现在源码仓库里
  - 长期手动清理太累, 改 CI 强制

校验规则 (REQUIRED_ENTRIES):
  - __pycache__/    # Python 编译缓存
  - *.pyc           # Python 字节码
  - .DS_Store       # macOS 目录元数据
  - *.py[cod]       # 广覆盖 (pyc/pyo/pyd)
  - Thumbs.db       # Windows 缩略图缓存
  - .vscode/        # VSCode 工作区
  - .idea/          # JetBrains IDE
  - node_modules/   # Node 依赖目录
  - *.egg-info/     # Python 包元数据
  - *.so            # 编译产物
  - *.swp           # Vim swap

支持模式:
  - 默认: 校验仓库根 .gitignore 是否覆盖必需条目
  - --strict: 额外要求覆盖所有常见 IDE/编辑器残留
  - --json: 输出结构化结果便于 CI 集成
  - --root <path>: 指定仓库根目录 (默认: 脚本父目录)

退出码:
  - 0: 通过
  - 1: 缺失必需条目
  - 2: 找不到 .gitignore
  - 3: 调用错误
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Tuple


# ---------------------------------------------------------------------------
# 规则定义: 必需覆盖的污染源
# ---------------------------------------------------------------------------

REQUIRED_ENTRIES: List[str] = [
    # Python 编译产物 (v0.7 主要污染源)
    "__pycache__/",
    "*.pyc",
    "*.py[cod]",
    "*.egg-info/",
    "*.so",
    # 操作系统残留
    ".DS_Store",
    "Thumbs.db",
    # 编辑器 / IDE
    ".vscode/",
    ".idea/",
    "*.swp",
    # Node 依赖目录
    "node_modules/",
]

# 严格模式: 额外要求覆盖的开发工具产物
STRICT_EXTRA_ENTRIES: List[str] = [
    "*.pyo",
    "*.pyd",
    ".Python",
    "venv/",
    ".venv/",
    "build/",
    "dist/",
    ".coverage",
    "htmlcov/",
    ".mypy_cache/",
    ".pytest_cache/",
    ".ruff_cache/",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "*.tmp",
    "*.bak",
    "*.orig",
    "*.key",
    "*.pem",
]


# ---------------------------------------------------------------------------
# .gitignore 解析
# ---------------------------------------------------------------------------

@dataclass
class GitignoreEntry:
    raw: str
    pattern: str
    is_dir: bool
    negated: bool
    anchored: bool
    line_no: int


@dataclass
class CheckResult:
    repo_root: str
    gitignore_path: str
    exists: bool
    total_lines: int
    required_entries: List[str]
    strict_entries: List[str] = field(default_factory=list)
    missing_required: List[str] = field(default_factory=list)
    missing_strict: List[str] = field(default_factory=list)
    present_entries: List[Tuple[str, int]] = field(default_factory=list)
    issues: List[str] = field(default_factory=list)
    passed: bool = False


def parse_gitignore(text: str) -> List[GitignoreEntry]:
    """
    解析 .gitignore 文本, 返回结构化条目列表。
    跳过空行和以 # 开头的注释。
    """
    entries: List[GitignoreEntry] = []
    for line_no, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue

        negated = stripped.startswith("!")
        if negated:
            stripped = stripped[1:].strip()

        anchored = stripped.startswith("/")
        pattern = stripped[1:] if anchored else stripped

        is_dir = pattern.endswith("/")

        entries.append(
            GitignoreEntry(
                raw=raw,
                pattern=pattern.rstrip("/"),
                is_dir=is_dir,
                negated=negated,
                anchored=anchored,
                line_no=line_no,
            )
        )
    return entries


def entry_matches(required: str, entries: List[GitignoreEntry]) -> bool:
    """
    检查给定的 required 模式是否被某条 gitignore 规则覆盖。

    覆盖判定逻辑:
      1. 精确字符串匹配 (去除末尾 /)
      2. dir 模式: "__pycache__/" 覆盖 "__pycache__" 和 "__pycache__/"
      3. 否定 (!xxx) 不算覆盖
      4. 通配符: 用 _glob_covers 检查现有规则是否更宽
         (例: existing="*.py[cod]" 覆盖 required="*.pyc")
    """
    required_norm = required.rstrip("/")
    required_is_glob = "*" in required or "?" in required or "[" in required

    for entry in entries:
        if entry.negated:
            continue

        # 精确匹配 (处理末尾 /)
        if entry.pattern == required_norm:
            return True

        # dir 模式: "foo/" 仅匹配目录
        if entry.is_dir and entry.pattern == required_norm:
            return True

        # 现有规则是字面, required 是字面
        if not required_is_glob:
            if entry.is_dir and required_norm.startswith(entry.pattern + "/"):
                return True
            continue

        # 现有规则是通配, required 是通配
        if not entry.is_dir and "*" in entry.pattern:
            if _glob_covers(entry.pattern, required_norm):
                return True

    return False


# ---------------------------------------------------------------------------
# Glob 覆盖判定
# ---------------------------------------------------------------------------

def _tokenize_glob(pat: str):
    """
    把 gitignore glob 拆成 token 流:
      - '*'      -> '*'
      - '[abc]'  -> frozenset({'a', 'b', 'c'})
      - '[a-z]'  -> frozenset(chr range)
      - 其他     -> 字符串
    """
    i = 0
    buf = []
    while i < len(pat):
        ch = pat[i]
        if ch == "*":
            if buf:
                yield "".join(buf)
                buf = []
            yield "*"
            i += 1
        elif ch == "[":
            j = pat.find("]", i + 1)
            if j == -1:
                buf.append(ch)
                i += 1
                continue
            chars = pat[i + 1:j]
            buf_chars = set()
            k = 0
            while k < len(chars):
                if k + 2 < len(chars) and chars[k + 1] == "-":
                    for c in range(ord(chars[k]), ord(chars[k + 2]) + 1):
                        buf_chars.add(chr(c))
                    k += 3
                else:
                    buf_chars.add(chars[k])
                    k += 1
            if buf:
                yield "".join(buf)
                buf = []
            yield frozenset(buf_chars)
            i = j + 1
        else:
            buf.append(ch)
            i += 1
    if buf:
        yield "".join(buf)


def _enumerate_concrete(glob_str: str):
    """
    把含字符类的 glob 展开为所有具体字面形式。
    * 保持为通配符 (不展开, 因为可以匹配任意长)。

    例:
      "*.py[cod]" -> ["*.pyc", "*.pyo", "*.pyd"]
      "foo[a-z]bar" -> ["fooabar", "fobbbar", ...]
    """
    tokens = list(_tokenize_glob(glob_str))
    yield from _enum_tokens(tokens)


def _enum_tokens(tokens):
    """递归展开字符类 token"""
    if not tokens:
        yield ""
        return
    head, *rest = tokens
    if isinstance(head, frozenset):
        for c in sorted(head):
            for tail in _enum_tokens(rest):
                yield c + tail
    else:
        for tail in _enum_tokens(rest):
            yield head + tail


def _glob_covers(existing: str, required: str) -> bool:
    """
    判定 existing 通配模式是否覆盖 required。

    简化算法:
      1. 两边都去掉 * (gitignore 的 * 不跨 /, 实际比对字面前后缀即可)
      2. 展开 existing 的字符类为具体字面
      3. required 的字面是否落在展开集合里

    例:
      "*.py[cod]" covers "*.pyc"  ✓  (字符类包含 c)
      "*.py[cod]" covers "*.pyo"  ✓
      "*.tmp"     does not cover "*.bak"  ✗
    """
    if existing == required:
        return True

    # 把两边的 * 去掉, 只比对字面部分
    e_clean = existing.replace("*", "")
    r_clean = required.replace("*", "")

    # 如果 existing 没有字符类, 只比字面
    if "[" not in e_clean:
        return e_clean == r_clean

    # 展开 existing 的字符类, 检查 required 字面是否在集合里
    for concrete in _enumerate_concrete(e_clean):
        if concrete == r_clean:
            return True

    return False


# ---------------------------------------------------------------------------
# .gitignore 加载
# ---------------------------------------------------------------------------

def load_gitignore(path: Path) -> Tuple[bool, str, List[GitignoreEntry]]:
    """读取并解析 .gitignore, 返回 (exists, text, entries)"""
    if not path.exists():
        return (False, "", [])
    text = path.read_text(encoding="utf-8")
    return (True, text, parse_gitignore(text))


# ---------------------------------------------------------------------------
# 扫描已跟踪的污染源 (git ls-files + glob 匹配)
# ---------------------------------------------------------------------------

GIT_LS_FILES_TIMEOUT = 30


def find_tracked_pollutants(repo_root: Path, pollutant_patterns: List[str]) -> List[str]:
    """
    用 git ls-files 列出仓库里已被跟踪的文件,
    检查其中是否有违反 gitignore 约定的污染源。
    命中时返回文件路径列表 (相对 repo_root)。
    """
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=GIT_LS_FILES_TIMEOUT,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    if result.returncode != 0:
        return []

    tracked = result.stdout.splitlines()
    pollutants: List[str] = []
    compiled: List[re.Pattern] = []
    for pat in pollutant_patterns:
        compiled.append(re.compile(_glob_to_regex(pat)))

    # 对每个 tracked file, 检查其任一路径分量是否命中 pattern (按 / 切分)
    # 因为 gitignore 的 __pycache__ / *.pyc / .DS_Store 是 path-component 级别匹配,
    # 不能简单 c.search(整路径) — 整路径 ^ 锚定会漏掉 src/__pycache__/x.pyc 这种嵌套.
    for f in tracked:
        parts = f.split("/")
        for c in compiled:
            for part in parts:
                if c.match(part):
                    pollutants.append(f)
                    break
            if f in pollutants:
                break
    return pollutants


def _glob_to_regex(pat: str) -> str:
    """
    把 gitignore 风格的 glob 转成正则 (只支持最常见的 * 和字符类)。
    """
    out = ["^"]
    i = 0
    while i < len(pat):
        ch = pat[i]
        if ch == "*":
            out.append("[^/]*")
            i += 1
        elif ch == "?":
            out.append("[^/]")
            i += 1
        elif ch == "[":
            j = pat.find("]", i + 1)
            if j == -1:
                out.append(re.escape(ch))
                i += 1
                continue
            inner = pat[i + 1:j]
            out.append("[")
            out.append(inner)
            out.append("]")
            i = j + 1
        elif ch in r".\+(){}|^$":
            out.append("\\" + ch)
            i += 1
        else:
            out.append(re.escape(ch))
            i += 1
    out.append("$")
    return "".join(out)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def check_repo(repo_root: Path, strict: bool = False) -> CheckResult:
    """执行一次完整校验, 返回结构化结果"""
    gitignore_path = repo_root / ".gitignore"
    exists, text, entries = load_gitignore(gitignore_path)

    result = CheckResult(
        repo_root=str(repo_root.resolve()),
        gitignore_path=str(gitignore_path),
        exists=exists,
        total_lines=len(text.splitlines()) if exists else 0,
        required_entries=list(REQUIRED_ENTRIES),
    )

    if not exists:
        result.issues.append(f".gitignore not found at {gitignore_path}")
        return result

    if strict:
        result.strict_entries = list(STRICT_EXTRA_ENTRIES)

    # 检查必需条目
    for req in REQUIRED_ENTRIES:
        matched_line = None
        for e in entries:
            if e.negated:
                continue
            req_norm = req.rstrip("/")
            if e.pattern == req_norm:
                matched_line = e.line_no
                break
            if e.is_dir and e.pattern == req_norm:
                matched_line = e.line_no
                break
            if "*" in e.pattern and _glob_covers(e.pattern, req_norm):
                matched_line = e.line_no
                break

        if matched_line is not None:
            result.present_entries.append((req, matched_line))
        else:
            result.missing_required.append(req)

    # 严格模式: 检查额外条目
    if strict:
        for req in STRICT_EXTRA_ENTRIES:
            if not entry_matches(req, entries):
                result.missing_strict.append(req)

    # 扫描已跟踪的污染源
    pollutants = find_tracked_pollutants(
        repo_root,
        ["__pycache__", "*.pyc", "*.pyo", ".DS_Store", "Thumbs.db"],
    )
    if pollutants:
        shown = pollutants[:5]
        result.issues.append(
            f"发现 {len(pollutants)} 个已被 git 跟踪的污染文件 "
            f"(示例: {', '.join(shown)}{'...' if len(pollutants) > 5 else ''})"
        )

    result.passed = (
        not result.missing_required
        and (not strict or not result.missing_strict)
        and not result.issues
    )
    return result


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------

def print_human(result: CheckResult) -> None:
    """人类可读输出"""
    print(f"=== palette gitignore check ===")
    print(f"repo:    {result.repo_root}")
    print(f"file:    {result.gitignore_path} ({'found' if result.exists else 'MISSING'})")
    print(f"lines:   {result.total_lines}")
    print()

    if not result.exists:
        print("[FAIL] .gitignore 不存在")
        return

    print(f"必需条目 (required): {len(result.required_entries)} 项")
    present_map = dict(result.present_entries)
    for req in result.required_entries:
        if req in present_map:
            print(f"  [PASS] {req:30s} (line {present_map[req]})")
        else:
            print(f"  [MISS] {req:30s}")

    if result.strict_entries:
        print()
        print(f"严格模式额外条目: {len(result.strict_entries)} 项")
        for req in result.strict_entries:
            if req in result.missing_strict:
                print(f"  [MISS] {req}")
            else:
                print(f"  [PASS] {req}")

    if result.issues:
        print()
        print("[ISSUES]")
        for issue in result.issues:
            print(f"  - {issue}")

    print()
    if result.passed:
        print("[OK] palette gitignore check 通过")
    else:
        miss = result.missing_required + result.missing_strict
        print(f"[FAIL] 缺失 {len(miss)} 项必需覆盖: {', '.join(miss)}")


def print_json(result: CheckResult) -> None:
    """JSON 输出, CI 集成友好"""
    payload = asdict(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _resolve_repo_root(arg_root: str | None) -> Path:
    """解析仓库根目录: 优先级 --root > 脚本父目录的 .git/README 探测"""
    if arg_root:
        return Path(arg_root)
    script_dir = Path(__file__).resolve().parent
    # 脚本位于 <repo>/tools/, 仓库根是父目录
    repo_root = script_dir.parent
    # 如果父目录没有 .git 也没有 README, 往上找一层 (兼容 <repo>/scripts/)
    if not (repo_root / ".git").exists() and not (repo_root / "README.md").exists():
        candidate = repo_root.parent
        if (candidate / ".git").exists() or (candidate / "README.md").exists():
            repo_root = candidate
    return repo_root


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="CI check: 校验仓库 .gitignore 是否覆盖开发工具常见污染源",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="仓库根目录 (默认: 脚本父目录, 即 wildwood/)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="严格模式: 额外要求覆盖 IDE 缓存、虚拟环境、lock 文件等",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="输出 JSON 格式 (CI 集成)",
    )
    parser.add_argument(
        "--print-required",
        action="store_true",
        help="只打印必需条目列表 (供 setup 阶段生成 .gitignore 用)",
    )

    args = parser.parse_args(argv)

    if args.print_required:
        for r in REQUIRED_ENTRIES:
            print(r)
        return 0

    repo_root = _resolve_repo_root(args.root)

    if not repo_root.is_dir():
        print(f"[ERROR] repo root 不是目录: {repo_root}", file=sys.stderr)
        return 3

    result = check_repo(repo_root, strict=args.strict)

    if args.json:
        print_json(result)
    else:
        print_human(result)

    if not result.exists:
        return 2
    if not result.passed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
