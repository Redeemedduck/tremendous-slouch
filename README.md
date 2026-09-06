# Golf Group Coordinator

> Note: the package slug is `golf-group-coordinator`; the user-facing brand is **DJDI Golf Board**.

Shared web app for the 2026 DJDI summer golf league. Built originally as a
small coordination board for ~12-15 friends to stop losing track of who's
playing what tee time in a group SMS thread, then grown into a full league
manager that follows the rule sheet end-to-end.

## What it does today

- **Coordinate** — post tee times (course, date, time, spots, host, notes),
  claim or drop spots, mark yourself **maybe**, free-text **comments** on
  any tee time, **calendar export** (`.ics`), course + name autocomplete
  from past entries, optional access-code gate.
- **Group polls** — "Ask the group" ("anyone want to play MC on May 15th or
  22nd?"); multi-select voting per option; host-only delete.
- **Identity** — self-reported GHIN handicap per player, **Member** vs
  **Guest** (drop-in) flag, roster management.
- **Scoring** — record gross score after a round, with **course
  handicap** input (required for league rounds) and **attestation** by
  another member who played in your group.
- **Tournaments** — the seven 2026 stops, mid-season major, and October
  championship are seeded at startup with their windows and payouts. Each
  tournament card shows its leaderboard and the list of rounds in the window.
  Published final boards override incomplete raw tee-time records; Stops 1–3
  are included as official final results.
- **Season standings** — the DJDI points scale
  **20/15/14/11/9/8/7/6/5/4/3/2** accumulates across regular tournaments.
  Ties split all points assigned to the occupied finishing positions. The top
  four receive projected championship seed badges.
- **Post-season** — Championship card shows a sum-based 2-day bracket
  with stroke advantages (−4 / −3 / −2 / −1) for the top 4 seeds and
  payouts to the top 3.
- **Pool** — auto-created buy-in row per member ($325 default), Paid/Owed
  toggle, running total of collected vs expected.
- **Text the Board** — members message the league inbox ("Common Ground
  Sat 8:40, room for 2" / "shot 82, course handicap 9, Jayson attested")
  and an agent inside the app process turns it into a validated action
  against the same API, replying with a template confirmation. Sender
  identity is bound at the transport layer (allowlist), money-adjacent
  actions require an explicit YES, everything else is undoable with NO.
  Parsing runs on a local Ollama model by default ($0); the metered
  Anthropic API is strictly opt-in. Server side is built and tested; the
  iMessage relay on the always-on Mac is the remaining piece — see
  [`TEXT-THE-BOARD-PLAN.md`](./TEXT-THE-BOARD-PLAN.md) and
  [`HANDOFF.md`](./HANDOFF.md).

See [`SCREENSHOTS.md`](./SCREENSHOTS.md) for visuals of every panel (note:
captured before the 2026 clubhouse redesign; the layout has since changed).

## Run

### Local (loopback only — for you)

```sh
npm install
npm run start            # production build, listens on 127.0.0.1:3000
```

Bound to `127.0.0.1` by default. Nothing on your LAN can reach it
directly. Open <http://localhost:3000> on the same machine to confirm.

### Solo testing over Tailscale

Want to use it on your phone without standing up a public host?
See [`TAILSCALE.md`](./TAILSCALE.md) — `tailscale serve` proxies HTTPS
from your tailnet to the loopback server. No code changes, no public URL.

### Dev mode (with HMR)

```sh
npm run dev
```

Vite serves the client via Express middleware on `127.0.0.1:3000`.

### Production deploy

For the group to actually use it the app needs to live somewhere always
on. See [`DEPLOY.md`](./DEPLOY.md) for Fly.io — the `Dockerfile` and
`fly.toml` are checked in.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` only if you want LAN-direct access without a reverse proxy. |
| `PORT` | `3000` | TCP port. |
| `DB_PATH` | `./golf_coordinator.db` | SQLite file location. Set to `/data/golf_coordinator.db` on Fly (auto-set by `fly.toml`). |
| `ACCESS_CODE` | unset | When set, all `/api/*` routes require the matching `golf_access` HttpOnly cookie. Unset = open. |
| `NODE_ENV` | `development` | `production` switches to serving `dist/` directly instead of Vite middleware. |
| `RELAY_SECRET` | unset | Shared secret the message relay sends as `X-Relay-Secret`. The inbound webhook (`POST /api/inbound/message`) stays disabled until set. |
| `OLLAMA_URL` | unset | Local Ollama server for agent parsing (e.g. `http://127.0.0.1:11434`). When set, it wins over the metered API. |
| `AGENT_MODEL` | `qwen2.5:7b` / `claude-haiku-4-5` | Model override for whichever provider wins. Hermes tags work (text-rendered tool calls are recovered) — verify parse accuracy with `scripts/agent-chat.ts` first. |
| `AGENT_PROVIDER` | unset | `ollama` or `anthropic` to force a provider. |
| `ANTHROPIC_API_KEY` | unset | Metered fallback — strictly opt-in; only used when set and Ollama isn't configured (or forced). |

See [`.env.example`](./.env.example) for the annotated template.

## Stack

React 19 + Vite + TypeScript on the client; Express + better-sqlite3 +
tsx on the server. Single Node process; single SQLite file with WAL.
All state writes are wrapped in `BEGIN IMMEDIATE` transactions so two
phones tapping at the same time can't drop or duplicate state.

## Verification

```sh
npm test
npm run lint
npm run build
```

`npm test` covers the scoring library (`src/lib`) and the agent
(`agent/` — parsing, execution, inbound handling; the execution suite
spawns the real server against a throwaway database). CI runs all three
commands on pushes and pull requests.

## Project tracking

Phase-by-phase backlog and shipped work live in the Linear project
[DJDI Golf Board](https://linear.app/coloradolawclassic/project/djdi-golf-board-4a1be159e550).

## Docs

- [`SCREENSHOTS.md`](./SCREENSHOTS.md) — every panel, captured from the
  running app at iPhone viewport.
- [`TAILSCALE.md`](./TAILSCALE.md) — solo testing on your tailnet.
- [`DEPLOY.md`](./DEPLOY.md) — Fly.io production deploy.
- [`FEEDBACK_REQUESTS.md`](./FEEDBACK_REQUESTS.md) — handout for
  outsourced visual / copy review.
- [`TEXT-THE-BOARD-PLAN.md`](./TEXT-THE-BOARD-PLAN.md) — the
  message-to-app agent: architecture, commit policy, channel decision,
  phases.
- [`relay/README.md`](./relay/README.md) — the Mac-side iMessage relay.
- [`HANDOFF.md`](./HANDOFF.md) — state of the work and what's left for a
  local session on the always-on Mac.
