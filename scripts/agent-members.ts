// Manage the Text-the-Board allowlist (who may text the board).
//
//   npx tsx scripts/agent-members.ts list
//   npx tsx scripts/agent-members.ts add <channel> <handle> <player name...>
//   npx tsx scripts/agent-members.ts remove <channel> <handle>
//
// channel is e.g. "imessage" | "sms" | "dev"; handle is the sender id the
// relay reports (phone number, iMessage handle). Uses DB_PATH like the
// server (defaults to ./golf_coordinator.db).

import { createStore } from "../agent/store";

const DB_PATH = process.env.DB_PATH ?? "golf_coordinator.db";
const [command, channel, handle, ...nameParts] = process.argv.slice(2);
const store = createStore(DB_PATH);

const usage = () => {
  console.error(
    "Usage:\n  agent-members.ts list\n  agent-members.ts add <channel> <handle> <player name...>\n  agent-members.ts remove <channel> <handle>"
  );
  process.exit(1);
};

if (command === "list") {
  const members = store.listMembers();
  if (members.length === 0) console.log("(no members on the allowlist)");
  for (const m of members) {
    console.log(
      `${m.active ? "✓" : "✗"} ${m.channel}\t${m.handle}\t→ ${m.playerName}`
    );
  }
} else if (command === "add") {
  if (!channel || !handle || nameParts.length === 0) usage();
  const playerName = nameParts.join(" ");
  store.upsertMember({ channel, handle, playerName, active: true });
  console.log(`Added: ${channel} ${handle} → ${playerName}`);
} else if (command === "remove") {
  if (!channel || !handle) usage();
  store.upsertMember({ channel, handle, playerName: "", active: false });
  console.log(`Deactivated: ${channel} ${handle}`);
} else {
  usage();
}
store.close();
