#!/usr/bin/env python3
"""
startup_check.py — Wildwood 脚本启动期 fail-fast 校验 (v0.8.0d)

用途:
    看板/同步脚本启动时立即检查关键凭据是否就位,缺则立即退出码 2,
    避免 v0.7.3a 那种 GH_TOKEN 缺失导致 7 次连跑空转的事故。

校验规则:
    - push=True 时,GH_TOKEN 必填
    - alert=True 时,BOSS_OPEN_ID / LARK_WEBHOOK_URL 至少一个必填
    - 缺凭据 → 打印清晰诊断 + exit(2)
    - 凭据就位 → 打印状态行 + 继续

用法(在脚本入口):
    from startup_check import check_credentials_or_exit
    check_credentials_or_exit(push=will_push, alert=will_alert, script_name=__file__)

退出码:
    0  全部凭据就位(继续执行)
    2  缺凭据(已打印诊断,直接退出)

环境变量:
    GH_TOKEN          GitHub PAT (push 时必填)
    BOSS_OPEN_ID      飞书个人 open_id (短期推送目标)
    LARK_WEBHOOK_URL  飞书自定义机器人 webhook URL (长期方案)
    LARK_BOT_TOKEN    飞书应用 bot token (Open API 备选)
    ALERT_DRY_RUN     "1" 强制 dry-run
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Tuple


# === 默认老板 open_id(短期推送目标,2026-08-22 锁定) ===
DEFAULT_BOSS_OPEN_ID = "ou_10541f3f158808c43cbb7a1f0a6a48cc"


def _red(s: str) -> str:
    return f"\033[91m{s}\033[0m" if sys.stdout.isatty() else s


def _green(s: str) -> str:
    return f"\033[92m{s}\033[0m" if sys.stdout.isatty() else s


def _yellow(s: str) -> str:
    return f"\033[93m{s}\033[0m" if sys.stdout.isatty() else s


def _dim(s: str) -> str:
    return f"\033[2m{s}\033[0m" if sys.stdout.isatty() else s


def _bold(s: str) -> str:
    return f"\033[1m{s}\033[0m" if sys.stdout.isatty() else s


def check_credentials_or_exit(
    push: bool = False,
    alert: bool = True,
    script_name: str | None = None,
) -> Tuple[bool, dict]:
    """
    启动期校验关键凭据。

    Args:
        push:  本脚本是否会推 commit / push 到 GitHub Pages
        alert: 本脚本是否会发飞书告警
        script_name: 当前脚本名(用于诊断输出)

    Returns:
        (ok: bool, status: dict)

    Raises:
        SystemExit(2): 当关键凭据缺失时,打印诊断后立即退出
    """
    gh_token = os.environ.get("GH_TOKEN", "").strip()
    boss_open_id = os.environ.get("BOSS_OPEN_ID", DEFAULT_BOSS_OPEN_ID).strip()
    lark_webhook = os.environ.get("LARK_WEBHOOK_URL", "").strip()
    lark_bot_token = os.environ.get("LARK_BOT_TOKEN", "").strip()
    dry_run = os.environ.get("ALERT_DRY_RUN", "") == "1"

    status = {
        "gh_token": bool(gh_token),
        "boss_open_id": bool(boss_open_id),
        "lark_webhook": bool(lark_webhook),
        "lark_bot_token": bool(lark_bot_token),
        "dry_run": dry_run,
    }

    failures: list[str] = []

    # 规则 1: push 模式必须 GH_TOKEN
    if push and not gh_token:
        failures.append(
            f"{_red('GH_TOKEN')} 未设置 — push 模式必需,缺则无法推 commit"
        )

    # 规则 2: alert 模式必须 BOSS_OPEN_ID / LARK_WEBHOOK_URL / LARK_BOT_TOKEN 至少一个
    # (dry-run 模式豁免,只写本地日志)
    if alert and not dry_run:
        if not (boss_open_id or lark_webhook or lark_bot_token):
            failures.append(
                f"{_red('BOSS_OPEN_ID / LARK_WEBHOOK_URL / LARK_BOT_TOKEN')} 全未设置 — "
                f"alert 模式至少需要一个推送通道,或设 ALERT_DRY_RUN=1 走 dry-run"
            )

    # === 打印状态行(总是) ===
    name = Path(script_name).name if script_name else "?"
    print(f"{_dim('[startup_check]')}{_bold(name)}{_dim(' 凭据状态:')}")
    print(f"  GH_TOKEN:         {_green('✓') if gh_token else _red('✗')}")
    print(f"  BOSS_OPEN_ID:     {_green('✓') if boss_open_id else _yellow('default=' + DEFAULT_BOSS_OPEN_ID[:8] + '…' if not boss_open_id else '✗')}")
    print(f"  LARK_WEBHOOK_URL: {_green('✓') if lark_webhook else _dim('—')}")
    print(f"  LARK_BOT_TOKEN:   {_green('✓') if lark_bot_token else _dim('—')}")
    print(f"  ALERT_DRY_RUN:    {_green('1 (dry-run)') if dry_run else _dim('0 (real)')}")

    if failures:
        print()
        print(_red("═" * 60))
        print(_red(f"  ✗ FAIL-FAST: {name} 启动期校验未通过"))
        print(_red("═" * 60))
        for f in failures:
            print(f"  • {f}")
        print()
        print(_yellow("  修复方式(选一):"))
        if push and not gh_token:
            print("    1) export GH_TOKEN=<your_pat>        # push 必需")
        if alert and not dry_run and not (boss_open_id or lark_webhook or lark_bot_token):
            print("    2) export BOSS_OPEN_ID=ou_xxx          # 个人推送")
            print("    3) export LARK_WEBHOOK_URL=https://... # 群机器人(长期)")
            print("    4) export LARK_BOT_TOKEN=t-xxx         # Open API")
            print("    5) export ALERT_DRY_RUN=1              # 跳过真发,只写日志")
        print(_red("═" * 60))
        sys.exit(2)

    if not failures:
        print(f"  {_green('✓')} 凭据就位,继续执行\n")

    return True, status


def check_credentials_warn_only(
    push: bool = False,
    alert: bool = True,
    script_name: str | None = None,
) -> Tuple[bool, dict]:
    """
    同 check_credentials_or_exit,但不退出,只返回 (ok, status)。
    用于需要 fail-soft 决策的场景(比如 update_roadmap 可能在 dry-run 模式跑)。
    """
    gh_token = os.environ.get("GH_TOKEN", "").strip()
    boss_open_id = os.environ.get("BOSS_OPEN_ID", DEFAULT_BOSS_OPEN_ID).strip()
    lark_webhook = os.environ.get("LARK_WEBHOOK_URL", "").strip()
    lark_bot_token = os.environ.get("LARK_BOT_TOKEN", "").strip()
    dry_run = os.environ.get("ALERT_DRY_RUN", "") == "1"

    push_ok = (not push) or bool(gh_token)
    alert_ok = (not alert) or dry_run or bool(boss_open_id or lark_webhook or lark_bot_token)
    ok = push_ok and alert_ok

    return ok, {
        "gh_token": bool(gh_token),
        "boss_open_id": bool(boss_open_id),
        "lark_webhook": bool(lark_webhook),
        "lark_bot_token": bool(lark_bot_token),
        "dry_run": dry_run,
        "push_ok": push_ok,
        "alert_ok": alert_ok,
    }


if __name__ == "__main__":
    # 手动调试用
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--push", action="store_true")
    p.add_argument("--no-alert", action="store_true")
    args = p.parse_args()
    check_credentials_or_exit(push=args.push, alert=not args.no_alert, script_name="manual")
    print("通过")
