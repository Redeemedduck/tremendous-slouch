# Text the Board — build plan

*Drafted 2026-08-05; corrected 2026-08-06. Status: Phase 1 server side is
BUILT and live-tested (see reviews/ and the test suite).*

**Correction (2026-08-06):** the first version of this plan assumed two
paid services — Fly.io hosting and the metered Anthropic API — that Matt
never approved. Both are now strictly opt-in. The default architecture
runs at **$0/month on hardware Matt already owns**: the whole stack on the
always-on Mac, parsing on a local Ollama model (qwen2.5:7b, pulled and
live-verified), members reached over iMessage. No public deploy is
required at all — if the members' only interface is texting, the web app
never needs to leave Tailscale.

## What this is

Members stop opening a web app to post tee times. They send a normal message
("Common Ground Sat 8:40, room for 2" / "shot 82, course handicap 9, Jayson
attested") to the league's inbox. An LLM turns the message into a validated
action against the existing API, and the sender gets a plain confirmation
back ("Got it: Common Ground, Sat Aug 9, 8:40am, 2 spots. Reply NO to undo").

## Architecture (settled)

The brain lives **inside the existing app process** — one webhook route in
server.ts, running wherever the app runs (default: the always-on Mac,
loopback-bound, reachable by the relay on the same machine). Message flow:

1. Channel delivers the message to `POST /api/inbound/<channel>`.
2. Webhook signature verified (reject silently otherwise).
3. Sender resolved against a new `members` table (channel + handle →
   player name). Unknown sender: canned reply, owner notified, **no LLM
   call** (abuse costs $0).
4. A model parses the message via **tool use** — one tool per allowed
   action (`create_tee_time`, `claim_spot`, `drop_spot`, `record_score`,
   `cast_vote`, `board_query`, `clarify`), each with a strict JSON schema.
   No bulk or delete-everything tool exists, which is the prompt-injection
   containment: a hostile message has nothing dangerous to call.
   **Provider policy (agent/providers.ts): local Ollama first ($0,
   OLLAMA_URL), the metered Anthropic API only if Matt explicitly sets
   ANTHROPIC_API_KEY, otherwise the agent reports itself offline.** The
   system prompt hands the model a printed 7-day calendar because small
   local models botch weekday arithmetic (found live, fixed, retested).
5. The executor runs the validated action through the same internal
   functions the REST API uses — existing server-side validation (course
   handicap + attester rules, name matching, date/spots limits) stays as
   the hard backstop.
6. Confirmation reply is **generated from a template over the validated
   struct** — never LLM-written — so it cannot misstate what was committed.

The sender's identity is resolved at the transport layer and bound
server-side as the acting player. It is never a parameter the model fills
in; "hey this is Dave" in a message body is ignored.

### New tables (existing SQLite)

- `members(channel, handle, player_name, active)` — owner-seeded, ~12 rows.
- `pending_actions(sender, action_json, expires_at)` — for YES/NO replies.
- `action_log(sender, raw_message, parsed_json, result, at)` — audit trail.

### Commit policy

| Action | Policy |
|---|---|
| Post a tee time | Auto-commit, "Reply NO to undo" (10-min window) |
| Claim / drop a spot | Auto-commit + undo |
| Poll vote | Auto-commit + undo |
| Record a score | **Explicit YES first** — echoes the exact parse (gross, course hcp, attester) |
| Anything touching buy-ins | **Explicit YES first** |
| Cancel a tee time others claimed | **Explicit YES first** |
| Bulk/admin anything | No tool exists — impossible via message |

Scores feed standings feed payouts; that's why they confirm first. Everything
else follows undo-beats-confirm (confirmation prompts train reflexive YES).

### Ambiguity and safety

- Course/player rosters live in the system prompt. More than one match →
  the `clarify` tool fires and the reply is a multiple-choice text. Never
  first-match.
- Attester is parsed from the message but validated against the roster and
  the tee time's claims; missing attester on a league round → ask, not guess.
- Rate limits: per-sender ~10 msgs/hr, global ~100 LLM calls/day circuit
  breaker, input truncation. A full day of abuse costs under a dollar.
- Message content is framed as data inside delimiters; the ACCESS_CODE
  credential never appears in any prompt.

## Cost (settled)

- Parsing: **$0** — local Ollama (qwen2.5:7b) on the Mac, live-verified.
- Hosting: **$0** — the app keeps running on the always-on Mac exactly as
  it does today (Tailscale for Matt's own browser use; the relay reaches
  the webhook over loopback).
- Channel: **$0** — iMessage relay on the same Mac.
- **All-in: $0/month.**

Paid opt-ins, only if Matt chooses them later: metered Anthropic API for
parsing (~$1–2/mo at league volume — set ANTHROPIC_API_KEY and it takes
over automatically only if OLLAMA_URL is unset or AGENT_PROVIDER says so);
Fly.io hosting if the web app should ever be publicly reachable
(~$3–5/mo, DEPLOY.md runbook); Twilio SMS if the iMessage route proves
flaky (~$5.60/mo + $19 one-time).

## Channel decision: iMessage relay from the always-on Mac, $0/month

**Why:** the binding constraint for 12 casual golfers is behavior change,
not money. iMessage is the only option where members change *nothing* —
they text the way they already text. The bridge is already installed and
verified working on the Mac. Every alternative loses on friction (Telegram/
Discord: install an app), cost + bureaucracy (SMS: number rental plus 2026
A2P sole-proprietor registration, $19 one-time + ~$5.60/mo, campaign
vetting "might take several weeks"), or is dead (email-to-SMS carrier
gateways: T-Mobile died 2024, AT&T June 2025, Verizon sunsetting to
Mar 2027 — do not build on these).

**Division of labor:** the Mac is a *dumb relay only* — it forwards
inbound message JSON to the app webhook on localhost (shared secret
header) and sends the reply text it's handed back. All
parsing, validation, and state lives in the app process, so swapping the
transport (iMessage → SMS) never touches the brain. openclaw/imsg
(1.3K stars, actively maintained) is the off-the-shelf bridge component.

**The gotchas, honestly:**
- A macOS major update can break the bridge — macOS 26 broke the send
  paths bridges rely on; Sequoia is the known-good version as of early
  2026. Rule: the Mac defers major macOS upgrades until the bridge project
  confirms compatibility. This is the price of $0/month.
- Apple can spam-flag an account that auto-messages; risk is low for 12
  known contacts, but a dedicated Apple ID (separate macOS user account)
  is the hardening step if it ever matters. Start on the personal ID —
  members already text Matt.
- Android members reach the Mac as SMS/RCS relayed through the paired
  iPhone (Text Message Forwarding stays on). Bridge handling of RCS is
  less battle-tested than iMessage — verify with the league's actual
  Android member(s) before announcing, and keep the web app as their
  fallback.

**Pre-wired fallback if the Mac proves flaky:** Twilio local number,
inbound-only, is $1.15/mo with NO A2P registration (registration gates
outbound only) — a quiet pilot needs nothing else. Full two-way SMS means
sole-proprietor A2P registration ($19 one-time + $2/mo campaign + per-
message fees ≈ $5.60/mo all-in at league volume; register as Matt-the-
individual, not Ibid — sole-prop brands must have no EIN). Because the
brain is channel-agnostic, the swap is a new ~50-line adapter, not
a rebuild. A shared iOS Shortcut that POSTs straight to the API is a free
bonus lane for power users regardless of channel.

## Build phases

- **Phase 0 — keep the app where it is.** It runs on the always-on Mac
  (launchd so it survives reboots), loopback + Tailscale, ACCESS_CODE and
  RELAY_SECRET set, OLLAMA_URL pointed at the local Ollama. No deploy, no
  new accounts.
- **Phase 1 — tee times by text.** Two halves:
  *App side (BUILT):* members/pending/log tables, webhook route with shared-secret
  verification + allowlist + rate caps, Haiku strict tools for tee-time
  create/claim/drop + clarify, template confirmations, NO-undo.
  *Mac side:* openclaw/imsg relay watching Messages, POSTing message JSON
  to the app webhook, sending back the reply text. Launchd keeps it alive;
  a health ping tells Matt when it's down.
  Seed the 12 members (handle → player name). Pilot with 2–3 friendly
  members for a week before announcing. This is the adoption test — if
  the league doesn't use it, stop here.
- **Phase 2 — scores by text.** `record_score` tool with the YES gate and
  attester validation. This is the higher-value flow (the score form is the
  most annoying part of the app) but it goes second because it's
  money-adjacent and Phase 1 proves the parse quality first.
- **Phase 3 — polls + board readback.** Poll votes by reply; "board" /
  "standings" returns a text rendering of the current standings.
- Each phase: unit tests for the executor + parse fixtures (a dozen real
  message transcripts as test cases), deployed, then a week of real-league
  soak before the next phase.

## Prior art to steal from

- openclaw/openclaw — gateway/allowlist/pairing identity model, messages
  as untrusted data. Reference architecture, not a dependency.
- openclaw/imsg — the iMessage relay component, if iMessage wins.
- ma2za/telegram-llm-bot — message→tool-call→reply loop on Telegram.

## Risks (ranked)

1. Silent inbound failure kills trust → one failure domain (the app process), prefer a
   channel with webhook redelivery, health-check ping.
2. Wrong parse committed to money data → YES gate + template echo + attester
   validation.
3. Spoofed identity → transport-layer allowlist, in-message claims ignored.
4. Prompt injection → least-privilege tools, no destructive tool, data
   framing, audit log + undo.
5. Webhook cost abuse → signature check + allowlist-before-LLM + caps.
