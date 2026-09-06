import React, { useState } from "react";
import { FormError, inputClass } from "./ui/Field";

export function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || "That's not it. Ask the group thread.");
        setAttempt((n) => n + 1);
        return;
      }
      onUnlock();
    } catch {
      setError("Couldn't reach server");
      setAttempt((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="texture-pine flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="animate-fade-up text-center">
        <p className="font-display text-6xl font-bold tracking-tight text-cream-50">
          DJDI
        </p>
        <div className="mx-auto mt-3 flex items-center gap-3">
          <span className="h-px w-12 bg-gold-400/60" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-300">
            2026 Summer League
          </p>
          <span className="h-px w-12 bg-gold-400/60" />
        </div>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-cream-100/60">
          Est. 2026 · Members only
        </p>
      </div>

      <div
        key={attempt}
        className={`mt-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ${
          attempt > 0 ? "motion-safe:animate-shake" : "animate-fade-up [animation-delay:0.08s]"
        }`}
      >
        <h1 className="font-display text-2xl font-bold tracking-tight text-stone-950">
          At the door
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Enter the group access code to open the board.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="Access code"
            className={inputClass}
          />
          <FormError>{error}</FormError>
          <button
            type="submit"
            disabled={submitting || !code.trim()}
            className="w-full rounded-xl bg-fairway-800 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-fairway-700 disabled:opacity-60"
          >
            {submitting ? "Checking the list…" : "Open the board"}
          </button>
        </form>
      </div>
    </div>
  );
}
