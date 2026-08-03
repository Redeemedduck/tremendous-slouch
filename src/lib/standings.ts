import { POSITION_POINTS, pointsForPosition } from "./leaguePoints";
import { getOfficialTournamentResults } from "./officialResults";
import { computeTournamentLeaderboard } from "./tournamentLeaderboard";
import type { Score, TeeTime, Tournament } from "./types";

export type StandingRow = {
  name: string;
  rounds: number;
  totalGross: number | null;
  avgGross: number | null;
  bestGross: number | null;
  totalNet: number | null;
  avgNet: number | null;
  bestNet: number | null;
  // Cumulative regular-season points. Always defined; 0 when the player
  // hasn't placed in a regular tournament yet.
  seasonPoints: number;
};

export type StandingsSort = "seasonPoints" | "avgNet" | "avgGross" | "rounds";

const eq = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const roundPoints = (value: number) => Math.round(value * 100) / 100;

/**
 * Walk every regular tournament and sum the points attached to its ranked
 * leaderboard. Final published boards override score-derived leaderboards;
 * live/unpublished events continue to derive from recorded tee-time scores.
 */
export function computeSeasonPoints(
  tournaments: Tournament[],
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null
): Map<string, number> {
  const points = new Map<string, number>();
  for (const tournament of tournaments) {
    if (tournament.type !== "regular") continue;
    const board = computeTournamentLeaderboard(
      tournament,
      teeTimes,
      getHandicap
    );
    for (const row of board) {
      if (row.points <= 0) continue;
      const key = row.name.trim().toLowerCase();
      points.set(key, roundPoints((points.get(key) ?? 0) + row.points));
    }
  }
  return points;
}

type PlayerAggregate = {
  displayName: string;
  rounds: number;
  grosses: number[];
  nets: number[];
};

const scoreNet = (
  score: Score,
  getHandicap: (name: string) => number | null
): number | null => {
  if (score.courseHcp != null) return score.gross - score.courseHcp;
  const handicap = getHandicap(score.name);
  return handicap == null ? null : score.gross - handicap;
};

export function computeStandings(
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null,
  tournaments: Tournament[] = []
): StandingRow[] {
  const byKey = new Map<string, PlayerAggregate>();
  const ensure = (name: string): PlayerAggregate => {
    const key = name.trim().toLowerCase();
    let aggregate = byKey.get(key);
    if (!aggregate) {
      aggregate = { displayName: name, rounds: 0, grosses: [], nets: [] };
      byKey.set(key, aggregate);
    }
    return aggregate;
  };

  const officialWindows = tournaments.filter(
    (tournament) => !!getOfficialTournamentResults(tournament.id)
  );
  const isInsideOfficialWindow = (date: string) =>
    officialWindows.some(
      (tournament) =>
        date >= tournament.windowStart && date <= tournament.windowEnd
    );

  // Do not double-count raw tee-time entries for events whose final published
  // board is already authoritative. Other rounds retain their full gross/net
  // statistics.
  for (const teeTime of teeTimes) {
    if (isInsideOfficialWindow(teeTime.date)) continue;
    for (const score of teeTime.scores) {
      const name = score.name.trim();
      if (!name) continue;
      const aggregate = ensure(name);
      aggregate.rounds += 1;
      aggregate.grosses.push(score.gross);
      const net = scoreNet(score, getHandicap);
      if (net != null) aggregate.nets.push(net);
    }
  }

  // Historical official boards have net scores but not gross-score detail.
  // Count each published result as one start without inventing a gross score.
  for (const tournament of tournaments) {
    const official = getOfficialTournamentResults(tournament.id);
    if (!official) continue;
    for (const result of official.results) {
      const aggregate = ensure(result.name);
      aggregate.rounds += 1;
      aggregate.nets.push(result.net);
    }
  }

  const seasonPointsByKey = computeSeasonPoints(
    tournaments,
    teeTimes,
    getHandicap
  );

  // Include any points-only player even if a future result source lacks a net.
  for (const key of seasonPointsByKey.keys()) {
    if (!byKey.has(key)) {
      byKey.set(key, { displayName: key, rounds: 0, grosses: [], nets: [] });
    }
  }

  const rows: StandingRow[] = [];
  for (const [key, aggregate] of byKey.entries()) {
    const hasGross = aggregate.grosses.length > 0;
    const totalGross = hasGross
      ? aggregate.grosses.reduce((sum, value) => sum + value, 0)
      : null;
    const avgGross = hasGross
      ? totalGross! / aggregate.grosses.length
      : null;
    const bestGross = hasGross ? Math.min(...aggregate.grosses) : null;

    const hasNet = aggregate.nets.length > 0;
    const totalNet = hasNet
      ? aggregate.nets.reduce((sum, value) => sum + value, 0)
      : null;
    const avgNet = hasNet ? totalNet! / aggregate.nets.length : null;
    const bestNet = hasNet ? Math.min(...aggregate.nets) : null;

    rows.push({
      name: aggregate.displayName,
      rounds: aggregate.rounds,
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
      // Tiebreaker for championship seeding: better average net, then more
      // starts, then alphabetical display order for deterministic rendering.
      const an = a.avgNet ?? Infinity;
      const bn = b.avgNet ?? Infinity;
      if (an !== bn) return an - bn;
      if (b.rounds !== a.rounds) return b.rounds - a.rounds;
      return a.name.localeCompare(b.name);
    });
  } else if (by === "rounds") {
    sorted.sort(
      (a, b) =>
        b.rounds - a.rounds ||
        (a.avgGross ?? Infinity) - (b.avgGross ?? Infinity) ||
        a.name.localeCompare(b.name)
    );
  } else if (by === "avgGross") {
    sorted.sort(
      (a, b) =>
        (a.avgGross ?? Infinity) - (b.avgGross ?? Infinity) ||
        a.name.localeCompare(b.name)
    );
  } else {
    sorted.sort(
      (a, b) =>
        (a.avgNet ?? Infinity) - (b.avgNet ?? Infinity) ||
        a.name.localeCompare(b.name)
    );
  }
  return sorted;
}

export { eq as eqName, POSITION_POINTS, pointsForPosition };
