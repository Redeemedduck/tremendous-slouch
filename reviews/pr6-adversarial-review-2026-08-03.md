# PR #6 Adversarial Review — 2026-08-03

Three independent agent reviews of PR #6 (`claude/golf-league-app-refactor-9bjpeo`,
"DJDI clubhouse redesign"). All verdicts: **APPROVE WITH CONDITIONS.**
CI itself is green (4/4 tests, tsc clean, build clean, zero console errors).

## Consolidated merge blockers (deduped across reviewers)

1. **Scoring dead end** (usability H1+H2): solo league rounds can never be scored
   (attester required, no casual/unattested fallback, no dismiss) and the
   "league round" rule is date-window-only — contiguous May–Sep windows make
   every in-season round a league round, invisibly. Permanent un-clearable
   "waiting on scores" banner; two zombie May 16 rounds already exist.
2. **No cross-client refresh + silent stale-action failure** (usability H4):
   claims/votes never propagate to other open clients (no polling, no focus
   refetch), and acting on a stale board silently no-ops. Core-loop killer for
   a "grab the last spot" app.
3. **Identity forking on rename** (usability H3 + design M): renaming yourself
   orphans your tee times/votes/claims, creates a phantom roster member who
   owes $325, with no merge/remove tool. Related root cause: profile is
   persisted to localStorage *before* the server accepts (`App.tsx:177-180`),
   so a rejected save still switches the local identity.
4. **Client/server disagree on `points_to_first`** (architecture HIGH):
   `useTournaments.ts:4-8` unconditionally clobbers the value to 20 client-side
   while `server.ts:263-271` deliberately preserves hand-edited values. Pick one
   policy; the constant 20 is currently encoded in three places.
5. **Missing double-count regression test** (architecture HIGH): every standings
   test passes empty `teeTimes`, so the official-finals-supersede-raw-scores
   invariant (the PR's central safety claim) has zero coverage. The reviewing
   agent's scratch harness (raw in-window round vs published finals) is the
   missing test; the invariant *did* hold when executed.
6. **Contrast failures** (design HIGH): `text-stone-400` metadata at 12px
   (~2.5:1) and the PAST badge (~2.4:1), made worse by `opacity-70` on past
   event cards including their expanded panels (~2:1). `SeasonSchedule.tsx:49,148,203`.
7. **Header wordmark crushed by identity pill** (design HIGH): pill is
   `shrink-0` with no max-width while the brand block truncates — a 30-char
   name reduces the header to "DJDI… / Tee shee…". `Header.tsx`.
8. **SeedMedallion hardcoded hexes** (design + architecture): `SeedMedallion.tsx:13`
   duplicates gold/cream token values as literals, violating the PR's own
   "tokens only" rule; use `var(--color-gold-*)` in the gradient.
9. **Stale validation banner** (usability M1): "Course is required" persists
   from a prior attempt while the actual blocker (past date) shows only a
   transient native bubble.

## Strongly recommended (non-blocking)

- Collapse the three `eqName` copies + inline reimplementations onto
  `format.ts:16`; delete dead re-exports and unreachable sort branches in
  `standings.ts` (also silently removed gross/rounds sorting — undocumented).
- Standings computed independently in `SeasonHome` and `SeasonSchedule`; cut
  line and seed map can diverge if edited alone.
- Serif/sans inconsistency on course names and board headings (display font
  applied ~half the time); leader's points use proportional serif figures in a
  tabular column; POS column has three visual centerlines.
- Roster "flag" model: three vocabularies (unflagged / NO PROFILE / Member),
  and one un-confirmed tap irreversibly re-bases the buy-in pool.
- One-tap spot drop with no confirm (inconsistent with two-tap deletes);
  hosts can orphan their own tee time.
- Active stop has no interim leaderboard; PAST vs FINAL never explained;
  finals aren't locked against late score entry.
- Browser back exits the app (no history for tabs/sheets) — painful on the
  primary mobile form factor.
- Lowercased map keys leak to UI ("Max Mccutcheon" via CSS capitalize).
- Float `===` newly load-bearing for tie splits on the GHIN fallback path.
- Startup data migrations (100→20 pts, $334→$306) are idempotent but mutate
  user rows on boot — the PR's "no schema changes" claim elides them.
- [INFERENCE] Pool math: 11×$325 = $3,575 vs 7×$306 + $1,560 = $3,702 (−$127).
  Old numbers balanced exactly. Plausible if the departed member's settlement
  covered ≥$127 — one-question commissioner confirmation recommended, since
  the app displays these payouts as owed.

## What survived the attack (verified by execution, not assumption)

- Points scale, tie splitting, competition ranking (1, T2, T2, 4), and
  official-finals supersession all hand-recomputed and executed correctly.
- "No API or schema changes" true at the endpoint/schema level.
- Naive-local-date convention respected; no timezone drift introduced.
- Desktop layout centers gracefully; sheets become dialogs; no layout shift.
- Optimistic UI on every own-action; two-tap delete guards; identity gating
  with inline hints; score requirements communicated before submit; duplicate
  poll options robustly blocked; motion respects prefers-reduced-motion.

## Reviewer agents

- Architecture: compound-engineering architecture-strategist (agent a81dcc47bf35e39d0)
- Design: general-purpose w/ live browser (agent a6d404430e869dec2)
- Usability: general-purpose w/ live browser (agent af9b47d4a96d04943)

Full findings with file:line references and repro steps are in each agent's
report (this session's transcript); the blockers above preserve every
merge-gating item.
