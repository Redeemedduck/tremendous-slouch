import { useMemo, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { formatHandicap } from "../lib/format";
import { formatPoints } from "../lib/leaguePoints";
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
      const row = seedOrder[i];
      if (row.seasonPoints > 0) {
        map.set(row.name.trim().toLowerCase(), i + 1);
      }
    }
    return map;
  }, [seedOrder]);

  if (rows.length === 0) return null;

  const totalStarts = allRows.reduce((sum, row) => sum + row.rounds, 0);

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">
            Standings
          </span>
          <span className="text-xs text-stone-500">
            {rows.length} player{rows.length === 1 ? "" : "s"} ·{" "}
            {totalStarts} start{totalStarts === 1 ? "" : "s"}
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
              label="Starts"
              onClick={() => setSort("rounds")}
            />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="pb-2 pr-2 font-medium">Player</th>
                <th className="pb-2 pr-2 text-right font-medium">Starts</th>
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
              {rows.map((row) => (
                <Row
                  key={row.name}
                  row={row}
                  sort={sort}
                  getHandicap={getHandicap}
                  isMe={
                    !!myName &&
                    row.name.trim().toLowerCase() ===
                      myName.trim().toLowerCase()
                  }
                  seed={seedByKey.get(row.name.trim().toLowerCase())}
                />
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-stone-400">
            {sort === "seasonPoints" ? (
              <>
                DJDI points: 20, 15, 14, 11, 9, 8, 7, 6, 5, 4, 3, 2.
                Ties split the points for all occupied positions. Top{" "}
                {POST_SEASON_SEEDS} receive championship advantages of −4 / −3
                / −2 / −1.
              </>
            ) : (
              <>
                Published events use the final league net board. Other rounds
                use the recorded course handicap when available.
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
  const handicap = formatHandicap(getHandicap(row.name));
  const showNet = sort !== "avgGross";
  const usingNet = showNet && row.avgNet != null;
  const avg = usingNet ? row.avgNet : row.avgGross;
  const best = usingNet ? row.bestNet : row.bestGross;
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
          {handicap && (
            <span className="ml-0.5 text-xs text-stone-400">{handicap}</span>
          )}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-stone-700">
        {row.rounds}
      </td>
      {sort === "seasonPoints" ? (
        <td className="py-1.5 text-right tabular-nums font-semibold text-stone-900">
          {formatPoints(row.seasonPoints)}
        </td>
      ) : (
        <>
          <td className="py-1.5 pr-2 text-right tabular-nums text-stone-700">
            {avg == null ? "—" : fmt1(avg)}
          </td>
          <td className="py-1.5 text-right tabular-nums text-stone-700">
            {best == null ? "—" : usingNet ? fmt1(best) : best}
          </td>
        </>
      )}
    </tr>
  );
}
