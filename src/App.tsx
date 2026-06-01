import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Plus,
  ChevronDown,
  Calendar,
  ClipboardList,
  Trophy,
  MessageCircleQuestion,
  Flag,
  Banknote,
  Users,
  ShieldCheck,
} from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { AdminConsole } from "./components/AdminConsole";
import { CommandCenter } from "./components/CommandCenter";
import { Header } from "./components/Header";
import { NamePromptInline } from "./components/NamePromptInline";
import { NewPollSheet } from "./components/NewPollSheet";
import { NewTeeTimeSheet } from "./components/NewTeeTimeSheet";
import { Operations } from "./components/Operations";
import { PollCard } from "./components/PollCard";
import { Finances } from "./components/Finances";
import { ProfileSheet } from "./components/ProfileSheet";
import { PublicRoster } from "./components/PublicRoster";
import { Roster } from "./components/Roster";
import { ScoresSheet } from "./components/ScoresSheet";
import { SeasonSchedule } from "./components/SeasonSchedule";
import { Standings } from "./components/Standings";
import { TeeTimeCard } from "./components/TeeTimeCard";
import { Toast } from "./components/Toast";
import { useBuyins } from "./hooks/useBuyins";
import { useMyProfile } from "./hooks/useMyProfile";
import { usePlayers } from "./hooks/usePlayers";
import { usePolls } from "./hooks/usePolls";
import { useTeeTimes } from "./hooks/useTeeTimes";
import { useToast } from "./hooks/useToast";
import { useTournaments } from "./hooks/useTournaments";
import { isPast } from "./lib/format";
import type {
  NewPollInput,
  NewTeeTimeInput,
  TeeTime,
} from "./lib/types";

// ============================================================
// APP
// ============================================================
type AccessState = "checking" | "gated" | "ok";
type CommissionerState = "checking" | "locked" | "ok";
type LaunchCheckState = {
  dockerBuildVerified: boolean;
  tailnetServeVerified: boolean;
  productionUrlRequired?: boolean;
  productionUrlVerified: boolean;
  mobileSafariVerified: boolean;
};
type LaunchCheckRecordState = {
  key: Exclude<keyof LaunchCheckState, "productionUrlRequired">;
  label: string;
  envVar: string;
  verified: boolean;
  source: "env" | "database" | "none";
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  updatedAt: string | null;
};

const defaultLaunchChecks: LaunchCheckState = {
  dockerBuildVerified: false,
  tailnetServeVerified: false,
  productionUrlRequired: false,
  productionUrlVerified: false,
  mobileSafariVerified: false,
};

export default function App() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [accessCodeRequired, setAccessCodeRequired] = useState(false);
  const [launchChecks, setLaunchChecks] =
    useState<LaunchCheckState>(defaultLaunchChecks);
  const [launchCheckEvidence, setLaunchCheckEvidence] = useState<
    LaunchCheckRecordState[]
  >([]);

  useEffect(() => {
    fetch("/api/access")
      .then((r) => r.json())
      .then(
        (d: {
          required: boolean;
          ok: boolean;
        }) => {
        setAccessCodeRequired(d.required);
        setAccess(d.required && !d.ok ? "gated" : "ok");
        }
      )
      .catch(() => setAccess("gated"));
  }, []);

  if (access === "checking") return null;
  if (access === "gated") {
    return <AccessGate onUnlock={() => setAccess("ok")} />;
  }
  return (
    <Board
      accessCodeRequired={accessCodeRequired}
      launchChecks={launchChecks}
      launchCheckEvidence={launchCheckEvidence}
      onLaunchChecksChange={(nextChecks, nextEvidence) => {
        setLaunchChecks(nextChecks);
        setLaunchCheckEvidence(nextEvidence);
      }}
    />
  );
}

type SheetKind = "teetime" | "poll" | null;
type ViewMode = "board" | "season" | "money" | "roster" | "ops" | "commissioner";
type TaskViewMode = "money" | "roster" | "ops";

