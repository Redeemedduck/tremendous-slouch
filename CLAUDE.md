# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Express + Vite middleware dev server (tsx server.ts), localhost:3000
npm run build      # Production client build to dist/
npm run start      # Production server (serves dist/, NODE_ENV=production)
npm run lint       # Type-check only (tsc --noEmit) — no linter configured
npm test           # Unit tests (node:test via tsx) for src/lib/*.test.ts
```

CI (`.github/workflows/ci.yml`) runs test → lint → build on every push and PR.

## What this app is

**DJDI Golf Board** (package slug `golf-group-coordinator`) — a mobile-first
web app for a ~12-person summer golf league. Members post and claim tee
times, ask the group questions (polls), record attested scores, and follow
the season-long DJDI points race into a 4-seed championship. See README.md
for the full feature tour.

## Architecture

- **`server.ts`** — single-file Express + better-sqlite3 backend. All REST
  endpoints under `/api/*` (tee times, claims, interest, scores, comments,
  polls, players, buy-ins, tournaments, access gate). Seeds the 2026
  tournament schedule at startup. In dev it mounts Vite middleware; in prod
  it serves `dist/`. SQLite database path via `DB_PATH` (defaults to
  `./data.db`); optional `ACCESS_CODE` enables the access gate.
- **`src/App.tsx`** — app shell. Access gate → three sections switched by a
  bottom nav: **Board** (tee times + polls), **Season** (standings and event
  boards), **Manage** (roster, buy-ins, completed rounds). Bottom sheets for
  create/edit flows.
- **`src/hooks/`** — one hook per API resource (`useTeeTimes`, `usePolls`,
  `usePlayers`, `useBuyins`, `useTournaments`, `useMyProfile`, `useToast`).
  Optimistic-ish: mutate then refetch; errors surface through the toast.
- **`src/lib/`** — pure scoring/domain logic, unit-tested:
  - `leaguePoints.ts` — official DJDI points scale `20/15/14/11/9/8/7/6/5/4/3/2`,
    tie splitting (ties share the points of all occupied places), competition
    ranking (`1, T2, T2, 4`).
  - `officialResults.ts` — published final boards (authoritative historical
    results that override raw tee-time records for those events).
  - `tournamentLeaderboard.ts` / `standings.ts` — per-event boards and
    cumulative season standings; net = gross − course handicap (falls back
    to GHIN index for non-league rounds).
  - `postSeason.ts` — championship bracket with seed stroke advantages
    (−4/−3/−2/−1 for regular-season seeds 1–4).
  - `format.ts`, `calendar.ts` — date/handicap formatting, `.ics` export.
- **`src/components/`** — presentational components. `ui/Sheet.tsx` is the
  shared bottom-sheet primitive; `ui/Field.tsx` holds shared form styles.

## League rules encoded here (do not change casually)

- Points scale and tie splitting live in `src/lib/leaguePoints.ts` and are
  locked by `src/lib/leaguePoints.test.ts` against the published boards.
- League rounds (tee times inside a regular tournament window) require a
  per-round **course handicap** and an **attester** (another member on the
  same tee time) — enforced server-side.
- Published finals in `officialResults.ts` supersede score-derived boards
  and must not be double-counted (see `computeStandings`).

## Design system

Tailwind CSS 4 (`@theme` tokens in `src/index.css`):

- **fairway** — deep pine green scale; `fairway-800` (#0b4a3a) is the DJDI
  brand green used for hero surfaces and primary buttons.
- **gold** — trophy accents: seeds, championship cut line, "final" badges.
- **cream** — parchment leaderboard surfaces and their text tones.
- `font-display` — Cormorant Garamond (loaded in `index.html`) for the
  wordmark, course names, and board headings; system sans for body.
- Motion tokens: `animate-fade-up`, `animate-sheet-up`, `animate-backdrop`,
  `animate-toast-in`. Respect `prefers-reduced-motion` (handled globally).

Use tokens — never hardcode hex values in components.

## Conventions

- Names are identity: players are matched case-insensitively by trimmed
  name everywhere (`eqName`). No accounts or auth beyond the access code.
- Dates/times are naive local strings (`YYYY-MM-DD`, `HH:MM`) — correct for
  a single-region league; don't introduce timezone conversion.
- `@/*` path alias maps to the project root (tsconfig + vite config).
- Keep the app small and league-focused; prefer deleting over abstracting.
