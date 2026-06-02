# DJDI Golf Board Launch Status - 2026-05-19

Last refreshed: `2026-05-26T22:51:42Z`

Source of truth for this snapshot:

- Live authenticated export: `/api/export/completion-audit.json`, exported at `2026-05-22T06:21:09.346Z`
- Live authenticated export: `/api/export/readiness.json`, exported at `2026-05-22T06:21:09.341Z`
- Live authenticated export: `/api/export/blocker-handoff.json`, exported at `2026-05-22T06:21:39.372Z`
- Live authenticated export: `/api/export/evidence-gap-packet.json`, exported at `2026-05-22T06:21:39.374Z`
- Live authenticated export: `/api/export/source-search-ledger.json`, exported at `2026-05-22T06:21:39.375Z`
- Live authenticated export: `/api/export/launch-gate-checklist.json`, exported at `2026-05-22T06:21:39.375Z`
- Verification ledger export: `/api/export/verification-runs.json`, exported at `2026-05-22T06:21:09.344Z`
- Live authenticated export: `/api/export/tasks.json`, exported at `2026-05-22T06:21:39.376Z`

## Current Verdict

The app now separates operational readiness from league-data tracking. Buy-in
payment evidence, source-backed handicap indexes, payout/source notes, and TBD
schedule details remain visible as league data gaps, but they are not treated
as software failures.

The private Tailscale-hosted app is currently reachable and smoke-verified.
The simplified Admin map now has verified phone navigation into tee-time
oversight, score/attestation review, launch/access, exports, audit, backup,
and the retained full Operations workbench.
The Admin map anchors now land on the intended sections, and Admin includes a
visible `Audit Log` section with recent audit events plus direct Audit JSON and
Audit CSV links. Audit is no longer hidden behind the full Operations workbench
or mixed into the exports section.
Profile identity now survives normal browser reload/profile re-save: the server
keeps the same signed browser subject for the same saved name, so returning
players and hosts do not lose ownership of their own claims, comments, or hosted
tee times.
Past tee times are still closed for claims/maybes, but players can now add and
delete their own post-round comments on mobile. The mobile verifier posts and
deletes a past-round comment as part of the Ops/board golden path.
Locked player navigation now shows only Board, Season, and Roster. Money and
Ops stay hidden until commissioner unlock, which remains available from the
profile sheet and is verified by the mobile smoke scripts.
The mobile smoke scripts now also verify a normal non-host player can open past
tee times and see score status plus net score information without seeing host,
admin, or unrelated attestation controls.
Roster handicap provenance now stores a separate commissioner note in addition
to GHIN number, Handicap Index, source type, source text, verified date, and
verified by. The note is included in the protected roster export and remains
hidden from the public roster.
Production asset serving now fails fast if `dist/index.html` is missing or if
the HTML references missing built files under `/assets`, so production cannot
silently serve stale or incomplete compiled assets.
Commissioner-created tee times and polls no longer bind host ownership to the
commissioner's saved player profile when the commissioner creates an item for a
different host. The named host can still manage the item from his own device,
while non-host players remain blocked.
Host authority for changing claims and maybe spots now uses the same signed
browser subject check as host edit/delete actions. A newly saved same-name
profile cannot act as the host on a subject-bound tee time.
Participant claim/maybe transitions are also subject-bound now: a newly saved
same-name profile cannot move an existing player from claimed to maybe or from
maybe to claimed unless it is the original profile, the host, or commissioner.
Players can now edit their own comments, not only delete them. Comment editing
uses the same signed browser subject boundary as deletion, so a same-name
impostor profile cannot rewrite someone else's comment.
Poll responses now carry the same signed browser subject boundary. A newly
saved same-name profile cannot toggle another player's poll response.
The physical iPhone Safari launch gate now has a one-tap in-app verification
action when Admin is opened from actual iPhone Safari. Non-iPhone browsers still
show only the evidence-note helper, and the server still rejects weak iPhone
Safari evidence.
The simplified Admin export panel now directly exposes launch checks, launch
checklist, closeout packet/ledger links for the first three regular events,
audit CSV, verification ledger, completion CSV, archive manifest, and database
backup links, so launch and closeout evidence exports no longer require digging
into the full Operations workbench.
Remote mobile verification now exercises the Admin backup restore proof button
through the live Tailnet URL and records that it creates a
`backup_restore_verify` audit event plus a durable
`npm run verify:remote-mobile-ux` verification-run row.
The completion audit now includes an explicit `admin-surface-inventory` item
for the required commissioner surfaces: roster/GHIN, buy-ins, tee-time
oversight, score review, attestation review, standings closeout, payout
closeout, launch checks, database backup download, backup restore proof,
exports, audit log, and advanced ops.
Admin task and risk language now says `Buy-in tracking`, `Track buy-in status`,
`Handicap records`, and `Record handicap indexes` so the app supports evidence
tracking without implying it is responsible for collecting money or obtaining
GHIN numbers.
Official score fixes now require commissioner unlock. A host can enter scores
for tee times they host, but once a score is attested or overridden,
non-commissioner edits return `403`. Commissioner fixes reopen the score as
pending, so the selected attester must confirm it again before it counts in
standings.
Selected attester names by themselves no longer count as official. Legacy
scores without an explicit `attested` or `overridden` status are now
`legacy_unconfirmed`, appear in score blockers, and are excluded from
standings, leaderboards, post-season, closeout packet, and closeout ledger
official-score totals until confirmed.

