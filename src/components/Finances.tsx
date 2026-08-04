import { useMemo, useState } from "react";
import { Banknote, Check, ChevronDown } from "lucide-react";
import type { Buyin } from "../lib/types";

export function Finances({
  buyins,
  onToggle,
}: {
  buyins: Buyin[];
  onToggle: (name: string, paid: boolean) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => {
    let expected = 0;
    let collected = 0;
    for (const b of buyins) {
      expected += b.amount;
      if (b.paid) collected += b.amount;
    }
    return { expected, collected, outstanding: expected - collected };
  }, [buyins]);

  if (buyins.length === 0) return null;

  const paidCount = buyins.filter((b) => b.paid).length;
  const pct = totals.expected > 0 ? (totals.collected / totals.expected) * 100 : 0;

  return (
    <section className="mb-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-3 text-left transition-colors hover:bg-stone-50"
      >
        <span className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-fairway-700" />
            <span className="font-display text-lg font-bold text-stone-950">
              Pool
            </span>
            <span className="text-xs text-stone-500">
              <span className="font-semibold text-stone-900">
                ${totals.collected.toLocaleString()}
              </span>{" "}
              of ${totals.expected.toLocaleString()}
              <span className="ml-2">
                · {paidCount}/{buyins.length} paid
              </span>
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-stone-500 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
        <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-stone-100">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-fairway-600 to-fairway-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
      </button>

      {open && (
        <div className="animate-fade-up border-t border-stone-100 px-3 pb-3">
          <ul className="divide-y divide-stone-100">
            {buyins.map((b) => (
              <li
                key={b.playerName}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-medium text-stone-900">
                    {b.playerName}
                  </span>
                  <span className="text-xs tabular-nums text-stone-500">
                    ${b.amount.toLocaleString()}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(b.playerName, !b.paid)}
                  className={`inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    b.paid
                      ? "bg-fairway-100 text-fairway-900 hover:bg-fairway-200"
                      : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  }`}
                >
                  {b.paid && <Check className="h-3 w-3" />}
                  {b.paid ? "Paid" : "Owed"}
                </button>
              </li>
            ))}
          </ul>
          {totals.outstanding > 0 && (
            <p className="mt-2 text-[11px] text-stone-500">
              <span className="font-semibold text-amber-700">
                ${totals.outstanding.toLocaleString()}
              </span>{" "}
              outstanding. Default buy-in is $325 per member; toggle Paid as
              members hand it over.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
