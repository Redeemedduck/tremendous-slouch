import React, { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { NewPollInput } from "../lib/types";

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

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

export function NewPollSheet({
  open,
  onClose,
  onSubmit,
  defaultHost,
  nameSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewPollInput) => Promise<void>;
  defaultHost: string;
  nameSuggestions: string[];
}) {
  const [prompt, setPrompt] = useState("");
  const [host, setHost] = useState(defaultHost);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setHost(defaultHost);
    setOptions(["", ""]);
    setError(null);
  }, [open, defaultHost]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setOption = (i: number, value: string) => {
    setOptions((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, ""]);
  };

  const removeOption = (i: number) => {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) return setError("Question is required");
    if (!host.trim()) return setError("Your name is required");
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length < MIN_OPTIONS) {
      return setError(`Add at least ${MIN_OPTIONS} options`);
    }
    setSubmitting(true);
    try {
      await onSubmit({
        prompt: prompt.trim(),
        host: host.trim(),
        options: cleaned,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't post poll");
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
            Ask the group
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
          <Field label="Question">
            <input
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={140}
              placeholder="Anyone want to play MC on the 15th or 22nd?"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
          </Field>

          <Field label="Options">
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    maxLength={60}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                  />
                  {options.length > MIN_OPTIONS && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      aria-label="Remove option"
                      className="flex h-10 w-10 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {options.length < MAX_OPTIONS && (
                <button
                  type="button"
                  onClick={addOption}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-fairway-700 hover:bg-fairway-50"
                >
                  <Plus className="h-4 w-4" /> Add option
                </button>
              )}
            </div>
          </Field>

          <Field label="Your name (asker)">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              maxLength={30}
              placeholder="You"
              list="name-suggestions-poll"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
            {nameSuggestions.length > 0 && (
              <datalist id="name-suggestions-poll">
                {nameSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
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
            {submitting ? "Posting…" : "Post poll"}
          </button>
        </form>
      </div>
    </div>
  );
}
