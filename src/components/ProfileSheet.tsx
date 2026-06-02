import React, { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

export function ProfileSheet({
  open,
  onClose,
  initialName,
  initialHandicap,
  onSave,
  onClear,
  onOpenCommissioner,
  nameSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  initialHandicap: number | null;
  onSave: (name: string, handicap: number | null) => Promise<void> | void;
  onClear: () => void;
  onOpenCommissioner: () => void;
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
          <h2 className="text-lg font-semibold text-stone-900">Your profile</h2>
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
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              list="profile-name-suggestions"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
            {nameSuggestions.length > 0 && (
              <datalist id="profile-name-suggestions">
                {nameSuggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Handicap (GHIN index, optional)
            </span>
            <input
              type="number"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              step={0.1}
              min={-10}
              max={54}
              inputMode="decimal"
              placeholder="e.g. 12.4"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
          </label>

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
            {submitting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Forget your profile on this device?")) {
                onClear();
                onClose();
              }
            }}
            className="w-full rounded-xl py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            Forget me on this device
          </button>
          <button
            type="button"
            onClick={onOpenCommissioner}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            <ShieldCheck className="h-4 w-4 text-fairway-700" />
            Commissioner tools
          </button>
        </form>
      </div>
    </div>
  );
}
