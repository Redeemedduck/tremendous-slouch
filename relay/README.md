# iMessage relay (Mac side)

The server side is channel-agnostic: any relay that can POST
`{channel, handle, text}` to `/api/inbound/message` with header
`X-Relay-Secret: $RELAY_SECRET` and deliver the returned `reply` string
back to the sender is a valid transport.

Status: **not yet paired** — needs a live session on the always-on Mac
(one-time), because iMessage access prompts for permissions interactively.

Two ways to run it, in preference order:

1. **openclaw** — already installed on this Mac (`~/.openclaw`, currently
   configured for the old Moltbot Slack setup; do not disturb that config
   without Matt). Its iMessage channel + a small webhook-forwarder is the
   maintained path: bridge breakage after macOS updates becomes the
   openclaw community's bug, not ours. https://github.com/openclaw/openclaw
2. **openclaw/imsg standalone** — a lighter CLI/JSON-RPC bridge for
   Messages.app if running full openclaw feels heavy.
   https://github.com/openclaw/imsg

Operational rules (from the channel research, 2026-08):
- The Mac defers **major** macOS upgrades until the bridge project
  confirms compatibility (macOS 26 broke bridge send paths; Sequoia is the
  known-good baseline).
- Text Message Forwarding stays ON so Android members reach the Mac as
  SMS/RCS. Verify with a real Android member before announcing.
- If the Mac route ever proves flaky: Twilio inbound-only is $1.15/mo with
  no A2P registration; full two-way SMS needs sole-proprietor A2P
  (~$5.60/mo + $19 one-time). The server side doesn't change — only this
  relay does.

Until pairing happens, the `dev` channel works end-to-end from a terminal:

```
npx tsx scripts/agent-chat.ts "Common Ground Sat 8:40, room for 2"
```

(export RELAY_SECRET and AGENT_URL in the shell first.)
