import { useEffect, useMemo, useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { Header } from "./components/Header";
import { NamePromptInline } from "./components/NamePromptInline";
import { NewTeeTimeSheet } from "./components/NewTeeTimeSheet";
import { TeeTimeCard } from "./components/TeeTimeCard";
import { Toast } from "./components/Toast";
import { useMyName } from "./hooks/useMyName";
import { useTeeTimes } from "./hooks/useTeeTimes";
import { useToast } from "./hooks/useToast";
import { isPast } from "./lib/format";
import type { NewTeeTimeInput, TeeTime } from "./lib/types";

// ============================================================
// APP
// ============================================================
type AccessState = "checking" | "gated" | "ok";

export default function App() {
  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    fetch("/api/access")
      .then((r) => r.json())
      .then((d: { required: boolean; ok: boolean }) => {
        setAccess(d.required && !d.ok ? "gated" : "ok");
      })
      .catch(() => setAccess("ok"));
  }, []);

  if (access === "checking") return null;
  if (access === "gated") {
    return <AccessGate onUnlock={() => setAccess("ok")} />;
  }
  return <Board />;
}

function Board() {
  const [myName, setMyName] = useMyName();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TeeTime | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const toast = useToast();

  const {
    teeTimes,
    loaded,
    create,
    update,
    claim,
    drop,
    markInterested,
    dropInterest,
    remove,
  } = useTeeTimes(toast.show);

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

  // Unique courses from all tee times, most-recent first, for the course
  // autocomplete suggestions. teeTimes is sorted ascending by date+time.
  const courseSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = teeTimes.length - 1; i >= 0; i--) {
      const c = teeTimes[i].course;
      const key = c.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    }
    return result;
  }, [teeTimes]);

  // Unique claimer names from all tee times' claims, most-recent first, for
  // the name autocomplete (first-time prompt + new-tee-time host field).
  const nameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = teeTimes.length - 1; i >= 0; i--) {
      for (const c of teeTimes[i].claims) {
        const key = c.name.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(c.name);
        }
      }
    }
    return result;
  }, [teeTimes]);

  const handleSheetSubmit = async (input: NewTeeTimeInput) => {
    if (!myName) setMyName(input.host);
    if (editing) {
      await update(editing.id, input);
    } else {
      await create(input);
    }
  };

  const handleCloseSheet = () => {
    setSheetOpen(false);
    setEditing(null);
  };

  const handleEdit = (t: TeeTime) => {
    setEditing(t);
    setSheetOpen(true);
  };

  const handleClaim = (id: string) => {
    if (!myName) {
      toast.show("Add your name first");
      return;
    }
    claim(id, myName);
  };

  const handleMaybe = (id: string) => {
    if (!myName) {
      toast.show("Add your name first");
      return;
    }
    markInterested(id, myName);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Toast message={toast.message} onDismiss={toast.dismiss} />

      <div className="mx-auto max-w-md px-4 pb-32">
        <Header myName={myName} onChangeName={() => setMyName(null)} />

        {!myName && (
          <NamePromptInline
            onSubmit={(n) => setMyName(n)}
            nameSuggestions={nameSuggestions}
          />
        )}

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
              Tap <span className="font-medium">+ New tee time</span> to post one.
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
                onMaybe={() => handleMaybe(t.id)}
                onDropMaybe={(name) => dropInterest(t.id, name)}
                onDelete={() => remove(t.id)}
                onEdit={() => handleEdit(t)}
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
                    onMaybe={() => {}}
                    onDropMaybe={() => {}}
                    onDelete={() => {}}
                    onEdit={() => {}}
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
          className="fixed right-4 z-30 flex items-center gap-1.5 rounded-full bg-fairway-600 px-5 py-3 font-semibold text-white shadow-lg hover:bg-fairway-700"
          style={{
            bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
          }}
        >
          <Plus className="h-5 w-5" />
          New tee time
        </button>
      )}

      <NewTeeTimeSheet
        open={sheetOpen}
        onClose={handleCloseSheet}
        onSubmit={handleSheetSubmit}
        defaultHost={myName}
        courseSuggestions={courseSuggestions}
        nameSuggestions={nameSuggestions}
        editing={editing}
      />
    </div>
  );
}
