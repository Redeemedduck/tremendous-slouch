# DJDI Golf Board 2026 Season Roadmap Capability Design

## CAPABILITY

DJDI Golf Board becomes the operating system for the 2026 DJDI summer golf season. It gives the commissioner and league members one trusted place to coordinate tee times, collect maybes and polls, manage member/guest status, record attested scores with course handicaps, calculate standings, track buy-ins and payouts, run the post-season, and preserve the final season record.

This roadmap is intentionally not a multi-season SaaS plan. It covers one trusted group, one active season, one running board, and one source of truth for the league through the 2026 championship. The product should move from "feature-rich and locally verified" to "used by the group without Matt babysitting every interaction."

## CONSTRAINTS

- The product serves a single trusted group. Shared access-code gating is enough for 2026; full accounts, roles, OAuth, and multi-tenant auth are out of scope.
- The product serves one active 2026 season. Reusable season configuration and historical season switching are deferred unless they are needed for archive/export.
- SQLite remains acceptable for 2026 if the app stays single-process, uses a persistent volume, and has a clear backup/restore path before real group use.
- Mobile Safari behavior is a launch requirement. Desktop polish is secondary to the iPhone path the group will actually use.
- Host and commissioner flows can remain honor-system, but destructive or standings-affecting actions need guardrails, recovery, or audit visibility.
- Scoring integrity is product-critical. Course handicap, member versus guest, attestation, points, stroke advantages, buy-ins, and payouts must be protected by tests and server-side rules.
- Linear, README, Dockerfile, deployment docs, and CI must describe the real current system. Stale optimism is treated as product risk.
- Test-driven development is required for every future feature, bugfix, refactor, and behavior change. A failing behavior test must exist before production code changes.

## IMPLEMENTATION CONTRACT

### Actors

- Commissioner or host: posts tee times, manages roster/member flags, records or corrects scores, tracks buy-ins and payout obligations, and closes tournaments.
- League member: claims or maybes tee times, votes in polls, supplies GHIN index/course handicap, attests another member's score, and checks standings.
- Guest or drop-in: can be part of tee times and scores, but cannot attest member scores or earn season/post-season standing.
- Operator: deploys the app, verifies production health, maintains backups, audits data, and keeps Linear/docs truthful.

### Surfaces

- Mobile board: tee times, claims, maybes, comments, polls, roster, finances, standings, and season schedule.
- Server API: access, tee times, claims, interested, comments, polls, players, buy-ins, tournaments, and scores.
- Operations lane: deployment docs, production smoke test, backup/restore procedure, CI gates, audit output, and Linear project status.

### States And Transitions

1. Pre-launch: repo truth is current, tests exist, deploy path is verified, access code is set, backup/export exists, and the real iPhone path is checked.
2. Preseason setup: member roster is locked, buy-ins are initialized, seeded schedule is verified, and currently unconfirmed major/championship details are explicitly tracked.
3. Regular season: tee times are posted, maybes and polls collect intent, scores are entered with course handicap and member attestation, and standings update.
4. Tournament closeout: commissioner verifies all scores, confirms leaderboard and payout obligations, and records manual settlement state.
5. Post-season: top-four seeds receive stroke advantages, championship scores accumulate, final payouts close, and standings are frozen.
6. Archive: final database, standings, tournament results, and payout state are exported after the season.

### Required Roadmap Phases

#### Phase 0: Truth And Launch Gate

Make the merged product runnable and trustworthy before more feature work.

- Fast-forward local repo state to the merged product branch before any new work.
- Correct stale docs and comments, especially the Dockerfile DB_PATH follow-up note and any old Dispersion Lab guidance.
- Update Linear project status so PR #1 is recorded as merged, not draft.
- Replace inaccurate "unit-test suites pass" language with the current truth: CI only type-checks and builds until tests are added.
- Add Vitest and the first deterministic rule tests.
- Resolve or explicitly track the current npm audit findings.
- Deploy to a real always-on URL with persistent SQLite volume and `ACCESS_CODE`.
- Smoke test create/read/restart persistence on production-like `DB_PATH`.
- Complete iPhone Safari golden-path validation.

#### Phase 1: Rule Integrity And Test Harness

Lock the math and league rules before changing behavior.