function Board({
  accessCodeRequired,
  launchChecks,
  launchCheckEvidence,
  onLaunchChecksChange,
}: {
  accessCodeRequired: boolean;
  launchChecks: LaunchCheckState;
  launchCheckEvidence: LaunchCheckRecordState[];
  onLaunchChecksChange: (
    checks: LaunchCheckState,
    evidence: LaunchCheckRecordState[]
  ) => void;
}) {
  const [profile, setProfile] = useMyProfile();
  const myName = profile.name;
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [editing, setEditing] = useState<TeeTime | null>(null);
  const [scoringTeeTime, setScoringTeeTime] = useState<TeeTime | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  const [commissioner, setCommissioner] =
    useState<CommissionerState>("checking");
  const [commissionerCodeRequired, setCommissionerCodeRequired] =
    useState(false);
  const [panelOpenSignals, setPanelOpenSignals] = useState({
    money: 0,
    roster: 0,
  });
  const toast = useToast();

  const {
    teeTimes,
    loaded,
    refresh: refreshTeeTimes,
    create,
    update,
    claim,
    drop,
    markInterested,
    dropInterest,
    recordScore,
    attestScore,
    removeScore,
    postComment,
    editComment,
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
    refresh: refreshPlayers,
    upsert: upsertPlayer,
    getHandicap,
    getPlayer,
    isMember,
  } = usePlayers(toast.show);
  const {
    tournaments,
    refresh: refreshTournaments,
    closeout: closeTournament,
    reopen: reopenTournament,
    patchPayout,
    patchDetails: patchTournamentDetails,
  } = useTournaments(toast.show);
  const buyinsEnabled = commissioner === "ok";
  const { buyins, patch: patchBuyin, refresh: refreshBuyins } = useBuyins(
    toast.show,
    buyinsEnabled
  );

  const refreshLaunchChecks = async () => {
    const r = await fetch("/api/launch-checks");
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || "Couldn't load launch checks");
    }
    onLaunchChecksChange(data.launchChecks, data.records);
  };

  useEffect(() => {
    fetch("/api/commissioner")
      .then((r) => r.json())
      .then((d: { required: boolean; ok: boolean }) => {
        setCommissionerCodeRequired(d.required);
        setCommissioner(d.ok ? "ok" : "locked");
        if (d.ok) void refreshLaunchChecks().catch(() => {});
      })
      .catch(() => setCommissioner("locked"));
  }, []);

  useEffect(() => {
    if (commissioner !== "ok" || launchCheckEvidence.length > 0) return;
    void refreshLaunchChecks().catch(() => {});
  }, [commissioner, launchCheckEvidence.length]);

  const tournamentFor = useMemo(
    () => (teeTime: TeeTime) =>
      tournaments.find(
        (tournament) =>
          teeTime.date >= tournament.windowStart &&
          teeTime.date <= tournament.windowEnd
      ) ?? null,
    [tournaments]
  );

  const contextFor = (teeTime: TeeTime) => {
    const tournament = tournamentFor(teeTime);
    if (!tournament) return undefined;
    const missingScores = teeTime.claims.some(
      (claim) =>
        !teeTime.scores.some((score) =>
          score.name.trim().toLowerCase() === claim.name.trim().toLowerCase()
        )
    );
    const pastRound = isPast(teeTime);
    return {
      label: tournament.name,
      status: pastRound ? (missingScores ? "needsScores" : "scored") : "league",
    } satisfies {
      label: string;
      status: "league" | "needsScores" | "scored";
    };
  };
  const openTaskView = (nextView: TaskViewMode) => {
    if (commissioner !== "ok") {
      setView("commissioner");
      return;
    }
    setView(nextView);
    if (nextView === "money" || nextView === "roster") {
      setPanelOpenSignals((prev) => ({
        ...prev,
        [nextView]: prev[nextView] + 1,
      }));
    }
  };

  const syncProfileSession = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {});
  };

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
    if (!myName) {
      setProfile({ name: input.host });
      await syncProfileSession(input.host);
    }
    if (editing) {
      await update(editing.id, input);
    } else {
      await create(input);
    }
  };

  const handlePollSubmit = async (input: NewPollInput) => {
    if (!myName) {
      setProfile({ name: input.host });
      await syncProfileSession(input.host);
    }
    await createPoll(input);
  };

  const handleProfileSave = async (name: string, handicap: number | null) => {
    setProfile({ name, handicap });
    if (name.trim()) await syncProfileSession(name);
  };

  const handleCommissionerUnlock = async (code: string) => {
    const r = await fetch("/api/commissioner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || "Wrong commissioner code");
    }
    setCommissioner("ok");
    await Promise.all([refreshLaunchChecks(), refreshPlayers()]);
    setView("ops");
  };

  const commissionerUnlocked = commissioner === "ok";

  const handleRenamePlayer = async (from: string, to: string) => {
    const r = await fetch("/api/admin/rename-player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        actor: myName || "Commissioner",
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.show(data.error || "Couldn't rename player");
      throw new Error(data.error || "rename failed");
    }
    await Promise.all([
      refreshPlayers(),
      refreshBuyins(),
      refreshTeeTimes(),
      refreshTournaments(),
    ]);
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

  const handlePostComment = (id: string, body: string) => {
    if (!myName) {
      toast.show("Add your name first");
      return;
    }
    return postComment(id, myName, body);
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

        {view === "board" && !myName && (
          <NamePromptInline
            onSubmit={(n, h) => handleProfileSave(n, h)}
            nameSuggestions={nameSuggestions}
          />
        )}

        {view === "board" && (
          <>
            {commissionerUnlocked && (
              <CommandCenter
                teeTimes={teeTimes}
                tournaments={tournaments}
                players={players}
                loaded={loaded}
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
                  Tap <span className="font-medium">+</span> to post a tee time
                  or ask the group.
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
                    commissionerUnlocked={commissionerUnlocked}
                    leagueContext={contextFor(t)}
                    onClaim={() => handleClaim(t.id)}
                    onClaimName={(name) => claim(t.id, name)}
                    onDrop={(name) => drop(t.id, name)}
                    onMaybe={() => handleMaybe(t.id)}
                    onDropMaybe={(name) => dropInterest(t.id, name)}
                    onDelete={() => remove(t.id)}
                    onEdit={() => handleEdit(t)}
                    onRecordScores={() => setScoringTeeTime(t)}
                    onAttestScore={(name) => attestScore(t.id, name)}
                    onPostComment={(body) => handlePostComment(t.id, body)}
                    onEditComment={(cid, body) => editComment(t.id, cid, body)}
                    onDeleteComment={(cid) => deleteComment(t.id, cid)}
                    getHandicap={getHandicap}
                    isMember={isMember}
                    nameSuggestions={nameSuggestions}
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
                        commissionerUnlocked={commissionerUnlocked}
                        commentsReadOnly={false}
                        leagueContext={contextFor(t)}
                        onClaim={() => {}}
                        onClaimName={() => {}}
                        onDrop={() => {}}
                        onMaybe={() => {}}
                        onDropMaybe={() => {}}
                        onDelete={() => remove(t.id)}
                        onEdit={() => {}}
                        onRecordScores={() => setScoringTeeTime(t)}
                        onAttestScore={(name) => attestScore(t.id, name)}
                        onPostComment={(body) => handlePostComment(t.id, body)}
                        onEditComment={(cid, body) => editComment(t.id, cid, body)}
                        onDeleteComment={(cid) => deleteComment(t.id, cid)}
                        getHandicap={getHandicap}
                        isMember={isMember}
                        nameSuggestions={nameSuggestions}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {view === "season" && (
          <>
            <SeasonSchedule
              tournaments={tournaments}
              teeTimes={teeTimes}
              getHandicap={getHandicap}
            />
            <Standings
              teeTimes={teeTimes}
              tournaments={tournaments}
              getHandicap={getHandicap}
              myName={myName}
            />
          </>
        )}

        {view === "commissioner" && (
          <CommissionerUnlock
            state={commissioner}
            codeRequired={commissionerCodeRequired}
            onUnlock={handleCommissionerUnlock}
          />
        )}

        {view === "money" && commissionerUnlocked && (
          <Finances
            buyins={buyins}
            onPatch={(n, patch) => patchBuyin(n, patch)}
            openSignal={panelOpenSignals.money}
          />
        )}

        {view === "roster" && (
          commissionerUnlocked ? (
            <Roster
              players={players}
              teeTimes={teeTimes}
              openSignal={panelOpenSignals.roster}
              onUpdate={async (n, patch) => {
                await upsertPlayer(n, patch);
                // Buy-ins auto-create/delete on the server when member flips;
                // refresh so the Finances card reflects it immediately.
                await refreshBuyins();
              }}
            />
          ) : (
            <PublicRoster players={players} teeTimes={teeTimes} myName={myName} />
          )
        )}

        {view === "ops" && commissionerUnlocked && (
          <AdminConsole
            teeTimes={teeTimes}
            tournaments={tournaments}
            players={players}
            buyins={buyins}
            onOpenView={(target) => {
              if (target === "board" || target === "season") {
                setView(target);
                return;
              }
              openTaskView(target);
            }}
            onFixIssue={(issue) => {
              const teeTime = teeTimes.find((t) => t.id === issue.teeTimeId);
              if (teeTime) setScoringTeeTime(teeTime);
            }}
            onAttestScore={(teeTimeId, playerName) => attestScore(teeTimeId, playerName)}
            onApplyUnifiedIntake={async (text) => {
              const r = await fetch("/api/admin/blocker-intake", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  text,
                  actor: myName || "Commissioner",
                }),
              });
              const data = await r.json().catch(() => ({}));
              if (!r.ok) {
                toast.show(data.error || "Couldn't apply intake");
                throw new Error(data.error || "intake failed");
              }
              await Promise.all([
                refreshPlayers(),
                refreshBuyins(),
                refreshTournaments(),
              ]);
            }}
            advanced={
              <Operations
                teeTimes={teeTimes}
                tournaments={tournaments}
                players={players}
                buyins={buyins}
                accessCodeRequired={accessCodeRequired}
                launchChecks={launchChecks}
                getHandicap={getHandicap}
                onFixIssue={(issue) => {
                  const teeTime = teeTimes.find((t) => t.id === issue.teeTimeId);
                  if (teeTime) setScoringTeeTime(teeTime);
                }}
                onRenamePlayer={handleRenamePlayer}
                onCloseTournament={(id) =>
                  closeTournament(id, myName || "Commissioner")
                }
                onReopenTournament={reopenTournament}
                onPatchPayout={patchPayout}
                onPatchTournamentDetails={patchTournamentDetails}
                onPatchBuyin={(name, patch) => patchBuyin(name, patch)}
                onOpenView={openTaskView}
              />
            }
          />
        )}

        {(view === "money" || view === "ops") &&
          !commissionerUnlocked && (
            <CommissionerUnlock
              state={commissioner}
              codeRequired={commissionerCodeRequired}
              onUnlock={handleCommissionerUnlock}
            />
          )}
      </div>

      <BottomNav
        active={view}
        commissionerUnlocked={commissionerUnlocked}
        onChange={setView}
      />

      {view === "board" && openSheet === null && (
        <div
          className="fixed right-4 z-30"
          style={{
            bottom: "calc(5.75rem + env(safe-area-inset-bottom))",
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
        onOpenCommissioner={() => {
          setProfileSheetOpen(false);
          setView(commissionerUnlocked ? "ops" : "commissioner");
        }}
      />
      <ScoresSheet
        open={!!scoringTeeTime}
        onClose={() => setScoringTeeTime(null)}
        teeTime={scoringTeeTime}
        isLeagueRound={
          !!scoringTeeTime &&
          tournaments.some(
            (t) =>
              t.type !== "post" &&
              scoringTeeTime.date >= t.windowStart &&
              scoringTeeTime.date <= t.windowEnd
          )
        }
        isMember={isMember}
        getHandicap={getHandicap}
        getPlayer={getPlayer}
        onRecord={(name, gross, courseHcp, attestedBy, handicapEvidence) =>
          recordScore(
            scoringTeeTime!.id,
            name,
            gross,
            courseHcp,
            attestedBy,
            handicapEvidence
          )
        }
        onRemoveScore={async (name) => {
          if (!scoringTeeTime) return;
          await removeScore(scoringTeeTime.id, name);
        }}
        canDeleteScores={commissionerUnlocked}
      />
    </div>
  );
}

function CommissionerUnlock({
  state,
  codeRequired,
  onUnlock,
}: {
  state: CommissionerState;
  codeRequired: boolean;
  onUnlock: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      await onUnlock(code.trim());
    } catch (err: any) {
      setError(err?.message || "Couldn't unlock commissioner tools");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "checking") {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
        <p className="text-sm font-semibold text-stone-900">
          Checking commissioner access…
        </p>
      </section>
    );
  }

  if (!codeRequired) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-900">
              Commissioner tools
            </h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">
              This server has no commissioner code configured. Set
              COMMISSIONER_CODE before sharing the app with the league.
            </p>
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Admin remains locked until a commissioner code is configured.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-stone-900">
            Commissioner tools
          </h2>
          <p className="mt-1 text-sm leading-5 text-stone-600">
            Money, roster, launch checks, and backups are separate from normal
            tee-time coordination.
          </p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="Commissioner code"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-base focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
            />
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="w-full rounded-xl bg-fairway-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
            >
              {submitting ? "Checking…" : "Unlock commissioner tools"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function BottomNav({
  active,
  commissionerUnlocked,
  onChange,
}: {
  active: ViewMode;
  commissionerUnlocked: boolean;
  onChange: (view: ViewMode) => void;
}) {
  const cols = commissionerUnlocked ? "grid-cols-5" : "grid-cols-3";
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-8px_24px_rgba(28,25,23,0.08)] backdrop-blur">
      <div className={`mx-auto grid max-w-md ${cols} gap-1`}>
        <NavButton
          active={active === "board"}
          icon={ClipboardList}
          label="Board"
          onClick={() => onChange("board")}
        />
        <NavButton
          active={active === "season"}
          icon={Trophy}
          label="Season"
          onClick={() => onChange("season")}
        />
        {!commissionerUnlocked && (
          <NavButton
            active={active === "roster"}
            icon={Users}
            label="Roster"
            onClick={() => onChange("roster")}
          />
        )}
        {commissionerUnlocked ? (
          <>
            <NavButton
              active={active === "money"}
              icon={Banknote}
              label="Money"
              onClick={() => onChange("money")}
            />
            <NavButton
              active={active === "roster"}
              icon={Users}
              label="Roster"
              onClick={() => onChange("roster")}
            />
            <NavButton
              active={active === "ops"}
              icon={ShieldCheck}
              label="Admin"
              onClick={() => onChange("ops")}
            />
          </>
        ) : null}
      </div>
    </nav>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof ClipboardList;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 flex-col items-center justify-center rounded-xl text-xs font-semibold transition-colors ${
        active
          ? "bg-fairway-50 text-fairway-800"
          : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
      }`}
    >
      <Icon className="mb-0.5 h-4 w-4" />
      {label}
    </button>
  );
}
