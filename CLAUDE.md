# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Express + Vite dev server at 127.0.0.1:3000 with HMR
npm run build      # Production client build to dist/
npm run preview    # Vite preview server for the built client
npm run lint       # Type-check only (tsc --noEmit)
npm run test       # Vitest rule and API test suite
npm run start      # Start the production server; requires dist/ to already exist
npm run start:prod # Build dist/ and then start the production server
npm run clean      # Remove dist/
```

## Environment

Configuration is controlled by environment variables:

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only for LAN-direct access without a reverse proxy. |
| `PORT` | `3000` | TCP port. |
| `DB_PATH` | `./golf_coordinator.db` | SQLite file location. Fly uses `/data/golf_coordinator.db`. |
| `ACCESS_CODE` | unset | Optional access gate for `/api/*` routes via the `golf_access` HttpOnly cookie. |
| `NODE_ENV` | `development` | `production` serves `dist/` directly instead of Vite middleware. |

No Gemini API key is required for this app.

## Architecture

**DJDI Golf Board** is a React 19 + Vite + TypeScript golf league coordination app backed by a single Express server and SQLite database. The user-facing package slug is `golf-group-coordinator`.

### Client

- Main UI lives under `src/`, with reusable rule logic in `src/lib/`.
- The app coordinates tee times, group polls, roster identity, league score entry, tournament leaderboards, season standings, championship/post-season ranking, and buy-in pool tracking.
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
- CI runs `npm run lint`, `npm run test`, `npm run build`, and `npm audit --audit-level=moderate`.

## Working Notes

- Do not touch untracked `AGENTS.md`.
- Preserve concurrent edits from other workers.
- When changing league rules, update the matching pure rule test or API integrity test in the same slice.
