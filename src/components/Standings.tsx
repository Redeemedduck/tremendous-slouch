import { useMemo, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { formatHandicap } from "../lib/format";
import {
  type StandingRow,
  type StandingsSort,
  computeStandings,
  sortStandings,
} from "../lib/standings";
import type { TeeTime, Tournament } from "../lib/types";

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const POST_SEASON_SEEDS = 4;

export function Standings({
  teeTimes,
  tournaments,
  getHandicap,
  myName,
}: {
  teeTimes: TeeTime[];
  tournaments: Tournament[];
  getHandicap: (name: string) => number | null;
  myName: string;
}) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<StandingsSort>("seasonPoints");

  const allRows = useMemo(
    () => computeStandings(teeTimes, getHandicap, tournaments),
    [teeTimes, getHandicap, tournaments]
  );
  const rows = useMemo(() => sortStandings(allRows, sort), [allRows, sort]);
  // Always rank seeds by season points regardless of which sort is active,
  // so the seed-1..4 badge is stable as you toggle.
  const seedOrder = useMemo(
    () => sortStandings(allRows, "seasonPoints"),
    [allRows]
  );
  const seedByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < Math.min(POST_SEASON_SEEDS, seedOrder.length); i++) {
      const r = seedOrder[i];
      if (r.seasonPoints > 0) {
        map.set(r.name.trim().toLowerCase(), i + 1);
      }
    }
    return map;
  }, [seedOrder]);

  if (rows.length === 0) return null;

  const totalRounds = teeTimes.filter((t) => t.scores.length > 0).length;
  const totalRegularTournaments = tournaments.filter(
    (t) => t.type === "regular"
  ).length;

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">
            Standings
          </span>
          <span className="text-xs text-stone-500">
            {rows.length} player{rows.length === 1 ? "" : "s"} ·{" "}
            {totalRounds} round{totalRounds === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-stone-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <div className="mb-2 flex gap-1">
            <SortChip
              active={sort === "seasonPoints"}
              label="Points"
              onClick={() => setSort("seasonPoints")}
            />
            <SortChip
              active={sort === "avgNet"}
              label="Avg net"
              onClick={() => setSort("avgNet")}
            />
            <SortChip
              active={sort === "avgGross"}
              label="Avg gross"
              onClick={() => setSort("avgGross")}
            />
            <SortChip
              active={sort === "rounds"}
              label="Rounds"
              onClick={() => setSort("rounds")}
            />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="pb-2 pr-2 font-medium">Player</th>
                <th className="pb-2 pr-2 text-right font-medium">Rds</th>
                {sort === "seasonPoints" ? (
                  <th className="pb-2 text-right font-medium">Pts</th>
                ) : (
                  <>
                    <th className="pb-2 pr-2 text-right font-medium">Avg</th>
                    <th className="pb-2 text-right font-medium">Best</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <Row
                  key={r.name}
                  row={r}
                  sort={sort}
                  getHandicap={getHandicap}
                  isMe={
                    !!myName &&
                    r.name.trim().toLowerCase() === myName.trim().toLowerCase()
                  }
                  seed={seedByKey.get(r.name.trim().toLowerCase())}
                />
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-stone-400">
            {sort === "seasonPoints" ? (
              <>
                Points awarded by finishing position in each regular
                tournament (1st = 100, 2nd = 80, 3rd = 65, …). Top{" "}
                {POST_SEASON_SEEDS} seed the post-season with stroke
                advantages of −4 / −3 / −2 / −1.
                {totalRegularTournaments > 0 && (
                  <>
                    {" "}
                    {totalRegularTournaments} regular tournaments this season.
                  </>
                )}
              </>
            ) : (
              <>
                Net = gross − handicap index. Players with no recorded
                handicap show only gross.
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

function SortChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-fairway-100 text-fairway-900"
          : "bg-stone-100 text-stone-600 hover:bg-stone-200"
      }`}
    >
      {label}
    </button>
  );
}

function Row({
  row,
  sort,
  getHandicap,
  isMe,
  seed,
}: {
  row: StandingRow;
  sort: StandingsSort;
  getHandicap: (name: string) => number | null;
  isMe: boolean;
  /** 1-indexed seed (1 = top seed) if the player is in the projected top
   *  N for the post-season; undefined otherwise. */
  seed?: number;
}) {
  const hcp = formatHandicap(getHandicap(row.name));
  const showNet = sort !== "avgGross";
  const usingNet = showNet && row.avgNet != null;
  const avg = usingNet ? row.avgNet! : row.avgGross;
  const best = usingNet ? row.bestNet! : row.bestGross;
  return (
    <tr className={isMe ? "bg-fairway-50" : undefined}>
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-1.5">
          {seed && (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-fairway-600 text-[10px] font-semibold text-white"
              title={`Projected post-season seed ${seed}`}
            >
              {seed}
            </span>
          )}
          <span className="font-medium text-stone-900">{row.name}</span>
          {hcp && <span className="ml-0.5 text-xs text-stone-400">{hcp}</span>}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-stone-700">
        {row.rounds}
      </td>
      {sort === "seasonPoints" ? (
        <td className="py-1.5 text-right tabular-nums font-semibold text-stone-900">
          {row.seasonPoints}
        </td>
      ) : (
        <>
          <td className="py-1.5 pr-2 text-right tabular-nums text-stone-700">
            {fmt1(avg)}
          </td>
          <td className="py-1.5 text-right tabular-nums text-stone-700">
            {usingNet ? fmt1(best) : best}
          </td>
        </>
      )}
    </tr>
  );
}
