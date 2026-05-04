import { Users } from "lucide-react";

export function SpotsIndicator({ filled, total }: { filled: number; total: number }) {
  const dots = Array.from({ length: total });
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {dots.map((_, i) => (
          <span
            key={i}
            className={`inline-block h-2 w-2 rounded-full ${
              i < filled ? "bg-fairway-600" : "bg-stone-200"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-stone-500">
        <Users className="inline h-3 w-3 -mt-0.5" /> {filled} of {total} spots
      </span>
    </div>
  );
}
