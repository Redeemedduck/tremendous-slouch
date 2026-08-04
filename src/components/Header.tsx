import { formatHandicap } from "../lib/format";

export function Header({
  title,
  subtitle,
  myName,
  myHandicap,
  onOpenProfile,
}: {
  title: string;
  subtitle?: string;
  myName: string;
  myHandicap: number | null;
  onOpenProfile: () => void;
}) {
  const handicap = formatHandicap(myHandicap);

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-stone-200/80 bg-stone-50/92 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fairway-800 shadow-sm ring-1 ring-fairway-900/20"
          >
            <span className="font-display text-xl font-bold leading-none text-gold-300">
              D
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.4rem] font-bold leading-tight tracking-tight text-stone-950">
              {title}
            </h1>
            {subtitle && (
              <p className="truncate text-xs font-medium text-stone-500">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {myName ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`Playing as ${myName}${handicap ? `, handicap ${handicap}` : ""}. Edit profile.`}
            className="min-h-11 shrink-0 rounded-full border border-stone-200 bg-white px-3 text-xs shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
          >
            <span className="font-semibold text-stone-800">{myName}</span>
            {handicap && (
              <span className="ml-1.5 tabular-nums text-stone-500">
                {handicap}
              </span>
            )}
          </button>
        ) : null}
      </div>
    </header>
  );
}
