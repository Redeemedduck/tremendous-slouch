# DJDI Full Package Red-Team Review

Date: 2026-05-22

Reviewed document: [docs/2026-05-22-djdi-full-package.md](/Users/duck/Documents/GitHub/tremendous-slouch/docs/2026-05-22-djdi-full-package.md)

## Verdict

The package is buildable on the current React + Express + SQLite app, but the original version was too optimistic in three places:

1. It treated no-service hosting as the preferred answer before proving players can actually reach and use it.
2. It assumed player-specific workflows without a real identity/role boundary.
3. It called the handicap engine "trusted" before defining evidence classes, stale handling, and immutable score provenance.

The corrected package should be:

**Verified player access + role separation first, handicap provenance second, tee-time host controls third.**

## P0 Findings

### P0: Normal Players Currently Have Commissioner-Grade Controls

Evidence:

- The package defines Player Home, Host Controls, and Commissioner Recovery as separate concepts, but the current app exposes `Money`, `Roster`, and `Ops` to everyone with the shared access code.
- [src/App.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/App.tsx:725) renders the bottom navigation for all app users.
- [src/components/Roster.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/Roster.tsx:321) allows member/guest toggles.
- [src/components/Finances.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/Finances.tsx:278) allows buy-in paid/owed changes.
- [src/hooks/useMyProfile.ts](/Users/duck/Documents/GitHub/tremendous-slouch/src/hooks/useMyProfile.ts:17) uses localStorage identity, not authenticated player identity.

Impact:

Player Home, Host Controls, and no-service public/tailnet sharing all become risky if every user can mutate commissioner data.

Required correction:

- Add explicit `player`, `host`, and `commissioner` modes.
- Default phones to Player Home.
- Show host controls only for assigned tee times.
- Require commissioner unlock for Ops, Money, Roster mutation, exports, database backup, launch checks, and recovery packet.

### P0: No-Service Hosting Was Treated As Primary Without Exit Criteria

Evidence:

- The package recommends existing machine + Tailscale Serve as primary access in [docs/2026-05-22-djdi-full-package.md](/Users/duck/Documents/GitHub/tremendous-slouch/docs/2026-05-22-djdi-full-package.md:59).
- [docs/2026-05-19-launch-status.md](/Users/duck/Documents/GitHub/tremendous-slouch/docs/2026-05-19-launch-status.md:36) says the tailnet URL depends on this machine and Tailscale Serve.
- [README.md](/Users/duck/Documents/GitHub/tremendous-slouch/README.md:306) says group use needs the app somewhere always on.

Impact:

If players refuse Tailscale, the host laptop sleeps, Funnel is not enabled, or physical iPhone Safari fails, the no-service strategy fails even if the app code is good.

Required correction:

Make Access Pack a decision gate:

- Host awake/always-on proof
- Tailscale group acceptance proof or explicit public-mode decision
- `ACCESS_CODE` set
- Tailnet smoke passed
- Physical iPhone Safari passed
- Backup/restore passed

If any fail, the recommendation flips to a public always-on path: Funnel with hard security, VPS, Fly, or equivalent.

## P1 Findings

### P1: Player Home Is The Adoption Surface And Cannot Wait Until Slice 4

Evidence:

- The package says Player Home should answer "what do I need to do?" in [docs/2026-05-22-djdi-full-package.md](/Users/duck/Documents/GitHub/tremendous-slouch/docs/2026-05-22-djdi-full-package.md:73).
- The original build order delayed Player Home until Slice 4.
- The current app renders a global Command Center first at [src/App.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/App.tsx:358).

Correction:

Move a minimal Player Home into the first build slice:

- My next tee time
- My action
- My missing GHIN/payment/score/attestation
- League-race card
- One primary action

### P1: Identity Is Load-Bearing And Missing

Evidence:

- The package depends on "My status" and "My missing actions."
- Current access is shared-code cookie only in [server.ts](/Users/duck/Documents/GitHub/tremendous-slouch/server.ts:897).
- Current profile selection lets a user type any name in [src/components/NamePromptInline.tsx](/Users/duck/Documents/GitHub/tremendous-slouch/src/components/NamePromptInline.tsx:14).

Correction:

Add lightweight identity before player-specific workflows:

- Roster-bound profile selection
- Optional per-player PIN or commissioner-issued player link
- Device memory
- Audit labels separating self-service edits from commissioner edits
- No automatic member promotion from first-run profile

### P1: Funnel/Public Mode Cannot Use A Friendly Shared Code

Evidence:

- The package allows Funnel with access code in [docs/2026-05-22-djdi-full-package.md](/Users/duck/Documents/GitHub/tremendous-slouch/docs/2026-05-22-djdi-full-package.md:63).
- [DEPLOY.md](/Users/duck/Documents/GitHub/tremendous-slouch/DEPLOY.md:58) currently suggests a memorable inside-joke phrase.
- [server.ts](/Users/duck/Documents/GitHub/tremendous-slouch/server.ts:901) stores the access cookie for one year.

Correction:

Public/Funnel mode requires:

- High-entropy access code
- Shorter cookie TTL
- Rate limiting or lockout
- Rotation path
- Commissioner-only gate for Ops, exports, backups, and recovery
- No public QR/share if access code is unset

### P1: Raw Database Backup Is The Highest-Risk Artifact

Evidence:

