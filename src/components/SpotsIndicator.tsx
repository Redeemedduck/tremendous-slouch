import { Users } from "lucide-react";

export function SpotsIndicator({
  filled,
  total,
  interested = 0,
}: {
  filled: number;
  total: number;
  interested?: number;
}) {
  // Visual: filled (solid green) → maybe-shown (outlined green) → empty (stone).
  // Maybe overflow (when interested > remaining slots) is not drawn but is
  // still shown in the count text.
  const remaining = Math.max(0, total - filled);
  const maybeShown = Math.min(interested, remaining);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => {
          const isFilled = i < filled;
          const isMaybe = !isFilled && i < filled + maybeShown;
          return (
            <span
              key={i}
              className={`inline-block h-2 w-2 rounded-full ${
                isFilled
                  ? "bg-fairway-600"
                  : isMaybe
                    ? "border border-fairway-500 bg-white"
                    : "bg-stone-200"
              }`}
            />
          );
        })}
      </div>
      <span className="text-xs font-medium text-stone-500">
        <Users className="inline h-3 w-3 -mt-0.5" /> {filled} of {total} spots
        {interested > 0 && (
          <span className="ml-1 text-stone-400">+ {interested} maybe</span>
        )}
      </span>
    </div>
  );
}
