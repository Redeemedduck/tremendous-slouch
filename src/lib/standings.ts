import type { TeeTime } from "./types";

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
};

export type StandingsSort = "avgNet" | "avgGross" | "rounds";

const eq = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export function computeStandings(
  teeTimes: TeeTime[],
  getHandicap: (name: string) => number | null
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
      const hcp = getHandicap(s.name);
      if (hcp != null) agg.nets.push(s.gross - hcp);
    }
  }

  const rows: StandingRow[] = [];
  for (const agg of byKey.values()) {
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
    });
  }
  return rows;
}

export function sortStandings(
  rows: StandingRow[],
  by: StandingsSort
): StandingRow[] {
  const sorted = [...rows];
  if (by === "rounds") {
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
