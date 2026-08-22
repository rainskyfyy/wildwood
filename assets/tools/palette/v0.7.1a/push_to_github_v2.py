#!/usr/bin/env python3
"""Push local files to a GitHub repository via Git Data API.

Usage:
    python3 push_to_github_v2.py \\
        --token <GITHUB_PAT> \\
        --repo rainskyfyy/wildwood \\
        --source ./artifacts/ \\
        --target assets/tools/palette/v0.7.1a/ \\
        --branch feat/v0.7.1a-palette \\
        --message "v0.7.1a: 调色板字典升级"

Notes:
  - 分支不存在时自动从 main 创建
  - 推送到非 main 分支不会触发 main 移动
"""

import argparse
import base64
import os
import sys
import requests


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
        # 分支不存在 → 从 main 创建
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
    print(f"PUSHED! https://github.com/{repo}/commit/{commit_sha}")
    print(f"分支: {branch}")
    return commit_sha


def main():
    parser = argparse.ArgumentParser(description="Push files to GitHub via Git Data API")
    parser.add_argument("--token", required=True, help="GitHub PAT (ghp_...)")
    parser.add_argument("--repo", default="rainskyfyy/wildwood", help="owner/repo")
    parser.add_argument("--source", required=True, help="Local directory to push")
    parser.add_argument("--target", required=True, help="Target path prefix in repo")
    parser.add_argument("--branch", default="main", help="Target branch")
    parser.add_argument("--message", required=True, help="Commit message")
    args = parser.parse_args()

    try:
        push_files(args.token, args.repo, args.source, args.target, args.message, args.branch)
    except requests.HTTPError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        if e.response is not None:
            print(f"  Response: {e.response.text[:500]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
