import { useMemo, useState } from "react";
import {
  CalendarRange,
  ChevronDown,
  Flag,
  MapPin,
  Star,
  Trophy,
} from "lucide-react";
import { formatDateLabel, todayISO } from "../lib/format";
import type { Tournament, TournamentType } from "../lib/types";

type Status = "upcoming" | "active" | "past";

const statusOf = (t: Tournament, today: string): Status => {
  if (today > t.windowEnd) return "past";
  if (today < t.windowStart) return "upcoming";
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

function formatRange(startISO: string, endISO: string) {
  if (startISO === endISO) return formatDateLabel(startISO);
  return `${formatDateLabel(startISO)} – ${formatDateLabel(endISO)}`;
}

export function SeasonSchedule({
  tournaments,
}: {
  tournaments: Tournament[];
}) {
  const today = useMemo(() => todayISO(), []);
  const enriched = useMemo(
    () =>
      tournaments.map((t) => ({
        ...t,
        status: statusOf(t, today),
      })),
    [tournaments, today]
  );
  const activeId = enriched.find((t) => t.status === "active")?.id ?? null;
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(activeId);

  if (tournaments.length === 0) return null;

  const summary = enriched.reduce(
    (acc, t) => {
      acc[t.status] += 1;
      return acc;
    },
    { upcoming: 0, active: 0, past: 0 }
  );

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">
            Season
          </span>
          <span className="text-xs text-stone-500">
            {summary.active > 0 && (
              <span className="mr-2 font-medium text-fairway-700">
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
        <ul className="mt-2 space-y-2">
          {enriched.map((t) => {
            const Icon = TYPE_ICON[t.type] ?? Flag;
            const isExpanded = expandedId === t.id;
            return (
              <li
                key={t.id}
                className={`rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 ${
                  t.status === "past" ? "opacity-70" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-fairway-700" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-900">
                        {t.name}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        {formatRange(t.windowStart, t.windowEnd)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[t.status]}`}
                    >
                      {t.status}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-stone-400 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-stone-100 p-3 text-sm">
                    <div className="flex items-center gap-1.5 text-stone-700">
                      <MapPin className="h-3.5 w-3.5 text-fairway-700" />
                      <span className="font-medium">{t.course}</span>
                    </div>
                    {t.notes && (
                      <p className="mt-2 text-sm text-stone-600">{t.notes}</p>
                    )}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {t.pointsToFirst != null && (
                        <Pair label="Points (1st)" value={`${t.pointsToFirst}`} />
                      )}
                      {t.payoutFirst != null && (
                        <Pair label="Payout 1st" value={`$${t.payoutFirst}`} />
                      )}
                      {t.payoutSecond != null && (
                        <Pair label="Payout 2nd" value={`$${t.payoutSecond}`} />
                      )}
                      {t.payoutThird != null && (
                        <Pair label="Payout 3rd" value={`$${t.payoutThird}`} />
                      )}
                    </dl>
                  </div>
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
