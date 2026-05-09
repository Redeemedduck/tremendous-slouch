import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  ChevronDown,
  Calendar,
  MessageCircleQuestion,
  Flag,
} from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { Header } from "./components/Header";
import { NamePromptInline } from "./components/NamePromptInline";
import { NewPollSheet } from "./components/NewPollSheet";
import { NewTeeTimeSheet } from "./components/NewTeeTimeSheet";
import { PollCard } from "./components/PollCard";
import { ProfileSheet } from "./components/ProfileSheet";
import { TeeTimeCard } from "./components/TeeTimeCard";
import { Toast } from "./components/Toast";
import { useMyProfile } from "./hooks/useMyProfile";
import { usePlayers } from "./hooks/usePlayers";
import { usePolls } from "./hooks/usePolls";
import { useTeeTimes } from "./hooks/useTeeTimes";
import { useToast } from "./hooks/useToast";
import { isPast } from "./lib/format";
import type { NewPollInput, NewTeeTimeInput, TeeTime } from "./lib/types";

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

type SheetKind = "teetime" | "poll" | null;

function Board() {
  const [profile, setProfile] = useMyProfile();
  const myName = profile.name;
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
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
  const {
    polls,
    create: createPoll,
    toggleResponse,
    remove: removePoll,
  } = usePolls(toast.show);
  const { upsert: upsertPlayer, getHandicap } = usePlayers(toast.show);

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
    if (!myName) setProfile({ name: input.host });
    if (editing) {
      await update(editing.id, input);
    } else {
      await create(input);
    }
  };

  const handlePollSubmit = async (input: NewPollInput) => {
    if (!myName) setProfile({ name: input.host });
    await createPoll(input);
  };

  const handleProfileSave = async (name: string, handicap: number | null) => {
    setProfile({ name, handicap });
    try {
      await upsertPlayer(name, handicap);
    } catch {
      // toast surfaced by usePlayers
    }
  };

  const handleCloseSheet = () => {
    setOpenSheet(null);
    setEditing(null);
  };

  const handleEdit = (t: TeeTime) => {
    setEditing(t);
    setOpenSheet("teetime");
  };

  const handleToggleVote = (pollId: string, optionIdx: number) => {
    if (!myName) {
      toast.show("Add your name first");
      return;
    }
    toggleResponse(pollId, myName, optionIdx);
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
        <Header
          myName={myName}
          myHandicap={profile.handicap}
          onOpenProfile={() => setProfileSheetOpen(true)}
        />

        {!myName && (
          <NamePromptInline
            onSubmit={(n, h) => handleProfileSave(n, h)}
            nameSuggestions={nameSuggestions}
          />
        )}

        {polls.length > 0 && (
          <div className="mb-3 space-y-3">
            {polls.map((p) => (
              <PollCard
                key={p.id}
                poll={p}
                myName={myName}
                onToggle={(idx) => handleToggleVote(p.id, idx)}
                onDelete={() => removePoll(p.id)}
              />
            ))}
          </div>
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
        ) : upcoming.length === 0 && polls.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-stone-200">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
              <Flag className="h-6 w-6" />
            </div>
            <p className="text-base font-medium text-stone-700">
              Nothing on the board yet
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Tap <span className="font-medium">+</span> to post a tee time or
              ask the group.
            </p>
          </div>
        ) : upcoming.length === 0 ? null : (
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
                getHandicap={getHandicap}
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
                    getHandicap={getHandicap}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {openSheet === null && (
        <div
          className="fixed right-4 z-30"
          style={{
            bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
          }}
        >
          {fabMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setFabMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute bottom-16 right-0 z-20 flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFabMenuOpen(false);
                    setOpenSheet("teetime");
                  }}
                  className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-3 text-sm font-semibold text-stone-900 shadow-lg ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  <Calendar className="h-4 w-4 text-fairway-700" />
                  New tee time
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFabMenuOpen(false);
                    setOpenSheet("poll");
                  }}
                  className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-3 text-sm font-semibold text-stone-900 shadow-lg ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  <MessageCircleQuestion className="h-4 w-4 text-fairway-700" />
                  Ask the group
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setFabMenuOpen((v) => !v)}
            aria-label="New post"
            className="relative z-20 flex h-14 w-14 items-center justify-center rounded-full bg-fairway-600 text-white shadow-lg hover:bg-fairway-700"
          >
            <Plus
              className={`h-6 w-6 transition-transform ${
                fabMenuOpen ? "rotate-45" : ""
              }`}
            />
          </button>
        </div>
      )}

      <NewTeeTimeSheet
        open={openSheet === "teetime"}
        onClose={handleCloseSheet}
        onSubmit={handleSheetSubmit}
        defaultHost={myName}
        courseSuggestions={courseSuggestions}
        nameSuggestions={nameSuggestions}
        editing={editing}
      />
      <NewPollSheet
        open={openSheet === "poll"}
        onClose={handleCloseSheet}
        onSubmit={handlePollSubmit}
        defaultHost={myName}
        nameSuggestions={nameSuggestions}
      />
      <ProfileSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        initialName={profile.name}
        initialHandicap={profile.handicap}
        nameSuggestions={nameSuggestions}
        onSave={handleProfileSave}
        onClear={() => setProfile(null)}
      />
    </div>
  );
}
