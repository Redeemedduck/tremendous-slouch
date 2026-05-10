import { useMemo, useState } from "react";
import {
  CalendarRange,
  ChevronDown,
  Clock,
  Flag,
  MapPin,
  Star,
  Trophy,
} from "lucide-react";
import { formatDateLabel, formatTimeLabel, todayISO } from "../lib/format";
import { computeTournamentLeaderboard } from "../lib/tournamentLeaderboard";
import type { TeeTime, Tournament, TournamentType } from "../lib/types";

type Status = "upcoming" | "active" | "past";

const statusOf = (t: Tournament, today: string): Status => {
  if (today > t.windowEnd) return "past";
  if (today < t.windowStart) return "upcoming";
  return "active";
};

const TYPE_ICON: Record<TournamentType, typeof Flag> = {
  regular: Flag,
  major: Star,
  post: Trophy,
};

const STATUS_BADGE: Record<Status, string> = {
  upcoming: "bg-stone-100 text-stone-600",
  active: "bg-fairway-100 text-fairway-900",
  past: "bg-stone-50 text-stone-400",
};

function formatRange(startISO: string, endISO: string) {
  if (startISO === endISO) return formatDateLabel(startISO);
  return `${formatDateLabel(startISO)} – ${formatDateLabel(endISO)}`;
}

export function SeasonSchedule({
  tournaments,
  teeTimes,
  getHandicap,
}: {
  tournaments: Tournament[];
  teeTimes: TeeTime[];
  getHandicap: (name: string) => number | null;
}) {
  const today = useMemo(() => todayISO(), []);
  const enriched = useMemo(
    () =>
      tournaments.map((t) => ({
        ...t,
        status: statusOf(t, today),
      })),
    [tournaments, today]
  );
  const activeId = enriched.find((t) => t.status === "active")?.id ?? null;
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(activeId);

  if (tournaments.length === 0) return null;

  const summary = enriched.reduce(
    (acc, t) => {
      acc[t.status] += 1;
      return acc;
    },
    { upcoming: 0, active: 0, past: 0 }
  );

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">
            Season
          </span>
          <span className="text-xs text-stone-500">
            {summary.active > 0 && (
              <span className="mr-2 font-medium text-fairway-700">
                {summary.active} active
              </span>
            )}
            {summary.upcoming > 0 && (
              <span className="mr-2">{summary.upcoming} upcoming</span>
            )}
            {summary.past > 0 && (
              <span className="text-stone-400">{summary.past} past</span>
            )}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-stone-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {enriched.map((t) => {
            const Icon = TYPE_ICON[t.type] ?? Flag;
            const isExpanded = expandedId === t.id;
            return (
              <li
                key={t.id}
                className={`rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 ${
                  t.status === "past" ? "opacity-70" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-fairway-700" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-900">
                        {t.name}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        {formatRange(t.windowStart, t.windowEnd)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[t.status]}`}
                    >
                      {t.status}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-stone-400 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                </button>

                {isExpanded && (
                  <ExpandedTournament
                    tournament={t}
                    teeTimes={teeTimes}
                    getHandicap={getHandicap}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-stone-400">{label}</dt>
      <dd className="text-right font-medium text-stone-700 tabular-nums">
        {value}
      </dd>
    </>
  );
}

function ExpandedTournament({
  tournament,
  teeTimes,
  getHandicap,
}: {
  tournament: Tournament;
  teeTimes: TeeTime[];
  getHandicap: (name: string) => number | null;
}) {
  const inWindow = useMemo(
    () =>
      teeTimes
        .filter(
          (tt) =>
            tt.date >= tournament.windowStart && tt.date <= tournament.windowEnd
        )
        .sort((a, b) =>
          a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.time.localeCompare(b.time)
        ),
    [teeTimes, tournament.windowStart, tournament.windowEnd]
  );
  const leaderboard = useMemo(
    () => computeTournamentLeaderboard(tournament, teeTimes, getHandicap),
    [tournament, teeTimes, getHandicap]
  );
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

  return (
    <div className="border-t border-stone-100 p-3 text-sm">
      <div className="flex items-center gap-1.5 text-stone-700">
        <MapPin className="h-3.5 w-3.5 text-fairway-700" />
        <span className="font-medium">{tournament.course}</span>
      </div>
      {tournament.notes && (
        <p className="mt-2 text-sm text-stone-600">{tournament.notes}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {tournament.pointsToFirst != null && (
          <Pair label="Points (1st)" value={`${tournament.pointsToFirst}`} />
        )}
        {tournament.payoutFirst != null && (
          <Pair label="Payout 1st" value={`$${tournament.payoutFirst}`} />
        )}
        {tournament.payoutSecond != null && (
          <Pair label="Payout 2nd" value={`$${tournament.payoutSecond}`} />
        )}
        {tournament.payoutThird != null && (
          <Pair label="Payout 3rd" value={`$${tournament.payoutThird}`} />
        )}
      </dl>

      {leaderboard.length > 0 && (
        <div className="mt-3 rounded-xl bg-stone-50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">
            <Trophy className="h-3.5 w-3.5" /> Leaderboard
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-stone-400">
                <th className="pb-1 pr-2 font-medium">Pos</th>
                <th className="pb-1 pr-2 font-medium">Player</th>
                <th className="pb-1 pr-2 text-right font-medium">Gross</th>
                <th className="pb-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {leaderboard.map((r) => (
                <tr key={r.name}>
                  <td className="py-1 pr-2 tabular-nums text-stone-700">
                    {r.position === 1 ? (
                      <span className="font-semibold text-fairway-700">
                        1
                      </span>
                    ) : (
                      r.position
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <span className="font-medium text-stone-900">
                      {r.name}
                    </span>
                    {r.rounds > 1 && (
                      <span className="ml-1 text-[10px] text-stone-400">
                        ×{r.rounds}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-stone-700">
                    {r.bestGross}
                  </td>
                  <td className="py-1 text-right tabular-nums text-stone-700">
                    {r.bestNet == null
                      ? "—"
                      : r.netFromCourseHcp
                        ? r.bestNet
                        : fmt1(r.bestNet)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tournament.payoutFirst != null && leaderboard[0] && (
            <p className="mt-2 text-[11px] text-stone-500">
              <span className="font-medium">{leaderboard[0].name}</span> wins
              ${tournament.payoutFirst}
              {leaderboard[0].rounds > 1 ? " (best of multiple rounds)" : ""}.
            </p>
          )}
        </div>
      )}

      {inWindow.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">
            Rounds in this window
          </div>
          <ul className="space-y-1">
            {inWindow.map((tt) => (
              <li
                key={tt.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex items-center gap-1.5 text-stone-700">
                  <Clock className="h-3 w-3 text-stone-400" />
                  {formatDateLabel(tt.date)} · {formatTimeLabel(tt.time)}
                </span>
                <span className="text-xs text-stone-500">
                  {tt.claims.length}/{tt.spots} claimed
                  {tt.scores.length > 0 && (
                    <span className="ml-1 text-fairway-700">
                      · {tt.scores.length} scored
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {leaderboard.length === 0 && inWindow.length === 0 && (
        <p className="mt-3 text-xs text-stone-400">
          No rounds posted yet in this window.
        </p>
      )}
    </div>
  );
}
