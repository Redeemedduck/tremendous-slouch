import { describe, expect, it } from "vitest";
import {
  computeSeasonPoints,
  computeStandings,
  pointsForPosition,
  sortStandings,
  type StandingRow,
} from "./standings";
import { ACTIVE_RULES_VERSION } from "./leagueRules";
import type { Score, TeeTime, Tournament } from "./types";

function tournament(
  id: string,
  type: Tournament["type"],
  windowStart: string,
  windowEnd = windowStart
): Tournament {
  return {
    id,
    name: id,
    course: "Common Ground",
    windowStart,
    windowEnd,
    type,
    pointsToFirst: type === "regular" ? 100 : null,
    payoutFirst: null,
    payoutSecond: null,
    payoutThird: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function teeTime(id: string, date: string, scores: Score[]): TeeTime {
  return {
    id,
    course: "Common Ground",
    date,
    time: "09:00",
    spots: 4,
    host: "Greg",
    notes: null,
    claims: [],
    interested: [],
    scores: scores.map((score) => ({
      ...score,
      attestationStatus: score.attestationStatus ?? "attested",
      attestedAt: score.attestedAt ?? "2026-04-03T19:00:00.000Z",
      attestationActor: score.attestationActor ?? score.attestedBy ?? "Test",
    })),
    comments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function row(
  name: string,
  seasonPoints: number,
  avgNet: number | null,
  rounds: number
): StandingRow {
  return {
    rulesVersion: ACTIVE_RULES_VERSION,
    name,
    rounds,
  totalGross: 0,
  avgGross: 0,
  bestGross: 0,
    totalNet: avgNet == null ? null : avgNet * rounds,
    avgNet,
    bestNet: avgNet,
    seasonPoints,
    scoreStatusCounts: {
      total: rounds,
      official: rounds,
      draft: 0,
      pending: 0,
      attested: rounds,
      overridden: 0,
      legacyUnconfirmed: 0,
    },
  };
}

describe("standings rules", () => {
  it("awards regular-event points by leaderboard rank", () => {
    const points = computeSeasonPoints(
      [tournament("regular-1", "regular", "2026-04-03")],
      [
        teeTime("tee-1", "2026-04-03", [
          {
            name: "First",
            gross: 80,
            courseHcp: 12,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Second",
            gross: 82,
            courseHcp: 12,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Third",
            gross: 84,
            courseHcp: 12,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(points.get("first")).toBe(pointsForPosition(1));
    expect(points.get("second")).toBe(pointsForPosition(2));
    expect(points.get("third")).toBe(pointsForPosition(3));
  });

  it("excludes major and post-season tournaments from regular-season points", () => {
    const points = computeSeasonPoints(
      [
        tournament("major-1", "major", "2026-05-01"),
        tournament("post-1", "post", "2026-09-01"),
      ],
      [
        teeTime("major-tee", "2026-05-01", [
          {
            name: "Major Winner",
            gross: 70,
            courseHcp: 5,
            recordedAt: "2026-05-01T18:00:00.000Z",
          },
        ]),
        teeTime("post-tee", "2026-09-01", [
          {
            name: "Post Winner",
            gross: 68,
            courseHcp: 5,
            recordedAt: "2026-09-01T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect([...points.entries()]).toEqual([]);
  });

  it("sorts season points by points, average net, then rounds", () => {
    const sorted = sortStandings(
      [
        row("Fewer Rounds", 100, 70, 2),
        row("More Rounds", 100, 70, 4),
        row("Better Net", 100, 69, 1),
        row("More Points", 120, 75, 1),
      ],
      "seasonPoints"
    );

    expect(sorted.map((standing) => standing.name)).toEqual([
      "More Points",
      "Better Net",
      "More Rounds",
      "Fewer Rounds",
    ]);
  });

  it("keeps tied rows in deterministic input order", () => {
    const rows = [
      row("Alpha", 100, 70, 2),
      row("Bravo", 100, 70, 2),
      row("Charlie", 100, 70, 2),
    ];

    expect(
      sortStandings(rows, "seasonPoints").map((standing) => standing.name)
    ).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("reports regular-season points on computed standings", () => {
    const standings = computeStandings(
      [
        teeTime("tee-1", "2026-04-03", [
          {
            name: "First",
            gross: 80,
            courseHcp: 12,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Second",
            gross: 82,
            courseHcp: 12,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => 10,
      [tournament("regular-1", "regular", "2026-04-03")]
    );

    expect(standings).toMatchObject([
      {
        rulesVersion: ACTIVE_RULES_VERSION,
        name: "First",
        seasonPoints: pointsForPosition(1),
      },
      {
        rulesVersion: ACTIVE_RULES_VERSION,
        name: "Second",
        seasonPoints: pointsForPosition(2),
      },
    ]);
  });

  it("applies explicit strict-rank tie points after leaderboard tiebreakers", () => {
    const points = computeSeasonPoints(
      [tournament("regular-1", "regular", "2026-04-03")],
      [
        teeTime("tee-1", "2026-04-03", [
          {
            name: "Lower Gross",
            gross: 78,
            courseHcp: 8,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Higher Gross",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:05:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(points.get("lower gross")).toBe(pointsForPosition(1));
    expect(points.get("higher gross")).toBe(pointsForPosition(2));
  });

  it("uses score-level course handicap for aggregate net before falling back to player index", () => {
    const standings = computeStandings(
      [
        teeTime("tee-1", "2026-04-03", [
          {
            name: "Alex",
            gross: 82,
            courseHcp: 8,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Blake",
            gross: 82,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      (name) => (name === "Alex" ? 20 : name === "Blake" ? 12 : null),
      []
    );

    expect(standings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Alex", avgNet: 74, bestNet: 74 }),
        expect.objectContaining({ name: "Blake", avgNet: 70, bestNet: 70 }),
      ])
    );
  });

  it("excludes pending attestations from official averages while reporting score status", () => {
    const standings = computeStandings(
      [
        teeTime("tee-1", "2026-04-03", [
          {
            name: "Alex",
            gross: 80,
            courseHcp: 10,
            attestedBy: "Blake",
            attestationStatus: "pending",
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Blake",
            gross: 82,
            courseHcp: 10,
            attestedBy: "Alex",
            attestationStatus: "attested",
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      []
    );

    expect(standings.map((standing) => standing.name)).toEqual([
      "Alex",
      "Blake",
    ]);
    expect(standings.find((standing) => standing.name === "Alex")).toMatchObject({
      rounds: 0,
      avgGross: null,
      bestGross: null,
      avgNet: null,
      bestNet: null,
      scoreStatusCounts: {
        total: 1,
        official: 0,
        attested: 0,
        pending: 1,
      },
    });
    expect(standings.find((standing) => standing.name === "Blake")?.scoreStatusCounts).toMatchObject({
      total: 1,
      official: 1,
      attested: 1,
      pending: 0,
    });
  });
});