- Runtime access gate: configured
- Commissioner gate: configured and verified
- Local server: `npm run start:phone` in tmux session `djdi-phone-clean`
- Tailnet HTTPS URL: `https://duckbookpro.clouded-tailor.ts.net`
- Public always-on production URL: not required in private Tailscale mode
- Physical iPhone Safari gate: not verified

## Live Runtime

The production server is running locally behind the access gate.

- Local URL: `http://127.0.0.1:3131`
- Tailnet HTTPS root: `https://duckbookpro.clouded-tailor.ts.net/`
- Tailnet HTTPS `/djdi` path: `https://duckbookpro.clouded-tailor.ts.net/djdi`

Tailnet remote smoke and remote mobile Chromium checks passed again on
2026-05-26 after the strict-attestation, `/djdi` API-path, and language cleanup
updates plus live server restart. Remote mobile verification run
`e1a4d43e-1e93-402d-b7b2-bb3ea12e933d` unlocked the access gate, saved a normal
player profile, verified locked player navigation, unlocked commissioner tools,
reached the full admin surface, saw `Buy-in tracking`, saw the visible `Audit
Log` section, confirmed Audit JSON/CSV links, and ran the live backup-restore
proof button. Local phone verifier run `b954b57b-954e-43bb-b07e-3a6b1354da8c`
passed the same 390x844 golden path against a temporary local database. The
public always-on production URL gate is
not required in the selected private Tailscale mode; it is not being claimed as
passed. The physical iPhone Safari gate is still not recorded as verified. The
current tailnet URL depends on this machine being awake and Tailscale Serve
staying active.

Tailscale Serve is currently routing both `/` and `/djdi` to
`http://127.0.0.1:3131`, and
`https://duckbookpro.clouded-tailor.ts.net/api/health` returns
`{"ok":true,"database":"ok"}`. Root and `/djdi` title checks return
`DJDI Golf Board`. A Tailscale client/server version mismatch warning is
present after restarting the Tailscale app, but did not block the DJDI route.
The installed app bundle and CLI are `1.98.2`; the running macOS network
extension reports `1.98.1`.

## Current League Data

- Members: `12 / 12`
- Buy-in ledger rows: `12 / 12`
- Buy-ins collected: `$325 / $3,900`
- Outstanding buy-ins: `$3,575` across 11 players
- Paid buy-in: Matt
- Missing handicap records: Beck, Chris, John, Noah, Ryan, Will
- TBD events: Mid-season major; Championship - 2-day post-season
- Score rule blockers: `6`
- Stop 1 official leader: none yet; six raw scores need attestation confirmation.
- Stop 1 raw posted scores: `6`
- Stop 1 score state: `raw_scores_verified_attestation_pending`

