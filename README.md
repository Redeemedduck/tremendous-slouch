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
- **Identity** — GHIN number when known, editable provisional Handicap Index
  when needed, **Member** vs **Guest** flag, roster management.
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
  status controls, running total of settled vs expected, receipt/source-note guard
  before marking paid, legacy evidence-note warning for paid rows, and CSV
  ledger export.
- **Roster truth export** — member/guest state, Handicap Index, GHIN/source note,
  buy-in status, and update timestamps can be downloaded as CSV for spreadsheet
  reconciliation. Roster edits can be saved as provisional when the source is
  not known yet; pasted replies preserve the pasted line as the source.
- **Commissioner launch packet** — one text export with readiness, risks,
  copy/paste asks, live stop snapshot, seed preview, and verification commands.
- **Closeout packets + ledgers** — every tournament has text and JSON exports
  with closeout status, leaderboard, score evidence, attestation validity,
  blockers, payout state, payout settlement-note evidence, and
  closed-snapshot drift checks.
- **Score evidence export** — every posted score can be downloaded as CSV with
  tournament, tee time, gross, course handicap, profile handicap, net source,
  attester, and recorded timestamp.
- **Audit trail** — commissioner-grade mutations are written to
  `audit_events` and exportable as JSON/CSV, including scores, buy-ins,
  roster edits, schedule edits, closeout, payouts, launch gates, and deletes.
- **Verification ledger** — named proof runs are written to
  `verification_runs` and exportable as JSON/CSV, so prod, mobile, and Docker
  smoke checks leave durable evidence inside the handoff package.
- **Archive manifest** — one JSON handoff lists every evidence artifact, closeout
  packet/ledger, remaining risk, task, and a SHA-256 snapshot hash.
- **Completion audit** — one JSON export maps each objective area to current
  proof status, evidence links, and next action so "done" is not guessed.
- **Launch gates** — Docker, production URL, and physical iPhone Safari
  verification evidence persist into the readiness JSON, launch packet,
  `/api/export/launch-checks.json`, `/api/export/launch-checks.csv`, and the
  launch-gate checklist exports. Gates are driven by the `DJDI_*_VERIFIED`
  environment variables and the `/api/launch-checks` API. (The in-UI Launch
  Gates panel was removed during the 2026-06 commissioner-UI simplification; the
  data and exports are unchanged.)
- **Commissioner settings** — Admin has a mobile settings toggle for coordination
  routes plus adjustable unpaid buy-in amounts, tournament points, and payout
  values. Bulk buy-in changes deliberately skip paid rows so receipt-backed
  evidence is not overwritten.
- **Open admin work** — the risk inventory is converted into copyable,
  mobile-safe task rows and `/api/export/tasks.json` plus
  `/api/export/tasks.csv` for buy-ins, handicap records, schedule details, access,
  and launch verification, including pasteable
  access-code setup commands and a physical iPhone Safari checklist.
- **Risk register** — `/api/export/risks.json` and `/api/export/risks.csv`
  expose the remaining blocker/risk/external inventory directly for handoff.
- **Request packet** — `/api/export/request-packet.txt` combines every open
  outbound ask into one copy-ready packet for the group chat.
- **Commissioner request list** — `/api/export/commissioner-requests.json` and
  `/api/export/commissioner-requests.txt` join open admin work to source-search
  decisions and required manual evidence. Legacy
  `/api/export/blocker-handoff.*` routes remain protected for compatibility.
- **Evidence gap packet** — `/api/export/evidence-gap-packet.json`,
  `/api/export/evidence-gap-packet.csv`, and
  `/api/export/evidence-gap-packet.txt` split every unresolved payment, GHIN,
  schedule, production URL, and iPhone Safari proof into paste-back rows with
  the exact intake path.
- **Source-search ledger** — `/api/export/source-search-ledger.json` and
  `/api/export/source-search-ledger.csv` capture which external sources proved
  facts, returned no usable evidence, or were blocked before the request packet
  became the active path.
- **Bulk reply intake** — Money and Roster can paste text replies from the
  group chat and apply matched buy-in status, handicap records, or TBD schedule
  details in one pass.
- **One-paste Admin intake** — Admin can paste a mixed group-chat reply pile and
  split it into buy-in status, handicap records, and schedule confirmations before one
  apply action.
- **Score summary intake** — score sheets can paste chat-style gross/net lines
  like `Jayson: 82 (70)` to fill gross and course-handicap drafts while keeping
  attestations explicit, then bulk-fill one other group member as attester for
  scored member rows without overwriting existing attestations.

