import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TeeTime } from "../lib/types";
import { formatDateLabel, formatTimeLabel } from "../lib/format";

type Draft = { gross: string; courseHcp: string };

export function ScoresSheet({
  open,
  onClose,
  teeTime,
  onRecord,
}: {
  open: boolean;
  onClose: () => void;
  teeTime: TeeTime | null;
  onRecord: (
    name: string,
    gross: number,
    courseHcp: number | null
  ) => Promise<void>;
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
    }[] = [];
    for (const [name, raw] of Object.entries(drafts)) {
      const grossStr = raw.gross.trim();
      const hcpStr = raw.courseHcp.trim();
      if (!grossStr && !hcpStr) continue;
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
      }
      tasks.push({ name, gross: v, courseHcp });
    }
    if (tasks.length === 0) {
      setError("Enter at least one score");
      return;
    }
    setSubmitting(true);
    try {
      for (const task of tasks) {
        await onRecord(task.name, task.gross, task.courseHcp);
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
              <div className="grid grid-cols-[1fr,5rem,5rem] items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                <span>Player</span>
                <span className="text-right">Gross</span>
                <span className="text-right">Course HCP</span>
              </div>
              {teeTime.claims.map((c) => {
                const draft = drafts[c.name] ?? { gross: "", courseHcp: "" };
                return (
                  <div key={c.name} className="space-y-2">
                    <div className="grid grid-cols-[1fr,5rem,5rem] items-center gap-2">
                      <label className="text-sm font-medium text-stone-900">
                        {c.name}
                      </label>
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
                        className="rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
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
                        placeholder="-"
                        aria-label={`${c.name} course handicap`}
                        className="rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || teeTime.claims.length === 0}
            className="w-full rounded-xl bg-fairway-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save scores"}
          </button>
        </form>
      </div>
    </div>
  );
}
