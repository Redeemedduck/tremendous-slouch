import { X } from "lucide-react";
import { formatHandicap } from "../lib/format";

type Variant = "claimed" | "interested";

export function PlayerChip({
  name,
  isHost,
  isMe,
  onDrop,
  variant = "claimed",
  handicap,
  isDropIn = false,
}: {
  name: string;
  isHost: boolean;
  isMe: boolean;
  onDrop?: () => void;
  variant?: Variant;
  handicap?: number | null;
  /** True if the player is a known drop-in (not a full league member). */
  isDropIn?: boolean;
}) {
  const hcp = formatHandicap(handicap);
  // The chip is only actionable when it's the current user AND a drop
  // handler was wired in (read-only past cards pass undefined).
  const interactive = isMe && typeof onDrop === "function";
  const base =
    "inline-flex min-h-10 items-center gap-1 rounded-full px-3.5 py-1.5 text-sm";
  const cls =
    variant === "interested"
      ? isMe
        ? "border border-dashed border-fairway-400 bg-fairway-50 text-fairway-800 italic"
        : "border border-dashed border-stone-300 bg-stone-50 text-stone-600 italic"
      : isMe
        ? "bg-fairway-100 text-fairway-900 font-medium"
        : "bg-stone-100 text-stone-700 font-medium";
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onDrop}
      className={`${base} ${cls} ${
        interactive
          ? "transition-colors hover:bg-rose-100 hover:text-rose-700"
          : "cursor-default"
      }`}
      title={
        interactive
          ? variant === "interested"
            ? "Tap to remove your maybe"
            : "Tap to drop your spot"
          : undefined
      }
    >
      {name}
      {hcp && (
        <span className="ml-0.5 text-xs font-normal text-stone-500">
          {hcp}
        </span>
      )}
      {isHost && (
        <span className="ml-0.5 text-[10px] uppercase tracking-wide text-stone-500">
          host
        </span>
      )}
      {isDropIn && !isHost && (
        <span className="ml-0.5 text-[10px] uppercase tracking-wide text-stone-500">
          guest
        </span>
      )}
      {interactive && <X className="h-3 w-3" />}
    </button>
  );
}
