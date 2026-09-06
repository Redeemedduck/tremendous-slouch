/** Struck-coin championship seed medal: static conic sheen + inset
 *  highlights. A coin, not a chip — no animation. */
export function SeedMedallion({
  seed,
  size = "sm",
}: {
  seed: number;
  size?: "sm" | "lg";
}) {
  return (
    <span
      title={`Championship seed ${seed}`}
      className={`inline-flex items-center justify-center rounded-full bg-[conic-gradient(from_220deg,var(--color-gold-300),var(--color-cream-100)_20%,var(--color-gold-400)_45%,var(--color-gold-600)_60%,var(--color-gold-300)_85%)] font-bold text-fairway-950 ring-1 ring-gold-600/60 shadow-[inset_0_1px_1px_rgb(255_255_255/0.65),inset_0_-1px_1px_rgb(66_48_18/0.35),0_1px_2px_rgb(66_48_18/0.3)] ${
        size === "lg" ? "h-9 w-9 text-sm" : "h-6 w-6 text-[11px]"
      }`}
    >
      <span className="flex h-[calc(100%-3px)] w-[calc(100%-3px)] items-center justify-center rounded-full ring-1 ring-gold-700/25">
        {seed}
      </span>
    </span>
  );
}
