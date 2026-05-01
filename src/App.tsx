import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Plus,
  Clock,
  MapPin,
  Users,
  X,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  Calendar as CalendarIcon,
} from "lucide-react";

// ============================================================
// TYPES
// ============================================================
type Claim = { name: string; claimedAt: string };
type TeeTime = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes: string | null;
  claims: Claim[];
  createdAt: string;
};
type NewTeeTimeInput = {
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes?: string;
};

// ============================================================
// HELPERS
// ============================================================
const NAME_KEY = "golf.coordinator.myName";

const eqName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const formatDateLabel = (dateISO: string) => {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const formatTimeLabel = (hhmm: string) => {
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
const isPast = (t: { date: string; time: string }) =>
  new Date(`${t.date}T${t.time}:00`).getTime() < Date.now();

const todayISO = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// ============================================================
// HOOKS
// ============================================================
function useMyName() {
  const [name, setNameState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(NAME_KEY) ?? "";
  });
  const setName = useCallback((next: string | null) => {
    if (next == null || next.trim() === "") {
      localStorage.removeItem(NAME_KEY);
      setNameState("");
    } else {
      const trimmed = next.trim().slice(0, 30);
      localStorage.setItem(NAME_KEY, trimmed);
      setNameState(trimmed);
    }
  }, []);
  return [name, setName] as const;
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const show = useCallback((msg: string) => {
    setMessage(msg);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(null), 3000);
  }, []);
  const dismiss = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setMessage(null);
  }, []);
  return { message, show, dismiss } as const;
}

function useTeeTimes(onError: (msg: string) => void) {
  const [teeTimes, setTeeTimes] = useState<TeeTime[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/teetimes");
      if (!r.ok) throw new Error("Failed to load tee times");
      const data = (await r.json()) as { teeTimes: TeeTime[] };
      setTeeTimes(data.teeTimes);
      setLoaded(true);
    } catch {
      // silent on poll errors; surface only on manual actions
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const replace = useCallback((updated: TeeTime) => {
    setTeeTimes((prev) => {
      const next = prev.filter((t) => t.id !== updated.id);
      next.push(updated);
      next.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
      });
      return next;
    });
  }, []);

  const create = useCallback(
    async (input: NewTeeTimeInput) => {
      const r = await fetch("/api/teetimes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't create tee time");
        throw new Error(data.error || "create failed");
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const claim = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(`/api/teetimes/${id}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't claim spot");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const drop = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(
        `/api/teetimes/${id}/claims/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't drop spot");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/teetimes/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        onError(data.error || "Couldn't delete tee time");
        return;
      }
      setTeeTimes((prev) => prev.filter((t) => t.id !== id));
    },
    [onError]
  );

  return { teeTimes, loaded, create, claim, drop, remove, refresh };
}

// ============================================================
// SMALL COMPONENTS
// ============================================================
function SpotsIndicator({ filled, total }: { filled: number; total: number }) {
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
        <Users className="inline h-3 w-3 -mt-0.5" /> {filled} of {total}
      </span>
    </div>
  );
}

function PlayerChip({
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
    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium";
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

function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4">
      <div
        role="status"
        onClick={onDismiss}
        className="cursor-pointer rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        {message}
      </div>
    </div>
  );
}

// ============================================================
// HEADER + NAME PROMPT
// ============================================================
function Header({
  myName,
  onChangeName,
}: {
  myName: string;
  onChangeName: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-stone-200 bg-stone-50/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          Golf Group
        </h1>
        {myName ? (
          <p className="text-xs text-stone-500">
            You're <span className="font-medium text-stone-700">{myName}</span>
            {" · "}
            <button
              type="button"
              onClick={onChangeName}
              className="text-fairway-700 underline-offset-2 hover:underline"
            >
              change
            </button>
          </p>
        ) : null}
      </div>
    </header>
  );
}

function NamePromptInline({
  onSubmit,
}: {
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
      <p className="mb-3 text-sm text-stone-600">
        What name should we put on your spots?
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={30}
          placeholder="Your name"
          className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded-lg bg-fairway-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fairway-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </div>
  );
}

