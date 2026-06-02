import { useMemo } from "react";
import { CheckCircle2, Clock3, HelpCircle, Users } from "lucide-react";
import { formatDateLabel, formatHandicap, todayISO } from "../lib/format";
import { hasSourceBackedHandicap } from "../lib/handicapEvidence";
import type { Player, TeeTime } from "../lib/types";

const key = (value: string) => value.trim().toLowerCase();

const officialScore = (status: TeeTime["scores"][number]["attestationStatus"]) =>
  status === "attested" || status === "overridden";

const unconfirmedScore = (
  status: TeeTime["scores"][number]["attestationStatus"]
) => status == null || status === "pending" || status === "draft";

export function PublicRoster({
  players,
  teeTimes,
  myName,
}: {
  players: Player[];
  teeTimes: TeeTime[];
  myName: string;
}) {
  const today = useMemo(() => todayISO(), []);
  const rows = useMemo(() => {
    const playerByKey = new Map(players.map((player) => [key(player.name), player]));
    const names = new Map(players.map((player) => [key(player.name), player.name]));
    for (const teeTime of teeTimes) {
      for (const item of [
        ...teeTime.claims.map((claim) => claim.name),
        ...teeTime.interested.map((interest) => interest.name),
        ...teeTime.scores.map((score) => score.name),
      ]) {
        if (!names.has(key(item))) names.set(key(item), item);
      }
    }

    return [...names.entries()]
      .map(([nameKey, name]) => {
        const player = playerByKey.get(nameKey) ?? null;
        const upcomingClaim = teeTimes
          .filter((teeTime) => teeTime.date >= today)
          .find((teeTime) => teeTime.claims.some((claim) => key(claim.name) === nameKey));
        const maybeCount = teeTimes.filter((teeTime) =>
          teeTime.interested.some((interest) => key(interest.name) === nameKey)
        ).length;
        const scores = teeTimes.flatMap((teeTime) =>
          teeTime.scores.filter((score) => key(score.name) === nameKey)
        );
        return {
          key: nameKey,
          name,
          player,
          officialScores: scores.filter((score) =>
            officialScore(score.attestationStatus)
          ).length,
          pendingScores: scores.filter((score) =>
            unconfirmedScore(score.attestationStatus)
          ).length,
          upcomingClaim,
          maybeCount,
        };
      })
      .sort((a, b) => {
        const memberDelta = Number(!!b.player?.member) - Number(!!a.player?.member);
        if (memberDelta !== 0) return memberDelta;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [players, teeTimes, today]);

  const members = rows.filter((row) => row.player?.member).length;
  const guests = rows.filter((row) => row.player && !row.player.member).length;
  const missingIndexes = rows.filter(
    (row) => row.player?.member && !hasSourceBackedHandicap(row.player)
  ).length;

  return (
    <section className="space-y-3">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-900">
              League Roster
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {members} member{members === 1 ? "" : "s"}
              {guests > 0 ? ` · ${guests} guest${guests === 1 ? "" : "s"}` : ""}
              {missingIndexes > 0
                ? ` · ${missingIndexes} Handicap Index missing/unverified`
                : ""}
            </p>
          </div>
        </div>
      </section>

      <ul className="space-y-2">
        {rows.map((row) => {
          const isMe = !!myName && key(myName) === row.key;
          const player = row.player;
          const verified = player ? hasSourceBackedHandicap(player) : false;
          return (
            <li
              key={row.key}
              className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${
                isMe ? "ring-fairway-300" : "ring-stone-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-stone-900">{row.name}</p>
                    {isMe && (
                      <span className="rounded-full bg-fairway-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fairway-800">
                        You
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        player?.member
                          ? "bg-stone-900 text-white"
                          : player
                            ? "bg-amber-50 text-amber-800"
                            : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {player?.member ? "Member" : player ? "Guest" : "Unlisted"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    Handicap Index:{" "}
                    <span className="font-semibold text-stone-900">
                      {player?.handicap == null
                        ? "missing"
                        : formatHandicap(player.handicap)}
                    </span>
                    {player?.handicap != null && (
                      <span className="ml-1 text-xs text-stone-400">
                        {verified ? "verified" : "unverified"}
                      </span>
                    )}
                  </p>
                </div>
                {row.pendingScores > 0 ? (
                  <Clock3 className="h-4 w-4 shrink-0 text-amber-700" />
                ) : row.officialScores > 0 ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-fairway-700" />
                ) : (
                  <HelpCircle className="h-4 w-4 shrink-0 text-stone-300" />
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-stone-50 px-3 py-2">
                  <span className="block font-semibold text-stone-900">
                    {row.upcomingClaim
                      ? `${formatDateLabel(row.upcomingClaim.date)}`
                      : "No upcoming spot"}
                  </span>
                  <span className="text-stone-500">
                    {row.upcomingClaim?.course ?? "Committed tee time"}
                  </span>
                </div>
                <div className="rounded-xl bg-stone-50 px-3 py-2">
                  <span className="block font-semibold text-stone-900">
                    {row.officialScores} official
                    {row.pendingScores > 0 ? ` · ${row.pendingScores} pending` : ""}
                  </span>
                  <span className="text-stone-500">
                    {row.maybeCount} maybe response{row.maybeCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
