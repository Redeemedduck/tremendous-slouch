# DJDI TDD Rule Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first executable quality gate for DJDI Golf Board: deterministic rule tests, a testable server seam, a scorer-eligibility integrity fix, and CI checks that prevent silent regressions before 2026 season launch.

**Architecture:** Keep the current React/Vite plus single Node/Express/SQLite app. Add Vitest for rule and API tests. Refactor `server.ts` just enough to export `createDb`, `createApp`, and `startServer` while preserving runtime behavior for `npm run dev` and production start.

**Tech Stack:** TypeScript, React 19, Vite, Express, better-sqlite3, Vitest, Supertest, GitHub Actions.

---

## Preconditions

- Work on branch `codex/djdi-2026-roadmap`.
- Do not touch untracked `AGENTS.md`.
- Keep this as one focused PR: tests, server seam, scorer eligibility fix, CI/docs truth updates.
- Do not mix in deploy, backup, mobile Safari, visual redesign, Linear cleanup, or payment work.

## Task 1: Add Vitest and Rule Characterization Tests

**Purpose:** Create a repeatable test harness and pin the current leaderboard/standings/post-season math before changing server behavior.

**Files:**
- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `src/lib/tournamentLeaderboard.test.ts`
- `src/lib/standings.test.ts`
- `src/lib/postSeason.test.ts`

### Steps

- [ ] Install the test dependencies:

```bash
npm install -D vitest supertest @types/supertest
```

- [ ] Add the `test` script:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

- [ ] Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "server.test.ts"],
  },
});
```

- [ ] Add `src/lib/tournamentLeaderboard.test.ts` with these coverage points:

```ts
import { describe, expect, it } from "vitest";
import { computeTournamentLeaderboard } from "./tournamentLeaderboard";
import type { Score, TeeTime, Tournament } from "./types";

