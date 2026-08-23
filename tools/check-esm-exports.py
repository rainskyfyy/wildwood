#!/usr/bin/env python3
"""
Wildwood ESM export audit.

Walks every .js file under src/, collects named/default exports and
named/default/namespace imports, then cross-checks every import against
the target file's exports. Reports mismatches with file + line + reason.

Three mismatch kinds:
  - missing_named_export    : `import { X } from './m'` but m doesn't export X
  - missing_default_export  : `import X from './m'` but m has no export default
  - missing_target_file     : module path resolves to a non-existent file
  - missing_reexport_source : `export { X } from './m'` but m doesn't export X

Re-exports (`export { X } from './m'`), `as`-renames, default + named mixed
imports, namespace imports (`import * as X`) and side-effect imports
(`import './m'`) are all handled. JSON targets are not checked for named
exports because the loader exposes the parsed object as the default only.

Run:  python3 tools/check-esm-exports.py
Exit: 0 on clean, 1 on any mismatch.
"""
import json
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


# --------------------------------------------------------------------------- #
# Lexer: strip comments but keep string contents verbatim.                   #
# --------------------------------------------------------------------------- #
def lex(src: str):
    """Yield (line, col, char) for code chars outside comments.
    String contents are kept verbatim so module paths / identifiers inside
    strings remain intact."""
    i = 0
    n = len(src)
    line = 1
    col = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                i += 1
                col += 1
            continue
        if c == "/" and nxt == "*":
            i += 2
            col += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] == "\n":
                    line += 1
                    col = 0
                else:
                    col += 1
                i += 1
            if i < n:
                i += 2
                col += 2
            continue
        if c == "\n":
            line += 1
            col = 0
            i += 1
            continue
        yield (line, col, c)
        col += 1
        i += 1


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def word_at(items, i):
    if i >= len(items):
        return ("", i)
    ch = items[i][2]
    if not (ch.isalpha() or ch == "_" or ch == "$"):
        return ("", i)
    j = i
    out = []
    while j < len(items) and (items[j][2].isalnum() or items[j][2] in ("_", "$")):
        out.append(items[j][2])
        j += 1
    return ("".join(out), j)


def is_word_boundary(items, idx):
    if idx >= len(items):
        return True
    c = items[idx][2]
    return not (c.isalnum() or c in ("_", "$"))


def skip_ws(items, i):
    while i < len(items) and items[i][2] in (" ", "\t", "\n", "\r"):
        i += 1
    return i


def collect_brace_block(items, start_idx):
    assert items[start_idx][2] == "{"
    depth = 0
    i = start_idx
    n = len(items)
    while i < n:
        c = items[i][2]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1, items[start_idx + 1 : i]
        i += 1
    return n, items[start_idx + 1 :]


def read_string_literal(items, start_idx):
    """items[start_idx] is the opening quote. Read until matching close quote
    and return (end_idx_exclusive, content_string)."""
    quote = items[start_idx][2]
    j = start_idx + 1
    out = []
    while j < len(items) and items[j][2] != quote:
        if items[j][2] == "\\" and j + 1 < len(items):
            out.append(items[j][2])
            out.append(items[j + 1][2])
            j += 2
            continue
        if items[j][2] == "\n":
            j += 1
            continue
        out.append(items[j][2])
        j += 1
    if j < len(items):
        j += 1
    return j, "".join(out)


