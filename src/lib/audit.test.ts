import { describe, expect, it } from "vitest";
import { auditLeagueRules } from "./audit";
import type { Player, TeeTime, Tournament } from "./types";

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
  createdAt: "2026-05-01T00:00:00.000Z",
};

const players: Player[] = [
  { name: "Alex", handicap: 4, member: true, updatedAt: "now" },
  { name: "Blake", handicap: 9, member: true, updatedAt: "now" },
  { name: "Guest", handicap: 12, member: false, updatedAt: "now" },
];

function teeTime(overrides: Partial<TeeTime>): TeeTime {
  return {
    id: "tt",
    course: "Common Ground",
    date: "2026-05-18",
    time: "12:50",
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
}

describe("auditLeagueRules", () => {
  it("flags missing scores for past league tee time claims", () => {
    const issues = auditLeagueRules(
      [teeTime({ scores: [{ name: "Alex", gross: 80, courseHcp: 8, attestedBy: "Blake", attestationStatus: "attested", recordedAt: "now" }] })],
      [tournament],
      players,
      "2026-05-19"
    );

    expect(issues.map((issue) => issue.message)).toContain("Missing score");
  });

  it("flags score records that would break league rules", () => {
    const issues = auditLeagueRules(
      [
        teeTime({
          scores: [
            { name: "Alex", gross: 80, attestedBy: "Alex", attestationStatus: "attested", recordedAt: "now" },
            { name: "Guest", gross: 82, courseHcp: 12, attestedBy: "Blake", attestationStatus: "attested", recordedAt: "now" },
          ],
        }),
      ],
      [tournament],
      players,
      "2026-05-18"
    );

    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Missing course handicap",
        "Self-attested score",
        "Scored player is not claimed on this tee time",
        "Scored player is not marked as a member",
      ])
    );
  });

  it("documents guest/member behavior for league scoring and attestation", () => {
    const issues = auditLeagueRules(
      [
        teeTime({
          claims: [
            { name: "Alex", claimedAt: "now" },
            { name: "Blake", claimedAt: "now" },
            { name: "Guest", claimedAt: "now" },
          ],
          scores: [
            {
              name: "Guest",
              gross: 82,
              courseHcp: 12,
              attestedBy: "Blake",
              attestationStatus: "attested",
              recordedAt: "now",
            },
            {
              name: "Alex",
              gross: 80,
              courseHcp: 8,
              attestedBy: "Guest",
              attestationStatus: "attested",
              recordedAt: "now",
            },
          ],
        }),
      ],
      [tournament],
      players,
      "2026-05-18"
    );

    expect(issues.map((issue) => `${issue.player}: ${issue.message}`)).toEqual(
      expect.arrayContaining([
        "Guest: Scored player is not marked as a member",
        "Alex: Attester is not marked as a member",
      ])
    );
  });

  it("blocks legacy scores that only have a selected attester name", () => {
    const issues = auditLeagueRules(
      [
        teeTime({
          scores: [
            {
              name: "Alex",
              gross: 80,
              courseHcp: 8,
              attestedBy: "Blake",
              recordedAt: "now",
            },
          ],
        }),
      ],
      [tournament],
      players,
      "2026-05-18"
    );

    expect(issues.map((issue) => issue.message)).toContain(
      "Legacy score needs attestation confirmation"
    );
  });
});
