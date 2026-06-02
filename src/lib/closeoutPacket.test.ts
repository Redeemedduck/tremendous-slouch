import { describe, expect, it } from "vitest";
import { buildCloseoutPacket } from "./closeoutPacket";
import { ACTIVE_RULES_VERSION } from "./leagueRules";
import type { Player, TeeTime, Tournament } from "./types";

const players: Player[] = [
  { name: "Alex", handicap: 4, member: true, updatedAt: "now" },
  { name: "Blake", handicap: 9, member: true, updatedAt: "now" },
  { name: "Guest", handicap: 18, member: false, updatedAt: "now" },
];

const tournament: Tournament = {
  id: "w1",
  name: "Stop 1",
  course: "Common Ground",
  windowStart: "2026-05-01",
  windowEnd: "2026-05-24",
  type: "regular",
  pointsToFirst: 100,
  payoutFirst: 334,
  payoutSecond: null,
  payoutThird: null,
  notes: null,
  createdAt: "now",
  closedAt: null,
  closedBy: null,
  winnerSnapshot: [],
  payoutConfirmed: false,
  payoutPaidAt: null,
  closeoutNotes: null,
};

const teeTime: TeeTime = {
  id: "tt",
  course: "Common Ground",
  date: "2026-05-18",
  time: "09:00",
  spots: 4,
  host: "Alex",
  notes: null,
  claims: [
    { name: "Alex", claimedAt: "now" },
    { name: "Blake", claimedAt: "now" },
  ],
  interested: [],
  scores: [
    {
      name: "Alex",
      gross: 80,
      courseHcp: 5,
      attestedBy: "Blake",
      attestationStatus: "attested",
      attestedAt: "2026-05-18T19:00:00.000Z",
      attestationActor: "Blake",
      recordedAt: "now",
    },
    {
      name: "Blake",
      gross: 83,
      courseHcp: 9,
      attestedBy: "Alex",
      attestationStatus: "attested",
      attestedAt: "2026-05-18T19:05:00.000Z",
      attestationActor: "Alex",
      recordedAt: "now",
    },
  ],
  comments: [],
  createdAt: "now",
};

const getHandicap = (name: string) =>
  players.find((player) => player.name === name)?.handicap ?? null;

describe("buildCloseoutPacket", () => {
  it("renders leaderboard, score evidence, payout state, and readiness", () => {
    const packet = buildCloseoutPacket({
      tournament,
      tournaments: [tournament],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(packet).toContain("DJDI Tournament Closeout Packet");
    expect(packet).toContain(`Rules version: ${ACTIVE_RULES_VERSION}`);
    expect(packet).toContain("Tournament: Stop 1");
    expect(packet).toContain("Status: ready - Ready to close");
    expect(packet).toContain("Payouts: 1st $334, 2nd -, 3rd -");
    expect(packet).toContain("Payout evidence: not required until paid");
    expect(packet).toContain("1. Blake: 83 gross, 74 net");
    expect(packet).toContain("2026-05-18 09:00 Common Ground (Alex)");
    expect(packet).toContain("Claims: Alex, Blake");
    expect(packet).toContain(
      "- Alex (member): 80 gross, CH 5, net 75, official:attested, attested by Blake"
    );
    expect(packet).toContain("Score Review\nNone");
  });

  it("labels pending score evidence as not official", () => {
    const packet = buildCloseoutPacket({
      tournament,
      tournaments: [tournament],
      teeTimes: [
        {
          ...teeTime,
          scores: [
            {
              name: "Alex",
              gross: 80,
              courseHcp: 5,
              attestedBy: "Blake",
              attestationStatus: "pending",
              recordedAt: "now",
            },
          ],
        },
      ],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(packet).toContain(
      "- Alex (member): 80 gross, CH 5, net 75, not official:pending, attested by Blake"
    );
    expect(packet).toContain("Alex: Score attestation is still pending");
  });

  it("prints score review items for incomplete scored groups", () => {
    const packet = buildCloseoutPacket({
      tournament,
      tournaments: [tournament],
      teeTimes: [
        {
          ...teeTime,
          scores: [
            {
              name: "Alex",
              gross: 80,
              courseHcp: 5,
              attestedBy: "Blake",
              attestationStatus: "attested",
              attestedAt: "2026-05-18T19:00:00.000Z",
              attestationActor: "Blake",
              recordedAt: "now",
            },
          ],
        },
      ],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(packet).toContain("Status: blocked - 1 score review item");
    expect(packet).toContain("Blake: Missing score");
    expect(packet).toContain("Closeout action: Blocked. Finish score review before closeout.");
  });

  it("prints payout settlement evidence state", () => {
    const paid = {
      ...tournament,
      payoutConfirmed: true,
      payoutPaidAt: "2026-05-25T13:00:00.000Z",
      closeoutNotes: null,
    };
    const packet = buildCloseoutPacket({
      tournament: paid,
      tournaments: [paid],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(packet).toContain("Payout evidence: missing settlement note");

    const evidenced = buildCloseoutPacket({
      tournament: {
        ...paid,
        closeoutNotes: "Scores reviewed",
        payoutEvidenceNote: "Venmo paid Blake 2026-05-25",
      },
      tournaments: [paid],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });
    expect(evidenced).toContain(
      "Payout evidence: Venmo paid Blake 2026-05-25"
    );
  });
});
