import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TeeTime } from "../lib/types";
import { formatDateLabel, formatTimeLabel } from "../lib/format";

type Draft = { gross: string; courseHcp: string; attestedBy: string };

export function ScoresSheet({
  open,
  onClose,
  teeTime,
  onRecord,
  isLeagueRound,
  isMember,
}: {
  open: boolean;
  onClose: () => void;
  teeTime: TeeTime | null;
  onRecord: (
    name: string,
    gross: number,
    courseHcp: number | null,
    attestedBy: string | null
  ) => Promise<void>;
  /** True when this tee time falls inside a tournament window — course
   *  handicap and attestation are required so net math is correct and the
   *  league rule is honored. */
  isLeagueRound: boolean;
  /** Whether a given name is a registered league member. Used to scope the
   *  attester dropdown to other-members-only on the same tee time. */
  isMember: (name: string) => boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teeTime) return;
    // Prefill from existing scores so edits are easy.
    const prefill: Record<string, Draft> = {};
    for (const c of teeTime.claims) {
      const s = teeTime.scores.find(
        (x) => x.name.toLowerCase() === c.name.toLowerCase()
      );
      prefill[c.name] = {
        gross: s ? String(s.gross) : "",
        courseHcp: s?.courseHcp != null ? String(s.courseHcp) : "",
        attestedBy: s?.attestedBy ?? "",
      };
    }
    setDrafts(prefill);
    setError(null);
  }, [open, teeTime]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !teeTime) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const tasks: {
      name: string;
      gross: number;
      courseHcp: number | null;
      attestedBy: string | null;
    }[] = [];
    for (const [name, raw] of Object.entries(drafts)) {
      const grossStr = raw.gross.trim();
      const hcpStr = raw.courseHcp.trim();
      const attestedBy = raw.attestedBy.trim();
      if (!grossStr && !hcpStr && !attestedBy) continue;
      if (!grossStr) {
        setError(`${name}: score is required`);
        return;
      }
      const v = Number(grossStr);
      if (!Number.isInteger(v) || v < 1 || v > 300) {
        setError(`${name}: score must be a whole number between 1 and 300`);
        return;
      }
      let courseHcp: number | null = null;
      if (hcpStr) {
        const h = Number(hcpStr);
        if (!Number.isInteger(h) || h < -10 || h > 54) {
          setError(`${name}: course handicap must be a whole number between -10 and 54`);
          return;
        }
        courseHcp = h;
      } else if (isLeagueRound) {
        setError(`${name}: league rounds need a course handicap (from GHIN)`);
        return;
      }
      if (isLeagueRound && !attestedBy) {
        setError(`${name}: league rounds need an attester (another member)`);
        return;
      }
      tasks.push({
        name,
        gross: v,
        courseHcp,
        attestedBy: attestedBy || null,
      });
    }
    if (tasks.length === 0) {
      setError("Enter at least one score");
      return;
    }
    setSubmitting(true);
    try {
      for (const task of tasks) {
        await onRecord(
          task.name,
          task.gross,
          task.courseHcp,
          task.attestedBy
        );
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't save scores");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40"
      />
      <div className="absolute bottom-0 left-0 right-0 mx-auto max-h-[calc(100dvh-1rem)] max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">
            Record scores
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-stone-500">
          {teeTime.course} · {formatDateLabel(teeTime.date)} ·{" "}
          {formatTimeLabel(teeTime.time)}
        </p>

        <form onSubmit={submit} className="space-y-3">
          {teeTime.claims.length === 0 ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
              No one was claimed for this round.
            </p>
          ) : (
            <>
              {teeTime.claims.map((c) => {
                const draft =
                  drafts[c.name] ?? { gross: "", courseHcp: "", attestedBy: "" };
                // Attester options: other claimers who are registered members.
                const attesters = teeTime.claims
                  .filter((other) => other.name !== c.name && isMember(other.name))
                  .map((other) => other.name);
                const grossStr = draft.gross.trim();
                const hcpStr = draft.courseHcp.trim();
                const gross = Number(grossStr);
                const hcp = Number(hcpStr);
                const net =
                  grossStr !== "" &&
                  hcpStr !== "" &&
                  Number.isInteger(gross) &&
                  Number.isInteger(hcp)
                    ? gross - hcp
                    : null;
                return (
                  <div
                    key={c.name}
                    className="space-y-3 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-base font-semibold text-stone-900">
                        {c.name}
                      </label>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">
                        {net == null ? "Net -" : `Net ${net}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                          Gross
                        </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={draft.gross}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [c.name]: { ...draft, gross: e.target.value },
                          }))
                        }
                        step={1}
                        min={1}
                        max={300}
                        placeholder="-"
                        aria-label={`${c.name} gross score`}
                          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-lg font-semibold tabular-nums focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                          Course HCP
                        </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={draft.courseHcp}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [c.name]: { ...draft, courseHcp: e.target.value },
                          }))
                        }
                        step={1}
                        min={-10}
                        max={54}
                        placeholder={isLeagueRound ? "req" : "-"}
                        aria-label={`${c.name} course handicap`}
                          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-lg font-semibold tabular-nums focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                      </label>
                    </div>
                    {isLeagueRound && (
                      <div>
                        {attesters.length > 0 ? (
                          <label className="space-y-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                              Attester
                            </span>
                          <select
                            value={draft.attestedBy}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [c.name]: {
                                  ...draft,
                                  attestedBy: e.target.value,
                                },
                              }))
                            }
                            aria-label={`${c.name} attested by`}
                              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-base text-stone-700 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                          >
                            <option value="">Attested by…</option>
                            {attesters.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                          </label>
                        ) : (
                          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            No other members on this tee time — score can't be
                            attested.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {isLeagueRound && (
                <p className="text-xs text-stone-500">
                  League round — each player needs a course handicap (from
                  GHIN) and an attester (another member who played in your
                  group).
                </p>
              )}
            </>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-3 backdrop-blur">
            <button
              type="submit"
              disabled={submitting || teeTime.claims.length === 0}
              className="w-full rounded-xl bg-fairway-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save scores"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
