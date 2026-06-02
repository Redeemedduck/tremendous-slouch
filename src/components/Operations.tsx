import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Download,
  Merge,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { auditLeagueRules, type RuleIssue } from "../lib/audit";
import { buildCloseoutReadiness } from "../lib/closeoutReadiness";
import {
  buildCommissionerRequestPacket,
  buildCommissionerTasks,
  type CommissionerTask,
} from "../lib/commissionerTasks";
import { apiPath } from "../lib/api";
import { missingSourceBackedHandicapPlayers } from "../lib/handicapEvidence";
import { parseScheduleIntake } from "../lib/bulkIntake";
import { formatDateLabel, formatTimeLabel, todayISO } from "../lib/format";
import { buildScheduleAsk } from "../lib/requestCopy";
import { computeTournamentLeaderboard } from "../lib/tournamentLeaderboard";
import type { Buyin, Player, TeeTime, Tournament } from "../lib/types";

export function Operations({
  teeTimes,
  tournaments,
  players,
  buyins,
  accessCodeRequired,
  launchChecks,
  getHandicap,
  onFixIssue,
  onRenamePlayer,
  onCloseTournament,
  onReopenTournament,
  onPatchPayout,
  onPatchTournamentDetails,
  onPatchBuyin,
  onOpenView,
}: {
  teeTimes: TeeTime[];
  tournaments: Tournament[];
  players: Player[];
  buyins: Buyin[];
  accessCodeRequired: boolean;
  launchChecks: {
    dockerBuildVerified: boolean;
    tailnetServeVerified: boolean;
    productionUrlRequired?: boolean;
    productionUrlVerified: boolean;
    mobileSafariVerified: boolean;
  };
  getHandicap: (name: string) => number | null;
  onFixIssue: (issue: RuleIssue) => void;
  onRenamePlayer: (from: string, to: string) => Promise<void>;
  onCloseTournament: (id: string) => Promise<void>;
  onReopenTournament: (id: string) => Promise<void>;
  onPatchPayout: (
    id: string,
    patch: { payoutConfirmed?: boolean; payoutPaid?: boolean; notes?: string | null }
  ) => Promise<void>;
  onPatchTournamentDetails: (
    id: string,
    patch: {
      course?: string;
      windowStart?: string;
      windowEnd?: string;
      pointsToFirst?: number | null;
      payoutFirst?: number | null;
      payoutSecond?: number | null;
      payoutThird?: number | null;
      notes?: string | null;
    }
  ) => Promise<void>;
  onPatchBuyin: (
    name: string,
    patch: {
      amount?: number;
      paid?: boolean;
      paymentStatus?: Buyin["paymentStatus"];
      paymentMethod?: string | null;
      paymentActor?: string | null;
      paidAt?: string | null;
      notes?: string | null;
    }
  ) => Promise<void>;
  onOpenView?: (view: "money" | "roster" | "ops") => void;
}) {
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<
    Record<
      string,
      { course: string; windowStart: string; windowEnd: string; notes: string }
    >
  >({});
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "blocked">(
    "idle"
  );
  const [scheduleCopyStatus, setScheduleCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buyinSettingDraft, setBuyinSettingDraft] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [payoutSettingDrafts, setPayoutSettingDrafts] = useState<
    Record<
      string,
      {
        pointsToFirst: string;
        payoutFirst: string;
        payoutSecond: string;
        payoutThird: string;
      }
    >
  >({});
  const [savingPayoutSettings, setSavingPayoutSettings] = useState<string | null>(
    null
  );
  const [scheduleFallbackText, setScheduleFallbackText] = useState("");
  const [scheduleBulkText, setScheduleBulkText] = useState("");
  const [scheduleBulkSaving, setScheduleBulkSaving] = useState(false);
  const [scheduleBulkStatus, setScheduleBulkStatus] = useState("");
  const [taskCopyStatus, setTaskCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [taskFallbackText, setTaskFallbackText] = useState("");
  const [taskActionCopyStatus, setTaskActionCopyStatus] = useState<
    Record<string, "idle" | "copied" | "blocked">
  >({});
  const [taskActionFallbackText, setTaskActionFallbackText] = useState<
    Record<string, string>
  >({});
  const [payoutNoteDrafts, setPayoutNoteDrafts] = useState<Record<string, string>>(
    {}
  );
  const [savingPayoutNote, setSavingPayoutNote] = useState<string | null>(null);
  const [confirmingCloseoutAction, setConfirmingCloseoutAction] = useState<
    string | null
  >(null);
  const today = useMemo(() => todayISO(), []);
  const issues = useMemo(
    () => auditLeagueRules(teeTimes, tournaments, players, today),
    [teeTimes, tournaments, players, today]
  );
  const closeoutRows = useMemo(
    () =>
      tournaments
        .filter((tournament) => tournament.type !== "post")
        .map((tournament) => ({
          tournament,
          readiness: buildCloseoutReadiness({
            tournament,
            tournaments,
            teeTimes,
            players,
            today,
            getHandicap,
          }),
        }))
        .filter(
          ({ tournament, readiness }) =>
            tournament.windowStart <= today || readiness.board.length > 0
        ),
    [tournaments, teeTimes, players, getHandicap, today]
  );
  const activeTournament = useMemo(
    () =>
      tournaments.find(
        (tournament) =>
          tournament.type !== "post" &&
          today >= tournament.windowStart &&
          today <= tournament.windowEnd
      ) ?? null,
    [tournaments, today]
  );
  const activeBoard = useMemo(
    () =>
      activeTournament
        ? computeTournamentLeaderboard(activeTournament, teeTimes, getHandicap)
        : [],
    [activeTournament, teeTimes, getHandicap]
  );
  const totals = useMemo(() => {
    const expected = buyins.reduce((sum, buyin) => sum + buyin.amount, 0);
    const settled = buyins.reduce(
      (sum, buyin) => sum + (buyin.paid ? buyin.amount : 0),
      0
    );
    return { expected, settled, outstanding: expected - settled };
  }, [buyins]);
  const unpaidBuyins = useMemo(
    () => buyins.filter((buyin) => !buyin.paid),
    [buyins]
  );
  const commonBuyinAmount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const buyin of buyins) {
      counts.set(buyin.amount, (counts.get(buyin.amount) ?? 0) + 1);
    }
    return (
      Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ??
      325
    );
  }, [buyins]);
  const settingBuyinValue = buyinSettingDraft || String(commonBuyinAmount);
  const settingBuyinAmount = Number(settingBuyinValue);
  const settingBuyinValid =
    Number.isInteger(settingBuyinAmount) &&
    settingBuyinAmount >= 0 &&
    settingBuyinAmount <= 100000;
  const unknownNames = useMemo(() => {
    const known = new Set(players.map((player) => player.name.toLowerCase()));
    const names = new Map<string, string>();
    for (const teeTime of teeTimes) {
      for (const claim of teeTime.claims) names.set(claim.name.toLowerCase(), claim.name);
      for (const score of teeTime.scores) {
        names.set(score.name.toLowerCase(), score.name);
        if (score.attestedBy) names.set(score.attestedBy.toLowerCase(), score.attestedBy);
      }
    }
    return Array.from(names.values())
      .filter((name) => !known.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [players, teeTimes]);
  const memberPlayers = useMemo(
    () =>
      players
        .filter((player) => player.member)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        ),
    [players]
  );
  const missingBuyins = useMemo(() => {
    const buyinKeys = new Set(
      buyins.map((buyin) => buyin.playerName.toLowerCase())
    );
    return memberPlayers
      .filter((player) => !buyinKeys.has(player.name.toLowerCase()))
      .map((player) => player.name);
  }, [memberPlayers, buyins]);
  const missingHandicaps = useMemo(
    () =>
      missingSourceBackedHandicapPlayers(memberPlayers).map((player) => player.name),
    [memberPlayers]
  );
  const unconfirmedEvents = useMemo(
    () =>
      tournaments
        .filter(
          (tournament) =>
            tournament.course.toLowerCase() === "tbd" ||
            tournament.notes?.toLowerCase().includes("tbd")
        )
        .map((tournament) => tournament.name),
    [tournaments]
  );
  const unconfirmedTournaments = useMemo(
    () =>
      tournaments.filter(
        (tournament) =>
          tournament.course.toLowerCase() === "tbd" ||
          tournament.notes?.toLowerCase().includes("tbd")
      ),
    [tournaments]
  );
  const scheduleAsk = useMemo(
    () => buildScheduleAsk(unconfirmedTournaments),
    [unconfirmedTournaments]
  );
  const scheduleBulkMatches = useMemo(
    () => parseScheduleIntake(scheduleBulkText, unconfirmedTournaments),
    [scheduleBulkText, unconfirmedTournaments]
  );
  const readinessItems = useMemo(
    () => [
      {
        label: "Roster",
        ok: memberPlayers.length === 12 && missingBuyins.length === 0,
        detail:
          memberPlayers.length === 12 && missingBuyins.length === 0
            ? "12 members and 12 buy-ins seeded"
            : `${memberPlayers.length}/12 members · ${
                missingBuyins.length
              } missing buy-in${missingBuyins.length === 1 ? "" : "s"}`,
      },
      {
        label: "Money",
        ok: totals.outstanding === 0,
        detail:
          totals.outstanding === 0
            ? "Pool fully recorded"
            : `$${totals.outstanding.toLocaleString()} still owed`,
      },
      {
        label: "Rules",
        ok: issues.length === 0,
        blocker: issues.length > 0,
        detail:
          issues.length === 0
            ? "Scores ready"
            : `${issues.length} score${issues.length === 1 ? "" : "s"} to review`,
      },
      {
        label: "Handicaps",
        ok: missingHandicaps.length === 0,
        detail:
          missingHandicaps.length === 0
            ? "All member indexes recorded with source evidence"
            : `${missingHandicaps.length} missing/unverified: ${missingHandicaps.join(", ")}`,
      },
      {
        label: "Closeout",
        ok: activeTournament ? !activeTournament.closedAt : true,
        detail: activeTournament
          ? activeTournament.closedAt
            ? `${activeTournament.name} is closed`
            : `${activeTournament.name} protected until ${formatDateLabel(
                activeTournament.windowEnd
              )}`
          : "No active tournament window",
      },
      {
        label: "Schedule",
        ok: unconfirmedEvents.length === 0,
        detail:
          unconfirmedEvents.length === 0
            ? "All event details confirmed"
            : `${unconfirmedEvents.length} TBD: ${unconfirmedEvents.join(", ")}`,
      },
      {
        label: "Exports",
        ok: true,
        detail:
          "JSON, summary, DB backup, backup verify, persistence verify, and prod smoke available",
      },
    ],
    [
      activeTournament,
      issues.length,
      memberPlayers.length,
      missingBuyins,
      missingHandicaps,
      totals.outstanding,
      unconfirmedEvents,
    ]
  );
  const readinessBlockers = readinessItems.filter((item) => item.blocker).length;
  const readinessWarnings = readinessItems.filter(
    (item) => !item.ok && !item.blocker
  ).length;
  const commissionerTasks = useMemo(
    () =>
      buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired,
        launchChecks,
      }),
    [players, buyins, tournaments, issues, accessCodeRequired, launchChecks]
  );
  const requestPacket = useMemo(
    () => buildCommissionerRequestPacket(commissionerTasks),
    [commissionerTasks]
  );
  const openOpsSection = (id: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const taskOpenAction = (task: CommissionerTask) => {
    if (task.area === "money") {
      return {
        label: "Open Money",
        onClick: () => onOpenView?.("money"),
      };
    }
    if (task.area === "roster") {
      return {
        label: "Open Roster",
        onClick: () => onOpenView?.("roster"),
      };
    }
    if (task.area === "rules") {
      return {
        label: "Open Score Review",
        onClick: () => openOpsSection("ops-rule-audit"),
      };
    }
    if (task.area === "schedule") {
      return {
        label: "Open Schedule",
        onClick: () => openOpsSection("ops-schedule-confirmation"),
      };
    }
    if (task.area === "closeout") {
      return {
        label: "Open Closeout",
        onClick: () => openOpsSection("ops-tournament-closeout"),
      };
    }
    if (task.area === "launch" || task.area === "access") {
      return {
        label: task.area === "access" ? "Open Exports" : "Open Launch Gates",
        onClick: () =>
          openOpsSection(
            task.area === "access" ? "admin-exports" : "admin-launch-access"
          ),
      };
    }
    return null;
  };
  const stillToScore = useMemo(() => {
    if (!activeTournament) return [];
    const scored = new Set(activeBoard.map((row) => row.name.toLowerCase()));
    const names = new Map<string, string>();
    for (const player of players) {
      if (player.member) names.set(player.name.toLowerCase(), player.name);
    }
    for (const buyin of buyins) {
      names.set(buyin.playerName.toLowerCase(), buyin.playerName);
    }
    return Array.from(names.values())
      .filter((name) => !scored.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [activeTournament, activeBoard, players, buyins]);
  const snapshotText = useMemo(() => {
    if (!activeTournament) return "";
    const leader = activeBoard[0];
    const lines = [
      `${activeTournament.name} update`,
      leader
        ? `Leader: ${leader.name} net ${leader.bestNet ?? "-"}`
        : "Leader: no scores posted",
      `Scores posted: ${activeBoard.length}`,
      stillToScore.length > 0
        ? `Still to score: ${stillToScore.join(", ")}`
        : "Still to score: none on roster",
    ];
    return lines.join("\n");
  }, [activeTournament, activeBoard, stillToScore]);
  const writeClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };
  const copySnapshot = async () => {
    if (!snapshotText) return;
    const copied = await writeClipboard(snapshotText);
    if (copied) {
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1600);
    } else {
      setCopyStatus("blocked");
    }
  };
  const draftFor = (tournament: Tournament) =>
    scheduleDrafts[tournament.id] ?? {
      course: tournament.course,
      windowStart: tournament.windowStart,
      windowEnd: tournament.windowEnd,
      notes: tournament.notes ?? "",
    };
  const updateScheduleDraft = (
    tournament: Tournament,
    patch: Partial<ReturnType<typeof draftFor>>
  ) => {
    setScheduleDrafts((prev) => ({
      ...prev,
      [tournament.id]: { ...draftFor(tournament), ...patch },
    }));
  };
  const saveScheduleDraft = async (tournament: Tournament) => {
    const draft = draftFor(tournament);
    await onPatchTournamentDetails(tournament.id, {
      course: draft.course,
      windowStart: draft.windowStart,
      windowEnd: draft.windowEnd,
      notes: draft.notes.trim() || null,
    });
    setScheduleDrafts((prev) => {
      const next = { ...prev };
      delete next[tournament.id];
      return next;
    });
  };
  const payoutSettingsDraftFor = (tournament: Tournament) =>
    payoutSettingDrafts[tournament.id] ?? {
      pointsToFirst:
        tournament.pointsToFirst == null ? "" : String(tournament.pointsToFirst),
      payoutFirst:
        tournament.payoutFirst == null ? "" : String(tournament.payoutFirst),
      payoutSecond:
        tournament.payoutSecond == null ? "" : String(tournament.payoutSecond),
      payoutThird:
        tournament.payoutThird == null ? "" : String(tournament.payoutThird),
    };
  const updatePayoutSettingsDraft = (
    tournament: Tournament,
    patch: Partial<ReturnType<typeof payoutSettingsDraftFor>>
  ) => {
    setPayoutSettingDrafts((prev) => ({
      ...prev,
      [tournament.id]: { ...payoutSettingsDraftFor(tournament), ...patch },
    }));
  };
  const optionalWholeDollar = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100000
      ? numeric
      : null;
  };
  const optionalWholePoints = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 1000
      ? numeric
      : null;
  };
  const payoutSettingsValid = (tournament: Tournament) => {
    const draft = payoutSettingsDraftFor(tournament);
    return (
      (draft.pointsToFirst.trim() === "" ||
        optionalWholePoints(draft.pointsToFirst) != null) &&
      (draft.payoutFirst.trim() === "" ||
        optionalWholeDollar(draft.payoutFirst) != null) &&
      (draft.payoutSecond.trim() === "" ||
        optionalWholeDollar(draft.payoutSecond) != null) &&
      (draft.payoutThird.trim() === "" ||
        optionalWholeDollar(draft.payoutThird) != null)
    );
  };
  const savePayoutSettings = async (tournament: Tournament) => {
    if (!payoutSettingsValid(tournament)) return;
    const draft = payoutSettingsDraftFor(tournament);
    setSavingPayoutSettings(tournament.id);
    setSettingsStatus("");
    try {
      await onPatchTournamentDetails(tournament.id, {
        pointsToFirst: optionalWholePoints(draft.pointsToFirst),
        payoutFirst: optionalWholeDollar(draft.payoutFirst),
        payoutSecond: optionalWholeDollar(draft.payoutSecond),
        payoutThird: optionalWholeDollar(draft.payoutThird),
      });
      setPayoutSettingDrafts((prev) => {
        const next = { ...prev };
        delete next[tournament.id];
        return next;
      });
      setSettingsStatus(`Saved ${tournament.name} scoring settings.`);
    } finally {
      setSavingPayoutSettings(null);
    }
  };
  const applyBuyinAmountToUnpaid = async () => {
    if (!settingBuyinValid || unpaidBuyins.length === 0) return;
    setSavingSettings(true);
    setSettingsStatus("");
    try {
      for (const buyin of unpaidBuyins) {
        await onPatchBuyin(buyin.playerName, { amount: settingBuyinAmount });
      }
      setBuyinSettingDraft("");
      setSettingsStatus(
        `Set ${unpaidBuyins.length} unpaid buy-in${
          unpaidBuyins.length === 1 ? "" : "s"
        } to $${settingBuyinAmount}.`
      );
    } finally {
      setSavingSettings(false);
    }
  };
  const payoutNoteFor = (tournament: Tournament) =>
    payoutNoteDrafts[tournament.id] ?? tournament.payoutEvidenceNote ?? "";
  const updatePayoutNote = (tournament: Tournament, notes: string) => {
    setPayoutNoteDrafts((prev) => ({
      ...prev,
      [tournament.id]: notes,
    }));
  };
  const savePayoutNote = async (tournament: Tournament) => {
    setSavingPayoutNote(tournament.id);
    try {
      await onPatchPayout(tournament.id, {
        notes: payoutNoteFor(tournament).trim() || null,
      });
      setPayoutNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[tournament.id];
        return next;
      });
    } finally {
      setSavingPayoutNote(null);
    }
  };
  const confirmCloseoutAction = async (key: string, action: () => Promise<void>) => {
    if (confirmingCloseoutAction !== key) {
      setConfirmingCloseoutAction(key);
      return;
    }
    setConfirmingCloseoutAction(null);
    await action();
  };
  const applyScheduleBulk = async () => {
    if (scheduleBulkMatches.length === 0) return;
    setScheduleBulkSaving(true);
    setScheduleBulkStatus("");
    try {
      for (const match of scheduleBulkMatches) {
        await onPatchTournamentDetails(match.id, {
          course: match.course,
          windowStart: match.windowStart,
          windowEnd: match.windowEnd,
          notes: match.notes,
        });
      }
      setScheduleBulkStatus(
        `Applied ${scheduleBulkMatches.length} schedule update${
          scheduleBulkMatches.length === 1 ? "" : "s"
        }.`
      );
      setScheduleBulkText("");
    } finally {
      setScheduleBulkSaving(false);
    }
  };
  const copyScheduleAsk = async () => {
    setScheduleFallbackText("");
    if (await writeClipboard(scheduleAsk)) {
      setScheduleCopyStatus("copied");
      window.setTimeout(() => setScheduleCopyStatus("idle"), 1600);
    } else {
      setScheduleFallbackText(scheduleAsk);
      setScheduleCopyStatus("blocked");
    }
  };
  const copyTaskPacket = async () => {
    setTaskFallbackText("");
    if (await writeClipboard(requestPacket)) {
      setTaskCopyStatus("copied");
      window.setTimeout(() => setTaskCopyStatus("idle"), 1600);
    } else {
      setTaskFallbackText(requestPacket);
      setTaskCopyStatus("blocked");
    }
  };
  const copyTaskAction = async (task: CommissionerTask) => {
    if (!task.copyText) return;
    setTaskActionFallbackText((prev) => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
    if (await writeClipboard(task.copyText)) {
      setTaskActionCopyStatus((prev) => ({ ...prev, [task.id]: "copied" }));
      window.setTimeout(
        () =>
          setTaskActionCopyStatus((prev) => ({
            ...prev,
            [task.id]: "idle",
          })),
        1600
      );
    } else {
      setTaskActionFallbackText((prev) => ({
        ...prev,
        [task.id]: task.copyText ?? "",
      }));
      setTaskActionCopyStatus((prev) => ({ ...prev, [task.id]: "blocked" }));
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Commissioner Readiness
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {readinessBlockers > 0
                ? `${readinessBlockers} item${
                    readinessBlockers === 1 ? "" : "s"
                  } need review`
                : readinessWarnings > 0
                  ? `${readinessWarnings} item${
                      readinessWarnings === 1 ? "" : "s"
                    } to finish`
                  : "Ready for live league operations"}
            </p>
          </div>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              readinessBlockers > 0 || readinessWarnings > 0
                ? "bg-amber-50 text-amber-700"
                : "bg-fairway-50 text-fairway-700"
            }`}
          >
            {readinessBlockers > 0 || readinessWarnings > 0 ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {readinessItems.map((item) => (
            <li
              key={item.label}
              className="flex items-start gap-2 rounded-xl bg-stone-50 p-3"
            >
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-fairway-700" />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    item.blocker ? "text-red-700" : "text-amber-700"
                  }`}
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900">
                  {item.label}
                </p>
                <p className="mt-0.5 text-xs text-stone-500">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-stone-50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-fairway-700" />
            <span className="min-w-0">
              <span className="block text-base font-semibold text-stone-900">
                Settings
              </span>
              <span className="block text-sm text-stone-500">
                League values and admin shortcuts.
              </span>
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400">
            {settingsOpen ? "Close" : "Open"}
          </span>
        </button>
        {settingsOpen && (
          <div className="space-y-3 border-t border-stone-100 p-4">
            {settingsStatus && (
              <p className="rounded-lg bg-fairway-50 px-3 py-2 text-xs font-semibold text-fairway-800">
                {settingsStatus}
              </p>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Shortcuts
              </p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                <SettingShortcutButton label="Money" onClick={() => onOpenView?.("money")} />
                <SettingShortcutButton label="Roster" onClick={() => onOpenView?.("roster")} />
                <SettingShortcutButton
                  label="Schedule"
                  onClick={() => openOpsSection("ops-schedule-confirmation")}
                />
                <SettingShortcutButton
                  label="Launch"
                  onClick={() => openOpsSection("admin-launch-access")}
                />
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900">
                    Season buy-in
                  </p>
                  <p className="text-xs text-stone-500">
                    {unpaidBuyins.length} unpaid row
                    {unpaidBuyins.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="sr-only" htmlFor="settings-buyin-amount">
                    Season buy-in
                  </label>
                  <input
                    id="settings-buyin-amount"
                    type="number"
                    min={0}
                    step={1}
                    value={settingBuyinValue}
                    onChange={(event) => {
                      setBuyinSettingDraft(event.target.value);
                      setSettingsStatus("");
                    }}
                    className="h-10 w-24 rounded-lg border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                  />
                  <button
                    type="button"
                    disabled={
                      !settingBuyinValid ||
                      unpaidBuyins.length === 0 ||
                      savingSettings
                    }
                    onClick={applyBuyinAmountToUnpaid}
                    className="h-10 rounded-lg bg-fairway-700 px-3 text-sm font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    {savingSettings ? "Saving" : "Apply"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Tournament values
                </p>
                <span className="text-xs text-stone-400">Pts · 1st · 2nd · 3rd</span>
              </div>
              <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                {tournaments.map((tournament) => {
                  const draft = payoutSettingsDraftFor(tournament);
                  const valid = payoutSettingsValid(tournament);
                  const saving = savingPayoutSettings === tournament.id;
                  return (
                    <TournamentSettingsRow
                      key={tournament.id}
                      tournament={tournament}
                      draft={draft}
                      valid={valid}
                      saving={saving}
                      onChange={(patch) =>
                        updatePayoutSettingsDraft(tournament, patch)
                      }
                      onSave={() => savePayoutSettings(tournament)}
                    />
                  );
                })}
              </ul>
            </div>

          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Open Admin Work
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {commissionerTasks.length === 0
                ? "No open tasks."
                : `${commissionerTasks.length} open task${
                    commissionerTasks.length === 1 ? "" : "s"
                  } from current league state.`}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <button
              type="button"
              onClick={copyTaskPacket}
              className="inline-flex items-center justify-center gap-1 rounded-full bg-fairway-50 px-3 py-1.5 text-xs font-semibold text-fairway-800 hover:bg-fairway-100"
            >
              {taskCopyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              {taskCopyStatus === "copied"
                ? "Copied"
                : taskCopyStatus === "blocked"
                  ? "Select text"
                  : "Copy tasks"}
            </button>
          </div>
        </div>

        {taskCopyStatus === "blocked" && (
          <label className="mt-3 block text-xs font-medium text-stone-600">
            Copy unavailable. Select tasks below.
            <textarea
              readOnly
              value={taskFallbackText}
              onFocus={(event) => event.target.select()}
              rows={5}
              className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
          </label>
        )}

        {commissionerTasks.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {commissionerTasks.map((task) => {
              const openAction = taskOpenAction(task);
              return (
                <li key={task.id} className="rounded-xl bg-stone-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900">
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {task.detail}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      task.severity === "blocker"
                        ? "bg-red-50 text-red-700"
                        : task.severity === "external"
                          ? "bg-stone-100 text-stone-600"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {task.area}
                  </span>
                  </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-xs font-medium text-stone-700">
                    Next: {task.nextAction}
                  </p>
                  {task.copyText && (
                    <button
                      type="button"
                      onClick={() => void copyTaskAction(task)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-fairway-800 ring-1 ring-fairway-100 hover:bg-fairway-50"
                    >
                      {taskActionCopyStatus[task.id] === "copied" ? (
                        <ClipboardCheck className="h-3.5 w-3.5" />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" />
                      )}
                      {taskActionCopyStatus[task.id] === "copied"
                        ? "Copied"
                        : taskActionCopyStatus[task.id] === "blocked"
                          ? "Select text"
                          : `Copy ${task.title}`}
                    </button>
                  )}
                  {openAction && (
                    <button
                      type="button"
                      onClick={openAction.onClick}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-stone-800"
                    >
                      {openAction.label}
                    </button>
                  )}
                </div>
                {task.items.length > 0 && (
                  <p className="mt-1 truncate text-xs text-stone-500">
                    {task.items.join(" · ")}
                  </p>
                )}
                {taskActionCopyStatus[task.id] === "blocked" && (
                  <label className="mt-2 block text-xs font-medium text-stone-600">
                    Copy unavailable. Select this ask.
                    <textarea
                      readOnly
                      value={taskActionFallbackText[task.id] ?? task.copyText ?? ""}
                      onFocus={(event) => event.target.select()}
                      rows={4}
                      className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-3 rounded-xl bg-fairway-50 p-3 text-sm text-fairway-800">
            Current data, launch gates, and closeout checks have no open tasks.
          </p>
        )}
      </section>

      {unconfirmedTournaments.length > 0 && (
        <section
          id="ops-schedule-confirmation"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                Schedule Confirmation
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {unconfirmedTournaments.length} seeded event
                {unconfirmedTournaments.length === 1 ? "" : "s"} still need
                confirmed details.
              </p>
            </div>
            <button
              type="button"
              onClick={copyScheduleAsk}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              {scheduleCopyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              {scheduleCopyStatus === "copied"
                ? "Copied"
                : scheduleCopyStatus === "blocked"
                  ? "Select text"
                  : "Copy TBDs"}
            </button>
          </div>
          {scheduleCopyStatus === "blocked" && (
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Copy unavailable. Select message below.
              <textarea
                readOnly
                value={scheduleFallbackText}
                onFocus={(event) => event.target.select()}
                rows={4}
                className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </label>
          )}
          <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-100">
            <label className="block text-xs font-semibold uppercase tracking-wide text-amber-900">
              Paste schedule replies
              <textarea
                value={scheduleBulkText}
                onChange={(event) => {
                  setScheduleBulkText(event.target.value);
                  setScheduleBulkStatus("");
                }}
                placeholder="Mid-season major: CommonGround Golf Course, 2026-07-18, shotgun&#10;Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals"
                rows={4}
                className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs normal-case tracking-normal text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs text-amber-800">
                {scheduleBulkMatches.length > 0
                  ? `${scheduleBulkMatches.length} matched: ${scheduleBulkMatches
                      .map((match) => match.name)
                      .join(", ")}`
                  : scheduleBulkText.trim()
                    ? "No known TBD event details found yet."
                    : "Matches seeded TBD event names only."}
              </span>
              <button
                type="button"
                disabled={scheduleBulkMatches.length === 0 || scheduleBulkSaving}
                onClick={applyScheduleBulk}
                className="shrink-0 rounded-full bg-fairway-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
              >
                {scheduleBulkSaving
                  ? "Applying"
                  : `Apply ${scheduleBulkMatches.length || ""}`.trim()}
              </button>
            </div>
            {scheduleBulkStatus && (
              <p className="mt-1 text-xs font-medium text-fairway-800">
                {scheduleBulkStatus}
              </p>
            )}
          </div>
          <ul className="mt-3 space-y-3">
            {unconfirmedTournaments.map((tournament) => {
              const draft = draftFor(tournament);
              return (
                <li
                  key={tournament.id}
                  className="rounded-xl bg-stone-50 p-3"
                >
                  <p className="text-sm font-semibold text-stone-900">
                    {tournament.name}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <label className="text-xs font-medium text-stone-600">
                      Course
                      <input
                        value={draft.course}
                        onChange={(event) =>
                          updateScheduleDraft(tournament, {
                            course: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-medium text-stone-600">
                        Start
                        <input
                          type="date"
                          value={draft.windowStart}
                          onChange={(event) =>
                            updateScheduleDraft(tournament, {
                              windowStart: event.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                        />
                      </label>
                      <label className="text-xs font-medium text-stone-600">
                        End
                        <input
                          type="date"
                          value={draft.windowEnd}
                          onChange={(event) =>
                            updateScheduleDraft(tournament, {
                              windowEnd: event.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                        />
                      </label>
                    </div>
                    <label className="text-xs font-medium text-stone-600">
                      Notes
                      <textarea
                        value={draft.notes}
                        onChange={(event) =>
                          updateScheduleDraft(tournament, {
                            notes: event.target.value,
                          })
                        }
                        rows={2}
                        className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => saveScheduleDraft(tournament)}
                      className="rounded-xl bg-fairway-700 px-3 py-2 text-sm font-semibold text-white hover:bg-fairway-800"
                    >
                      Save details
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeTournament && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-stone-900">
                Live Stop Snapshot
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {activeTournament.name} · through{" "}
                {formatDateLabel(activeTournament.windowEnd)}
              </p>
            </div>
            <button
              type="button"
              onClick={copySnapshot}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fairway-50 px-3 py-1.5 text-xs font-semibold text-fairway-800 hover:bg-fairway-100"
            >
              {copyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              {copyStatus === "copied"
                ? "Copied"
                : copyStatus === "blocked"
                  ? "Select text"
                  : "Copy"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <SnapshotStat
              label="Leader"
              value={activeBoard[0]?.name ?? "-"}
              detail={
                activeBoard[0]?.bestNet != null
                  ? `net ${activeBoard[0].bestNet}`
                  : "no scores"
              }
            />
            <SnapshotStat
              label="Posted"
              value={String(activeBoard.length)}
              detail="scores"
            />
            <SnapshotStat
              label="Open"
              value={String(stillToScore.length)}
              detail="roster"
            />
          </div>

          {activeBoard.length > 0 && (
            <ol className="mt-3 divide-y divide-stone-100">
              {activeBoard.map((row) => (
                <li
                  key={row.name}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium text-stone-900">
                    {row.position}. {row.name}
                  </span>
                  <span className="shrink-0 text-stone-500">
                    {row.bestGross} gross · {row.bestNet ?? "-"} net
                  </span>
                </li>
              ))}
            </ol>
          )}

          {stillToScore.length > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              Still to score: {stillToScore.join(", ")}
            </p>
          )}

          {copyStatus === "blocked" && (
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Copy unavailable. Select message below.
              <textarea
                readOnly
                value={snapshotText}
                onFocus={(event) => event.target.select()}
                rows={4}
                className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </label>
          )}
        </section>
      )}

      <section
        id="ops-rule-audit"
        className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Score Rule Audit
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {issues.length === 0
                ? "No pending score review."
                : `${issues.length} score${issues.length === 1 ? " needs" : "s need"} review.`}
            </p>
          </div>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              issues.length === 0
                ? "bg-fairway-50 text-fairway-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {issues.length === 0 ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </span>
        </div>

        {issues.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100">
            {issues.map((issue) => (
              <li key={issue.id} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900">
                      {issue.player}: {issue.message}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {issue.tournamentName} · {formatDateLabel(issue.date)}{" "}
                      {formatTimeLabel(issue.time)} · {issue.course}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onFixIssue(issue)}
                    className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-100"
                  >
                    Fix
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unknownNames.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Merge className="h-4 w-4 text-fairway-700" />
            Name Cleanup
          </h2>
          <ul className="mt-3 space-y-2">
            {unknownNames.map((name) => (
              <li key={name} className="rounded-xl bg-stone-50 p-3">
                <div className="mb-2 text-sm font-medium text-stone-900">
                  {name}
                </div>
                <div className="flex gap-2">
                  <select
                    value={mergeTargets[name] ?? ""}
                    onChange={(event) =>
                      setMergeTargets((prev) => ({
                        ...prev,
                        [name]: event.target.value,
                      }))
                    }
                    className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    aria-label={`Merge ${name} into`}
                  >
                    <option value="">Merge into...</option>
                    {players.map((player) => (
                      <option key={player.name} value={player.name}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!mergeTargets[name]}
                    onClick={() => onRenamePlayer(name, mergeTargets[name])}
                    className="rounded-xl bg-fairway-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-200 disabled:text-stone-500"
                  >
                    Merge
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closeoutRows.length > 0 && (
        <section
          id="ops-tournament-closeout"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Trophy className="h-4 w-4 text-fairway-700" />
            Tournament Closeout
          </h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {closeoutRows.map(({ tournament, readiness }) => {
              const board = readiness.board;
              const winner = board[0] ?? null;
              const canClose = readiness.status === "ready";
              const payoutLocked = !tournament.closedAt;
              const paidLocked = payoutLocked || !tournament.payoutConfirmed;
              const payoutEvidenceMissing = readiness.payoutEvidence.missing;
              const payoutNote = payoutNoteFor(tournament);
              const closeActionKey = `${tournament.id}:${
                tournament.closedAt ? "reopen" : "close"
              }`;
              const confirmActionKey = `${tournament.id}:${
                tournament.payoutConfirmed ? "unconfirm-payout" : "confirm-payout"
              }`;
              const paidActionKey = `${tournament.id}:${
                tournament.payoutPaidAt ? "mark-unpaid" : "mark-paid"
              }`;
              const paidNeedsNote =
                !tournament.payoutPaidAt && payoutNote.trim().length === 0;
              const paidActionLocked = paidLocked || paidNeedsNote;
              return (
                <li key={tournament.id} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-900">
                        {tournament.name}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {winner
                          ? `${winner.name} leads at net ${winner.bestNet ?? "-"}`
                          : "No scored rounds yet"}
                        {" · "}
                        {readiness.detail}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {tournament.payoutFirst != null && winner && (
                        <span className="rounded-full bg-fairway-50 px-2 py-0.5 text-xs font-semibold text-fairway-800">
                          ${tournament.payoutFirst}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() =>
                        confirmCloseoutAction(closeActionKey, () =>
                          tournament.closedAt
                            ? onReopenTournament(tournament.id)
                            : onCloseTournament(tournament.id)
                        )
                      }
                      disabled={!tournament.closedAt && !canClose}
                      className="rounded-xl bg-stone-900 px-2 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:bg-stone-100 disabled:text-stone-500"
                    >
                      {confirmingCloseoutAction === closeActionKey
                        ? tournament.closedAt
                          ? "Confirm reopen"
                          : "Confirm close"
                        : readiness.buttonLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmCloseoutAction(confirmActionKey, () =>
                          onPatchPayout(tournament.id, {
                            payoutConfirmed: !tournament.payoutConfirmed,
                          })
                        )
                      }
                      disabled={payoutLocked}
                      className={`rounded-xl px-2 py-2 text-xs font-semibold ${
                        payoutLocked
                          ? "bg-stone-100 text-stone-400"
                          : tournament.payoutConfirmed
                          ? "bg-fairway-50 text-fairway-800"
                          : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {confirmingCloseoutAction === confirmActionKey
                        ? tournament.payoutConfirmed
                          ? "Confirm unconfirm"
                          : "Confirm payout"
                        : tournament.payoutConfirmed
                          ? "Confirmed"
                          : payoutLocked
                            ? "Close first"
                            : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmCloseoutAction(paidActionKey, () =>
                          onPatchPayout(tournament.id, {
                            payoutPaid: !tournament.payoutPaidAt,
                            notes: payoutNote.trim() || null,
                          })
                        )
                      }
                      disabled={paidActionLocked}
                      className={`rounded-xl px-2 py-2 text-xs font-semibold ${
                        paidActionLocked
                          ? "bg-stone-100 text-stone-400"
                          : tournament.payoutPaidAt
                          ? "bg-fairway-50 text-fairway-800"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {confirmingCloseoutAction === paidActionKey
                        ? tournament.payoutPaidAt
                          ? "Confirm unpaid"
                          : "Confirm paid"
                        : tournament.payoutPaidAt
                          ? "Paid"
                          : paidLocked
                            ? "Confirm first"
                            : paidNeedsNote
                              ? "Add note first"
                              : "Mark paid"}
                    </button>
                  </div>
                  {confirmingCloseoutAction &&
                    confirmingCloseoutAction.startsWith(`${tournament.id}:`) && (
                      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
                        Review {tournament.name}, winner{" "}
                        {winner?.name ?? "not set"}, and payout $
                        {tournament.payoutFirst ?? 0}. Tap the highlighted action
                        again to commit.
                      </p>
                    )}
                  {payoutEvidenceMissing && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Payout evidence note missing
                    </p>
                  )}
                  {tournament.closedAt && (
                    <div className="mt-2 grid gap-2">
                      <textarea
                        value={payoutNote}
                        onChange={(event) =>
                          updatePayoutNote(tournament, event.target.value)
                        }
                        rows={2}
                        placeholder="Settlement note, receipt source, or payout exception"
                        className="min-h-16 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none focus:border-fairway-600"
                      />
                      <button
                        type="button"
                        onClick={() => savePayoutNote(tournament)}
                        disabled={
                          savingPayoutNote === tournament.id ||
                          payoutNote.trim() ===
                            (tournament.payoutEvidenceNote ?? "").trim()
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-200 disabled:text-stone-400"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {savingPayoutNote === tournament.id
                          ? "Saving..."
                          : "Save payout note"}
                      </button>
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <a
                      href={apiPath(
                        `/api/export/closeout/${encodeURIComponent(
                          tournament.id
                        )}.txt`
                      )}
                      download
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-fairway-50 px-3 py-2 text-xs font-semibold text-fairway-800 ring-1 ring-fairway-100 hover:bg-fairway-100"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Closeout packet
                    </a>
                    <a
                      href={apiPath(
                        `/api/export/closeout/${encodeURIComponent(
                          tournament.id
                        )}.json`
                      )}
                      download
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-200"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Closeout ledger
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SettingShortcutButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-10 rounded-lg bg-stone-50 px-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100"
    >
      {label}
    </button>
  );
}

function TournamentSettingsRow({
  tournament,
  draft,
  valid,
  saving,
  onChange,
  onSave,
}: {
  tournament: Tournament;
  draft: {
    pointsToFirst: string;
    payoutFirst: string;
    payoutSecond: string;
    payoutThird: string;
  };
  valid: boolean;
  saving: boolean;
  onChange: (
    patch: Partial<{
      pointsToFirst: string;
      payoutFirst: string;
      payoutSecond: string;
      payoutThird: string;
    }>
  ) => void;
  onSave: () => void;
}) {
  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {tournament.name}
          </p>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-stone-400">
            {tournament.type}
          </p>
        </div>
        <button
          type="button"
          disabled={!valid || saving}
          onClick={onSave}
          className="h-8 shrink-0 rounded-lg bg-fairway-700 px-3 text-xs font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <SettingNumberInput
          label="Pts"
          value={draft.pointsToFirst}
          onChange={(value) => onChange({ pointsToFirst: value })}
        />
        <SettingNumberInput
          label="1st"
          value={draft.payoutFirst}
          onChange={(value) => onChange({ payoutFirst: value })}
        />
        <SettingNumberInput
          label="2nd"
          value={draft.payoutSecond}
          onChange={(value) => onChange({ payoutSecond: value })}
        />
        <SettingNumberInput
          label="3rd"
          value={draft.payoutThird}
          onChange={(value) => onChange({ payoutThird: value })}
        />
      </div>
      {!valid && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          Use whole numbers only.
        </p>
      )}
    </li>
  );
}

function SettingNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
      {label}
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-sm font-semibold normal-case tracking-normal text-stone-900 focus:border-fairway-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-fairway-100"
      />
    </label>
  );
}

function SnapshotStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-stone-50 p-3">
      <div className="truncate text-sm font-semibold text-stone-900">
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-stone-500">{detail}</div>
    </div>
  );
}
