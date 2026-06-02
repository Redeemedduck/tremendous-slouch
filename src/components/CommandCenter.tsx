import {
  CalendarClock,
  CheckCircle2,
  Flag,
  ShieldCheck,
  Users,
} from "lucide-react";
import { auditLeagueRules } from "../lib/audit";
import {
  formatDateLabel,
  formatTimeLabel,
  isPast,
  todayISO,
} from "../lib/format";
import type { TeeTime, Tournament } from "../lib/types";
import type { Player } from "../lib/types";

export function CommandCenter({
  teeTimes,
  tournaments,
  players,
  loaded,
}: {
  teeTimes: TeeTime[];
  tournaments: Tournament[];
  players: Player[];
  loaded: boolean;
}) {
  const today = todayISO();
  const activeTournament =
    tournaments.find((t) => today >= t.windowStart && today <= t.windowEnd) ??
    null;
  const nextTeeTime =
    teeTimes.find((teeTime) => !isPast(teeTime)) ?? null;
  const openSpots = teeTimes
    .filter((teeTime) => !isPast(teeTime))
    .reduce(
      (total, teeTime) => total + Math.max(0, teeTime.spots - teeTime.claims.length),
      0
    );
  const maybeCount = teeTimes
    .filter((teeTime) => !isPast(teeTime))
    .reduce((total, teeTime) => total + teeTime.interested.length, 0);
  const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
  const postedScores = teeTimes.reduce(
    (total, teeTime) => total + teeTime.scores.length,
    0
  );
  const boardStatus =
    openSpots > 0
      ? `${openSpots} spot${openSpots === 1 ? "" : "s"} open`
      : nextTeeTime
        ? "Groups set"
        : "Ready";

  return (
    <section className="mb-3 overflow-hidden rounded-2xl bg-stone-900 text-white shadow-sm">
      <div className="bg-fairway-700 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-fairway-100">
              Command Center
            </p>
            <h2 className="truncate text-lg font-semibold">
              {activeTournament ? activeTournament.name : "Board operations"}
            </h2>
          </div>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
            {boardStatus}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {nextTeeTime
                ? `${formatDateLabel(nextTeeTime.date)} at ${formatTimeLabel(nextTeeTime.time)}`
                : loaded
                  ? "No tee times posted"
                  : "Syncing board"}
            </p>
            <p className="truncate text-sm text-stone-300">
              {nextTeeTime
                ? `${nextTeeTime.course} · ${nextTeeTime.claims.length}/${nextTeeTime.spots} claimed`
                : loaded
                  ? "Post the next group time when it is ready."
                  : "Loading tee times, scores, and money status."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric
            icon={Users}
            label="Open"
            value={String(openSpots)}
            tone={openSpots > 0 ? "warn" : "ok"}
          />
          <Metric icon={Flag} label="Maybe" value={String(maybeCount)} />
          <Metric
            icon={ShieldCheck}
            label="Scores"
            value={String(postedScores)}
            tone={ruleIssues.length > 0 ? "warn" : "ok"}
          />
        </div>

        <div className="rounded-xl bg-white/10 p-3 text-sm text-stone-200">
          <div className="flex items-center gap-2 font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-fairway-100" />
            {nextTeeTime
              ? "Coordinate the next group and post scores after the round."
              : "Post the next tee time when the group is ready."}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "ok";
}) {
  const toneClass =
    tone === "warn"
      ? "bg-amber-400/15 text-amber-50"
      : tone === "ok"
        ? "bg-fairway-600/40 text-fairway-50"
        : "bg-white/10 text-stone-100";
  return (
    <div className={`rounded-xl p-3 ${toneClass}`}>
      <Icon className="mb-1 h-4 w-4 opacity-80" />
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-80">
        {label}
      </div>
    </div>
  );
}
