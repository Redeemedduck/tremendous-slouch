---
date: 2026-05-22
topic: djdi-functional-coordination-ghin
focus: no-new-service serving, tee-time coordination, league progress, GHIN/course-handicap trust
mode: repo-grounded
---

# Ideation: DJDI Fully Functional League Command System

## Grounding Context

**Codebase context:** DJDI Golf Board is already a React/Vite/TypeScript + Express + SQLite app with a mobile-first Board, Season, Money, Roster, and Ops split. The current product supports tee-time posting, claiming, maybe status, comments, calendar export, access-code gating, GHIN index/source notes, score entry with manual course handicap, attestation, standings, closeout packets, risk exports, launch gates, and one-paste intake. See [README.md](/Users/duck/Documents/GitHub/tremendous-slouch/README.md), [src/App.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/App.tsx:118), [src/components/TeeTimeCard.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/TeeTimeCard.tsx:28), [src/components/Roster.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/Roster.tsx:18), and [src/components/ScoresSheet.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/ScoresSheet.tsx:12).

**Serving context:** The repo already documents loopback local serving and Tailscale Serve for phone access without a public host. [TAILSCALE.md](/Users/duck/Documents/GitHub/tremendous-slouch/TAILSCALE.md) is the strongest current direction; [DEPLOY.md](/Users/duck/Documents/GitHub/tremendous-slouch/DEPLOY.md) is Fly-oriented and therefore less aligned with the user's "no new service signup" constraint.

