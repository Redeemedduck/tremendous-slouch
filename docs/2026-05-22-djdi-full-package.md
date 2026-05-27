# DJDI Golf Board Full Package

Date: 2026-05-22

## The Correction

The "copyable group chat" idea should not be the center of the product. It is a fallback bridge for one constraint: the league already coordinates in texts, and the user does not want another service signup for automated messaging.

The real package is this:

**DJDI Golf Board becomes a private, phone-first league command center that can run from an existing machine, coordinate tee times cleanly, compute defensible course handicaps, show league progress, and survive commissioner/host friction.**

The communication bridge is renamed:

**No-Service Coordination Bridge**

It means:

- The app remains the source of truth.
- Text messages remain a convenient notification/reply channel.
- The app can produce short share text when useful.
- Hosts/commissioner can paste replies back when useful.
- No Twilio, no new SMS provider, no extra account, no pretend automation.

## Package Recommendation

Build one integrated package called:

**DJDI League Command Pack**

It has five parts:

1. Verified Player Access Gate
2. Handicap Provenance Engine
3. Player Score And Attest Flow
4. Host Round Flow
5. League Story And Recovery Hardening

The package should make the app feel finished without requiring a public SaaS deploy, but the no-service path is a gate, not a guarantee. If the host machine, Tailscale access, physical iPhone proof, access-code protection, and backup/restore proof do not pass, the recommendation flips to a public always-on path such as Funnel, VPS, Fly, or equivalent.

## Red-Team Corrections

The agent swarm found two P0 corrections and several P1 corrections. These supersede the optimistic first-pass package where they conflict.

### P0: Separate Player, Host, And Commissioner Modes

Normal players must not get commissioner-grade controls just because they know the shared access code.

Required model:

- `player`: Player Home, join/maybe/drop, own score entry, visible attest actions, limited read-only league views.
- `host`: player permissions plus controls for tee times they host.
- `commissioner`: Ops, Money, Roster mutation, launch checks, raw exports, database backup, recovery packet, settings.

Default phones should land in Player Home. Commissioner tools should require a commissioner unlock separate from the group access code.

### P0: Treat No-Service Hosting As A Decision Gate

No-service hosting is preferred only if these pass:

- Host machine is awake/always-on for league use.
- Tailscale Serve route is active and verified.
- Players either accept tailnet access or a deliberate public mode is chosen.
- `ACCESS_CODE` is set.
- Public/Funnel mode, if used, has high-entropy code, shorter cookie TTL, rate limiting/lockout, and rotation.
- Physical iPhone Safari access is proven.
- Backup download and restore-check are proven.

If any of those fail, the access recommendation changes to an always-on public host or a hardened Funnel path.

### P1: Move Minimal Player Home And Recovery Into The First Slice

The app cannot prove group readiness with only host mechanics. Slice 1 must include:

- Roster-bound identity.
- Minimal Player Home.
- Commissioner unlock.
- Host access status.
- Minimum backup/restore proof.

### P1: Do Not Call Handicap Math Trusted Until Provenance Exists

The Handicap Engine must store source tier, verified date/by, course/tee inputs, formula version, calculated value, rounded value, stale flags, and override evidence before it can be used as closeout-grade truth.

### P1: Start With Tee-Time Host Controls

Host controls means the existing tee-time host, not a new role. Start with derived statuses and three actions: confirm group, copy update, record scores. Waitlists, explicit locking, and promotion controls come later only if the simple flow proves insufficient.

## 1. Access Pack

Purpose: serve the app without signing up for another hosting service.

The app should expose a host/readiness surface in Ops:

- Local URL
- Tailnet URL
- Access-code status
- QR code for the current app URL
- PWA install readiness
- Last tailnet verification
- Last backup verification
- DB path
- Host machine warning: "This board is reachable only while this machine is awake."
- One action to record host proof into launch checks
- One action to download a transfer packet

Recommended serving model:

- Candidate primary: existing local machine plus Tailscale Serve, only after the no-service gate passes.
- Group access: invite players to the existing tailnet only if they will actually accept that workflow.
- Fallback public access: Tailscale Funnel only with public-mode hardening and commissioner-only protections.
- Flip path: if host uptime, tailnet acceptance, physical iPhone proof, or backup/restore proof fails, use an always-on public host instead of pretending the local path is ready.

Definition of done:

- A guy can open the app from his phone from one URL.
- The commissioner can see whether the URL was actually verified.
- The app can be installed to the phone home screen as a PWA-style web app.
- A non-technical person can tell whether the host path is healthy.

