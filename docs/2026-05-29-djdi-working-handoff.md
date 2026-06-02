# DJDI Working Handoff - 2026-05-29

## Current access

- Tailscale URL: `https://duckbookpro.clouded-tailor.ts.net/golf`
- Direct phone fallback: `http://100.102.92.28:3131/golf`
- Access code: `p0sJGOlbAPuoxGHHYtA1cMRySw5t4Ad3`
- Commissioner code: `test-admin`

These are local/private DJDI app codes, not third-party service credentials.

## Product stance

- First screen should stay obvious and short. Avoid link/setup language once a
  user has already reached the app.
- Commissioner tools are for practical correction: edit tee times, add players,
  remove players, correct scores, and keep the league moving.
- Score review is not a hard blocker for basic app use. If the commissioner
  enters or confirms a score, keep it usable and editable while preserving the
  audit trail.
- Do not make the app responsible for money collection. Jayson/commissioner
  handles collection; the app records status and notes only.
- Do not invent GHIN numbers. If a Handicap Index is needed before evidence
  exists, save it as an editable unverified/provisional value.

## Serving

Use `npm run start:phone` for the private phone/Tailscale runtime. It builds
mounted `/golf` assets into `dist-phone/` and serves that directory, so normal
local verification builds in `dist/` do not blank the phone app.

The server now fails fast if `APP_BASE_PATH=/golf` is paired with a client build
that references root `/assets/...` files.

## What changed in this handoff slice

- Phone/Tailscale build output is isolated in `dist-phone/`.
- Production asset startup guard checks mounted base-path correctness.
- Commissioner can remove a scored player from a tee time without deleting the
  score. Non-commissioner score locks still stay in place.
- Roster Handicap Index can be saved without a source; it is stored as
  provisional/unknown until GHIN/player evidence is added.
- Admin score copy is shorter and less gate-heavy.

## Verification expectation

Local proof and live phone proof are separate. A full local proof run can pass
without proving the physical phone path. For "works on phone" claims, verify the
Tailscale URL itself after restarting `npm run start:phone`.