### Commissioner UI

The Admin tab is intentionally lean (simplified 2026-06; see
[`docs/2026-06-01-commissioner-ui-simplification.md`](./docs/2026-06-01-commissioner-ui-simplification.md)).
It is two surfaces:

- **Admin Console** — the curated daily controls: snapshot metrics, score
  review with attestation override, tee-time oversight, one-paste intake,
  roster/money/closeout quick links, and a short core-exports list (season,
  standings, roster, buy-ins, payouts, database backup).
- **Full Operations** — a focused workbench for league settings, schedule
  confirmation, score rule audit, name cleanup, the open admin task list, and
  per-tournament closeout (packets + payout ledger).

The audit-log, launch-gate, completion-audit, league-checklist, source-search,
evidence-gap, and archive views were removed from the UI to reduce commissioner
load. Every underlying `/api/export/*` route still works for handoff downloads —
nothing in the data model or export surface was removed, only UI clutter.

See [`SCREENSHOTS.md`](./SCREENSHOTS.md) for core mobile visuals plus Admin
export evidence screenshots.

## Run

### Local (loopback only — for you)

```sh
npm install
npm run start:prod       # builds dist/, then listens on 127.0.0.1:3000
npm run verify:backup    # proves the SQLite backup can be restored/read
npm run verify:live-state # audits the real local league DB read-only
npm run verify:persistence # proves SQLite survives a server restart
npm run verify:prod-smoke # proves built client + protected API work together
npm run verify:deploy-prereqs # checks Fly and public-Funnel URL prerequisites
npm run verify:remote-smoke # read-only smoke for a deployed URL
npm run verify:remote-mobile-ux # mobile viewport smoke for a deployed URL; writes backup proof audit event
npm run verify:mobile-ux # phone-sized golden path for commissioner workflows
npm run verify:docker    # builds and smokes the production Docker image
npm run verify:all       # runs the full local proof suite
```

Bound to `127.0.0.1` by default. Nothing on your LAN can reach it
directly. Open <http://127.0.0.1:3000> on the same machine to confirm.
Set `ACCESS_CODE` for player access and a different `COMMISSIONER_CODE` for
money, roster, launch checks, backups, destructive cleanup, and exports.
Commissioner tools stay locked when `COMMISSIONER_CODE` is missing.

### Tailscale Funnel hosting

Want to use it without standing up another hosting service?
See [`TAILSCALE.md`](./TAILSCALE.md) — `tailscale funnel` publishes the local
production server over HTTPS. No Fly/Vercel/Railway account is required.
`npm run start:phone` builds the phone/Tailscale client into `dist-phone/`, so
normal local proof builds in `dist/` cannot overwrite the live `/golf` assets.
Run `npm run verify:tailnet` after `tailscale funnel` shows `(Funnel on)` to
prove the Funnel route, health, remote smoke, and mobile viewport checks
against the current machine.
Remote smoke needs both `REMOTE_SMOKE_ACCESS_CODE` and
`REMOTE_SMOKE_COMMISSIONER_CODE` when those gates are enabled.

### Dev mode (with HMR)

```sh
npm run dev
```

Vite serves the client via Express middleware on `127.0.0.1:3000`.

### Start an existing production build

```sh
npm run start
```

This serves the existing `dist/` directory. Use `npm run start:prod` when
you want to rebuild before starting.

### Backup verification

```sh
npm run verify:backup
```

The command reads `DB_PATH` (default `./golf_coordinator.db`), creates a
temporary SQLite backup, opens the backup read-only, runs `PRAGMA quick_check`,
and verifies the core league tables and seeded 2026 rows exist. Set
`KEEP_BACKUP_VERIFY=1` to leave the temporary backup file in place for manual
inspection.

### Live state verification

```sh
npm run verify:live-state
```

The command opens the real `DB_PATH` database read-only, runs SQLite
`quick_check`, verifies the 12-member roster, 12 buy-ins, seeded tournaments,
league rule audit, and the known Stop 1 Common Ground scorecard data. It prints
the remaining risk inventory directly from the DB, including unpaid buy-ins,
missing handicap records, TBD schedule rows, and unverified external launch gates.
Set `SKIP_STOP1_EXPECTATION=1` only if the local DB has intentionally moved past
the screenshot-seeded Stop 1 evidence. Set `DJDI_DOCKER_BUILD_VERIFIED=1`,
`DJDI_TAILNET_URL_VERIFIED=1`, `DJDI_PRODUCTION_URL_VERIFIED=1`, and
`DJDI_MOBILE_SAFARI_VERIFIED=1` in the environment when you want the risk output
to mirror a runtime where those gates have already been proven.