## 2. Player Home

Purpose: make the first screen answer "what do I need to do?"

Replace the generic command-center feeling with a player-specific home:

- My next tee time
- My status: in, maybe, waitlisted, out
- My missing actions: GHIN, payment, score, attestation
- Current tournament
- Current standing and seed/bubble status
- Next available tee time with open spots
- Recent change since last visit
- One-tap actions: Join, Maybe, Drop, Score, Attest

The commissioner still gets Ops risks, but normal players should mostly see their own tasks and the league race.

Definition of done:

- A player can open the app and know what to do in under 10 seconds.
- No player has to inspect Ops to understand their own situation.
- League progress is visible without reading exports.

## 3. Tee-Time Host Controls

Purpose: stop tee times from being loose cards that depend on one commissioner.

This is not a new social role. It is just the person already listed as the tee-time host in the app. Host controls ship first: derived status, confirm group, copy update, and record scores. A fuller lifecycle only ships after the simple flow proves insufficient.

The eventual lifecycle can be:

- Open
- Forming
- Confirmed
- Locked
- Needs scores
- Complete

Each tee time can have:

- Host
- RSVP deadline
- Waitlist
- Tee/course/tee-box selection
- Claimed players
- Maybe players
- Missing GHIN/course-handicap flags
- Score-entry owner
- Attestation completeness

Player actions stay simple:

- Join
- Maybe
- Drop
- Score
- Attest

Host actions:

- Confirm group
- Move maybe to in
- Promote waitlist
- Lock group
- Copy/share a short update
- Open score sheet
- Send unresolved blockers to Ops

Definition of done:

- Tee-time cards show status without reading comments.
- The host knows who still needs to respond.
- Scores and attestations are connected to the tee-time lifecycle.
- The commissioner is not the only person who can close a round cleanly.

## 4. Handicap Engine

Purpose: make day-of-round course handicaps fast and defensible.

Do not build unauthorized GHIN scraping.

Instead, build a provenance-first local handicap engine:

Player fields:

- GHIN number
- Handicap Index
- Index source
- Index verified date
- Index verified by
- Stale flag

Course/tee fields:

- Course
- Tee name
- Gender/side if needed
- Holes: 9 or 18
- Par
- Course Rating
- Slope Rating
- Source
- Updated date

Round calculation:

```text
Course Handicap = Handicap Index x (Slope Rating / 113) + (Course Rating - Par)
```

Score entry behavior:

- If player index and tee data exist, prefill Course Handicap.
- If data is missing, show the exact missing field.
- If the commissioner overrides the calculated Course Handicap, require an override source/note.
- Store calculated value, formula inputs, source, and override status with the score.

GHIN reality:

- GHIN number alone should not be treated as enough unless an authorized GHIN lookup is available.
- The app can store GHIN number and help verify the index through GHIN app lookup, screenshot, text reply, or commissioner note.
- If an official/authorized GHIN integration becomes available, it should plug into this model rather than replace it.

Definition of done:

- League score entry no longer requires manually typing Course HCP for every player when course/tee data exists.
- Every net score can explain which index, tee, rating, slope, and par produced it.
- Stale or overridden handicap values are visible in closeout evidence.

## 5. Commissioner Recovery

Purpose: make local/private hosting safe enough to trust.

Ops should include a recovery kit:

- Download current SQLite backup
- Restore-check latest backup
- Export current app state manifest
- Show DB path and DB size
- Show last backup verification
- Show last tailnet verification
- Show access-code status
- Show current host URL
- Show launch proof status
- Produce host-transfer packet

Host-transfer packet includes:

- App version/build timestamp
- DB backup
- Restore instructions
- Required env vars
- Access-code status, without exposing secret value
- Tailnet/public URL status
- Open launch blockers
- Current unpaid/GHIN/schedule blockers

Definition of done:

- If the host machine fails, another machine can take over from a backup.
- The commissioner can prove the app is not just running, but recoverable.
- The launch status stops depending on memory.

## No-Service Coordination Bridge

This is a support feature, not the product center.

Where it belongs:

- Inside tee-time cards for host updates.
- Inside Player Home for "ask me for missing GHIN/payment/score."
- Inside Ops for unresolved blocker packets.

What it does:

- Generates concise text snippets for the existing group chat.
- Parses pasted replies into the app.
- Keeps extracted values reviewable before applying.
- Preserves the pasted line as evidence.

