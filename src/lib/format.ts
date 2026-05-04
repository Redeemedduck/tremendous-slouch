// ============================================================
// HELPERS
// ============================================================
export const NAME_KEY = "golf.coordinator.myName";

export const eqName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const formatDateLabel = (dateISO: string) => {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export const formatTimeLabel = (hhmm: string) => {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
};

// Naive datetime: interpreted in the client's local timezone, which is correct
// for a single-region group. Server stores date/time as opaque strings.
export const isPast = (t: { date: string; time: string }) =>
  new Date(`${t.date}T${t.time}:00`).getTime() < Date.now();

export const todayISO = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
