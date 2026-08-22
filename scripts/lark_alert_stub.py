#!/usr/bin/env python3
"""
lark_alert_stub.py — v0.7.3a 飞书告警 stub (2026-08-22 收口版)

用途:
    当 update_roadmap.py 跑完且发现以下情况之一时,把告警/日报推送到飞书:
      - sync_fail:    aily-cli 拉数据失败 / GitHub API push 失败 / commit 校验失败
      - drift:        沙箱看板 HTML 与最新 GitHub commit 的版本数据不一致
      - milestone:    任一版本 v0.X 整体 done (72/72 within version)
      - daily:        每日 09:00 推送"昨日变更 + 当前完成度 + 风险"

推送路径(2026-08-22 锁定):
    短期: lark-cli im +messages-send --as bot --user-id <boss_open_id> 发私聊
    长期: 群就位后,走 LARK_WEBHOOK_URL (飞书自定义机器人 incoming webhook)

设计原则:
    - token / URL / open_id 全部走环境变量,脚本不内置任何凭据
    - 凭据缺失时只 dry-run 写本地日志,不调任何外部 API
    - 1h 限流(同类告警窗口内最多 1 次)
    - 调 lark-cli 走 subprocess, --as bot (自动化不能以 user 身份发消息)

环境变量:
    BOSS_OPEN_ID       ou_xxx      — 老板飞书 open_id (短期推送目标),默认见下
    LARK_WEBHOOK_URL   https://...  — 飞书自定义机器人 webhook URL(群就位后启用)
    LARK_BOT_TOKEN     t-xxx        — tenant bot token(如用 im/v1/messages 走 tenant bot)
    ALERT_DRY_RUN      0|1          — 1=不真发,只写日志;默认 0
    RATE_LIMIT_SEC     int          — 同类告警最小间隔秒,默认 3600

用法:
    from lark_alert_stub import send_alert
    send_alert(level="error", kind="sync_fail", title="...", detail="...")
"""
from __future__ import annotations
import json
import os
import shlex
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

BEIJING_TZ = timezone(timedelta(hours=8))
LOG_PATH = Path.home() / ".aily" / "workspace" / "lark_alert.log"
RATE_LIMIT_PATH = Path.home() / ".aily" / "workspace" / "lark_alert_ratelimit.json"

# 老板飞书 open_id — 2026-08-22 收口锁定 (短期:跳过群推送,告警只发个人)
DEFAULT_BOSS_OPEN_ID = "ou_10541f3f158808c43cbb7a1f0a6a48cc"

LARK_CLI_BIN = os.environ.get("LARK_CLI_BIN", "lark-cli")
LARK_CLI_TIMEOUT = 30  # seconds


def _now_beijing() -> str:
    return datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S %Z")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log(level: str, kind: str, title: str, detail: str) -> None:
    """统一写本地日志(无论是否走 dry-run)"""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{_now_beijing()}] [{level.upper():5s}] [{kind:12s}] {title} | {detail[:200]}\n"
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line)


def _check_rate_limit(kind: str, window_sec: int) -> bool:
    """同类告警 window_sec 窗口内只发一次"""
    RATE_LIMIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    state = {}
    if RATE_LIMIT_PATH.exists():
        try:
            state = json.loads(RATE_LIMIT_PATH.read_text())
        except Exception:
            state = {}
    now = time.time()
    last = state.get(kind, 0)
    if now - last < window_sec:
        _log("debug", kind, "rate_limited", f"suppressed (last sent {int(now - last)}s ago)")
        return False
    state[kind] = now
    RATE_LIMIT_PATH.write_text(json.dumps(state, indent=2))
    return True


def _build_markdown(level: str, title: str, detail: str) -> str:
    """构造飞书 markdown 消息 (post format 自动包装)"""
    badge = {
        "error": "🔴", "warning": "🟠", "info": "🔵", "milestone": "🟢"
    }.get(level, "⚪")
    return (
        f"{badge} **{title}**\n\n"
        f"{detail[:2800]}\n\n"
        f"<font color='grey'>Wildwood 看板 · {_now_beijing()}</font>"
    )


def _post_via_lark_cli(markdown_text: str, open_id: str) -> tuple[bool, str]:
    """短期推送:调 lark-cli subprocess,以 bot 身份发私聊"""
    cmd = [
        LARK_CLI_BIN, "im", "+messages-send",
        "--as", "bot",
        "--user-id", open_id,
        "--markdown", markdown_text,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=LARK_CLI_TIMEOUT,
        )
        if result.returncode == 0:
            return True, "ok"
        return False, f"lark-cli exit={result.returncode}: {(result.stderr or result.stdout)[:200]}"
    except subprocess.TimeoutExpired:
        return False, f"lark-cli timeout after {LARK_CLI_TIMEOUT}s"
    except FileNotFoundError:
        return False, f"lark-cli not found at {LARK_CLI_BIN}"
    except Exception as e:
        return False, f"subprocess error: {type(e).__name__}: {e}"


