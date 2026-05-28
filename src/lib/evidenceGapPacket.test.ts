import { describe, expect, it } from "vitest";
import { buildCommissionerTasks } from "./commissionerTasks";
import {
  buildEvidenceGapPacket,
  buildEvidenceGapPacketText,
} from "./evidenceGapPacket";
import { SOURCE_SEARCH_LEDGER } from "./sourceSearchLedger";
import type { Buyin, Player, Tournament } from "./types";

const players: Player[] = [
  { name: "Beck", handicap: null, member: true, updatedAt: "2026-01-01" },
  {
    name: "Matt",
    handicap: 5.5,
    handicapSource: "GHIN lookup",
    handicapVerifiedAt: "2026-05-14",
    handicapVerifiedBy: "Commissioner",
    member: true,
    updatedAt: "2026-05-14",
  },
];

const buyins: Buyin[] = [
  {
    playerName: "Beck",
    amount: 325,
    paid: false,
    paidAt: null,
    notes: null,
    updatedAt: "2026-01-01",
  },
  {
    playerName: "Matt",
    amount: 325,
    paid: true,
    paidAt: "2026-05-18T00:00:00.000Z",
    notes: "Venmo receipt",
    updatedAt: "2026-05-18T00:00:00.000Z",
  },
];

const tournaments: Tournament[] = [
  {
    id: "mid-season-major",
    name: "Mid-season major",
    course: "TBD",
    windowStart: "2026-07-01",
    windowEnd: "2026-07-31",
    type: "major",
    pointsToFirst: 150,
    payoutFirst: 334,
    payoutSecond: null,
    payoutThird: null,
    notes: "TBD course.",
    createdAt: "2026-01-01",
  },
];

describe("evidence gap packet", () => {
  it("separates every unresolved data and launch proof into paste-back rows", () => {
    const tasks = buildCommissionerTasks({
      players,
      buyins,
      tournaments,
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlRequired: true,
        productionUrlVerified: false,
        mobileSafariVerified: false,
      },
    });

    const packet = buildEvidenceGapPacket({
      players,
      buyins,
      tournaments,
      tasks,
      sourceEntries: SOURCE_SEARCH_LEDGER,
    });

    expect(packet.summary).toMatchObject({
      total: 5,
      onePasteReady: 3,
      launchVerification: 2,
      money: 1,
      roster: 1,
      schedule: 1,
      launch: 2,
    });
    expect(packet.items.map((item) => item.id)).toEqual([
      "money-beck",
      "ghin-beck",
      "schedule-mid-season-major",
      "launch-production-url",
      "launch-iphone-safari",
    ]);
    expect(packet.items[0]).toMatchObject({
      blockerId: "money-collected",
      intakePath: "Admin > One-Paste Intake",
      sourceStatus: "blocked",
      pasteBackTemplate: expect.stringContaining("Beck paid $325"),
    });
    expect(
      packet.items.find((item) => item.id === "launch-production-url")
        ?.intakePath
    ).toBe("Admin > Launch Gates");

    const text = buildEvidenceGapPacketText(packet);
    expect(text).toContain("DJDI Evidence Gap Packet");
    expect(text).toContain("One-Paste Intake ready: 3");
    expect(text).toContain("Paste back: Beck handicap index <number>");
    expect(text).toContain("Production URL verified: https://<final-url>");
  });

  it("renders an empty packet when no evidence gaps remain", () => {
    const packet = buildEvidenceGapPacket({
      players: players.map((player) =>
        player.member
          ? {
              ...player,
              handicap: 5,
              handicapSource: player.handicapSource ?? "GHIN lookup",
              handicapVerifiedAt: player.handicapVerifiedAt ?? "2026-05-14",
              handicapVerifiedBy: player.handicapVerifiedBy ?? "Commissioner",
            }
          : player
      ),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "Common Ground",
        notes: "Confirmed.",
      })),
      tasks: [],
      sourceEntries: SOURCE_SEARCH_LEDGER,
    });

    expect(packet.summary.total).toBe(0);
    expect(buildEvidenceGapPacketText(packet)).toBe(
      "DJDI Evidence Gap Packet\nNo unresolved evidence gaps."
    );
  });
});
