#!/usr/bin/env python3
"""
sync_roadmap.py — Wildwood 路线图最小同步脚本 (v0.8.0d metrics hygiene)

v0.8.0d 统一 metrics 规范:
  - 走 tools/metrics_helpers.write_metric (append-only + schema_version + source)
  - 启动期走 tools/startup_check fail-fast 校验
  - 写 metrics/sync_roadmap.jsonl (按脚本拆分)

历史背景:
  - sync_roadmap.py 在 v0.6.x 时是 v0.7.3a 看板 sync-badge 误报红的污染源之一
  - v0.8.0d 起所有 metrics 拆分文件,此脚本作为占位以保持 metrics/sync_roadmap.jsonl 文件存在
  - 真实生产同步由 update_roadmap.py + sync_main.py 完成

用法:
  python3 sync_roadmap.py [--dry-run] [--strict]
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

# === v0.8.0d: 接入 tools/ ===
_TOOLS_DIR = Path(__file__).resolve().parent / "tools"
if _TOOLS_DIR.is_dir():
    sys.path.insert(0, str(_TOOLS_DIR))
else:
    for alt in Path.home().glob(".aily/workspace/wildwood*"):
        if (alt / "tools").is_dir():
            sys.path.insert(0, str(alt / "tools"))
            break
try:
    from metrics_helpers import write_metric, read_recent
    from startup_check import check_credentials_or_exit
    _HAS_TOOLS = True
except ImportError as e:
    _HAS_TOOLS = False
    print(f"  WARN: tools/ 未找到 ({e})", file=sys.stderr)


SCRIPT_SOURCE = "sync_roadmap.py"

# v0.8.0d: 已知测试 fixture 过滤(避免被污染)
_EXCLUDED_SOURCES = {"sync_roadmap.py", "sync_main.py", "update_roadmap.py"}
_EXCLUDED_ERROR_TOKENS = {"sim", "historical"}


def _is_real_metric(rec):
    """占位: 历史兼容,实际过滤由 metrics_helpers.read_recent 统一处理。"""
    src = rec.get("source", "")
    err = rec.get("error", "")
    if src in _EXCLUDED_SOURCES and src != SCRIPT_SOURCE:
        return False
    if err in _EXCLUDED_ERROR_TOKENS:
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Wildwood 路线图同步占位脚本 v0.8.0d")
    parser.add_argument("--dry-run", action="store_true", help="只写 metrics,不动 HTML")
    parser.add_argument("--strict", action="store_true", help="v0.8 严格模式: 缺凭据立即退出 2")
    args = parser.parse_args()

    will_push = False  # 此脚本是占位,不真推 commit
    will_alert = True
    if args.strict or _HAS_TOOLS:
        check_credentials_or_exit(push=will_push, alert=will_alert, script_name=__file__)

    start = time.time()
    error_msg = ""
    status = "ok"
    commit_count = 0
    task_count = 0
    commit_sha = ""

    print(f"=== Wildwood sync_roadmap 占位运行 v0.8.0d ===")
    print(f"  dry_run: {args.dry_run}")
    print(f"  strict:  {args.strict}")
    print(f"  SCRIPT_SOURCE: {SCRIPT_SOURCE}")

    try:
        if args.dry_run:
            print("  [DRY-RUN] 不做任何同步,仅写一条 ok metric")
            task_count = 0
        else:
            # 真实同步: 这里原本是 fetch 父任务 + 推 HTML,占位版本直接空跑
            print("  [PLACEHOLDER] 真实同步请用 update_roadmap.py;此脚本仅维护 metrics/sync_roadmap.jsonl")
    except Exception as e:
        status = "fail"
        error_msg = f"{type(e).__name__}: {e}"
        print(f"  FAILED: {error_msg}", file=sys.stderr)

    duration = time.time() - start
    print(f"  duration: {duration:.2f}s, status: {status}")

    # v0.8.0d: 走 metrics_helpers
    if _HAS_TOOLS:
        write_metric(
            source=SCRIPT_SOURCE,
            status=status,
            duration_seconds=duration,
            commit_count=commit_count,
            task_count=task_count,
            commit_sha=commit_sha,
            error=error_msg,
        )
        print(f"  ✓ metric 已写入 metrics/{SCRIPT_SOURCE.replace('.py','')}.jsonl")
    else:
        # 兜底: 仍保留一个无 source 的最小记录(只为了不让文件消失)
        path = Path.home() / ".aily" / "workspace" / "metrics" / "sync_roadmap.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            rec = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": SCRIPT_SOURCE,
                "status": status,
                "duration_seconds": round(duration, 3),
                "commit_count": commit_count,
                "task_count": task_count,
                "commit_sha": commit_sha,
                "error": error_msg,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"  ✓ 降级写 {path}")

    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
