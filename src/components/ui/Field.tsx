import React from "react";

/** Shared input styling so every form control matches. */
export const inputClass =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 placeholder:text-stone-400 transition-colors focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {children}
    </p>
  );
}

/** Primary full-width submit button used at the foot of every sheet. */
export function SubmitButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-xl bg-fairway-800 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-fairway-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