- Add `src/lib/tournamentLeaderboard.test.ts` for tournament window inclusion, course handicap priority, no-net ordering, and case-insensitive player merge.
- Add `src/lib/standings.test.ts` for the points table, regular-only points, sorting, and current strict tie behavior.
- Add `src/lib/postSeason.test.ts` for post-only behavior, top-four stroke advantages, adjusted score ranking, and no-net ordering.
- Refactor `server.ts` only as needed to expose `createDb`, `createApp`, and `startServer` seams for integration tests. Keep behavior unchanged during the seam work.
- Add integration tests using a temporary SQLite file with WAL enabled.
- Add server tests for attestation: required inside regular/major windows, cannot self-attest, attester must be on the tee time, and attester must be a registered member.
- Add a server rule and failing-first test for scorer eligibility: league scores must be rejected when the scorer is not claimed on that tee time.
- Add finance tests for member promotion/demotion, default buy-in amount, and pool totals.

#### Phase 2: Preseason Commissioner Setup

Prepare the real league data for use.

- Verify seeded 2026 tournaments, Stop 1 Common Ground tee times, payout values, post-season stroke advantages, and unconfirmed major/championship fields.
- Lock the initial member roster and buy-in amounts.
- Record paid/unpaid buy-in state.
- Identify any missing operational fields needed for commissioner closeout, but avoid turning this into account management.

#### Phase 3: Regular Season Operations

Use existing flows first and improve only where actual season use exposes friction.

- Keep posting, claiming, maybe, comments, polls, score entry, standings, and finances as the primary flow.
- Keep 20-second polling until production use proves it is a problem.
- Add a commissioner closeout checklist or audit view if score/payout verification becomes fragile.
- Add minimal edit/recovery affordances only where mistakes can affect standings or money.

#### Phase 4: Tournament Closeout And Payout Trust

Make end-of-window operations explicit.

- Show which league scores are missing course handicap or attester.
- Show which scores were entered by API/UI after closeout if an audit trail is added.
- Confirm tournament leaderboard winner and payout amount.
- Keep payment settlement manual in 2026, but make owed/paid state visible.

#### Phase 5: Post-Season And Archive

Protect the final championship flow and preserve the result.

- Verify top-four seeds from regular-season points before championship.
- Verify stroke advantages and two-day adjusted net calculation.
- Freeze final standings and payout results after championship.
- Export final database and a human-readable season summary.

#### Phase 6: Post-MVP Reliability

Only after launch and live use, add reliability features in evidence order.

- Add SSE after deployment/proxy behavior is known and current polling is a real problem.
- Add SMS or push notifications only if group adoption still falls back to SMS.
- Apply outsourced visual/copy feedback when it arrives.
- Consider richer admin/audit tools only if real commissioner workflow demands them.

### Verification Gates

- PR gate: `npm ci`, `npm run lint`, `npm run test`, `npm run build`, and `npm audit --audit-level=moderate`.
- API gate: integration tests run against a temporary SQLite database, never the local league database.
- Deployment gate: Docker build plus production smoke against explicit `DB_PATH`.
- Persistence gate: create tee time, restart process/container, verify it survives.
- Backup gate: produce and restore a SQLite backup before group launch.
- Mobile gate: complete iPhone Safari golden path before calling the product group-ready.

## NON-GOALS

- No multi-group or multi-tenant product in the 2026 roadmap.
- No full account system, password auth, OAuth, roles, or billing.
- No GHIN integration; handicap and course handicap remain self-reported.
- No automatic payment processing.
- No generalized tournament builder unless the 2026 season cannot run with seeded schedule plus manual updates to unconfirmed event fields.
- No notification system until production use shows the current board is not enough.
- No visual redesign for its own sake before launch, phone validation, and rule integrity are protected.

## OPEN QUESTIONS

- Hosting account choice is externally blocked. The app has Fly-oriented artifacts, but the live URL cannot exist until an account or host target is available.
- Real iPhone Safari validation requires a physical phone path.
- Twilio or push notification credentials are not available and should not block the 2026 launch.
- Outsourced visual/copy feedback has not arrived and should remain a polish input, not a launch blocker.
- Major/championship course/date details need commissioner confirmation before those windows become active.

## HANDOFF

This capability is ready for implementation planning. The next lane is a TDD-first implementation plan, not direct feature coding. The plan should start with Phase 0 and Phase 1 because current risk is rule drift and operational truth, not missing visible features.

Recommended next execution order:

1. Align local branch state and docs with merged `origin/main`.
2. Add Vitest and failing-first tests for deterministic scoring, standings, post-season, and finances.
3. Refactor server startup into testable seams, with behavior protected by tests.
4. Add API tests for attestation and scorer eligibility.
5. Fix docs/Linear truth and dependency audit state.
6. Add backup/export and deployment smoke gates.
7. Deploy and complete iPhone validation.