- The package includes current SQLite backup and DB backup in the transfer packet.
- [server.ts](/Users/duck/Documents/GitHub/tremendous-slouch/server.ts:5578) exposes `/api/export/database`.

Correction:

- Treat raw DB backup as commissioner-only.
- Provide redacted handoff separately.
- Add retention/deletion guidance.
- Do not include raw DB in group-facing packets.
- Protect backup/recovery behind commissioner unlock.

### P1: Handicap Engine Needs Provenance Schema Before UI

Evidence:

- Current `Score` only stores `name`, `gross`, `courseHcp`, `attestedBy`, and `recordedAt` in [src/lib/types.ts](/Users/duck/Documents/GitHub/tremendous-slouch/src/lib/types.ts:12).
- Server stores scores inside the `tee_times` JSON array at [server.ts](/Users/duck/Documents/GitHub/tremendous-slouch/server.ts:2209).

Correction:

Before prefill UI, store:

- Handicap Index used
- Index source tier
- Index verified date/by
- Tee rating, slope, par, holes
- Formula version
- Calculated Course Handicap
- Rounded value
- Override flag and note
- Stale/low-trust flags

Closeout should flag stale, low-trust, or overridden net scores.

### P1: Tee-Time Host Controls Should Stay Plain

Evidence:

- Original package added six lifecycle states, host, RSVP deadline, waitlist, score owner, blockers, and attestation completeness.
- Current tee-time card is simpler: host, claims, maybe, comments, claim/maybe/drop, host edit/delete/record scores.

Correction:

Start with plain tee-time host controls:

- The existing tee-time host owns the simple controls
- Derived statuses only
- Visible player actions stay `Join`, `Maybe`, `Drop`, `Score`, `Attest`
- Host actions are only `Confirm group`, `Copy update`, and `Record scores`
- Add explicit waitlist/lock/promote controls only after usage proves they are needed.

### P1: Recovery Cannot Be Slice 5

Evidence:

- Local/private hosting depends on recoverability.
- The original package delayed Recovery Kit until Slice 5.

Correction:

Move minimum recovery into Slice 1:

- DB path
- DB size
- Backup download
- Restore-check timestamp
- Host-transfer packet
- Proof that a restored DB can open on another runtime

## P2 Findings

### P2: PWA Readiness Is Not Present Yet

Evidence:

- The package includes PWA install readiness.
- `index.html` has theme color and favicon but no manifest/service worker path.

Correction:

Make PWA a launch gate:

- Manifest
- Icons
- Apple touch metadata
- Display mode
- Start URL
- Access-code behavior
- Physical iPhone Safari install/open proof

### P2: Pre-Auth Access Status Leaks Launch Evidence

Evidence:

- [server.ts](/Users/duck/Documents/GitHub/tremendous-slouch/server.ts:2443) exposes `/api/access` before `requireAccess`.
- It currently returns launch checks and evidence.

Correction:

Pre-auth `/api/access` should return only generic app/access state. Tailnet URL, Funnel URL, hostnames, notes, and verification evidence require auth.

### P2: GHIN And Payment Evidence Need Data Minimization

Evidence:

- The package adds GHIN number and screenshot/text evidence.
- The text bridge preserves pasted lines.

Correction:

- Prefer masked GHIN last 4 or source type over full GHIN number in group-facing surfaces.
- Do not store screenshots in SQLite without an explicit retention rule.
- Redact GHIN numbers from exports visible to players.
- Do not store Venmo/Zelle handles or transaction IDs in group-facing exports.
- Use source category/date/collector for player-visible payment status.

### P2: Standings Story Is Hidden

Evidence:

- Success says standings change should be obvious.
- Current Standings and Season panels start collapsed.

Correction:

Add a small league-race card to Player Home:

- My rank/seed
- Leader
- Next bubble target
- Last score impact

## Corrected Build Order

### Slice 1: Verified Player Access Gate

Deliver:

- Role model: player/host/commissioner
- Roster-bound identity
- Commissioner unlock
- Minimal Player Home
- Host access status
- Tailnet/public mode labeling
- Minimum backup/restore proof
- PWA manifest and physical iPhone proof

### Slice 2: Handicap Provenance Engine

Deliver:

- Course/tee table
- Handicap source tiers
- Formula calculation records
- Score provenance snapshot
- Stale/override flags
- Closeout risk flags

### Slice 3: Player Score And Attest Flow

Deliver:

- Player own-score entry
- Visible attestation pending action
- Host/commissioner group score sheet
- Course Handicap prefill from provenance engine

### Slice 4: Host Round Flow

Deliver:

- Existing tee-time host owns the simple host controls
- Derived round statuses
- Confirm group
- Copy update
- Record scores
- Server-enforced locked/complete semantics only if locking is actually introduced

### Slice 5: League Story And Recovery Hardening

Deliver:

- League-race card
- Standings movement
- Changed-since-last-visit
- Redacted recovery packet
- Richer transfer manifest

## Changes To Carry Forward

- Do not present no-service hosting as automatically better. Present it as a gate that can fail.
- Do not ship player-specific workflows without player identity.
- Do not expose commissioner controls to normal players.
- Do not call handicap math trusted until provenance is stored.
- Do not treat raw DB backups as group artifacts.
- Do not make tee-time host controls a full state machine before proving the simple host flow is insufficient.
