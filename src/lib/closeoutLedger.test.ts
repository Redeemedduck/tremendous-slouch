import { describe, expect, it } from "vitest";
import { buildCloseoutLedger } from "./closeoutLedger";
import { ACTIVE_RULES_VERSION } from "./leagueRules";
import type { Player, TeeTime, Tournament } from "./types";

const players: Player[] = [
  { name: "Alex", handicap: 4, member: true, updatedAt: "now" },
  { name: "Blake", handicap: 9, member: true, updatedAt: "now" },
  { name: "Guest", handicap: 18, member: false, updatedAt: "now" },
];

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
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
    ...overrides,
  };
}

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
      attestedAt: "2026-05-18T18:00:00.000Z",
      attestationActor: "Blake",
      recordedAt: "2026-05-18T17:00:00.000Z",
    },
    {
      name: "Blake",
      gross: 83,
      courseHcp: 9,
      attestedBy: "Alex",
      attestationStatus: "attested",
      attestedAt: "2026-05-18T18:05:00.000Z",
      attestationActor: "Alex",
      recordedAt: "2026-05-18T17:05:00.000Z",
    },
  ],
  comments: [],
  createdAt: "now",
};

const getHandicap = (name: string) =>
  players.find((player) => player.name === name)?.handicap ?? null;

describe("buildCloseoutLedger", () => {
  it("exports structured closeout evidence and attestation validity signals", () => {
    const ledger = buildCloseoutLedger({
      tournament: tournament(),
      tournaments: [tournament()],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(ledger).toMatchObject({
      app: "DJDI Golf Board",
      version: 1,
      rulesVersion: ACTIVE_RULES_VERSION,
      readiness: {
        status: "ready",
        readyToClose: true,
        issueCount: 0,
      },
      payout: {
        first: 334,
        evidenceStatus: "not_paid",
        evidenceMissing: false,
        projectedWinner: {
          name: "Blake",
          bestNet: 74,
        },
      },
      integrity: {
        rulesVersion: ACTIVE_RULES_VERSION,
        closed: false,
        snapshotMatchesCurrent: null,
        scoreEvidenceRows: 2,
        ruleBlockers: 0,
        payoutEvidenceMissing: false,
      },
    });
    expect(ledger.scoreEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teeTimeId: "tt",
          player: "Alex",
          member: true,
          scorerClaimed: true,
          courseHcp: 5,
          profileHcp: 4,
          net: 75,
          netSource: "course_hcp",
          attestationStatus: "attested",
          official: true,
          attestedAt: "2026-05-18T18:00:00.000Z",
          attestationActor: "Blake",
          attestedBy: "Blake",
          attesterMember: true,
          attesterClaimed: true,
          selfAttested: false,
        }),
      ])
    );
  });

  it("exports pending score evidence without marking it official", () => {
    const ledger = buildCloseoutLedger({
      tournament: tournament(),
      tournaments: [tournament()],
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
              attestedAt: null,
              recordedAt: "2026-05-18T17:00:00.000Z",
            },
          ],
        },
      ],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(ledger.readiness.status).toBe("blocked");
    expect(ledger.scoreEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player: "Alex",
          attestationStatus: "pending",
          official: false,
          attestedAt: null,
          attestedBy: "Blake",
        }),
      ])
    );
    expect(ledger.leaderboard).toEqual([]);
  });

  it("blocks closeout when a guest has a league score while preserving evidence", () => {
    const ledger = buildCloseoutLedger({
      tournament: tournament(),
      tournaments: [tournament()],
      teeTimes: [
        {
          ...teeTime,
          claims: [
            { name: "Alex", claimedAt: "now" },
            { name: "Guest", claimedAt: "now" },
          ],
          scores: [
            {
              name: "Guest",
              gross: 78,
              courseHcp: 18,
              attestedBy: "Alex",
              attestationStatus: "attested",
              attestedAt: "2026-05-18T18:00:00.000Z",
              attestationActor: "Alex",
              recordedAt: "2026-05-18T17:00:00.000Z",
            },
          ],
        },
      ],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(ledger.readiness).toMatchObject({
      status: "blocked",
      readyToClose: false,
      issueCount: 2,
    });
    expect(ledger.ruleBlockers.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Scored player is not marked as a member",
        "Missing score",
      ])
    );
    expect(ledger.scoreEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player: "Guest",
          member: false,
          scorerClaimed: true,
          official: true,
          attestationStatus: "attested",
          attesterMember: true,
          attesterClaimed: true,
        }),
      ])
    );
  });

  it("flags whether a closed winner snapshot still matches current evidence", () => {
    const closed = tournament({
      closedAt: "2026-05-25T12:00:00.000Z",
      closedBy: "Alex",
      winnerSnapshot: [
        {
          position: 1,
          name: "Blake",
          rounds: 1,
          bestGross: 83,
          bestNet: 74,
          netFromCourseHcp: true,
        },
        {
          position: 2,
          name: "Alex",
          rounds: 1,
          bestGross: 80,
          bestNet: 75,
          netFromCourseHcp: true,
        },
      ],
    });
    const ledger = buildCloseoutLedger({
      tournament: closed,
      tournaments: [closed],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
      exportedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(ledger.integrity.closed).toBe(true);
    expect(ledger.integrity.snapshotMatchesCurrent).toBe(true);
  });

  it("exports missing and present payout settlement evidence", () => {
    const paidWithoutNote = tournament({
      closedAt: "2026-05-25T12:00:00.000Z",
      payoutConfirmed: true,
      payoutPaidAt: "2026-05-25T13:00:00.000Z",
      closeoutNotes: null,
    });
    const missing = buildCloseoutLedger({
      tournament: paidWithoutNote,
      tournaments: [paidWithoutNote],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
    });
    expect(missing.payout).toMatchObject({
      evidenceStatus: "missing_evidence",
      evidenceNote: null,
      evidenceMissing: true,
    });
    expect(missing.integrity.payoutEvidenceMissing).toBe(true);

    const paidWithNote = tournament({
      closedAt: "2026-05-25T12:00:00.000Z",
      payoutConfirmed: true,
      payoutPaidAt: "2026-05-25T13:00:00.000Z",
      closeoutNotes: "Scores reviewed",
      payoutEvidenceNote: "Venmo paid Blake 2026-05-25",
    });
    const evidenced = buildCloseoutLedger({
      tournament: paidWithNote,
      tournaments: [paidWithNote],
      teeTimes: [teeTime],
      players,
      today: "2026-05-25",
      getHandicap,
    });
    expect(evidenced.payout).toMatchObject({
      evidenceStatus: "evidenced",
      evidenceNote: "Venmo paid Blake 2026-05-25",
      evidenceMissing: false,
    });
  });
});
