#!/usr/bin/env python3
"""
update_roadmap.py — 拉父任务下所有子任务,按版本聚合,渲染 wildwood-roadmap.html,可选推 GitHub main。
v0.7.4a · 方案A: 覆盖 v0.1-v0.7 全量子任务,v0.6.3a 的 7 个 task 升级为自动分类。

调用:
  python3 scripts/update_roadmap.py [--parent-task <id>] [--output <path>]

参数:
  --parent-task   父任务 ID,默认 7675923777695288529 (类饥荒游戏开发)
  --output        HTML 输出路径,默认 ./artifacts/html/wildwood-roadmap.html
  --push          强制推送 GitHub (默认 GH_TOKEN 存在就推)

环境:
  GH_TOKEN          — GitHub PAT,缺失则只生成本地 HTML
  GH_REPO           — 默认 "rainskyfyy/wildwood"
  GH_BRANCH         — 默认 "main"
  SYNC_DRY_RUN      — "1" 走纯 dry-run:不真发飞书,不真推 GH,仅写本地指标
  BOSS_OPEN_ID      — 失败告警推送目标 (个人 open_id,默认 ou_10541f3f158808c43cbb7a1f0a6a48cc)
  LARK_WEBHOOK_URL  — 飞书自定义机器人 webhook URL(长期方案,群就位后启用)
  LARK_BOT_TOKEN    — 飞书自定义机器人 token(若 webhook 需鉴权)
  ALERT_DRY_RUN     — "1" 告警只写本地 dry-run 日志,不真发

数据流:
  1. aily-cli task subtasks <parent> --page-size 50 (paginated, 自动翻页)
  2. 从 description 提取 v0.X 或 Mx.y → 归到对应 v0.X
  3. 按版本聚合 → 渲染 HTML
  4. 写 ~/.aily/workspace/sync_metrics.jsonl (健康检查)
  5. 推 GitHub Data API (blob→tree→commit→update-ref)
  6. 失败 ≥ 3 次 → 飞书告警 (走 lark_alert_stub.send_lark_alert,优先级 webhook > 个人私聊 > dry-run log)

可观测性产物:
  ~/.aily/workspace/sync_metrics.jsonl
  ~/.aily/workspace/lark_alert_dryrun.log
  ~/.aily/workspace/lark_alert.log
  HTML 顶部 status badge (绿/黄/红)
"""
import argparse
import base64
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# -------------------- config --------------------
GH_TOKEN          = os.environ.get("GH_TOKEN")
GH_REPO           = os.environ.get("GH_REPO",  "rainskyfyy/wildwood")
GH_BRANCH         = os.environ.get("GH_BRANCH", "main")
SYNC_DRY_RUN      = os.environ.get("SYNC_DRY_RUN", "") == "1"
BOSS_OPEN_ID      = os.environ.get("BOSS_OPEN_ID", "ou_10541f3f158808c43cbb7a1f0a6a48cc")  # 范颜岩(老板)
LARK_WEBHOOK_URL  = os.environ.get("LARK_WEBHOOK_URL", "")
LARK_BOT_TOKEN    = os.environ.get("LARK_BOT_TOKEN", "")
ALERT_DRY_RUN     = os.environ.get("ALERT_DRY_RUN", "") == "1"

DEFAULT_PARENT_TASK = "7675923777695288529"  # 类饥荒游戏开发
DEFAULT_OUTPUT_PATH  = str(Path.home() / ".aily" / "workspace" / "wildwood" / "wildwood-roadmap.html")

# 可观测性产物路径
WORKSPACE_DIR       = Path.home() / ".aily" / "workspace"
SYNC_METRICS_PATH   = WORKSPACE_DIR / "sync_metrics.jsonl"
ALERT_DRYRUN_LOG    = WORKSPACE_DIR / "lark_alert_dryrun.log"

# 告警阈值
ALERT_THRESHOLD     = 3

# status badge 判定阈值
GREEN_MAX_AGE_MIN   = 30
YELLOW_MAX_AGE_MIN  = 60
RED_FAIL_THRESHOLD  = 3
YELLOW_FAIL_LOW     = 1

# 版本聚合顺序(展示用,从 v0.1 到 v0.7)
VERSION_ORDER = ["v0.1", "v0.2", "v0.3", "v0.4", "v0.5", "v0.6", "v0.7"]

# 版本中文标签 + 阶段描述(用于卡片头)
VERSION_META = {
    "v0.1": ("美术资产",    "Art Assets · 像素素材定版"),
    "v0.2": ("核心引擎",    "Core Engine · 可玩 Demo"),
    "v0.3": ("游戏系统",    "Game Systems · 建造/资源/HUD/图鉴"),
    "v0.4": ("打磨与联机",  "Polish & Multiplayer · 音效 + 同步"),
    "v0.5": ("内容扩展",    "Content Expansion · 烹饪/怪物/UI"),
    "v0.6": ("架构重构",    "Architecture Refactor · 服务化分层"),
    "v0.7": ("A/B 通用层",  "A/B Universal Layer · RFC + 铁律自动化"),
}

# 兼容映射:Mx.y 旧里程碑体系 → v0.x 版本归类
MILESTONE_TO_VERSION = {
    "M1": "v0.1",  # M1.1-M1.14 美术/引擎基础
    "M2": "v0.2",  # M2.1-M2.14 核心引擎
    "M3": "v0.3",  # M3.1-M3.13 游戏系统
    "M4": "v0.4",  # M4 联机/打磨
}


# -------------------- time helpers --------------------
def now_utc():
    return datetime.now(timezone.utc)


def now_iso():
    return now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")


def _format_age(minutes):
    if minutes < 1:
        return "刚刚"
    if minutes < 60:
        return f"{int(minutes)}m 前"
    if minutes < 60 * 24:
        return f"{int(minutes // 60)}h 前"
    return f"{int(minutes // (60 * 24))}d 前"


