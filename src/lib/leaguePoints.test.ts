import assert from "node:assert/strict";
import test from "node:test";
import {
  POSITION_POINTS,
  pointsForTie,
} from "./leaguePoints";
import {
  OFFICIAL_TOURNAMENT_RESULTS,
} from "./officialResults";
import { computeStandings, sortStandings, type StandingRow } from "./standings";
import type { TeeTime, Tournament } from "./types";

const tournament = (id: string, start: string, end: string): Tournament => ({
  id,
  name: id,
  course: id,
  windowStart: start,
  windowEnd: end,
  type: "regular",
  pointsToFirst: 20,
  payoutFirst: 334,
  payoutSecond: null,
  payoutThird: null,
  notes: null,
  createdAt: "2026-05-01T00:00:00.000Z",
});

const FIRST_THREE: Tournament[] = [
  tournament("2026-w1", "2026-05-01", "2026-05-24"),
  tournament("2026-w2", "2026-05-25", "2026-06-14"),
  tournament("2026-w3", "2026-06-15", "2026-07-05"),
];

test("uses the 12-place DJDI points scale shown on the final boards", () => {
  assert.deepEqual([...POSITION_POINTS], [20, 15, 14, 11, 9, 8, 7, 6, 5, 4, 3, 2]);
});

test("splits all occupied-position points equally when players tie", () => {
  assert.equal(pointsForTie(2, 3), 13.33); // (15 + 14 + 11) / 3
  assert.equal(pointsForTie(5, 3), 8); // (9 + 8 + 7) / 3
  assert.equal(pointsForTie(6, 2), 7.5); // (8 + 7) / 2
  assert.equal(pointsForTie(10, 2), 3.5); // (4 + 3) / 2
});

test("stores the final CommonGround, Colorado National, and Riverdale Dunes boards", () => {
  assert.equal(OFFICIAL_TOURNAMENT_RESULTS["2026-w1"].status, "final");
  assert.equal(OFFICIAL_TOURNAMENT_RESULTS["2026-w2"].status, "final");
  assert.equal(OFFICIAL_TOURNAMENT_RESULTS["2026-w3"].status, "final");

  const commonGround = OFFICIAL_TOURNAMENT_RESULTS["2026-w1"].results;
  assert.deepEqual(commonGround.slice(0, 4).map((r) => [r.name, r.net, r.position, r.points]), [
    ["Matt Henderson", 69, 1, 20],
    ["Jayson Post", 70, 2, 13.33],
    ["Noah Solomon", 70, 2, 13.33],
    ["Will Senofsky", 70, 2, 13.33],
  ]);

  const coloradoNational = OFFICIAL_TOURNAMENT_RESULTS["2026-w2"].results;
  assert.equal(coloradoNational.at(-1)?.name, "Chris Moore");
  assert.equal(coloradoNational.at(-1)?.net, 83);
  assert.equal(coloradoNational.at(-1)?.points, 3);
});

const teeTimeWithScore = (
  date: string,
  name: string,
  gross: number
): TeeTime => ({
  id: `tt-${date}`,
  course: "Test Course",
  date,
  time: "08:00",
  spots: 4,
  host: name,
  notes: null,
  claims: [{ name, claimedAt: "2026-05-01T00:00:00.000Z" }],
  interested: [],
  scores: [
    {
      name,
      gross,
      courseHcp: 5,
      attestedBy: "Noah Solomon",
      recordedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  comments: [],
  createdAt: "2026-05-01T00:00:00.000Z",
});

const findRow = (rows: StandingRow[], name: string): StandingRow => {
  const row = rows.find((r) => r.name === name);
  assert.ok(row, `${name} missing from standings`);
  return row;
};

test("published finals supersede raw in-window scores without double-counting", () => {
  const baseline = findRow(
    computeStandings([], () => null, FIRST_THREE),
    "Matt Henderson"
  );

  // A raw round recorded inside the (published) w1 window must not add
  // points, starts, or gross stats on top of the official board.
  const withRawInWindow = findRow(
    computeStandings(
      [teeTimeWithScore("2026-05-16", "Matt Henderson", 74)],
      () => null,
      FIRST_THREE
    ),
    "Matt Henderson"
  );
  assert.equal(withRawInWindow.seasonPoints, baseline.seasonPoints);
  assert.equal(withRawInWindow.rounds, baseline.rounds);
  assert.equal(withRawInWindow.totalGross, null);

  // The same round outside every published window keeps full stats.
  const withRawOutside = findRow(
    computeStandings(
      [teeTimeWithScore("2026-07-10", "Matt Henderson", 74)],
      () => null,
      FIRST_THREE
    ),
    "Matt Henderson"
  );
  assert.equal(withRawOutside.seasonPoints, baseline.seasonPoints);
  assert.equal(withRawOutside.rounds, baseline.rounds + 1);
  assert.equal(withRawOutside.totalGross, 74);
});

test("computes the official top four after the first three final events", () => {
  const rows = sortStandings(
    computeStandings([], () => null, FIRST_THREE),
    "seasonPoints"
  );

  assert.deepEqual(
    rows.slice(0, 4).map((r) => [r.name, r.seasonPoints]),
    [
      ["Noah Solomon", 42.33],
      ["Sam Lines", 37],
      ["Jayson Post", 35.33],
      ["Matt Henderson", 35],
    ]
  );
});