### Persistence verification

```sh
npm run verify:persistence
```

The command starts the API against a temporary SQLite file, creates a sentinel
tee time, stops the server, restarts against the same file, and verifies the tee
time is still present. It removes the temporary database unless
`KEEP_PERSISTENCE_VERIFY_DB=1` is set.

### Production smoke verification

```sh
npm run build
npm run verify:prod-smoke
```

The command serves the built `dist/` client against a temporary SQLite file,
enables an access code, verifies the public client loads, confirms protected API
routes reject unauthenticated requests, unlocks through `/api/access`, creates a
tee time, records a verification run, and checks the text summary, closeout
packet/ledger, audit, task queue JSON/CSV, completion-audit JSON/CSV,
risk register JSON/CSV, request packet, commissioner request list, evidence-gap packet
JSON/CSV/text, source-search JSON/CSV, launch-check JSON/CSV, launch-gate checklist,
verification-ledger, archive, and launch-packet exports. Money review treats
payment-like notes on unpaid rows as a separate confirmation risk instead of
marking those rows paid. New paid rows require receipt/source notes; any legacy
paid rows without notes are kept in the risk inventory until evidence is added.

### Remote production smoke verification

```sh
npm run verify:deploy-prereqs
```

This checks the local deploy/public-URL prerequisites without changing Fly or
Tailscale state: Fly CLI, Fly auth, the configured app, the persistent `data`
volume, local `ACCESS_CODE`, whether a dedicated public Funnel fallback exists
on `duckbookpro.clouded-tailor.ts.net`, and whether a remote URL has been
configured for smoke tests. It exits non-zero while required production URL
prerequisites are missing.

```sh
REMOTE_SMOKE_URL=https://djdi-golf-board.fly.dev \
REMOTE_SMOKE_ACCESS_CODE=<shared-code> \
REMOTE_SMOKE_COMMISSIONER_CODE=<admin-code> \
npm run verify:remote-smoke
```

The command is read-only against the target URL. It verifies the built client,
`/api/health`, the access gate when configured, the seeded tournaments, the JSON
season export, buy-in, roster, and score CSV exports, the machine-readable
readiness export, closeout packet/ledger exports, audit JSON/CSV exports, the
completion-audit JSON/CSV exports, launch-check JSON/CSV exports,
verification JSON/CSV exports, archive manifest, task queue JSON/CSV exports,
risk register JSON/CSV, request packet, commissioner request list, evidence-gap packet
JSON/CSV/text, source-search JSON/CSV, launch-gate checklist, text summary
export, and launch-packet export. It does
not create tee times, scores, payments, roster rows, or
verification-run rows.

Launch-gate records are backed by `/api/launch-checks` and the `DJDI_*_VERIFIED`
environment variables, and remain exportable as JSON and CSV for launch
handoffs. (The in-UI Launch Gates panel was removed during the 2026-06
commissioner-UI simplification; gates are now driven by env vars and the API.)

### Remote mobile UX verification

```sh
REMOTE_MOBILE_URL=https://djdi-golf-board.fly.dev \
REMOTE_MOBILE_ACCESS_CODE=<shared-code> \
REMOTE_MOBILE_COMMISSIONER_CODE=<admin-code> \
npm run verify:remote-mobile-ux
```

The command drives a 390×844 Chromium viewport through the real HTTPS client,
access unlock, bottom navigation, Season, Money, Roster, Admin, launch-risk copy,
export links, and the Admin backup-restore proof action. It does not create tee
times, payments, roster edits, scores, or verification-run rows, but it does
write one `backup_restore_verify` audit event when the backup proof button
passes. It is useful for tailnet/public URL browser proof, but it is not a
substitute for the separate physical iPhone Safari launch gate.

`npm run verify:phone-access` accepts the same
`REMOTE_MOBILE_ACCESS_CODE` / `REMOTE_MOBILE_COMMISSIONER_CODE` values, so the
full `npm run verify:launch` command does not require duplicating them as
`ACCESS_CODE` / `COMMISSIONER_CODE`.

### Mobile UX verification

```sh
npm run build
npm run verify:mobile-ux
```

