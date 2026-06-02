export { POST_SEASON_SEEDS, STROKE_ADVANTAGES } from "./leagueRules";
import type { Score, TeeTime, Tournament } from "./types";
import { POST_SEASON_SEEDS, STROKE_ADVANTAGES } from "./leagueRules";

export type PostSeasonRow = {
  name: string;
  /** Number of rounds played in the post-season window. */
  rounds: number;
  /** Sum of nets across all in-window rounds, or null if no net info. */
  sumNet: number | null;
  /** 0 for unseeded players; the seed's negative offset (e.g., -4 for #1
   *  seed) for the top 4. Applied to sumNet to produce `adjusted`. */
  strokeAdvantage: number;
  /** sumNet + strokeAdvantage. Lower is better. */
  adjusted: number | null;
  /** Seed (1-based) if this player is one of the top 4 regular-season
   *  seeds; undefined otherwise. */
  seed?: number;
  position: number;
};

const netFor = (
  score: Score,
  getHandicap: (n: string) => number | null
): number | null => {
  if (score.courseHcp != null) return score.gross - score.courseHcp;
  const hcp = getHandicap(score.name);
  if (hcp != null) return score.gross - hcp;
  return null;
};

const inWindow = (t: Tournament, date: string) =>
  date >= t.windowStart && date <= t.windowEnd;

const isOfficialScore = (score: Score) =>
  score.attestationStatus === "attested" ||
  score.attestationStatus === "overridden";

/**
 * Walks every tee time inside the post-season tournament's window, sums
 * each player's net across all rounds, applies the seed's stroke advantage,
 * and ranks by the adjusted total. Players with no net info are placed at
 * the bottom.
 *
 * @param seedByKey Map of lowercase name -> 1-indexed seed (1..4) for the
 *                  top regular-season finishers. Players not in this map
 *                  get no stroke advantage.
 */
export function computePostSeasonLeaderboard(
  tournament: Tournament,
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null,
  seedByKey: Map<string, number>
): PostSeasonRow[] {
  if (tournament.type !== "post") return [];
  const inTournament = teeTimes.filter((tt) => inWindow(tournament, tt.date));
  const byKey = new Map<
    string,
    { displayName: string; rounds: number; nets: number[] }
  >();
  for (const tt of inTournament) {
    for (const s of tt.scores) {
      if (!isOfficialScore(s)) continue;
      const key = s.name.trim().toLowerCase();
      if (!key) continue;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { displayName: s.name, rounds: 0, nets: [] };
        byKey.set(key, agg);
      }
      agg.rounds += 1;
      const n = netFor(s, getHandicap);
      if (n != null) agg.nets.push(n);
    }
  }

  const rows: Omit<PostSeasonRow, "position">[] = [];
  for (const [key, agg] of byKey.entries()) {
    if (agg.rounds === 0) continue;
    const seed = seedByKey.get(key);
    const strokeAdvantage =
      seed != null && seed >= 1 && seed <= POST_SEASON_SEEDS
        ? STROKE_ADVANTAGES[seed - 1]
        : 0;
    const sumNet =
      agg.nets.length > 0 ? agg.nets.reduce((a, b) => a + b, 0) : null;
    const adjusted = sumNet != null ? sumNet + strokeAdvantage : null;
    rows.push({
      name: agg.displayName,
      rounds: agg.rounds,
      sumNet,
      strokeAdvantage,
      adjusted,
      seed,
    });
  }

  rows.sort((a, b) => {
    const aa = a.adjusted ?? Infinity;
    const bb = b.adjusted ?? Infinity;
    return aa - bb;
  });

  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}