# --------------------------------------------------------------------------- #
# Parse imports                                                               #
# --------------------------------------------------------------------------- #
def parse_imports(items, src_path: Path):
    i = 0
    n = len(items)
    while i < n:
        word, end = word_at(items, i)
        if word != "import":
            i += 1
            continue
        if not is_word_boundary(items, end):
            i += 1
            continue
        kw_line = items[i][0]
        i = skip_ws(items, end)

        if i < n and items[i][2] in ("'", '"', "`"):
            new_i, module = read_string_literal(items, i)
            yield {
                "kind": "sideeffect",
                "default_local": None,
                "names": [],
                "namespace_local": None,
                "module": module,
                "line": kw_line,
            }
            i = new_i
            continue

        if i < n and items[i][2] == "*":
            j = skip_ws(items, i + 1)
            as_word, as_end = word_at(items, j)
            if as_word == "as":
                k = skip_ws(items, as_end)
                ns_name, ns_end = word_at(items, k)
                k = skip_ws(items, ns_end)
                fw, fw_end = word_at(items, k)
                if fw == "from":
                    k = skip_ws(items, fw_end)
                    if k < n and items[k][2] in ("'", '"', "`"):
                        new_k, module = read_string_literal(items, k)
                        yield {
                            "kind": "namespace",
                            "default_local": None,
                            "names": [],
                            "namespace_local": ns_name,
                            "module": module,
                            "line": kw_line,
                        }
                        i = new_k
                        continue
            i = j
            continue

        default_local = None
        named_names = []

        if i < n and items[i][2] == "{":
            end_idx, inner = collect_brace_block(items, i)
            spec_text = "".join(it[2] for it in inner)
            for part in spec_text.split(","):
                part = part.strip()
                if not part:
                    continue
                if " as " in part:
                    imp, loc = part.split(" as ", 1)
                    named_names.append((imp.strip(), loc.strip()))
                else:
                    named_names.append((part, part))
            i = end_idx
        else:
            dw, dend = word_at(items, i)
            default_local = dw
            i = skip_ws(items, dend)
            if i < n and items[i][2] == ",":
                i = skip_ws(items, i + 1)
                if i < n and items[i][2] == "{":
                    end_idx, inner = collect_brace_block(items, i)
                    spec_text = "".join(it[2] for it in inner)
                    for part in spec_text.split(","):
                        part = part.strip()
                        if not part:
                            continue
                        if " as " in part:
                            imp, loc = part.split(" as ", 1)
                            named_names.append((imp.strip(), loc.strip()))
                        else:
                            named_names.append((part, part))
                    i = end_idx

        i = skip_ws(items, i)
        fw, fw_end = word_at(items, i)
        if fw != "from":
            i = fw_end if fw_end > i else i + 1
            continue
        i = skip_ws(items, fw_end)
        if i < n and items[i][2] in ("'", '"', "`"):
            new_i, module = read_string_literal(items, i)
            if default_local and not named_names:
                kind = "default"
            elif named_names and not default_local:
                kind = "named"
            elif default_local and named_names:
                kind = "mixed"
            else:
                kind = "sideeffect"
            yield {
                "kind": kind,
                "default_local": default_local,
                "names": named_names,
                "namespace_local": None,
                "module": module,
                "line": kw_line,
            }
            i = new_i
            continue
        i += 1


# --------------------------------------------------------------------------- #
# Parse exports                                                               #
# --------------------------------------------------------------------------- #
def parse_exports(items, src_path: Path):
    i = 0
    n = len(items)
    while i < n:
        word, end = word_at(items, i)
        if word != "export":
            i += 1
            continue
        if not is_word_boundary(items, end):
            i += 1
            continue
        kw_line = items[i][0]
        i = skip_ws(items, end)
        if i >= n:
            return

        if items[i][2] == "d":
            dw, dend = word_at(items, i)
            if dw == "default":
                yield {"kind": "default", "name": None, "line": kw_line}
                i = skip_ws(items, dend)
                nw, nend = word_at(items, i)
                if nw in ("class", "function"):
                    i = skip_ws(items, nend)
                    _, nend2 = word_at(items, i)
                    i = skip_ws(items, nend2 if nend2 > i else nend)
                continue
            else:
                i += 1
                continue

        if items[i][2] == "{":
            end_idx, inner = collect_brace_block(items, i)
            spec_text = "".join(it[2] for it in inner)
            reexport_names = []
            for part in spec_text.split(","):
                part = part.strip()
                if not part:
                    continue
                if " as " in part:
                    src_name, exported_as = part.split(" as ", 1)
                    reexport_names.append((src_name.strip(), exported_as.strip()))
                else:
                    reexport_names.append((part, part))
            j = skip_ws(items, end_idx)
            fw, fw_end = word_at(items, j)
            if fw == "from":
                j2 = skip_ws(items, fw_end)
                if j2 < n and items[j2][2] in ("'", '"', "`"):
                    new_j2, module = read_string_literal(items, j2)
                    yield {
                        "kind": "reexport",
                        "names": reexport_names,
                        "module": module,
                        "line": kw_line,
                    }
                    i = new_j2
                    continue
            for src_name, exported_as in reexport_names:
                yield {
                    "kind": "named",
                    "name": exported_as,
                    "line": kw_line,
                }
            i = end_idx
            continue

        kw, kw_end = word_at(items, i)
        if kw == "class":
            i = skip_ws(items, kw_end)
            name, nend = word_at(items, i)
            if name:
                yield {"kind": "named", "name": name, "line": kw_line}
            i = skip_ws(items, nend if nend > i else kw_end)
            continue
        if kw == "function":
            i = skip_ws(items, kw_end)
            if i < n and items[i][2] == "*":
                i = skip_ws(items, i + 1)
            name, nend = word_at(items, i)
            if name:
                yield {"kind": "named", "name": name, "line": kw_line}
            i = skip_ws(items, nend if nend > i else kw_end)
            continue
        if kw in ("const", "let", "var"):
            i = skip_ws(items, kw_end)
            name, nend = word_at(items, i)
            if name:
                yield {"kind": "named", "name": name, "line": kw_line}
            i = skip_ws(items, nend if nend > i else kw_end)
            continue
        if kw == "async":
            i = skip_ws(items, kw_end)
            nw, nend = word_at(items, i)
            if nw == "function":
                i = skip_ws(items, nend)
                if i < n and items[i][2] == "*":
                    i = skip_ws(items, i + 1)
                name, nend2 = word_at(items, i)
                if name:
                    yield {"kind": "named", "name": name, "line": kw_line}
                i = skip_ws(items, nend2 if nend2 > i else nend)
                continue
            i += 1
            continue

        i += 1


