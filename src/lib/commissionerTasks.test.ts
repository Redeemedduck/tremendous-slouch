import { describe, expect, it } from "vitest";
import {
  buildCommissionerRequestPacket,
  buildCommissionerTaskSummary,
  buildCommissionerTasks,
} from "./commissionerTasks";
import type { Buyin, Player, Tournament } from "./types";

const players: Player[] = [
  { name: "Beck", handicap: null, member: true, updatedAt: "2026-01-01" },
  {
    name: "Jayson Post",
    handicap: 10.6,
    handicapSource: "GHIN lookup",
    handicapVerifiedAt: "2026-01-01",
    handicapVerifiedBy: "Commissioner",
    member: true,
    updatedAt: "2026-01-01",
  },
  { name: "Drop In", handicap: null, member: false, updatedAt: "2026-01-01" },
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
    playerName: "Jayson Post",
    amount: 325,
    paid: true,
    paidAt: "2026-05-01T00:00:00.000Z",
    notes: "Venmo receipt",
    updatedAt: "2026-05-01T00:00:00.000Z",
  },
];

const tournaments: Tournament[] = [
  {
    id: "major",
    name: "Mid-season major",
    course: "TBD",
    windowStart: "2026-07-15",
    windowEnd: "2026-07-15",
    type: "major",
    pointsToFirst: null,
    payoutFirst: null,
    payoutSecond: null,
    payoutThird: null,
    notes: "TBD.",
    createdAt: "2026-01-01",
  },
];

function sourcedPlayers() {
  return players.map((player) =>
    player.member
      ? {
          ...player,
          handicap: player.handicap ?? 8,
          handicapSource: player.handicapSource ?? "GHIN lookup",
          handicapVerifiedAt: player.handicapVerifiedAt ?? "2026-01-01",
          handicapVerifiedBy: player.handicapVerifiedBy ?? "Commissioner",
        }
      : player
  );
}

