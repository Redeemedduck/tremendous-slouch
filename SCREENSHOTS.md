# DJDI Golf Board — Screenshots

Real screenshots of the running app, captured at iPhone 14 Pro viewport
(393 × 852 @ 2x) by [`scripts/screenshots.ts`](./scripts/screenshots.ts) via
Playwright. The script boots the production build (`NODE_ENV=production
npx tsx server.ts` after `npm run build`), seeds a fixture set of tee
times and a poll via the public API, and drives the UI through each state.

To regenerate after UI changes:

```bash
npm run build
NODE_ENV=production npx tsx server.ts &   # leave running
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx tsx scripts/screenshots.ts
```

---

## 1. Empty board, no name set

First-time landing. The name prompt card is the primary affordance; below
it is the empty-state card with the flag icon. The collapsed "Past tee
times" section is from the seeded historical row used for shot 7.

![empty no name](./screenshots/01-empty-no-name.png)

## 2. Empty board, name remembered

After saving a name, the prompt disappears and the header shows
"Mike · change" as a single tappable pill (the whole thing is the tap
target — not just the word "change").

![empty with name](./screenshots/02-empty-with-name.png)

## 3. Populated board

Top-down: poll card with three options (checkmarks on Mike's two picks,
vote counts on the right, name chips below each option), then two
tee-time cards. The Walnut Creek card shows everything at once — date
strip, course title with map pin, host line, notes, the spots indicator
(2 filled, 1 outlined for "+1 maybe", 1 empty), "Add to calendar" on
the same row, claimed chips, the dashed "MAYBE" row with Lee, and the
equal-width "Claim a spot" / "Maybe" action peers.

![populated board](./screenshots/03-populated-board.png)

## 4. FAB chooser open

Tapping the FAB rotates the `+` to an `x` and reveals two stacked
pills — "New tee time" and "Ask the group" — each on a single line.

![fab chooser](./screenshots/04-fab-chooser-open.png)

## 5. New tee time bottom sheet

Form: course (with `<datalist>` autocomplete from past entries), date +
time on a 2-col grid, total spots + host on a 2-col grid, optional
notes. Native iOS-style date/time pickers. The sheet caps at
`100dvh - 1rem` and scrolls when the keyboard pushes it.

![new tee time sheet](./screenshots/05-new-teetime-sheet.png)

## 6. New poll bottom sheet ("Ask the group")

Question + dynamic 2-8 options + asker. Each option row has its own
remove `X` (only after the minimum 2 are present). The asker name
input also pulls from the autocomplete list.

![new poll sheet](./screenshots/06-new-poll-sheet.png)

## 7. Past tee times expanded

A row inserted directly via SQLite to demonstrate the past section.
Past cards render at `opacity-60`, no claim/drop/edit/delete actions —
the chips are not interactive (no `X`, no rose hover) thanks to the
`PlayerChip` interactive flag added in the UX pass.

![past expanded](./screenshots/07-past-section-expanded.png)

---

## Known polish-pass follow-ups visible here

These are visible in the screenshots and worth fixing in another pass:

- **Chooser overlap**: when the FAB chooser is open over a tee-time
  card, the pills sit on top of the action buttons. Could shift up or
  add a backdrop to make it feel intentional.
- **PollCard "Poll" eyebrow + icon**: minor — the icon top-aligns with
  the "POLL" eyebrow rather than visually centering with the prompt
  title; may want to bump the icon down a few pixels.
- **iOS date picker formatting**: the native picker shows "05/07/2026"
  in the form — matches the OS, can't override without a custom date
  input.