# -------------------- 可观测性层 (沿用 v0.6.3a) --------------------
SCRIPT_SOURCE = "update_roadmap.py"  # 用于 metrics 自识别,避免被测试 fixture / 其他脚本污染

def record_sync_metric(start_ts, status, duration_seconds, commit_count, task_count,
                       commit_sha="", error=""):
    record = {
        "ts": now_iso(), "status": status,
        "duration_seconds": round(duration_seconds, 3),
        "commit_count": commit_count, "task_count": task_count,
        "commit_sha": commit_sha, "error": error,
        "source": SCRIPT_SOURCE,
    }
    try:
        WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
        with SYNC_METRICS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"  WARN: 写 sync_metrics.jsonl 失败: {e}", file=sys.stderr)
    return record


# 已知非本脚本的污染源,过滤掉避免被计入健康指标
_EXCLUDED_SOURCES = {"sync_roadmap.py", "sync_main.py"}
_EXCLUDED_ERROR_TOKENS = {"sim", "historical"}


def _is_real_metric(rec: dict) -> bool:
    """保留:本脚本 + 没有 source 字段(历史 v0.6.3a 之前的条目)。排除:已知测试 fixture。"""
    src = rec.get("source", "")
    err = rec.get("error", "")
    if src in _EXCLUDED_SOURCES:
        return False
    if err in _EXCLUDED_ERROR_TOKENS:
        return False
    # 保留 source in ("update_roadmap.py", "") — 本脚本 + 旧条目
    return True


def read_recent_metrics(n=10, source_filter=None):
    """
    读 sync_metrics.jsonl,按 ts 倒序,过滤掉已知测试 fixture(sync_roadmap.py / sync_main.py / sim / historical),
    返回最多 n 条(时间最近)。

    兼容 source_filter 参数(legacy 命名):实际效果固定为过滤已知 fixture,不再做额外白名单。
    """
    if not SYNC_METRICS_PATH.exists():
        return []
    try:
        raw = SYNC_METRICS_PATH.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        print(f"  WARN: 读 sync_metrics.jsonl 失败: {e}", file=sys.stderr)
        return []
    cleaned = raw.replace("\x00", "").strip()
    lines = [ln for ln in cleaned.splitlines() if ln.strip()]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    out = [r for r in out if _is_real_metric(r)]
    # 按 ts 字典序 == ISO 时间序,取末尾 n 条 = 时间最近 n 条
    out.sort(key=lambda r: r.get("ts", ""))
    return out[-n:] if len(out) > n else out


def compute_consecutive_failures():
    recent = read_recent_metrics(n=20, source_filter=SCRIPT_SOURCE)
    n = 0
    for rec in reversed(recent):
        if rec.get("status") == "fail":
            n += 1
        else:
            break
    return n


def compute_last_successful_commit():
    recent = read_recent_metrics(n=50, source_filter=SCRIPT_SOURCE)
    for rec in reversed(recent):
        if rec.get("status") == "ok" and rec.get("commit_sha"):
            return rec.get("ts"), rec.get("commit_sha")
    return None, None


