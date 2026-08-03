import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Flag,
  MessageCircleQuestion,
  Trophy,
} from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { BottomNav, type AppSection } from "./components/BottomNav";
import { Finances } from "./components/Finances";
import { Header } from "./components/Header";
import { NamePromptInline } from "./components/NamePromptInline";
import { NewPollSheet } from "./components/NewPollSheet";
import { NewTeeTimeSheet } from "./components/NewTeeTimeSheet";
import { PollCard } from "./components/PollCard";
import { ProfileSheet } from "./components/ProfileSheet";
import { Roster } from "./components/Roster";
import { ScoresSheet } from "./components/ScoresSheet";
import { SeasonHome } from "./components/SeasonHome";
import { TeeTimeCard } from "./components/TeeTimeCard";
import { Toast } from "./components/Toast";
import { useBuyins } from "./hooks/useBuyins";
import { useMyProfile } from "./hooks/useMyProfile";
import { usePlayers } from "./hooks/usePlayers";
import { usePolls } from "./hooks/usePolls";
import { useTeeTimes } from "./hooks/useTeeTimes";
import { useToast } from "./hooks/useToast";
import { useTournaments } from "./hooks/useTournaments";
import { formatDateLabel, isPast, todayISO } from "./lib/format";
import type { NewPollInput, NewTeeTimeInput, TeeTime } from "./lib/types";

type AccessState = "checking" | "gated" | "ok";
type SheetKind = "teetime" | "poll" | null;

const SECTION_META: Record<AppSection, { title: string; subtitle: string }> = {
  board: { title: "DJDI Board", subtitle: "Tee sheet & group decisions" },
  season: { title: "Season", subtitle: "The race for the championship" },
  manage: { title: "Manage", subtitle: "Roster, buy-ins & history" },
};

export default function App() {
  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    fetch("/api/access")
      .then((response) => response.json())
      .then((data: { required: boolean; ok: boolean }) => {
        setAccess(data.required && !data.ok ? "gated" : "ok");
      })
      .catch(() => setAccess("ok"));
  }, []);

  if (access === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-200 border-t-fairway-600" />
      </div>
    );
  }
  if (access === "gated") {
    return <AccessGate onUnlock={() => setAccess("ok")} />;
  }
  return <LeagueApp />;
}

