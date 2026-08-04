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
import { formatPoints } from "../lib/leaguePoints";
import { getOfficialTournamentResults } from "../lib/officialResults";
import {
  POST_SEASON_SEEDS,
  computePostSeasonLeaderboard,
  type PostSeasonRow,
} from "../lib/postSeason";
import { computeStandings, sortStandings } from "../lib/standings";
import {
  computeTournamentLeaderboard,
  type LeaderboardRow,
} from "../lib/tournamentLeaderboard";
import type { TeeTime, Tournament, TournamentType } from "../lib/types";
import { SeedMedallion } from "./ui/SeedMedallion";

type Status = "upcoming" | "active" | "past";

type EnrichedTournament = Tournament & {
  status: Status;
  published: boolean;
};

const statusOf = (tournament: Tournament, today: string): Status => {
  if (today > tournament.windowEnd) return "past";
  if (today < tournament.windowStart) return "upcoming";
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

const formatRange = (startISO: string, endISO: string): string =>
  startISO === endISO
    ? formatDateLabel(startISO)
    : `${formatDateLabel(startISO)} – ${formatDateLabel(endISO)}`;

export function SeasonSchedule({
  tournaments,
  teeTimes,
  getHandicap,
}: {
  tournaments: Tournament[];
  teeTimes: TeeTime[];
  getHandicap: (name: string) => number | null;
}) {
  const seedByKey = useMemo(() => {
    const standings = computeStandings(teeTimes, getHandicap, tournaments);
    const byPoints = sortStandings(standings, "seasonPoints");
    const map = new Map<string, number>();
    for (let index = 0; index < Math.min(POST_SEASON_SEEDS, byPoints.length); index += 1) {
      const row = byPoints[index];
      if (row.seasonPoints > 0) {
        map.set(row.name.trim().toLowerCase(), index + 1);
      }
    }
    return map;
  }, [teeTimes, tournaments, getHandicap]);

  const today = useMemo(() => todayISO(), []);
  const enriched = useMemo<EnrichedTournament[]>(
    () =>
      tournaments.map((tournament) => ({
        ...tournament,
        status: statusOf(tournament, today),
        published: !!getOfficialTournamentResults(tournament.id),
      })),
    [tournaments, today]
  );
  const activeId = enriched.find((tournament) => tournament.status === "active")?.id ?? null;
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(activeId);

  if (tournaments.length === 0) return null;

  const summary = enriched.reduce(
    (accumulator, tournament) => {
      accumulator[tournament.status] += 1;
      return accumulator;
    },
    { upcoming: 0, active: 0, past: 0 }
  );

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 transition-colors hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-bold text-stone-950">Season</span>
          <span className="text-xs text-stone-500">
            {summary.active > 0 && (
              <span className="mr-2 font-semibold text-fairway-700">
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
        <ul className="mt-2 animate-fade-up space-y-2">
          {enriched.map((tournament) => {
            const Icon = TYPE_ICON[tournament.type] ?? Flag;
            const isExpanded = expandedId === tournament.id;
            const badgeClass = tournament.published
              ? "bg-gold-100 text-gold-800"
              : STATUS_BADGE[tournament.status];
            return (
              <li
                key={tournament.id}
                className={`rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 ${
                  tournament.status === "past" && !tournament.published
                    ? "opacity-70"
                    : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : tournament.id)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-fairway-700" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-900">
                        {tournament.name}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        {formatRange(tournament.windowStart, tournament.windowEnd)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}
                    >
                      {tournament.published ? "final" : tournament.status}
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
                    tournament={tournament}
                    teeTimes={teeTimes}
                    getHandicap={getHandicap}
                    seedByKey={seedByKey}
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
  seedByKey,
}: {
  tournament: Tournament;
  teeTimes: TeeTime[];
  getHandicap: (name: string) => number | null;
  seedByKey: Map<string, number>;
}) {
  const inWindow = useMemo(
    () =>
      teeTimes
        .filter(
          (teeTime) =>
            teeTime.date >= tournament.windowStart &&
            teeTime.date <= tournament.windowEnd
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
  const official = getOfficialTournamentResults(tournament.id);
  const postSeasonBoard = useMemo(
    () =>
      tournament.type === "post"
        ? computePostSeasonLeaderboard(
            tournament,
            teeTimes,
            getHandicap,
            seedByKey
          )
        : [],
    [tournament, teeTimes, getHandicap, seedByKey]
  );

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

      {tournament.type === "post" ? (
        <PostSeasonBoard
          board={postSeasonBoard}
          tournament={tournament}
          seedByKey={seedByKey}
        />
      ) : (
        leaderboard.length > 0 && (
          <RegularLeaderboard
            board={leaderboard}
            tournament={tournament}
            published={!!official}
          />
        )
      )}

      {inWindow.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">
            Recorded rounds in this window
          </div>
          <ul className="space-y-1">
            {inWindow.map((teeTime) => (
              <li
                key={teeTime.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex items-center gap-1.5 text-stone-700">
                  <Clock className="h-3 w-3 text-stone-400" />
                  {formatDateLabel(teeTime.date)} · {formatTimeLabel(teeTime.time)}
                </span>
                <span className="text-xs text-stone-500">
                  {teeTime.claims.length}/{teeTime.spots} claimed
                  {teeTime.scores.length > 0 && (
                    <span className="ml-1 text-fairway-700">
                      · {teeTime.scores.length} scored
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tournament.type === "post" &&
        postSeasonBoard.length === 0 &&
        inWindow.length === 0 && (
          <p className="mt-3 text-xs text-stone-400">
            Post-season hasn't started yet. The top {seedByKey.size || POST_SEASON_SEEDS}{" "}
            regular-season seeds receive −4 / −3 / −2 / −1.
          </p>
        )}

      {tournament.type !== "post" &&
        leaderboard.length === 0 &&
        inWindow.length === 0 && (
          <p className="mt-3 text-xs text-stone-400">
            No rounds posted yet in this window.
          </p>
        )}
    </div>
  );
}

function RegularLeaderboard({
  board,
  tournament,
  published,
}: {
  board: LeaderboardRow[];
  tournament: Tournament;
  published: boolean;
}) {
  const positionLabel = (row: LeaderboardRow) => {
    const tied = board.filter((candidate) => candidate.position === row.position).length > 1;
    return tied ? `T${row.position}` : `${row.position}`;
  };

  return (
    <div className="mt-3 rounded-xl border border-cream-200 bg-cream-50 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cream-700">
        <Trophy className="h-3.5 w-3.5 text-gold-500" />
        {published ? "Final leaderboard" : "Leaderboard"}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-cream-700">
            <th className="pb-1 pr-2 font-medium">Pos</th>
            <th className="pb-1 pr-2 font-medium">Player</th>
            {published ? (
              <>
                <th className="pb-1 pr-2 text-right font-medium">Net</th>
                <th className="pb-1 text-right font-medium">Pts</th>
              </>
            ) : (
              <>
                <th className="pb-1 pr-2 text-right font-medium">Gross</th>
                <th className="pb-1 text-right font-medium">Net</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-200">
          {board.map((row) => (
            <tr key={row.name}>
              <td className="py-1 pr-2 tabular-nums text-stone-700">
                <span
                  className={
                    row.position === 1 ? "font-bold text-fairway-700" : ""
                  }
                >
                  {positionLabel(row)}
                </span>
              </td>
              <td className="py-1 pr-2">
                <span className="font-medium text-stone-900">{row.name}</span>
                {!published && row.rounds > 1 && (
                  <span className="ml-1 text-[10px] text-stone-400">×{row.rounds}</span>
                )}
              </td>
              {published ? (
                <>
                  <td className="py-1 pr-2 text-right tabular-nums text-stone-700">
                    {row.bestNet ?? "—"}
                  </td>
                  <td className="py-1 text-right font-semibold tabular-nums text-fairway-950">
                    {formatPoints(row.points)}
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1 pr-2 text-right tabular-nums text-stone-700">
                    {row.bestGross ?? "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums text-stone-700">
                    {row.bestNet == null
                      ? "—"
                      : row.netFromCourseHcp
                        ? row.bestNet
                        : row.bestNet.toFixed(1)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {tournament.payoutFirst != null && board[0] && (
        <p className="mt-2 font-display text-sm italic text-cream-700">
          <span className="font-semibold not-italic text-stone-700">{board[0].name}</span>{" "}
          wins ${tournament.payoutFirst}.
        </p>
      )}
    </div>
  );
}

function PostSeasonBoard({
  board,
  tournament,
  seedByKey,
}: {
  board: PostSeasonRow[];
  tournament: Tournament;
  seedByKey: Map<string, number>;
}) {
  if (board.length === 0 && seedByKey.size === 0) return null;
  const fmt1 = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

  return (
    <div className="mt-3 rounded-xl border border-cream-200 bg-cream-50 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cream-700">
        <Trophy className="h-3.5 w-3.5 text-gold-500" /> Post-season leaderboard
      </div>
      {board.length === 0 ? (
        <div className="text-xs text-stone-500">
          Seeds locked in from regular-season points; the bracket fills once
          Day 1 scores are posted.
          <ul className="mt-1.5 space-y-0.5">
            {Array.from(seedByKey.entries())
              .sort(([, a], [, b]) => a - b)
              .map(([key, seed]) => (
                <li key={key} className="flex items-center gap-1.5">
                  <SeedMedallion seed={seed} />
                  <span className="capitalize text-stone-700">{key}</span>
                  <span className="text-[10px] text-stone-400">
                    starts at {STROKE_ADVANTAGE_LABEL[seed]}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-cream-700">
                <th className="pb-1 pr-2 font-medium">Pos</th>
                <th className="pb-1 pr-2 font-medium">Player</th>
                <th className="pb-1 pr-2 text-right font-medium">Rds</th>
                <th className="pb-1 pr-2 text-right font-medium">Net</th>
                <th className="pb-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {board.map((row) => (
                <tr key={row.name}>
                  <td className="py-1 pr-2 tabular-nums text-stone-700">
                    <span
                      className={
                        row.position === 1 ? "font-bold text-fairway-700" : ""
                      }
                    >
                      {row.position}
                    </span>
                  </td>
                  <td className="py-1 pr-2">
                    <span className="flex items-center gap-1.5">
                      {row.seed && <SeedMedallion seed={row.seed} />}
                      <span className="font-medium text-stone-900">{row.name}</span>
                      {row.strokeAdvantage < 0 && (
                        <span className="text-[10px] text-stone-500">
                          {row.strokeAdvantage}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-stone-700">
                    {row.rounds}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-stone-700">
                    {row.sumNet == null ? "—" : fmt1(row.sumNet)}
                  </td>
                  <td className="py-1 text-right font-semibold tabular-nums text-fairway-950">
                    {row.adjusted == null ? "—" : fmt1(row.adjusted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {board[0] && tournament.payoutFirst != null && (
            <p className="mt-2 font-display text-sm italic text-cream-700">
              <span className="font-semibold not-italic text-stone-700">
                {board[0].name}
              </span>{" "}
              wins ${tournament.payoutFirst}
              {tournament.payoutSecond != null && board[1]
                ? `, ${board[1].name} wins $${tournament.payoutSecond}`
                : ""}
              {tournament.payoutThird != null && board[2]
                ? `, ${board[2].name} wins $${tournament.payoutThird}`
                : ""}
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

const STROKE_ADVANTAGE_LABEL: Record<number, string> = {
  1: "−4",
  2: "−3",
  3: "−2",
  4: "−1",
};

