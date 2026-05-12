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

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">Pool</span>
          <span className="text-xs text-stone-500">
            <span className="font-medium text-stone-900">
              ${totals.collected.toLocaleString()}
            </span>{" "}
            collected of{" "}
            <span className="text-stone-700">
              ${totals.expected.toLocaleString()}
            </span>
            <span className="ml-2 text-stone-400">
              · {paidCount}/{buyins.length} paid
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-stone-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
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
                  <span className="text-xs text-stone-400">
                    ${b.amount.toLocaleString()}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(b.playerName, !b.paid)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    b.paid
                      ? "bg-fairway-100 text-fairway-900 hover:bg-fairway-200"
                      : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                  }`}
                >
                  {b.paid && <Check className="h-3 w-3" />}
                  {b.paid ? "Paid" : "Owed"}
                </button>
              </li>
            ))}
          </ul>
          {totals.outstanding > 0 && (
            <p className="mt-2 text-[11px] text-stone-400">
              <span className="font-medium text-amber-700">
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
