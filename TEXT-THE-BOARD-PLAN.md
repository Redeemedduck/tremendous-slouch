# Text the Board — build plan

*Drafted 2026-08-05. Researched by two agents (channel options + agent
architecture); synthesized and maintained here. Status: ready to build.*

## What this is

Members stop opening a web app to post tee times. They send a normal message
("Common Ground Sat 8:40, room for 2" / "shot 82, course handicap 9, Jayson
attested") to the league's inbox. An LLM turns the message into a validated
action against the existing API, and the sender gets a plain confirmation
back ("Got it: Common Ground, Sat Aug 9, 8:40am, 2 spots. Reply NO to undo").

## Architecture (settled)

The brain lives **inside the existing Fly app** — one new webhook route in
server.ts, no second machine to keep alive. Message flow:

1. Channel delivers the message to `POST /api/inbound/<channel>`.
2. Webhook signature verified (reject silently otherwise).
3. Sender resolved against a new `members` table (channel + handle →
   player name). Unknown sender: canned reply, owner notified, **no LLM
   call** (abuse costs $0).
4. Claude Haiku 4.5 parses the message via **strict tool use** — one tool
   per allowed action (`create_tee_time`, `claim_spot`, `drop_spot`,
   `record_score`, `cast_vote`, `clarify`), each with a strict JSON schema.
   The model picks the tool; the API guarantees the arguments validate.
   No bulk or delete-everything tool exists, which is the prompt-injection
   containment: a hostile message has nothing dangerous to call.
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

- Parsing: Claude Haiku 4.5 at $1/M input, $5/M output ≈ **$1–2/month** at
  ~300 messages. (Prompt caching doesn't apply — system prompt is below the
  4,096-token cache minimum. Don't build it. If Haiku fumbles, Sonnet is
  still only ~$3/mo.)
- Hosting: $0 incremental on the existing Fly app (~$3–5/mo it already
  costs to run, which is a prerequisite — see below).
- Channel: **$0** (iMessage relay from the Mac — see channel decision).
  SMS fallback if ever needed: ~$5.60/mo + $19 one-time registration.
- **All-in: roughly $5–7/month, nearly all of it the Fly VM.**

## Prerequisite: the app must actually be deployed

flyctl on this Mac is not logged in and fly.toml still has the placeholder
app name — the app appears to have never been publicly deployed (Tailscale
solo mode so far). Inbound webhooks need a public HTTPS endpoint. Phase 0
is therefore the DEPLOY.md runbook: `fly auth login`, `fly launch
--no-deploy`, volume create, `fly secrets set ACCESS_CODE=…`, deploy,
smoke-test. (~$3–5/mo for the always-on shared-cpu VM.)

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
inbound message JSON to the Fly webhook (over Tailscale or public HTTPS
with a shared secret) and sends the reply text it's handed back. All
parsing, validation, and state lives on Fly. If the Mac dies, the web app
keeps working and only the texting transport goes dark. openclaw/imsg
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
brain is channel-agnostic on Fly, the swap is a new ~50-line adapter, not
a rebuild. A shared iOS Shortcut that POSTs straight to the API is a free
bonus lane for power users regardless of channel.

## Build phases

- **Phase 0 — deploy.** Fly launch per DEPLOY.md. App public behind the
  access code. Half a day including smoke tests.
- **Phase 1 — tee times by text.** Two halves:
  *Fly side:* members/pending/log tables, webhook route with shared-secret
  verification + allowlist + rate caps, Haiku strict tools for tee-time
  create/claim/drop + clarify, template confirmations, NO-undo.
  *Mac side:* openclaw/imsg relay watching Messages, POSTing message JSON
  to the Fly webhook, sending back the reply text. Launchd keeps it alive;
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

1. Silent inbound failure kills trust → one failure domain (Fly), prefer a
   channel with webhook redelivery, health-check ping.
2. Wrong parse committed to money data → YES gate + template echo + attester
   validation.
3. Spoofed identity → transport-layer allowlist, in-message claims ignored.
4. Prompt injection → least-privilege tools, no destructive tool, data
   framing, audit log + undo.
5. Webhook cost abuse → signature check + allowlist-before-LLM + caps.
