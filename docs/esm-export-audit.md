# ESM Export Audit (v0.8.5a)

`tools/check-esm-exports.py` — a static-analysis auditor for the ESM
`import` / `export` surface in `src/`.

## Why

The codebase has been bitten three times by ESM-export bugs that only
show up at runtime as `SyntaxError: does not provide an export named
'X'`:

| # | commit  | file              | pattern                              |
|---|---------|-------------------|--------------------------------------|
| 1 | v0.8.0f | `world/perlin.js` | `class PerlinNoise` missing `export` |
| 2 | v0.8.0f | `world/decorator.js` | import `scatterDecorationsAndVillage` but only `scatterDecorations` exported |
| 3 | v0.8.4a | `net/relay-client.js` | `class Emitter` missing `export`  |

Each fix was a one-line change. The next one will be a one-line change
too — unless we run the audit on every push and flag regressions
before the demo breaks.

## What it checks

For every `.js` file under `src/`, the script:

1. Parses every `import { … } from './rel'`, `import X from './rel'`
   (default), `import * as X from './rel'` (namespace) and
   `import './rel'` (side-effect) statement.
2. Parses every `export class / function / const / let / var`, the
   `export { … }` and `export default` forms, and re-exports
   `export { … } from './rel'`.
3. For each named import, looks up the imported name in the target
   file's named exports (with `as`-renames honoured).
4. For each default import, checks the target file actually has an
   `export default`.
5. For each re-export, checks the source name in the target file.
6. For each relative path, checks the file actually exists.

JSON targets are exempt from the named-export check because the ESM
loader exposes the parsed object as the default only.

## What it does NOT check

- Dynamic `import('./x')` calls (runtime errors only, not parse-time).
- JSDoc `@param {import('./x').X}` references inside comments.
- Bare specifiers like `import 'fs'` (no relative path → no cross-check
  possible; we treat them as external and skip).
- CommonJS / non-ESM files (the 8 IIFE browser scripts under `ui/`).

## Usage

```bash
python3 tools/check-esm-exports.py
# {
#   "file_count": 100,
#   "mismatch_count": 0,
#   "mismatches": []
# }
```

Exit code 0 on clean, 1 on any mismatch, 2 if `src/` is missing.

## Wiring into CI

Wire this into the same workflow that already runs
`tools/check-fixture-drift.mjs` and `tools/check-asset-budget.py` —
typically a step after the source-listing step but before
`node tests/*.mjs`:

```yaml
- name: ESM export audit
  run: python3 tools/check-esm-exports.py
```

## Audit result on `main` at v0.8.5a

```
file_count: 100
mismatch_count: 0
mismatches: []
```

The 3 historical bugs are all fixed and no new mismatches were
introduced by the 100 files audited.
