# Live testing of the shipped fixes — 2026-08-05

Testing done against the running dev server, driving the real app (real click
events, real API calls, real DOM readback) rather than reading code.

## Correction to yesterday's review (this matters most)

Yesterday's reviewer reported "no cross-client updates — claims never
propagate". **That was a testing artifact, not an app bug.** The app polls
every 20 seconds, but the poll is deliberately gated on
`document.visibilityState === "visible"` (battery saving). The automated
browser pane reports itself as `hidden`, so the poll never fired for the
reviewer.

Proven live: with the tab reporting itself visible, as any real phone browser
would, a tee time created by another member appeared on the board in under 20
seconds with no reload (upcoming count went 16 → 17, the new course appeared).
Auto-refresh works for real users.

The conflict fix shipped yesterday is still worth having — it closes the race
window *between* polls.

## Fixes verified live

| Fix | Result |
|---|---|
| Conflict self-correction | **Holds.** Rival took the last spot via API; tapping the stale "Claim a spot" showed "That tee time is full" and the card corrected itself from "1 of 2" to "2 of 2", listed the rival, and dropped the claim button. |
| Identity not persisted on rejected save | **Holds.** Stubbed the roster save to return 409. Error appeared in the sheet and as a toast, the header pill stayed "Tanner Duck", and localStorage was unchanged. Happy path still updates the header and closes the sheet. |
| Stale form error banner | **Holds.** Empty submit showed "Course is required"; the banner cleared the moment a course was typed. |
| Long-name header | **Holds.** At 375px with a 30-character name: wordmark "DJDI Board" renders 100px wide, untruncated; the name is clipped inside a 176px pill. The name gives way, not the brand. |
| Solo-round nag excluded | **Holds.** A single-claim round inside the live stop window was excluded from "waiting on scores" (banner read 3, not 4). Adding a second player made it attestable and the banner went to 4. |
| Points from the database | **Holds.** Season hero reads "20 pts" / "$306" with the client-side override removed. Leader Noah Solomon 42.33, championship cut line present. |

## Server input validation (hostile burst)

All rejected correctly: duplicate claim (409), double drop (404), empty comment,
5,000-character comment, self-attestation, attester who wasn't in the group,
negative score, score of 999, duplicate poll options differing only by case and
whitespace, party size of 99.

Stored XSS payload (`<img src=x onerror=alert(1)>` as a player name) renders as
harmless literal text — no element injected, no console errors. React escaping
holds.

**One gap:** the API accepts any date, including 1999-01-01 (201 Created). The
UI blocks past dates with a `min` attribute, so this is only reachable by
hitting the API directly. Left alone deliberately — a wrong-year round can't
land inside a 2026 stop window, and adding a date-range validator is
speculative hardening for a 12-person league.

## Not a bug (checked and cleared)

Three submit clicks fired in the *same millisecond* created three duplicate tee
times. A realistic double-tap does not: the button disables and shows "Posting…"
within 120ms, and only one round was created. Physically unreachable by a human
or a touchscreen.

## State of the suite

5/5 unit tests pass, typecheck clean, no console errors during any burst.
