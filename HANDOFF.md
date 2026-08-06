# Handoff — local Claude Code session (the always-on Mac)

*Written 2026-08-06 by the remote session that built PR #6. Everything below
is committed on `claude/golf-league-app-refactor-9bjpeo` unless noted.*

## Where things stand

**PR #6** (https://github.com/Redeemedduck/tremendous-slouch/pull/6, marked
ready for review) is the single shippable unit. It contains, in order:

1. The corrected DJDI scoring base (official 20/15/14/… scale, tie
   splitting, published finals for Stops 1–3) — supersedes PR #4.
2. The Board / Season / Manage restructure — supersedes PR #5.
   **Close #4 and #5 when #6 merges; do not merge them separately.**
3. The clubhouse design system (fairway/gold/cream tokens, Cormorant
   Garamond display serif, shared Sheet/Field primitives) plus a
   three-agent review pass (design craft, mobile usability, wow factor)
   applied as surgical fixes — WCAG contrast, un-buried score recording,
   leader nameplate, championship cut treatment, etc.
4. Season-data corrections, each seeded for new DBs **and** applied to
   existing DBs at startup (only known-stale values are rewritten):
   - points to first: 100 → **20**
   - per-stop payout: $334 → **$306** (11 paid members after Ryan
     dropped unpaid — commissioner's settlement text)
   - championship purse: $1,014/$390/$156 → **$930/$360/$143**
     (65/25/10 of the $1,433 left after 7 × $306)
5. **Text the Board** (Phase 1+2 server side): inbound webhook, member
   allowlist, tool-schema parsing, YES-gates on money-adjacent actions,
   NO-undo, audit log, rate caps. See `TEXT-THE-BOARD-PLAN.md` and
   `reviews/`. PR #3 (`codex/djdi-2026-roadmap`) was deliberately **not**
   adopted — over-engineered for this league.

**Verification**: full suite green locally as of the last push — 90 node
tests (`npm test` covers `src/lib` + `agent/`), `tsc --noEmit` clean,
production build clean. GitHub Actions had an **infrastructure outage**
on 2026-08-06 (~15:40–16:15 UTC): runs died with "Service Unavailable"
*before checkout* in multiple Azure regions. Red CI on head `1175f8e` is
NOT a code failure — re-run the workflow once Actions recovers and it
should pass.

## Your jobs (things only a local session can do)

1. **Pair the iMessage relay** — interactive, needs the Mac's GUI
   permission prompts. `relay/README.md` has the two options
   (openclaw vs openclaw/imsg standalone) and the operational rules
   (defer major macOS upgrades; Text Message Forwarding ON; Sequoia is
   the known-good baseline). Careful: `~/.openclaw` currently holds the
   old Moltbot Slack config — don't disturb it without Matt.
2. **Seed the members table** — `npx tsx scripts/agent-members.ts`
   (handle → player name, ~12 rows). Until the relay is paired,
   `npx tsx scripts/agent-chat.ts "Common Ground Sat 8:40, room for 2"`
   exercises the whole loop from a terminal (export `RELAY_SECRET` and
   `AGENT_URL` first).
3. **Verify the Hermes model before switching the league to it** — see
   the finding below. The switch itself is one env var.
4. **Enter the outstanding real-world data** (or let the agent do it as
   its live test):
   - Ryan Theret dropped unpaid → Manage → Roster → tap his "Member"
     pill to Guest; his buy-in row auto-removes.
   - Bear Dance (Stop 4) foursome card: Kyle 85 / CH 4, Matt 84 / CH 6,
     Jayson 87 / CH unknown, Johnny 84 / CH 5 — league round, needs
     attester per player.
   - Todd Creek tee time (Sat 12:20, host + Jayson claimed, 2 open) if
     still upcoming.

## ⚠️ Hermes finding (empirical, 2026-08-06)

On Ollama 0.32.6, **`hermes3:3b` does not return structured tool calls**
through the `/api/chat` `tools` API. Given a single forced-tool prompt it
answered in plain text with stray tokens:

```
"./
  { 'arguments': { 'course': 'Todd Creek', ... }, 'name': 'create_tee_time' }
.SEVERI
```

No `message.tool_calls` array → `agent/providers.ts` maps that to empty
content → parse degrades to `unknown` → every message would get the
"didn't understand" reply. Before setting `AGENT_MODEL` to a Hermes tag:

```bash
curl -s http://127.0.0.1:11434/api/chat -d '{
  "model": "hermes3:8b", "stream": false, "options": {"temperature": 0},
  "messages": [{"role":"system","content":"You must call a tool."},
               {"role":"user","content":"Post a tee time at Todd Creek on 2026-08-08 at 12:20 with 4 spots."}],
  "tools": [{"type":"function","function":{"name":"create_tee_time","description":"Post a new tee time",
    "parameters":{"type":"object","properties":{"course":{"type":"string"},"date":{"type":"string"},
    "time":{"type":"string"},"spots":{"type":"integer"}},"required":["course","date","time","spots"]}}}]
}'
```

Accept the model only if the response contains a structured
`message.tool_calls` entry (that's what the adapter consumes). If 8b also
answers in prose, the options are (a) stay on `qwen2.5:7b` — already
live-verified, this is the default for a reason — or (b) add a
Hermes-format fallback parser in `createOllamaClient` that extracts a
`<tool_call>`/JSON block out of `message.content` (bounded, validated by
the same schemas; a reasonable ~30-line addition if Matt wants Hermes
specifically). Also re-run the weekday-arithmetic fixtures in
`agent/parse.test.ts` against any new model — small models botch
calendar math, which is why the system prompt carries a printed 7-day
calendar.

## Environment

`.env.example` now documents everything. The agent needs `RELAY_SECRET`
(webhook off until set), `OLLAMA_URL`, and optionally `AGENT_MODEL` /
`AGENT_PROVIDER` / `ANTHROPIC_API_KEY` (metered, strictly opt-in).
Provider policy lives in `agent/providers.ts`: forced > Ollama > Anthropic
> offline.

## Known loose ends (fine to leave, good to know)

- `SCREENSHOTS.md` + `scripts/screenshots.ts` predate the redesign and
  target the old single-page UI (FAB menu, old selectors). Rewrite when
  screenshots are next needed.
- `useTeeTimes.removeScore` exists but no UI calls it — a wrong score can
  be overwritten but not deleted from the app (the agent's undo can).
- CLAUDE.md is current (rewritten 2026-08-03); README is current.
- The Gemini bot comments on PRs are sunset notices — ignore. Codex
  review runs on PR pushes; its two P2s on #6 were fixed (host
  visibility, tab scroll reset).

## Commands

```bash
npm run dev        # Express + Vite, localhost:3000
npm test           # node:test — src/lib + agent (spawns a real server)
npm run lint       # tsc --noEmit
npm run build      # production client build
npx tsx scripts/agent-chat.ts "<message>"   # drive the agent, no relay
npx tsx scripts/agent-members.ts            # seed member handles
```
