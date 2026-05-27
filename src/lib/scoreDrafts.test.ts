import { describe, expect, it } from "vitest";
import {
  calculateRoundedCourseHandicap,
  fillScoreDraftCourseHandicaps,
  fillScoreDraftAttesters,
  parseScoreSummaryIntake,
  validateScoreDrafts,
  type ScoreDraft,
} from "./scoreDrafts";

const members = new Set(["alex", "blake", "casey"]);
const isMember = (name: string) => members.has(name.trim().toLowerCase());

function validate(
  drafts: Record<string, ScoreDraft>,
  isLeagueRound = true
) {
  return validateScoreDrafts(drafts, { isLeagueRound, isMember });
}

describe("validateScoreDrafts", () => {
  it("builds score tasks for league rounds with course handicap and attester", () => {
    expect(
      validate({
        Alex: { gross: "82", courseHcp: "11", attestedBy: "Blake" },
        Blake: { gross: "", courseHcp: "", attestedBy: "" },
      })
    ).toEqual({
      ok: true,
      tasks: [
        { name: "Alex", gross: 82, courseHcp: 11, attestedBy: "Blake" },
      ],
    });
  });

  it("blocks league score drafts for guests before server submit", () => {
    expect(
      validate({
        Guest: { gross: "82", courseHcp: "11", attestedBy: "Alex" },
      })
    ).toEqual({
      ok: false,
      error: "Guest: mark as a member in Roster before league scoring",
    });
  });

  it("requires course handicap and attester for league scores", () => {
    expect(
      validate({
        Alex: { gross: "82", courseHcp: "", attestedBy: "Blake" },
      })
    ).toEqual({
      ok: false,
      error: "Alex: league rounds need a course handicap (from GHIN)",
    });

    expect(
      validate({
        Alex: { gross: "82", courseHcp: "11", attestedBy: "" },
      })
    ).toEqual({
      ok: false,
      error: "Alex: league rounds need an attester (another member)",
    });
  });

  it("allows non-league score drafts without course handicap or attester", () => {
    expect(
      validate(
        {
          Guest: { gross: "91", courseHcp: "", attestedBy: "" },
        },
        false
      )
    ).toEqual({
      ok: true,
      tasks: [{ name: "Guest", gross: 91, courseHcp: null, attestedBy: null }],
    });
  });

  it("rejects invalid gross and course handicap values", () => {
    expect(
      validate({
        Alex: { gross: "82.5", courseHcp: "11", attestedBy: "Blake" },
      })
    ).toEqual({
      ok: false,
      error: "Alex: score must be a whole number between 1 and 300",
    });

    expect(
      validate({
        Alex: { gross: "82", courseHcp: "55", attestedBy: "Blake" },
      })
    ).toEqual({
      ok: false,
      error: "Alex: course handicap must be a whole number between -10 and 54",
    });
  });
});

describe("parseScoreSummaryIntake", () => {
  it("parses chat-style gross and net summaries for known names", () => {
    expect(
      parseScoreSummaryIntake(
        [
          "Jayson: 82 (70)",
          "Jonny: 80 (73)",
          "Will: 82 (70)",
          "Unknown: 77 (69)",
        ].join("\n"),
        ["Jayson Post", "Jonny Ten Bosch", "Will"]
      )
    ).toEqual([
      {
        name: "Jayson Post",
        gross: 82,
        net: 70,
        courseHcp: 12,
        source: "Jayson: 82 (70)",
      },
      {
        name: "Jonny Ten Bosch",
        gross: 80,
        net: 73,
        courseHcp: 7,
        source: "Jonny: 80 (73)",
      },
      {
        name: "Will",
        gross: 82,
        net: 70,
        courseHcp: 12,
        source: "Will: 82 (70)",
      },
    ]);
  });

  it("keeps course handicap blank when net is not present", () => {
    expect(parseScoreSummaryIntake("Alex 82", ["Alex"])).toEqual([
      {
        name: "Alex",
        gross: 82,
        net: null,
        courseHcp: null,
        source: "Alex 82",
      },
    ]);
  });
});

