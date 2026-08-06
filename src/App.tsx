import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Flag,
  History,
  MessageCircleQuestion,
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

// Subtitles are sized to fit beside the profile chip at 390px — a header
// that ships with an ellipsis reads unfinished.
const SECTION_META: Record<AppSection, { title: string; subtitle: string }> = {
  board: { title: "DJDI Board", subtitle: "Tee sheet & polls" },
  season: { title: "Season", subtitle: "Race to the title" },
  manage: { title: "Manage", subtitle: "Roster & buy-ins" },
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
    if (editing) await update(editing.id, input);
    else await create(input);
    if (!myName) setProfile({ name: input.host });
  };

  const handlePollSubmit = async (input: NewPollInput) => {
    await createPoll(input);
    if (!myName) setProfile({ name: input.host });
  };

  // Persist locally only after the server accepts — a rejected save must not
  // switch the device to a name the roster doesn't have.
  const handleProfileSave = async (name: string, handicap: number | null) => {
    await upsertPlayer(name, { handicap, member: true });
    setProfile({ name, handicap });
  };

  const requireName = () => {
    if (myName) return true;
    // The name prompt lives at the top of the page — bring it into view
    // instead of leaving the user with a toast and no next step.
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.show("Add your name first");
    return false;
  };

  const closeSheet = () => {
    setOpenSheet(null);
    setEditing(null);
  };

  // League rounds (any date inside a non-post tournament window) need another
  // member's attestation — mirrors the server rule in recordScoreTx.
  const isLeagueDate = useCallback(
    (date: string) =>
      tournaments.some(
        (tournament) =>
          tournament.type !== "post" &&
          date >= tournament.windowStart &&
          date <= tournament.windowEnd
      ),
    [tournaments]
  );

  // Each section should open at its header, not wherever the previous
  // section happened to be scrolled.
  const changeSection = (next: AppSection) => {
    setSection(next);
    window.scrollTo({ top: 0 });
  };

  // Rounds from the last ten days that were played but never scored — the
  // nudge that keeps the season boards current. Solo league rounds are
  // excluded: with no possible attester their score can never be recorded,
  // so the nudge would be a permanent dead end.
  const needsScores = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 10);
    const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return past.filter(
      (teeTime) =>
        teeTime.claims.length > 0 &&
        teeTime.scores.length === 0 &&
        teeTime.date >= cutoffISO &&
        (!isLeagueDate(teeTime.date) || teeTime.claims.length >= 2)
    );
  }, [past, isLeagueDate]);

  const renderTeeTime = (teeTime: TeeTime, readOnly: boolean) => (
    <TeeTimeCard
      key={teeTime.id}
      teeTime={teeTime}
      myName={myName}
      readOnly={readOnly}
      onClaim={() =>
        requireName() ? claim(teeTime.id, myName) : Promise.resolve()
      }
      onDrop={(name) => drop(teeTime.id, name)}
      onMaybe={() =>
        requireName() ? markInterested(teeTime.id, myName) : Promise.resolve()
      }
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
                onClick={() => changeSection("season")}
                className="texture-pine mb-3 flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl px-4 py-3 text-left shadow-sm ring-1 ring-fairway-950/40 transition-opacity hover:opacity-95"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inset-0 rounded-full bg-gold-300 motion-safe:animate-ping-slow" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-gold-300" />
                  </span>
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

            {needsScores.length > 0 && (
              <button
                type="button"
                onClick={() => setScoringTeeTime(needsScores[0])}
                className="mb-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-gold-300 transition-colors hover:bg-gold-50"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ClipboardList className="h-4 w-4 shrink-0 text-gold-600" />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700">
                      {needsScores.length === 1
                        ? "1 round waiting on scores"
                        : `${needsScores.length} rounds waiting on scores`}
                    </span>
                    <span className="block truncate text-sm font-semibold text-stone-900">
                      {needsScores[0].course} ·{" "}
                      {formatDateLabel(needsScores[0].date)}
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
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
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-stone-800 shadow-sm ring-1 ring-stone-200 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
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
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
                  Upcoming tee times
                </h2>
                <p className="text-xs text-stone-500">
                  · {upcoming.length} on the board
                </p>
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
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-stone-200">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
                    <Flag className="h-6 w-6" />
                  </div>
                  <p className="font-semibold text-stone-800">
                    Nothing on the sheet
                  </p>
                  <p className="mt-1 text-sm text-stone-500">
                    Someone's gotta host — post the next group above.
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
                  className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-white px-4 text-sm font-bold text-stone-800 shadow-sm ring-1 ring-stone-200 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-600 focus-visible:ring-offset-2"
                >
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4 text-fairway-700" />
                    Completed tee times ({past.length})
                  </span>
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

      <BottomNav active={section} onChange={changeSection} />

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
        isLeagueRound={!!scoringTeeTime && isLeagueDate(scoringTeeTime.date)}
        isMember={isMember}
        onRecord={(name, gross, courseHcp, attestedBy) =>
          recordScore(scoringTeeTime!.id, name, gross, courseHcp, attestedBy)
        }
      />
    </div>
  );
}
