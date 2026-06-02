export const ACTIVE_RULES_VERSION = "DJDI-2026-v1";

export const POSITION_POINTS = [
  100,
  80,
  65,
  55,
  50,
  45,
  40,
  36,
  33,
  31,
  29,
  27,
  25,
  23,
  21,
  19,
  17,
  15,
  13,
  11,
] as const;

export const LEAGUE_DEFAULT_BUYIN = 325;
export const REGULAR_PAYOUT = 334;
export const POST_PAYOUTS = { first: 1014, second: 390, third: 156 } as const;
export const STROKE_ADVANTAGES = [-4, -3, -2, -1] as const;
export const POST_SEASON_SEEDS = STROKE_ADVANTAGES.length;

export const ACTIVE_LEAGUE_RULES = {
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
    formulaReference:
      "golf-domain-local/golf-domain/0.1.3/references/handicap-source-of-truth.md",
  },
} as const;
