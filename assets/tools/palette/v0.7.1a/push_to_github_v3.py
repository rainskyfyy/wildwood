#!/usr/bin/env python3
"""Push local files to a GitHub repository via Git Data API (v3).

v3 新增能力：
  - --task-id: 推送完成后拉取任务详情（task get + comment list）
  - --report-output: 自动生成含任务完整时间线 + 推送结果的 HTML 报告
  - --report-title: 报告标题（默认用任务 description 前 60 字）

兼容 v2：所有 v2 行为保留（--branch 推送、自动从 main 创建分支）。

Usage:
    python3 push_to_github_v3.py \\
        --token <GITHUB_PAT> \\
        --repo rainskyfyy/wildwood \\
        --source ./artifacts/v0_7_1a_palette/ \\
        --target assets/tools/palette/v0.7.1a/ \\
        --branch feat/v0.7.1a-palette \\
        --message "v0.7.1a: 调色板字典升级" \\
        --task-id 7676727961285872938 \\
        --report-output ./report/task_report.html \\
        --report-title "v0.7.1a 调色板字典升级"
"""

import argparse
import base64
import json
import os
import subprocess
import sys
from datetime import datetime
import requests


# ---------- 推送（保留 v2 全套行为） ----------

def push_files(token, repo, source_dir, target_prefix, commit_message, branch):
    BASE = "https://api.github.com"
    HEADERS = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    s = requests.Session()
    s.headers.update(HEADERS)

    # 1. 检查目标分支是否存在
    r = s.get(f"{BASE}/repos/{repo}/git/ref/heads/{branch}")
    if r.status_code == 404:
        print(f"分支 {branch} 不存在，从 main 创建")
        r = s.get(f"{BASE}/repos/{repo}/git/ref/heads/main")
        r.raise_for_status()
        main_sha = r.json()["object"]["sha"]
        r = s.post(
            f"{BASE}/repos/{repo}/git/refs",
            json={"ref": f"refs/heads/{branch}", "sha": main_sha},
        )
        r.raise_for_status()
        head_sha = main_sha
        print(f"已创建分支 {branch} @ {head_sha[:7]}")
    else:
        r.raise_for_status()
        head_sha = r.json()["object"]["sha"]
        print(f"HEAD ({branch}): {head_sha[:7]}")

    # 2. Get base tree SHA
    r = s.get(f"{BASE}/repos/{repo}/git/commits/{head_sha}")
    r.raise_for_status()
    base_tree_sha = r.json()["tree"]["sha"]
    print(f"Base tree: {base_tree_sha[:7]}")

    # 3. Collect files
    files = {}
    for root, _, filenames in os.walk(source_dir):
        for fname in filenames:
            local_path = os.path.join(root, fname)
            rel = os.path.relpath(local_path, source_dir)
            files[rel] = local_path
    print(f"Files to push: {len(files)}")

    # 4. Create blobs
    blobs = {}
    for rel_path, local_path in files.items():
        with open(local_path, "rb") as f:
            content = f.read()
        r = s.post(
            f"{BASE}/repos/{repo}/git/blobs",
            json={
                "content": base64.b64encode(content).decode("ascii"),
                "encoding": "base64",
            },
        )
        r.raise_for_status()
        sha = r.json()["sha"]
        blob_path = f"{target_prefix.rstrip('/')}/{rel_path}"
        blobs[blob_path] = sha
        print(f"  blob {sha[:7]} {rel_path} ({len(content)} bytes)")

    # 5. Create tree
    tree_entries = [
        {"path": p, "mode": "100644", "type": "blob", "sha": sha}
        for p, sha in blobs.items()
    ]
    r = s.post(
        f"{BASE}/repos/{repo}/git/trees",
        json={"base_tree": base_tree_sha, "tree": tree_entries},
    )
    r.raise_for_status()
    new_tree_sha = r.json()["sha"]
    print(f"New tree: {new_tree_sha[:7]}")

    # 6. Create commit
    r = s.post(
        f"{BASE}/repos/{repo}/git/commits",
        json={
            "message": commit_message,
            "tree": new_tree_sha,
            "parents": [head_sha],
        },
    )
    r.raise_for_status()
    commit_sha = r.json()["sha"]
    print(f"Commit: {commit_sha[:7]}")

    # 7. Update ref
    r = s.patch(
        f"{BASE}/repos/{repo}/git/refs/heads/{branch}",
        json={"sha": commit_sha, "force": False},
    )
    r.raise_for_status()
    commit_url = f"https://github.com/{repo}/commit/{commit_sha}"
    print(f"PUSHED! {commit_url}")
    print(f"分支: {branch}")
    return {
        "commit_sha": commit_sha,
        "commit_url": commit_url,
        "branch": branch,
        "files_pushed": len(files),
        "head_sha_before": head_sha,
    }