function LeagueApp() {
  const [section, setSection] = useState<AppSection>("board");
  const [profile, setProfile] = useMyProfile();
  const myName = profile.name;
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [editing, setEditing] = useState<TeeTime | null>(null);
  const [scoringTeeTime, setScoringTeeTime] = useState<TeeTime | null>(null);
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
    recordScore,
    postComment,
    deleteComment,
    remove,
  } = useTeeTimes(toast.show);
  const {
    polls,
    create: createPoll,
    toggleResponse,
    remove: removePoll,
  } = usePolls(toast.show);
  const {
    players,
    upsert: upsertPlayer,
    getHandicap,
    isMember,
  } = usePlayers(toast.show);
  const { tournaments } = useTournaments();
  const { buyins, patch: patchBuyin, refresh: refreshBuyins } =
    useBuyins(toast.show);

  const { upcoming, past } = useMemo(() => {
    const next: TeeTime[] = [];
    const completed: TeeTime[] = [];
    for (const teeTime of teeTimes) {
      if (isPast(teeTime)) completed.push(teeTime);
      else next.push(teeTime);
    }
    completed.reverse();
    return { upcoming: next, past: completed };
  }, [teeTimes]);

  const courseSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let index = teeTimes.length - 1; index >= 0; index -= 1) {
      const course = teeTimes[index].course;
      const key = course.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(course);
      }
    }
    return result;
  }, [teeTimes]);

  const nameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let index = teeTimes.length - 1; index >= 0; index -= 1) {
      for (const claim of teeTimes[index].claims) {
        const key = claim.name.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(claim.name);
        }
      }
    }
    return result;
  }, [teeTimes]);

  // A regular tournament whose scoring window is open today — surfaced on the
  // Board so coordination stays connected to the competition.
  const liveStop = useMemo(() => {
    const today = todayISO();
    return (
      tournaments.find(
        (tournament) =>
          tournament.type === "regular" &&
          today >= tournament.windowStart &&
          today <= tournament.windowEnd
      ) ?? null
    );
  }, [tournaments]);

  const handleSheetSubmit = async (input: NewTeeTimeInput) => {
    if (!myName) setProfile({ name: input.host });
    if (editing) await update(editing.id, input);
    else await create(input);
  };

  const handlePollSubmit = async (input: NewPollInput) => {
    if (!myName) setProfile({ name: input.host });
    await createPoll(input);
  };

  const handleProfileSave = async (name: string, handicap: number | null) => {
    setProfile({ name, handicap });
    await upsertPlayer(name, { handicap, member: true });
  };

  const requireName = () => {
    if (myName) return true;
    toast.show("Add your name first");
    return false;
  };

  const closeSheet = () => {
    setOpenSheet(null);
    setEditing(null);
  };

  const renderTeeTime = (teeTime: TeeTime, readOnly: boolean) => (
    <TeeTimeCard
      key={teeTime.id}
      teeTime={teeTime}
      myName={myName}
      readOnly={readOnly}
      onClaim={() => requireName() && claim(teeTime.id, myName)}
      onDrop={(name) => drop(teeTime.id, name)}
      onMaybe={() => requireName() && markInterested(teeTime.id, myName)}
      onDropMaybe={(name) => dropInterest(teeTime.id, name)}
      onDelete={() => remove(teeTime.id)}
      onEdit={() => {
        setEditing(teeTime);
        setOpenSheet("teetime");
      }}
      onRecordScores={() => setScoringTeeTime(teeTime)}
      onPostComment={(body) => {
        if (!requireName()) return;
        return postComment(teeTime.id, myName, body);
      }}
      onDeleteComment={(commentId) => deleteComment(teeTime.id, commentId)}
      getHandicap={getHandicap}
      isMember={isMember}
    />
  );

  const meta = SECTION_META[section];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Toast message={toast.message} onDismiss={toast.dismiss} />
      <div className="mx-auto max-w-md px-4 pb-28">
        <Header
          title={meta.title}
          subtitle={meta.subtitle}
          myName={myName}
          myHandicap={profile.handicap}
          onOpenProfile={() => setProfileSheetOpen(true)}
        />

        {!myName && (
          <NamePromptInline
            onSubmit={handleProfileSave}
            nameSuggestions={nameSuggestions}
          />
        )}

        {section === "board" && (
          <main key="board" className="animate-fade-up">
            {liveStop && (
              <button
                type="button"
                onClick={() => setSection("season")}
                className="mb-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-fairway-900 to-fairway-800 px-4 py-3 text-left shadow-sm ring-1 ring-fairway-950/40 transition-opacity hover:opacity-95"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Trophy className="h-4 w-4 shrink-0 text-gold-300" />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-300">
                      Window open · {liveStop.name.split("—")[0].trim()}
                    </span>
                    <span className="block truncate text-sm font-semibold text-cream-50">
                      {liveStop.course} · through{" "}
                      {formatDateLabel(liveStop.windowEnd)}
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/60" />
              </button>
            )}

            <section className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpenSheet("teetime")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-fairway-800 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-fairway-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
              >
                <CalendarPlus className="h-4 w-4" />
                New tee time
              </button>
              <button
                type="button"
                onClick={() => setOpenSheet("poll")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-800 shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
              >
                <MessageCircleQuestion className="h-4 w-4 text-fairway-700" />
                Ask the group
              </button>
            </section>

            {polls.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
                  Open questions
                </h2>
                <div className="space-y-3">
                  {polls.map((poll) => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      myName={myName}
                      onToggle={(optionIndex) => {
                        if (requireName()) {
                          toggleResponse(poll.id, myName, optionIndex);
                        }
                      }}
                      onDelete={() => removePoll(poll.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-end justify-between px-1">
                <div>
                  <h2 className="text-base font-bold text-stone-950">
                    Upcoming tee times
                  </h2>
                  <p className="text-xs text-stone-500">
                    {upcoming.length} on the board
                  </p>
                </div>
              </div>
              {!loaded ? (
                <div className="space-y-3">
                  {[0, 1].map((index) => (
                    <div
                      key={index}
                      className="h-40 animate-pulse rounded-2xl bg-stone-100"
                    />
                  ))}
                </div>
              ) : upcoming.length === 0 ? (
                <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
                    <Flag className="h-6 w-6" />
                  </div>
                  <p className="font-semibold text-stone-800">
                    No tee times posted
                  </p>
                  <p className="mt-1 text-sm text-stone-500">
                    Post the next group above.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map((teeTime) => renderTeeTime(teeTime, false))}
                </div>
              )}
            </section>
          </main>
        )}

        {section === "season" && (
          <main key="season" className="animate-fade-up">
            <SeasonHome
              tournaments={tournaments}
              teeTimes={teeTimes}
              getHandicap={getHandicap}
              myName={myName}
            />
          </main>
        )}

        {section === "manage" && (
          <main key="manage" className="animate-fade-up space-y-3">
            <Roster
              players={players}
              teeTimes={teeTimes}
              onUpdate={async (name, patch) => {
                await upsertPlayer(name, patch);
                // Buy-ins auto-create/delete on the server when member flips;
                // refresh so the Pool card reflects it immediately.
                await refreshBuyins();
              }}
            />
            <Finances
              buyins={buyins}
              onToggle={(name, paid) => patchBuyin(name, { paid })}
            />

            {past.length > 0 && (
              <section className="pt-2">
                <button
                  type="button"
                  aria-expanded={pastOpen}
                  onClick={() => setPastOpen((value) => !value)}
                  className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-800 shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
                >
                  <span>Completed tee times ({past.length})</span>
                  <ChevronDown
                    className={`h-4 w-4 text-stone-500 transition-transform ${pastOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {pastOpen && (
                  <div className="mt-3 animate-fade-up space-y-3">
                    {past.map((teeTime) => renderTeeTime(teeTime, true))}
                  </div>
                )}
              </section>
            )}
          </main>
        )}
      </div>

      <BottomNav active={section} onChange={setSection} />

      <NewTeeTimeSheet
        open={openSheet === "teetime"}
        onClose={closeSheet}
        onSubmit={handleSheetSubmit}
        defaultHost={myName}
        courseSuggestions={courseSuggestions}
        nameSuggestions={nameSuggestions}
        editing={editing}
      />
      <NewPollSheet
        open={openSheet === "poll"}
        onClose={closeSheet}
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
      <ScoresSheet
        open={!!scoringTeeTime}
        onClose={() => setScoringTeeTime(null)}
        teeTime={scoringTeeTime}
        isLeagueRound={
          !!scoringTeeTime &&
          tournaments.some(
            (tournament) =>
              tournament.type !== "post" &&
              scoringTeeTime.date >= tournament.windowStart &&
              scoringTeeTime.date <= tournament.windowEnd
          )
        }
        isMember={isMember}
        onRecord={(name, gross, courseHcp, attestedBy) =>
          recordScore(scoringTeeTime!.id, name, gross, courseHcp, attestedBy)
        }
      />
    </div>
  );
}
