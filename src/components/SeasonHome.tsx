import { CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";
import { eqName, formatDateLabel, ordinal, todayISO } from "../lib/format";
import { formatPoints } from "../lib/leaguePoints";
import { hasOfficialTournamentResults } from "../lib/officialResults";
import { STROKE_ADVANTAGES } from "../lib/postSeason";
import { computeStandings, sortStandings } from "../lib/standings";
import type { TeeTime, Tournament } from "../lib/types";
import { SeasonSchedule } from "./SeasonSchedule";
import { SeedMedallion } from "./ui/SeedMedallion";

const CHAMPIONSHIP_SEEDS = STROKE_ADVANTAGES.length;

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

type HeroState = "live" | "next" | "final";

const heroState = (tournament: Tournament, today: string): HeroState => {
  if (today < tournament.windowStart) return "next";
  if (today > tournament.windowEnd) return "final";
  return "live";
};

const HERO_STATE_LABEL: Record<HeroState, string> = {
  live: "Live now",
  next: "Next up",
  final: "Final",
};

type BoardTab = "points" | "form";

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
  const [tab, setTab] = useState<BoardTab>("points");

  const allRows = useMemo(
    () => computeStandings(teeTimes, getHandicap, tournaments),
    [teeTimes, getHandicap, tournaments]
  );
  const standings = useMemo(
    () => sortStandings(allRows, "seasonPoints"),
    [allRows]
  );
  const formRows = useMemo(() => sortStandings(allRows, "avgNet"), [allRows]);

  const regulars = tournaments.filter((t) => t.type === "regular");
  const current =
    regulars.find((t) => today >= t.windowStart && today <= t.windowEnd) ??
    regulars.find((t) => t.windowStart > today) ??
    regulars[regulars.length - 1];

  const stopsPlayed = regulars.filter(
    (t) => hasOfficialTournamentResults(t.id) || t.windowEnd < today
  ).length;

  const myIndex = standings.findIndex(
    (row) => eqName(row.name, myName)
  );
  const mine = myIndex >= 0 ? standings[myIndex] : null;
  const cutRow = standings[CHAMPIONSHIP_SEEDS - 1];
  const cutDelta =
    mine && cutRow
      ? Math.round((mine.seasonPoints - cutRow.seasonPoints) * 100) / 100
      : null;
  const mySeed =
    mine && myIndex < CHAMPIONSHIP_SEEDS && mine.seasonPoints > 0
      ? myIndex + 1
      : null;

  return (
    <div className="space-y-4">
      {/* ------- Current stop hero ------- */}
      <section className="texture-pine overflow-hidden rounded-3xl text-white shadow-md ring-1 ring-fairway-950/40">
        <div className="flex items-baseline justify-between gap-3 border-b border-white/12 px-5 pb-3 pt-4">
          <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-300">
            DJDI · 2026 Summer League
          </p>
          <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
            {stopsPlayed} of {regulars.length} played
          </p>
        </div>
        {current ? (
          <div className="px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
                  {heroState(current, today) === "live" ? (
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inset-0 rounded-full bg-gold-300 motion-safe:animate-ping-slow" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-gold-300" />
                    </span>
                  ) : (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/40" />
                  )}
                  {HERO_STATE_LABEL[heroState(current, today)]} ·{" "}
                  {current.name.split("—")[0].trim()}
                </p>
                <h2 className="mt-1 font-display text-3xl font-semibold leading-tight text-cream-50">
                  {current.course}
                </h2>
                <p className="mt-1 text-sm text-white/70">
                  {formatDateLabel(current.windowStart)} –{" "}
                  {formatDateLabel(current.windowEnd)}
                </p>
              </div>
              <CalendarRange className="mt-1 h-5 w-5 shrink-0 text-gold-300" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/12 pt-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  Winner takes
                </p>
                <p className="mt-0.5 font-display text-2xl font-bold text-cream-50">
                  {current.pointsToFirst ?? 20} pts
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  Payout
                </p>
                <p className="mt-0.5 font-display text-2xl font-bold text-cream-50">
                  {current.payoutFirst ? `$${current.payoutFirst}` : "—"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-6 text-sm text-white/70">
            Season schedule unavailable.
          </div>
        )}
      </section>

      {/* ------- Your position ------- */}
      {mine && (
        <section className="rounded-2xl border border-cream-400 bg-cream-100 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {mySeed ? (
                <SeedMedallion seed={mySeed} size="lg" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-200 font-display text-base font-bold text-fairway-950 ring-1 ring-cream-400">
                  {myIndex + 1}
                </span>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-700">
                  Your position
                </p>
                <p className="mt-0.5 font-display text-2xl font-bold leading-none text-fairway-950">
                  {ordinal(myIndex + 1)}
                  <span className="ml-2 font-sans text-sm font-medium text-cream-700">
                    {formatPoints(mine.seasonPoints)} pts
                  </span>
                </p>
              </div>
            </div>
            <div className="text-right">
              {mySeed ? (
                <p className="text-xs font-semibold text-fairway-700">
                  Carries {STROKE_ADVANTAGES[mySeed - 1]} into the championship
                </p>
              ) : cutDelta != null ? (
                <p
                  className={`text-xs font-semibold ${
                    cutDelta >= 0 ? "text-fairway-700" : "text-rose-700/80"
                  }`}
                >
                  {cutDelta >= 0
                    ? `${formatPoints(cutDelta)} inside the cut`
                    : `${formatPoints(Math.abs(cutDelta))} back of the cut`}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* ------- Season standings board ------- */}
      <section className="overflow-hidden rounded-3xl border border-cream-300 bg-cream-100 shadow-sm">
        <div className="flex items-center justify-between bg-fairway-800 px-4 py-3 text-white">
          <h2 className="font-display text-xl font-semibold text-cream-50">
            Season standings
          </h2>
          <div className="flex rounded-full bg-fairway-950/50 p-0.5">
            <BoardTabButton
              active={tab === "points"}
              label="Points"
              onClick={() => setTab("points")}
            />
            <BoardTabButton
              active={tab === "form"}
              label="Form"
              onClick={() => setTab("form")}
            />
          </div>
        </div>

        {standings.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-cream-700">
            No results posted yet — the board fills in after the first stop.
          </p>
        ) : tab === "points" ? (
          <div key="points">
            <div className="grid grid-cols-[2.25rem_1fr_4rem] gap-x-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cream-700">
              <span>Pos</span>
              <span>Player</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, index) => {
              const isMe =
                !!myName &&
                eqName(row.name, myName);
              const seeded = index < CHAMPIONSHIP_SEEDS && row.seasonPoints > 0;
              const isLeader = index === 0 && row.seasonPoints > 0;
              const isBubble = index === CHAMPIONSHIP_SEEDS;
              const rowWash = isLeader
                ? "bg-gradient-to-r from-gold-100/70 to-transparent"
                : isMe
                  ? "bg-gold-100/70"
                  : seeded
                    ? "bg-gold-50/50"
                    : "";
              return (
                <div
                  key={row.name}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}
                >
                  {index === CHAMPIONSHIP_SEEDS && (
                    <div className="flex items-center gap-2 px-4 py-2 text-[9px] font-bold uppercase tracking-[0.2em] text-gold-700">
                      <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-gold-400)_0_6px,transparent_6px_11px)]" />
                      <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-gold-500" />
                      Championship cut
                      <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-gold-500" />
                      <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-gold-400)_0_6px,transparent_6px_11px)]" />
                    </div>
                  )}
                  <div
                    className={`relative grid ${isLeader ? "min-h-12" : "min-h-11"} grid-cols-[2.25rem_1fr_4rem] items-center gap-x-2 border-t border-cream-200 px-4 ${rowWash}`}
                  >
                    {isLeader && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-gold-300 to-gold-500"
                      />
                    )}
                    <span>
                      {seeded ? (
                        <SeedMedallion seed={index + 1} />
                      ) : (
                        <span className="text-sm font-semibold tabular-nums text-cream-700">
                          {index + 1}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`text-sm ${
                          isMe || isLeader
                            ? "font-bold text-fairway-950"
                            : "font-medium text-fairway-950/85"
                        }`}
                      >
                        {row.name}
                        {isLeader && (
                          <span className="ml-2 rounded-[3px] border border-gold-400/70 px-1 py-px align-middle text-[8px] font-bold uppercase tracking-[0.2em] text-gold-700">
                            Leader
                          </span>
                        )}
                      </span>
                      {isBubble && cutRow && (
                        <span className="block text-[10px] italic text-cream-700">
                          first man out ·{" "}
                          {formatPoints(
                            Math.round(
                              (cutRow.seasonPoints - row.seasonPoints) * 100
                            ) / 100
                          )}{" "}
                          back
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-right font-bold text-fairway-950 ${
                        isLeader
                          ? "font-display text-xl"
                          : "text-base tabular-nums"
                      }`}
                    >
                      {formatPoints(row.seasonPoints)}
                    </span>
                  </div>
                </div>
              );
            })}
            <p className="border-t border-cream-200 px-4 py-2.5 text-[10px] leading-4 text-cream-700">
              20–15–14–11–9–8–7–6–5–4–3–2; ties split the occupied places. Top{" "}
              {CHAMPIONSHIP_SEEDS} seeds carry −4 / −3 / −2 / −1 into the
              championship.
            </p>
          </div>
        ) : (
          <div key="form">
            <div className="grid grid-cols-[1fr_2.5rem_3rem_3rem] gap-x-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cream-700">
              <span>Player</span>
              <span className="text-right">Rds</span>
              <span className="text-right">Avg</span>
              <span className="text-right">Best</span>
            </div>
            {formRows.map((row, index) => {
              const isMe =
                !!myName &&
                eqName(row.name, myName);
              return (
                <div
                  key={row.name}
                  className={`grid min-h-11 animate-fade-up grid-cols-[1fr_2.5rem_3rem_3rem] items-center gap-x-2 border-t border-cream-200 px-4 ${
                    isMe ? "bg-gold-100/70" : ""
                  }`}
                  style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}
                >
                  <span
                    className={`text-sm ${
                      isMe
                        ? "font-bold text-fairway-950"
                        : "font-medium text-fairway-950/85"
                    }`}
                  >
                    {row.name}
                  </span>
                  <span className="text-right text-sm tabular-nums text-fairway-950/70">
                    {row.rounds}
                  </span>
                  <span className="text-right text-base font-bold tabular-nums text-fairway-950">
                    {row.avgNet == null ? "—" : fmt1(row.avgNet)}
                  </span>
                  <span className="text-right text-sm tabular-nums text-fairway-950/70">
                    {row.bestNet == null ? "—" : fmt1(row.bestNet)}
                  </span>
                </div>
              );
            })}
            <p className="border-t border-cream-200 px-4 py-2.5 text-[10px] leading-4 text-cream-700">
              Net form across every recorded round. Published stops use the
              final league boards; other rounds use the recorded course
              handicap when available.
            </p>
          </div>
        )}
      </section>

      {/* ------- Schedule & event boards ------- */}
      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-stone-900">
          Schedule and event boards
        </h2>
        <SeasonSchedule
          tournaments={tournaments}
          teeTimes={teeTimes}
          getHandicap={getHandicap}
        />
      </section>
    </div>
  );
}

function BoardTabButton({
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
      aria-pressed={active}
      className={`min-h-8 rounded-full px-3.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-gold-300 text-fairway-950"
          : "text-cream-100/80 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