// ============================================================
// TEE TIME CARD
// ============================================================
function TeeTimeCard({
  teeTime,
  myName,
  readOnly,
  onClaim,
  onDrop,
  onDelete,
}: {
  teeTime: TeeTime;
  myName: string;
  readOnly: boolean;
  onClaim: () => void;
  onDrop: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meIn = !!myName && teeTime.claims.some((c) => eqName(c.name, myName));
  const isHost = !!myName && eqName(teeTime.host, myName);
  const full = teeTime.claims.length >= teeTime.spots;

  return (
    <article
      className={`relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 ${
        readOnly ? "opacity-60" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatDateLabel(teeTime.date)}
            <span className="text-stone-300">·</span>
            <Clock className="h-3.5 w-3.5" />
            {formatTimeLabel(teeTime.time)}
          </div>
          <h2 className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-stone-900">
            <MapPin className="h-4 w-4 text-fairway-700" />
            {teeTime.course}
          </h2>
        </div>
        {!readOnly && isHost && (
          <div className="relative">
            <button
              type="button"
              aria-label="Host options"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full p-1 text-stone-500 hover:bg-stone-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg bg-white p-1 shadow-lg ring-1 ring-stone-200">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (
                        window.confirm(
                          `Delete this tee time at ${teeTime.course}? This can't be undone.`
                        )
                      ) {
                        onDelete();
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete tee time
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-sm text-stone-500">
        Hosted by{" "}
        <span className="font-medium text-stone-700">{teeTime.host}</span>
      </p>

      {teeTime.notes && (
        <p className="mt-2 text-sm text-stone-600">{teeTime.notes}</p>
      )}

      <div className="mt-3">
        <SpotsIndicator filled={teeTime.claims.length} total={teeTime.spots} />
      </div>

      {teeTime.claims.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {teeTime.claims.map((c) => (
            <PlayerChip
              key={c.name}
              name={c.name}
              isHost={eqName(c.name, teeTime.host)}
              isMe={!!myName && eqName(c.name, myName)}
              onDrop={
                !readOnly && !!myName && eqName(c.name, myName)
                  ? () => {
                      if (
                        window.confirm(`Drop your spot at ${teeTime.course}?`)
                      ) {
                        onDrop(c.name);
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {!readOnly && !meIn && (
        <button
          type="button"
          onClick={onClaim}
          disabled={full || !myName}
          className="mt-4 w-full rounded-xl bg-fairway-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-fairway-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none"
        >
          {full ? "Full" : !myName ? "Add your name to claim" : "Claim a spot"}
        </button>
      )}
    </article>
  );
}

// ============================================================
// NEW TEE TIME SHEET
// ============================================================
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function NewTeeTimeSheet({
  open,
  onClose,
  onSubmit,
  defaultHost,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewTeeTimeInput) => Promise<void>;
  defaultHost: string;
}) {
  const [course, setCourse] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("08:00");
  const [spots, setSpots] = useState(4);
  const [host, setHost] = useState(defaultHost);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCourse("");
      setDate(todayISO());
      setTime("08:00");
      setSpots(4);
      setHost(defaultHost);
      setNotes("");
      setError(null);
    }
  }, [open, defaultHost]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!course.trim()) return setError("Course is required");
    if (!host.trim()) return setError("Your name is required");
    setSubmitting(true);
    try {
      await onSubmit({
        course: course.trim(),
        date,
        time,
        spots,
        host: host.trim(),
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't post tee time");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40"
      />
      <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-md rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">New tee time</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Course">
            <input
              autoFocus
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              maxLength={80}
              placeholder="Walnut Creek"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={todayISO()}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total spots">
              <select
                value={spots}
                onChange={(e) => setSpots(Number(e.target.value))}
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your name (host)">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                maxLength={30}
                placeholder="You"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={240}
              rows={2}
              placeholder="Meet at the range at 7:30"
              className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-fairway-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
          >
            {submitting ? "Posting…" : "Post tee time"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// APP
// ============================================================
export default function App() {
  const [myName, setMyName] = useMyName();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const toast = useToast();

  const { teeTimes, loaded, create, claim, drop, remove } = useTeeTimes(
    toast.show
  );

  const { upcoming, past } = useMemo(() => {
    const upcoming: TeeTime[] = [];
    const past: TeeTime[] = [];
    for (const t of teeTimes) {
      if (isPast(t)) past.push(t);
      else upcoming.push(t);
    }
    past.reverse();
    return { upcoming, past };
  }, [teeTimes]);

  const handleCreate = async (input: NewTeeTimeInput) => {
    if (!myName) setMyName(input.host);
    await create(input);
  };

  const handleClaim = (id: string) => {
    if (!myName) {
      toast.show("Add your name first");
      return;
    }
    claim(id, myName);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Toast message={toast.message} onDismiss={toast.dismiss} />

      <div className="mx-auto max-w-md px-4 pb-32">
        <Header myName={myName} onChangeName={() => setMyName(null)} />

        {!myName && <NamePromptInline onSubmit={(n) => setMyName(n)} />}

        {!loaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl bg-stone-100"
              />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-stone-200">
            <p className="text-base font-medium text-stone-700">
              No tee times yet
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Tap <span className="font-medium">+</span> to post one.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((t) => (
              <TeeTimeCard
                key={t.id}
                teeTime={t}
                myName={myName}
                readOnly={false}
                onClaim={() => handleClaim(t.id)}
                onDrop={(name) => drop(t.id, name)}
                onDelete={() => remove(t.id)}
              />
            ))}
          </div>
        )}

        {past.length > 0 && (
          <section className="mt-8">
            <button
              type="button"
              onClick={() => setPastOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-sm font-medium text-stone-500 hover:text-stone-700"
            >
              <span>Past tee times ({past.length})</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  pastOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {pastOpen && (
              <div className="mt-2 space-y-3">
                {past.map((t) => (
                  <TeeTimeCard
                    key={t.id}
                    teeTime={t}
                    myName={myName}
                    readOnly
                    onClaim={() => {}}
                    onDrop={() => {}}
                    onDelete={() => {}}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {!sheetOpen && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="New tee time"
          className="fixed bottom-6 right-4 z-30 flex items-center gap-1.5 rounded-full bg-fairway-600 px-5 py-3 font-semibold text-white shadow-lg hover:bg-fairway-700"
          style={{
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
          }}
        >
          <Plus className="h-5 w-5" />
          New tee time
        </button>
      )}

      <NewTeeTimeSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleCreate}
        defaultHost={myName}
      />
    </div>
  );
}
