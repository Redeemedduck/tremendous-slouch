import { type FormEvent, useState } from "react";

export function NamePromptInline({
  onSubmit,
  nameSuggestions,
}: {
  onSubmit: (name: string, handicap: number | null) => void;
  nameSuggestions: string[];
}) {
  const [name, setName] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSubmit(n, null);
  };

  return (
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="mb-3 text-sm text-stone-600">
        What name should we use for your spots?
      </p>
      <form className="space-y-2" onSubmit={submit}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="Your name"
            list="name-suggestions"
            className="col-span-2 min-w-0 rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100 sm:col-span-1 sm:flex-1"
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
          Handicap info lives in the roster and can be updated later.
        </p>
      </form>
    </div>
  );
}
