// Talk to the Text-the-Board webhook from the terminal — the "dev" channel.
// Useful for demos and for testing the pipeline without any SMS/iMessage
// relay in the loop.
//
//   npx tsx scripts/agent-chat.ts "Common Ground Sat 8:40, room for 2"
//   npx tsx scripts/agent-chat.ts --handle +13035550100 "yes"
//
// Env: AGENT_URL (default http://127.0.0.1:3000), RELAY_SECRET (required —
// export it first), AGENT_HANDLE (default "dev-duck", overridden by --handle).

const args = process.argv.slice(2);
let handle = process.env.AGENT_HANDLE ?? "dev-duck";
const handleFlag = args.indexOf("--handle");
if (handleFlag !== -1) {
  handle = args[handleFlag + 1];
  args.splice(handleFlag, 2);
}
const text = args.join(" ").trim();
const url = `${process.env.AGENT_URL ?? "http://127.0.0.1:3000"}/api/inbound/message`;
const relayAuth = process.env.RELAY_SECRET;

if (!relayAuth) {
  console.error("RELAY_SECRET is required");
  process.exit(1);
}
if (!text) {
  console.error('Usage: agent-chat.ts [--handle <id>] "<message>"');
  process.exit(1);
}

const r = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-relay-secret": relayAuth },
  body: JSON.stringify({ channel: "dev", handle, text }),
});
const body = (await r.json().catch(() => ({}))) as {
  reply?: string;
  error?: string;
};
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${body.error ?? "unknown error"}`);
  process.exit(1);
}
console.log(body.reply);