const regularTournament: Tournament = {
  id: "regular-1",
  name: "Regular Week 1",
  course: "Common Ground",
  windowStart: "2026-04-01",
  windowEnd: "2026-04-07",
  type: "regular",
  pointsToFirst: 100,
  payoutFirst: 334,
  payoutSecond: null,
  payoutThird: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function teeTime(date: string, scores: Score[]): TeeTime {
  return {
    id: `tee-${date}`,
    course: "Common Ground",
    date,
    time: "09:00",
    spots: 4,
    host: "Greg",
    notes: null,
    claims: [],
    interested: [],
    scores,
    comments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeTournamentLeaderboard", () => {
  it("uses only scores inside the tournament window", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          { name: "Alex", gross: 80, courseHcp: 10, recordedAt: "2026-04-03T18:00:00.000Z" },
        ]),
        teeTime("2026-04-09", [
          { name: "Alex", gross: 70, courseHcp: 10, recordedAt: "2026-04-09T18:00:00.000Z" },
        ]),
      ],
      () => null
    );

    expect(rows).toMatchObject([{ name: "Alex", bestGross: 80, bestNet: 70 }]);
  });

  it("prioritizes score-level course handicap over member handicap", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          { name: "Alex", gross: 82, courseHcp: 8, recordedAt: "2026-04-03T18:00:00.000Z" },
        ]),
      ],
      () => 20
    );

    expect(rows[0]).toMatchObject({ name: "Alex", bestGross: 82, bestNet: 74 });
  });

  it("sorts no-net rows behind completed net rows", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          { name: "No Net", gross: 70, recordedAt: "2026-04-03T18:00:00.000Z" },
          { name: "Net Player", gross: 82, courseHcp: 10, recordedAt: "2026-04-03T18:00:00.000Z" },
        ]),
      ],
      () => null
    );

    expect(rows.map((row) => row.name)).toEqual(["Net Player", "No Net"]);
  });

  it("merges player names case-insensitively", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          { name: "Alex", gross: 80, courseHcp: 10, recordedAt: "2026-04-03T18:00:00.000Z" },
        ]),
        teeTime("2026-04-04", [
          { name: "alex", gross: 78, courseHcp: 10, recordedAt: "2026-04-04T18:00:00.000Z" },
        ]),
      ],
      () => null
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Alex", rounds: 2, bestGross: 78, bestNet: 68 });
  });
});
```

- [ ] Add `src/lib/standings.test.ts` covering:
  - regular-event point table awards the expected points by rank
  - majors/championships do not leak into regular-season standings unless intended by the existing function contract
  - standings sort by season points, then average net, then rounds when using `sortStandings(..., "seasonPoints")`
  - tied rows keep deterministic rank/order

- [ ] Add `src/lib/postSeason.test.ts` covering:
  - only post-season/championship rows feed post-season ranking
  - seed offsets are applied before final sorting
  - adjusted ranking sorts by adjusted net
  - no-net rows sort last

- [ ] Run:

```bash
npm run test
```

**Expected:** The pure rule tests pass without production-code edits. If any fail, treat the failure as either a real rule drift or a bad test fixture; inspect the corresponding `src/lib/*` function before changing expectations.

## Task 2: Make Server Testable Without Changing Runtime Behavior

**Purpose:** Export test seams so API tests can run against a temporary SQLite database instead of importing `server.ts` and accidentally binding a port or mutating the default DB.

**Files:**
- `server.ts`
- `server.test.ts`

### Red

- [ ] Create `server.test.ts` with an import that currently fails:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, createDb } from "./server";

const dbFiles: string[] = [];

function tempDbPath() {
  const file = path.join(os.tmpdir(), `djdi-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`);
  dbFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of dbFiles.splice(0)) {
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
    }
  }
});

describe("server app factory", () => {
  it("serves seeded tee times from a temp database", async () => {
    const db = createDb(tempDbPath());
    const app = createApp(db, { serveAssets: false });

    const response = await request(app).get("/api/teetimes").expect(200);

    expect(Array.isArray(response.body.teeTimes)).toBe(true);
    expect(response.body.teeTimes.length).toBeGreaterThan(0);
    db.close();
  });
});
```

- [ ] Run:

```bash
npm run test -- server.test.ts
```

**Expected red:** TypeScript/Vitest fails because `createApp` and `createDb` are not exported yet.

### Green

- [ ] Refactor `server.ts` into exported seams:

```ts
import { pathToFileURL } from "node:url";

export type CreateAppOptions = {
  serveAssets?: boolean;
};

export function createDb(dbPath = process.env.DB_PATH ?? "golf_coordinator.db") {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  migrateAndSeed(database);
  return database;
}

export function createApp(database: Database.Database, options: CreateAppOptions = {}) {
  const app = express();
  const serveAssets = options.serveAssets ?? process.env.NODE_ENV === "production";

  // Move existing middleware, statements, helper closures, and routes here.
  // Replace module-level `db` references with `database`.

  if (serveAssets) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  return app;
}

export function startServer() {
  const database = createDb();
  const app = createApp(database);
  app.listen(PORT, () => {
    console.log(`DJDI Golf Board listening on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
```

- [ ] Preserve existing endpoint behavior, request parsing, CORS/static behavior, migrations, seed data, and route paths.
- [ ] Keep prepared statements inside `createApp` so every test database gets its own statements.
- [ ] Run:

```bash
npm run test -- server.test.ts
npm run lint
npm run build
```

**Expected:** Server seam test, type-check, and build all pass.

## Task 3: Fix Scorer Eligibility With a Failing API Test

**Purpose:** Prevent a tee-time participant from recording a score for a player who did not claim that tee time.

**Files:**
- `server.test.ts`
- `server.ts`

### Red

- [ ] Add a failing test to `server.test.ts` after the app factory test:

```ts
it("rejects a regular tee-time score for an unclaimed player", async () => {
  const db = createDb(tempDbPath());
  const app = createApp(db, { serveAssets: false });

  const members = [
    { name: "Alex", handicap: 10, member: true },
    { name: "Greg", handicap: 8, member: true },
  ];

  for (const member of members) {
    await request(app)
      .put(`/api/players/${encodeURIComponent(member.name)}`)
      .send({ handicap: member.handicap, member: member.member })
      .expect(200);
  }

  const tournaments = await request(app).get("/api/tournaments").expect(200);
  const regular = tournaments.body.tournaments.find((tournament: any) => tournament.type === "regular");
  expect(regular?.windowStart).toBeTruthy();

  const created = await request(app)
    .post("/api/teetimes")
    .send({
      course: regular.course,
      date: regular.windowStart,
      time: "09:00",
      spots: 4,
      host: "Greg",
      notes: "test regular tee time",
    })
    .expect(201);

  await request(app)
    .post(`/api/teetimes/${created.body.teeTime.id}/claims`)
    .send({ name: "Greg" })
    .expect(409);

  await request(app)
    .post(`/api/teetimes/${created.body.teeTime.id}/scores`)
    .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Greg" })
    .expect(400);

  const teeTimes = await request(app).get("/api/teetimes").expect(200);
  const updated = teeTimes.body.teeTimes.find((teeTime: any) => teeTime.id === created.body.teeTime.id);
  expect(updated.scores.some((score: any) => score.name === "Alex")).toBe(false);

  db.close();
});
```

- [ ] If the API shape has changed by the time this is implemented, adjust endpoint names/response field names only to match the real `server.ts` API. Do not weaken the rule assertion.
- [ ] Run:

```bash
npm run test -- server.test.ts
```

**Expected red:** The test fails because the API currently accepts or persists a score for the unclaimed player.

### Green

- [ ] In the score-recording transaction in `server.ts`, load tee-time claims before inserting the score.
- [ ] For non-post-season tournament tee times, reject when the submitted score `name` does not case-insensitively match a claimed participant.
- [ ] Keep existing attester validation. This fix is about scorer/player eligibility, not attestation.

Implementation shape:

```ts
const normalizedPlayerName = normalizeName(name);
const claimedNames = claims.map((claim) => normalizeName(claim.name));

if (inTournament && !claimedNames.includes(normalizedPlayerName)) {
  throw new ValidationError("Player must claim this tee time before recording a score");
}
```

- [ ] Use the repo's existing name-normalization helper if one exists. If not, add a small local helper near the score route:

```ts
function normalizeName(value: string) {
  return value.trim().toLowerCase();
}
```

- [ ] Run:

```bash
npm run test -- server.test.ts
npm run test
npm run lint
npm run build
```

**Expected:** All tests, type-check, and build pass.

## Task 4: Add Finance and Attestation API Coverage

**Purpose:** Pin high-risk server behavior that must remain trustworthy during season operations.

**Files:**
- `server.test.ts`

### Steps

- [ ] Add tests for member promotion/demotion and buy-in rows:
  - creating/promoting an active member creates a default `$325` buy-in
  - demoting/deactivating a member removes or excludes the buy-in according to current product behavior
  - pool totals reflect active buy-ins only

- [ ] Add tests for attestation:
  - a regular score requires `attestedBy`
  - a player cannot self-attest
  - the attester must be part of the tee-time claims or eligible participant set according to current rule copy

- [ ] Run:

```bash
npm run test -- server.test.ts
npm run test
```

**Expected:** Tests pass after any narrow fixes needed to align implementation with the stated product rules. Any rule ambiguity should be resolved from existing docs/specs first, not by asking the user.

## Task 5: Wire CI and Correct Stale Docs

**Purpose:** Make the new quality gate visible and remove stale statements that would mislead future agents.

**Files:**
- `.github/workflows/ci.yml`
- `Dockerfile`
- `CLAUDE.md`
- `README.md`

### Steps

- [ ] Update CI to run tests and audit after install:

```yaml
- name: Test
  run: npm run test

- name: Security audit
  run: npm audit --audit-level=moderate
```

- [ ] Run audit locally:

```bash
npm audit --audit-level=moderate
```

**Expected:** If audit still reports the known vulnerabilities, do not hide it. Either fix with `npm audit fix` if it does not introduce breaking changes, or document the blocker in the final handoff with exact package names.

- [ ] Remove the stale Dockerfile TODO that says the DB path is hardcoded if `server.ts` still honors `DB_PATH`.
- [ ] Update `CLAUDE.md` so it describes DJDI Golf Board, the Express/SQLite server, and the new test command. Remove old Dispersion Lab/no-tests guidance if still present.
- [ ] Update `README.md` local run instructions so `start` versus `start:prod` are accurate.
- [ ] Run:

```bash
npm run lint
npm run test
npm run build
npm audit --audit-level=moderate
```

**Expected:** Lint, tests, and build pass. Audit either passes or has a precise documented blocker.

## Task 6: Commit the Slice

**Purpose:** Leave the branch in a reviewable state with verification evidence.

### Steps

- [ ] Inspect changed files:

```bash
git status --short
git diff --stat
```

- [ ] Confirm `AGENTS.md` remains untracked and untouched.
- [ ] Commit only the intentional files:

```bash
git add package.json package-lock.json vitest.config.ts src/lib/*.test.ts server.test.ts server.ts .github/workflows/ci.yml Dockerfile CLAUDE.md README.md
git commit -m "test: add DJDI rule integrity gate"
```

- [ ] Final report must include:
  - changed behavior in one sentence
  - verification results
  - audit status
  - any unresolved blocker with exact file/package/command evidence

## Agent Split

Use subagents for non-overlapping work:

- **Rule-test worker:** owns `vitest.config.ts`, `src/lib/*.test.ts`, and package test setup.
- **Server-testability worker:** owns `server.ts` seam refactor and `server.test.ts` app-factory smoke test.
- **Integrity worker:** owns scorer eligibility, attestation, and finance API tests/fixes after the seam lands.
- **Docs/CI worker:** owns `.github/workflows/ci.yml`, `Dockerfile`, `CLAUDE.md`, and `README.md` after code verification is green.

Workers are not alone in the codebase. Each worker must avoid reverting edits from other workers and should adapt to changes already present on the branch.

## Stop Conditions

- Stop and report precisely if a test requires a product rule that contradicts committed docs/specs.
- Stop and report precisely if `npm audit fix` would make a breaking dependency change.
- Stop and report precisely if the server seam refactor requires route behavior changes outside testability.
