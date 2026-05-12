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
  championship are seeded at startup with their windows, points, and
  payouts. Each tournament card shows its leaderboard, payout footer, and
  the list of rounds in the window.
- **Season standings** — FedEx-Cup-style points (100/80/65/55/50/…)
  accumulate across regular tournaments; top 4 get a projected seed badge
  in the Standings card.
- **Post-season** — Championship card shows a sum-based 2-day bracket
  with stroke advantages (−4 / −3 / −2 / −1) for the top 4 seeds and
  payouts to the top 3.
- **Pool** — auto-created buy-in row per member ($325 default), Paid/Owed
  toggle, running total of collected vs expected.

See [`SCREENSHOTS.md`](./SCREENSHOTS.md) for visuals of every panel.

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

## Stack

React 19 + Vite + TypeScript on the client; Express + better-sqlite3 +
tsx on the server. Single Node process; single SQLite file with WAL.
All state writes are wrapped in `BEGIN IMMEDIATE` transactions so two
phones tapping at the same time can't drop or duplicate state.

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
