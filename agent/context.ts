// ============================================================
// buildLeagueContext — pure transform from raw app data (REST
// response shapes) into the LeagueContext the parser prompts with.
// No I/O, no clocks beyond the injected `now`, no mutation of inputs.
// ============================================================

import type { LeagueContext } from "./types";

const DENVER_TZ = "America/Denver";
const TEE_TIME_LOOKBACK_DAYS = 10;
const MAX_COURSES = 15;

/** Structural subsets of the app's REST response shapes. */
export type RawTeeTimeLike = {
  course: string;
  date: string;
  time: string;
  spots: number;
  claims: readonly unknown[];
};
export type RawPlayerLike = { name: string; member: boolean };
export type RawTournamentLike = {
  name: string;
  course: string;
  windowStart: string;
  windowEnd: string;
  type: string;
};
export type RawPollLike = { prompt: string; options: readonly string[] };

export type RawLeagueData = {
  teeTimes: readonly RawTeeTimeLike[];
  players: readonly RawPlayerLike[];
  tournaments: readonly RawTournamentLike[];
  polls: readonly RawPollLike[];
};

/** Today's date + weekday for `now`, computed in America/Denver. */
function denverToday(now: Date): { today: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(now);
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    today: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
  };
}

/** Shift a naive YYYY-MM-DD date by `days` (calendar math, no timezones). */
function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/** Case-insensitive course dedup, most recent first, capped. */
function buildCourseList(raw: RawLeagueData): string[] {
  const byKey = new Map<string, { name: string; recency: string }>();
  const consider = (name: string, recency: string): void => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing || recency > existing.recency) {
      byKey.set(key, { name: trimmed, recency });
    }
  };
  for (const t of raw.tournaments) consider(t.course, t.windowStart);
  for (const tt of raw.teeTimes) consider(tt.course, tt.date);
  return [...byKey.values()]
    .sort((a, b) => (a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0))
    .slice(0, MAX_COURSES)
    .map((entry) => entry.name);
}

/** Roster names, member players first (original order within each group). */
function buildPlayerList(players: readonly RawPlayerLike[]): string[] {
  return [
    ...players.filter((p) => p.member),
    ...players.filter((p) => !p.member),
  ].map((p) => p.name);
}

/** The non-post tournament whose window contains `today`, else null. */
function findLiveStop(
  tournaments: readonly RawTournamentLike[],
  today: string
): LeagueContext["liveStop"] {
  const live = tournaments.find(
    (t) => t.type !== "post" && t.windowStart <= today && today <= t.windowEnd
  );
  return live
    ? { name: live.name, course: live.course, windowEnd: live.windowEnd }
    : null;
}

/** Build the parser's LeagueContext from raw app data. Pure. */
export function buildLeagueContext(
  raw: RawLeagueData,
  senderName: string,
  now: Date = new Date()
): LeagueContext {
  const { today, weekday } = denverToday(now);
  const cutoff = shiftDate(today, -TEE_TIME_LOOKBACK_DAYS);

  const teeTimes = raw.teeTimes
    .filter((tt) => tt.date >= cutoff)
    .map((tt) => ({
      course: tt.course,
      date: tt.date,
      time: tt.time,
      open: tt.spots - tt.claims.length,
    }));

  return {
    today,
    weekday,
    senderName,
    courses: buildCourseList(raw),
    players: buildPlayerList(raw.players),
    teeTimes,
    polls: raw.polls.map((p) => ({ prompt: p.prompt, options: [...p.options] })),
    liveStop: findLiveStop(raw.tournaments, today),
  };
}
