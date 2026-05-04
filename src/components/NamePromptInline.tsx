import { useState } from "react";

export function NamePromptInline({
  onSubmit,
  nameSuggestions,
}: {
  onSubmit: (name: string) => void;
  nameSuggestions: string[];
}) {
  const [value, setValue] = useState("");
  return (
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="mb-3 text-sm text-stone-600">
        What name should we use for your spots?
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={30}
          placeholder="Your name"
          list="name-suggestions"
          className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
        />
        {nameSuggestions.length > 0 && (
          <datalist id="name-suggestions">
            {nameSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded-lg bg-fairway-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fairway-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </div>
  );
}
