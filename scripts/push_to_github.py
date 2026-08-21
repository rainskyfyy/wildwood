#!/usr/bin/env python3
"""
push_to_github.py — 批量推多个文件改动到 GitHub main 分支。
适用于 v0.5.x 各子任务提交 UI 模块代码改动。

调用:
  python3 scripts/push_to_github.py --files <path1> <path2> ... --message <commit msg>

环境:
  GH_TOKEN     — GitHub PAT (必须从环境变量传入)

依赖:
  python3 stdlib (json, urllib, base64)
"""
import argparse
import base64
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

# -------------------- config --------------------
GH_REPO   = os.environ.get("GH_REPO",  "rainskyfyy/wildwood")
GH_BRANCH = os.environ.get("GH_BRANCH", "main")
GH_TOKEN  = os.environ.get("GH_TOKEN", "")


def api(path, method="GET", body=None):
    if not GH_TOKEN:
        print("ERROR: GH_TOKEN env var is required", file=sys.stderr)
        sys.exit(2)
    url = f"https://api.github.com/repos/{GH_REPO}/{path}"
    headers = {
        "Authorization": f"token {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "wildwood-push-helper",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {method} {url}\n{body_txt}", file=sys.stderr)
        raise


def push_files(file_paths, commit_message, repo_root="."):
    """Push list of files to GH_BRANCH.

    Returns (new_commit_sha, list_of_blobs).
    """
    # 1. Read current main HEAD.
    head = api(f"git/ref/heads/{GH_BRANCH}")["object"]["sha"]
    base_commit = api(f"git/commits/{head}")
    base_tree = base_commit["tree"]["sha"]

    # 2. For each file: read content, create blob.
    tree_entries = []
    blobs_info = []
    for fpath in file_paths:
        full = os.path.join(repo_root, fpath)
        if not os.path.exists(full):
            print(f"ERROR: file not found: {full}", file=sys.stderr)
            sys.exit(1)
        with open(full, "rb") as f:
            content = f.read()
        # detect binary: try utf-8 decode
        try:
            text = content.decode("utf-8")
            is_binary = False
        except UnicodeDecodeError:
            text = None
            is_binary = True

        if is_binary:
            blob_sha = api("git/blobs", "POST", {
                "content": base64.b64encode(content).decode("ascii"),
                "encoding": "base64",
            })["sha"]
        else:
            blob_sha = api("git/blobs", "POST", {
                "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
                "encoding": "base64",
            })["sha"]
        blobs_info.append((fpath, blob_sha, len(content)))
        tree_entries.append({
            "path": fpath,
            "mode": "100644",
            "type": "blob",
            "sha": blob_sha,
        })

    # 3. New tree (with all changes based on base).
    new_tree = api("git/trees", "POST", {
        "base_tree": base_tree,
        "tree": tree_entries,
    })["sha"]

    # 4. New commit.
    new_commit = api("git/commits", "POST", {
        "message": commit_message,
        "tree": new_tree,
        "parents": [head],
    })["sha"]

    # 5. Patch ref.
    api(f"git/refs/heads/{GH_BRANCH}", "PATCH", {"sha": new_commit, "force": False})

    return new_commit, blobs_info


def main():
    ap = argparse.ArgumentParser(description="Push file changes to GitHub main")
    ap.add_argument("--files", nargs="+", required=True, help="files to push (relative to repo root)")
    ap.add_argument("--message", required=True, help="commit message")
    ap.add_argument("--root", default=".", help="repo root path")
    args = ap.parse_args()

    print(f"Pushing {len(args.files)} files to {GH_REPO}@{GH_BRANCH}")
    for f in args.files:
        print(f"  - {f}")

    commit, blobs = push_files(args.files, args.message, repo_root=args.root)
    print(f"\nDone. new HEAD = {commit[:12]}")
    print(f"  https://github.com/{GH_REPO}/commit/{commit}")
    print(f"\nBlobs:")
    for f, sha, sz in blobs:
        print(f"  {f}  {sha[:12]}  {sz}B")


if __name__ == "__main__":
    main()