Matt's current GHIN index is recorded as `5.5`, and the live roster CSV now
stores the source note: `CGA/GHIN email 2026-05-14: Matt Henderson index 5.5,
GHIN 7796292`. Do not infer current GHIN values for the six remaining players
without direct evidence.

## Source Search Ledger

These searches explain why the remaining open data gaps are still treated as
external facts instead of board cleanup.

The same ledger is now exportable from the app:

- `/api/export/source-search-ledger.json`
- `/api/export/source-search-ledger.csv`
- `/api/export/blocker-handoff.json`
- `/api/export/blocker-handoff.txt`
- `/api/export/evidence-gap-packet.json`
- `/api/export/evidence-gap-packet.csv`
- `/api/export/evidence-gap-packet.txt`

Current source-search summary: `7` entries as of `2026-05-19T21:18:34.000Z`,
`2` recorded facts, `3` searches with no usable source found, `1` blocked
source, and `1` inference.

Current blocker handoff summary: `5` open tasks and `5` manual-action-required
rows. Money, GHIN, and schedule rows include source-search decisions; production
URL and physical iPhone Safari remain external verification rows. The tailnet
row is no longer open.

Current evidence gap packet summary: `21` unresolved evidence rows:
`11` money, `6` GHIN, `2` schedule, and `2` launch verification rows. `19`
rows are ready for Ops > One-Paste Intake; the optional public production URL
row stays open only when public/always-on hosting is required, and physical
iPhone Safari stays in Ops > Launch Gates.

The blocker handoff JSON/text now includes a `manualEvidencePath` for each row.
For the three data blockers it points to the lowest-load path: copy the request
packet into group chat or player DMs, then paste replies into Ops > One-Paste
Intake. It also names the Messages-source recovery path: grant Full Disk Access
to the terminal/Codex app and rerun source search before changing league facts.

Money truth now includes two separate review paths: payment-like notes on unpaid
rows are not treated as paid, and paid rows without receipt/source notes are
surfaced as evidence gaps. New paid buy-in updates are now rejected unless they
include a receipt/source note.

Roster truth now keeps source capture on the direct edit path too: pasted GHIN
replies preserve the pasted line, and manual Roster edits require a GHIN source
note before saving a non-empty index.

Manual launch truth now has server-side guardrails too: verified launch checks
require evidence notes, production URL proof rejects localhost/loopback URLs and
must mention remote-smoke proof, and iPhone Safari proof must mention Safari,
the physical iPhone, and the deployed URL tested on that phone.

Commissioner settings are now centralized in Ops: the mobile Settings toggle
opens coordination routes for Money, Roster, Schedule, and Launch Gates, lets
the commissioner adjust unpaid buy-in amounts in bulk without overwriting paid
receipt-backed rows, and edits tournament points plus first/second/third payout
values directly from the board.

Tournament closeout truth now also includes payout settlement evidence: a paid
payout without a closeout/settlement note becomes a risk, commissioner task,
closeout ledger flag, closeout packet line, and `payout-evidence` completion
audit item. The current live state passes this check because no paid tournament
payout is missing a settlement note.

Ops now exposes this blocker handoff as downloads, a mobile-safe `Copy handoff`
action, and an inline `Evidence path` callout on each Commissioner Task card.
Ops also exposes a mobile-safe `Copy evidence packet` action plus JSON, CSV,
and text downloads that split every unresolved payment, GHIN, schedule,
production URL, and iPhone Safari proof into one paste-back row. The
data-blocker callouts point to Ops > One-Paste Intake for pasted player or
group-chat replies before changing league facts.

The request packet now includes the verified tailnet board URL for people with
access: `https://duckbookpro.clouded-tailor.ts.net`. It explicitly says this is
tailnet access, not the final public production URL.

The `Verify production URL` task now includes copy-ready Fly and Funnel unblocker
commands: `fly auth login`, `npm run verify:deploy-prereqs`, `fly deploy`, the
dedicated Funnel admin link, `tailscale funnel --bg --yes --https=8443 3131`,
and both remote-smoke commands.