def compute_status_badge():
    recent = read_recent_metrics(n=50, source_filter=SCRIPT_SOURCE)
    if not recent:
        return {
            "status": "red", "label": "无同步记录",
            "last_sync_age": "无记录", "last_sync_iso": "",
            "consecutive_failures": 0,
            "last_commit_age": "无", "last_commit_iso": "",
        }
    last = recent[-1]
    last_ts = last.get("ts", "")
    try:
        last_dt = datetime.strptime(last_ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        last_dt = now_utc()
    last_sync_age_min = (now_utc() - last_dt).total_seconds() / 60.0
    last_sync_age = _format_age(last_sync_age_min)
    consecutive_failures = compute_consecutive_failures()
    last_commit_iso, _ = compute_last_successful_commit()
    if last_commit_iso:
        try:
            lc_dt = datetime.strptime(last_commit_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            last_commit_age = _format_age((now_utc() - lc_dt).total_seconds() / 60.0)
        except ValueError:
            last_commit_age = "无"
    else:
        last_commit_age = "无"
    if last_sync_age_min > YELLOW_MAX_AGE_MIN or consecutive_failures >= RED_FAIL_THRESHOLD:
        status, label = "red", "看板同步异常"
    elif last_sync_age_min > GREEN_MAX_AGE_MIN or consecutive_failures >= YELLOW_FAIL_LOW:
        status, label = "yellow", "看板同步滞后"
    else:
        status, label = "green", "看板同步正常"
    return {
        "status": status, "label": label,
        "last_sync_age": last_sync_age, "last_sync_iso": last_ts,
        "consecutive_failures": consecutive_failures,
        "last_commit_age": last_commit_age, "last_commit_iso": last_commit_iso or "",
    }


# -------------------- 飞书告警 --------------------
def _load_alert_stub():
    """动态加载 lark_alert_stub.py(同目录或 ~/.aily/workspace/wildwood/),失败返回 None。"""
    candidates = [
        Path(__file__).resolve().parent / "lark_alert_stub.py",
        Path.home() / ".aily" / "workspace" / "wildwood" / "lark_alert_stub.py",
    ]
    for p in candidates:
        if not p.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location("lark_alert_stub", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception as e:
            print(f"  WARN 加载 {p} 失败: {e}", file=sys.stderr)
    return None


def _fallback_dryrun_log(level, kind, title, detail):
    """stub 加载失败时,直接把告警写到本地 dry-run 日志。"""
    try:
        WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
        with ALERT_DRYRUN_LOG.open("a", encoding="utf-8") as f:
            f.write(f"--- {now_iso()} fallback-dry-run alert (level={level} kind={kind}) ---\n")
            f.write(f"title: {title}\n")
            f.write(f"detail: {detail}\n")
    except Exception as e:
        print(f"  WARN 写 lark_alert_dryrun.log 失败: {e}", file=sys.stderr)


def send_lark_alert(consecutive_failures, recent_errors):
    """
    失败告警入口 — 委托给 lark_alert_stub.send_lark_alert。
    stub 会按 webhook > lark-cli 个人私聊 > dry-run 优先级尝试,自带 1h 限流。
    """
    err_text = "\n".join(f"  - {e}" for e in recent_errors[-3:] if e) or "  (no error msg captured)"
    title = f"Wildwood 看板同步连续失败 {consecutive_failures} 次"
    detail = (
        f"目标仓库:{GH_REPO}@{GH_BRANCH}\n"
        f"触发时间:{now_iso()}\n"
        f"最近错误:\n{err_text}\n\n"
        f"请检查 GH_TOKEN / aily-cli / 网络。\n"
        f"查看完整指标:~/.aily/workspace/sync_metrics.jsonl"
    )

    stub = _load_alert_stub()
    if stub is None:
        print(f"\n[STUB MISSING] lark_alert_stub.py 加载失败,告警走 fallback dry-run 日志")
        _fallback_dryrun_log("error", "sync_fail", title, detail)
        return {"sent": False, "mode": "fallback-dry-run", "msg_len": len(detail)}

    try:
        result = stub.send_lark_alert(consecutive_failures, recent_errors)
        # stub.send_lark_alert 返回 bool;同步按推送路径还原 mode
        webhook_set = bool(LARK_WEBHOOK_URL)
        if isinstance(result, bool):
            mode = "webhook" if webhook_set else ("lark-cli-p2p" if BOSS_OPEN_ID else "dry-run")
            sent = result
            out = {"sent": sent, "mode": mode, "msg_len": len(detail)}
        else:
            out = dict(result) if isinstance(result, dict) else {"sent": bool(result), "mode": "unknown"}
        print(f"\n[LARK ALERT] consecutive_failures={consecutive_failures} → mode={out.get('mode')} sent={out.get('sent')}")
        return out
    except Exception as e:
        print(f"\n[STUB ERROR] lark_alert_stub.send_lark_alert 异常: {e}", file=sys.stderr)
        _fallback_dryrun_log("error", "sync_fail", title, detail)
        return {"sent": False, "mode": "fallback-dry-run", "error": str(e)}


# -------------------- aily-cli 桥接:拉所有子任务 --------------------
def fetch_all_subtasks(parent_task_id):
    """Paginated `aily-cli task subtasks <parent>`,返回所有 task dict list。"""
    all_tasks = []
    page_token = None
    page_no = 0
    while True:
        page_no += 1
        cmd = ["aily-cli", "task", "subtasks", parent_task_id, "--page-size", "50"]
        if page_token:
            cmd += ["--page-token", page_token]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if out.returncode != 0:
                print(f"  WARN aily-cli subtasks page={page_no} exit={out.returncode}: {out.stderr.strip()}", file=sys.stderr)
                return all_tasks
            d = json.loads(out.stdout)
        except Exception as e:
            print(f"  WARN aily-cli subtasks page={page_no}: {e}", file=sys.stderr)
            return all_tasks
        tasks = d.get("tasks", [])
        all_tasks.extend(tasks)
        print(f"  page {page_no}: +{len(tasks)} tasks (累计 {len(all_tasks)})")
        if not d.get("hasMore"):
            break
        page_token = d.get("nextPageToken")
        if not page_token:
            break
    return all_tasks


# -------------------- 版本归类 --------------------
def extract_version(task):
    """从 description 提取版本标签: v0.7.1a / v0.5.3 / M2.10 / 等。返回原始字符串。

    优先级:
      1. branch: feat/v0.7.0b-... (最可靠,在子任务元数据里)
      2. commit_message_template: v0.7.0b: ... (同上)
      3. 【M1.11】 标题格式
      4. ## v0.7.1a xxx 标题格式
      5. description body 第一个 v0.X.Y
      6. Mx.y 里程碑
    """
    desc = task.get("description", "") or ""
    first_line = desc.split("\n")[0] if desc else ""

    # 1. branch: feat/v0.X.Y-xxx
    m = re.search(r'branch:\s*feat/(v0\.[0-9]+\.[0-9]+[a-z]?)', desc)
    if m:
        return m.group(1)
    # 2. commit_message_template: v0.X.Y: ...
    m = re.search(r'commit_message_template:\s*(v0\.[0-9]+\.[0-9]+[a-z]?):', desc)
    if m:
        return m.group(1)
    # 3. 【M1.11】 标题格式
    m = re.search(r'【(M[0-9]+(?:\.[0-9]+)?)】', first_line)
    if m:
        return m.group(1)
    # 4. ## v0.7.1a xxx 标题格式
    m = re.search(r'^##\s*(v0\.[0-9]+\.[0-9]+[a-z]?)', first_line)
    if m:
        return m.group(1)
    # 5. v0.7.1a 完整 (含 a 后缀) in body
    m = re.search(r'(v0\.[0-9]+\.[0-9]+[a-z]?)', desc)
    if m:
        return m.group(1)
    # 6. v0.X (短) in body
    m = re.search(r'(v0\.[0-9]+)\b', desc)
    if m:
        return m.group(1)
    # 7. Mx.y
    m = re.search(r'(M[0-9]+(?:\.[0-9]+)?)', desc)
    if m:
        return m.group(1)
    return "?"


def bucket_version(raw_ver):
    """把 raw_ver 归到 v0.1-v0.7 桶。"""
    if raw_ver == "?":
        return None
    # v0.5.3 → v0.5
    m = re.match(r'(v0\.[0-9]+)', raw_ver)
    if m:
        v = m.group(1)
        return v if v in VERSION_ORDER else None
    # M1 → v0.1, M2 → v0.2, M3 → v0.3, M4 → v0.4
    m = re.match(r'(M[0-9]+)', raw_ver)
    if m:
        return MILESTONE_TO_VERSION.get(m.group(1))
    return None


def extract_title(task):
    """从 description 提取短标题(去掉 '目标：' '【M1.1】' '## v0.6.1a' 等前缀)。"""
    desc = task.get("description", "") or ""
    first_line = desc.split("\n")[0] if desc else ""
    # 依次去除:目标:、任务:、【Mx.y】、## v0.X.Y 标题、## 目标
    title = re.sub(
        r'^(目标[：:]?|任务[：:]?|##\s*目标\s*|【[^】]+】\s*|##\s+\S+\s+)',
        '', first_line).strip()
    if len(title) > 100:
        title = title[:100] + "…"
    return title or "(无标题)"


# -------------------- 聚合 --------------------
def aggregate(tasks):
    """返回:
    {
      'buckets': { 'v0.1': [task, ...], ... },
      'all_count': int,
      'all_done': int,
      'all_active': int,
      'unknown_count': int,
    }
    """
    buckets = defaultdict(list)
    unknown = []
    for t in tasks:
        raw_ver = extract_version(t)
        b = bucket_version(raw_ver)
        if b is None:
            unknown.append(t)
            continue
        t["_ver_raw"] = raw_ver
        t["_title"]   = extract_title(t)
        t["_bucket"]  = b
        buckets[b].append(t)
    return {
        "buckets": dict(buckets),
        "all_count": len(tasks),
        "all_done":  sum(1 for t in tasks if t.get("status") == "done"),
        "all_active": sum(1 for t in tasks if t.get("status") == "in_progress"),
        "unknown_count": len(unknown),
    }


# -------------------- 渲染 --------------------
SVG_DONE   = '<svg class="ic-done"   width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>'
SVG_ACTIVE = '<svg class="ic-active" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6"/></svg>'
SVG_PEND   = '<svg class="ic-pend"   width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/></svg>'


def status_label(s):
    return {"done": "已完成", "in_progress": "进行中", "pending": "未开始", "cancelled": "已取消"}.get(s, s or "未知")


def card_status_of(version_done, version_total, version_active):
    if version_total == 0:
        return "pending"
    if version_done >= version_total:
        return "done"
    if version_active > 0 or version_done > 0:
        return "active"
    return "pending"


def render_tasks_html(tasks):
    """Render the per-version task list (with status icon + title + raw ver)."""
    rows = []
    for t in sorted(tasks, key=lambda x: (x.get("status") != "in_progress", x.get("status") != "done", x.get("_ver_raw", ""), x.get("_title", ""))):
        s = t.get("status", "pending")
        if s == "done":
            svg = SVG_DONE
        elif s == "in_progress":
            svg = SVG_ACTIVE
        elif s == "cancelled":
            svg = SVG_PEND
        else:
            svg = SVG_PEND
        ver = t.get("_ver_raw", "?")
        title = t.get("_title", "") or "(无标题)"
        # html escape minimal
        title_h = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        rows.append(
            f'        <li class="deliverable" data-status="{s}">'
            f'<span class="icon">{svg}</span>'
            f'<span class="text"><strong class="ver-tag">{ver}</strong> {title_h}'
            f'<span class="assignee">状态 · {status_label(s)}</span>'
            f'</span></li>'
        )
    return "\n".join(rows)


def render_version_cards(agg, badge):
    """生成 v0.1-v0.7 全部 7 个卡片(可能空)。"""
    buckets = agg["buckets"]
    cards = []
    for v in VERSION_ORDER:
        subs = buckets.get(v, [])
        total = len(subs)
        done  = sum(1 for t in subs if t.get("status") == "done")
        active = sum(1 for t in subs if t.get("status") == "in_progress")
        card_status = card_status_of(done, total, active)
        if total == 0:
            pct = 0
            body = f'        <li class="deliverable empty"><span class="icon">{SVG_PEND}</span><span class="text"><em>本版本无子任务</em></span></li>'
            progress_label = "0 / 0"
        else:
            pct = int(round(done * 100 / total))
            body = render_tasks_html(subs)
            progress_label = f"{done} / {total}"

        title_zh, sub_zh = VERSION_META.get(v, (v, ""))

        # tasks list collapse via data-attr; cap shown items at first 8, fold rest
        sub_html = render_version_section(v, title_zh, sub_zh, card_status, pct, total, done, active, body)
        cards.append(sub_html)
    return "\n".join(cards)


def render_version_section(v, title_zh, sub_zh, card_status, pct, total, done, active, tasks_html):
    """单版本 section:含卡片头 + 进度条 + 任务列表。"""
    if total == 0:
        task_list_html = (
            '      <ul class="deliverables">\n'
            f'{tasks_html}\n'
            '      </ul>'
        )
    else:
        task_list_html = (
            f'      <ul class="deliverables" data-count="{total}">\n'
            f'{tasks_html}\n'
            '      </ul>'
        )
    return f'''
    <article class="card" data-status="{card_status}" id="card-{v}">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">{v}</div>
        <span class="status-badge"><span class="status-dot"></span>{status_label({"done":"done","active":"进行中","pending":"未启动"}.get(card_status, "active"))}</span>
      </div>
      <h2 class="card-title">{title_zh}</h2>
      <p class="card-sub">{sub_zh} · {done} / {total} 完成 · 进行中 {active}</p>
{task_list_html}
      <div class="card-progress">
        <div class="card-progress-label"><span>完成率</span><span>{pct}%</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="{pct}"></div></div>
      </div>
    </article>'''


def render_overall_block(agg):
    total = agg["all_count"]
    done  = agg["all_done"]
    pct = int(round(done * 100 / total)) if total else 0
    active = agg["all_active"]
    unknown = agg["unknown_count"]
    versions_done = sum(1 for v in VERSION_ORDER if agg["buckets"].get(v) and all(t.get("status") == "done" for t in agg["buckets"][v]))
    versions_total = sum(1 for v in VERSION_ORDER if agg["buckets"].get(v))
    versions_pct = int(round(versions_done * 100 / versions_total)) if versions_total else 0
    return {
        "pct": pct,
        "active": active,
        "unknown": unknown,
        "total": total,
        "done": done,
        "versions_done": versions_done,
        "versions_total": versions_total,
        "versions_pct": versions_pct,
    }


def render_html(agg, badge):
    overall = render_overall_block(agg)
    version_cards = render_version_cards(agg, badge)
    return HTML_TEMPLATE.format(
        overall_pct=overall["pct"],
        overall_total=overall["total"],
        overall_done=overall["done"],
        overall_active=overall["active"],
        overall_unknown=overall["unknown"],
        versions_done=overall["versions_done"],
        versions_total=overall["versions_total"],
        versions_pct=overall["versions_pct"],
        version_cards=version_cards,
        timestamp=now_iso(),
        gh_repo=GH_REPO,
        # status badge (v0.6.3a 沿用)
        badge_status=badge["status"],
        badge_label=badge["label"],
        badge_last_sync_age=badge["last_sync_age"],
        badge_last_sync_iso=badge["last_sync_iso"],
        badge_consecutive_failures=badge["consecutive_failures"],
        badge_last_commit_age=badge["last_commit_age"],
        badge_last_commit_iso=badge["last_commit_iso"],
    )


HTML_TEMPLATE = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wildwood · 开发路线图</title>
<style>
  :root {{
    --night-black: #101820;
    --night-deep: #0a0f15;
    --night-elev: #1a2230;
    --night-line: #2a3340;
    --ash: #6b7280;
    --ash-soft: #9aa3b2;
    --bone: #d8d3c4;
    --parchment: #e8e2cf;
    --gold: #c9a14a;
    --gold-soft: #b8923d;
    --blood: #8b1e2d;
    --moss: #4a7a4e;
    --moss-glow: #6fa972;
    --ember: #d97824;
    --ember-glow: #f59e3a;
    --cinder: #4a4f5a;
    --badge-green: #4a7a4e;
    --badge-green-glow: #6fa972;
    --badge-yellow: #b8923d;
    --badge-yellow-glow: #d8a64a;
    --badge-red: #8b1e2d;
    --badge-red-glow: #c9374c;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    background: var(--night-black); color: var(--bone);
    font-family: ui-sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
    line-height: 1.5; -webkit-font-smoothing: antialiased; min-height: 100vh;
  }}
  body {{
    background:
      radial-gradient(ellipse 80% 50% at 50% 0%, rgba(201, 161, 74, 0.06) 0%, transparent 60%),
      radial-gradient(ellipse 60% 60% at 50% 100%, rgba(139, 30, 45, 0.04) 0%, transparent 60%),
      var(--night-black);
    position: relative; padding: 48px 32px 80px; overflow-x: hidden;
  }}
  body::before {{
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background-image: repeating-linear-gradient(0deg, rgba(216, 211, 196, 0.012) 0px, transparent 1px, transparent 2px, rgba(216, 211, 196, 0.012) 3px);
    z-index: 0;
  }}
  body::after {{
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%);
    z-index: 0;
  }}
  .container {{ max-width: 1480px; margin: 0 auto; position: relative; z-index: 1; }}

  header {{ text-align: center; margin-bottom: 56px; position: relative; }}
  .crest {{ display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 18px; }}
  .crest-line {{ width: 80px; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); opacity: 0.6; }}
  .crest-mark {{ width: 18px; height: 18px; border: 1px solid var(--gold); transform: rotate(45deg); position: relative; }}
  .crest-mark::after {{ content: ""; position: absolute; inset: 3px; background: var(--gold); opacity: 0.4; }}
  h1.title {{
    font-family: "Cinzel", "Trajan Pro", "Times New Roman", "Songti SC", serif;
    font-size: clamp(36px, 5vw, 56px); font-weight: 400; letter-spacing: 0.32em;
    color: var(--parchment); text-transform: uppercase; margin-bottom: 12px;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.8);
  }}
  h1.title .accent {{ color: var(--gold); font-style: italic; }}
  .subtitle {{ font-size: 13px; letter-spacing: 0.4em; text-transform: uppercase; color: var(--ash-soft); margin-bottom: 8px; }}
  .meta {{ font-size: 12px; color: var(--ash); letter-spacing: 0.2em; font-family: ui-monospace, "SF Mono", Menlo, monospace; margin-top: 4px; }}

  .sync-badge {{
    display: inline-flex; align-items: center; gap: 14px;
    margin: 8px auto 18px; padding: 10px 18px;
    border: 1px solid currentColor; border-radius: 999px;
    background: rgba(16, 24, 32, 0.6);
    font-size: 12px; letter-spacing: 0.05em;
    transition: all 0.3s ease;
  }}
  .sync-badge[data-status="green"]  {{ color: var(--badge-green-glow);  box-shadow: 0 0 16px rgba(111, 169, 114, 0.25); }}
  .sync-badge[data-status="yellow"] {{ color: var(--badge-yellow-glow); box-shadow: 0 0 16px rgba(216, 166, 74, 0.30); }}
  .sync-badge[data-status="red"]    {{ color: var(--badge-red-glow);    box-shadow: 0 0 16px rgba(201, 55, 76, 0.35);  animation: pulse 2.4s ease-in-out infinite; }}
  .sync-badge .badge-dot {{ width: 8px; height: 8px; background: currentColor; border-radius: 50%; box-shadow: 0 0 8px currentColor; }}
  .sync-badge[data-status="green"]  .badge-dot {{ animation: spin 4s linear infinite; }}
  .sync-badge .badge-label {{ font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; }}
  .sync-badge .badge-detail {{ color: var(--ash-soft); font-size: 11px; letter-spacing: 0.04em; font-family: ui-monospace, "SF Mono", Menlo, monospace; }}
  .sync-badge .badge-detail b {{ color: var(--bone); font-weight: 500; }}
  @keyframes pulse {{
    0%, 100% {{ box-shadow: 0 0 16px rgba(201, 55, 76, 0.35); }}
    50%      {{ box-shadow: 0 0 24px rgba(201, 55, 76, 0.65); }}
  }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}

  .progress-block {{
    max-width: 720px; margin: 0 auto 56px; padding: 28px 36px;
    background: linear-gradient(180deg, rgba(26, 34, 48, 0.6), rgba(16, 24, 32, 0.6));
    border: 1px solid var(--night-line); position: relative;
  }}
  .progress-block::before, .progress-block::after {{
    content: ""; position: absolute; width: 14px; height: 14px; border: 1px solid var(--gold); opacity: 0.5;
  }}
  .progress-block::before {{ top: -1px; left: -1px; border-right: none; border-bottom: none; }}
  .progress-block::after  {{ bottom: -1px; right: -1px; border-left: none; border-top: none; }}
  .progress-head {{ display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }}
  .progress-label {{ font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ash-soft); }}
  .progress-pct {{
    font-family: "Cinzel", "Trajan Pro", serif; font-size: 36px;
    color: var(--gold); font-weight: 400; letter-spacing: 0.04em;
  }}
  .progress-pct .small {{ font-size: 18px; color: var(--ash-soft); margin-left: 2px; }}
  .progress-bar {{ position: relative; height: 8px; background: var(--night-deep); border: 1px solid var(--night-line); overflow: hidden; }}
  .progress-fill {{
    position: absolute; inset: 0; width: 0;
    background: linear-gradient(90deg, var(--moss), var(--gold));
    box-shadow: 0 0 12px rgba(201, 161, 74, 0.4);
    transition: width 1.6s cubic-bezier(0.22, 1, 0.36, 1) 0.3s;
  }}
  .progress-fill::after {{
    content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0px, transparent 6px, rgba(0,0,0,0.2) 6px, rgba(0,0,0,0.2) 7px);
  }}
  .progress-detail {{
    display: flex; justify-content: space-between; margin-top: 12px;
    font-size: 12px; color: var(--ash-soft); letter-spacing: 0.15em;
  }}
  .progress-detail .num {{ color: var(--bone); font-weight: 500; }}
  .progress-detail span {{ display: inline-flex; gap: 6px; align-items: center; }}

  /* v0.7.4a: 3-col grid 容纳 7 卡片 */
  .grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }}
  @media (max-width: 1100px) {{ .grid {{ grid-template-columns: repeat(2, 1fr); }} }}
  @media (max-width: 640px)  {{ .grid {{ grid-template-columns: 1fr; }} body {{ padding: 32px 16px 60px; }} }}

  .card {{
    position: relative;
    background: linear-gradient(180deg, var(--night-elev), var(--night-black));
    border: 1px solid var(--night-line);
    padding: 26px 22px 22px; display: flex; flex-direction: column;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }}
  .card:hover {{ transform: translateY(-3px); }}
  .card::before {{
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: var(--card-accent, var(--cinder));
    box-shadow: 0 0 16px var(--card-glow, transparent);
  }}
  .card[data-status="done"]    {{ --card-accent: var(--moss);   --card-glow: rgba(74, 122, 78, 0.5); }}
  .card[data-status="active"]  {{ --card-accent: var(--ember);  --card-glow: rgba(217, 120, 36, 0.5); }}
  .card[data-status="pending"] {{ --card-accent: var(--cinder); --card-glow: transparent; }}
  .card-corner {{ position: absolute; width: 12px; height: 12px; border: 1px solid var(--gold); opacity: 0.35; }}
  .card-corner.tl {{ top: 10px; left: 10px; border-right: none; border-bottom: none; }}
  .card-corner.tr {{ top: 10px; right: 10px; border-left: none; border-bottom: none; }}
  .card-corner.bl {{ bottom: 10px; left: 10px; border-right: none; border-top: none; }}
  .card-corner.br {{ bottom: 10px; right: 10px; border-left: none; border-top: none; }}
  .card[data-status="pending"] .card-corner {{ opacity: 0.15; border-color: var(--ash); }}
  .card-head {{ display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }}
  .version {{ font-family: "Cinzel", "Trajan Pro", serif; font-size: 32px; letter-spacing: 0.08em; color: var(--parchment); line-height: 1; }}
  .status-badge {{
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border: 1px solid currentColor;
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; border-radius: 0;
  }}
  .card[data-status="done"]    .status-badge {{ color: var(--moss-glow); }}
  .card[data-status="active"]  .status-badge {{ color: var(--ember-glow); }}
  .card[data-status="pending"] .status-badge {{ color: var(--ash); }}
  .status-dot {{ width: 6px; height: 6px; background: currentColor; border-radius: 50%; }}
  .card-title {{ font-size: 18px; color: var(--bone); margin: 14px 0 4px; font-weight: 500; letter-spacing: 0.05em; }}
  .card-sub {{ font-size: 11px; color: var(--ash-soft); letter-spacing: 0.12em; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--night-line); }}

  .deliverables {{ list-style: none; display: flex; flex-direction: column; gap: 4px; flex: 1; max-height: 360px; overflow-y: auto; padding-right: 4px; }}
  .deliverables::-webkit-scrollbar {{ width: 6px; }}
  .deliverables::-webkit-scrollbar-track {{ background: var(--night-deep); }}
  .deliverables::-webkit-scrollbar-thumb {{ background: var(--night-line); border-radius: 3px; }}
  .deliverables::-webkit-scrollbar-thumb:hover {{ background: var(--ash); }}

  .deliverable {{ display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.45; color: var(--ash-soft); padding: 4px 0; border-bottom: 1px dashed transparent; }}
  .deliverable .icon {{ flex-shrink: 0; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-top: 2px; }}
  .deliverable .text {{ flex: 1; min-width: 0; }}
  .deliverable .text strong {{ color: var(--bone); font-weight: 500; }}
  .deliverable .ver-tag {{
    display: inline-block; padding: 1px 6px; margin-right: 6px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10px; letter-spacing: 0.05em;
    color: var(--gold); background: rgba(201, 161, 74, 0.08);
    border: 1px solid rgba(201, 161, 74, 0.2); border-radius: 2px;
  }}
  .deliverable .assignee {{ display: block; font-size: 10px; color: var(--ash); letter-spacing: 0.05em; margin-top: 2px; font-style: italic; }}
  .deliverable[data-status="in_progress"] .ver-tag {{ color: var(--ember-glow); background: rgba(217, 120, 36, 0.1); border-color: rgba(217, 120, 36, 0.3); }}
  .deliverable[data-status="done"] .ver-tag {{ color: var(--moss-glow); background: rgba(74, 122, 78, 0.1); border-color: rgba(74, 122, 78, 0.3); }}
  .deliverable.empty {{ opacity: 0.5; }}
  .deliverable.empty em {{ font-style: italic; color: var(--ash); }}

  .ic-done   {{ color: var(--moss-glow); }}
  .ic-active {{ color: var(--ember-glow); animation: spin 2.4s linear infinite; }}
  .ic-pend   {{ color: var(--cinder); }}

  .card-progress {{ margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--night-line); }}
  .card-progress-label {{ display: flex; justify-content: space-between; font-size: 11px; color: var(--ash); letter-spacing: 0.15em; margin-bottom: 8px; }}
  .card-progress-bar {{ height: 4px; background: var(--night-deep); border: 1px solid var(--night-line); position: relative; overflow: hidden; }}
  .card-progress-fill {{ position: absolute; inset: 0; width: 0; background: currentColor; transition: width 1.4s cubic-bezier(0.22, 1, 0.36, 1) 0.6s; }}
  .card[data-status="done"]    .card-progress-fill {{ background: var(--moss); }}
  .card[data-status="active"]  .card-progress-fill {{ background: var(--ember); }}
  .card[data-status="pending"] .card-progress-fill {{ background: var(--cinder); }}

  footer {{ margin-top: 72px; text-align: center; padding-top: 32px; border-top: 1px solid var(--night-line); position: relative; }}
  .footer-line {{ display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 14px; }}
  .footer-line::before, .footer-line::after {{ content: ""; width: 60px; height: 1px; background: linear-gradient(90deg, transparent, var(--night-line), transparent); }}
  .footer-mark {{ color: var(--ash); font-size: 12px; letter-spacing: 0.4em; text-transform: uppercase; }}
  .github-link {{
    display: inline-flex; align-items: center; gap: 12px;
    color: var(--bone); text-decoration: none;
    padding: 12px 24px; border: 1px solid var(--night-line);
    background: rgba(26, 34, 48, 0.4);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 14px; letter-spacing: 0.05em;
    transition: all 0.2s ease;
  }}
  .github-link:hover {{ color: var(--gold); border-color: var(--gold-soft); background: rgba(201, 161, 74, 0.06); box-shadow: 0 0 18px rgba(201, 161, 74, 0.15); }}
  .github-link svg {{ width: 18px; height: 18px; fill: currentColor; }}
  .footer-meta {{ margin-top: 18px; font-size: 11px; color: var(--ash); letter-spacing: 0.2em; }}

  @media (prefers-reduced-motion: reduce) {{
    .ic-active, .sync-badge[data-status="green"] .badge-dot {{ animation: none; }}
    .sync-badge[data-status="red"] {{ animation: none; }}
    .progress-fill, .card-progress-fill {{ transition: none; }}
    .card {{ transition: none; }}
  }}
