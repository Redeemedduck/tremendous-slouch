import { describe, expect, it } from "vitest";
import {
  computeSeasonPoints,
  computeStandings,
  pointsForPosition,
  sortStandings,
  type StandingRow,
} from "./standings";
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
    scores,
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
    name,
    rounds,
    totalGross: 0,
    avgGross: 0,
    bestGross: 0,
    totalNet: avgNet == null ? null : avgNet * rounds,
    avgNet,
    bestNet: avgNet,
    seasonPoints,
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
      { name: "First", seasonPoints: pointsForPosition(1) },
      { name: "Second", seasonPoints: pointsForPosition(2) },
    ]);
  });
});
