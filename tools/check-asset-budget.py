#!/usr/bin/env python3
"""
check-asset-budget.py
=====================

扫 `assets/` 下的 PNG，根据体积给出 fail / warning / ok 三档。
- > 500KB → FAIL（CI 应 fail）
- 50KB–500KB → WARNING（CI 告警 / 需 review）
- ≤ 50KB → OK

支持两种扫描模式：
1. **本地模式**(默认)：扫当前 cwd 下的 `assets/art/`。适合 pre-commit / 本地校验。
2. **GitHub 模式**(`--github` + `--ref <ref>`)：通过 Git Trees API 扫远端仓库的
   `assets/art/`。沙箱内无 git 凭证也能跑。结果不下载文件本体，只取 size，
   不能给出"压缩比"细节，但能给出 fail / warning 列表与总占用。

依赖：stdlib only。`--analyze` 选项会读 PNG IHDR 给尺寸/位深/色彩模式，依赖 Pillow。
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import urllib.request
from pathlib import Path
from typing import Iterator, NamedTuple

default_fail = 500 * 1024
default_warn = 50 * 1024
REPO_DEFAULT = "rainskyfyy/wildwood"

# PNG signature + IHDR chunk header size
_PNG_SIG = b"\x89PNG\r\n\x1a\n"
_IHDR_PEEK = 8 + 25  # sig(8) + IHDR(25) gives W/H/bit_depth/color_type

# color_type to channel-bytes lookup
_CT_BYTES = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
_CT_NAME = {0: "Grayscale", 2: "RGB", 3: "Palette", 4: "Grayscale+Alpha", 6: "RGBA"}


class Finding(NamedTuple):
    path: str
    size: int
    width: int | None
    height: int | None
    bit_depth: int | None
    color_type: int | None
    color_type_name: str | None
    bytes_per_pixel_uncompressed: int | None
    compression_ratio: float | None
    severity: str  # FAIL / WARN / OK


def _png_ihdr(path: Path) -> dict:
    """Read only the first 33 bytes of a PNG to extract IHDR without full decode."""
    try:
        with path.open("rb") as f:
            head = f.read(_IHDR_PEEK)
    except OSError:
        return {}
    if len(head) < _IHDR_PEEK or head[:8] != _PNG_SIG:
        return {}
    # IHDR data starts at offset 16, is 13 bytes:
    w, h, bd, ct = struct.unpack(">IIBB", head[16:26])
    bpp = _CT_BYTES.get(ct)
    return {
        "width": w,
        "height": h,
        "bit_depth": bd,
        "color_type": ct,
        "color_type_name": _CT_NAME.get(ct, "unknown"),
        "bytes_per_pixel": bpp,
    }


def _iter_local_pngs(root: Path) -> Iterator[Path]:
    for p in root.rglob("*.png"):
        if p.is_file():
            yield p


def _iter_github_pngs(repo: str, ref: str) -> Iterator[dict]:
    """Yield {path, size} entries via recursive tree API. No file bodies."""
    url = f"https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1"
    with urllib.request.urlopen(url, timeout=60) as r:
        data = json.load(r)
    if data.get("truncated"):
        print(
            "[warn] tree response was truncated; consider a smaller ref or split scan",
            file=sys.stderr,
        )
    for t in data.get("tree", []):
        if (
            t.get("type") == "blob"
            and t.get("path", "").startswith("assets/")
            and t.get("path", "").lower().endswith(".png")
        ):
            yield {"path": t["path"], "size": t["size"]}


def _classify(size: int, fail: int, warn: int) -> str:
    if size > fail:
        return "FAIL"
    if size > warn:
        return "WARN"
    return "OK"


def scan_local(root: Path, analyze: bool, fail_t: int, warn_t: int) -> list[Finding]:
    out: list[Finding] = []
    for p in _iter_local_pngs(root):
        size = p.stat().st_size
        ihdr = _png_ihdr(p) if analyze else {}
        ratio = None
        if ihdr.get("width") and ihdr.get("bytes_per_pixel"):
            uncompressed = ihdr["width"] * ihdr["height"] * ihdr["bytes_per_pixel"]
            ratio = round(size / uncompressed * 100, 2) if uncompressed else None
        try:
            rel = str(p.relative_to(root.parent if root.name == "art" else root))
        except ValueError:
            rel = str(p)
        out.append(
            Finding(
                path=rel,
                size=size,
                width=ihdr.get("width"),
                height=ihdr.get("height"),
                bit_depth=ihdr.get("bit_depth"),
                color_type=ihdr.get("color_type"),
                color_type_name=ihdr.get("color_type_name"),
                bytes_per_pixel_uncompressed=ihdr.get("bytes_per_pixel"),
                compression_ratio=ratio,
                severity=_classify(size, fail_t, warn_t),
            )
        )
    return out


def scan_github(repo: str, ref: str, fail_t: int, warn_t: int) -> list[Finding]:
    out: list[Finding] = []
    for entry in _iter_github_pngs(repo, ref):
        size = entry["size"]
        out.append(
            Finding(
                path=entry["path"],
                size=size,
                width=None,
                height=None,
                bit_depth=None,
                color_type=None,
                color_type_name=None,
                bytes_per_pixel_uncompressed=None,
                compression_ratio=None,
                severity=_classify(size, fail_t, warn_t),
            )
        )
    return out


def render_table(findings: list[Finding], show_only: str | None) -> str:
    if show_only:
        findings = [f for f in findings if f.severity == show_only]
    findings = sorted(findings, key=lambda f: -f.size)
    lines = []
    header = (
        f"{'Sev':<5}  {'Size':>10}  {'WxH':>11}  {'Mode':<8}  "
        f"{'bpp':>3}  {'ratio':>6}  Path"
    )
    lines.append(header)
    lines.append("-" * len(header))
    for f in findings:
        wh = f"{f.width}x{f.height}" if f.width and f.height else "-"
        mode = f.color_type_name or "-"
        bpp = str(f.bytes_per_pixel_uncompressed) if f.bytes_per_pixel_uncompressed else "-"
        ratio = f"{f.compression_ratio}%" if f.compression_ratio is not None else "-"
        lines.append(
            f"{f.severity:<5}  {f.size/1024:>8.1f}KB  {wh:>11}  {mode:<8}  "
            f"{bpp:>3}  {ratio:>6}  {f.path}"
        )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--root", default="assets/art", help="local scan root (default: assets/art)")
    ap.add_argument("--github", action="store_true", help="scan remote via Git Trees API")
    ap.add_argument("--repo", default=REPO_DEFAULT, help="github repo (default: %(default)s)")
    ap.add_argument("--ref", default="main", help="git ref (default: main)")
    ap.add_argument("--analyze", action="store_true", help="read IHDR for each file (local only)")
    ap.add_argument("--fail-threshold", type=int, default=default_fail,
                    help="FAIL threshold in bytes (default: 500KB)")
    ap.add_argument("--warn-threshold", type=int, default=default_warn,
                    help="WARN threshold in bytes (default: 50KB)")
    ap.add_argument("--format", choices=["table", "json", "summary"], default="table")
    ap.add_argument("--show", choices=["FAIL", "WARN", "OK"], help="filter to one severity")
    ap.add_argument("--max-fail", type=int, default=0,
                    help="exit 1 if more than N FAIL (default: 0 = any)")
    args = ap.parse_args()

    fail_t = args.fail_threshold
    warn_t = args.warn_threshold

    if args.github:
        findings = scan_github(args.repo, args.ref, fail_t, warn_t)
    else:
        root = Path(args.root)
        if not root.exists():
            print(f"[error] root not found: {root}", file=sys.stderr)
            return 2
        findings = scan_local(root, args.analyze, fail_t, warn_t)

    fails = [f for f in findings if f.severity == "FAIL"]
    warns = [f for f in findings if f.severity == "WARN"]
    oks = [f for f in findings if f.severity == "OK"]
    total = sum(f.size for f in findings)

    if args.format == "json":
        print(json.dumps({
            "summary": {
                "total": len(findings),
                "fail": len(fails),
                "warn": len(warns),
                "ok": len(oks),
                "total_bytes": total,
                "total_mb": round(total / 1024 / 1024, 2),
                "fail_threshold_bytes": fail_t,
                "warn_threshold_bytes": warn_t,
            },
            "findings": [f._asdict() for f in findings],
        }, indent=2))
    elif args.format == "summary":
        print(f"Total PNGs:  {len(findings)}")
        print(f"  FAIL (>={fail_t//1024}KB):   {len(fails)}")
        print(f"  WARN (>={warn_t//1024}KB):   {len(warns)}")
        print(f"  OK   (<{warn_t//1024}KB):    {len(oks)}")
        print(f"Total size:  {total/1024/1024:.2f} MB")
        if fails:
            worst = max(fails, key=lambda f: f.size)
            print(f"Worst:       {worst.path} ({worst.size/1024/1024:.2f} MB)")
    else:
        print(render_table(findings, args.show))
        print()
        print(
            f"FAIL: {len(fails)}  WARN: {len(warns)}  OK: {len(oks)}  "
            f"TOTAL: {len(findings)} files, {total/1024/1024:.2f} MB"
        )

    if args.max_fail == 0 and fails:
        return 1
    if 0 < args.max_fail < len(fails):
        print(f"[error] {len(fails)} FAILs exceed max-fail={args.max_fail}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