What it does not do:

- It does not send texts automatically.
- It does not require Twilio or another service.
- It does not replace the app.
- It does not treat a text reply as truth without review when money or handicap evidence matters.

Example use:

```text
DJDI - CommonGround Sat 8:10
In: Jayson, Jonny, Kyle
Open: 1
Maybe: Sam
Needed before lock: Chris GHIN, Beck payment
Board: https://...
```

This is useful because it meets the group where they already are, but the canonical state remains inside DJDI Golf Board.

## Corrected Build Order

### Slice 1: Verified Player Access Gate

Build the smallest complete loop that proves real players can use the board safely.

Deliver:

- Roster-bound identity
- Player/host/commissioner modes
- Commissioner unlock separate from group access
- Minimal Player Home: next tee time, my action, my missing blockers, one primary action
- Host status panel with URL mode labels: loopback, tailnet-only, public Funnel
- PWA manifest
- Physical iPhone Safari proof gate
- Backup download and restore-check status
- DB path/size
- Host-transfer export skeleton, commissioner-only

Why first:

- The app cannot be useful to the group until access is easy.
- It directly satisfies "serve without signing up for another service."
- It prevents normal players from seeing commissioner-grade tools.
- It proves the local/private host can recover.

### Slice 2: Handicap Provenance Engine

Deliver:

- GHIN number field
- Index verified date/source/by
- Handicap source tiers: official GHIN/CGA, screenshot, text reply, commissioner note
- Course/tee table
- Course Handicap calculator
- Immutable score provenance snapshot: index, tee, rating, slope, par, holes, formula version, calculated value, rounded value
- Stale and low-trust flags
- Override evidence
- Tests for formula and score storage

Why second:

- Course handicap accuracy affects every league result.
- It removes real day-of-round friction.

### Slice 3: Player Score And Attest Flow

Deliver:

- Player own-score entry
- Visible attestation pending action
- Host/commissioner group score sheet
- Course Handicap prefill from Slice 2
- Closeout flags for stale, low-trust, or overridden net scores

Why third:

- The highest-friction league action after joining a tee time is getting scores and attestations closed cleanly.

### Slice 4: Host Round Flow

Deliver:

- Existing tee-time host owns the simple host controls
- Derived statuses: Open, You're in, Group confirmed, Needs scores, Complete
- Confirm group
- Copy update
- Record scores
- Server-enforced locked/complete semantics only if explicit locking ships

Why fourth:

- It turns the board into coordination without forcing a heavy state machine first.

### Slice 5: League Story And Recovery Hardening

Deliver:

- League-race card: my rank/seed, leader, bubble target, last score impact
- Standings movement
- Changed-since-last-visit
- Redacted recovery packet
- Rich transfer manifest
- Backup retention/deletion guidance
- Stale-doc/config warnings

Why fifth:

- The minimum recovery proof already shipped in Slice 1; this hardens and explains it.

## Data Model Additions

Likely new tables:

- `course_tees`
- `handicap_verifications`
- `round_handicap_calculations`
- `tee_time_lifecycle_events`
- `host_verifications`
- `backup_verifications`

Likely tee-time columns:

- existing `host` field remains the tee-time owner; add a separate field only if host responsibility must differ from the person who posted the tee time
- `rsvp_deadline`
- `status`
- `tee_id`

Likely player columns:

- `ghin_number`
- `handicap_verified_at`
- `handicap_verified_by`

Likely score additions:

- `course_handicap_source`
- `course_handicap_formula_inputs`
- `course_handicap_overridden`
- `course_handicap_override_note`

## Product Principles

- The app is the source of truth.
- Text is a bridge, not a database.
- No automatic GHIN claims without authorized data access.
- Every net score should be explainable.
- Players get simple actions.
- Commissioners get proof and recovery.
- No-new-service is a first-class path, not a compromise.

## What "Better" Means

The app is better when:

- A guy can join a tee time in one tap.
- A host can confirm a foursome without hunting through comments.
- A score can be entered with prefilled Course Handicap.
- A standings change is obvious after scores are posted.
- The commissioner can see every unresolved blocker in one place.
- The app can be reached on phones without a new hosting service.
- The league can recover if the host machine changes.

## Non-Goals

- No unofficial GHIN scraping.
- No Twilio or paid SMS automation as the primary path.
- No public hosting signup as the primary path.
- No native mobile app until the web/PWA path proves insufficient.
- No AI coaching layer.
- No weather/GPS/maps dependency in the core package.