describe("fillScoreDraftAttesters", () => {
  it("fills blank attesters for scored member drafts while skipping self", () => {
    const result = fillScoreDraftAttesters(
      {
        Alex: { gross: "82", courseHcp: "11", attestedBy: "" },
        Blake: { gross: "79", courseHcp: "8", attestedBy: "" },
        Casey: { gross: "", courseHcp: "", attestedBy: "" },
      },
      {
        claimNames: ["Alex", "Blake", "Casey"],
        attester: "Blake",
        isMember,
      }
    );

    expect(result.filled).toBe(1);
    expect(result.skippedSelf).toBe(1);
    expect(result.drafts).toEqual({
      Alex: { gross: "82", courseHcp: "11", attestedBy: "Blake" },
      Blake: { gross: "79", courseHcp: "8", attestedBy: "" },
      Casey: { gross: "", courseHcp: "", attestedBy: "" },
    });
  });

  it("preserves existing attesters and ignores guest scorers", () => {
    const result = fillScoreDraftAttesters(
      {
        Alex: { gross: "82", courseHcp: "11", attestedBy: "Casey" },
        Guest: { gross: "91", courseHcp: "18", attestedBy: "" },
      },
      {
        claimNames: ["Alex", "Blake", "Guest"],
        attester: "Blake",
        isMember,
      }
    );

    expect(result.filled).toBe(0);
    expect(result.skippedSelf).toBe(0);
    expect(result.drafts).toEqual({
      Alex: { gross: "82", courseHcp: "11", attestedBy: "Casey" },
      Guest: { gross: "91", courseHcp: "18", attestedBy: "" },
    });
  });

  it("requires the selected attester to be a claimed league member", () => {
    expect(
      fillScoreDraftAttesters(
        { Alex: { gross: "82", courseHcp: "11", attestedBy: "" } },
        {
          claimNames: ["Alex", "Guest"],
          attester: "Guest",
          isMember,
        }
      )
    ).toMatchObject({
      filled: 0,
      skippedSelf: 0,
      error: "Guest is not a league member",
    });
  });
});

describe("fillScoreDraftCourseHandicaps", () => {
  it("fills member course handicaps from tee inputs and handicap index", () => {
    const result = fillScoreDraftCourseHandicaps(
      {
        Alex: { gross: "82", courseHcp: "", attestedBy: "Blake" },
        Blake: { gross: "79", courseHcp: "4", attestedBy: "Alex" },
        Guest: { gross: "91", courseHcp: "", attestedBy: "" },
      },
      {
        claimNames: ["Alex", "Blake", "Guest"],
        teeInputs: { teeRating: 70.1, teeSlope: 125, teePar: 72 },
        isMember,
        getHandicap: (name) => (name === "Alex" ? 10.6 : name === "Blake" ? 4.2 : null),
        overwriteExisting: true,
      }
    );

    expect(result.filled).toBe(2);
    expect(result.preservedManual).toBe(0);
    expect(result.overwrittenManual).toBe(1);
    expect(result.missingIndexes).toEqual([]);
    expect(result.drafts).toEqual({
      Alex: { gross: "82", courseHcp: "10", attestedBy: "Blake" },
      Blake: { gross: "79", courseHcp: "3", attestedBy: "Alex" },
      Guest: { gross: "91", courseHcp: "", attestedBy: "" },
    });
  });

  it("preserves manually entered course handicaps unless overwrite is explicit", () => {
    const result = fillScoreDraftCourseHandicaps(
      {
        Alex: { gross: "82", courseHcp: "", attestedBy: "Blake" },
        Blake: { gross: "79", courseHcp: "4", attestedBy: "Alex" },
      },
      {
        claimNames: ["Alex", "Blake"],
        teeInputs: { teeRating: 70.1, teeSlope: 125, teePar: 72 },
        isMember,
        getHandicap: (name) => (name === "Alex" ? 10.6 : 4.2),
      }
    );

    expect(result.filled).toBe(1);
    expect(result.preservedManual).toBe(1);
    expect(result.overwrittenManual).toBe(0);
    expect(result.drafts).toEqual({
      Alex: { gross: "82", courseHcp: "10", attestedBy: "Blake" },
      Blake: { gross: "79", courseHcp: "4", attestedBy: "Alex" },
    });
  });

  it("reports missing tee inputs and missing member indexes without inventing values", () => {
    const drafts = { Alex: { gross: "82", courseHcp: "", attestedBy: "Blake" } };

    expect(
      fillScoreDraftCourseHandicaps(drafts, {
        claimNames: ["Alex"],
        teeInputs: { teeRating: 70.1, teeSlope: null, teePar: 72 },
        isMember,
        getHandicap: () => 10.6,
      })
    ).toMatchObject({
      drafts,
      filled: 0,
      error: "Enter rating, slope, and par first",
    });

    expect(
      fillScoreDraftCourseHandicaps(drafts, {
        claimNames: ["Alex"],
        teeInputs: { teeRating: 70.1, teeSlope: 125, teePar: 72 },
        isMember,
        getHandicap: () => null,
      })
    ).toMatchObject({
      drafts,
      filled: 0,
      missingIndexes: ["Alex"],
    });
  });

  it("uses the same rounded course-handicap math as score evidence storage", () => {
    expect(
      calculateRoundedCourseHandicap({
        handicapIndex: 10.6,
        teeRating: 70.1,
        teeSlope: 125,
        teePar: 72,
      })
    ).toBe(10);
  });
});
