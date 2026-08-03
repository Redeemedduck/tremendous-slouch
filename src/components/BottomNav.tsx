import { CalendarDays, Settings2, Trophy } from "lucide-react";

export type AppSection = "board" | "season" | "manage";

const ITEMS: {
  id: AppSection;
  label: string;
  Icon: typeof CalendarDays;
}[] = [
  { id: "board", label: "Board", Icon: CalendarDays },
  { id: "season", label: "Season", Icon: Trophy },
  { id: "manage", label: "Manage", Icon: Settings2 },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: AppSection;
  onChange: (section: AppSection) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto grid max-w-md grid-cols-3 px-3 py-1.5">
        {ITEMS.map(({ id, label, Icon }) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onChange(id)}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2 ${
                selected
                  ? "bg-fairway-50 text-fairway-900"
                  : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={selected ? 2.4 : 2} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
