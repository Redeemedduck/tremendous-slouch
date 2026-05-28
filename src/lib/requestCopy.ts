import type { Buyin, Player, Tournament } from "./types";
import { missingSourceBackedHandicapPlayers } from "./handicapEvidence";

function dollars(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

export function buildCollectionAsk(buyins: Buyin[]) {
  const owed = buyins.filter((buyin) => !buyin.paid);
  if (owed.length === 0) {
    return "DJDI buy-in status tracker:\nAll buy-ins are recorded as settled.";
  }

  const total = owed.reduce((sum, buyin) => sum + buyin.amount, 0);
  const amounts = new Set(owed.map((buyin) => buyin.amount));
  const lines = ["DJDI buy-in status tracker:"];

  if (amounts.size === 1) {
    lines.push(
      `Status still open (${dollars(owed[0].amount)} each): ${owed
        .map((buyin) => buyin.playerName)
        .join(", ")}`
    );
  } else {
    lines.push("Status still open:");
    for (const buyin of owed) {
      lines.push(`${buyin.playerName}: ${dollars(buyin.amount)}`);
    }
  }

  lines.push(`Outstanding total: ${dollars(total)}`);
  return lines.join("\n");
}

export function buildHandicapAsk(players: Player[]) {
  const missing = missingSourceBackedHandicapPlayers(players);
  if (missing.length === 0) {
    return "DJDI handicap records:\nAll member handicap indexes are recorded with source notes.";
  }

  return [
    "DJDI handicap records still needed:",
    missing.map((player) => player.name).join(", "),
    "Please send your current handicap index or GHIN/CGA source note. The board stores the source and uses the entered course handicap for league scoring evidence.",
  ].join("\n");
}

export function buildScheduleAsk(tournaments: Tournament[]) {
  const unconfirmed = tournaments.filter(
    (tournament) =>
      tournament.course.toLowerCase() === "tbd" ||
      tournament.notes?.toLowerCase().includes("tbd")
  );
  if (unconfirmed.length === 0) {
    return "DJDI schedule details:\nAll seeded event details are confirmed.";
  }

  const lines = ["DJDI schedule details still needed:"];
  for (const tournament of unconfirmed) {
    lines.push(
      `${tournament.name}: ${tournament.course}, ${tournament.windowStart} to ${tournament.windowEnd}${
        tournament.notes ? `, ${tournament.notes}` : ""
      }`
    );
  }
  lines.push(
    "Please send confirmed course, window, and notes so the league board can stop carrying TBDs."
  );
  return lines.join("\n");
}

export function buildAccessCodeSetup(appName = "djdi-golf-board") {
  return [
    "DJDI access-code setup:",
    "1. Create a shared access code in 1Password or another password manager.",
    "2. Set the production secret:",
    `fly secrets set ACCESS_CODE='<shared-code>' -a ${appName}`,
    "3. Restart the app so the runtime picks it up:",
    `fly apps restart ${appName}`,
    "4. Verify the locked public URL:",
    `REMOTE_SMOKE_URL=https://${appName}.fly.dev REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke`,
  ].join("\n");
}

export function buildProductionUrlChecklist(appName = "djdi-golf-board") {
  return [
    "DJDI public production URL unblocker:",
    "Fly path:",
    "1. Authenticate Fly on this machine:",
    "fly auth login",
    "2. Recheck deploy prerequisites:",
    "npm run verify:deploy-prereqs",
    "3. Deploy after Fly auth/app/volume checks pass:",
    "fly deploy",
    "4. Verify the public Fly URL:",
    `REMOTE_SMOKE_URL=https://${appName}.fly.dev REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke`,
    "",
    "Tailscale Funnel fallback:",
    "1. Enable Funnel in the Tailscale admin console if the CLI asks for it:",
    "https://login.tailscale.com/f/funnel?node=nnRP2Xzazg11CNTRL",
    "2. Publish only DJDI on a dedicated public port:",
    "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131",
    "tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api",
    "3. Verify the public Funnel URL:",
    "REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net/golf REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke",
    "",
    "Do not mark Production URL smoke verified until one of those remote-smoke commands exits 0 against the final URL.",
  ].join("\n");
}

export function buildIphoneSafariChecklist(
  appUrl = "http://100.102.92.28:3131/golf"
) {
  return [
    "DJDI physical iPhone Safari verification:",
    `1. On physical iPhone Safari, open ${appUrl}.`,
    "   Use https://duckbookpro.clouded-tailor.ts.net/golf only after the direct Tailscale-IP link works.",
    "2. Enter the shared access code and confirm the board unlocks.",
    "3. Confirm bottom navigation opens Board, Season, Money, Roster, and Admin.",
    "4. Board: open an active or past tee time and confirm score controls are usable without overlap.",
    "5. Season: confirm standings and net/gross values are readable.",
    "6. Money and Roster: confirm copy/action buttons are reachable.",
    "7. Admin: confirm League Checklist, Commissioner Tasks, Closeout packet/ledger, and Archive export links are visible.",
    "8. If all pass, mark iPhone Safari verified in Admin > Launch Gates.",
  ].join("\n");
}
