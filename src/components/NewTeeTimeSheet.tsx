import React, { useEffect, useState } from "react";
import { todayISO } from "../lib/format";
import type { NewTeeTimeInput, TeeTime } from "../lib/types";
import { Field, FormError, SubmitButton, inputClass } from "./ui/Field";
import { Sheet } from "./ui/Sheet";

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

  // Editing any field clears the banner — native date/time validation can
  // block submit entirely, which would otherwise leave a stale error up.
  const set = <T,>(setter: (value: T) => void) => (value: T) => {
    setError(null);
    setter(value);
  };
  const setCourseInput = set(setCourse);
  const setDateInput = set(setDate);
  const setTimeInput = set(setTime);
  const setSpotsInput = set(setSpots);
  const setHostInput = set(setHost);
  const setNotesInput = set(setNotes);

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
      setError(
        err?.message ||
          (editing ? "Couldn't save changes" : "Couldn't post tee time")
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit tee time" : "New tee time"}
      subtitle={editing ? undefined : "Post a round for the group to claim"}
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Course">
          <input
            autoFocus
            value={course}
            onChange={(e) => setCourseInput(e.target.value)}
            maxLength={80}
            placeholder="Walnut Creek"
            list="course-suggestions"
            className={inputClass}
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
              onChange={(e) => setDateInput(e.target.value)}
              min={todayISO()}
              className={inputClass}
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={time}
              onChange={(e) => setTimeInput(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total spots">
            <select
              value={spots}
              onChange={(e) => setSpotsInput(Number(e.target.value))}
              className={inputClass}
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
              onChange={(e) => setHostInput(e.target.value)}
              maxLength={30}
              placeholder="You"
              list="name-suggestions-host"
              className={inputClass}
            />
            {nameSuggestions.length > 0 && (
              <datalist id="name-suggestions-host">
                {nameSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotesInput(e.target.value)}
            maxLength={240}
            rows={2}
            placeholder="Meet at the range at 7:30"
            className={`${inputClass} resize-none`}
          />
        </Field>

        <FormError>{error}</FormError>

        <SubmitButton disabled={submitting}>
          {submitting
            ? editing
              ? "Saving…"
              : "Posting…"
            : editing
              ? "Save changes"
              : "Post tee time"}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
