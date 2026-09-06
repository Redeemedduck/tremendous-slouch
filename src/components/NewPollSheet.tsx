import React, { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { NewPollInput } from "../lib/types";
import { Field, FormError, SubmitButton, inputClass } from "./ui/Field";
import { Sheet } from "./ui/Sheet";

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

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
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask the group"
      subtitle="Everyone votes; ties get settled on the first tee"
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Question">
          <input
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={140}
            placeholder="Anyone want to play MC on the 15th or 22nd?"
            className={inputClass}
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
                  className={inputClass}
                />
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    aria-label="Remove option"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-rose-600"
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
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-fairway-700 transition-colors hover:bg-fairway-50"
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
            className={inputClass}
          />
          {nameSuggestions.length > 0 && (
            <datalist id="name-suggestions-poll">
              {nameSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </Field>

        <FormError>{error}</FormError>

        <SubmitButton disabled={submitting}>
          {submitting ? "Posting…" : "Post poll"}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
