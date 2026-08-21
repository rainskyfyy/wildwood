# Wildwood

2D co-op survival game, web-first, Don't Starve-inspired.

## Roadmap Sync

`docs/roadmap.html` is auto-synced from aily task platform every 30 minutes by
`scripts/update_roadmap.py`. The script reads 7 sub-task statuses, recomputes
v0.3 / v0.4 progress ratios, and pushes the updated HTML to GitHub main via
the Git Data API. GitHub Pages deploys `/docs` on every push to main.

To run locally:

```bash
export GH_TOKEN=ghp_...
python3 scripts/update_roadmap.py
```

Required env: `GH_TOKEN` (GitHub PAT with `contents:write`).

## Game

See `src/` for the game source and `tests/` for smoke tests.
