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

## Multiplayer (v0.4)

2–4 player co-op over WebSocket. The browser talks to a small relay server
(`server/relay.mjs`) that fans out state and world events. Host is
authoritative: a 10 Hz snapshot is broadcast to all peers, and discrete world
events (place/remove building, gather) are pushed on demand.

### Architecture

```
Browser (host) ──┐
                 ├──► relay.mjs ◄── Browser (client)
Browser (peer) ──┘   (Node.js, zero deps)
```

* **Protocol** — JSON over WebSocket text frames, `PROTOCOL_VERSION=1`.
  See `src/net/protocol.js` for the full message dictionary.
* **Transport** — `src/net/relay-client.js` (browser, auto-reconnect with
  exponential backoff) + `server/relay.mjs` (Node 22+, hand-rolled RFC 6455
  frame parsing — no npm).
* **Authoritative model** — host owns the world. Clients send inputs and
  receive 10 Hz state snapshots. Discrepancies (buildings, resource depletion,
  respawns) are reconciled via discrete `G_WORLD` events.
* **Reconnect** — 30 s grace window; the relay hands out a token on join and
  matches a reconnection by token if the same peer drops and returns.

### Run a relay

```bash
# Node 22+ required (built-in WebSocket)
PORT=8787 node server/relay.mjs
# health: curl http://localhost:8787/health
```

### Play

```bash
# Terminal 1 — serve static files
node tests/serve.mjs         # or python3 -m http.server 8080
# Terminal 2 — relay
node server/relay.mjs
# Browser A — http://localhost:8080/demo.html?relay=ws://localhost:8787
#   → Create Room → share the 4-letter code
# Browser B — http://localhost:8080/demo.html?relay=ws://localhost:8787
#   → Join Room → enter the code
```

You should see the other player moving in real time. Place a building, gather
a tree, drop a chat line — all synced. If a client closes the tab, the host
sees "player left" and the slot becomes available for 30 s for a reconnect.

### Tests

```bash
node tests/m3.0-protocol-smoke.mjs   # 53/53 protocol unit tests
node tests/m3.0-relay-smoke.mjs       # 21/21 end-to-end relay tests
```

The relay test boots the relay in-process, opens 4 client WebSocket
connections, and exercises: room creation, joining, full-room rejection,
bad-code rejection, state broadcasting, input routing, chat, building
place/remove, gather, ping/pong, disconnect+reconnect, bad-token rejection,
and clean leave.

### Smoke checklist (manual)

1. Two browsers → host in A, join in B with the 4-letter code.
2. Both see each other moving; each has a name label and HP bar.
3. A places a campfire → B sees it appear; B presses RMB on it → both see
   the campfire removed.
4. A holds LMB on a tree → A's gather completes, B sees the tree go to
   "regrowing" state with the seedling sprite and a green progress bar.
5. A types in the chat input at the bottom → B sees the message with `[A]` prefix.
6. A disconnects → B sees "player left"; A reconnects within 30 s → B sees
   "player reconnected" and the same token; after 30 s the slot is freed.
7. Press `Esc` and reload → no orphan relays or zombie sessions.

## Project Layout

```
src/                      Game source
  net/                    Multiplayer (M3.0)
    protocol.js           Message types + validators
    relay-client.js       Browser WebSocket client
    session.js            Local session state machine
    menu.js               Main menu (host/join) DOM overlay
    multiplayer.js        Game loop adapter
  world/  player/  render/  buildings/  resources/  hud/  ui/  utils/
server/
  relay.mjs               WebSocket relay (zero npm deps)
tests/
  m3.0-protocol-smoke.mjs
  m3.0-relay-smoke.mjs
  m4-node-smoke.mjs       M4 world regression
  m2.9-smoke.mjs          M2.9 buildings regression
  m210-*.mjs              M2.10 resources regression
  perf/                   Performance benchmarks
assets/                   Pixel art (PNGs, JSON)
docs/                     GitHub Pages content
scripts/                  Roadmap sync + utilities
demo.html                 Main entry (open in browser)
```