Launch-gate checklist exports and the Ops Launch Gates panel now spell out the
required evidence for Docker, tailnet URL smoke, the final public production URL
smoke, and the physical iPhone Safari golden path. The production URL checklist
now explicitly includes `npm run verify:deploy-prereqs` plus the dedicated
Tailscale Funnel fallback command:

```sh
tailscale funnel --bg --yes --https=8443 3131
```

Ops also exposes a mobile-safe `Copy launch checklist` action.

- `/api/export/launch-gate-checklist.json`
- `/api/export/launch-gate-checklist.csv`
- `/api/export/launch-gate-checklist.txt`

| Claim | Source checked | Result | Decision |
|---|---|---|---|
| [FACT] Matt paid Jayson Post for the 2026 golf league. | Gmail message `19e3d2eb91da7bf9`, subject `You paid Jayson Post $320.00`. | Venmo email shows `$320.00`, memo `Golf league 2026 minus $5 CTP`, completed May 18, 2026, transaction `4600102340972484060`. | Recorded Matt as paid with a `$325` league buy-in row and note that the Venmo transfer netted out `$5` CTP. |
| [FACT] Matt's current GHIN index is `5.5`. | Gmail message `19e2628024f73392`, CGA/GHIN newsletter dated 2026-05-14. | Email shows Matt Henderson, GHIN `7796292`, and 2026-05-14 index information of `5.5`. | Recorded Matt handicap and roster source note. |
| [FACT] No source-backed GHIN values were found for Beck, Chris, John, Noah, Ryan, or Will. | Exact Gmail searches for each missing player plus GHIN/handicap terms; refreshed 2026-05-19 with newer_than:7d Gmail search for the missing names and GHIN/index terms. | Searches returned no matching player GHIN evidence. Latest refresh found TheGrint/USGA/CGA promotional or Matt-only messages, not DJDI handicap indexes for the six missing players. | Left those six GHIN indexes open. |
| [FACT] No additional source-backed 2026 DJDI buy-ins were found in Gmail. | Gmail searches for Venmo, PayPal, Zelle, cash, paid, buy-in/buyin, DJDI, golf league, 2026, Jayson, and roster names; refreshed 2026-05-19 with newer_than:1d terms for DJDI, golf league, GHIN, handicap, Venmo, Zelle, buyin, buy-in, Mid-season major, and championship. | Matt's Venmo email was usable. Latest refresh still surfaced the unrelated `$110.00` Venmo with no DJDI buy-in context plus unrelated/non-DJDI golf-league and match-play emails; no additional DJDI buy-in proof was found. | Left 11 buy-ins outstanding. |
| [FACT] Calendar and Drive did not provide confirmed DJDI major/championship details. | Google Calendar searches for DJDI, golf league, Mid-season major, and Championship across the remaining 2026 window; Google Drive searches for DJDI and DJDI Golf Board; refreshed 2026-05-19. | Calendar DJDI/golf league/Mid-season major/Championship search returned no events. Drive DJDI search returned the Golf 2026 Knowledge Base/source map, not confirmed DJDI major or championship details. | Left the mid-season major and championship details as TBD. |
| [FACT] Local Messages could not be used as a source in this run. | Direct local read attempt against `~/Library/Messages/chat.db`. | macOS denied access with `authorization denied`. | Do not claim group-chat confirmation from Messages until access is granted or replies are pasted into Ops. |
| [INFERENCE] Remaining GHIN, payment, and schedule gaps likely require player replies, group-chat evidence, or commissioner confirmation. | Combined result of the Gmail, Calendar, Drive, local-file, and Messages checks above. | No additional direct evidence was available in the searched sources. | Keep the request packet and Ops tasks as the active path for those facts. |

## Open Items

The live app health audit passes, and local/remote mobile workflow proof
passes. Closeout is intentionally blocked by current league state, not by app
runtime failure. The open items are:

