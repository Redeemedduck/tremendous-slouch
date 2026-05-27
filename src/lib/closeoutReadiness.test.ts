import { describe, expect, it } from "vitest";
import { buildCloseoutReadiness } from "./closeoutReadiness";
import type { Player, TeeTime, Tournament } from "./types";

const players: Player[] = [
  { name: "Alex", handicap: 4, member: true, updatedAt: "now" },
  { name: "Blake", handicap: 9, member: true, updatedAt: "now" },
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

function teeTime(overrides: Partial<TeeTime> = {}): TeeTime {
  const tee: TeeTime = {
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
    scores: [],
    comments: [],
    createdAt: "now",
    ...overrides,
  };
  return {
    ...tee,
    scores: tee.scores.map((score) => ({
      ...score,
      attestationStatus: score.attestationStatus ?? "attested",
      attestedAt: score.attestedAt ?? "2026-05-18T19:00:00.000Z",
      attestationActor: score.attestationActor ?? score.attestedBy ?? "Test",
    })),
  };
}

const getHandicap = (name: string) =>
  players.find((player) => player.name === name)?.handicap ?? null;

describe("buildCloseoutReadiness", () => {
  it("keeps future windows from being labeled active", () => {
    const t = tournament({ windowStart: "2026-06-01", windowEnd: "2026-06-15" });
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [],
      players,
      today: "2026-05-19",
      getHandicap,
    });

    expect(readiness.status).toBe("upcoming");
    expect(readiness.buttonLabel).toBe("Upcoming");
    expect(readiness.detail).toBe("Window opens 2026-06-01");
  });

  it("keeps active windows from closing even with a leader", () => {
    const t = tournament();
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [
        teeTime({
          scores: [
            { name: "Alex", gross: 80, courseHcp: 5, attestedBy: "Blake", recordedAt: "now" },
            { name: "Blake", gross: 83, courseHcp: 9, attestedBy: "Alex", recordedAt: "now" },
          ],
        }),
      ],
      players,
      today: "2026-05-19",
      getHandicap,
    });

    expect(readiness.status).toBe("active");
    expect(readiness.buttonLabel).toBe("Active");
    expect(readiness.board[0]?.name).toBe("Blake");
  });

  it("surfaces rule blockers after the window ends", () => {
    const t = tournament();
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [
        teeTime({
          scores: [
            { name: "Alex", gross: 80, courseHcp: 5, attestedBy: "Blake", recordedAt: "now" },
          ],
        }),
      ],
      players,
      today: "2026-05-25",
      getHandicap,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.detail).toBe("1 rule blocker");
    expect(readiness.issues.map((issue) => issue.message)).toContain("Missing score");
  });

  it("marks ended scored tournaments as ready", () => {
    const t = tournament();
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [
        teeTime({
          scores: [
            { name: "Alex", gross: 80, courseHcp: 5, attestedBy: "Blake", recordedAt: "now" },
            { name: "Blake", gross: 83, courseHcp: 9, attestedBy: "Alex", recordedAt: "now" },
          ],
        }),
      ],
      players,
      today: "2026-05-25",
      getHandicap,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.buttonLabel).toBe("Close");
    expect(readiness.payoutEvidence.status).toBe("not_paid");
  });

  it("uses current closeout math to identify the net winner before payout closeout", () => {
    const t = tournament();
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [
        teeTime({
          scores: [
            {
              name: "Alex",
              gross: 78,
              courseHcp: 5,
              attestedBy: "Blake",
              attestationStatus: "attested",
              recordedAt: "now",
            },
            {
              name: "Blake",
              gross: 84,
              courseHcp: 12,
              attestedBy: "Alex",
              attestationStatus: "attested",
              recordedAt: "now",
            },
          ],
        }),
      ],
      players,
      today: "2026-05-25",
      getHandicap,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.board.map((row) => `${row.position}:${row.name}:${row.bestNet}`)).toEqual([
      "1:Blake:72",
      "2:Alex:73",
    ]);
    expect(readiness.payoutEvidence.status).toBe("not_paid");
  });

  it("flags paid payouts that do not have settlement notes", () => {
    const t = tournament({
      closedAt: "2026-05-25T12:00:00.000Z",
      payoutConfirmed: true,
      payoutPaidAt: "2026-05-25T13:00:00.000Z",
      closeoutNotes: null,
    });
    const readiness = buildCloseoutReadiness({
      tournament: t,
      tournaments: [t],
      teeTimes: [],
      players,
      today: "2026-05-25",
      getHandicap,
    });

    expect(readiness.status).toBe("closed");
    expect(readiness.payoutEvidence).toMatchObject({
      status: "missing_evidence",
      missing: true,
      note: null,
    });
  });
});