# --------------------------------------------------------------------------- #
# Path resolution                                                             #
# --------------------------------------------------------------------------- #
def resolve_module(importer: Path, module: str):
    if not module.startswith("."):
        return None
    base = (importer.parent / module).resolve()
    if base.exists() and base.is_file():
        return base
    cand = base.with_suffix(".js")
    if cand.exists() and cand.is_file():
        return cand
    cand2 = base / "index.js"
    if cand2.exists() and cand2.is_file():
        return cand2
    return base


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def main():
    if not SRC.exists():
        print(f"ERROR: src/ not found at {SRC}", file=sys.stderr)
        return 2

    files = sorted(SRC.rglob("*.js"))
    file_imports = {}
    file_exports = {}

    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        items = list(lex(text))
        file_imports[f] = list(parse_imports(items, f))
        file_exports[f] = list(parse_exports(items, f))

    name_index = {}
    for f, exps in file_exports.items():
        names = defaultdict(list)
        has_default = False
        for e in exps:
            if e["kind"] == "default":
                has_default = True
            elif e["kind"] == "named" and e["name"]:
                names[e["name"]].append(e["line"])
        name_index[f] = {"names": names, "has_default": has_default}

    mismatches = []
    for f, imps in file_imports.items():
        for imp in imps:
            if imp["kind"] in ("sideeffect", "namespace"):
                continue
            target = resolve_module(f, imp["module"])
            if target is None:
                continue
            if not target.exists():
                mismatches.append({
                    "file": str(f.relative_to(ROOT)),
                    "line": imp["line"],
                    "module": imp["module"],
                    "kind": "missing_target_file",
                    "imported": (
                        imp.get("default_local")
                        or [n[0] for n in imp.get("names", [])]
                        or None
                    ),
                })
                continue
            if target.suffix != ".js":
                continue
            if target not in name_index:
                continue
            tinfo = name_index[target]
            if imp["kind"] in ("named", "mixed"):
                for imported_name, local_name in imp["names"]:
                    if imported_name not in tinfo["names"]:
                        mismatches.append({
                            "file": str(f.relative_to(ROOT)),
                            "line": imp["line"],
                            "module": imp["module"],
                            "kind": "missing_named_export",
                            "imported": imported_name,
                            "local": local_name,
                            "target": str(target.relative_to(ROOT)),
                        })
            if imp["kind"] in ("default", "mixed"):
                if not tinfo["has_default"]:
                    mismatches.append({
                        "file": str(f.relative_to(ROOT)),
                        "line": imp["line"],
                        "module": imp["module"],
                        "kind": "missing_default_export",
                        "imported": imp["default_local"],
                        "target": str(target.relative_to(ROOT)),
                    })

    for f, exps in file_exports.items():
        for exp in exps:
            if exp.get("kind") != "reexport":
                continue
            target = resolve_module(f, exp["module"])
            if target is None or not target.exists() or target.suffix != ".js":
                continue
            if target not in name_index:
                continue
            tinfo = name_index[target]
            for src_name, _ in exp["names"]:
                if src_name not in tinfo["names"]:
                    mismatches.append({
                        "file": str(f.relative_to(ROOT)),
                        "line": exp["line"],
                        "module": exp["module"],
                        "kind": "missing_reexport_source",
                        "imported": src_name,
                        "target": str(target.relative_to(ROOT)),
                    })

    out = {
        "file_count": len(files),
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }
    print(json.dumps(out, indent=2))
    return 0 if not mismatches else 1


if __name__ == "__main__":
    sys.exit(main())
