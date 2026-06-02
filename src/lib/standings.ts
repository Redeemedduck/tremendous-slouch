import { computeTournamentLeaderboard } from "./tournamentLeaderboard";
import { ACTIVE_RULES_VERSION, POSITION_POINTS } from "./leagueRules";
import type { TeeTime, Tournament } from "./types";

export type StandingRow = {
  rulesVersion: string;
  name: string;
  rounds: number;
  totalGross: number;
  avgGross: number | null;
  bestGross: number | null;
  // Net stats are only populated when at least one round had a known
  // handicap for this player. Otherwise null.
  totalNet: number | null;
  avgNet: number | null;
  bestNet: number | null;
  // Cumulative regular-season points (FedEx-Cup-style). Always defined; 0
  // when the player hasn't placed in any regular tournament yet.
  seasonPoints: number;
  scoreStatusCounts: ScoreStatusCounts;
};

export type ScoreStatusCounts = {
  total: number;
  official: number;
  draft: number;
  pending: number;
  attested: number;
  overridden: number;
  legacyUnconfirmed: number;
};

export type StandingsSort = "seasonPoints" | "avgNet" | "avgGross" | "rounds";

export const pointsForPosition = (pos: number): number =>
  pos >= 1 && pos <= POSITION_POINTS.length ? POSITION_POINTS[pos - 1] : 0;

const eq = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const isOfficialScore = (score: TeeTime["scores"][number]) =>
  score.attestationStatus === "attested" ||
  score.attestationStatus === "overridden";

const emptyScoreStatusCounts = (): ScoreStatusCounts => ({
  total: 0,
  official: 0,
  draft: 0,
  pending: 0,
  attested: 0,
  overridden: 0,
  legacyUnconfirmed: 0,
});

const addScoreStatus = (
  counts: ScoreStatusCounts,
  score: TeeTime["scores"][number]
) => {
  counts.total += 1;
  if (isOfficialScore(score)) counts.official += 1;
  if (score.attestationStatus === "draft") counts.draft += 1;
  else if (score.attestationStatus === "pending") counts.pending += 1;
  else if (score.attestationStatus === "attested") counts.attested += 1;
  else if (score.attestationStatus === "overridden") counts.overridden += 1;
  else counts.legacyUnconfirmed += 1;
};

/**
 * Walks every regular-type tournament, computes its leaderboard, and sums
 * the position points per player across the season. Mid-season major and
 * post-season don't award regular-season points per league rules.
 *
 * Ties: the underlying leaderboard already assigns unique positions by
 * breaking ties on best gross, so two players with identical best-net get
 * the strict-ordering points. Splitting tied points is a v2 improvement.
 */
export function computeSeasonPoints(
  tournaments: Tournament[],
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null
): Map<string, number> {
  const points = new Map<string, number>();
  for (const t of tournaments) {
    if (t.type !== "regular") continue;
    const board = computeTournamentLeaderboard(t, teeTimes, getHandicap);
    for (const row of board) {
      const key = row.name.trim().toLowerCase();
      const earned = pointsForPosition(row.position);
      if (earned > 0) {
        points.set(key, (points.get(key) ?? 0) + earned);
      }
    }
  }
  return points;
}

export function computeStandings(
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null,
  tournaments: Tournament[] = []
): StandingRow[] {
  // canonical name -> aggregator. We use the first-seen casing as the
  // canonical display name, but key on lowercase so "Mike" and "mike" merge.
  const byKey = new Map<
    string,
    {
      displayName: string;
      grosses: number[];
      nets: number[];
      scoreStatusCounts: ScoreStatusCounts;
    }
  >();
  for (const t of teeTimes) {
    for (const s of t.scores) {
      const key = s.name.trim().toLowerCase();
      if (!key) continue;
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          displayName: s.name,
          grosses: [],
          nets: [],
          scoreStatusCounts: emptyScoreStatusCounts(),
        };
        byKey.set(key, agg);
      }
      addScoreStatus(agg.scoreStatusCounts, s);
      if (!isOfficialScore(s)) continue;
      agg.grosses.push(s.gross);
      // League scores carry the GHIN course handicap for that tee/course.
      // Use it first so season aggregate net matches tournament and summary
      // closeout math. Older/non-league rows can still fall back to the
      // player's recorded handicap index for display.
      const hcp = s.courseHcp ?? getHandicap(s.name);
      if (hcp != null) agg.nets.push(s.gross - hcp);
    }
  }

  const seasonPointsByKey = computeSeasonPoints(
    tournaments,
    teeTimes,
    getHandicap
  );

  const rows: StandingRow[] = [];
  for (const [key, agg] of byKey.entries()) {
    const rounds = agg.grosses.length;
    const totalGross = agg.grosses.reduce((a, b) => a + b, 0);
    const avgGross = rounds > 0 ? totalGross / rounds : null;
    const bestGross = rounds > 0 ? Math.min(...agg.grosses) : null;
    const hasNet = agg.nets.length > 0;
    const totalNet = hasNet ? agg.nets.reduce((a, b) => a + b, 0) : null;
    const avgNet = hasNet ? totalNet! / agg.nets.length : null;
    const bestNet = hasNet ? Math.min(...agg.nets) : null;
    rows.push({
      rulesVersion: ACTIVE_RULES_VERSION,
      name: agg.displayName,
      rounds,
      totalGross,
      avgGross,
      bestGross,
      totalNet,
      avgNet,
      bestNet,
      seasonPoints: seasonPointsByKey.get(key) ?? 0,
      scoreStatusCounts: { ...agg.scoreStatusCounts },
    });
  }
  return rows;
}

export function sortStandings(
  rows: StandingRow[],
  by: StandingsSort
): StandingRow[] {
  const sorted = [...rows];
  if (by === "seasonPoints") {
    sorted.sort((a, b) => {
      if (b.seasonPoints !== a.seasonPoints) {
        return b.seasonPoints - a.seasonPoints;
      }
      // Tiebreaker: better avg net first, then more rounds played.
      const an = a.avgNet ?? Infinity;
      const bn = b.avgNet ?? Infinity;
      if (an !== bn) return an - bn;
      return b.rounds - a.rounds;
    });
  } else if (by === "rounds") {
    sorted.sort(
      (a, b) =>
        b.rounds - a.rounds ||
        (a.avgGross ?? Infinity) - (b.avgGross ?? Infinity)
    );
  } else if (by === "avgGross") {
    sorted.sort(
      (a, b) => (a.avgGross ?? Infinity) - (b.avgGross ?? Infinity)
    );
  } else {
    sorted.sort((a, b) => {
      // Players with no net handicap data sink to the bottom.
      const an = a.avgNet ?? Infinity;
      const bn = b.avgNet ?? Infinity;
      return an - bn;
    });
  }
  return sorted;
}

export { eq as eqName };