**External context:** USGA says Course Handicap converts Handicap Index for a specific course/tee using `Handicap Index x (Slope Rating / 113) + (Course Rating - par)` ([USGA Course Handicap](https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/topics/course-handicap-and-playing-handicap.html)). USGA support documents GHIN app golfer lookup and Handicap Calculator flows where golfers can search by GHIN number/last name, choose course/holes/golfers/tees/allowance, and see Course Handicap plus Playing Handicap ([USGA support](https://usgasupport.zendesk.com/hc/en-us/articles/360041894451-Golfer-Lookup-Handicap-Calculator)). I did not find official public GHIN API documentation in USGA/GHIN sources during this pass, so direct background auto-pull should be treated as unproven unless an authorized integration is obtained.

**Access context:** Tailscale Serve shares a local service securely inside a tailnet ([Tailscale Serve docs](https://tailscale.com/kb/1242/tailscale-serve)). Tailscale Funnel can expose a local service publicly, but it is public on the configured port and has requirements/limitations ([Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel)). MDN documents installable PWAs via manifest; service workers are commonly used for offline behavior but are not strictly required for installability ([MDN PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)).

## Topic Axes

- No-new-service serving and access
- Tee-time coordination usability
- League progress and round closeout
- GHIN/course-handicap trust
- Commissioner recovery and proof

## Ranked Ideas

### 1. No-Signup Host/PWA Access Kit

**Description:** Make "run from Duck's existing machine, reachable on phones" a first-class product mode, not a support doc. The app should generate a Host panel with the live local URL, tailnet URL, access-code state, QR code, copyable group link, PWA add-to-home-screen prompt, backup age, host awake warning, and one-button verification run. This keeps the league off another hosting service while still feeling like a real app on phones.

**Axis:** No-new-service serving and access

**Basis:** `direct:` The repo already has local/Tailscale serving docs and verification scripts in [TAILSCALE.md](/Users/duck/Documents/GitHub/tremendous-slouch/TAILSCALE.md) and README; `external:` Tailscale Serve is intended to share a local service securely within a tailnet.

**Rationale:** The user wants no new service signup, but "just run this command" still leaves cognitive load and launch uncertainty. Turning host/access into an app surface gives players one stable path and gives the commissioner proof that the board is actually reachable.

**Downsides:** The host machine must stay awake/online. Whole-group use either requires adding players to the existing tailnet or using a public mode such as Funnel with clear exposure warnings.

**Confidence:** 92%

**Complexity:** Medium

**Status:** Unexplored

### 2. Trusted Handicap Engine

**Description:** Store GHIN number, Handicap Index, index source/date, course/tee/rating/slope/par, and compute the day's Course Handicap locally using the USGA formula. Score entry should prefill course handicaps for claimed players, flag stale/missing indexes, and require an evidence note only when overriding the calculated value. If official GHIN API access becomes available later, it can plug into this same evidence model; until then, GHIN app lookup/screenshots/text replies remain the source of truth.

**Axis:** GHIN/course-handicap trust

**Basis:** `direct:` Current roster stores handicap index and source, while score entry manually asks for Course HCP in [src/components/Roster.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/Roster.tsx:338) and [src/components/ScoresSheet.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/ScoresSheet.tsx:346). `external:` USGA publishes the Course Handicap formula and GHIN app calculator workflow.

**Rationale:** This satisfies the spirit of "GHIN number auto-pull course handicap" without pretending an unauthorized API exists. The app becomes faster and more defensible: users enter/verify index and tee data once, then the score sheet does the math transparently.

**Downsides:** The app still needs current Handicap Index evidence unless an authorized GHIN integration exists. Course/tee rating data must be curated and audited.

**Confidence:** 88%

**Complexity:** High

**Status:** Unexplored

### 3. Round Captain Cockpit

**Description:** Treat each tee time as a mini-event with a captain, RSVP deadline, lifecycle state, waitlist, confirmation buttons, score responsibility, and copyable reminder text. Captains can lock a group before play, see missing GHIN/course-handicap inputs, collect scores after play, and hand off any unresolved blocker to Ops.

**Axis:** Tee-time coordination usability

**Basis:** `direct:` Tee-time cards already support claim/maybe/drop/comments/calendar but do not model captain ownership, deadlines, waitlists, or lifecycle beyond basic league/scored badges in [src/components/TeeTimeCard.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/TeeTimeCard.tsx:64).

**Rationale:** Friend-group coordination fails when ownership is implicit. A captain model spreads commissioner burden, makes every round accountable, and connects coordination directly to score closeout.

**Downsides:** Adds a role concept and more states. Needs careful UI so players still see simple "Join / Maybe / Score" actions.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 4. Player Command Home

**Description:** Replace the generic first impression with a per-player "today/next action" home: your next tee time, whether you are in/maybe/waitlisted, missing GHIN or buy-in tasks, current tournament, standings movement, and score/attester actions. Commissioner-only risks stay visible but normal players see their own short list.

**Axis:** League progress and round closeout

**Basis:** `direct:` The current Command Center summarizes next tee time, open spots, maybe count, and top launch risk in [src/components/CommandCenter.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/CommandCenter.tsx:20), but it is not yet player-personalized.

**Rationale:** Player adoption improves when the app answers "what do I need to do?" immediately. This also reduces group-chat confusion because the app points each player to the exact next action.

**Downsides:** Requires stronger profile identity and a careful split between player and commissioner views.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 5. SMS Bridge Without Service Signup

**Description:** Build a service-free communication bridge: the app generates compact SMS/iMessage-ready packets for tee times, GHIN asks, payment reminders, score closeout, and schedule confirmations, then ingests pasted replies into a triage inbox. No Twilio, no new account, no outbound automation; the group chat remains the notification layer while the app remains canonical.

**Axis:** Tee-time coordination usability

**Basis:** `direct:` The app already has bulk reply intake and one-paste Ops intake; the memory/repo context shows combined GHIN/payment replies need careful parsing. `reasoned:` SMS is already where the league coordinates, so meeting users there without adding a service is lower-friction than forcing a notification platform.

**Rationale:** This is the highest-leverage creative move that avoids service signup. It respects the group's existing behavior but makes the app the state engine instead of another thing to maintain manually.

**Downsides:** Still relies on the commissioner or captain pasting replies. Clipboard/browser permissions vary, so fallback text areas must remain.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 6. League Progress Story

**Description:** Turn standings from a table into a race narrative: active stop, current leader, still-to-score list, points available, playoff bubble, seed movement, remaining stops, and "what changed since last visit." Keep the table, but make the season feel alive at a glance.

**Axis:** League progress and round closeout

**Basis:** `direct:` Standings already compute season points and top-four seed badges in [src/lib/standings.ts](/Users/duck/Documents/GitHub/tremendous-slouch/src/lib/standings.ts:63) and [src/components/Standings.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/Standings.tsx:15). Season cards already show tournament windows and leaderboards in [src/components/SeasonSchedule.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/SeasonSchedule.tsx:45).

**Rationale:** League progress is not just accuracy; it is motivation. Bubble/scenario language gives guys a reason to open the app between rounds and understand why score closeout matters.

**Downsides:** Scenario math can become noisy if too detailed. It should start with a few high-signal bullets, not a simulator.

**Confidence:** 80%

**Complexity:** Medium

**Status:** Unexplored

### 7. Commissioner Recovery Kit

**Description:** Add an Ops recovery surface that packages backup/restore, host transfer, current DB path, last verified tailnet URL, access-code state, stale-doc warnings, and a one-page launch proof. The goal is that if the host laptop dies or the commissioner is overloaded, another machine can take over without reconstructing the league from memory.

**Axis:** Commissioner recovery and proof

**Basis:** `direct:` The repo already has backup, persistence, live-state, Docker, tailnet, remote smoke, readiness, launch-check, and archive/export tooling documented in [README.md](/Users/duck/Documents/GitHub/tremendous-slouch/README.md), plus Ops evidence surfaces. `reasoned:` A no-new-service host model makes recovery more important because one physical machine becomes operationally load-bearing.

**Rationale:** This protects the whole system from the main downside of local/tailnet hosting. It also matches the app's existing evidence-first character.

**Downsides:** Some proof still requires physical-device verification. Restore UX must be conservative to avoid accidental live DB overwrite.

**Confidence:** 78%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | No-signup host mode | Merged into stronger Idea 1. |
| 2 | Host health banner | Merged into stronger Idea 1. |
| 3 | Round Day cockpit | Merged into Ideas 3 and 4. |
| 4 | Captain workflow | Merged into stronger Idea 3. |
| 5 | RSVP deadline states | Merged into stronger Idea 3. |
| 6 | Course/tee data library | Merged into stronger Idea 2. |
| 7 | Handicap freshness indicator | Merged into stronger Idea 2. |
| 8 | Score-entry prefill | Merged into stronger Idea 2. |
| 10 | Paste-back packets per tee time | Merged into stronger Idea 5. |
| 11 | Roster verify-all GHIN sheet | Useful variant of Idea 2; not separate enough. |
| 12 | Commissioner host appliance scripts | Merged into Ideas 1 and 7. |
| 13 | Structured stop details | Supporting requirement for Ideas 2, 3, and 6; not top-level enough. |
| 14 | Single inbox triage | Merged into stronger Idea 5. |
| 15 | Ranked preferences | Good tactical add-on for Idea 3; below ambition floor alone. |
| 16 | Closeout preview | Already partly covered by Ops/closeout surfaces; merged into Ideas 3 and 6. |
| 17 | League operating room framing | Product principle, not a standalone feature. |
| 18 | GHIN as evidence capture + local math | Merged into stronger Idea 2. |
| 19 | SMS as notification layer | Merged into stronger Idea 5. |
| 20 | Tee time as mini-event | Merged into stronger Idea 3. |
| 21 | Home as today/next action | Merged into stronger Idea 4. |
| 22 | Standings as race story | Merged into stronger Idea 6. |
| 23 | Evidence objects for screenshots/replies | Merged into Ideas 2 and 5. |
| 24 | Host availability as dependency | Merged into Ideas 1 and 7. |
| 25 | Course/tee table leverage | Merged into stronger Idea 2. |
| 26 | PWA manifest/offline shell | Merged into stronger Idea 1. |
| 27 | Share/ingest architecture | Merged into stronger Idea 5. |
| 28 | Handicap calculation audit types | Merged into stronger Idea 2. |
| 29 | Current stop domain object | Supporting architecture for Ideas 4 and 6; not user-facing enough alone. |
| 30 | Role-lite permissions | Supporting requirement for Ideas 3 and 4; too large alone without workflow anchor. |
| 31 | Snapshot digests | Merged into Ideas 4 and 6. |
| 32 | Backup/export restore UI | Merged into stronger Idea 7. |
| 33 | Airline gate board analogy | Merged into stronger Idea 3. |
| 34 | Dispatch board analogy | Merged into stronger Idea 3. |
| 35 | Fantasy matchup center analogy | Merged into stronger Idea 6. |
| 36 | Tournament scoring tent analogy | Merged into Ideas 2, 3, and 6. |
| 37 | Home-server admin panel analogy | Merged into Ideas 1 and 7. |
| 38 | Medical reconciliation analogy | Merged into Ideas 2 and 5. |
| 39 | Offline field form | Useful later; lower priority until core PWA/access kit exists. |
| 40 | Check-in desk | Good variant of Idea 3; not separate enough. |
| 41 | Zero-service deployment | Merged into stronger Idea 1. |
| 42 | Three-button player UX | Principle for Idea 4; too vague alone. |
| 43 | Zero commissioner chasing | Merged into stronger Idea 5. |
| 44 | One-minute closeout | Merged into Ideas 3 and 6. |
| 45 | One-device failure tolerance | Merged into stronger Idea 7. |
| 46 | One-GHIN-input ideal | Merged into stronger Idea 2. |
| 47 | One-stop dashboard | Merged into Ideas 4 and 6. |
| 48 | One-page launch proof | Merged into Ideas 1 and 7. |
| - | Public SaaS-first deployment | Violates the no-new-service primary constraint. |
| - | Twilio/SMS automation | Requires another service signup and ongoing dependency. |
| - | Unofficial GHIN scraping | Unjustified: no official source found to support it, and it would create trust/security risk. |
| - | Pure LAN-only sharing | Useful fallback, but too fragile for phones away from the same network. |
| - | Generic AI golf coach | Subject-replacement; not tee-time coordination or league operations. |
| - | Weather/GPS/maps expansion | External dependency and lower leverage than coordination/handicap correctness. |
| - | Standalone native mobile app | Too expensive relative to PWA/tailnet value for this group. |
