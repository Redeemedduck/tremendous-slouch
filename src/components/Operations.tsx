import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Database,
  Download,
  Merge,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { auditLeagueRules, type RuleIssue } from "../lib/audit";
import {
  buildBlockerHandoff,
  buildBlockerHandoffText,
} from "../lib/blockerHandoff";
import { buildCloseoutReadiness } from "../lib/closeoutReadiness";
import {
  buildCommissionerRequestPacket,
  buildCommissionerTasks,
  type CommissionerTask,
} from "../lib/commissionerTasks";
import { apiPath } from "../lib/api";
import { missingSourceBackedHandicapPlayers } from "../lib/handicapEvidence";
import {
  buildEvidenceGapPacket,
  buildEvidenceGapPacketText,
} from "../lib/evidenceGapPacket";
import {
  parseScheduleIntake,
  parseUnifiedBlockerIntake,
} from "../lib/bulkIntake";
import { formatDateLabel, formatTimeLabel, todayISO } from "../lib/format";
import {
  buildLaunchGateChecklist,
  buildLaunchGateChecklistText,
} from "../lib/launchGateChecklist";
import { buildLaunchRisks } from "../lib/launchRisks";
import { buildScheduleAsk } from "../lib/requestCopy";
import { SOURCE_SEARCH_LEDGER } from "../lib/sourceSearchLedger";
import { computeTournamentLeaderboard } from "../lib/tournamentLeaderboard";
import type { Buyin, Player, TeeTime, Tournament } from "../lib/types";

type CompletionAuditExport = {
  ready: boolean;
  appReady: boolean;
  statusCounts: {
    passed: number;
    open: number;
    blocked: number;
  };
  appStatusCounts: {
    passed: number;
    open: number;
    blocked: number;
  };
  leagueDataOpen: number;
  externalVerificationOpen: number;
  items: Array<{
    id: string;
    area: string;
    requirement: string;
    status: "passed" | "open" | "blocked";
    readinessScope: "app" | "league_data" | "external_verification";
    evidence: string[];
    artifactUrls: string[];
    nextAction: string | null;
  }>;
};

const auditScopeLabel = (
  scope: "app" | "league_data" | "external_verification"
) => {
  if (scope === "league_data") return "league data";
  if (scope === "external_verification") return "device check";
  return "app";
};

