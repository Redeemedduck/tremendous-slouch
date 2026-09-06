import React, { useEffect, useState } from "react";
import { Field, FormError, SubmitButton, inputClass } from "./ui/Field";
import { Sheet } from "./ui/Sheet";

export function ProfileSheet({
  open,
  onClose,
  initialName,
  initialHandicap,
  onSave,
  onClear,
  nameSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  initialHandicap: number | null;
  onSave: (name: string, handicap: number | null) => Promise<void> | void;
  onClear: () => void;
  nameSuggestions: string[];
}) {
  const [name, setName] = useState(initialName);
  const [handicap, setHandicap] = useState<string>(
    initialHandicap == null ? "" : String(initialHandicap)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setHandicap(initialHandicap == null ? "" : String(initialHandicap));
    setError(null);
  }, [open, initialName, initialHandicap]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) return setError("Name is required");
    let h: number | null = null;
    if (handicap.trim() !== "") {
      const v = Number(handicap);
      if (!Number.isFinite(v) || v < -10 || v > 54) {
        return setError("Handicap must be between -10 and 54");
      }
      h = Math.round(v * 10) / 10;
    }
    setSubmitting(true);
    try {
      await onSave(n, h);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your profile"
      subtitle="How your name appears on the board and leaderboards"
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            list="profile-name-suggestions"
            className={inputClass}
          />
          {nameSuggestions.length > 0 && (
            <datalist id="profile-name-suggestions">
              {nameSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </Field>
        <Field label="Handicap (GHIN index, optional)">
          <input
            type="number"
            value={handicap}
            onChange={(e) => setHandicap(e.target.value)}
            step={0.1}
            min={-10}
            max={54}
            inputMode="decimal"
            placeholder="e.g. 12.4"
            className={inputClass}
          />
        </Field>

        <FormError>{error}</FormError>

        <SubmitButton disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </SubmitButton>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Forget your profile on this device?")) {
              onClear();
              onClose();
            }
          }}
          className="w-full rounded-xl py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
        >
          Forget me on this device
        </button>
      </form>
    </Sheet>
  );
}