</style>
</head>
<body>
<div class="container">

  <header>
    <div class="crest">
      <span class="crest-line"></span>
      <span class="crest-mark"></span>
      <span class="crest-line"></span>
    </div>
    <p class="subtitle">Development Roadmap</p>
    <h1 class="title">Wild<span class="accent">wood</span></h1>

    <div class="sync-badge" data-status="{badge_status}" role="status" aria-live="polite" aria-label="同步状态:{badge_label}">
      <span class="badge-dot"></span>
      <span class="badge-label">{badge_label}</span>
      <span class="badge-detail">
        上次同步 <b>{badge_last_sync_age}</b> · 连续失败 <b>{badge_consecutive_failures}</b> 次 · 最近 commit <b>{badge_last_commit_age}</b>
      </span>
    </div>

    <p class="meta">V0.1 — V0.7 · 整体 {overall_pct}% · 共 {overall_total} 子任务 · 完成 {overall_done} · 进行中 {overall_active} · 同步于 {timestamp}</p>
  </header>

  <section class="progress-block" aria-label="整体进度">
    <div class="progress-head">
      <div class="progress-label">整体进度 · Overall Progress</div>
      <div class="progress-pct">{overall_pct}<span class="small">%</span></div>
    </div>
    <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{overall_pct}">
      <div class="progress-fill" data-target="{overall_pct}"></div>
    </div>
    <div class="progress-detail">
      <span>已完成 <span class="num">{versions_done}</span> / {versions_total} 版本 ({versions_pct}%)</span>
      <span>当前阶段 <span class="num">v0.7 · A/B 通用层</span></span>
      <span>下一里程碑 <span class="num">v1.0 · 正式版</span></span>
    </div>
  </section>

  <section class="grid" aria-label="版本路线图">
{version_cards}
  </section>

  <footer>
    <div class="footer-line"><span class="footer-mark">Repository</span></div>
    <a class="github-link" href="https://github.com/{gh_repo}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
      </svg>
      <span>github.com/<strong>{gh_repo}</strong></span>
    </a>
    <p class="footer-meta">自托管看板 · 自动同步源:aily task 平台 · v0.7.4a 全量版本</p>
  </footer>

