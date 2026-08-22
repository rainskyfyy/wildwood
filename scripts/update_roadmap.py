#!/usr/bin/env python3
"""
update_roadmap.py — 拉 14 个子任务状态,重渲染 docs/roadmap.html,直推 GitHub main。
调用:
  python3 scripts/update_roadmap.py
环境:
  GH_TOKEN     — GitHub PAT (必须从环境变量传入,本脚本不内置)
  GH_REPO      — 默认 "rainskyfyy/wildwood"
  GH_BRANCH    — 默认 "main"
依赖:
  aily-cli     — 读 task 状态
  python3 stdlib (json, urllib, base64, subprocess)
数据源: 14 个 task 的 aily-cli task get status。
- v0.3 = 6 个 (M2.9 建造 / M2.10 资源 / M2.14 怪物 / M2.12 HUD / M2.11 图鉴 / M2.13 4屏)
- v0.4 = 3 个 (M3.11 压力 / 联机 / 音效)
- v0.5 = 7 个 (美术资产 / 生态链 / Boss / 农耕 / 烹饪 UI / NPC 村落 / 交易 UI)
算法:
- v0.3 进度 = done / 6
- v0.4 进度 = done / 3
- v0.5 进度 = done / 7 (全部 7 个子任务)
- 整体进度 = (v0.1 + v0.2 + v0.3 + v0.4 + v0.5) / 5
- 状态映射:
    all done       → "done"   (绿)
    any done/active → "active" (橙)
    all pending     → "pending" (灰)
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
# -------------------- config --------------------
GH_TOKEN  = os.environ.get("GH_TOKEN")  # 必须由调用方提供,本脚本不内置凭证
GH_REPO   = os.environ.get("GH_REPO",  "rainskyfyy/wildwood")
GH_BRANCH = os.environ.get("GH_BRANCH", "main")
# 14 个子任务 ID
TASKS = {
    # v0.3
    "7676546339936668632": {"name": "M2.9 建造系统",   "version": "v0.3", "deliverable": "建造系统"},
    "7676546340125445076": {"name": "M2.10 资源系统",  "version": "v0.3", "deliverable": "资源系统"},
    "7676546339919907809": {"name": "M2.14 怪物动画",  "version": "v0.3", "deliverable": "怪物动画"},
    "7676544224770133209": {"name": "M2.12 HUD 主屏",  "version": "v0.3", "deliverable": "HUD 主屏"},
    "7676544297337457870": {"name": "M2.11 图鉴",      "version": "v0.3", "deliverable": "图鉴系统"},
    "7676544297604238278": {"name": "M2.13 4屏交互",   "version": "v0.3", "deliverable": "4 屏交互"},
    # v0.4
    "7676546340041559002": {"name": "M3.11 压力测试",  "version": "v0.4", "deliverable": "压力测试"},
    "7676561368459250978": {"name": "v0.4 联机系统",  "version": "v0.4", "deliverable": "联机同步"},
    "7676561368429906908": {"name": "v0.4 音效系统",  "version": "v0.4", "deliverable": "音效接入"},
    # v0.5
    "7676577204225969084": {"name": "v0.5 美术资产",      "version": "v0.5", "deliverable": "美术资产"},
    "7676577204104367077": {"name": "v0.5.1 生态链与新群系", "version": "v0.5", "deliverable": "新群系"},
    "7676577204016253889": {"name": "v0.5.2 Boss 与事件",  "version": "v0.5", "deliverable": "Boss 事件"},
    "7676577204058197209": {"name": "v0.5.3 农耕与烹饪",  "version": "v0.5", "deliverable": "农耕烹饪"},
    "7676577365236911289": {"name": "v0.5.3 烹饪 UI",    "version": "v0.5", "deliverable": "烹饪 UI"},
    "7676577365446626234": {"name": "v0.5.4 NPC 村落",    "version": "v0.5", "deliverable": "NPC 村落"},
    "7676577365496974310": {"name": "v0.5.4 交易 UI",    "version": "v0.5", "deliverable": "交易 UI"},
}
V03_TOTAL_DELIVERABLES = 6  # 6 个 v0.3 task
V04_TOTAL_DELIVERABLES = 3  # HTML 列 3 个 v0.4 deliverable
V05_TOTAL_DELIVERABLES = 4  # HTML 列 4 个 v0.5 deliverable 槽位
# -------------------- aily-cli 桥接 --------------------
def get_task_status(task_id):
    """Read aily-cli task get <id>, return status (str)."""
    try:
        out = subprocess.run(
            ["aily-cli", "task", "get", task_id],
            capture_output=True, text=True, timeout=15
        )
        if out.returncode != 0:
            print(f"  WARN {task_id} exit={out.returncode}: {out.stderr.strip()}", file=sys.stderr)
            return None
        d = json.loads(out.stdout)
        return d.get("task", d).get("status")
    except Exception as e:
        print(f"  WARN {task_id}: {e}", file=sys.stderr)
        return None
# -------------------- 算法 --------------------
def summarize(tasks_status):
    """Return {v03, v04, v05, overall, current_phase, next_milestone}."""
    v03 = [t for t in tasks_status.values() if t["version"] == "v0.3"]
    v04 = [t for t in tasks_status.values() if t["version"] == "v0.4"]
    v05 = [t for t in tasks_status.values() if t["version"] == "v0.5"]
    def agg(subs):
        statuses = [t["status"] for t in subs if t["status"]]
        done = sum(1 for s in statuses if s == "done")
        active = sum(1 for s in statuses if s == "in_progress")
        return {"done": done, "active": active, "subs": len(subs)}
    v03s = agg(v03)
    v04s = agg(v04)
    v05s = agg(v05)
    # 卡片状态
    def card_status(s):
        if s["done"] > 0 and s["active"] == 0 and s["done"] == s["subs"]:
            return "done"
        elif s["done"] + s["active"] > 0:
            return "active"
        else:
            return "pending"
    v03s["card_status"] = card_status(v03s)
    v04s["card_status"] = card_status(v04s)
    v05s["card_status"] = card_status(v05s)
    # 进度 = done / 总子任务数
    v03s["ratio"] = v03s["done"] / len(v03) if v03 else 0
    v04s["ratio"] = v04s["done"] / len(v04) if v04 else 0
    v05s["ratio"] = v05s["done"] / len(v05) if v05 else 0
    v03s["html_total"] = V03_TOTAL_DELIVERABLES
    v04s["html_total"] = V04_TOTAL_DELIVERABLES
    v05s["html_total"] = V05_TOTAL_DELIVERABLES
    # 整体 = 5 版本平均
    overall = (1.0 + 1.0 + v03s["ratio"] + v04s["ratio"] + v05s["ratio"]) / 5
    # 当前阶段: 找最高活跃版本
    if v05s["card_status"] != "pending":
        cur = "v0.5 · 世界深化"
        next_m = "v1.0 · 正式版"
    elif v04s["card_status"] != "pending":
        cur = "v0.4 · 打磨与联机"
        next_m = "v0.5 · 世界深化"
    elif v03s["card_status"] != "pending":
        cur = "v0.3 · 游戏系统"
        next_m = "v0.4 · 打磨与联机"
    else:
        cur = "v0.3 · 游戏系统"
        next_m = "v0.4 · 打磨与联机"
    # 已完成版本数
    versions_done = 2  # v0.1, v0.2
    if v03s["card_status"] == "done":
        versions_done += 1
    if v04s["card_status"] == "done":
        versions_done += 1
    if v05s["card_status"] == "done":
        versions_done += 1
    return {
        "v03": v03s, "v04": v04s, "v05": v05s,
        "overall": overall,
        "current_phase": cur,
        "next_milestone": next_m,
        "versions_done": versions_done,
    }
# -------------------- 渲染 --------------------
SVG_DONE = '''<svg class="ic-done" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>'''
SVG_ACTIVE = '''<svg class="ic-active" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6"/></svg>'''
SVG_PENDING = '''<svg class="ic-pending" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/></svg>'''
def status_label(s):
    return {"done": "已完成", "active": "进行中", "pending": "待启动"}.get(s, "未知")
def render_html(summary):
    pct = round(summary["overall"] * 100)
    v05_done = summary["v05"]["done"]
    return HTML_TEMPLATE.format(
        overall_pct=pct,
        v03_status=summary["v03"]["card_status"],
        v04_status=summary["v04"]["card_status"],
        v05_status=summary["v05"]["card_status"],
        v03_progress_pct=round(summary["v03"]["ratio"] * 100),
        v04_progress_pct=round(summary["v04"]["ratio"] * 100),
        v05_progress_pct=round(summary["v05"]["ratio"] * 100),
        v03_done_count=summary["v03"]["done"],
        v04_done_count=summary["v04"]["done"],
        v05_done_count=v05_done,
        v03_deliverables=render_v03_deliverables(summary),
        v04_deliverables=render_v04_deliverables(summary),
        v05_deliverables=render_v05_deliverables(summary),
        current_phase=summary["current_phase"],
        next_milestone=summary["next_milestone"],
        versions_done=summary["versions_done"],
        timestamp=now_iso(),
        v03_status_label=status_label(summary["v03"]["card_status"]),
        v04_status_label=status_label(summary["v04"]["card_status"]),
        v05_status_label=status_label(summary["v05"]["card_status"]),
        v03_html_total=V03_TOTAL_DELIVERABLES,
        v04_html_total=V04_TOTAL_DELIVERABLES,
        v05_html_total=V05_TOTAL_DELIVERABLES,
        gh_repo=GH_REPO,
        svg_done=SVG_DONE,
        svg_active=SVG_ACTIVE,
        svg_pending=SVG_PENDING,
    )
def render_li(label, body, owner, status):
    if status == "done":
        svg = SVG_DONE
    elif status == "in_progress":
        svg = SVG_ACTIVE
    else:
        svg = SVG_PENDING
    return f'''        <li class="deliverable">
          <span class="icon">{svg}</span>
          <span class="text"><strong>{label}</strong>:{body}<span class="assignee">负责人 · {owner}</span></span>
        </li>'''
def render_v03_deliverables(summary):
    order = [
        ("7676546339936668632", "建造系统",   "建造菜单、放置预览、建筑实体",        "高级开发工程师"),
        ("7676546340125445076", "资源系统",   "采集、物品栏、合成",                  "高级开发工程师"),
        ("7676546339919907809", "怪物动画",   "帧动画引擎、5 种怪物 AI",            "高级开发工程师"),
        ("7676544224770133209", "HUD 主屏",   "组装组件替换 Canvas 占位",            "UI 设计师"),
        ("7676544297337457870", "图鉴系统",   "双 Tab + 64px 插画 + 详情卡 (M2.11)",  "UI 设计师"),
        ("7676544297604238278", "4 屏交互",   "主屏/图鉴/建造/背包切换",              "UI 设计师"),
    ]
    return "\n".join(render_li(l, b, o, TASKS[t]["_status"]) for t, l, b, o in order)
def render_v04_deliverables(summary):
    order = [
        ("7676546340041559002", "压力测试",   "500×500 地图、500 实体 FPS、碰撞检测", "高级开发工程师"),
        ("7676561368459250978", "联机同步",   "P2P/WebRTC 联机、状态同步、断线重连", "高级开发工程师"),
        ("7676561368429906908", "音效接入",   "BGM + SFX 音效系统、Web Audio API",    "高级开发工程师"),
    ]
    return "\n".join(render_li(l, b, o, TASKS[t]["_status"]) for t, l, b, o in order)
def render_v05_deliverables(summary):
    """Render 4 v0.5 deliverable <li> items. 美术资产/烹饪 UI/交易 UI 计入整体进度但不单独显示槽位。"""
    order = [
        ("7676577204104367077", "新群系",     "森林+草原群系、生态链、6 群系世界生成", "高级开发工程师"),
        ("7676577204016253889", "Boss 事件",  "4 只季节 Boss + 阶段切换 + 随机事件",  "高级开发工程师"),
        ("7676577204058197209", "农耕烹饪",   "耕地播种、8 种作物、30 食谱、加工站",  "高级开发工程师"),
        ("7676577365446626234", "NPC 村落",   "猪人村落、以物易物、随从招募",          "高级开发工程师"),
    ]
    return "\n".join(render_li(l, b, o, TASKS[t]["_status"]) for t, l, b, o in order)
def now_iso():
    """UTC ISO-8601 with second precision (no microseconds)."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
