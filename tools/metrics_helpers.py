#!/usr/bin/env python3
"""
metrics_helpers.py — Wildwood 统一 metrics 写入/读取 helper (v0.8.0d)

v0.8 起强制规范:
  - 每条 metric 必须带 source / schema_version 字段
  - 按脚本拆分为 metrics/<script>.jsonl,append-only
  - 自动过滤测试 fixture (sim / historical / 无 source 的脏数据)
  - 读取自动 fallback 到 shared 旧文件(向后兼容)

设计原则:
  - 路径优先 metrics/<script>.jsonl(本地+CI 统一)
  - 缺目录自动创建
  - 写失败 stderr 警告但不抛异常(不影响主流程)
  - 提供 per-script 读写 API,避免跨脚本污染

用法:
    from metrics_helpers import write_metric, read_recent, SCRIPT_SOURCE

    write_metric(
        status="ok", duration_seconds=2.5,
        commit_count=1, task_count=73, commit_sha="abc123",
    )
    recent = read_recent(n=10)
"""
from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


# === 路径解析 ===
def _resolve_metrics_dir() -> Path:
    """
    解析 metrics 目录路径,优先级:
      1. WILDSWOOD_METRICS_DIR 环境变量(显式覆盖)
      2. <repo>/metrics/  (CI 在仓库根目录)
      3. ~/.aily/workspace/wildwood/metrics/  (本地开发)
      4. ~/.aily/workspace/metrics/  (向后兼容)
    """
    override = os.environ.get("WILDSWOOD_METRICS_DIR", "").strip()
    if override:
        return Path(override)

    # CI / 仓库根目录
    cwd_metrics = Path.cwd() / "metrics"
    if (cwd_metrics.parent / ".git").exists() or os.environ.get("GITHUB_ACTIONS") == "true":
        return cwd_metrics

    # 本地开发
    workspace_wildwood = Path.home() / ".aily" / "workspace" / "wildwood" / "metrics"
    if workspace_wildwood.parent.exists():
        return workspace_wildwood

    # 兜底
    return Path.home() / ".aily" / "workspace" / "metrics"


METRICS_DIR = _resolve_metrics_dir()
SCHEMA_VERSION = "1.0"

# 已知非真实数据的污染源(source 字段值)
_EXCLUDED_SOURCES = {"sync_roadmap.py", "sync_main.py"}
_EXCLUDED_ERROR_TOKENS = {"sim", "historical"}


def get_script_source() -> str:
    """从调用方 __file__ 自动推断 source,失败时回退到 SCRIPT_SOURCE env 或 'unknown.py'。"""
    # 优先看 env(测试场景)
    env_src = os.environ.get("WILDSWOOD_SCRIPT_SOURCE", "").strip()
    if env_src:
        return env_src

    # 退而求其次:从 import 栈中找主模块
    try:
        import inspect
        frame = inspect.currentframe().f_back
        while frame:
            fname = frame.f_code.co_filename
            if fname and not fname.endswith(("metrics_helpers.py", "startup_check.py")):
                return Path(fname).name
            frame = frame.f_back
    except Exception:
        pass
    return "unknown.py"


def _metrics_path(source: str) -> Path:
    """返回 source 脚本对应的 metrics 文件路径。"""
    return METRICS_DIR / f"{source.replace('.py', '')}.jsonl"


def write_metric(
    source: str,
    status: str,
    duration_seconds: float,
    commit_count: int = 0,
    task_count: int = 0,
    commit_sha: str = "",
    error: str = "",
    extras: Optional[Dict] = None,
) -> Dict:
    """
    写一条 metric 到 metrics/<source>.jsonl(append-only)。

    自动添加:
      - ts          ISO 8601 UTC 时间戳
      - source      写入脚本名
      - schema_version  "1.0"

    Args:
        source:        写入脚本名(如 "update_roadmap.py")
        status:        "ok" | "fail"
        duration_seconds: 同步耗时
        commit_count:  本轮 commit 数
        task_count:    本轮处理任务数
        commit_sha:    GitHub commit SHA(成功时)
        error:         错误信息(失败时)
        extras:        其它要写进 jsonl 的字段

    Returns:
        写入的 record dict
    """
    record = {
        "ts": _now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "status": status,
        "duration_seconds": round(duration_seconds, 3),
        "commit_count": commit_count,
        "task_count": task_count,
        "commit_sha": commit_sha,
        "error": error,
    }
    if extras:
        record.update(extras)

    path = _metrics_path(source)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"  WARN: 写 {path} 失败: {e}", file=sys.stderr)
    return record