1. Score confirmation: six Stop 1 legacy scores need explicit attestation confirmation.
2. League data: `roster-ghin` - 6 missing handicap indexes.
3. League data: `money-collected` - `$3,575` outstanding.
4. League data: `schedule-confirmed` - 2 seeded events still have `TBD` details.
5. External device proof: `iphone-safari-gate` - physical iPhone Safari golden path not verified.

## Verified Proof

Latest source-search proof:

- `Gmail newer_than:1d league/payment search + Gmail newer_than:7d missing GHIN search + Calendar DJDI schedule search + Drive DJDI search`
- Status: passed
- Recorded: `2026-05-19T21:19:03.975Z`
- Verification run: `568d964f-55f2-400d-9e21-0e1c5b8399cd`
- Scope: refreshed source-search ledger; no new source-backed DJDI GHIN,
  buy-in, or major/championship schedule facts found; remaining data open items
  are still `roster-ghin`, `money-collected`, and `schedule-confirmed`. Gmail
  returned the same Matt Venmo proof plus unrelated/non-DJDI golf items;
  Calendar returned no DJDI events; Drive returned the Golf 2026 Knowledge
  Base/source map but no confirmed DJDI schedule facts.

Latest local verification proof:

- `npm run verify:all`
- Status: passed
- Completed: `2026-05-26T22:51Z`
- Scope: TypeScript check, full Vitest suite, production build, live-state
  audit, backup restore proof, persistence restart proof, production smoke,
  mobile UX smoke, Docker image smoke, dependency audit, and diff hygiene.
- Test count: `17 files / 141 tests passed`
- Docker image: `djdi-golf-board:codex-smoke`
- Result: `0 vulnerabilities`; diff hygiene checked `99` files.

Supporting focused proof from the same run:

- `npm run verify:live-state` passed with `12` members, `12` buy-in rows,
  `9` tournaments, `1` tee time, `6` score rule blockers, Stop 1 raw scores
  verified but attestation pending, Docker gate verified, and tailnet gate
  verified.
- `npm run verify:backup` passed with source and backup `quick_check: ok`.
- `npm run verify:persistence` passed with restart health
  `{"ok":true,"database":"ok"}`.
- `npm run verify:prod-smoke` passed with access gate, built client,
  production asset guard, commissioner launch check update, exports, and launch
  packet verified. It also verifies the completion-audit export, which now
  includes the `admin-surface-inventory` app-readiness item and the
  `phone-admin-proof` verification-ledger item. Latest focused run after the
  official-score-fix boundary update recorded verification run
  `840d52f0-2dda-4f32-baa0-6da283b4776e`.
- `npm test` passed after the official-score-fix boundary update with `17`
  files and `139` tests.
- `npm run lint` passed after the official-score-fix boundary update.
- `npm run verify:mobile-ux` passed at `390x844` with access gate, bottom nav,
  normal-player score status, post-round comment post/edit/delete, season
  standings, money, roster, Ops workflows, and non-iPhone launch-gate evidence
  helper verified. It also checks Admin map navigation, the visible Audit Log
  section, Audit JSON/CSV links, the simplified Admin export panel for launch
  status/checklist, verification ledger, completion CSV, archive manifest,
  database backup links, Stop 1 closeout packet/ledger links, and the
  evidence-oriented Admin task labels. Latest focused run after the
  official-score-fix boundary update recorded verification run
  `665139b0-9185-4d52-9872-6682922de07d`.
- Focused API proof: `npm test -- server.test.ts` passed with `45` tests,
  including roster handicap note storage/export, public roster redaction,
  fail-fast production asset checks, and commissioner-created host ownership
  boundaries for tee times and polls. The same ownership test also rejects
  same-name impostor host profiles from adding claims or maybes to a
  subject-bound hosted tee time, and rejects same-name impostor player profiles
  from moving an existing claim to maybe, maybe back to claimed, or changing an
  existing poll response. The score/closeout tests now also prove non-
  commissioner hosts cannot edit official scores, commissioner score fixes
  reset to pending, and reopened events still keep official-score fixes
  commissioner-only. The completion-audit test now also requires the
  `admin-surface-inventory` item with backup, export, and audit endpoints, plus
  the `phone-admin-proof` item when a remote-mobile verification row is recorded.
