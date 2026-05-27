import { describe, expect, it } from "vitest";
import {
  ACTIVE_LEAGUE_RULES,
  ACTIVE_RULES_VERSION,
  LEAGUE_DEFAULT_BUYIN,
  POSITION_POINTS,
  POST_PAYOUTS,
  POST_SEASON_SEEDS,
  REGULAR_PAYOUT,
  STROKE_ADVANTAGES,
} from "./leagueRules";

describe("active league rules contract", () => {
  it("names the rule version and every policy area exports depend on", () => {
    expect(ACTIVE_LEAGUE_RULES).toMatchObject({
      version: ACTIVE_RULES_VERSION,
      points: {
        tournamentTypes: ["regular"],
        distribution: POSITION_POINTS,
        noPointsFor: ["major", "post"],
      },
      money: {
        defaultBuyin: LEAGUE_DEFAULT_BUYIN,
        paymentStatuses: [
          "unpaid",
          "promised",
          "paid",
          "comped",
          "refunded",
          "disputed",
        ],
      },
      payouts: {
        regularWinner: REGULAR_PAYOUT,
        postSeason: POST_PAYOUTS,
      },
      ties: {
        tournamentLeaderboard: "best net, then best gross, then stable input order",
        seasonStandings: "season points, then average net, then rounds played",
      },
      guests: {
        canClaimTeeTimes: true,
        canHaveLeagueScoresRecorded: false,
        eligibleForSeasonPoints: false,
        canAttestLeagueScores: false,
      },
      postseason: {
        seeds: POST_SEASON_SEEDS,
        strokeAdvantages: STROKE_ADVANTAGES,
      },
      handicap: {
        indexLabel: "Handicap Index",
        courseHandicapLabel: "Course Handicap",
        requiresRoundCourseHandicapForLeagueScores: true,
      },
    });
  });
});
