# AGENTS.md

This file provides guidance to Codex when working in this repository.

## Collaboration Rules

The primary user has a TBI and relies on agents to reduce cognitive load.

- Do the work directly when local files, commands, or app behavior can answer it.
- Do not hand back checklists or setup steps when you can run the command or make the edit yourself.
- Ask only when the missing detail materially changes the outcome and cannot be discovered locally.
- Keep responses direct, concrete, and high-signal.
- Never fabricate data, sources, deployment status, verification status, scores, payments, GHIN indexes, or quotes.
- Separate verified fact from inference when the distinction affects a decision.
- Preserve unrelated user or worker changes in the git worktree.

## Commands

```bash
npm run dev                  # Express + Vite dev server at 127.0.0.1:3000
npm run build                # Production client build to dist/
npm run start                # Production server; requires dist/ to already exist
npm run start:prod           # Build dist/ and then start production server
npm run preview              # Vite preview server for the built client
npm run lint                 # Type-check only (tsc --noEmit)
npm test                     # Vitest rule and API test suite
npm run verify:live-state    # Read-only audit of the real local SQLite DB
npm run verify:backup        # Create and restore-check a temporary SQLite backup
npm run verify:persistence   # Prove SQLite state survives a server restart
npm run verify:prod-smoke    # Smoke built dist + access-gated API on temp DB
npm run verify:deploy-prereqs # Check Fly deploy auth/app/volume prerequisites
npm run verify:remote-smoke  # Read-only smoke for a deployed URL
npm run verify:remote-mobile-ux # Mobile viewport smoke; writes one backup proof audit event
npm run verify:mobile-ux     # Phone-sized commissioner workflow smoke
npm run verify:docker        # Build and smoke the production Docker image
npm run verify:all           # Full local proof suite
npm run clean                # Remove dist/ and production build outputs
```

`npm run verify:all` runs typecheck, Vitest, build, live DB audit, backup,
persistence, production smoke, mobile UX smoke, Docker smoke, dependency audit,
and whitespace diff hygiene. Remote URL verification stays separate because it
needs the deployed URL and access code.

## Environment

Configuration is environment-variable driven:
the server loads `.env.local` first and then `.env` via `dotenv`; both are
ignored by git. Use [`.env.example`](./.env.example) as the template.

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Fly/container runtime sets `0.0.0.0`; local loopback stays private. |
| `PORT` | `3000` | TCP port. |
| `DB_PATH` | `./golf_coordinator.db` | SQLite file location. Fly uses `/data/golf_coordinator.db`. |
| `DJDI_WORK_DIR` | `./.build-work` | Local scratch directory for verifier databases and backup/export proof files. |
| `ACCESS_CODE` | unset | Optional cookie gate for `/api/*` routes via `golf_access`. Unset means open. |
| `NODE_ENV` | `development` | `production` serves `dist/` directly instead of Vite middleware. |
| `DJDI_DOCKER_BUILD_VERIFIED` | unset | `1` clears the Docker build external launch risk. |
| `DJDI_TAILNET_URL_VERIFIED` | unset | `1` clears the tailnet URL external launch risk after Tailscale Funnel and tailnet smoke checks pass. |
| `DJDI_PRODUCTION_URL_VERIFIED` | unset | `1` clears the production URL external launch risk. |
| `DJDI_MOBILE_SAFARI_VERIFIED` | unset | `1` clears the physical iPhone Safari external launch risk. |

No Gemini API key is required for this app.

## Current Private Access

These are the current local/private DJDI codes for this repo runtime. They are
not third-party service credentials.

- Tailscale URL: `https://duckbookpro.clouded-tailor.ts.net/golf`
- Direct phone fallback: `http://100.102.92.28:3131/golf`
- Access code: `p0sJGOlbAPuoxGHHYtA1cMRySw5t4Ad3`
- Commissioner code: `test-admin`

## Architecture

**DJDI Golf Board** is a React 19 + Vite + TypeScript golf league command
system backed by a single Express server and SQLite database. The package slug
is `golf-group-coordinator`.

### Client

- Main app shell: `src/App.tsx`
- Mobile-first screens: Board, Season, Money, Roster, and Admin.
- Reusable components: `src/components/`
- Rule/export helpers and pure logic: `src/lib/`
- Data hooks: `src/hooks/`
- Styling: Tailwind utility classes in React components plus `src/index.css`.

The app coordinates tee times, group polls, comments, roster identity,
member/guest status, buy-ins, league score entry, score review,
tournament leaderboards, season standings, championship/post-season logic,
and commissioner Admin workflows. The commissioner UI is consolidated into an
**Admin Console** (curated daily controls + a short core-exports list) and a
focused **Full Operations** workbench (settings, schedule confirmation, score
rule audit, name cleanup, tournament closeout, open task list). Audit-log,
launch-gate, completion-audit, source-search, evidence-gap, and archive views
are export-only — their `/api/export/*` routes remain but they are no longer
rendered in the UI (see `docs/2026-06-01-commissioner-ui-simplification.md`).

### Server

- `server.ts` owns schema migration, seed data, API routes, access-code gating,
  static asset serving, export endpoints, and startup.
- Testable seams are exported as `createDb`, `createApp`, and `startServer`.
- SQLite uses WAL mode and state-changing operations are wrapped in
  transactions where consistency matters.
- Commissioner evidence is exposed as `/api/export/*` endpoints (not all
  surfaced in the trimmed Admin UI): audit events, verification runs, closeout
  packets/ledgers, payout settlement-note evidence, launch checks,
  inline/copyable launch-gate checklist, completion audit, source-search
  ledger, archive manifest, payment evidence review, commissioner request list,
  request packet, and task JSON/CSV exports.
- Roster GHIN index updates can carry an optional `handicapSource` note. Use it
  for direct evidence such as GHIN/CGA emails or copied player replies; do not
  use it to justify inferred indexes.
- Missing handicap evidence should not block a usable prototype. Save editable
  provisional Handicap Index values as unverified/unknown source; never invent
  GHIN numbers or call a provisional value GHIN-verified.
- Keep app copy short and operational. Scores submitted by the commissioner are
  usable scores; preserve provenance and editability instead of turning score
  review into a hard stop.
- Commissioner controls should allow practical cleanup: edit tee times, add
  players, remove players, and correct scores in-app.
- Payment-like notes on unpaid buy-ins are review risks only; never treat a
  note such as "venmo" as paid unless the ledger row is explicitly marked paid.

### Tests

- Vitest is configured in `vitest.config.ts`.
- Pure rule tests live in `src/lib/*.test.ts`.
- API/server integrity tests live in `server.test.ts` and use Supertest with
  temporary SQLite databases.
- Browser/runtime proof scripts live in `scripts/verify-*.ts` and
  `scripts/verify-backup.mjs`.

## Working Notes

- Recheck the live worktree and DB before making present-tense claims.
- Do not invent missing GHIN indexes, payments, launch status, deployment status,
  or physical-device verification.
- When changing league rules, update the matching pure rule test or API
  integrity test in the same slice.
- When changing Admin/export behavior, update the relevant smoke verifier so the
  proof suite exercises the new surface.
- Local app proof and public/tailnet access proof are separate claims.