describe("buildCommissionerTasks", () => {
  it("turns score review items into a concrete Admin attestation action", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "CommonGround Golf Course",
        notes: "Confirmed.",
      })),
      ruleIssues: [
        {
          id: "tee-1:jayson:legacy-attestation",
          severity: "blocker",
          teeTimeId: "tee-1",
          tournamentId: "2026-w1",
          tournamentName: "Stop 1",
          date: "2026-05-18",
          time: "12:50",
          course: "Common Ground",
          player: "Jayson Post",
          message: "Legacy score needs attestation confirmation",
        },
      ],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual(["fix-rule-blockers"]);
    expect(tasks[0]).toMatchObject({
      area: "rules",
      severity: "blocker",
      nextAction:
        "Open Score Review and confirm or override each pending score.",
      copyText: expect.stringContaining("Admin > Score Review"),
    });
    expect(tasks[0].copyText).toContain(
      "2026-05-18 Stop 1: Jayson Post — Legacy score needs attestation confirmation"
    );
    expect(tasks.every((task) => task.copyText)).toBe(true);
  });

  it("turns unresolved launch and data gaps into actionable tasks", () => {
    const tasks = buildCommissionerTasks({
      players,
      buyins,
      tournaments,
      ruleIssues: [],
      accessCodeRequired: false,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: false,
        productionUrlVerified: false,
        mobileSafariVerified: false,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual([
      "collect-buyins",
      "collect-ghin-indexes",
      "confirm-schedule",
      "set-access-code",
      "verify-tailnet-url",
      "verify-iphone-safari",
    ]);
    expect(tasks.find((task) => task.id === "collect-buyins")).toMatchObject({
      area: "money",
      severity: "risk",
      detail: "$325 outstanding across 1 player.",
      copyText: expect.stringContaining("Outstanding total: $325"),
    });
    expect(tasks.find((task) => task.id === "collect-ghin-indexes")).toMatchObject({
      area: "roster",
      items: ["Beck"],
      copyText: expect.stringContaining("DJDI handicap records still needed"),
    });
    expect(tasks.find((task) => task.id === "confirm-schedule")).toMatchObject({
      area: "schedule",
      items: ["Mid-season major"],
      copyText: expect.stringContaining("DJDI schedule details still needed"),
    });
    expect(tasks.find((task) => task.id === "set-access-code")).toMatchObject({
      area: "access",
      copyText: expect.stringContaining("fly secrets set ACCESS_CODE"),
    });
    expect(tasks.find((task) => task.id === "verify-iphone-safari")).toMatchObject({
      area: "launch",
      copyText: expect.stringContaining(
        "DJDI physical iPhone Safari verification"
      ),
    });
    expect(tasks.find((task) => task.id === "verify-tailnet-url")).toMatchObject({
      area: "launch",
      copyText: expect.stringContaining(
        "REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net/golf"
      ),
    });
    expect(tasks.find((task) => task.id === "verify-tailnet-url")).toMatchObject({
      copyText: expect.stringContaining(
        "REMOTE_MOBILE_COMMISSIONER_CODE=<commissioner-code>"
      ),
    });
    expect(tasks.every((task) => task.copyText)).toBe(true);
    expect(tasks.map((task) => task.id)).not.toContain("verify-docker");

    expect(buildCommissionerTaskSummary(tasks)).toContain(
      "1. Track buy-in status (risk): $325 outstanding across 1 player."
    );

    const requestPacket = buildCommissionerRequestPacket(tasks);
    expect(requestPacket).toContain("DJDI request packet");
    expect(requestPacket).toContain("[1. Track buy-in status]");
    expect(requestPacket).toContain("DJDI buy-in status tracker:");
    expect(requestPacket).toContain("[2. Record handicap indexes]");
    expect(requestPacket).toContain("DJDI handicap records still needed:");
    expect(requestPacket).toContain("[3. Confirm schedule details]");
    expect(requestPacket).toContain("DJDI schedule details still needed:");
    expect(requestPacket).toContain("Paste replies back into Ops > One-Paste Intake");
    expect(requestPacket).not.toContain("Tailnet board URL");
  });

  it("includes the verified tailnet board link without requiring public production", () => {
    const tasks = buildCommissionerTasks({
      players,
      buyins,
      tournaments,
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: false,
        mobileSafariVerified: false,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual([
      "collect-buyins",
      "collect-ghin-indexes",
      "confirm-schedule",
      "verify-iphone-safari",
    ]);

    const requestPacket = buildCommissionerRequestPacket(tasks);
    expect(requestPacket).toContain(
      "Primary phone URL for people with Tailscale access: http://100.102.92.28:3131/golf"
    );
    expect(requestPacket).toContain(
      "Clean MagicDNS URL, if iPhone DNS is working: https://duckbookpro.clouded-tailor.ts.net/golf"
    );
    expect(requestPacket).toContain(
      "Private Tailscale hosting is the working access path"
    );
    expect(requestPacket).not.toContain("DJDI public production URL unblocker");
  });

  it("adds the public production URL task when that optional gate is required", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        paidAt: "2026-01-02",
        notes: "Cash receipt",
      })),
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "Common Ground",
        notes: "Confirmed.",
      })),
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlRequired: true,
        productionUrlVerified: false,
        mobileSafariVerified: true,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual(["verify-production-url"]);
    expect(tasks[0]).toMatchObject({
      area: "launch",
      title: "Verify public production URL",
      copyText: expect.stringContaining("DJDI public production URL unblocker"),
      items: expect.arrayContaining([
        "fly auth login",
        "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131",
      ]),
    });
    const requestPacket = buildCommissionerRequestPacket(tasks);
    expect(requestPacket).toContain("DJDI public production URL unblocker");
    expect(requestPacket).toContain(
      "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131"
    );
  });

  it("returns no tasks when league data and launch gates are clear", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "CommonGround Golf Course",
        notes: "Confirmed.",
      })),
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      },
    });

    expect(tasks).toEqual([]);
    expect(buildCommissionerTaskSummary(tasks)).toBe(
      "DJDI commissioner tasks:\nNo open tasks."
    );
    expect(buildCommissionerRequestPacket(tasks)).toBe(
      "DJDI request packet:\nNo outbound asks are open."
    );
  });

  it("flags payment-like notes on unpaid buy-ins for review", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: [
        {
          playerName: "Matt",
          amount: 325,
          paid: false,
          paidAt: null,
          notes: "venmo",
          updatedAt: "2026-05-19T18:16:04.946Z",
        },
      ],
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "CommonGround Golf Course",
        notes: "Confirmed.",
      })),
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual([
      "collect-buyins",
      "review-payment-notes",
    ]);
    expect(tasks.find((task) => task.id === "review-payment-notes")).toMatchObject({
      area: "money",
      severity: "risk",
      detail: "1 unpaid buy-in row has payment-like notes.",
      nextAction: "Confirm status evidence or clear the note: Matt.",
      items: ["Matt: venmo"],
      copyText: expect.stringContaining("Matt: venmo"),
    });
    expect(buildCommissionerRequestPacket(tasks)).toContain(
      "[2. Review payment notes]"
    );
  });

  it("flags paid buy-ins without evidence notes for review", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: [
        {
          playerName: "Matt",
          amount: 325,
          paid: true,
          paidAt: "2026-05-19T18:16:04.946Z",
          notes: null,
          updatedAt: "2026-05-19T18:16:04.946Z",
        },
      ],
      tournaments: tournaments.map((tournament) => ({
        ...tournament,
        course: "CommonGround Golf Course",
        notes: "Confirmed.",
      })),
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual(["review-payment-evidence"]);
    expect(tasks[0]).toMatchObject({
      area: "money",
      severity: "risk",
      title: "Add paid evidence notes",
      detail: "1 paid buy-in row is missing evidence notes.",
      nextAction:
        "Add receipt/source notes already confirmed outside the app for Matt.",
      items: ["Matt: paid at 2026-05-19T18:16:04.946Z, evidence note missing"],
      copyText: expect.stringContaining("DJDI paid buy-in evidence review"),
    });
  });

  it("flags paid tournament payouts without settlement notes for review", () => {
    const tasks = buildCommissionerTasks({
      players: sourcedPlayers(),
      buyins: buyins.map((buyin) => ({
        ...buyin,
        paid: true,
        notes: buyin.notes ?? "Cash receipt",
      })),
      tournaments: [
        {
          ...tournaments[0],
          course: "CommonGround Golf Course",
          notes: "Confirmed.",
          closedAt: "2026-07-15T22:00:00.000Z",
          payoutConfirmed: true,
          payoutPaidAt: "2026-07-15T23:00:00.000Z",
          closeoutNotes: null,
        },
      ],
      ruleIssues: [],
      accessCodeRequired: true,
      launchChecks: {
        dockerBuildVerified: true,
        tailnetServeVerified: true,
        productionUrlVerified: true,
        mobileSafariVerified: true,
      },
    });

    expect(tasks.map((task) => task.id)).toEqual(["review-payout-evidence"]);
    expect(tasks[0]).toMatchObject({
      area: "closeout",
      severity: "risk",
      title: "Add payout settlement notes",
      detail: "1 paid payout is missing settlement notes.",
      nextAction: "Add settlement notes for Mid-season major.",
      items: [
        "Mid-season major: paid at 2026-07-15T23:00:00.000Z, settlement note missing",
      ],
      copyText: expect.stringContaining(
        "Paid tournament payouts need settlement notes"
      ),
    });
  });
});