def _is_real_metric(rec: dict) -> bool:
    """过滤:保留 source=expected 的 + 没 source 字段的(legacy 兼容)。"""
    src = rec.get("source", "")
    err = rec.get("error", "")
    if src in _EXCLUDED_SOURCES:
        return False
    if err in _EXCLUDED_ERROR_TOKENS:
        return False
    return True


def read_recent(
    source: str,
    n: int = 10,
    include_legacy: bool = True,
    legacy_path: Optional[Path] = None,
) -> List[Dict]:
    """
    读 source 脚本的最近 n 条 metrics。

    默认只读 metrics/<source>.jsonl(新规范路径)。
    include_legacy=True 时,合并读 ~/.aily/workspace/sync_metrics.jsonl 的老条目
    (向后兼容 v0.7 之前的数据)。

    Args:
        source:         脚本名
        n:              返回最多 n 条
        include_legacy: 是否合并读 legacy 共享文件
        legacy_path:    legacy 共享文件路径(默认 ~/.aily/workspace/sync_metrics.jsonl)

    Returns:
        按 ts 升序的 record 列表
    """
    candidates = [_metrics_path(source)]
    if include_legacy:
        legacy = legacy_path or (Path.home() / ".aily" / "workspace" / "sync_metrics.jsonl")
        if legacy.exists() and legacy not in candidates:
            candidates.append(legacy)

    out: List[Dict] = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                raw = f.read().replace("\x00", "").strip()
            for ln in raw.splitlines():
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    rec = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                # 只保留 source 匹配 + 没 source 的(legacy)
                rec_src = rec.get("source", "")
                if rec_src and rec_src != source:
                    continue
                if not _is_real_metric(rec):
                    continue
                out.append(rec)
        except Exception as e:
            print(f"  WARN: 读 {path} 失败: {e}", file=sys.stderr)

    # 按 ts 字典序排序(ISO 时间)
    out.sort(key=lambda r: r.get("ts", ""))
    return out[-n:] if len(out) > n else out


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_status(source: str = "update_roadmap.py", red_threshold: int = 3) -> dict:
    """
    派生 source 脚本的 status badge。

    逻辑:
      - 读最近 20 条
      - 连续 fail 数 ≥ red_threshold → red
      - 否则最新是 ok → green
      - 否则 → yellow
    """
    recent = read_recent(source, n=20)
    if not recent:
        return {"status": "red", "label": "无同步记录", "consecutive_failures": 0,
                "last_sync_iso": "", "last_sync_age": "无记录"}

    last = recent[-1]
    consec = 0
    for rec in reversed(recent):
        if rec.get("status") == "fail":
            consec += 1
        else:
            break

    last_ts = last.get("ts", "")
    try:
        last_dt = datetime.strptime(last_ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        from datetime import datetime as _dt
        age_min = (_dt.now(timezone.utc) - last_dt).total_seconds() / 60.0
        if age_min < 60:
            age_str = f"{int(age_min)}m 前"
        elif age_min < 60 * 24:
            age_str = f"{int(age_min // 60)}h 前"
        else:
            age_str = f"{int(age_min // (60 * 24))}d 前"
    except Exception:
        age_str = "未知"

    if consec >= red_threshold:
        status, label = "red", "同步异常"
    elif last.get("status") != "ok":
        status, label = "yellow", "同步滞后"
    else:
        status, label = "green", "同步正常"

    return {
        "status": status,
        "label": label,
        "consecutive_failures": consec,
        "last_sync_iso": last_ts,
        "last_sync_age": age_str,
    }


if __name__ == "__main__":
    # 手动调试
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--source", default="update_roadmap.py")
    p.add_argument("--read", type=int, default=5, help="读最近 n 条")
    p.add_argument("--status", action="store_true", help="打印 status badge")
    args = p.parse_args()

    if args.read:
        recent = read_recent(args.source, n=args.read)
        print(f"[{args.source}] 最近 {len(recent)} 条:")
        for r in recent:
            print(f"  {r.get('ts')}  {r.get('status'):4}  dur={r.get('duration_seconds')}s  err={r.get('error', '')[:50]}")
    if args.status:
        b = compute_status(args.source)
        print(f"\nStatus: {b['status']}  ({b['label']})")
        print(f"  consecutive_failures: {b['consecutive_failures']}")
        print(f"  last_sync: {b['last_sync_iso']} ({b['last_sync_age']})")