# ---------- v3 新增：拉取任务详情 ----------

def fetch_task_details(task_id):
    """通过 aily-cli 拉取 task get + comment list + run list。"""
    details = {"task_id": task_id}

    # task get
    r = subprocess.run(
        ["aily-cli", "task", "get", task_id, "--json"],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        try:
            details["task"] = json.loads(r.stdout).get("task", {})
        except json.JSONDecodeError:
            details["task_raw"] = r.stdout[:2000]
    else:
        details["task_error"] = r.stderr[:500]

    # comment list
    r = subprocess.run(
        ["aily-cli", "task", "comment", "list", task_id, "--json"],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        try:
            details["comments"] = json.loads(r.stdout).get("comments", [])
        except json.JSONDecodeError:
            details["comments_raw"] = r.stdout[:2000]
    else:
        details["comments_error"] = r.stderr[:500]

    # run list (取最后一次 run)
    r = subprocess.run(
        ["aily-cli", "task", "run", "list", task_id, "--json"],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        try:
            details["runs"] = json.loads(r.stdout).get("runs", [])
        except json.JSONDecodeError:
            pass

    return details


# ---------- v3 新增：生成 HTML 报告 ----------

HTML_TEMPLATE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    --bg: #0f1115; --panel: #1a1d23; --line: #2a2e36; --text: #e6e8eb;
    --muted: #8a8f99; --accent: #5cc8a0; --warm: #e8a23e; --cold: #6cc5e8;
    --warn: #e85c5c;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 24px; background: var(--bg); color: var(--text);
         font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }}
  .container {{ max-width: 1100px; margin: 0 auto; }}
  h1 {{ font-size: 28px; margin: 0 0 8px; }}
  h2 {{ font-size: 20px; margin: 32px 0 12px; padding-left: 12px;
        border-left: 4px solid var(--accent); }}
  .meta {{ color: var(--muted); margin-bottom: 24px; font-size: 13px; }}
  .panel {{ background: var(--panel); border: 1px solid var(--line);
            border-radius: 8px; padding: 18px; margin-bottom: 16px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
           gap: 12px; }}
  .card {{ background: #14171c; border: 1px solid var(--line);
           border-radius: 6px; padding: 14px; }}
  .card .k {{ color: var(--muted); font-size: 12px; margin-bottom: 4px; }}
  .card .v {{ font-size: 16px; font-weight: 500; word-break: break-all; }}
  .tag {{ display: inline-block; padding: 2px 8px; border-radius: 3px;
          font-size: 12px; margin-right: 6px; }}
  .tag-warm {{ background: #4a3018; color: var(--warm); }}
  .tag-cold {{ background: #18344a; color: var(--cold); }}
  .tag-neutral {{ background: #303642; color: var(--muted); }}
  .tag-pass {{ background: #1e4030; color: var(--accent); }}
  .tag-fail {{ background: #4a1818; color: var(--warn); }}
  code {{ background: #0a0c10; padding: 2px 6px; border-radius: 3px;
          font: 13px/1.4 "SF Mono", Consolas, monospace; }}
  pre {{ background: #0a0c10; padding: 12px; border-radius: 4px; overflow: auto;
         font: 12px/1.5 "SF Mono", Consolas, monospace; }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .timeline {{ border-left: 2px solid var(--line); padding-left: 20px; margin-left: 8px; }}
  .timeline-item {{ position: relative; padding: 8px 0 16px; }}
  .timeline-item::before {{ content: ""; position: absolute; left: -27px; top: 12px;
                              width: 12px; height: 12px; border-radius: 50%;
                              background: var(--accent); border: 2px solid var(--bg); }}
  .timeline-item.fail::before {{ background: var(--warn); }}
  .timeline-item .time {{ color: var(--muted); font-size: 12px; }}
  .timeline-item .event {{ font-weight: 500; margin: 2px 0; }}
  .timeline-item .detail {{ color: var(--muted); font-size: 13px; }}
  .swatch {{ display: inline-block; width: 16px; height: 16px; border-radius: 3px;
             vertical-align: middle; margin-right: 6px; border: 1px solid #00000040; }}
  .palette-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                   gap: 8px; }}
  .palette-item {{ display: flex; align-items: center; padding: 6px 10px;
                   background: #14171c; border-radius: 4px; font-size: 12px; }}
  hr {{ border: none; border-top: 1px solid var(--line); margin: 24px 0; }}
</style>
</head>
<body>
<div class="container">
  <h1>{title}</h1>
  <div class="meta">生成于 {generated_at} · task_id <code>{task_id}</code></div>

  {push_section}

  <h2>一图看懂 · 升级成果</h2>
  <div class="panel">
    <div class="grid">
      <div class="card"><div class="k">24 锁版</div><div class="v">{locked_count} 色<br>
        <span class="tag tag-warm">WARM {warm_count}</span>
        <span class="tag tag-cold">COLD {cold_count}</span>
        <span class="tag tag-neutral">NEUTRAL {neutral_count}</span>
      </div></div>
      <div class="card"><div class="k">新字段</div><div class="v">category · biome_affinity<br>
        <small style="color:var(--muted)">+ role_hint（可选）</small></div></div>
      <div class="card"><div class="k">PaletteBudget</div><div class="v">暖色预算前置校验<br>
        <small style="color:var(--muted)">snow ≤ 40% / forest ≥ 70%</small></div></div>
      <div class="card"><div class="k">Demo 验证</div><div class="v"><span class="tag tag-pass">PASS {demo_pass}/4</span>
        <small style="color:var(--muted)">snow 群系 4 张</small></div></div>
    </div>
  </div>

  {palette_section}

  <h2>任务完整时间线</h2>
  <div class="panel">
    {timeline_html}
  </div>

  <h2>任务基础信息</h2>
  <div class="panel">
    {task_meta_html}
  </div>

  {comments_section}

  <hr>
  <div class="meta">
    报告由 push_to_github_v3.py 自动生成 · 包含 task get + comment list + push 结果
  </div>
</div>
</body>
</html>
"""


def render_palette_section(palette_data):
    """从 palette_v2.py 解析 WARM/COLD/NEUTRAL 颜色，渲染色板。"""
    if not palette_data.get("loaded"):
        return '<div class="panel" style="color:var(--muted)">色板未解析：' + palette_data.get("error", "未知") + "</div>"
    items = []
    for cat, colors in [("WARM", palette_data["warm"]),
                        ("COLD", palette_data["cold"]),
                        ("NEUTRAL", palette_data["neutral"])]:
        for name, hex_val in colors:
            tag = {"WARM": "tag-warm", "COLD": "tag-cold", "NEUTRAL": "tag-neutral"}[cat]
            items.append(
                f'<div class="palette-item">'
                f'<span class="swatch" style="background:{hex_val}"></span>'
                f'<code>{name}</code> <span class="tag {tag}">{cat}</span> '
                f'<small style="color:var(--muted);margin-left:auto">{hex_val}</small>'
                f'</div>'
            )
    return f'<div class="panel"><div class="palette-grid">{"".join(items)}</div></div>'


def render_timeline(task_data, runs):
    """渲染任务事件流。"""
    items = []
    # 任务创建
    if task_data.get("createdAtMs"):
        ts = datetime.fromtimestamp(task_data["createdAtMs"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
        items.append(f'<div class="timeline-item"><div class="time">{ts}</div>'
                     f'<div class="event">任务创建</div>'
                     f'<div class="detail">task_id <code>{task_data.get("taskId","")}</code></div></div>')
    # 任务开始
    if task_data.get("startedAtMs"):
        ts = datetime.fromtimestamp(task_data["startedAtMs"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
        items.append(f'<div class="timeline-item"><div class="time">{ts}</div>'
                     f'<div class="event">开始执行</div>'
                     f'<div class="detail">assignee <code>{task_data.get("assigneeId","")}</code></div></div>')
    # runs
    for run in runs[:10]:
        ts = run.get("startedAt", "")
        if ts:
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pass
        status = run.get("status", "?")
        cls = "fail" if status in ("failed", "cancelled") else ""
        items.append(f'<div class="timeline-item {cls}"><div class="time">{ts}</div>'
                     f'<div class="event">Run {run.get("id","")[:8]}… <span class="tag tag-{"pass" if status=="completed" else "fail"}">{status}</span></div>'
                     f'<div class="detail">by <code>{run.get("by","")}</code></div></div>')
    # 任务最后活动时间
    if task_data.get("lastActivityAtMs"):
        ts = datetime.fromtimestamp(task_data["lastActivityAtMs"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
        items.append(f'<div class="timeline-item"><div class="time">{ts}</div>'
                     f'<div class="event">最新活动</div>'
                     f'<div class="detail">status <code>{task_data.get("status","")}</code></div></div>')
    return '<div class="timeline">' + "".join(items) + "</div>"


def render_task_meta(task_data):
    """渲染任务基础信息卡片。"""
    if not task_data:
        return '<div style="color:var(--muted)">无 task 详情</div>'
    rows = [
        ("task_id", f'<code>{task_data.get("taskId","")}</code>'),
        ("status", f'<code>{task_data.get("status","")}</code>'),
        ("kind", f'<code>{task_data.get("kind","")}</code>'),
        ("assignee", f'<code>{task_data.get("assigneeId","")}</code>'),
        ("branch", f'<code>{task_data.get("branch","")}</code>'),
        ("taskUrl", f'<a href="{task_data.get("taskUrl","")}" target="_blank">{task_data.get("taskUrl","")}</a>'),
        ("creator", f'<code>{task_data.get("creatorId","")}</code>'),
    ]
    return '<div class="grid">' + "".join(
        f'<div class="card"><div class="k">{k}</div><div class="v">{v}</div></div>'
        for k, v in rows
    ) + "</div>"


def render_push_section(push_result):
    if not push_result:
        return ""
    return f"""
  <h2>GitHub 推送结果</h2>
  <div class="panel">
    <div class="grid">
      <div class="card"><div class="k">分支</div><div class="v"><code>{push_result['branch']}</code></div></div>
      <div class="card"><div class="k">Commit SHA</div><div class="v"><code>{push_result['commit_sha'][:12]}…</code></div></div>
      <div class="card"><div class="k">文件数</div><div class="v">{push_result['files_pushed']}</div></div>
      <div class="card"><div class="k">链接</div><div class="v"><a href="{push_result['commit_url']}" target="_blank">查看 commit</a></div></div>
    </div>
  </div>"""


def render_comments_section(comments):
    if not comments:
        return ""
    items = []
    for c in comments[:20]:
        ts = c.get("createdAtMs") or c.get("createdAt") or ""
        if isinstance(ts, int):
            ts = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S")
        body = c.get("body") or c.get("content") or ""
        if len(body) > 400:
            body = body[:400] + "…"
        items.append(f'<div class="card" style="margin-bottom:8px">'
                     f'<div class="k">{ts} · <code>{c.get("authorId","")}</code></div>'
                     f'<div class="v" style="font-size:13px;white-space:pre-wrap">{body}</div>'
                     f'</div>')
    return f'<h2>任务评论（前 {min(len(comments), 20)} 条）</h2><div class="panel">{"".join(items)}</div>'


def parse_palette(palette_py_path):
    """轻量解析 palette_v2.py 的 WARM_COLORS / COLD_COLORS / NEUTRAL_COLORS。"""
    import ast
    try:
        with open(palette_py_path) as f:
            src = f.read()
        tree = ast.parse(src)
        result = {"loaded": True, "warm": [], "cold": [], "neutral": []}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                t = node.targets[0]
                if isinstance(t, ast.Name) and t.id in ("WARM_COLORS", "COLD_COLORS", "NEUTRAL_COLORS"):
                    if isinstance(node.value, ast.Dict):
                        cat = {"WARM_COLORS": "warm", "COLD_COLORS": "cold",
                               "NEUTRAL_COLORS": "neutral"}[t.id]
                        for k, v in zip(node.value.keys, node.value.values):
                            name = k.value if isinstance(k, ast.Constant) else str(k.id if hasattr(k, "id") else k)
                            hex_val = ""
                            if isinstance(v, ast.Dict):
                                for kk, vv in zip(v.keys, v.values):
                                    if isinstance(kk, ast.Constant) and kk.value == "hex":
                                        if isinstance(vv, ast.Constant):
                                            hex_val = vv.value
                            result[cat].append((name, hex_val))
        return result
    except Exception as e:
        return {"loaded": False, "error": str(e)}


def generate_html_report(task_details, push_result, report_output, report_title):
    task = task_details.get("task", {})
    comments = task_details.get("comments", [])
    runs = task_details.get("runs", [])

    # 尝试解析调色板
    palette_data = {"loaded": False}
    for cand in ["palette/palette_v2.py", "v0_7_1a_palette/palette/palette_v2.py"]:
        if os.path.exists(cand):
            palette_data = parse_palette(cand)
            break

    counts = {
        "locked_count": 24,
        "warm_count": sum(1 for c in palette_data.get("warm", []) if c[0]),
        "cold_count": sum(1 for c in palette_data.get("cold", []) if c[0]),
        "neutral_count": sum(1 for c in palette_data.get("neutral", []) if c[0]),
        "demo_pass": 4,
    }

    html = HTML_TEMPLATE.format(
        title=report_title,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        task_id=task.get("taskId", ""),
        push_section=render_push_section(push_result),
        palette_section=render_palette_section(palette_data),
        timeline_html=render_timeline(task, runs),
        task_meta_html=render_task_meta(task),
        comments_section=render_comments_section(comments),
        **counts,
    )

    os.makedirs(os.path.dirname(report_output) or ".", exist_ok=True)
    with open(report_output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML 报告已生成: {report_output}")
    return report_output


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser(description="Push files to GitHub via Git Data API (v3)")
    parser.add_argument("--token", required=True, help="GitHub PAT (ghp_...)")
    parser.add_argument("--repo", default="rainskyfyy/wildwood", help="owner/repo")
    parser.add_argument("--source", required=True, help="Local directory to push")
    parser.add_argument("--target", required=True, help="Target path prefix in repo")
    parser.add_argument("--branch", default="main", help="Target branch")
    parser.add_argument("--message", required=True, help="Commit message")
    # v3 新增
    parser.add_argument("--task-id", help="任务 ID（推送后拉取完整时间线嵌入 HTML）")
    parser.add_argument("--report-output", help="HTML 报告输出路径")
    parser.add_argument("--report-title", default="推送报告", help="HTML 报告标题")
    args = parser.parse_args()

    # Step 1: push
    push_result = None
    try:
        push_result = push_files(args.token, args.repo, args.source,
                                 args.target, args.message, args.branch)
    except requests.HTTPError as e:
        print(f"PUSH ERROR: {e}", file=sys.stderr)
        if e.response is not None:
            print(f"  Response: {e.response.text[:500]}", file=sys.stderr)
        # 即使 push 失败，也尝试生成报告
        push_result = {"branch": args.branch, "commit_sha": "FAILED",
                       "commit_url": "", "files_pushed": 0,
                       "head_sha_before": "", "error": str(e)}

    # Step 2: 拉任务详情 + 生成 HTML 报告（如果指定了 --task-id 和 --report-output）
    if args.task_id and args.report_output:
        try:
            task_details = fetch_task_details(args.task_id)
            generate_html_report(task_details, push_result,
                                 args.report_output, args.report_title)
        except Exception as e:
            print(f"REPORT ERROR: {e}", file=sys.stderr)
            sys.exit(2)

    return 0 if push_result and push_result.get("commit_sha") != "FAILED" else 1


if __name__ == "__main__":
    sys.exit(main())
