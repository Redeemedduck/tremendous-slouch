import type { Score, TeeTime, Tournament } from "./types";

export type LeaderboardRow = {
  name: string;
  rounds: number;
  bestGross: number;
  bestNet: number | null;
  /** True iff at least one of the player's contributing rounds used a
   *  per-round course handicap (the league-correct way). When false, net
   *  came from the player's GHIN index — fine outside of tournaments but
   *  technically not the league rule. */
  netFromCourseHcp: boolean;
  position: number;
};

const eq = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const inWindow = (t: Tournament, date: string) =>
  date >= t.windowStart && date <= t.windowEnd;

const netFor = (score: Score, getHandicap: (n: string) => number | null) => {
  if (score.courseHcp != null) {
    return { net: score.gross - score.courseHcp, fromCourse: true };
  }
  const hcp = getHandicap(score.name);
  if (hcp != null) return { net: score.gross - hcp, fromCourse: false };
  return { net: null as number | null, fromCourse: false };
};

export function computeTournamentLeaderboard(
  tournament: Tournament,
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null
): LeaderboardRow[] {
  const inTournament = teeTimes.filter((tt) => inWindow(tournament, tt.date));
  // case-insensitive merge: "Mike" / "mike" → one row
  const byKey = new Map<
    string,
    {
      displayName: string;
      grosses: number[];
      nets: number[];
      anyFromCourseHcp: boolean;
    }
  >();
  for (const tt of inTournament) {
    for (const s of tt.scores) {
      const key = s.name.trim().toLowerCase();
      if (!key) continue;
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          displayName: s.name,
          grosses: [],
          nets: [],
          anyFromCourseHcp: false,
        };
        byKey.set(key, agg);
      }
      agg.grosses.push(s.gross);
      const { net, fromCourse } = netFor(s, getHandicap);
      if (net != null) agg.nets.push(net);
      if (fromCourse) agg.anyFromCourseHcp = true;
    }
  }

  const rows: Omit<LeaderboardRow, "position">[] = [];
  for (const agg of byKey.values()) {
    if (agg.grosses.length === 0) continue;
    rows.push({
      name: agg.displayName,
      rounds: agg.grosses.length,
      bestGross: Math.min(...agg.grosses),
      bestNet: agg.nets.length > 0 ? Math.min(...agg.nets) : null,
      netFromCourseHcp: agg.anyFromCourseHcp,
    });
  }

  // Sort by best net ascending; players with no net info sink to the bottom
  // (sorted by best gross within that group).
  rows.sort((a, b) => {
    const an = a.bestNet ?? Infinity;
    const bn = b.bestNet ?? Infinity;
    if (an !== bn) return an - bn;
    return a.bestGross - b.bestGross;
  });

  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

export { eq as eqName, inWindow };