export function Operations({
  teeTimes,
  tournaments,
  players,
  buyins,
  accessCodeRequired,
  launchChecks,
  launchCheckEvidence,
  getHandicap,
  onFixIssue,
  onRenamePlayer,
  onCloseTournament,
  onReopenTournament,
  onPatchPayout,
  onPatchTournamentDetails,
  onPatchBuyin,
  onApplyUnifiedIntake,
  onPatchLaunchCheck,
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
  launchCheckEvidence: Array<{
    key:
      | "dockerBuildVerified"
      | "tailnetServeVerified"
      | "productionUrlVerified"
      | "mobileSafariVerified";
    label: string;
    envVar: string;
    verified: boolean;
    source: "env" | "database" | "none";
    verifiedAt: string | null;
    verifiedBy: string | null;
    note: string | null;
    updatedAt: string | null;
  }>;
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
  onApplyUnifiedIntake: (text: string) => Promise<void>;
  onPatchLaunchCheck: (
    key:
      | "dockerBuildVerified"
      | "tailnetServeVerified"
      | "productionUrlVerified"
      | "mobileSafariVerified",
    verified: boolean,
    note?: string | null
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
  const [unifiedIntakeText, setUnifiedIntakeText] = useState("");
  const [unifiedIntakeSaving, setUnifiedIntakeSaving] = useState(false);
  const [unifiedIntakeStatus, setUnifiedIntakeStatus] = useState("");
  const [unifiedIntakeConfirmed, setUnifiedIntakeConfirmed] = useState(false);
  const [taskCopyStatus, setTaskCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [taskFallbackText, setTaskFallbackText] = useState("");
  const [handoffCopyStatus, setHandoffCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [handoffFallbackText, setHandoffFallbackText] = useState("");
  const [evidenceGapCopyStatus, setEvidenceGapCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [evidenceGapFallbackText, setEvidenceGapFallbackText] = useState("");
  const [launchChecklistCopyStatus, setLaunchChecklistCopyStatus] = useState<
    "idle" | "copied" | "blocked"
  >("idle");
  const [launchChecklistFallbackText, setLaunchChecklistFallbackText] =
    useState("");
  const [taskActionCopyStatus, setTaskActionCopyStatus] = useState<
    Record<string, "idle" | "copied" | "blocked">
  >({});
  const [taskActionFallbackText, setTaskActionFallbackText] = useState<
    Record<string, string>
  >({});
  const [savingLaunchCheck, setSavingLaunchCheck] = useState<string | null>(
    null
  );
  const [launchCheckNotes, setLaunchCheckNotes] = useState<Record<string, string>>(
    {}
  );
  const [payoutNoteDrafts, setPayoutNoteDrafts] = useState<Record<string, string>>(
    {}
  );
  const [savingPayoutNote, setSavingPayoutNote] = useState<string | null>(null);
  const [confirmingCloseoutAction, setConfirmingCloseoutAction] = useState<
    string | null
  >(null);
  const [completionAudit, setCompletionAudit] =
    useState<CompletionAuditExport | null>(null);
  const [completionAuditError, setCompletionAuditError] = useState(false);
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
  const unifiedIntakeMatches = useMemo(
    () =>
      parseUnifiedBlockerIntake(unifiedIntakeText, {
        players,
        buyins,
        tournaments: unconfirmedTournaments,
      }),
    [unifiedIntakeText, players, buyins, unconfirmedTournaments]
  );
  const unifiedIntakeCount =
    unifiedIntakeMatches.payments.length +
    unifiedIntakeMatches.handicaps.length +
    unifiedIntakeMatches.schedules.length;
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
  const launchRisks = useMemo(
    () =>
      buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired,
        ...launchChecks,
      }),
    [players, buyins, tournaments, issues.length, accessCodeRequired, launchChecks]
  );
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
  const blockerHandoffText = useMemo(
    () => buildBlockerHandoffText(commissionerTasks, SOURCE_SEARCH_LEDGER),
    [commissionerTasks]
  );
  const blockerHandoffRows = useMemo(
    () => buildBlockerHandoff(commissionerTasks, SOURCE_SEARCH_LEDGER).rows,
    [commissionerTasks]
  );
  const blockerHandoffByTaskId = useMemo(
    () => new Map(blockerHandoffRows.map((row) => [row.taskId, row])),
    [blockerHandoffRows]
  );
  const evidenceGapPacket = useMemo(
    () =>
      buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      }),
    [players, buyins, tournaments, commissionerTasks]
  );
  const evidenceGapPacketText = useMemo(
    () => buildEvidenceGapPacketText(evidenceGapPacket),
    [evidenceGapPacket]
  );
  const launchGateChecklist = useMemo(
    () =>
      buildLaunchGateChecklist(launchCheckEvidence, {
        productionUrlRequired: launchChecks.productionUrlRequired,
      }),
    [launchCheckEvidence, launchChecks.productionUrlRequired]
  );
  const launchGateChecklistText = useMemo(
    () =>
      buildLaunchGateChecklistText(launchCheckEvidence, {
        productionUrlRequired: launchChecks.productionUrlRequired,
      }),
    [launchCheckEvidence, launchChecks.productionUrlRequired]
  );
  useEffect(() => {
    let cancelled = false;
    setCompletionAuditError(false);
    fetch("/api/export/completion-audit.json")
      .then((response) => {
        if (!response.ok) throw new Error("completion audit unavailable");
        return response.json() as Promise<CompletionAuditExport>;
      })
      .then((data) => {
        if (!cancelled) setCompletionAudit(data);
      })
      .catch(() => {
        if (!cancelled) setCompletionAuditError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    accessCodeRequired,
    buyins,
    commissionerTasks.length,
    issues.length,
    launchChecks,
    players,
    teeTimes,
    tournaments,
  ]);
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
            task.area === "access" ? "ops-season-export" : "ops-launch-gates"
          ),
      };
    }
    return null;
  };
  const launchGateCount = launchGateChecklist.summary.total;
  const verifiedLaunchGateCount = launchGateChecklist.summary.verified;
  const patchLaunchCheck = async (
    key:
      | "dockerBuildVerified"
      | "tailnetServeVerified"
      | "productionUrlVerified"
      | "mobileSafariVerified",
    verified: boolean,
    note?: string | null
  ) => {
    setSavingLaunchCheck(key);
    try {
      await onPatchLaunchCheck(key, verified, note);
    } finally {
      setSavingLaunchCheck(null);
    }
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
  const applyUnifiedIntake = async () => {
    if (unifiedIntakeCount === 0 || !unifiedIntakeConfirmed) return;
    setUnifiedIntakeSaving(true);
    setUnifiedIntakeStatus("");
    try {
      await onApplyUnifiedIntake(unifiedIntakeText);
      setUnifiedIntakeStatus(
        `Applied ${unifiedIntakeMatches.payments.length} buy-in status update${
          unifiedIntakeMatches.payments.length === 1 ? "" : "s"
        }, ${unifiedIntakeMatches.handicaps.length} handicap record${
          unifiedIntakeMatches.handicaps.length === 1 ? "" : "es"
        }, and ${unifiedIntakeMatches.schedules.length} schedule update${
          unifiedIntakeMatches.schedules.length === 1 ? "" : "s"
        }.`
      );
      setUnifiedIntakeText("");
      setUnifiedIntakeConfirmed(false);
    } finally {
      setUnifiedIntakeSaving(false);
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
  const copyBlockerHandoff = async () => {
    setHandoffFallbackText("");
    if (await writeClipboard(blockerHandoffText)) {
      setHandoffCopyStatus("copied");
      window.setTimeout(() => setHandoffCopyStatus("idle"), 1600);
    } else {
      setHandoffFallbackText(blockerHandoffText);
      setHandoffCopyStatus("blocked");
    }
  };
  const copyEvidenceGapPacket = async () => {
    setEvidenceGapFallbackText("");
    if (await writeClipboard(evidenceGapPacketText)) {
      setEvidenceGapCopyStatus("copied");
      window.setTimeout(() => setEvidenceGapCopyStatus("idle"), 1600);
    } else {
      setEvidenceGapFallbackText(evidenceGapPacketText);
      setEvidenceGapCopyStatus("blocked");
    }
  };
  const copyLaunchChecklist = async () => {
    setLaunchChecklistFallbackText("");
    if (await writeClipboard(launchGateChecklistText)) {
      setLaunchChecklistCopyStatus("copied");
      window.setTimeout(() => setLaunchChecklistCopyStatus("idle"), 1600);
    } else {
      setLaunchChecklistFallbackText(launchGateChecklistText);
      setLaunchChecklistCopyStatus("blocked");
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
                Commissioner Settings
              </span>
              <span className="block text-sm text-stone-500">
                Buy-in, payout, points, and coordination routes.
              </span>
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400">
            {settingsOpen ? "Close" : "Open"}
          </span>
        </button>
        {settingsOpen && (
          <div className="space-y-4 border-t border-stone-100 p-4">
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-sm font-semibold text-stone-900">
                Coordination Routes
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenView?.("money")}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  Money
                </button>
                <button
                  type="button"
                  onClick={() => onOpenView?.("roster")}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  Roster
                </button>
                <button
                  type="button"
                  onClick={() => openOpsSection("ops-schedule-confirmation")}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  Schedule
                </button>
                <button
                  type="button"
                  onClick={() => openOpsSection("ops-launch-gates")}
                  className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  Launch
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-stone-50 p-3">
              <div className="flex items-end gap-2">
                <label className="min-w-0 flex-1 text-xs font-medium text-stone-600">
                  Season buy-in for unpaid rows
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={settingBuyinValue}
                    onChange={(event) => {
                      setBuyinSettingDraft(event.target.value);
                      setSettingsStatus("");
                    }}
                    className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    !settingBuyinValid ||
                    unpaidBuyins.length === 0 ||
                    savingSettings
                  }
                  onClick={applyBuyinAmountToUnpaid}
                  className="rounded-xl bg-fairway-700 px-3 py-2 text-sm font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                >
                  {savingSettings ? "Saving" : "Apply"}
                </button>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Paid rows keep their receipt evidence; this changes only the
                {` ${unpaidBuyins.length} `}currently unpaid buy-in
                {unpaidBuyins.length === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-sm font-semibold text-stone-900">
                Points and Payouts
              </p>
              <ul className="mt-2 space-y-2">
                {tournaments.map((tournament) => {
                  const draft = payoutSettingsDraftFor(tournament);
                  const valid = payoutSettingsValid(tournament);
                  const saving = savingPayoutSettings === tournament.id;
                  return (
                    <li
                      key={tournament.id}
                      className="rounded-xl bg-white p-3 ring-1 ring-stone-200"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-stone-900">
                          {tournament.name}
                        </p>
                        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                          {tournament.type}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <SettingNumberInput
                          label="Pts"
                          value={draft.pointsToFirst}
                          onChange={(value) =>
                            updatePayoutSettingsDraft(tournament, {
                              pointsToFirst: value,
                            })
                          }
                        />
                        <SettingNumberInput
                          label="1st"
                          value={draft.payoutFirst}
                          onChange={(value) =>
                            updatePayoutSettingsDraft(tournament, {
                              payoutFirst: value,
                            })
                          }
                        />
                        <SettingNumberInput
                          label="2nd"
                          value={draft.payoutSecond}
                          onChange={(value) =>
                            updatePayoutSettingsDraft(tournament, {
                              payoutSecond: value,
                            })
                          }
                        />
                        <SettingNumberInput
                          label="3rd"
                          value={draft.payoutThird}
                          onChange={(value) =>
                            updatePayoutSettingsDraft(tournament, {
                              payoutThird: value,
                            })
                          }
                        />
                      </div>
                      {!valid && (
                        <p className="mt-2 text-xs font-semibold text-amber-700">
                          Use whole numbers only.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={!valid || saving}
                        onClick={() => savePayoutSettings(tournament)}
                        className="mt-2 w-full rounded-xl bg-fairway-700 px-3 py-2 text-sm font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                      >
                        {saving ? "Saving" : "Save scoring settings"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {settingsStatus && (
              <p className="rounded-xl bg-fairway-50 px-3 py-2 text-xs font-semibold text-fairway-800">
                {settingsStatus}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Completion Audit
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {completionAudit
                ? `App ${completionAudit.appStatusCounts.open} open · league data ${completionAudit.leagueDataOpen} open · device ${completionAudit.externalVerificationOpen} open`
                : completionAuditError
                  ? "Audit export unavailable."
                  : "Loading proof map..."}
            </p>
          </div>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              completionAudit?.appReady
                ? "bg-fairway-50 text-fairway-700"
                : completionAudit?.appStatusCounts.blocked
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {completionAudit?.appReady ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </span>
        </div>

        {completionAudit && (
          <ul className="mt-3 space-y-2">
            {completionAudit.items
              .filter((item) => item.status !== "passed")
              .slice(0, 6)
              .map((item) => (
                <li key={item.id} className="rounded-xl bg-stone-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-900">
                        {item.area}: {item.requirement}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {item.evidence[0] ?? "No evidence recorded"}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                        {auditScopeLabel(item.readinessScope)}
                      </p>
                      {item.nextAction && (
                        <p className="mt-1 text-xs font-medium text-stone-700">
                          Next: {item.nextAction}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.status === "blocked"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        )}

        {completionAudit?.appReady && (
          <p className="mt-3 rounded-xl bg-fairway-50 p-3 text-sm text-fairway-800">
            App readiness is proven; remaining handicap, buy-in status, schedule, or device items
            are separate from the app itself.
          </p>
        )}

        <a
          href={apiPath("/api/export/completion-audit.json")}
          download
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-200"
        >
          <Download className="h-3.5 w-3.5" />
          Download proof map
        </a>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              League Checklist
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {launchRisks.length === 0
                ? "No open league or device items."
                : `${launchRisks.length} item${
                    launchRisks.length === 1 ? "" : "s"
                  } to review`}
            </p>
          </div>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              launchRisks.some((risk) => risk.severity === "blocker")
                ? "bg-red-50 text-red-700"
                : launchRisks.length > 0
                  ? "bg-amber-50 text-amber-700"
                  : "bg-fairway-50 text-fairway-700"
            }`}
          >
            {launchRisks.length > 0 ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </span>
        </div>
        {launchRisks.length > 0 ? (
          <ul className="mt-3 divide-y divide-stone-100">
            {launchRisks.map((risk) => (
              <li key={risk.id} className="py-2">
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      risk.severity === "blocker"
                        ? "bg-red-50 text-red-700"
                        : risk.severity === "external"
                          ? "bg-stone-100 text-stone-600"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {risk.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900">
                      {risk.label}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {risk.detail}
                    </p>
                    <p className="mt-1 text-xs font-medium text-stone-700">
                      Action: {risk.nextAction}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl bg-fairway-50 p-3 text-sm text-fairway-800">
            Data, access, production, and mobile launch checks are clear.
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ExportButton
            href="/api/export/risks.json"
            label="Download checklist JSON"
          />
          <ExportButton
            href="/api/export/risks.csv"
            label="Download checklist CSV"
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Commissioner Tasks
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
            <button
              type="button"
              onClick={copyBlockerHandoff}
              className="inline-flex items-center justify-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              {handoffCopyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              {handoffCopyStatus === "copied"
                ? "Copied"
                : handoffCopyStatus === "blocked"
                  ? "Select text"
                  : "Copy handoff"}
            </button>
            <button
              type="button"
              onClick={copyEvidenceGapPacket}
              className="inline-flex items-center justify-center gap-1 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-200"
            >
              {evidenceGapCopyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" />
              )}
              {evidenceGapCopyStatus === "copied"
                ? "Copied"
                : evidenceGapCopyStatus === "blocked"
                  ? "Select text"
                  : "Copy evidence packet"}
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

        {handoffCopyStatus === "blocked" && (
          <label className="mt-3 block text-xs font-medium text-stone-600">
            Copy unavailable. Select handoff text below.
            <textarea
              readOnly
              value={handoffFallbackText}
              onFocus={(event) => event.target.select()}
              rows={6}
              className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
          </label>
        )}

        {evidenceGapCopyStatus === "blocked" && (
          <label className="mt-3 block text-xs font-medium text-stone-600">
            Copy unavailable. Select evidence packet below.
            <textarea
              readOnly
              value={evidenceGapFallbackText}
              onFocus={(event) => event.target.select()}
              rows={6}
              className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-800 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-100"
            />
          </label>
        )}

        {evidenceGapPacket.items.length > 0 && (
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Evidence gaps
            </p>
            <p className="mt-1 text-sm font-semibold text-stone-900">
              {evidenceGapPacket.summary.total} open ·{" "}
              {evidenceGapPacket.summary.onePasteReady} paste-ready ·{" "}
              {evidenceGapPacket.summary.launchVerification} launch checks
            </p>
          </div>
        )}

        {commissionerTasks.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {commissionerTasks.map((task) => {
              const openAction = taskOpenAction(task);
              const handoffRow = blockerHandoffByTaskId.get(task.id);
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
                {handoffRow?.manualEvidencePath && (
                  <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <p className="font-semibold">Evidence path</p>
                    <p className="mt-0.5 leading-relaxed">
                      {handoffRow.manualEvidencePath}
                    </p>
                  </div>
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

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              One-Paste Intake
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Match buy-in status, handicap-index records, and schedule replies from one paste.
            </p>
          </div>
          <Merge className="mt-0.5 h-5 w-5 shrink-0 text-fairway-700" />
        </div>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-stone-600">
          Paste group replies
          <textarea
            value={unifiedIntakeText}
            onChange={(event) => {
              setUnifiedIntakeText(event.target.value);
              setUnifiedIntakeStatus("");
              setUnifiedIntakeConfirmed(false);
            }}
            placeholder="Beck buy-in paid cash $325 2026-05-19&#10;Chris handicap index 11.4&#10;Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals"
            rows={5}
            className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs normal-case tracking-normal text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
          />
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <MiniCount
            label="Buy-in replies"
            value={unifiedIntakeMatches.payments.length}
          />
          <MiniCount
            label="Handicap"
            value={unifiedIntakeMatches.handicaps.length}
          />
          <MiniCount
            label="Schedule"
            value={unifiedIntakeMatches.schedules.length}
          />
        </div>
        {unifiedIntakeCount > 0 ? (
          <div className="mt-3 space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
            {unifiedIntakeMatches.payments.map((match) => (
              <IntakePreviewRow
                key={`ops-pay-${match.name}`}
                label={match.name}
                detail={`Buy-in status -> ${match.paymentStatus}${match.amount != null ? ` · $${match.amount}` : ""}${match.paymentMethod ? ` · ${match.paymentMethod}` : ""}${match.paidAt ? ` · ${match.paidAt}` : ""}`}
                source={match.source}
              />
            ))}
            {unifiedIntakeMatches.handicaps.map((match) => (
              <IntakePreviewRow
                key={`ops-hcp-${match.name}`}
                label={match.name}
                detail={`Roster -> index ${match.handicap}${match.ghinNumber ? ` · GHIN ${match.ghinNumber}` : " · source note only"}`}
                source={match.source}
              />
            ))}
            {unifiedIntakeMatches.schedules.map((match) => (
              <IntakePreviewRow
                key={`ops-schedule-${match.id}`}
                label={match.name}
                detail={`Schedule -> ${match.course} · ${match.windowStart}${match.windowEnd !== match.windowStart ? ` to ${match.windowEnd}` : ""}`}
                source={match.source}
              />
            ))}
            <label className="flex items-start gap-2 pt-1 text-xs font-semibold text-stone-700">
              <input
                type="checkbox"
                checked={unifiedIntakeConfirmed}
                onChange={(event) =>
                  setUnifiedIntakeConfirmed(event.target.checked)
                }
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-fairway-700 focus:ring-fairway-200"
              />
              Confirm these exact updates before applying
            </label>
          </div>
        ) : (
          <p className="mt-2 text-xs text-stone-500">
            {unifiedIntakeText.trim()
              ? "No known buy-in status, handicap, or TBD schedule replies found yet."
              : "Paid/comped lines need status language, method, amount, and date. Handicap and schedule replies can stay separate."}
          </p>
        )}
        <button
          type="button"
          disabled={
            unifiedIntakeCount === 0 ||
            unifiedIntakeSaving ||
            !unifiedIntakeConfirmed
          }
          onClick={applyUnifiedIntake}
          className="mt-3 w-full rounded-xl bg-fairway-700 px-3 py-2 text-sm font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
        >
          {unifiedIntakeSaving
            ? "Applying..."
            : `Apply intake${unifiedIntakeCount > 0 ? ` (${unifiedIntakeCount})` : ""}`}
        </button>
        {unifiedIntakeStatus && (
          <p className="mt-2 rounded-xl bg-fairway-50 p-2 text-xs font-medium text-fairway-800">
            {unifiedIntakeStatus}
          </p>
        )}
      </section>

      {launchGateCount > 0 && (
        <section
          id="ops-launch-gates"
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                Launch Gates
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {verifiedLaunchGateCount} of {launchGateCount} external checks
                verified
                {launchGateChecklist.summary.notRequired > 0
                  ? ` · ${launchGateChecklist.summary.notRequired} not required`
                  : ""}
                .
              </p>
            </div>
            <button
              type="button"
              onClick={copyLaunchChecklist}
              className="inline-flex w-full items-center justify-center gap-1 rounded-full bg-fairway-50 px-3 py-1.5 text-xs font-semibold text-fairway-800 hover:bg-fairway-100 sm:w-auto"
            >
              {launchChecklistCopyStatus === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {launchChecklistCopyStatus === "copied"
                ? "Copied"
                : launchChecklistCopyStatus === "blocked"
                  ? "Select text"
                  : "Copy launch checklist"}
            </button>
          </div>
          {launchChecklistCopyStatus === "blocked" && (
            <label className="mt-3 block text-xs font-medium text-stone-600">
              Copy unavailable. Select launch checklist below.
              <textarea
                readOnly
                value={launchChecklistFallbackText}
                onFocus={(event) => event.target.select()}
                rows={6}
                className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </label>
          )}
          <ul className="mt-3 space-y-2">
            {launchCheckEvidence.map((check) => {
              const checklistItem = launchGateChecklist.items.find(
                (item) => item.key === check.key
              );
              const saving = savingLaunchCheck === check.key;
              const envLocked = check.verified && check.source === "env";
              const notRequired = checklistItem?.status === "not_required";
              const noteDraft =
                launchCheckNotes[check.key] ??
                check.note ??
                defaultLaunchCheckNote(check.key, check.label);
              const noteError = check.verified
                ? null
                : launchCheckEvidenceNoteError(check.key, noteDraft);
              const canPatchLaunchCheck =
                !saving && !envLocked && (check.verified || !noteError);
              return (
                <li
                  key={check.key}
                  className="rounded-xl bg-stone-50 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-900">
                        {check.label}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {check.verified
                          ? `Verified${check.verifiedAt ? ` ${formatDateLabel(check.verifiedAt.slice(0, 10))}` : ""}${
                              check.verifiedBy ? ` by ${check.verifiedBy}` : ""
                            }`
                          : `Open · ${check.envVar}`}
                      </p>
                      {notRequired && (
                        <p className="mt-1 text-xs font-semibold text-fairway-700">
                          Optional for current Tailscale hosting.
                        </p>
                      )}
                      {check.note && (
                        <p className="mt-1 text-xs text-stone-600">
                          {check.note}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        notRequired
                          ? "bg-fairway-50 text-fairway-800"
                        : check.verified
                          ? "bg-fairway-50 text-fairway-800"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {notRequired
                        ? "not required"
                        : check.verified
                          ? check.source
                          : "open"}
                    </span>
                  </div>
                  {!envLocked && !notRequired && (
                    <label className="mt-2 block text-xs font-medium text-stone-600">
                      Evidence note
                      <textarea
                        value={noteDraft}
                        onChange={(event) =>
                          setLaunchCheckNotes((prev) => ({
                            ...prev,
                            [check.key]: event.target.value,
                          }))
                        }
                        rows={2}
                        aria-label={`${check.label} evidence note`}
                        aria-invalid={!!noteError}
                        className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                      {noteError && (
                        <span className="mt-1 block text-[11px] font-semibold text-amber-700">
                          {noteError}
                        </span>
                      )}
                    </label>
                  )}
                  {check.key === "mobileSafariVerified" && !check.verified && !notRequired && (
                    <div className="mt-2 rounded-xl bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-100">
                      <p className="font-semibold">
                        Open this screen on physical iPhone Safari.
                      </p>
                      <p className="mt-0.5">
                        The note must include iPhone, Safari, and the exact URL
                        tested.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setLaunchCheckNotes((prev) => ({
                            ...prev,
                            [check.key]: mobileSafariEvidenceNote(),
                          }))
                        }
                        className="mt-2 w-full rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                      >
                        {isIphoneSafari()
                          ? "Use this iPhone Safari"
                          : "Fill note with this URL"}
                      </button>
                    </div>
                  )}
                  {!notRequired && (
                    <button
                      type="button"
                      disabled={!canPatchLaunchCheck}
                      onClick={() =>
                        patchLaunchCheck(
                          check.key,
                          !check.verified,
                          check.verified ? null : noteDraft
                        )
                      }
                      className={`mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                        envLocked
                          ? "bg-stone-100 text-stone-400"
                          : check.verified
                            ? "bg-stone-100 text-stone-700 hover:bg-stone-200"
                            : noteError
                              ? "bg-stone-100 text-stone-400"
                            : "bg-fairway-700 text-white hover:bg-fairway-800"
                      }`}
                    >
                      {saving
                        ? "Saving..."
                        : envLocked
                          ? "Set by environment"
                          : noteError
                            ? "Evidence note required"
                          : check.verified
                            ? "Clear verification"
                            : `Mark ${check.label} verified`}
                    </button>
                  )}
                  {checklistItem && (
                    <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-stone-200">
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Evidence checklist
                      </p>
                      <ol className="mt-2 space-y-2">
                        {checklistItem.steps.map((step, index) => (
                          <li key={step.id} className="text-xs text-stone-700">
                            <p className="font-medium text-stone-900">
                              {index + 1}. {step.label}
                            </p>
                            <p className="mt-0.5 text-stone-500">
                              {step.requiredEvidence}
                            </p>
                            {step.command && (
                              <code className="mt-1 block overflow-x-auto rounded-lg bg-stone-100 px-2 py-1 text-[11px] text-stone-700">
                                {step.command}
                              </code>
                            )}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-xs font-medium text-stone-700">
                        Final: {checklistItem.finalAction}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      <section
        id="ops-season-export"
        className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Season Export
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {buyins.length} buy-ins · ${totals.settled.toLocaleString()} of $
              {totals.expected.toLocaleString()} settled
            </p>
          </div>
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-fairway-700" />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <ExportButton href="/api/export/season.json" label="Download JSON" />
          <ExportButton href="/api/export/rules.json" label="Download rules JSON" />
          <ExportButton href="/api/export/tee-times.csv" label="Download tee times CSV" />
          <ExportButton href="/api/export/buyins.csv" label="Download buy-ins CSV" />
          <ExportButton href="/api/export/payouts.csv" label="Download payouts CSV" />
          <ExportButton href="/api/export/roster.csv" label="Download roster CSV" />
          <ExportButton href="/api/export/scores.csv" label="Download scores CSV" />
          <ExportButton
            href="/api/export/attestations.csv"
            label="Download attestations CSV"
          />
          <ExportButton
            href="/api/export/standings.csv"
            label="Download standings CSV"
          />
          <ExportButton
            href="/api/export/readiness.json"
            label="Download readiness JSON"
          />
          <ExportButton href="/api/export/tasks.json" label="Download task JSON" />
          <ExportButton href="/api/export/tasks.csv" label="Download task CSV" />
          <ExportButton href="/api/export/risks.json" label="Download checklist JSON" />
          <ExportButton href="/api/export/risks.csv" label="Download checklist CSV" />
          <ExportButton
            href="/api/export/request-packet.txt"
            label="Download request packet"
          />
          <ExportButton
            href="/api/export/blocker-handoff.json"
            label="Download handoff JSON"
          />
          <ExportButton
            href="/api/export/blocker-handoff.txt"
            label="Download handoff"
          />
          <ExportButton
            href="/api/export/evidence-gap-packet.json"
            label="Download evidence gap JSON"
          />
          <ExportButton
            href="/api/export/evidence-gap-packet.csv"
            label="Download evidence gap CSV"
          />
          <ExportButton
            href="/api/export/evidence-gap-packet.txt"
            label="Download evidence gap packet"
          />
          <ExportButton
            href="/api/export/source-search-ledger.json"
            label="Download source search JSON"
          />
          <ExportButton
            href="/api/export/source-search-ledger.csv"
            label="Download source search CSV"
          />
          <ExportButton
            href="/api/export/completion-audit.json"
            label="Download completion audit"
          />
          <ExportButton
            href="/api/export/completion-audit.csv"
            label="Download completion CSV"
          />
          <ExportButton
            href="/api/export/launch-checks.json"
            label="Download launch checks JSON"
          />
          <ExportButton
            href="/api/export/launch-checks.csv"
            label="Download launch checks CSV"
          />
          <ExportButton
            href="/api/export/launch-gate-checklist.json"
            label="Download launch checklist JSON"
          />
          <ExportButton
            href="/api/export/launch-gate-checklist.csv"
            label="Download launch checklist CSV"
          />
          <ExportButton
            href="/api/export/launch-gate-checklist.txt"
            label="Download launch checklist"
          />
          <ExportButton href="/api/export/audit.json" label="Download audit JSON" />
          <ExportButton href="/api/export/audit.csv" label="Download audit CSV" />
          <ExportButton
            href="/api/export/verification-runs.json"
            label="Download verification JSON"
          />
          <ExportButton
            href="/api/export/verification-runs.csv"
            label="Download verification CSV"
          />
          <ExportButton href="/api/export/archive.json" label="Download archive manifest" />
          <ExportButton href="/api/export/summary.txt" label="Download summary" />
          <ExportButton
            href="/api/export/launch-packet.txt"
            label="Download launch packet"
          />
          <ExportButton href="/api/export/database" label="Download database" />
        </div>

        {totals.outstanding > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            ${totals.outstanding.toLocaleString()} still owed.
          </p>
        )}
      </section>

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

function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={apiPath(href)}
      download
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-fairway-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-800"
    >
      <Download className="h-4 w-4" />
      {label}
    </a>
  );
}

function defaultLaunchCheckNote(key: string, label: string) {
  const date = todayISO();
  if (key === "productionUrlVerified") {
    return `Final URL [paste URL] remote smoke passed on ${date}.`;
  }
  if (key === "mobileSafariVerified") {
    return mobileSafariEvidenceNote(date);
  }
  if (key === "tailnetServeVerified") {
    return `Tailscale Funnel smoke and mobile checks passed on ${date}.`;
  }
  if (key === "dockerBuildVerified") {
    return `Docker smoke passed on ${date}.`;
  }
  return `${label} verified on ${date}.`;
}

function mobileSafariEvidenceNote(date = todayISO()) {
  const href =
    typeof window === "undefined"
      ? "[paste URL]"
      : window.location.href.split("#")[0];
  return `Physical iPhone Safari golden path passed on ${date} at ${href}.`;
}

function isIphoneSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone/i.test(ua) && /safari/i.test(ua) && !/(crios|fxios|edgios)/i.test(ua);
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
    <label className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
      {label}
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
      />
    </label>
  );
}

function launchCheckEvidenceNoteError(key: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed) return "Add the evidence note before marking verified.";
  if (key === "productionUrlVerified") {
    const urls = trimmed.match(/https?:\/\/[^\s<>)]+/gi) ?? [];
    if (urls.length === 0) return "Paste the final public URL in the note.";
    if (
      urls.some((url) =>
        /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(
          url
        )
      )
    ) {
      return "Use the final public URL, not localhost or loopback.";
    }
    if (!/remote smoke|verify:remote-smoke|smoke passed/i.test(trimmed)) {
      return "Mention the remote smoke proof in the note.";
    }
  }
  if (key === "mobileSafariVerified") {
    if (!/iphone/i.test(trimmed)) return "Mention the physical iPhone.";
    if (!/safari/i.test(trimmed)) return "Mention Safari.";
    const urls = trimmed.match(/https?:\/\/[^\s<>)]+/gi) ?? [];
    if (urls.length === 0) return "Paste the URL tested on the iPhone.";
    if (
      urls.some((url) =>
        /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(
          url
        )
      )
    ) {
      return "Use the deployed URL tested on iPhone, not localhost.";
    }
  }
  return null;
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-stone-50 p-2 text-center">
      <div className="text-base font-semibold text-stone-900">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        {label}
      </div>
    </div>
  );
}

function IntakePreviewRow({
  label,
  detail,
  source,
}: {
  label: string;
  detail: string;
  source: string;
}) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-stone-900">{label}</p>
        <p className="text-right text-xs font-medium text-fairway-800">
          {detail}
        </p>
      </div>
      <p className="mt-1 break-words text-[11px] text-stone-500">
        Source: {source}
      </p>
    </div>
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
