import { X } from "lucide-react";

export function PlayerChip({
  name,
  isHost,
  isMe,
  onDrop,
}: {
  name: string;
  isHost: boolean;
  isMe: boolean;
  onDrop?: () => void;
}) {
  const base =
    "inline-flex min-h-10 items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-medium";
  const cls = isMe
    ? "bg-fairway-100 text-fairway-900"
    : "bg-stone-100 text-stone-700";
  return (
    <button
      type="button"
      disabled={!isMe}
      onClick={onDrop}
      className={`${base} ${cls} ${
        isMe
          ? "transition-colors hover:bg-rose-100 hover:text-rose-700"
          : "cursor-default"
      }`}
      title={isMe ? "Tap to drop your spot" : undefined}
    >
      {name}
      {isHost && (
        <span className="ml-0.5 text-[10px] uppercase tracking-wide text-stone-500">
          host
        </span>
      )}
      {isMe && <X className="h-3 w-3" />}
    </button>
  );
}
