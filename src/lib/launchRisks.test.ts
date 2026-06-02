import { describe, expect, it } from "vitest";
import { buildLaunchRisks } from "./launchRisks";
import type { Buyin, Player, Tournament } from "./types";

const players: Player[] = [
  {
    name: "Alex",
    handicap: 4,
    handicapSource: "GHIN lookup",
    handicapVerifiedAt: "now",
    handicapVerifiedBy: "Commissioner",
    member: true,
    updatedAt: "now",
  },
  { name: "Blake", handicap: null, member: true, updatedAt: "now" },
  { name: "Guest", handicap: 12, member: false, updatedAt: "now" },
];

const buyins: Buyin[] = [
  {
    playerName: "Alex",
    amount: 325,
    paid: true,
    paidAt: "now",
    notes: "Cash receipt",
    updatedAt: "now",
  },
  {
    playerName: "Blake",
    amount: 325,
    paid: false,
    paidAt: null,
    notes: null,
    updatedAt: "now",
  },
];

const tournaments: Tournament[] = [
  {
    id: "major",
    name: "Mid-season major",
    course: "TBD",
    windowStart: "2026-07-01",
    windowEnd: "2026-07-10",
    type: "major",
    pointsToFirst: 0,
    payoutFirst: null,
    payoutSecond: null,
    payoutThird: null,
    notes: "Course TBD.",
    createdAt: "now",
  },
];

function sourcedPlayers() {
  return players.map((player) =>
    player.member
      ? {
          ...player,
          handicap: player.handicap ?? 5,
          handicapSource: player.handicapSource ?? "GHIN lookup",
          handicapVerifiedAt: player.handicapVerifiedAt ?? "now",
          handicapVerifiedBy: player.handicapVerifiedBy ?? "Commissioner",
        }
      : player
  );
}

describe("buildLaunchRisks", () => {
  it("tracks data and external league checklist items without treating them all as blockers", () => {
    const risks = buildLaunchRisks({
      players,
      buyins,
      tournaments,
      ruleBlockerCount: 2,
      accessCodeRequired: false,
      dockerBuildVerified: false,
      tailnetServeVerified: false,
      productionUrlVerified: false,
      mobileSafariVerified: false,
    });

    expect(risks.map((risk) => `${risk.severity}:${risk.label}`)).toEqual([
      "blocker:Score review",
      "risk:Buy-in tracking",
      "risk:Handicap records",
      "risk:Schedule confirmation",
      "external:Access code",
      "external:Docker image build",
      "external:Tailnet URL",
      "external:iPhone Safari",
    ]);
    expect(risks.find((risk) => risk.label === "Buy-in tracking")?.detail).toBe(
      "$325 outstanding"
    );
    expect(
      risks.find((risk) => risk.label === "Buy-in tracking")?.nextAction
    ).toBe("Open Money and update status evidence or leave open: Blake.");
    expect(
      risks.find((risk) => risk.label === "Handicap records")?.nextAction
    ).toBe("Open Roster and record source-backed handicap indexes for Blake.");
    expect(
      risks.find((risk) => risk.label === "Schedule confirmation")?.nextAction
    ).toBe(
      "Open Admin Schedule Confirmation and replace TBD details for Mid-season major."
    );
    expect(
      risks.find((risk) => risk.label === "iPhone Safari")?.nextAction
    ).toContain("Open the deployed URL on iPhone Safari");
    expect(risks.map((risk) => risk.id)).not.toContain("production-url");
  });

  it("flags the public production URL only when that optional gate is required", () => {
    const risks = buildLaunchRisks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        paidAt: "now",
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: [{ ...tournaments[0], course: "Common Ground", notes: "Confirmed." }],
      ruleBlockerCount: 0,
      accessCodeRequired: true,
      dockerBuildVerified: true,
      tailnetServeVerified: true,
      productionUrlRequired: true,
      productionUrlVerified: false,
      mobileSafariVerified: true,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        id: "production-url",
        severity: "external",
        label: "Public production URL",
        nextAction: expect.stringContaining("commissioner codes"),
      }),
    ]);
  });

  it("returns no risks when data is complete and external gates are verified", () => {
    expect(
      buildLaunchRisks({
        players: sourcedPlayers(),
        buyins: buyins.map((buyin) => ({
          ...buyin,
          paid: true,
          paidAt: "now",
          notes: buyin.notes ?? "Cash receipt",
        })),
        tournaments: [
          {
            ...tournaments[0],
            course: "Common Ground",
            notes: "Confirmed.",
          },
        ],
        ruleBlockerCount: 0,
        accessCodeRequired: true,
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      })
    ).toEqual([]);
  });

  it("flags payment-like notes on unpaid buy-ins without treating them as paid", () => {
    const risks = buildLaunchRisks({
      players: sourcedPlayers(),
      buyins: [
        {
          playerName: "Matt",
          amount: 325,
          paid: false,
          paidAt: null,
          notes: "venmo",
          updatedAt: "now",
        },
      ],
      tournaments: [
        {
          ...tournaments[0],
          course: "Common Ground",
          notes: "Confirmed.",
        },
      ],
      ruleBlockerCount: 0,
      accessCodeRequired: true,
      dockerBuildVerified: true,
      tailnetServeVerified: true,
      productionUrlVerified: true,
      mobileSafariVerified: true,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        id: "money-collection",
        label: "Buy-in tracking",
        detail: "$325 outstanding",
      }),
      expect.objectContaining({
        id: "payment-note-review",
        label: "Payment note review",
        detail: "1 unpaid row with payment-like notes: Matt",
        nextAction: "Open Money and confirm status evidence or clear notes for Matt.",
      }),
    ]);
  });

  it("flags paid buy-ins that are missing evidence notes", () => {
    const risks = buildLaunchRisks({
      players: sourcedPlayers(),
      buyins: [
        {
          playerName: "Matt",
          amount: 325,
          paid: true,
          paidAt: "2026-05-19T18:16:04.946Z",
          notes: null,
          updatedAt: "now",
        },
      ],
      tournaments: [
        {
          ...tournaments[0],
          course: "Common Ground",
          notes: "Confirmed.",
        },
      ],
      ruleBlockerCount: 0,
      accessCodeRequired: true,
      dockerBuildVerified: true,
      tailnetServeVerified: true,
      productionUrlVerified: true,
      mobileSafariVerified: true,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        id: "payment-evidence-review",
        label: "Payment evidence review",
        detail: "1 paid row missing evidence notes: Matt",
        nextAction: "Open Money and add receipt/source notes for Matt.",
      }),
    ]);
  });

  it("flags paid tournament payouts that are missing settlement notes", () => {
    const risks = buildLaunchRisks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: [
        {
          ...tournaments[0],
          course: "Common Ground",
          notes: "Confirmed.",
          closedAt: "2026-07-15T22:00:00.000Z",
          payoutConfirmed: true,
          payoutPaidAt: "2026-07-15T23:00:00.000Z",
          closeoutNotes: null,
        },
      ],
      ruleBlockerCount: 0,
      accessCodeRequired: true,
      dockerBuildVerified: true,
      tailnetServeVerified: true,
      productionUrlVerified: true,
      mobileSafariVerified: true,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        id: "payout-evidence-review",
        label: "Payout evidence review",
        detail: "1 paid payout missing settlement notes: Mid-season major",
        nextAction:
          "Open Tournament Closeout and add settlement notes for Mid-season major.",
      }),
    ]);
  });
});
