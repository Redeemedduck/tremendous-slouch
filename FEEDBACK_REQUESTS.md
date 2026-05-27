# Feedback & Visuals Requests

Hand this to whoever's helping with visual / copy review for **DJDI Golf
Board**. The app is a shared web app for the 2026 DJDI summer golf league
— coordination, scoring, season standings, post-season bracket, buy-in
pool. Mobile-first.

Most of what you need to evaluate is already captured in
[`SCREENSHOTS.md`](./SCREENSHOTS.md): core mobile shots at iPhone 14 Pro
viewport plus current Ops proof images. Look at those first.

## How to run it yourself

```sh
npm install
npm run start:prod
# open http://localhost:3000 on the same machine
```

To view from a phone on the same Wi-Fi:

- **Tailscale** (recommended; no network changes needed): see
  [`TAILSCALE.md`](./TAILSCALE.md). `tailscale serve --bg --https=443
  http://localhost:3000` then open `https://<hostname>.<tailnet>.ts.net`
  on the phone.
- **LAN-direct**: set `HOST=0.0.0.0 npm run start` and open
  `http://<laptop-ip>:3000` from the phone. Less secure.

## What to look at

### 1. Mobile feel (highest priority)

Open the app on a real phone via the steps above. Look at:

- **Bottom-sheet height + safe-area padding** on iOS — the New Tee Time,
  New Poll, Profile, and Record Scores sheets should not clip at the
  bottom. They should scroll inside the sheet when the keyboard is up.
- **FAB position** (the green `+` bottom-right) — should not cover any
  card content; rotates to `×` when its chooser is open.
- **Chip tap targets** — player chips, score rows, finance Paid/Owed
  pills, poll option cards. Should all feel finger-sized.
- **Sticky header backdrop blur** when scrolling.
- **Native date/time/number pickers** in the form sheets.

### 2. Information density on tee-time cards

The tee-time card carries a lot when fully populated: date row, course,
hosted-by, optional notes, spots indicator, calendar link, player chips,
maybe chips, scores block, and comments. Does it feel readable or
overpacked? Are there sections worth collapsing by default?

### 3. League-specific panels

These are the panels added on top of the original coordination layer:

- **Season** schedule (collapsed by default)
- **Roster** (Member vs Guest toggles)
- **Pool** (buy-in tracker)
- **Standings** (default sort = season points, with seed badges)
- **Ops** (commissioner readiness, open tasks, launch gates, closeout packets,
  exports, and bulk reply intake)
- **Tournament expanded** view (per-tournament leaderboard + rounds)
- **Championship expanded** (post-season bracket with stroke advantages)

Each of these should be visible in the screenshots. Does the stack feel
right? Should something move?

### 4. Visual style

- Background: warm off-white (`stone-50`).
- Cards: white with hairline ring, rounded corners, soft shadow.
- Accent: `#16785A` (fairway green) used on primary buttons, filled spot
  dots, "you" chip highlight, seed badge.
- Drop-in / Guest accent: amber.
- System font stack (no Google Fonts).

Open questions:

- Does this read as "tasteful utility" or as "sterile / generic SaaS"?
- Is `#16785A` the right green? Too dark? Better suggestion?
- Should the cards have any course/golf motif (subtle), or is the accent
  green enough?
- Does the type scale feel right on a phone, or should we go larger?

### 5. Copy review

Sanity-check these phrases. Flag anything that feels off:

| Where | Current copy |
|---|---|
| Page title | "DJDI Golf Board" |
| Name prompt | "What name should we use for your spots?" |
| Header pill | "You're **Mike** (12.4) · edit" |
| Card host line | "Hosted by Greg" |
| Spots line | "2 of 4 + 1" (the `+1` is "maybe"; dots show the breakdown) |
| Empty state | "Nothing on the board yet — Tap **+** to post a tee time or ask the group." |
| Primary CTA | "Claim a spot" / "Full" / "Add your name first" |
| Maybe button | "Maybe" |
| Drop confirm | "Drop your spot at Walnut Creek?" |
| Maybe drop confirm | "Remove your maybe at Walnut Creek?" |
| Delete confirm | "Delete Walnut Creek on Sat May 16 at 12:40 PM? This can't be undone." |
| Toast — full | "That tee time is full" |
| Toast — dup | "That name already has a spot" |
| Section: Season | "Season — 1 active · 8 upcoming" |
| Section: Roster | "Roster — 7 members · 1 guest" |
| Section: Pool | "Pool — $975 recorded paid of $2,275 · 3/7 paid" |
| Section: Standings | "Standings — 7 players · 3 rounds" |
| Section: Ops | "Ops — X open · Y blockers" |
| Section: Past tee times | "Past tee times (2)" |
| Ops task CTA | "Copy tasks" / "Download request packet" |
| Ops launch gate | "Docker build verified" / "Production URL smoke verified" / "Physical iPhone Safari verified" |
| Tournament card | "Stop 1 — Common Ground" (with status badge: ACTIVE / UPCOMING / PAST) |
| Score row | "Greg CH 8 · att. Alex   80   net 72" |
| Post-season seed pill | "1 / 2 / 3 / 4" (number) with hover title "Projected post-season seed 1" |
| Leaderboard footer | "Jason wins $334 (best of multiple rounds)" |
| Comments label | "Add a comment" (when empty) / "N comments" (when ≥1) |

Specifically open to:

- A more in-group name for the page title.
- Friendlier / more concise toast messages.
- Whether "Hosted by X" is clearer than "X's tee time".
- Whether `CH 8` for "course handicap 8" is clear enough.
- Whether `att. Alex` is the right shorthand for "attested by Alex" (the
  league-rule corroborator).

## How to send feedback back

Anything works — comment on the PR
(<https://github.com/Redeemedduck/tremendous-slouch/pull/1>), attach
annotated screenshots, or just dump notes in this file.
