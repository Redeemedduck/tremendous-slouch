import type { CommissionerTask } from "./commissionerTasks";
import type { SourceSearchEntry } from "./sourceSearchLedger";
import type { Buyin, Player, Tournament } from "./types";
import { missingSourceBackedHandicapPlayers } from "./handicapEvidence";

export type EvidenceGapArea = "money" | "roster" | "schedule" | "launch";

export type EvidenceGapItem = {
  id: string;
  area: EvidenceGapArea;
  blockerId: string;
  label: string;
  owner: string;
  requestedEvidence: string;
  pasteBackTemplate: string;
  intakePath: string;
  sourceStatus: "recorded" | "not_found" | "blocked" | "inferred" | "not_searched";
  sourceDecision: string;
  relatedTaskId: string | null;
};
type EvidenceGapSourceStatus = EvidenceGapItem["sourceStatus"];

export type EvidenceGapPacket = {
  summary: {
    total: number;
    onePasteReady: number;
    launchVerification: number;
    money: number;
    roster: number;
    schedule: number;
    launch: number;
  };
  items: EvidenceGapItem[];
};

const normalizeName = (value: string) => value.trim().toLowerCase();

const sourceFor = (
  entries: SourceSearchEntry[],
  blockerId: string
): Pick<EvidenceGapItem, "sourceStatus" | "sourceDecision"> => {
  const related = entries.filter((entry) =>
    entry.relatedOpenItems.includes(blockerId)
  );
  if (related.length === 0) {
    return {
      sourceStatus: "not_searched" as const,
      sourceDecision: "No source-search entry is linked to this blocker.",
    };
  }
  const priority: EvidenceGapSourceStatus[] = [
    "blocked",
    "not_found",
    "inferred",
    "recorded",
  ];
  const sourceStatus =
    priority.find((status) => related.some((entry) => entry.status === status)) ??
    "not_searched";
  return {
    sourceStatus,
    sourceDecision: related.map((entry) => entry.decision).join(" "),
  };
};

const taskFor = (tasks: CommissionerTask[], taskId: string) =>
  tasks.find((task) => task.id === taskId) ?? null;

function gapSummary(items: EvidenceGapItem[]) {
  return {
    total: items.length,
    onePasteReady: items.filter((item) => item.intakePath === "Admin > One-Paste Intake")
      .length,
    launchVerification: items.filter((item) => item.area === "launch").length,
    money: items.filter((item) => item.area === "money").length,
    roster: items.filter((item) => item.area === "roster").length,
    schedule: items.filter((item) => item.area === "schedule").length,
    launch: items.filter((item) => item.area === "launch").length,
  };
}