- `npm run verify:remote-mobile-ux` passed at `390x844` against
  `https://duckbookpro.clouded-tailor.ts.net` with access gate, client, health,
  locked player nav, normal-player score status, season, money, roster, and
  Ops verified. It also checks Admin map navigation, the visible Audit Log
  section, Audit JSON/CSV links, and clicked the Admin backup proof action and
  observed `Backup verified`; live mutations: one `backup_restore_verify` audit
  event and one remote-mobile verification-run row.

Previous full local verification proof:

- `npm run verify:all`
- Status: passed
- Completed during the latest commissioner-settings pass before the
  `2026-05-22T06:21:09Z` live export refresh
- Scope: TypeScript check, Vitest, production build, live-state verification,
  backup verification, persistence restart verification, production smoke,
  mobile UX including the Ops `Evidence path` callout, Commissioner Settings
  panel, visible dedicated Funnel command, evidence-gap export links, Docker
  smoke, npm audit, and `git diff --check`.
- Test count at that time: `16 files / 98 tests passed`

Latest Tailscale proof:

- `npm run verify:live-routing`
- Status: passed
- Completed: `2026-05-26T22:51Z`
- Scope: Tailscale Serve route `/` to `127.0.0.1:3131`, route `/djdi` to
  `127.0.0.1:3131`, route `/djdi-api` to `127.0.0.1:3131/api`, root title,
  health, direct Tailscale-IP health, and root, `/djdi`, and direct-IP access
  gates.

- `REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke`
- Status: passed
- Completed: `2026-05-26T22:51Z`
- Scope: protected tailnet HTTPS access, commissioner gate, client, health,
  season/readiness/closeout/audit/verification/archive/task/summary/CSV/launch
  packet exports.

- `REMOTE_MOBILE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_MOBILE_ACCESS_CODE=<code> REMOTE_MOBILE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-mobile-ux`
- Status: passed
- Completed: `2026-05-26T22:51Z`
- Scope: protected tailnet HTTPS access in a `390x844` mobile viewport, API base
  path, client, health, bottom nav, Season, Money, Roster, Ops, and Admin backup
  restore proof. The verifier writes one `backup_restore_verify` audit event and
  one `npm run verify:remote-mobile-ux` verification-run row, and now checks the
  visible Audit Log section, Audit JSON/CSV links, and Stop 1 closeout
  packet/ledger links in the simplified Admin export panel.
  Latest recorded run: `afe5048c-4a90-4b45-ae58-7025cf2a24e7`.

- `playwright-cli --session djdi-audit`
- Status: passed
- Completed: `2026-05-26T22:04Z`
- Scope: rendered live mobile browser at `390x844`, access-code unlock, normal
  player profile save, commissioner unlock with `test-admin`, Admin map
  rendering, corrected Admin section navigation, visible `Buy-in tracking`,
  visible `Audit Log` with recent audit events, and separate Audit JSON/CSV and
  Exports surfaces.

- `playwright-cli --session djdi-language`
- Status: passed
- Completed: `2026-05-26T21:56Z`
- Scope: rendered live mobile browser at `390x844`, access-code unlock, normal
  player profile save, locked player nav with only Board/Season/Roster,
  commissioner unlock with `test-admin`, Admin map rendering, visible
  `Buy-in tracking` heading, evidence-oriented Money/Roster open-item text, and
  visible Stop 1/2/3 closeout packet and ledger links.

- `playwright-cli --session djdi-live`
- Status: passed
- Completed: `2026-05-26T21:49Z`
- Scope: rendered live mobile browser at `390x844`, access-code unlock, normal
  player profile save, locked player nav with only Board/Season/Roster,
  commissioner unlock with `test-admin`, Admin map rendering, simplified export
  panel rendering, and visible Stop 1/2/3 closeout packet and ledger links.
  Screenshot: `output/playwright/djdi-live-admin-mobile-2026-05-26.png`.

