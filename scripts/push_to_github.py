#!/usr/bin/env python3
"""
push_to_github.py — Direct push to GitHub via Git Data API (no git credentials).

Usage: python3 push_to_github.py <repo> <branch> <path_to_files> [commit_msg]

v0.7.0c change: adds a second-time base_sha recheck between building the
new tree and creating the new commit. The original flow had a TOCTOU
race: between GET ref and PATCH ref, a teammate (or the `roadmap
auto-sync` cron — see MEMORY.md) could push a new commit. Without
recheck, we'd still POST a commit with `parents: [old_head_sha]`,
creating a non-fast-forward commit, and PATCH ref would silently
succeed (or fail with 422, depending on GitHub's mood). The new
recheck explicitly aborts and asks the caller to re-run.
"""
import sys
import os
import json
import urllib.request
import urllib.error
import base64
from pathlib import Path

REPO = sys.argv[1] if len(sys.argv) > 1 else "rainskyfyy/wildwood"
BRANCH = sys.argv[2] if len(sys.argv) > 2 else "main"
ROOT = sys.argv[3] if len(sys.argv) > 3 else "."
MSG = sys.argv[4] if len(sys.argv) > 4 else "chore: bulk push via API"

# PAT from env (set GH_PAT=... before running); not stored in this file
PAT = os.environ.get("GH_PAT", "")
if not PAT:
    print("ERROR: GH_PAT env var not set. Set it to a valid GitHub PAT before running.", file=sys.stderr)
    sys.exit(1)

API = f"https://api.github.com/repos/{REPO}"
AUTH = f"token {PAT}"


def req(method, url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": AUTH,
        "Accept": "application/vnd.github+json",
        "User-Agent": "aily-push",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"HTTP {e.code} on {method} {url}\n{body}", file=sys.stderr)
        raise


def get_ref_sha():
    """GET /git/ref/heads/<BRANCH> and return the current head sha."""
    ref = req("GET", f"{API}/git/ref/heads/{BRANCH}")
    return ref["object"]["sha"]


def main():
    print(f"Pushing to {REPO}@{BRANCH} from {ROOT}")
    # 1. Get current HEAD
    head_sha = get_ref_sha()
    print(f"Current HEAD: {head_sha}")
    commit = req("GET", f"{API}/git/commits/{head_sha}")
    base_tree = commit["tree"]["sha"]
    print(f"Base tree: {base_tree}")

    # 2. Collect files (relative to ROOT, exclude .git, node_modules, __pycache__, etc.)
    root = Path(ROOT).resolve()
    skip = {".git", "node_modules", "__pycache__", ".DS_Store", "*.pyc", "*.bundle", ".cache", "artifacts"}
    blobs = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if any(s in rel.split("/") for s in skip):
            continue
        if any(rel.endswith(s) for s in [".pyc", ".bundle"]):
            continue
        if rel.startswith("artifacts/"):
            continue
        with open(p, "rb") as f:
            data = f.read()
        if b"\x00" in data[:8192]:
            print(f"  skip binary-ish: {rel}")
            continue
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            print(f"  skip non-utf8: {rel}")
            continue
        b = req("POST", f"{API}/git/blobs", {"content": content, "encoding": "utf-8"})
        blobs.append((rel, b["sha"]))
        print(f"  blob: {rel} -> {b['sha'][:8]}")

    # 3. Build new tree (with mode 100644, type blob)
    tree_entries = [
        {"path": rel, "mode": "100644", "type": "blob", "sha": sha}
        for rel, sha in blobs
    ]
    new_tree = req("POST", f"{API}/git/trees", {
        "base_tree": base_tree,
        "tree": tree_entries
    })
    print(f"New tree: {new_tree['sha']}")

    # 4. (v0.7.0c) Re-check base_sha before creating the commit. If a
    #    teammate (or roadmap auto-sync) pushed between step 1 and now,
    #    the ref has moved; building a commit on top of the old head_sha
    #    would create a non-fast-forward commit, and PATCH ref would
    #    silently overwrite their work. Abort instead.
    current_head = get_ref_sha()
    if current_head != head_sha:
        print(
            f"\n!! ABORT: base_sha drift detected.\n"
            f"   expected: {head_sha}\n"
            f"   actual:   {current_head}\n"
            f"   A teammate (or the roadmap auto-sync cron) pushed to "
            f"{BRANCH} between step 1 and step 4.\n"
            f"   Re-run the script to pick up the new base_sha; "
            f"do NOT force-push or git-push to repair the chain.",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"Base sha verified: {head_sha[:12]} still HEAD of {BRANCH}")

    # 5. Create commit
    new_commit = req("POST", f"{API}/git/commits", {
        "message": MSG,
        "tree": new_tree["sha"],
        "parents": [head_sha]
    })
    print(f"New commit: {new_commit['sha']}")

    # 6. Update ref
    req("PATCH", f"{API}/git/refs/heads/{BRANCH}", {
        "sha": new_commit["sha"]
    })
    print(f"Ref {BRANCH} updated to {new_commit['sha']}")
    print(f"\nDone. https://github.com/{REPO}/commit/{new_commit['sha']}")


if __name__ == "__main__":
    main()