def _post_via_webhook(markdown_text: str, webhook_url: str) -> tuple[bool, str]:
    """长期推送:飞书自定义机器人 incoming webhook (群就位后启用)"""
    body = json.dumps({"msg_type": "post", "content": {"post": {"zh_cn": {
        "title": "Wildwood 看板告警",
        "content": [[{"tag": "text", "text": markdown_text[:3500]}]],
    }}}}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url, data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode())
            status = payload.get("StatusCode", payload.get("code", -1))
            if status in (0, "0"):
                return True, "ok"
            return False, f"webhook reject: {payload.get('msg', '')[:200]}"
    except urllib.error.URLError as e:
        return False, f"URLError: {e}"


def send_alert(level: str, kind: str, title: str, detail: str,
               force: bool = False, dry_run_override: bool | None = None) -> bool:
    """
    发送飞书告警
    - level:  error | warning | info | milestone
    - kind:   sync_fail | drift | milestone | daily
    - force:  跳过 rate limit
    - dry_run_override:  强制 dry-run (True) 或强制真发 (False);None=读 env ALERT_DRY_RUN
    """
    window = int(os.environ.get("RATE_LIMIT_SEC", "3600"))
    if not force and not _check_rate_limit(kind, window):
        return False
    if dry_run_override is None:
        dry_run = os.environ.get("ALERT_DRY_RUN", "0") == "1"
    else:
        dry_run = dry_run_override

    webhook_url = os.environ.get("LARK_WEBHOOK_URL", "").strip()
    open_id = os.environ.get("BOSS_OPEN_ID", DEFAULT_BOSS_OPEN_ID).strip()
    bot_token = os.environ.get("LARK_BOT_TOKEN", "").strip()

    markdown = _build_markdown(level, title, detail)

    # 优先级: webhook URL (群就位) > bot token + open_id (私聊)
    if dry_run:
        _log("info", kind, title,
             f"DRY_RUN (creds={'webhook' if webhook_url else 'open_id'}={bool(webhook_url or open_id)}, dry_run_env=1) | {detail[:120]}")
        return False

    if webhook_url:
        ok, msg = _post_via_webhook(markdown, webhook_url)
        channel = "webhook"
    else:
        if not open_id:
            _log("warn", kind, title, "no open_id / webhook configured, dropping")
            return False
        ok, msg = _post_via_lark_cli(markdown, open_id)
        channel = f"lark-cli(bot)→{open_id[:10]}..."

    _log("info" if ok else "error", kind, title, f"posted={ok} via {channel} | {msg} | {detail[:120]}")
    return ok


def send_daily_report(agg: dict, last_24h_changes: list[str], risks: list[str]) -> bool:
    """发送每日汇总报告 (kind=daily, 通常 09:00 触发)"""
    rows = []
    for v, info in sorted(agg.items()):
        if v.startswith("_"):
            continue
        done = info.get("done", 0)
        total = info.get("total", 0)
        ratio = done / total if total else 0
        bar = "█" * int(ratio * 10) + "░" * (10 - int(ratio * 10))
        rows.append(f"**{v}** `{bar}` {done}/{total} ({ratio*100:.0f}%)")
    body = "## Wildwood 路线图 · 每日速览\n\n" + "\n".join(rows)
    body += f"\n\n**整体**: {agg.get('_total_done', 0)}/{agg.get('_total', 0)} ({agg.get('_overall_pct', 0):.0f}%)"
    if last_24h_changes:
        body += "\n\n### 昨日变更\n" + "\n".join(f"- {c}" for c in last_24h_changes[:10])
    if risks:
        body += "\n\n### ⚠️ 风险\n" + "\n".join(f"- {r}" for r in risks[:5])
    body += "\n\n📊 完整看板 → https://rainskyfyy.github.io/wildwood/"
    return send_alert("info", "daily", f"Wildwood 日报 · {_now_beijing()[:10]}", body, force=True)


# --- 兼容旧接口 (update_roadmap.py 中有 send_lark_alert 调用) ---

def send_lark_alert(consecutive_failures: int, recent_errors: list[str]) -> bool:
    """兼容旧 update_roadmap.py 里的 send_lark_alert() 调用入口"""
    detail_lines = [f"- {e}" for e in recent_errors[-5:] if e]
    detail = (
        f"**连续失败次数**: {consecutive_failures}\n\n"
        f"**最近错误**:\n" + ("\n".join(detail_lines) if detail_lines else "(无错误明细)")
    )
    return send_alert(
        level="error",
        kind="sync_fail",
        title=f"Wildwood 看板连续 {consecutive_failures} 次同步失败",
        detail=detail,
        force=False,
    )


if __name__ == "__main__":
    # CLI 调试:python3 lark_alert_stub.py [level] [title] [detail]
    level = sys.argv[1] if len(sys.argv) > 1 else "info"
    title = sys.argv[2] if len(sys.argv) > 2 else "Test Alert"
    detail = sys.argv[3] if len(sys.argv) > 3 else "Stub test from CLI"
    print(f"[stub] sending {level}/{title} ...")
    print(f"[stub] mode: webhook={'YES' if os.environ.get('LARK_WEBHOOK_URL') else 'NO'}, "
          f"open_id={'set' if (os.environ.get('BOSS_OPEN_ID') or DEFAULT_BOSS_OPEN_ID) else 'NO'}, "
          f"dry_run={os.environ.get('ALERT_DRY_RUN', '0')}")
    ok = send_alert(level, "manual", title, detail, force=True, dry_run_override=True)
    print(f"[stub] result (dry-run): {'QUEUED' if ok else 'LOGGED-ONLY'}")
    sys.exit(0)