export function buildEvidenceGapPacket({
  players,
  buyins,
  tournaments,
  tasks,
  sourceEntries,
}: {
  players: Player[];
  buyins: Buyin[];
  tournaments: Tournament[];
  tasks: CommissionerTask[];
  sourceEntries: SourceSearchEntry[];
}): EvidenceGapPacket {
  const items: EvidenceGapItem[] = [];
  const moneySource = sourceFor(sourceEntries, "money-collected");
  const rosterSource = sourceFor(sourceEntries, "roster-ghin");
  const scheduleSource = sourceFor(sourceEntries, "schedule-confirmed");

  for (const buyin of buyins.filter((item) => !item.paid)) {
    items.push({
      id: `money-${normalizeName(buyin.playerName).replace(/[^a-z0-9]+/g, "-")}`,
      area: "money",
      blockerId: "money-collected",
      label: `${buyin.playerName} buy-in`,
      owner: buyin.playerName,
      requestedEvidence: `Confirm 2026 DJDI buy-in status for $${buyin.amount.toLocaleString(
        "en-US"
      )}, including method/date/source note if paid or comped.`,
      pasteBackTemplate: `${buyin.playerName} paid $${buyin.amount} via <Venmo/Zelle/cash/check> on YYYY-MM-DD. Source: <receipt, text reply, or commissioner confirmation>.`,
      intakePath: "Admin > One-Paste Intake",
      ...moneySource,
      relatedTaskId: taskFor(tasks, "collect-buyins")?.id ?? null,
    });
  }

  for (const player of missingSourceBackedHandicapPlayers(players)) {
    items.push({
      id: `ghin-${normalizeName(player.name).replace(/[^a-z0-9]+/g, "-")}`,
      area: "roster",
      blockerId: "roster-ghin",
      label: `${player.name} handicap index`,
      owner: player.name,
      requestedEvidence:
        "Current handicap index and source/date, preferably from GHIN/CGA or the player directly.",
      pasteBackTemplate: `${player.name} handicap index <number> as of YYYY-MM-DD. Source: <GHIN/CGA/player reply>.`,
      intakePath: "Admin > One-Paste Intake",
      ...rosterSource,
      relatedTaskId: taskFor(tasks, "collect-ghin-indexes")?.id ?? null,
    });
  }

  for (const tournament of tournaments.filter(
    (item) =>
      item.course.toLowerCase() === "tbd" ||
      item.notes?.toLowerCase().includes("tbd")
  )) {
    items.push({
      id: `schedule-${tournament.id}`,
      area: "schedule",
      blockerId: "schedule-confirmed",
      label: tournament.name,
      owner: "Commissioner",
      requestedEvidence:
        "Confirmed course, window start/end, and any final notes replacing TBD details.",
      pasteBackTemplate: `${tournament.name}: <course>, ${tournament.windowStart} to ${tournament.windowEnd}, <final notes>.`,
      intakePath: "Admin > One-Paste Intake",
      ...scheduleSource,
      relatedTaskId: taskFor(tasks, "confirm-schedule")?.id ?? null,
    });
  }

  const productionTask = taskFor(tasks, "verify-production-url");
  if (productionTask) {
    items.push({
      id: "launch-production-url",
      area: "launch",
      blockerId: "production-url-gate",
      label: "Public production URL",
      owner: "Commissioner",
      requestedEvidence:
        "Final public or always-on URL plus passing remote-smoke command output.",
      pasteBackTemplate:
        "Production URL verified: https://<final-url>. Remote smoke passed at YYYY-MM-DDTHH:MM:SSZ. Marked in Admin > Launch Gates.",
      intakePath: "Admin > Launch Gates",
      ...sourceFor(sourceEntries, "production-url-gate"),
      relatedTaskId: productionTask.id,
    });
  }

  const iphoneTask = taskFor(tasks, "verify-iphone-safari");
  if (iphoneTask) {
    items.push({
      id: "launch-iphone-safari",
      area: "launch",
      blockerId: "iphone-safari-gate",
      label: "Physical iPhone Safari",
      owner: "Commissioner",
      requestedEvidence:
        "Physical iPhone Safari golden-path pass with device/date notes.",
      pasteBackTemplate:
        "iPhone Safari verified on <device> at YYYY-MM-DDTHH:MM:SSZ. Board, Season, Money, Roster, Admin, closeout/export links all usable. Marked in Admin > Launch Gates.",
      intakePath: "Admin > Launch Gates",
      ...sourceFor(sourceEntries, "iphone-safari-gate"),
      relatedTaskId: iphoneTask.id,
    });
  }

  return {
    summary: gapSummary(items),
    items,
  };
}

export function buildEvidenceGapPacketText(packet: EvidenceGapPacket) {
  if (packet.items.length === 0) {
    return "DJDI Evidence Gap Packet\nNo unresolved evidence gaps.";
  }

  return [
    "DJDI Evidence Gap Packet",
    `Total gaps: ${packet.summary.total}`,
    `One-Paste Intake ready: ${packet.summary.onePasteReady}`,
    `Launch verification gaps: ${packet.summary.launchVerification}`,
    "",
    ...packet.items.flatMap((item, index) => [
      `[${index + 1}. ${item.label}]`,
      `Area: ${item.area}`,
      `Blocker: ${item.blockerId}`,
      `Owner: ${item.owner}`,
      `Need: ${item.requestedEvidence}`,
      `Paste back: ${item.pasteBackTemplate}`,
      `Intake: ${item.intakePath}`,
      `Source search: ${item.sourceStatus} - ${item.sourceDecision}`,
      "",
    ]),
  ].join("\n");
}
