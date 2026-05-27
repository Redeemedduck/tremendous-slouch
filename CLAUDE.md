# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Express + Vite dev server at 127.0.0.1:3000 with HMR
npm run build      # Production client build to dist/
npm run preview    # Vite preview server for the built client
npm run lint       # Type-check only (tsc --noEmit)
npm run test       # Vitest rule and API test suite
npm run verify:backup # Create and restore-check a temporary SQLite backup
npm run verify:live-state # Read-only audit of the real local league DB
npm run verify:persistence # Create a temp tee time, restart, and verify it survives
npm run verify:prod-smoke # Smoke built dist + access-gated API on a temp DB
npm run verify:deploy-prereqs # Check Fly deploy auth/app/volume prerequisites
npm run verify:remote-smoke # Read-only smoke for a deployed URL
npm run verify:remote-mobile-ux # Read-only mobile viewport smoke for a deployed URL
npm run verify:mobile-ux # Phone-sized commissioner workflow smoke
npm run verify:docker # Build and smoke the production Docker image
npm run verify:all     # Full local proof suite
npm run start      # Start the production server; requires dist/ to already exist
npm run start:prod # Build dist/ and then start the production server
npm run clean      # Remove dist/
```

## Environment

Configuration is controlled by environment variables:

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Fly/container runtime sets `0.0.0.0`; local loopback stays private. |
| `PORT` | `3000` | TCP port. |
| `DB_PATH` | `./golf_coordinator.db` | SQLite file location. Fly uses `/data/golf_coordinator.db`. |
| `ACCESS_CODE` | unset | Optional access gate for `/api/*` routes via the `golf_access` HttpOnly cookie. |
| `NODE_ENV` | `development` | `production` serves `dist/` directly instead of Vite middleware. |
| `DJDI_DOCKER_BUILD_VERIFIED` | unset | `1` clears the Docker build external risk after the image build gate passes. |
| `DJDI_TAILNET_URL_VERIFIED` | unset | `1` clears the tailnet URL external risk after Tailscale Serve and tailnet smoke checks pass. |
| `DJDI_PRODUCTION_URL_VERIFIED` | unset | `1` clears the production URL external risk after live smoke testing. |
| `DJDI_MOBILE_SAFARI_VERIFIED` | unset | `1` clears the iPhone Safari external risk after physical-device validation. |

No Gemini API key is required for this app.

## Architecture

**DJDI Golf Board** is a React 19 + Vite + TypeScript golf league coordination app backed by a single Express server and SQLite database. The user-facing package slug is `golf-group-coordinator`.

### Client

- Main UI lives under `src/`, with reusable rule logic in `src/lib/`.
- The app coordinates tee times, group polls, roster identity, league score entry, tournament leaderboards, season standings, championship/post-season ranking, and buy-in pool tracking.
- Ops coordinates rule audits, closeout packets/ledgers, payout settlement-note evidence, launch gates, inline/copyable launch-gate checklist, request packets, copyable blocker handoff, bulk reply intake, payment-note/evidence review, task exports, completion audit, source-search ledger, archive manifest, and the verification ledger.
- Player GHIN index updates can include a `handicapSource` note so roster CSV
  exports preserve direct evidence instead of relying on chat memory.
- Vite is mounted through Express in development so API routes and the client share one local origin.

### Server

- `server.ts` owns schema migration, seed data, API routes, access-code gating, static asset serving, and startup.
- Testable seams are exported as `createDb`, `createApp`, and `startServer`.
- `createDb(dbPath = process.env.DB_PATH ?? "golf_coordinator.db")` enables temporary SQLite databases in tests and persistent volume paths in production.
- SQLite uses WAL mode. State-changing operations are wrapped in transactions where consistency matters.

### Tests

- Vitest is configured in `vitest.config.ts`.
- Pure rule tests live in `src/lib/*.test.ts`.
- API/server integrity tests live in `server.test.ts` and use Supertest with temporary SQLite databases.
- The full local proof suite is `npm run verify:all`.

## Working Notes

- Preserve concurrent edits from other workers.
- Recheck the current worktree, live DB, and runtime before making present-tense claims.
- Do not invent missing GHIN indexes, payments, launch status, deployment status, or physical-device verification.
- When changing league rules, update the matching pure rule test or API integrity test in the same slice.
- When changing Ops/export behavior, update the relevant smoke verifier so the proof suite exercises the new surface.
