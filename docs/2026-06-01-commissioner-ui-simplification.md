# Commissioner UI Simplification — 2026-06-01

## Summary

The commissioner-facing Admin surface had grown into a large, partly-duplicated
wall of panels and a 40+-link export grid. This change consolidates it into two
lean surfaces and removes the audit/launch-gate/evidence panels from the UI,
while keeping every server export route intact.

**Net:** ~2,000 lines removed across the client. `AdminConsole.tsx` 1668 → 1075,
`Operations.tsx` 2818 → 1758. Production bundle 466 KB → ~423 KB. No league
functionality removed; no `/api/export/*` route removed.

The player-facing app (board, claiming, polls, score cards, standings, season,
money, roster) was already in good shape and is unchanged except for one
score-line readability pass.

## Motivation

- The Admin tab rendered every commissioner tool **twice**: `AdminConsole`
  showed curated controls, then embedded the entire `Operations` workbench
  below it, which repeated Completion Audit, One-Paste Intake, Launch Gates,
  Score Audit, and the full Exports grid.
- Much of the surface was audit/compliance paper-trail (launch-gate checklists,
  source-search ledger, evidence-gap packets, verification-run logs, archive
  manifest, completion audit) that a casual ~12-person league never uses.
- The product owner relies on low cognitive load; a 25-section admin screen is
  the opposite of that.

## What changed

### Phase 1 — de-duplicate the Admin tab

Removed the four sections the embedded `Operations` workbench duplicated from
`AdminConsole` (Completion Audit, One-Paste Intake, Launch Gates, Season
Export), plus a stray `/api/export/completion-audit.json` fetch that fired on
every mount. Kept the genuinely unique Operations panels (Settings, Schedule
Confirmation, Live Stop Snapshot, Score Rule Audit, Name Cleanup, Tournament
Closeout) and the task queue.

### Phase 2 — declutter AdminConsole + Operations

`AdminConsole`:
- Removed the Operational Readiness, Launch & Access, and Audit Log panels
  (and their background fetches).
- Removed the "Operations Workbench" teaser.
- Admin Map cut from 14 buttons to 6 (Roster/Handicap, Buy-ins, Tee times,
  Score review, Closeout, Exports).
- Header metric "Launch" → "Buy-ins open".
- Exports grid cut from 40+ links to 6 core: Season JSON, Standings CSV,
  Roster CSV, Buy-ins CSV, Payouts CSV, Database Backup.

`Operations`:
- Removed the League Checklist (launch-risk status) panel.
- Removed the paper-trail copy buttons from Open Admin Work (Copy request list,
  Copy evidence packet, evidence-gap summary, per-task evidence-path). Kept the
  task list, Copy tasks, and per-task copy.

### Phase 3 — player polish

- De-jargoned the tee-time score line. Attestation statuses now read in plain
  English ("confirmed by X", "awaiting X", "needs X to confirm", "draft — no
  attester yet"). Handicap-source badges surface only the meaningful flags
  ("unverified handicap", "adjusted by commissioner"); trusted GHIN/calculated
  course handicaps show no badge.

Deliberately **not** done (with reasoning):
- ScoresSheet "tee details" toggle — that card is the course-handicap engine
  (rating/slope/par → computed CH), central to net scoring, not throwaway
  detail. Hiding it would regress a core scoring tool.
- Replacing native `window.confirm()` dialogs — cosmetic only; native confirms
  are clearer/unmissable for destructive actions and replacing them across the
  core player flows is regression risk for no functional gain.

### Dead-code cleanup

After the cuts, `tsc --noUnusedLocals --noUnusedParameters` was used to remove
all resulting dead code so `src/` is clean under strict unused-checking
(`server.ts` excluded): unused imports (`X`, `RELATIVE_THRESHOLDS`, `Buyin`),
the `onContinue` prop, and now-unused launch/intake props on `CommandCenter`,
`AdminConsole`, and `Operations` (plus their inline handlers in `App.tsx`).

## What was removed from the UI vs kept server-side

Removed from the commissioner **UI** only. All of these remain available as
`/api/export/*` downloads (and via env vars / API where applicable):

| Concept | UI panel | Server route(s) | Status |
|---|---|---|---|
| Completion audit | removed | `/api/export/completion-audit.{json,csv}` | route kept |
| Launch gates | removed | `/api/launch-checks`, `DJDI_*_VERIFIED`, `/api/export/launch-checks.*`, `/api/export/launch-gate-checklist.*` | route + env kept |
| Audit log | removed | `/api/export/audit.{json,csv}` | route kept |
| Operational readiness | removed | `/api/export/readiness.json` | route kept |
| League checklist (risks) | removed | `/api/export/risks.{json,csv}` | route kept |
| Source-search ledger | removed | `/api/export/source-search-ledger.*` | route kept |
| Evidence-gap packet | removed | `/api/export/evidence-gap-packet.*` | route kept |
| Archive manifest | removed | `/api/export/archive.json` | route kept |
| Verification ledger | removed | `/api/export/verification-runs.*` | route kept |
| 34 niche export links | removed from grid | all routes unchanged | route kept |

## Verification

- `npm run lint` — clean.
- `npm run build` — clean; bundle 466 KB → ~423 KB.
- `npm run test` — 146/146 on clean runs. One intermittent failure exists in
  `server.test.ts` ("requires the shared access code…" / score-attester tests);
  it is **pre-existing** test-isolation flakiness, proven by reproducing in
  isolation with none of the changed files loaded and by different tests failing
  across runs. Tracked separately.
- `npm run verify:mobile-ux` — `"ok": true`; the verifier was rewritten to
  exercise the surviving canonical surfaces (AdminConsole console + Full
  Operations workbench), and the one-paste-intake exercise now drives
  AdminConsole's "One-Paste Updates".

## Follow-ups

- `server.test.ts` intermittent flakiness (shared `process.env`/seed state).
- Stale task hint copy "Admin > One-Paste Intake" → "One-Paste Updates"
  (referenced in lib + tests + remote verifier scripts; deferred as a wide
  rename for a minor copy nit).
