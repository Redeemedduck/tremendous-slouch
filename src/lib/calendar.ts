import type { TeeTime } from "./types";

// ============================================================
// CALENDAR EXPORT (.ics)
// ============================================================
export const TEE_TIME_DURATION_MS = 4 * 60 * 60 * 1000;

export const pad2 = (n: number) => String(n).padStart(2, "0");

// Floating local time per RFC 5545 — no Z, no TZID. Calendar clients render
// it in the user's local zone, which matches our naive datetime model.
export const icsLocal = (d: Date) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

export const icsUtc = (d: Date) =>
  `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;

export const icsEscape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tee-time";

export const buildIcs = (t: TeeTime): string => {
  const start = new Date(`${t.date}T${t.time}:00`);
  const end = new Date(start.getTime() + TEE_TIME_DURATION_MS);
  const description = [`Hosted by ${t.host}`, t.notes].filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DJDI Golf Board//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${t.id}@djdi-golf-board`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsLocal(start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:Golf at ${icsEscape(t.course)}`,
    `LOCATION:${icsEscape(t.course)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

export const downloadIcs = (t: TeeTime) => {
  const blob = new Blob([buildIcs(t)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `golf-${slugify(t.course)}-${t.date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
