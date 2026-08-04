import { pointsForTie } from "./leaguePoints";
import { getOfficialTournamentResults } from "./officialResults";
import type { Score, TeeTime, Tournament } from "./types";

export type LeaderboardRow = {
  name: string;
  rounds: number;
  bestGross: number | null;
  bestNet: number | null;
  /** True iff at least one of the player's contributing rounds used a
   *  per-round course handicap (the league-correct way). When false, net
   *  came from the player's GHIN index. Official final boards are already
   *  published as net and therefore set this true. */
  netFromCourseHcp: boolean;
  position: number;
  points: number;
};

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
  const official = getOfficialTournamentResults(tournament.id);
  if (official) {
    return official.results.map((row) => ({
      name: row.name,
      rounds: 1,
      bestGross: null,
      bestNet: row.net,
      netFromCourseHcp: true,
      position: row.position,
      points: row.points,
    }));
  }

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

  const rows: Omit<LeaderboardRow, "position" | "points">[] = [];
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

  // Sort by best net ascending. Gross and name only stabilize display order;
  // they never break a net tie for position or points.
  rows.sort((a, b) => {
    const an = a.bestNet ?? Infinity;
    const bn = b.bestNet ?? Infinity;
    if (an !== bn) return an - bn;
    const ag = a.bestGross ?? Infinity;
    const bg = b.bestGross ?? Infinity;
    if (ag !== bg) return ag - bg;
    return a.name.localeCompare(b.name);
  });

  const ranked: LeaderboardRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const net = rows[index].bestNet;
    if (net == null) {
      ranked.push({ ...rows[index], position: index + 1, points: 0 });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < rows.length && rows[end].bestNet === net) end += 1;
    const position = index + 1;
    const points = pointsForTie(position, end - index);
    for (let cursor = index; cursor < end; cursor += 1) {
      ranked.push({ ...rows[cursor], position, points });
    }
    index = end;
  }

  return ranked;
}
