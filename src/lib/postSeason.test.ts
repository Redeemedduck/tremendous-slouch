import { describe, expect, it } from "vitest";
import { computePostSeasonLeaderboard } from "./postSeason";
import type { Score, TeeTime, Tournament } from "./types";

function tournament(type: Tournament["type"] = "post"): Tournament {
  return {
    id: `${type}-1`,
    name: `${type} event`,
    course: "Common Ground",
    windowStart: "2026-09-01",
    windowEnd: "2026-09-07",
    type,
    pointsToFirst: null,
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

describe("computePostSeasonLeaderboard", () => {
  it("returns no rows for non-post tournaments", () => {
    const rows = computePostSeasonLeaderboard(
      tournament("regular"),
      [
        teeTime("tee-1", "2026-09-02", [
          {
            name: "Alex",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      new Map()
    );

    expect(rows).toEqual([]);
  });

  it("uses only tee times inside the post-season window", () => {
    const rows = computePostSeasonLeaderboard(
      tournament(),
      [
        teeTime("inside", "2026-09-02", [
          {
            name: "Alex",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
        ]),
        teeTime("outside", "2026-09-08", [
          {
            name: "Alex",
            gross: 60,
            courseHcp: 10,
            recordedAt: "2026-09-08T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      new Map()
    );

    expect(rows).toMatchObject([{ name: "Alex", rounds: 1, sumNet: 70 }]);
  });

  it("applies seed offsets before final sorting", () => {
    const rows = computePostSeasonLeaderboard(
      tournament(),
      [
        teeTime("tee-1", "2026-09-02", [
          {
            name: "Top Seed",
            gross: 75,
            courseHcp: 2,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
          {
            name: "No Seed",
            gross: 72,
            courseHcp: 2,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      new Map([["top seed", 1]])
    );

    expect(rows.map((row) => row.name)).toEqual(["Top Seed", "No Seed"]);
    expect(rows[0]).toMatchObject({
      sumNet: 73,
      strokeAdvantage: -4,
      adjusted: 69,
      position: 1,
    });
  });

  it("sorts adjusted rankings by adjusted net", () => {
    const rows = computePostSeasonLeaderboard(
      tournament(),
      [
        teeTime("tee-1", "2026-09-02", [
          {
            name: "Lower Adjusted",
            gross: 78,
            courseHcp: 10,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
          {
            name: "Higher Adjusted",
            gross: 79,
            courseHcp: 10,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      new Map()
    );

    expect(rows.map((row) => row.name)).toEqual([
      "Lower Adjusted",
      "Higher Adjusted",
    ]);
  });

  it("sorts no-net rows last", () => {
    const rows = computePostSeasonLeaderboard(
      tournament(),
      [
        teeTime("tee-1", "2026-09-02", [
          {
            name: "No Net",
            gross: 70,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
          {
            name: "Net Player",
            gross: 82,
            courseHcp: 10,
            recordedAt: "2026-09-02T18:00:00.000Z",
          },
        ]),
      ],
      () => null,
      new Map()
    );

    expect(rows.map((row) => row.name)).toEqual(["Net Player", "No Net"]);
    expect(rows[1]).toMatchObject({ sumNet: null, adjusted: null });
  });
});
