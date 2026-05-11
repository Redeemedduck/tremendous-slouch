import { computeTournamentLeaderboard } from "./tournamentLeaderboard";
import type { TeeTime, Tournament } from "./types";

export type StandingRow = {
  name: string;
  rounds: number;
  totalGross: number;
  avgGross: number;
  bestGross: number;
  // Net stats are only populated when at least one round had a known
  // handicap for this player. Otherwise null.
  totalNet: number | null;
  avgNet: number | null;
  bestNet: number | null;
  // Cumulative regular-season points (FedEx-Cup-style). Always defined; 0
  // when the player hasn't placed in any regular tournament yet.
  seasonPoints: number;
};

export type StandingsSort = "seasonPoints" | "avgNet" | "avgGross" | "rounds";

// FedEx-Cup-style points distribution by finishing position. Length 20 is
// plenty for a 12-15 player league; anyone outside the top 20 gets 0.
// Tunable in one place.
export const POSITION_POINTS = [
  100, // 1st
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

export const pointsForPosition = (pos: number): number =>
  pos >= 1 && pos <= POSITION_POINTS.length ? POSITION_POINTS[pos - 1] : 0;

const eq = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

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
    }
  >();
  for (const t of teeTimes) {
    for (const s of t.scores) {
      const key = s.name.trim().toLowerCase();
      if (!key) continue;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { displayName: s.name, grosses: [], nets: [] };
        byKey.set(key, agg);
      }
      agg.grosses.push(s.gross);
      // For aggregate avg-net / best-net (non-tournament-specific), keep
      // using the GHIN index. Tournament-specific net (and therefore
      // tournament leaderboard position) uses course handicap when
      // available — see computeTournamentLeaderboard.
      const hcp = getHandicap(s.name);
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
    if (rounds === 0) continue;
    const totalGross = agg.grosses.reduce((a, b) => a + b, 0);
    const avgGross = totalGross / rounds;
    const bestGross = Math.min(...agg.grosses);
    const hasNet = agg.nets.length > 0;
    const totalNet = hasNet ? agg.nets.reduce((a, b) => a + b, 0) : null;
    const avgNet = hasNet ? totalNet! / agg.nets.length : null;
    const bestNet = hasNet ? Math.min(...agg.nets) : null;
    rows.push({
      name: agg.displayName,
      rounds,
      totalGross,
      avgGross,
      bestGross,
      totalNet,
      avgNet,
      bestNet,
      seasonPoints: seasonPointsByKey.get(key) ?? 0,
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
    sorted.sort((a, b) => b.rounds - a.rounds || a.avgGross - b.avgGross);
  } else if (by === "avgGross") {
    sorted.sort((a, b) => a.avgGross - b.avgGross);
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