- `agent-browser --session djdi-live-proof`
- Status: passed
- Completed: `2026-05-26T21:04Z`
- Scope: rendered live mobile browser at `390x844`, access-code unlock, normal
  player profile save, locked player nav with only Board/Season/Roster,
  commissioner unlock with `test-admin`, Ops/Admin map rendering, and console
  error check. Screenshots saved outside the repo at
  `/tmp/djdi-live-mobile-board.png`,
  `/tmp/djdi-live-mobile-season-after-click.png`, and
  `/tmp/djdi-live-mobile-commissioner.png`.

Previous stored tailnet proof:

- `npm run verify:tailnet`
- Status: passed
- Recorded: `2026-05-22T06:20:50.331Z`
- Verification run: `cf0924bf-6178-4b25-876c-2de625c82086`

Latest public production URL prerequisite proof:

- `npm run verify:deploy-prereqs`
- Status: failed
- Completed during the `2026-05-22T06:06Z` prerequisite check
- Scope: Fly CLI/auth, Tailscale Funnel fallback, public production URL
  prerequisites.
- Decision: Fly CLI is installed, but no Fly access token is available.
  `ACCESS_CODE` is configured. Tailscale is available through the macOS app
  binary, but the dedicated public Funnel fallback on
  `duckbookpro.clouded-tailor.ts.net:8443` is not configured because Funnel is
  not enabled for the DJDI route. No remote production URL is configured. The
  production URL gate remains open.

Latest documentation formatting proof:

- `git diff --check`
- Status: passed
- Completed: `2026-05-22T06:02Z`
- Scope: whitespace/conflict-marker check after refreshing this launch-status
  snapshot with the latest live export and tailnet verification timestamps.

Previous stored remote tailnet proof:

- `REMOTE_MOBILE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_MOBILE_ACCESS_CODE=<code> REMOTE_MOBILE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-mobile-ux`
- Status: passed
- Recorded inside verification run `f89b0757-626a-4545-bfff-a015f277e700`
- Scope: protected tailnet HTTPS access, mobile viewport, bottom navigation,
  Season, Money, Roster, Ops, inline launch checklist, export links, read-only.

- `REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke`
- Status: passed
- Recorded inside verification run `f89b0757-626a-4545-bfff-a015f277e700`
- Scope: protected tailnet HTTPS access, production dist server, remote smoke
  exports, launch packet, archive, completion audit.

Deploy prerequisite check is runnable but blocked on Fly authentication and
public Funnel enablement. The latest failed deploy-prereq run says Fly CLI and
local access-code config are present, but no Fly access token/session is
available on this machine, no dedicated public Funnel route exists on `:8443`,
and no remote production URL is configured.

The latest durable ledger now contains 105 verification-run rows.

## Do Not Claim Yet

Do not claim any of the following until the corresponding live export changes:

- All buy-ins are collected.
- All GHIN indexes are known.
- The major and championship schedule are finalized.
- A public or always-on production URL is live.
- Physical iPhone Safari has passed.
- The board is launch-complete.

## Useful Export Endpoints

- `/api/export/completion-audit.json`
- `/api/export/completion-audit.csv`
- `/api/export/readiness.json`
- `/api/export/tasks.json`
- `/api/export/tasks.csv`
- `/api/export/request-packet.txt`
- `/api/export/blocker-handoff.json`
- `/api/export/blocker-handoff.txt`
- `/api/export/evidence-gap-packet.json`
- `/api/export/evidence-gap-packet.csv`
- `/api/export/evidence-gap-packet.txt`
- `/api/export/source-search-ledger.json`
- `/api/export/source-search-ledger.csv`
- `/api/export/risks.json`
- `/api/export/risks.csv`
- `/api/export/launch-checks.json`
- `/api/export/launch-gate-checklist.json`
- `/api/export/launch-gate-checklist.csv`
- `/api/export/launch-gate-checklist.txt`
- `/api/export/verification-runs.json`
- `/api/export/archive.json`
