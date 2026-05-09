import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TeeTime } from "../lib/types";
import { formatDateLabel, formatTimeLabel } from "../lib/format";

export function ScoresSheet({
  open,
  onClose,
  teeTime,
  onRecord,
}: {
  open: boolean;
  onClose: () => void;
  teeTime: TeeTime | null;
  onRecord: (name: string, gross: number) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teeTime) return;
    // Prefill from existing scores so edits are easy.
    const prefill: Record<string, string> = {};
    for (const c of teeTime.claims) {
      const s = teeTime.scores.find(
        (x) => x.name.toLowerCase() === c.name.toLowerCase()
      );
      prefill[c.name] = s ? String(s.gross) : "";
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
    const tasks: { name: string; gross: number }[] = [];
    for (const [name, raw] of Object.entries(drafts)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const v = Number(trimmed);
      if (!Number.isInteger(v) || v < 1 || v > 300) {
        setError(`${name}: score must be a whole number between 1 and 300`);
        return;
      }
      tasks.push({ name, gross: v });
    }
    if (tasks.length === 0) {
      setError("Enter at least one score");
      return;
    }
    setSubmitting(true);
    try {
      for (const { name, gross } of tasks) {
        await onRecord(name, gross);
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
            teeTime.claims.map((c) => (
              <label key={c.name} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium text-stone-900">
                  {c.name}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={drafts[c.name] ?? ""}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [c.name]: e.target.value,
                    }))
                  }
                  step={1}
                  min={1}
                  max={300}
                  placeholder="Gross"
                  className="w-24 rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                />
              </label>
            ))
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
