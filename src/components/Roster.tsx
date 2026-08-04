import { useMemo, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { formatHandicap } from "../lib/format";
import type { Player, TeeTime } from "../lib/types";

export function Roster({
  players,
  teeTimes,
  onUpdate,
}: {
  players: Player[];
  teeTimes: TeeTime[];
  onUpdate: (
    name: string,
    patch: { member: boolean }
  ) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  // Augment with anyone who's appeared in a claim/score/interest but isn't in
  // the players table yet (so the host can flag them as drop-in or member
  // without needing to wait for them to register a profile).
  const seenNames = useMemo(() => {
    const set = new Set<string>(players.map((p) => p.name));
    const lower = new Set(players.map((p) => p.name.toLowerCase()));
    for (const tt of teeTimes) {
      for (const c of tt.claims) {
        if (!lower.has(c.name.toLowerCase())) {
          set.add(c.name);
          lower.add(c.name.toLowerCase());
        }
      }
      for (const i of tt.interested) {
        if (!lower.has(i.name.toLowerCase())) {
          set.add(i.name);
          lower.add(i.name.toLowerCase());
        }
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [players, teeTimes]);

  if (seenNames.length === 0) return null;

  const memberMap = new Map(players.map((p) => [p.name.toLowerCase(), p]));

  const memberCount = players.filter((p) => p.member).length;
  const dropInCount = players.filter((p) => !p.member && p.handicap != null)
    .length;
  const unknownCount = seenNames.length - players.length;

  return (
    <section className="mb-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between px-4 py-3 transition-colors hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-fairway-700" />
          <span className="font-display text-lg font-bold text-stone-950">
            Roster
          </span>
          <span className="text-xs text-stone-500">
            <span className="font-semibold text-stone-700">{memberCount}</span>{" "}
            member{memberCount === 1 ? "" : "s"}
            {dropInCount > 0 && (
              <span className="ml-2">
                · {dropInCount} guest{dropInCount === 1 ? "" : "s"}
              </span>
            )}
            {unknownCount > 0 && (
              <span className="ml-2">· {unknownCount} unflagged</span>
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
        <div className="animate-fade-up border-t border-stone-100 px-3 pb-3">
          <ul className="divide-y divide-stone-100">
            {seenNames.map((name) => {
              const p = memberMap.get(name.toLowerCase());
              const hcp = p ? formatHandicap(p.handicap) : null;
              const member = p?.member ?? false;
              return (
                <li
                  key={name}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium text-stone-900">{name}</span>
                    {hcp && (
                      <span className="text-xs tabular-nums text-stone-500">
                        {hcp}
                      </span>
                    )}
                    {!p && (
                      <span className="text-[10px] uppercase tracking-wide text-stone-500">
                        no profile
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdate(name, { member: !member })}
                    className={`min-h-9 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      member
                        ? "bg-fairway-100 text-fairway-900 hover:bg-fairway-200"
                        : "bg-white text-stone-600 ring-1 ring-stone-300 hover:bg-stone-50"
                    }`}
                  >
                    {member ? "Member" : "Guest"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-stone-500">
            Tap to toggle. Members count toward the season; guests are drop-in
            players (a member's friend who buys into a single tournament).
          </p>
        </div>
      )}
    </section>
  );
}
