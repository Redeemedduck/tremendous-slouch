import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { todayISO } from "../lib/format";
import type { NewTeeTimeInput, TeeTime } from "../lib/types";

// ============================================================
// NEW TEE TIME SHEET
// ============================================================
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export function NewTeeTimeSheet({
  open,
  onClose,
  onSubmit,
  defaultHost,
  courseSuggestions,
  nameSuggestions,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewTeeTimeInput) => Promise<void>;
  defaultHost: string;
  courseSuggestions: string[];
  nameSuggestions: string[];
  editing: TeeTime | null;
}) {
  const [course, setCourse] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("08:00");
  const [spots, setSpots] = useState(4);
  const [host, setHost] = useState(defaultHost);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCourse(editing.course);
      setDate(editing.date);
      setTime(editing.time);
      setSpots(editing.spots);
      setHost(editing.host);
      setNotes(editing.notes ?? "");
    } else {
      setCourse("");
      setDate(todayISO());
      setTime("08:00");
      setSpots(4);
      setHost(defaultHost);
      setNotes("");
    }
    setError(null);
  }, [open, defaultHost, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!course.trim()) return setError("Course is required");
    if (!host.trim()) return setError("Your name is required");
    setSubmitting(true);
    try {
      await onSubmit({
        course: course.trim(),
        date,
        time,
        spots,
        host: host.trim(),
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || (editing ? "Couldn't save changes" : "Couldn't post tee time"));
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">
            {editing ? "Edit tee time" : "New tee time"}
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
        <form onSubmit={submit} className="space-y-3">
          <Field label="Course">
            <input
              autoFocus
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              maxLength={80}
              placeholder="Walnut Creek"
              list="course-suggestions"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
            {courseSuggestions.length > 0 && (
              <datalist id="course-suggestions">
                {courseSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={todayISO()}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total spots, including you">
              <select
                value={spots}
                onChange={(e) => setSpots(Number(e.target.value))}
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your name (host)">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                maxLength={30}
                placeholder="You"
                list="name-suggestions-host"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
              {nameSuggestions.length > 0 && (
                <datalist id="name-suggestions-host">
                  {nameSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              )}
              <p className="mt-1 text-xs text-stone-400">
                Posting claims one spot for the host.
              </p>
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={240}
              rows={2}
              placeholder="Meet at the range at 7:30"
              className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-fairway-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
          >
            {submitting
              ? editing
                ? "Saving…"
                : "Posting…"
              : editing
                ? "Save changes"
                : "Post tee time"}
          </button>
        </form>
      </div>
    </div>
  );
}
