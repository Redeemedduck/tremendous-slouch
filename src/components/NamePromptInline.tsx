import { useState } from "react";

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
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="mb-3 text-sm text-stone-600">
        What name should we use for your spots?
      </p>
      <form className="space-y-2" onSubmit={submit}>
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="Your name"
            list="name-suggestions"
            className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
          />
          <input
            type="number"
            value={handicap}
            onChange={(e) => setHandicap(e.target.value)}
            step={0.1}
            min={-10}
            max={54}
            placeholder="Hcp"
            inputMode="decimal"
            className="w-20 rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            aria-label="Handicap (optional)"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-fairway-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fairway-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="text-xs text-stone-400">
          Handicap is optional — same number you have in GHIN.
        </p>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