# -------------------- HTML 模板 --------------------
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
  /* Header */
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
  .meta {{ font-size: 12px; color: var(--ash); letter-spacing: 0.2em; font-family: ui-monospace, "SF Mono", Menlo, monospace; }}
  /* Progress block */
  .progress-block {{
    max-width: 720px; margin: 0 auto 72px; padding: 28px 36px;
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
  /* Grid + cards */
  .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }}
  @media (max-width: 1100px) {{ .grid {{ grid-template-columns: repeat(2, 1fr); }} }}
  @media (max-width: 640px) {{ .grid {{ grid-template-columns: 1fr; }} body {{ padding: 32px 16px 60px; }} }}
  .card {{
    position: relative;
    background: linear-gradient(180deg, var(--night-elev), var(--night-black));
    border: 1px solid var(--night-line);
    padding: 28px 24px 24px; display: flex; flex-direction: column; min-height: 460px;
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
  .card-title {{ font-size: 18px; color: var(--bone); margin: 14px 0 6px; font-weight: 500; letter-spacing: 0.05em; }}
  .card-sub {{ font-size: 12px; color: var(--ash-soft); letter-spacing: 0.12em; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--night-line); }}
  .deliverables {{ list-style: none; display: flex; flex-direction: column; gap: 10px; flex: 1; }}
  .deliverable {{ display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45; color: var(--ash-soft); padding: 6px 0; }}
  .deliverable .icon {{ flex-shrink: 0; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }}
  .deliverable .text {{ flex: 1; }}
  .deliverable .text strong {{ color: var(--bone); font-weight: 500; }}
  .deliverable .assignee {{ display: block; font-size: 11px; color: var(--ash); letter-spacing: 0.08em; margin-top: 2px; font-style: italic; }}
  .ic-done {{ color: var(--moss-glow); }}
  .ic-active {{ color: var(--ember-glow); animation: spin 2.4s linear infinite; }}
  .ic-pending {{ color: var(--cinder); }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .card-progress {{ margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--night-line); }}
  .card-progress-label {{ display: flex; justify-content: space-between; font-size: 11px; color: var(--ash); letter-spacing: 0.15em; margin-bottom: 8px; }}
  .card-progress-bar {{ height: 4px; background: var(--night-deep); border: 1px solid var(--night-line); position: relative; overflow: hidden; }}
  .card-progress-fill {{ position: absolute; inset: 0; width: 0; background: currentColor; transition: width 1.4s cubic-bezier(0.22, 1, 0.36, 1) 0.6s; }}
  .card[data-status="done"]    .card-progress-fill {{ background: var(--moss); }}
  .card[data-status="active"]  .card-progress-fill {{ background: var(--ember); }}
  .card[data-status="pending"] .card-progress-fill {{ background: var(--cinder); }}
  .milestone {{ margin-top: 14px; padding: 10px 12px; background: rgba(201, 161, 74, 0.05); border-left: 2px solid var(--gold); font-size: 12px; color: var(--parchment); letter-spacing: 0.05em; }}
  .card[data-status="pending"] .milestone {{ display: none; }}
  .milestone-label {{ font-size: 10px; color: var(--gold); letter-spacing: 0.25em; text-transform: uppercase; display: block; margin-bottom: 2px; }}
  /* Footer */
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
  @media (max-width: 1100px) {{ .card {{ min-height: auto; }} }}
  @media (prefers-reduced-motion: reduce) {{
    .ic-active {{ animation: none; }}
    .progress-fill, .card-progress-fill {{ transition: none; }}
    .card {{ transition: none; }}
  }}
</style>
</head>
<body>
<div class="container">
  <!-- HEADER -->
  <header>
    <div class="crest">
      <span class="crest-line"></span>
      <span class="crest-mark"></span>
      <span class="crest-line"></span>
    </div>
    <p class="subtitle">Development Roadmap</p>
    <h1 class="title">Wild<span class="accent">wood</span></h1>
    <p class="meta">V0.1 — V0.5 · 整体 {overall_pct}% · 自动同步于 {timestamp}</p>
  </header>
  <!-- PROGRESS -->
  <section class="progress-block" aria-label="整体进度">
    <div class="progress-head">
      <div class="progress-label">整体进度 · Overall Progress</div>
      <div class="progress-pct">{overall_pct}<span class="small">%</span></div>
    </div>
    <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{overall_pct}">
      <div class="progress-fill" data-target="{overall_pct}"></div>
    </div>
    <div class="progress-detail">
      <span>已完成 <span class="num">{versions_done}</span> / 5 版本</span>
      <span>当前阶段 <span class="num">{current_phase}</span></span>
      <span>下一里程碑 <span class="num">{next_milestone}</span></span>
    </div>
  </section>
  <!-- VERSION CARDS -->
  <section class="grid" aria-label="版本路线图">
    <!-- v0.1 -->
    <article class="card" data-status="done">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">v0.1</div>
        <span class="status-badge"><span class="status-dot"></span>已完成</span>
      </div>
      <h2 class="card-title">美术资产</h2>
      <p class="card-sub">Art Assets · 78 PNG</p>
      <ul class="deliverables">
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>帧动画</strong>:hero 29 帧 + 5 怪物各 20 帧(129 PNG)</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>4 群系</strong>:5 tiles + 5 elements × 4 = 40 PNG</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>过渡带</strong>:6 对 × 3 步 = 18 PNG</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>装饰元素</strong>:4 群系 × 4 = 16 PNG</span></li>
      </ul>
      <div class="milestone"><span class="milestone-label">产出 · Output</span>129 个 PNG,覆盖 4 群系全部美术需求</div>
      <div class="card-progress">
        <div class="card-progress-label"><span>交付项</span><span>4 / 4</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="100"></div></div>
      </div>
    </article>
    <!-- v0.2 -->
    <article class="card" data-status="done">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">v0.2</div>
        <span class="status-badge"><span class="status-dot"></span>已完成</span>
      </div>
      <h2 class="card-title">核心引擎</h2>
      <p class="card-sub">Core Engine · Playable Demo</p>
      <ul class="deliverables">
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>世界生成</strong>:Perlin noise + 4 群系分布</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>玩家控制器</strong>:WASD + 摄像机跟随 + 碰撞</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>基础 HUD</strong>:三围条 + 快捷栏 + 小地图</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>美术接入</strong>:41 张真实 PNG 替换程序绘制</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>UI 布局</strong>:1440×900 暗黑哥特 + 5 锚定区</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>UI 组件库</strong>:6 类 × 3 变体 CSS</span></li>
        <li class="deliverable"><span class="icon">{svg_done}</span><span class="text"><strong>图鉴 + 建造</strong>:双 Tab + 径向菜单</span></li>
      </ul>
      <div class="milestone"><span class="milestone-label">产出 · Output</span>可运行的 HTML5 Canvas 游戏 Demo + 完整 UI 框架</div>
      <div class="card-progress">
        <div class="card-progress-label"><span>交付项</span><span>7 / 7</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="100"></div></div>
      </div>
    </article>
    <!-- v0.3 (auto) -->
    <article class="card" data-status="{v03_status}">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">v0.3</div>
        <span class="status-badge"><span class="status-dot"></span>{v03_status_label}</span>
      </div>
      <h2 class="card-title">游戏系统</h2>
      <p class="card-sub">Game Systems · {v03_done_count} / {v03_html_total} 完成</p>
      <ul class="deliverables">
{v03_deliverables}
      </ul>
      <div class="card-progress">
        <div class="card-progress-label"><span>交付项</span><span>{v03_done_count} / {v03_html_total}</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="{v03_progress_pct}"></div></div>
      </div>
    </article>
    <!-- v0.4 (auto) -->
    <article class="card" data-status="{v04_status}">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">v0.4</div>
        <span class="status-badge"><span class="status-dot"></span>{v04_status_label}</span>
      </div>
      <h2 class="card-title">打磨与联机</h2>
      <p class="card-sub">Polish &amp; Multiplayer · {v04_done_count} / {v04_html_total} 完成</p>
      <ul class="deliverables">
{v04_deliverables}
      </ul>
      <div class="card-progress">
        <div class="card-progress-label"><span>交付项</span><span>{v04_done_count} / {v04_html_total}</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="{v04_progress_pct}"></div></div>
      </div>
    </article>
    <!-- v0.5 (auto) -->
    <article class="card" data-status="{v05_status}">
      <span class="card-corner tl"></span><span class="card-corner tr"></span>
      <span class="card-corner bl"></span><span class="card-corner br"></span>
      <div class="card-head">
        <div class="version">v0.5</div>
        <span class="status-badge"><span class="status-dot"></span>{v05_status_label}</span>
      </div>
      <h2 class="card-title">世界深化</h2>
      <p class="card-sub">World Deepening · {v05_done_count} / 7 子任务完成</p>
      <ul class="deliverables">
{v05_deliverables}
      </ul>
      <div class="card-progress">
        <div class="card-progress-label"><span>交付项</span><span>{v05_done_count} / 7</span></div>
        <div class="card-progress-bar"><div class="card-progress-fill" data-target="{v05_progress_pct}"></div></div>
      </div>
    </article>
  </section>
  <!-- FOOTER -->
  <footer>
    <div class="footer-line"><span class="footer-mark">Repository</span></div>
    <a class="github-link" href="https://github.com/{gh_repo}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
      </svg>
      <span>github.com/<strong>{gh_repo}</strong></span>
    </a>
    <p class="footer-meta">自托管看板 · 自动同步源:aily task 平台 · 每 30 分钟刷新</p>
  </footer>
</div>
<script>
  // Animate progress bars on load
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
# render_html() already does single-pass .format() with all template keys,
# so it returns the final HTML. No second pass needed.
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
def push_html(html_content):
    """Update docs/roadmap.html on main via Git Data API.
    Returns (new_commit_sha, file_sha).
    """
    # 1. Read current main HEAD.
    head = api(f"git/ref/heads/{GH_BRANCH}")["object"]["sha"]
    base_commit = api(f"git/commits/{head}")
    base_tree = base_commit["tree"]["sha"]
    # 2. Get existing file blob sha (so we can avoid bumping it on no-op).
    file_blob = None
    try:
        file_meta = api("contents/docs/roadmap.html?ref=" + GH_BRANCH)
        file_blob = file_meta["sha"]
    except urllib.error.HTTPError:
        pass
    # 3. Create new blob.
    b64 = base64.b64encode(html_content.encode("utf-8")).decode("ascii")
    new_blob = api("git/blobs", "POST", {"content": b64, "encoding": "base64"})["sha"]
    if new_blob == file_blob:
        return head, file_blob  # No change.
    # 4. New tree.
    new_tree = api("git/trees", "POST", {
        "base_tree": base_tree,
        "tree": [{"path": "docs/roadmap.html", "mode": "100644", "type": "blob", "sha": new_blob}],
    })["sha"]
    # 5. New commit.
    msg = f"roadmap auto-sync · {now_iso()}\n\n更新自 aily task 平台:14 个子任务实时状态"
    new_commit = api("git/commits", "POST", {
        "message": msg, "tree": new_tree, "parents": [head]
    })["sha"]
    # 6. Patch ref.
    api(f"git/refs/heads/{GH_BRANCH}", "PATCH", {"sha": new_commit, "force": False})
    return new_commit, new_blob
# -------------------- main --------------------
def main():
    print("Reading task statuses from aily-cli...")
    statuses = {}
    for tid in TASKS:
        s = get_task_status(tid)
        statuses[tid] = s
        TASKS[tid]["_status"] = s
        print(f"  {tid}  {s}")
    summary = summarize({tid: {**TASKS[tid], "status": s} for tid, s in statuses.items()})
    print(f"\nSummary: overall={summary['overall']:.0%}  v0.3={summary['v03']['card_status']}({summary['v03']['done']}/6)  v0.4={summary['v04']['card_status']}({summary['v04']['done']}/3)  v0.5={summary['v05']['card_status']}({summary['v05']['done']}/7)")
    html = render_html(summary)
    print(f"\nRendered HTML: {len(html)} bytes")
    print("\nPushing to GitHub...")
    commit, blob = push_html(html)
    if commit:
        print(f"  Done. new HEAD = {commit[:12]}")
        print(f"  https://github.com/{GH_REPO}/commit/{commit}")
    else:
        print("  No change.")
if __name__ == "__main__":
    main()
