import { CalendarRange, ChevronRight, Trophy } from "lucide-react";
import { useMemo } from "react";
import { formatDateLabel, todayISO } from "../lib/format";
import { formatPoints } from "../lib/leaguePoints";
import { computeStandings, sortStandings } from "../lib/standings";
import type { TeeTime, Tournament } from "../lib/types";
import { SeasonSchedule } from "./SeasonSchedule";

const CHAMPIONSHIP_SEEDS = 4;

function tournamentState(tournament: Tournament, today: string) {
  if (today < tournament.windowStart) return "UPCOMING";
  if (today > tournament.windowEnd) return "COMPLETE";
  return "OPEN";
}

export function SeasonHome({
  tournaments,
  teeTimes,
  getHandicap,
  myName,
}: {
  tournaments: Tournament[];
  teeTimes: TeeTime[];
  getHandicap: (name: string) => number | null;
  myName: string;
}) {
  const today = useMemo(() => todayISO(), []);
  const standings = useMemo(
    () =>
      sortStandings(
        computeStandings(teeTimes, getHandicap, tournaments),
        "seasonPoints"
      ),
    [teeTimes, getHandicap, tournaments]
  );

  const current =
    tournaments.find(
      (tournament) =>
        tournament.type === "regular" &&
        today >= tournament.windowStart &&
        today <= tournament.windowEnd
    ) ??
    tournaments.find(
      (tournament) =>
        tournament.type === "regular" && tournament.windowStart > today
    ) ??
    [...tournaments].reverse().find((tournament) => tournament.type === "regular");

  const myIndex = standings.findIndex(
    (row) => row.name.trim().toLowerCase() === myName.trim().toLowerCase()
  );
  const fourth = standings[CHAMPIONSHIP_SEEDS - 1];
  const mine = myIndex >= 0 ? standings[myIndex] : null;
  const cutDelta =
    mine && fourth ? Math.round((mine.seasonPoints - fourth.seasonPoints) * 100) / 100 : null;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[1.35rem] bg-[#0b4a3a] text-white shadow-sm">
        <div className="border-b border-white/15 px-5 pb-4 pt-5">
          <p className="font-serif text-3xl font-bold tracking-tight">DJDI</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e9c56a]">
            2026 Summer League
          </p>
        </div>
        {current ? (
          <div className="px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e9c56a]">
                  {tournamentState(current, today)} · {current.name.split("—")[0].trim()}
                </p>
                <h2 className="mt-1 font-serif text-2xl font-semibold leading-tight">
                  {current.course}
                </h2>
                <p className="mt-1 text-sm text-white/70">
                  {formatDateLabel(current.windowStart)} – {formatDateLabel(current.windowEnd)}
                </p>
              </div>
              <CalendarRange className="mt-1 h-5 w-5 text-[#e9c56a]" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                  First place
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {current.pointsToFirst ?? 20} pts
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                  Payout
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {current.payoutFirst ? `$${current.payoutFirst}` : "—"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-6 text-sm text-white/70">Season schedule unavailable.</div>
        )}
      </section>

      {mine && (
        <section className="rounded-2xl border border-[#d8c89f] bg-[#f7efd9] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7b6a42]">
                Your position
              </p>
              <p className="mt-0.5 text-lg font-bold text-[#173b31]">
                {myIndex + 1}{myIndex === 0 ? "st" : myIndex === 1 ? "nd" : myIndex === 2 ? "rd" : "th"}
                <span className="ml-2 text-sm font-medium text-[#7b6a42]">
                  {formatPoints(mine.seasonPoints)} points
                </span>
              </p>
            </div>
            {cutDelta != null && (
              <p className={`text-right text-xs font-semibold ${cutDelta >= 0 ? "text-[#1e6b50]" : "text-[#a24f3d]"}`}>
                {cutDelta >= 0 ? `${formatPoints(cutDelta)} above cut` : `${formatPoints(Math.abs(cutDelta))} below cut`}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[1.35rem] border border-[#d8c89f] bg-[#f7efd9] shadow-sm">
        <div className="flex items-center justify-between bg-[#0b4a3a] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[#e9c56a]" />
            <h2 className="font-serif text-lg font-semibold">Season standings</h2>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e9c56a]">
            Through {Math.max(...standings.map((row) => row.rounds), 0)} events
          </span>
        </div>
        {standings.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#7b6a42]">No results posted yet.</p>
        ) : (
          <div>
            <div className="grid grid-cols-[2.25rem,1fr,4rem] px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b7d5d]">
              <span>Pos</span>
              <span>Player</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, index) => {
              const isMe =
                !!myName && row.name.trim().toLowerCase() === myName.trim().toLowerCase();
              return (
                <div key={row.name}>
                  {index === CHAMPIONSHIP_SEEDS && (
                    <div className="flex items-center gap-2 px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#9a7a2f]">
                      <span className="h-px flex-1 bg-[#c9a64e]" />
                      Championship cut
                      <span className="h-px flex-1 bg-[#c9a64e]" />
                    </div>
                  )}
                  <div
                    className={`grid min-h-11 grid-cols-[2.25rem,1fr,4rem] items-center border-t border-[#e0d4b5] px-4 ${
                      isMe ? "bg-[#efe0b8]" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold text-[#7b6a42]">{index + 1}</span>
                    <span className={`text-sm ${isMe ? "font-bold text-[#173b31]" : "font-medium text-[#263b35]"}`}>
                      {row.name}
                    </span>
                    <span className="text-right text-sm font-bold tabular-nums text-[#173b31]">
                      {formatPoints(row.seasonPoints)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-stone-900">Schedule and event boards</h2>
          <ChevronRight className="h-4 w-4 text-stone-400" />
        </div>
        <SeasonSchedule
          tournaments={tournaments}
          teeTimes={teeTimes}
          getHandicap={getHandicap}
        />
      </section>
    </div>
  );
}
