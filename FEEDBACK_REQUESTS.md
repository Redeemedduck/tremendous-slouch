# Feedback & Visuals Requests

Hand this to whoever's helping with screenshots / design / copy review for the
Golf Group Coordinator. The app is a small shared web app where ~12-15 friends
post tee times and claim spots. Mobile-first.

## How to run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

To view from a phone on the same Wi-Fi: find the laptop's local IP
(e.g. `ipconfig getifaddr en0` on macOS) and open
`http://<that-IP>:3000` on the phone.

---

## 1. Screenshots wanted (highest priority)

Please capture these from a real phone (iOS Safari preferred; Android Chrome
also fine). Portrait orientation. Reset between shots by clearing
localStorage (Safari: Settings → Safari → Advanced → Website Data) and
deleting `golf_coordinator.db` from the project root.

- [ ] **Empty state**: fresh load, no name set, no tee times yet
- [ ] **Name prompt + first claim**: enter a name, then a card with 1 of 4 spots
- [ ] **Filled card**: 4 of 4 spots, your name visible as a chip
- [ ] **Bottom-sheet form open**: tap "+ New tee time" — capture the full sheet
      with the date/time pickers visible if possible
- [ ] **Multiple cards**: 3+ tee times stacked, scrolled so the sticky header
      is visible with backdrop blur
- [ ] **Claim button states**: one shot showing the disabled "Full" state and
      one showing the disabled "Add your name to claim" state (clear
      localStorage to see the latter)
- [ ] **Past section expanded**: insert a past row via SQLite to see this:
      ```bash
      sqlite3 golf_coordinator.db "INSERT INTO tee_times \
        VALUES ('past1','Old Course','2024-01-01','09:00',4,'Greg',NULL,'[]','2024-01-01T00:00:00Z');"
      ```
- [ ] **Host overflow menu**: as the host, tap the `…` icon on your card to
      capture the Delete menu

What we're looking for in these shots:
- Bottom-sheet height and safe-area padding on iOS (no clipping at the bottom)
- FAB (the green "+ New tee time" pill) not covering content
- Chip tap targets feel finger-sized
- Sticky header blur looks right while scrolling
- Native date/time pickers render acceptably

---

## 2. Visual style review

Current direction is "clean utility" — think Apple Reminders / Linear:
- Background: warm off-white (Tailwind `stone-50`)
- Cards: white with hairline ring, rounded corners, soft shadow
- Single accent color — fairway green `#16785A` — used only on the primary
  button, the "filled" spot dots, and the "you" chip highlight
- System font stack (no Google Fonts)

Questions for a designer:
- Does this read as "tasteful utility" or as "sterile / generic SaaS"?
- Is `#16785A` the right green? Too dark? Too sage? Better suggestion?
- Should the cards have any course/golf motif (subtle), or is the accent
  green enough?
- Does the type scale (16/18 body, ~20 card title, ~24 page title) feel
  right on a phone, or should we go larger?

---

## 3. Copy review

Sanity-check these phrases — flag anything that feels off:

| Where | Current copy |
|---|---|
| Page title | "Golf Group" |
| Name prompt | "What name should we put on your spots?" |
| Header pill | "You're **Mike** · change" |
| Card host line | "Hosted by Greg" |
| Card spots line | "3 of 4" with dot indicator |
| Empty state | "No tee times yet — Tap **+** to post one." |
| Primary CTA | "Claim a spot" / "Full" / "Add your name to claim" |
| Drop confirm | "Drop your spot at Walnut Creek?" |
| Delete confirm | "Delete this tee time at Walnut Creek? This can't be undone." |
| Toast — full | "Tee time is full" |
| Toast — dup | "Already claimed by that name" |
| FAB | "+ New tee time" |
| Past section | "Past tee times (3)" |

Specifically open to:
- A more in-group name for the page title (e.g., the actual group's name)
- Friendlier / more concise toast messages
- Whether "Hosted by X" is clearer than "X's tee time"

---

## How to send feedback back

Anything works — comment on the PR
(<https://github.com/Redeemedduck/tremendous-slouch/pull/1>),
attach screenshots to a message, or just dump notes in this file.