</div>

<script>
  window.addEventListener('DOMContentLoaded', () => {{
    requestAnimationFrame(() => {{
      document.querySelectorAll('.progress-fill, .card-progress-fill').forEach(el => {{
        const target = el.getAttribute('data-target');
        if (target != null) el.style.width = target + '%';
      }});
    }});
  }});
</script>
</body>
</html>
'''


# -------------------- GitHub push --------------------
def api(path, method="GET", body=None):
    url = f"https://api.github.com/repos/{GH_REPO}/{path}"
    headers = {
        "Authorization": f"token {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "wildwood-roadmap-sync",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_repo_commit_count():
    try:
        result = api("commits?per_page=100&page=1")
        return len(result) if isinstance(result, list) else 0
    except Exception:
        return 0


def push_html(html_content, target_path="docs/roadmap.html"):
    """Update docs/roadmap.html on main via Git Data API."""
    head = api(f"git/ref/heads/{GH_BRANCH}")["object"]["sha"]
    base_commit = api(f"git/commits/{head}")
    base_tree = base_commit["tree"]["sha"]
    file_blob = None
    try:
        file_meta = api(f"contents/{target_path}?ref={GH_BRANCH}")
        file_blob = file_meta["sha"]
    except urllib.error.HTTPError:
        pass
    b64 = base64.b64encode(html_content.encode("utf-8")).decode("ascii")
    new_blob = api("git/blobs", "POST", {"content": b64, "encoding": "base64"})["sha"]
    if new_blob == file_blob:
        return head, file_blob, get_repo_commit_count()
    new_tree = api("git/trees", "POST", {
        "base_tree": base_tree,
        "tree": [{"path": target_path, "mode": "100644", "type": "blob", "sha": new_blob}],
    })["sha"]
    msg = f"v0.7.4a: 路线图覆盖 v0.1-v0.7 全量子任务 (方案A)\n\n自动同步自 aily task 平台 · 时间 {now_iso()}"
    new_commit = api("git/commits", "POST", {
        "message": msg, "tree": new_tree, "parents": [head]
    })["sha"]
    api(f"git/refs/heads/{GH_BRANCH}", "PATCH", {"sha": new_commit, "force": False})
    return new_commit, new_blob, get_repo_commit_count()


# -------------------- main --------------------
def main():
    parser = argparse.ArgumentParser(description="Wildwood 路线图同步器 v0.7.4a")
    parser.add_argument("--parent-task", default=DEFAULT_PARENT_TASK, help="父任务 ID (默认: %(default)s)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help="HTML 输出路径 (默认: %(default)s)")
    parser.add_argument("--push", action="store_true", help="强制推 GitHub (默认 GH_TOKEN 存在就推)")
    args = parser.parse_args()

    parent_task_id = args.parent_task
    output_path = args.output

    print(f"=== Wildwood Roadmap Sync v0.7.4a ===")
    print(f"父任务:{parent_task_id}")
    print(f"输出:{output_path}")
    print(f"GH_TOKEN:{'已设置' if GH_TOKEN else '未设置(GH_TOKEN 缺失时只生成本地)'}")
    print(f"BOSS_OPEN_ID:{BOSS_OPEN_ID}")
    print(f"LARK_WEBHOOK_URL:{'已设置' if LARK_WEBHOOK_URL else '未设置(走个人私聊)'}")
    print(f"ALERT_DRY_RUN:{'开启(只写本地日志)' if ALERT_DRY_RUN else '关闭(真发)'}")
    print(f"SYNC_DRY_RUN:{'开启' if SYNC_DRY_RUN else '关闭'}")
    print()

    start_ts = now_utc()
    error_msg = ""
    status = "ok"
    commit_sha = ""
    commit_count = 0
    task_count = 0
    html = ""

    try:
        print(f"[1/4] 拉所有子任务 (父 {parent_task_id})...")
        tasks = fetch_all_subtasks(parent_task_id)
        task_count = len(tasks)
        print(f"  共 {task_count} 个子任务\n")

        print(f"[2/4] 归类版本...")
        agg = aggregate(tasks)
        for v in VERSION_ORDER:
            subs = agg["buckets"].get(v, [])
            done = sum(1 for t in subs if t.get("status") == "done")
            print(f"  {v}: {done} / {len(subs)} done")
        if agg["unknown_count"] > 0:
            print(f"  ?: {agg['unknown_count']} 个无法归类")
        print()

        print(f"[3/4] 渲染 HTML...")
        badge = compute_status_badge()
        html = render_html(agg, badge)
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        print(f"  写入 {out} ({len(html)} bytes)\n")

        should_push = (args.push or GH_TOKEN) and not SYNC_DRY_RUN
        if SYNC_DRY_RUN:
            print("[4/4] SYNC_DRY_RUN=1, 跳过 push")
        elif not GH_TOKEN:
            print("[4/4] GH_TOKEN 缺失, 跳过 push, 只保留本地 HTML")
            status = "fail"
            error_msg = "GH_TOKEN missing (kept local HTML only)"
        elif should_push:
            print("[4/4] Pushing to GitHub...")
            commit_sha, _, commit_count = push_html(html)
            if commit_sha:
                print(f"  Done. new HEAD = {commit_sha[:12]}")
                print(f"  https://github.com/{GH_REPO}/commit/{commit_sha}")
            else:
                status = "fail"
                error_msg = "push returned no commit"
        else:
            print("[4/4] 未启用 push")
    except Exception as e:
        tb = traceback.format_exc()
        error_msg = f"{type(e).__name__}: {e}"
        print(f"\n[FAIL] {error_msg}\n{tb}", file=sys.stderr)
        status = "fail"

    duration = (now_utc() - start_ts).total_seconds()
    record_sync_metric(
        start_ts=start_ts, status=status,
        duration_seconds=duration, commit_count=commit_count,
        task_count=task_count, commit_sha=commit_sha, error=error_msg,
    )

    consecutive_failures_after = compute_consecutive_failures()
    if consecutive_failures_after >= ALERT_THRESHOLD:
        recent = read_recent_metrics(n=consecutive_failures_after, source_filter=SCRIPT_SOURCE)
        recent_errors = [r.get("error", "") for r in recent if r.get("status") == "fail"]
        send_lark_alert(consecutive_failures_after, recent_errors)

    print()
    print(f"=== 完成 · {status.upper()} · 耗时 {duration:.2f}s · 任务 {task_count} · {'已推送 ' + commit_sha[:12] if commit_sha else '未推送'} ===")
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