The command starts the built client against a temporary SQLite database with an
access code, seeds a Stop 1 score scenario, and drives a 390×844 mobile
Chromium viewport through access unlock, bottom navigation, Season standings,
Money, Roster, and Admin. It verifies course-handicap net values, score-summary
fill, bulk attester fill, the consolidated Admin Console (next actions, admin
map, tee-time oversight, score review with attestation override), the trimmed
core exports, the Full Operations workbench (settings, schedule confirmation,
score rule audit, tournament closeout, open task list), one-paste and bulk
payment/GHIN/schedule intake, records a verification run, and proves browser
console health without touching the real league DB.

### Docker verification

```sh
npm run verify:docker
```

The command builds `djdi-golf-board:codex-smoke`, starts the image with
`HOST=0.0.0.0`, verifies the built client through Docker port mapping, confirms
the access-gated API rejects unauthenticated requests, unlocks through
`/api/access`, loads tournaments, and checks the readiness JSON, task queue,
task CSV, closeout packet/ledger, audit JSON/CSV, completion-audit JSON/CSV,
risk register JSON/CSV, request packet, commissioner request list, evidence-gap packet
JSON/CSV/text, source-search JSON/CSV, launch-check JSON/CSV, launch-gate checklist, verification ledger,
archive manifest, summary, and launch-packet exports.

### Full local verification

```sh
npm run verify:all
```

Runs typecheck, Vitest, production build, live DB audit, backup restore check,
persistence restart probe, production smoke, mobile UX smoke, Docker smoke,
moderate-or-higher dependency audit, and whitespace diff check. Remote deployed
URL verification stays separate because it needs the final public URL and access
code. The live DB audit also surfaces unresolved money contradictions, such as
payment-like notes left on unpaid buy-in rows.

### Production deploy

For the group to actually use it the app needs to live somewhere always
on. See [`DEPLOY.md`](./DEPLOY.md) for Fly.io — the `Dockerfile` and
`fly.toml` are checked in.

## Configuration (env vars)

The server loads `.env.local` first and then `.env` via `dotenv`; both are
ignored by git. Start from [`.env.example`](./.env.example) for local access
codes or launch-gate flags.

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Fly/container runtime sets `0.0.0.0`; local loopback stays private. |
| `PORT` | `3000` | TCP port. |
| `DB_PATH` | `./golf_coordinator.db` | SQLite file location. Set to `/data/golf_coordinator.db` on Fly (auto-set by `fly.toml`). |
| `DJDI_WORK_DIR` | `./.build-work` | Local scratch directory for verifier databases and backup/export proof files. |
| `ACCESS_CODE` | unset | When set, all `/api/*` routes require the matching `golf_access` HttpOnly cookie. Unset = open. |
| `NODE_ENV` | `development` | `production` switches to serving `dist/` directly instead of Vite middleware. |
| `DJDI_DOCKER_BUILD_VERIFIED` | unset | Set to `1` after the Docker image build gate passes. |
| `DJDI_TAILNET_URL_VERIFIED` | unset | Set to `1` after Tailscale Funnel, tailnet health, remote smoke, and mobile viewport smoke pass. |
| `DJDI_PRODUCTION_URL_VERIFIED` | unset | Set to `1` after the always-on production URL has been smoke-tested. |
| `DJDI_MOBILE_SAFARI_VERIFIED` | unset | Set to `1` after the physical iPhone Safari golden path passes. |

## Stack

React 19 + Vite + TypeScript on the client; Express + better-sqlite3 +
tsx on the server. Single Node process; single SQLite file with WAL.
All state writes are wrapped in `BEGIN IMMEDIATE` transactions so two
phones tapping at the same time can't drop or duplicate state.

## Project tracking

Phase-by-phase backlog and shipped work live in the Linear project
[DJDI Golf Board](https://linear.app/coloradolawclassic/project/djdi-golf-board-4a1be159e550).

## Docs

- [`docs/2026-05-19-launch-status.md`](./docs/2026-05-19-launch-status.md) —
  current verified launch status, open blockers, runtime URLs, source-search
  ledger, and proof ledger.
- [`SCREENSHOTS.md`](./SCREENSHOTS.md) — core mobile panels plus Admin export
  and launch-gate proof images.
- [`TAILSCALE.md`](./TAILSCALE.md) — solo testing on your tailnet.
- [`DEPLOY.md`](./DEPLOY.md) — Fly.io production deploy.
- [`FEEDBACK_REQUESTS.md`](./FEEDBACK_REQUESTS.md) — handout for
  outsourced visual / copy review.
