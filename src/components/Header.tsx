import { formatHandicap } from "../lib/format";

// ============================================================
// HEADER
// ============================================================
export function Header({
  myName,
  myHandicap,
  onOpenProfile,
}: {
  myName: string;
  myHandicap: number | null;
  onOpenProfile: () => void;
}) {
  const hcp = formatHandicap(myHandicap);
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-stone-200 bg-stone-50/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          DJDI Golf Board
        </h1>
        {myName ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`Playing as ${myName}${hcp ? `, handicap ${hcp}` : ""}. Tap to edit.`}
            className="rounded-full px-3 py-1.5 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span className="hidden sm:inline">You're </span>
            <span className="font-medium text-stone-700">{myName}</span>
            {hcp && <span className="ml-1 text-stone-400">({hcp})</span>}
            <span className="ml-1 text-stone-400">· edit</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
