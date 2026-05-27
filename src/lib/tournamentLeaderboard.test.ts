import { describe, expect, it } from "vitest";
import { ACTIVE_RULES_VERSION } from "./leagueRules";
import { computeTournamentLeaderboard } from "./tournamentLeaderboard";
import type { Score, TeeTime, Tournament } from "./types";

const regularTournament: Tournament = {
  id: "regular-1",
  name: "Regular Week 1",
  course: "Common Ground",
  windowStart: "2026-04-01",
  windowEnd: "2026-04-07",
  type: "regular",
  pointsToFirst: 100,
  payoutFirst: 334,
  payoutSecond: null,
  payoutThird: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function teeTime(date: string, scores: Score[]): TeeTime {
  return {
    id: `tee-${date}`,
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

describe("computeTournamentLeaderboard", () => {
  it("uses only scores inside the tournament window", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          {
            name: "Alex",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
        teeTime("2026-04-09", [
          {
            name: "Alex",
            gross: 70,
            courseHcp: 10,
            recordedAt: "2026-04-09T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(rows).toMatchObject([
      {
        rulesVersion: ACTIVE_RULES_VERSION,
        name: "Alex",
        bestGross: 80,
        bestNet: 70,
      },
    ]);
  });

  it("prioritizes score-level course handicap over member handicap", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          {
            name: "Alex",
            gross: 82,
            courseHcp: 8,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => 20
    );

    expect(rows[0]).toMatchObject({ name: "Alex", bestGross: 82, bestNet: 74 });
  });

  it("sorts no-net rows behind completed net rows", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          { name: "No Net", gross: 70, recordedAt: "2026-04-03T18:00:00.000Z" },
          {
            name: "Net Player",
            gross: 82,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(rows.map((row) => row.name)).toEqual(["Net Player", "No Net"]);
  });

  it("breaks equal net ties by best gross and then stable input order", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          {
            name: "Lower Gross",
            gross: 78,
            courseHcp: 8,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Stable First",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:05:00.000Z",
          },
          {
            name: "Stable Second",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:10:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(rows.map((row) => `${row.position}:${row.name}`)).toEqual([
      "1:Lower Gross",
      "2:Stable First",
      "3:Stable Second",
    ]);
    expect(rows.map((row) => row.bestNet)).toEqual([70, 70, 70]);
  });

  it("excludes score entries that are still pending attestation", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          {
            name: "Pending",
            gross: 70,
            courseHcp: 10,
            attestationStatus: "pending",
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
          {
            name: "Official",
            gross: 82,
            courseHcp: 10,
            attestationStatus: "attested",
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(rows.map((row) => row.name)).toEqual(["Official"]);
  });

  it("merges player names case-insensitively", () => {
    const rows = computeTournamentLeaderboard(
      regularTournament,
      [
        teeTime("2026-04-03", [
          {
            name: "Alex",
            gross: 80,
            courseHcp: 10,
            recordedAt: "2026-04-03T18:00:00.000Z",
          },
        ]),
        teeTime("2026-04-04", [
          {
            name: "alex",
            gross: 78,
            courseHcp: 10,
            recordedAt: "2026-04-04T18:00:00.000Z",
          },
        ]),
      ],
      () => null
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Alex",
      rounds: 2,
      bestGross: 78,
      bestNet: 68,
    });
  });
});
