import { useState } from "react";
import { MoreHorizontal, Trash2, MessageCircleQuestion, Check } from "lucide-react";
import { eqName } from "../lib/format";
import type { Poll } from "../lib/types";

export function PollCard({
  poll,
  myName,
  onToggle,
  onDelete,
}: {
  poll: Poll;
  myName: string;
  onToggle: (optionIdx: number) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isHost = !!myName && eqName(poll.host, myName);

  // Group responses by option index for fast lookup.
  const byOption: Record<number, string[]> = {};
  for (const r of poll.responses) {
    if (!byOption[r.optionIdx]) byOption[r.optionIdx] = [];
    byOption[r.optionIdx].push(r.name);
  }
  const maxVotes = Math.max(
    1,
    ...poll.options.map((_, idx) => (byOption[idx] ?? []).length)
  );

  const lower = myName.toLowerCase();
  const myPicks = new Set(
    poll.responses
      .filter((r) => r.name.toLowerCase() === lower)
      .map((r) => r.optionIdx)
  );

  return (
    <article className="relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-fairway-700" />
          <div>
            <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
              Poll · asked by {poll.host}
            </span>
            <h2 className="mt-0.5 text-base font-bold text-stone-950">
              {poll.prompt}
            </h2>
          </div>
        </div>
        {isHost && (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Host options"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-xl bg-white p-1 shadow-lg ring-1 ring-stone-200">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (window.confirm(`Delete this poll? This can't be undone.`)) {
                        onDelete();
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete poll
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {poll.options.map((opt, idx) => {
          const responders = byOption[idx] || [];
          const mine = myPicks.has(idx);
          const share = (responders.length / maxVotes) * 100;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => onToggle(idx)}
                disabled={!myName}
                className={`group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  mine
                    ? "border-fairway-600 bg-fairway-50"
                    : "border-stone-200 bg-white hover:border-stone-300"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {responders.length > 0 && (
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${
                      mine ? "bg-fairway-100/70" : "bg-stone-100/80"
                    }`}
                    style={{ width: `${share}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2 text-sm font-medium text-stone-900">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      mine
                        ? "border-fairway-600 bg-fairway-600"
                        : "border-stone-300 bg-white group-hover:border-stone-400"
                    }`}
                  >
                    {mine && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                  {opt}
                </span>
                <span className="relative text-xs font-bold tabular-nums text-stone-500">
                  {responders.length}
                </span>
              </button>
              {responders.length > 0 && (
                <div className="ml-7 mt-1.5 flex flex-wrap gap-1">
                  {responders.map((n) => (
                    <span
                      key={n}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        eqName(n, myName)
                          ? "bg-fairway-100 text-fairway-900"
                          : "bg-stone-100 text-stone-600"
                      }`}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!myName && (
        <p className="mt-3 text-xs text-stone-500">
          Add your name above to vote.
        </p>
      )}
    </article>
  );
}
