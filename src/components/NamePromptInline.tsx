import { useState } from "react";
import { FormError, inputClass } from "./ui/Field";

export function NamePromptInline({
  onSubmit,
  nameSuggestions,
}: {
  onSubmit: (name: string, handicap: number | null) => void;
  nameSuggestions: string[];
}) {
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) return;
    let h: number | null = null;
    if (handicap.trim() !== "") {
      const v = Number(handicap);
      if (!Number.isFinite(v) || v < -10 || v > 54) {
        setError("Handicap must be between -10 and 54");
        return;
      }
      h = Math.round(v * 10) / 10;
    }
    onSubmit(n, h);
  };

  return (
    <div className="mb-4 rounded-2xl border border-cream-300 bg-cream-100 p-4 shadow-sm">
      <p className="font-display text-lg font-bold text-fairway-950">
        Welcome to the club
      </p>
      <p className="mb-3 mt-0.5 text-sm text-cream-700">
        What name should we put on the board?
      </p>
      {nameSuggestions.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cream-700">
            One of these?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {nameSuggestions.slice(0, 8).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setName(suggestion)}
                className="min-h-9 rounded-full bg-white px-3 py-1 text-sm font-medium text-fairway-950 ring-1 ring-cream-400 transition-colors hover:bg-cream-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      <form className="space-y-2" onSubmit={submit}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="Your name"
              list="name-suggestions"
              className={inputClass}
            />
          </div>
          <div className="w-20 shrink-0">
            <input
              type="number"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              step={0.1}
              min={-10}
              max={54}
              placeholder="12.4"
              inputMode="decimal"
              className={inputClass}
              aria-label="Handicap (optional)"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim()}
            className="shrink-0 rounded-xl bg-fairway-800 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-fairway-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {nameSuggestions.length > 0 && (
          <datalist id="name-suggestions">
            {nameSuggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
        <p className="text-xs text-cream-700">
          Handicap is optional — same number you have in GHIN.
        </p>
        <FormError>{error}</FormError>
      </form>
    </div>
  );
}
