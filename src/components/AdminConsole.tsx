import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  CheckCircle2,
  ClipboardPaste,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  ListChecks,
  ScrollText,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  WalletCards,
} from "lucide-react";
import { auditLeagueRules, type RuleIssue } from "../lib/audit";
import { apiPath } from "../lib/api";
import { parseUnifiedBlockerIntake } from "../lib/bulkIntake";
import { formatDateLabel, formatTimeLabel, todayISO } from "../lib/format";
import { missingSourceBackedHandicapPlayers } from "../lib/handicapEvidence";
import type { Buyin, Player, TeeTime, Tournament } from "../lib/types";

type LaunchKey =
  | "dockerBuildVerified"
  | "tailnetServeVerified"
  | "productionUrlVerified"
  | "mobileSafariVerified";

type LaunchCheckEvidence = {
  key: LaunchKey;
  label: string;
  envVar: string;
  verified: boolean;
  source: "env" | "database" | "none";
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  updatedAt: string | null;
};

type AdminViewTarget = "board" | "season" | "money" | "roster" | "ops";

type BackupProof = {
  ok: boolean;
  verifiedAt: string;
  backupBytes: number;
  counts: {
    members: number;
    buyins: number;
    tournaments: number;
    teeTimes: number;
  };
};

type CompletionAudit = {
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
    nextAction: string | null;
  }>;
};

type AuditExport = {
  count: number;
  events: Array<{
    id: string;
    createdAt: string;
    action: string;
    actor: string;
    summary: string;
  }>;
};

const readinessScopeLabel = (
  scope: "app" | "league_data" | "external_verification"
) => {
  if (scope === "league_data") return "league data";
  if (scope === "external_verification") return "device check";
  return "app";
};

export function AdminConsole({
  teeTimes,
  tournaments,
  players,
  buyins,
  accessCodeRequired,
  launchChecks,
  launchCheckEvidence,
  onOpenView,
  onFixIssue,
  onAttestScore,
  onApplyUnifiedIntake,
  onPatchLaunchCheck,
  advanced,
}: {
  teeTimes: TeeTime[];
  tournaments: Tournament[];
  players: Player[];
  buyins: Buyin[];
  accessCodeRequired: boolean;
  launchChecks: Record<LaunchKey, boolean>;
  launchCheckEvidence: LaunchCheckEvidence[];
  onOpenView: (view: AdminViewTarget) => void;
  onFixIssue: (issue: RuleIssue) => void;
  onAttestScore: (teeTimeId: string, playerName: string) => void | Promise<void>;
  onApplyUnifiedIntake: (text: string) => Promise<void>;
  onPatchLaunchCheck: (
    key: LaunchKey,
    verified: boolean,
    note?: string | null
  ) => Promise<void>;
  advanced?: ReactNode;
}) {
  const [intakeText, setIntakeText] = useState("");
  const [intakeStatus, setIntakeStatus] = useState("");
  const [applyingIntake, setApplyingIntake] = useState(false);
  const [intakeConfirmed, setIntakeConfirmed] = useState(false);
  const [launchNotes, setLaunchNotes] = useState<Record<string, string>>({});
  const [savingLaunchKey, setSavingLaunchKey] = useState<string | null>(null);
  const [backupProof, setBackupProof] = useState<BackupProof | null>(null);
  const [backupStatus, setBackupStatus] = useState("");
  const [verifyingBackup, setVerifyingBackup] = useState(false);
  const [confirmingAttestationKey, setConfirmingAttestationKey] = useState<string | null>(
    null
  );
  const [confirmingBulkAttestations, setConfirmingBulkAttestations] =
    useState(false);
  const [bulkAttestationSaving, setBulkAttestationSaving] = useState(false);
  const [bulkAttestationStatus, setBulkAttestationStatus] = useState("");
  const [completionAudit, setCompletionAudit] =
    useState<CompletionAudit | null>(null);
  const [completionAuditError, setCompletionAuditError] = useState(false);
  const [auditExport, setAuditExport] = useState<AuditExport | null>(null);
  const [auditExportError, setAuditExportError] = useState(false);
  const today = useMemo(() => todayISO(), []);
  const ruleIssues = useMemo(
    () => auditLeagueRules(teeTimes, tournaments, players, today),
    [players, teeTimes, today, tournaments]
  );
  const intake = useMemo(
    () =>
      parseUnifiedBlockerIntake(intakeText, {
        players,
        buyins,
        tournaments,
      }),
    [buyins, intakeText, players, tournaments]
  );
  const intakeCount =
    intake.payments.length + intake.handicaps.length + intake.schedules.length;
  const nextTeeTime = teeTimes.find((teeTime) => {
    const nowKey = today.replaceAll("-", "");
    return teeTime.date.replaceAll("-", "") >= nowKey;
  });
  const activeTournament =
    tournaments.find(
      (tournament) => today >= tournament.windowStart && today <= tournament.windowEnd
    ) ?? tournaments[0] ?? null;
  const members = players.filter((player) => player.member);
  const missingHandicaps = missingSourceBackedHandicapPlayers(members);
  const unpaid = buyins.filter((buyin) => !buyin.paid);
  const launchVerified = launchCheckEvidence.filter((check) => check.verified).length;
  const scoreReview = useMemo(() => {
    const rows = teeTimes.flatMap((teeTime) =>
      teeTime.scores.map((score) => {
        const status = score.attestationStatus ?? "legacy_unconfirmed";
        return {
          teeTime,
          score,
          status,
          official:
            status === "attested" ||
            status === "overridden",
        };
      })
    );
    return {
      total: rows.length,
      official: rows.filter((row) => row.official).length,
      draft: rows.filter((row) => row.status === "draft").length,
      pending: rows.filter((row) => row.status === "pending").length,
      legacyUnconfirmed: rows.filter((row) => row.status === "legacy_unconfirmed")
        .length,
      overridden: rows.filter((row) => row.status === "overridden").length,
      openAttestations: rows.filter(
        (row) => row.status === "pending" || row.status === "legacy_unconfirmed"
      ).length,
      pendingRows: rows
        .filter((row) => row.status === "pending" || row.status === "legacy_unconfirmed")
        .sort(
          (a, b) =>
            a.teeTime.date.localeCompare(b.teeTime.date) ||
            a.teeTime.time.localeCompare(b.teeTime.time) ||
            a.score.name.localeCompare(b.score.name)
        ),
      draftRows: rows
        .filter((row) => row.status === "draft")
        .sort(
          (a, b) =>
            a.teeTime.date.localeCompare(b.teeTime.date) ||
            a.teeTime.time.localeCompare(b.teeTime.time) ||
            a.score.name.localeCompare(b.score.name)
        )
        .slice(0, 3),
    };
  }, [teeTimes]);
  const teeTimeOversight = useMemo(() => {
    const memberNames = new Set(
      players
        .filter((player) => player.member)
        .map((player) => player.name.trim().toLowerCase())
    );
    const tournamentFor = (teeTime: TeeTime) =>
      tournaments.find(
        (tournament) =>
          tournament.type !== "post" &&
          teeTime.date >= tournament.windowStart &&
          teeTime.date <= tournament.windowEnd
      ) ?? null;
    const rows = teeTimes.map((teeTime) => {
      const isUpcoming = teeTime.date >= today;
      const full = teeTime.claims.length >= teeTime.spots;
      const guestCount = teeTime.claims.filter(
        (claim) => !memberNames.has(claim.name.trim().toLowerCase())
      ).length;
      const tournament = tournamentFor(teeTime);
      const missingScores =
        !!tournament &&
        !isUpcoming &&
        teeTime.claims
          .filter((claim) => memberNames.has(claim.name.trim().toLowerCase()))
          .some(
            (claim) =>
              !teeTime.scores.some(
                (score) =>
                  score.name.trim().toLowerCase() ===
                  claim.name.trim().toLowerCase()
              )
          );
      const pendingAttestations = teeTime.scores.filter(
        (score) =>
          score.attestationStatus == null || score.attestationStatus === "pending"
      ).length;
      const needsAction =
        teeTime.interested.length > 0 ||
        guestCount > 0 ||
        missingScores ||
        pendingAttestations > 0;
      return {
        teeTime,
        isUpcoming,
        full,
        guestCount,
        missingScores,
        pendingAttestations,
        needsAction,
        tournamentName: tournament?.name ?? null,
      };
    });
    return {
      upcoming: rows.filter((row) => row.isUpcoming).length,
      past: rows.filter((row) => !row.isUpcoming).length,
      open: rows.filter((row) => row.isUpcoming && !row.full).length,
      full: rows.filter((row) => row.isUpcoming && row.full).length,
      maybePlayers: rows.reduce(
        (sum, row) => sum + row.teeTime.interested.length,
        0
      ),
      guests: rows.reduce((sum, row) => sum + row.guestCount, 0),
      needsScores: rows.filter((row) => row.missingScores).length,
      pendingAttestations: rows.reduce(
        (sum, row) => sum + row.pendingAttestations,
        0
      ),
      actionRows: rows
        .filter((row) => row.needsAction)
        .sort(
          (a, b) =>
            a.teeTime.date.localeCompare(b.teeTime.date) ||
            a.teeTime.time.localeCompare(b.teeTime.time)
        )
        .slice(0, 4),
    };
  }, [players, teeTimes, today, tournaments]);
  const openCompletionItems = useMemo(
    () =>
      completionAudit?.items.filter((item) => item.status !== "passed") ?? [],
    [completionAudit]
  );

  const completionAuditRefreshKey = useMemo(
    () =>
      JSON.stringify({
        teeTimes: teeTimes.map((teeTime) => [
          teeTime.id,
          teeTime.createdAt,
          teeTime.claims.length,
          teeTime.scores.length,
          teeTime.scores.map((score) => [
            score.name,
            score.gross,
            score.attestationStatus,
            score.attestedAt,
          ]),
        ]),
        tournaments: tournaments.map((tournament) => [
          tournament.id,
          tournament.closedAt,
          tournament.course,
          tournament.windowStart,
          tournament.windowEnd,
          tournament.closedBy,
        ]),
        players: players.map((player) => [
          player.name,
          player.member,
          player.handicap,
          player.ghinNumber,
        ]),
        buyins: buyins.map((buyin) => [
          buyin.playerName,
          buyin.paid,
          buyin.paymentStatus,
          buyin.paidAt,
          buyin.updatedAt,
        ]),
        launch: launchCheckEvidence.map((check) => [
          check.key,
          check.verified,
          check.updatedAt,
        ]),
      }),
    [teeTimes, tournaments, players, buyins, launchCheckEvidence]
  );

  useEffect(() => {
    let canceled = false;
    fetch(apiPath("/api/export/completion-audit.json"))
      .then((response) => {
        if (!response.ok) throw new Error("completion audit unavailable");
        return response.json();
      })
      .then((data: CompletionAudit) => {
        if (!canceled) {
          setCompletionAudit(data);
          setCompletionAuditError(false);
        }
      })
      .catch(() => {
        if (!canceled) setCompletionAuditError(true);
      });
    return () => {
      canceled = true;
    };
  }, [completionAuditRefreshKey]);

  useEffect(() => {
    let canceled = false;
    fetch(apiPath("/api/export/audit.json"))
      .then((response) => {
        if (!response.ok) throw new Error("audit unavailable");
        return response.json();
      })
      .then((data: AuditExport) => {
        if (!canceled) {
          setAuditExport(data);
          setAuditExportError(false);
        }
      })
      .catch(() => {
        if (!canceled) setAuditExportError(true);
      });
    return () => {
      canceled = true;
    };
  }, [completionAuditRefreshKey]);

  const scrollToAdminSection = (id: string) => {
    onOpenView("ops");
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const scrollToLocalSection = (id: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const openCompletionItem = (id: string) => {
    if (id === "roster-ghin") onOpenView("roster");
    else if (id === "money-collected") onOpenView("money");
    else if (id === "schedule-confirmed") scrollToAdminSection("ops-schedule-confirmation");
    else if (id === "iphone-safari-gate") scrollToAdminSection("ops-launch-gates");
    else scrollToAdminSection("admin-full-workbench");
  };

  const applyIntake = async () => {
    if (intakeCount === 0 || applyingIntake || !intakeConfirmed) return;
    setApplyingIntake(true);
    setIntakeStatus("");
    try {
      await onApplyUnifiedIntake(intakeText);
      setIntakeText("");
      setIntakeConfirmed(false);
      setIntakeStatus(`Applied ${intakeCount} update${intakeCount === 1 ? "" : "s"}.`);
    } finally {
      setApplyingIntake(false);
    }
  };

  const patchLaunch = async (check: LaunchCheckEvidence, verified: boolean) => {
    const note = (launchNotes[check.key] ?? check.note ?? "").trim();
    setSavingLaunchKey(check.key);
    try {
      await onPatchLaunchCheck(check.key, verified, note || null);
    } finally {
      setSavingLaunchKey(null);
    }
  };

  const fillMobileSafariNote = (key: string) => {
    setLaunchNotes((prev) => ({
      ...prev,
      [key]: mobileSafariEvidenceNote(),
    }));
  };

  const verifyMobileSafari = async (check: LaunchCheckEvidence) => {
    const note = mobileSafariEvidenceNote();
    setLaunchNotes((prev) => ({
      ...prev,
      [check.key]: note,
    }));
    setSavingLaunchKey(check.key);
    try {
      await onPatchLaunchCheck(check.key, true, note);
    } finally {
      setSavingLaunchKey(null);
    }
  };

  const verifyBackup = async () => {
    setVerifyingBackup(true);
    setBackupStatus("");
    try {
      const response = await fetch("/api/backups/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "Commissioner" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Backup verification failed");
      }
      setBackupProof(data as BackupProof);
      setBackupStatus("Backup verified");
    } catch (error: any) {
      setBackupStatus(error?.message || "Backup verification failed");
    } finally {
      setVerifyingBackup(false);
    }
  };

  const overrideAttestation = async (teeTimeId: string, playerName: string) => {
    const key = `${teeTimeId}:${playerName}`;
    if (confirmingAttestationKey !== key) {
      setConfirmingAttestationKey(key);
      setConfirmingBulkAttestations(false);
      return;
    }
    await onAttestScore(teeTimeId, playerName);
    setConfirmingAttestationKey(null);
  };

  const overrideAllPendingAttestations = async () => {
    if (scoreReview.pendingRows.length === 0 || bulkAttestationSaving) return;
    if (!confirmingBulkAttestations) {
      setConfirmingBulkAttestations(true);
      setConfirmingAttestationKey(null);
      setBulkAttestationStatus("");
      return;
    }
    const targets = scoreReview.pendingRows.map(({ teeTime, score }) => ({
      teeTimeId: teeTime.id,
      playerName: score.name,
    }));
    setBulkAttestationSaving(true);
    setBulkAttestationStatus("");
    try {
      for (const target of targets) {
        await onAttestScore(target.teeTimeId, target.playerName);
      }
      setBulkAttestationStatus(
        `Overrode ${targets.length} pending attestation${targets.length === 1 ? "" : "s"}.`
      );
      setConfirmingBulkAttestations(false);
    } finally {
      setBulkAttestationSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-stone-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-300">
              Admin Console
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              League Controls
            </h2>
            <p className="mt-1 text-sm leading-5 text-stone-300">
              Review scores, roster records, tee times, and app access from one place.
            </p>
          </div>
          <StatusPill tone={ruleIssues.length > 0 ? "warn" : "ok"}>
            {ruleIssues.length > 0 ? "review" : "ready"}
          </StatusPill>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <AdminMetric
            icon={Trophy}
            label="Scores to review"
            value={String(ruleIssues.length)}
          />
          <AdminMetric
            icon={CalendarDays}
            label="Tee times"
            value={String(teeTimes.length)}
          />
          <AdminMetric
            icon={Users}
            label="Handicap gaps"
            value={String(missingHandicaps.length)}
          />
          <AdminMetric
            icon={ShieldCheck}
            label="Launch"
            value={`${launchVerified}/${launchCheckEvidence.length || 4}`}
          />
        </div>
      </section>

      <section
        aria-label="Operational readiness and data gaps"
        className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Operational Readiness
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              App readiness separated from handicap, buy-in status, schedule, and device gaps.
            </p>
          </div>
          {completionAudit && (
            <StatusPill tone={completionAudit.appReady ? "ok" : "warn"}>
              {completionAudit.appReady
                ? "app ready"
                : `${completionAudit.appStatusCounts.open} app open`}
            </StatusPill>
          )}
        </div>
        {completionAuditError ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            Completion audit unavailable.
          </p>
        ) : completionAudit ? (
          openCompletionItems.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                <div className="rounded-xl bg-fairway-50 px-2 py-2 text-fairway-800">
                  App {completionAudit.appStatusCounts.open} open
                </div>
                <div className="rounded-xl bg-stone-50 px-2 py-2 text-stone-700">
                  Data {completionAudit.leagueDataOpen} open
                </div>
                <div className="rounded-xl bg-stone-50 px-2 py-2 text-stone-700">
                  Device {completionAudit.externalVerificationOpen} open
                </div>
              </div>
              {openCompletionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openCompletionItem(item.id)}
                  className="w-full rounded-xl bg-stone-50 px-3 py-2 text-left ring-1 ring-stone-200 hover:bg-stone-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-900">
                        {item.area}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                        {readinessScopeLabel(item.readinessScope)}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-stone-600">
                        {item.evidence.join(" · ")}
                      </p>
                    </div>
                    <StatusPill tone={item.status === "blocked" ? "danger" : "warn"}>
                      {item.status}
                    </StatusPill>
                  </div>
                  {item.nextAction && (
                    <p className="mt-1 text-xs font-semibold text-fairway-800">
                      {item.nextAction}
                    </p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl bg-fairway-50 px-3 py-2 text-sm font-semibold text-fairway-800">
              App checks are clear.
            </p>
          )
        ) : (
          <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
            Loading completion audit…
          </p>
        )}
        <a
          href={apiPath("/api/export/completion-audit.json")}
          download
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200"
        >
          <Download className="h-4 w-4" />
          Completion Audit
        </a>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-base font-semibold text-stone-900">Roles</h2>
        <div className="mt-3 space-y-2">
          <RoleBoundary
            role="Player"
            detail="Board, maybe spots, own claims, own comments, roster basics, standings, score status."
          />
          <RoleBoundary
            role="Host"
            detail="Creates tee times and manages only the tee times they host."
          />
          <RoleBoundary
            role="Commissioner"
            detail="Separate unlock for roster handicap records, buy-in status, score fixes, closeout, payouts, launch checks, backups, exports, and audit."
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-base font-semibold text-stone-900">Next Actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AdminActionButton
            icon={Trophy}
            label={ruleIssues.length > 0 ? "Fix Scores" : "Scores OK"}
            onClick={() => ruleIssues[0] && onFixIssue(ruleIssues[0])}
            disabled={ruleIssues.length === 0}
          />
          <AdminActionButton
            icon={CalendarDays}
            label="Tee Times"
            onClick={() => scrollToLocalSection("admin-tee-time-oversight")}
          />
          <AdminActionButton icon={Users} label="Roster" onClick={() => onOpenView("roster")} />
          <a
            href={apiPath("/api/export/database")}
            download
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200"
          >
            <Database className="h-5 w-5" />
            Backup DB
          </a>
          <button
            type="button"
            onClick={verifyBackup}
            disabled={verifyingBackup}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200 disabled:text-stone-400"
          >
            <CheckCircle2 className="h-5 w-5" />
            {verifyingBackup ? "Verifying" : "Verify backup"}
          </button>
          <AdminActionButton
            icon={Settings}
            label="Full Ops"
            onClick={() => scrollToAdminSection("admin-full-workbench")}
          />
          <AdminActionButton icon={WalletCards} label="Money" onClick={() => onOpenView("money")} />
        </div>
        {backupStatus && (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${
              backupProof?.ok
                ? "bg-fairway-50 text-fairway-800"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {backupStatus}
            {backupProof?.ok
              ? ` · ${backupProof.backupBytes.toLocaleString()} bytes · ${backupProof.counts.members} members / ${backupProof.counts.buyins} buy-ins`
              : ""}
          </p>
        )}
        <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          {nextTeeTime ? (
            <>
              Next tee time:{" "}
              <span className="font-semibold text-stone-900">
                {formatDateLabel(nextTeeTime.date)} {formatTimeLabel(nextTeeTime.time)}
              </span>{" "}
              at {nextTeeTime.course}
            </>
          ) : activeTournament ? (
            <>
              Active event:{" "}
              <span className="font-semibold text-stone-900">
                {activeTournament.name}
              </span>
            </>
          ) : (
            "No active event found."
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-base font-semibold text-stone-900">Admin Map</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AdminToolButton
            icon={Users}
            label="Roster / Handicap"
            detail={`${missingHandicaps.length} missing/unverified`}
            onClick={() => onOpenView("roster")}
          />
          <AdminToolButton
            icon={WalletCards}
            label="Buy-ins"
            detail={`${unpaid.length} open`}
            onClick={() => onOpenView("money")}
          />
          <AdminToolButton
            icon={CalendarDays}
            label="Tee times"
            detail={nextTeeTime ? formatDateLabel(nextTeeTime.date) : "board"}
            onClick={() => scrollToLocalSection("admin-tee-time-oversight")}
          />
          <AdminToolButton
            icon={ClipboardCheck}
            label="Score review"
            detail={`${scoreReview.openAttestations + scoreReview.draft} open/draft`}
            onClick={() => scrollToLocalSection("admin-score-attestation-review")}
          />
          <AdminToolButton
            icon={ShieldCheck}
            label="Attestation review"
            detail={`${scoreReview.openAttestations} need confirm`}
            onClick={() => scrollToLocalSection("admin-score-attestation-review")}
          />
          <AdminToolButton
            icon={Trophy}
            label="Standings closeout"
            detail={activeTournament?.name ?? "season"}
            onClick={() => scrollToAdminSection("ops-tournament-closeout")}
          />
          <AdminToolButton
            icon={ListChecks}
            label="Closeout packets"
            detail="standings"
            onClick={() => scrollToAdminSection("ops-tournament-closeout")}
          />
          <AdminToolButton
            icon={WalletCards}
            label="Payout closeout"
            detail="ledger"
            onClick={() => scrollToAdminSection("ops-tournament-closeout")}
          />
          <AdminToolButton
            icon={Settings}
            label="Launch checks"
            detail={`${launchVerified}/${launchCheckEvidence.length || 4}`}
            onClick={() => scrollToLocalSection("admin-launch-access")}
          />
          <a
            href={apiPath("/api/export/database")}
            download
            className="min-h-16 rounded-xl bg-stone-50 p-3 text-left ring-1 ring-stone-200 hover:bg-stone-100"
          >
            <FileArchive className="h-4 w-4 text-fairway-700" />
            <span className="mt-1 block text-sm font-semibold text-stone-900">
              Backup
            </span>
            <span className="block text-xs text-stone-500">database</span>
          </a>
          <AdminToolButton
            icon={CheckCircle2}
            label="Backup proof"
            detail={backupProof?.ok ? "verified" : "restore check"}
            onClick={verifyBackup}
          />
          <AdminToolButton
            icon={Download}
            label="Exports"
            detail="all files"
            onClick={() => scrollToLocalSection("admin-exports")}
          />
          <AdminToolButton
            icon={ScrollText}
            label="Audit log"
            detail="events"
            onClick={() => scrollToLocalSection("admin-audit-log")}
          />
          <AdminToolButton
            icon={Settings}
            label="Full Operations"
            detail="all tools"
            onClick={() => scrollToAdminSection("admin-full-workbench")}
          />
        </div>
      </section>

      {advanced && (
        <section className="rounded-2xl bg-fairway-900 p-4 text-white shadow-sm">
          <div className="flex items-start gap-3">
            <Settings className="mt-0.5 h-5 w-5 shrink-0 text-fairway-100" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold">
                Operations Workbench
              </h2>
              <p className="mt-0.5 text-sm leading-5 text-fairway-100">
                The complete operations tools are still here: settings, admin tasks,
                one-paste intake, launch gates, rule audit, exports, closeout,
                payout ledger, and evidence packets.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => scrollToAdminSection("admin-full-workbench")}
            className="mt-3 w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-fairway-900 hover:bg-fairway-50"
          >
            Open full operations
          </button>
        </section>
      )}

      <section
        id="admin-tee-time-oversight"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Tee-Time Oversight
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Commissioner view of open spots, maybes, guests, score gaps, and
              pending attestations.
            </p>
          </div>
          <StatusPill
            tone={
              teeTimeOversight.actionRows.length > 0 ||
              teeTimeOversight.open > 0
                ? "warn"
                : "ok"
            }
          >
            {teeTimeOversight.actionRows.length > 0 ? "review" : "clear"}
          </StatusPill>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <MiniStat label="Open" value={teeTimeOversight.open} />
          <MiniStat label="Full" value={teeTimeOversight.full} />
          <MiniStat label="Maybe" value={teeTimeOversight.maybePlayers} />
          <MiniStat label="Guests" value={teeTimeOversight.guests} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <MiniStat label="Future" value={teeTimeOversight.upcoming} />
          <MiniStat label="Past" value={teeTimeOversight.past} />
          <MiniStat label="Scores" value={teeTimeOversight.needsScores} />
          <MiniStat label="Attest" value={teeTimeOversight.pendingAttestations} />
        </div>
        {teeTimeOversight.actionRows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {teeTimeOversight.actionRows.map((row) => (
              <TeeTimeOversightRow
                key={row.teeTime.id}
                teeTime={row.teeTime}
                guestCount={row.guestCount}
                missingScores={row.missingScores}
                pendingAttestations={row.pendingAttestations}
                tournamentName={row.tournamentName}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-fairway-50 px-3 py-2 text-sm font-semibold text-fairway-800">
            No tee-time coordination items need commissioner review.
          </p>
        )}
        <button
          type="button"
          onClick={() => onOpenView("board")}
          className="mt-3 w-full rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200"
        >
          Open tee-time board
        </button>
      </section>

      <section
        id="admin-score-attestation-review"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Score & Attestation Review
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Official attested and override scores are separated from draft,
              pending, and legacy-unconfirmed cards before standings closeout.
            </p>
          </div>
          <StatusPill
            tone={
              ruleIssues.length > 0 ||
              scoreReview.openAttestations > 0 ||
              scoreReview.draft > 0
                ? "warn"
                : "ok"
            }
          >
            {ruleIssues.length > 0 ? "blocked" : "current"}
          </StatusPill>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <MiniStat label="Official" value={scoreReview.official} />
          <MiniStat label="Needs confirm" value={scoreReview.openAttestations} />
          <MiniStat label="Draft" value={scoreReview.draft} />
          <MiniStat label="Override" value={scoreReview.overridden} />
        </div>
        {ruleIssues.length > 0 && (
          <button
            type="button"
            onClick={() => onFixIssue(ruleIssues[0])}
            className="mt-3 w-full rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            Review first score: {ruleIssues[0].player} - {ruleIssues[0].message}
          </button>
        )}
        {scoreReview.pendingRows.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Commissioner override
            </p>
            <p className="mt-1 text-sm leading-5 text-amber-950">
              Use this only after the listed score evidence has been reviewed.
              Each score is still recorded as a commissioner override, not a player
              attestation.
            </p>
            <button
              type="button"
              onClick={overrideAllPendingAttestations}
              disabled={bulkAttestationSaving}
              className="mt-2 w-full rounded-xl bg-amber-900 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-950 disabled:bg-stone-200 disabled:text-stone-500"
            >
              {bulkAttestationSaving
                ? "Overriding..."
                : confirmingBulkAttestations
                  ? "Confirm all overrides"
                  : "Override all pending"}
            </button>
          </div>
        )}
        {bulkAttestationStatus && (
          <p className="mt-3 rounded-xl bg-fairway-50 px-3 py-2 text-sm font-semibold text-fairway-800">
            {bulkAttestationStatus}
          </p>
        )}
        {scoreReview.pendingRows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {scoreReview.pendingRows.map(({ teeTime, score, status }) => {
              const confirmKey = `${teeTime.id}:${score.name}`;
              return (
              <ScoreReviewRow
                key={`${teeTime.id}:${score.name}:pending`}
                date={teeTime.date}
                time={teeTime.time}
                course={teeTime.course}
                player={score.name}
                detail={`${
                  status === "legacy_unconfirmed" ? "Needs confirmation from" : "Waiting on"
                } ${score.attestedBy ?? "attester"} - net ${
                  score.courseHcp == null ? "-" : score.gross - score.courseHcp
                }`}
                actionLabel={
                  confirmingAttestationKey === confirmKey
                    ? "Confirm override"
                    : "Override attestation"
                }
                onAction={() => overrideAttestation(teeTime.id, score.name)}
              />
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-fairway-50 px-3 py-2 text-sm font-semibold text-fairway-800">
            No pending attestations.
          </p>
        )}
        {scoreReview.draftRows.length > 0 && (
          <div className="mt-2 space-y-2">
            {scoreReview.draftRows.map(({ teeTime, score }) => (
              <ScoreReviewRow
                key={`${teeTime.id}:${score.name}:draft`}
                date={teeTime.date}
                time={teeTime.time}
                course={teeTime.course}
                player={score.name}
                detail="Draft score still needs an attester."
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpenView("board")}
          className="mt-3 w-full rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200"
        >
          Open score cards
        </button>
      </section>

      <section
        id="admin-one-paste-updates"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start gap-3">
          <ClipboardPaste className="mt-0.5 h-5 w-5 shrink-0 text-fairway-700" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-900">
              One-Paste Updates
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Paste buy-in status, handicap-index evidence, or schedule replies and preview before applying.
            </p>
          </div>
        </div>
        <textarea
          value={intakeText}
          onChange={(event) => {
            setIntakeText(event.target.value);
            setIntakeStatus("");
            setIntakeConfirmed(false);
          }}
          rows={5}
          placeholder="Beck buy-in paid cash $325 2026-05-19&#10;Chris handicap index 11.4&#10;Championship: Fossil Trace 2026-10-10 to 2026-10-11"
          className="mt-3 w-full resize-none rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
        />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <MiniStat label="Buy-in" value={intake.payments.length} />
          <MiniStat label="Handicap" value={intake.handicaps.length} />
          <MiniStat label="Schedule" value={intake.schedules.length} />
        </div>
        {intakeCount > 0 && (
          <div className="mt-3 space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
            {intake.payments.map((item) => (
              <IntakePreviewRow
                key={`pay-${item.name}`}
                label={item.name}
                detail={`Buy-in status -> ${item.paymentStatus}${item.amount != null ? ` · $${item.amount}` : ""}${item.paymentMethod ? ` · ${item.paymentMethod}` : ""}${item.paidAt ? ` · ${item.paidAt}` : ""}`}
                source={item.source}
              />
            ))}
            {intake.handicaps.map((item) => (
              <IntakePreviewRow
                key={`hcp-${item.name}`}
                label={item.name}
                detail={`Roster -> index ${item.handicap}${item.ghinNumber ? ` · GHIN ${item.ghinNumber}` : " · source note only"}`}
                source={item.source}
              />
            ))}
            {intake.schedules.map((item) => (
              <IntakePreviewRow
                key={`schedule-${item.id}`}
                label={item.name}
                detail={`Schedule -> ${item.course} · ${item.windowStart}${item.windowEnd !== item.windowStart ? ` to ${item.windowEnd}` : ""}`}
                source={item.source}
              />
            ))}
            <label className="flex items-start gap-2 pt-1 text-xs font-semibold text-stone-700">
              <input
                type="checkbox"
                checked={intakeConfirmed}
                onChange={(event) => setIntakeConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-fairway-700 focus:ring-fairway-200"
              />
              Confirm these exact updates before applying
            </label>
          </div>
        )}
        <button
          type="button"
          disabled={intakeCount === 0 || applyingIntake || !intakeConfirmed}
          onClick={applyIntake}
          className="mt-3 w-full rounded-xl bg-fairway-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
        >
          {applyingIntake ? "Applying..." : `Apply ${intakeCount || ""} update${intakeCount === 1 ? "" : "s"}`}
        </button>
        {intakeStatus && (
          <p className="mt-2 rounded-xl bg-fairway-50 px-3 py-2 text-xs font-semibold text-fairway-800">
            {intakeStatus}
          </p>
        )}
      </section>

      <section
        id="admin-launch-access"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <h2 className="text-base font-semibold text-stone-900">Launch And Access</h2>
        <p className="mt-0.5 text-sm text-stone-500">
          Verify only what has actually been tested.
        </p>
        <ul className="mt-3 space-y-2">
          {launchCheckEvidence.map((check) => {
            const saving = savingLaunchKey === check.key;
            const noteDraft = launchNotes[check.key] ?? check.note ?? "";
            const noteError = check.verified
              ? null
              : launchCheckEvidenceNoteError(check.key, noteDraft);
            return (
              <li key={check.key} className="rounded-xl bg-stone-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900">
                      {check.label}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {check.verified
                        ? `Verified by ${check.verifiedBy ?? check.source}`
                        : `Needs proof. Env: ${check.envVar}`}
                    </p>
                  </div>
                  <StatusPill tone={check.verified ? "ok" : "warn"}>
                    {check.verified ? "done" : "open"}
                  </StatusPill>
                </div>
                <input
                  value={noteDraft}
                  onChange={(event) =>
                    setLaunchNotes((prev) => ({
                      ...prev,
                      [check.key]: event.target.value,
                    }))
                  }
                  placeholder="Evidence note"
                  aria-invalid={!!noteError}
                  className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                />
                {noteError && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">
                    {noteError}
                  </p>
                )}
                {check.key === "mobileSafariVerified" && !check.verified && (
                  isIphoneSafari() ? (
                    <button
                      type="button"
                      onClick={() => verifyMobileSafari(check)}
                      disabled={saving}
                      className="mt-2 w-full rounded-lg bg-fairway-700 px-3 py-2 text-xs font-semibold text-white ring-1 ring-fairway-800 hover:bg-fairway-800 disabled:bg-stone-200 disabled:text-stone-500"
                    >
                      Verify this iPhone Safari
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fillMobileSafariNote(check.key)}
                      className="mt-2 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                    >
                      Fill note with this URL
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={saving || check.source === "env" || (!check.verified && !!noteError)}
                  onClick={() => patchLaunch(check, !check.verified)}
                  className="mt-2 w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100 disabled:text-stone-400"
                >
                  {saving
                    ? "Saving..."
                    : check.verified
                      ? "Mark open"
                      : "Mark verified"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        id="admin-audit-log"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Audit Log</h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Recent commissioner and verification events.
            </p>
          </div>
          <StatusPill tone={auditExportError ? "warn" : "ok"}>
            {auditExport ? `${auditExport.count}` : auditExportError ? "error" : "load"}
          </StatusPill>
        </div>
        {auditExport?.events.length ? (
          <div className="mt-3 space-y-2">
            {auditExport.events.slice(0, 4).map((event) => (
              <div
                key={event.id}
                className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold text-stone-900">
                    {event.action}
                  </p>
                  <p className="shrink-0 text-right text-[11px] font-semibold text-stone-500">
                    {event.createdAt.slice(0, 10)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-stone-600">
                  {event.summary}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  {event.actor}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
            {auditExportError ? "Audit log unavailable." : "Loading audit log..."}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ExportLink href="/api/export/audit.json" label="Audit JSON" />
          <ExportLink href="/api/export/audit.csv" label="Audit CSV" />
        </div>
      </section>

      <section
        id="admin-exports"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <h2 className="text-base font-semibold text-stone-900">Exports</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ExportLink href="/api/export/season.json" label="Season JSON" />
          <ExportLink href="/api/export/rules.json" label="Rules JSON" />
          <ExportLink href="/api/export/tee-times.csv" label="Tee Times CSV" />
          <ExportLink href="/api/export/scores.csv" label="Scores CSV" />
          <ExportLink href="/api/export/attestations.csv" label="Attestations CSV" />
          <ExportLink href="/api/export/standings.csv" label="Standings CSV" />
          <ExportLink href="/api/export/roster.csv" label="Roster CSV" />
          <ExportLink href="/api/export/buyins.csv" label="Buy-ins CSV" />
          <ExportLink href="/api/export/payouts.csv" label="Payouts CSV" />
          {tournaments
            .filter((tournament) => tournament.type !== "post")
            .flatMap((tournament) => [
              <ExportLink
                key={`${tournament.id}-closeout-packet`}
                href={`/api/export/closeout/${encodeURIComponent(tournament.id)}.txt`}
                label={`${tournament.name} Packet`}
              />,
              <ExportLink
                key={`${tournament.id}-closeout-ledger`}
                href={`/api/export/closeout/${encodeURIComponent(tournament.id)}.json`}
                label={`${tournament.name} Ledger`}
              />,
            ])}
          <ExportLink href="/api/export/audit.json" label="Audit JSON" />
          <ExportLink href="/api/export/audit.csv" label="Audit CSV" />
          <ExportLink href="/api/export/tasks.json" label="Tasks JSON" />
          <ExportLink href="/api/export/tasks.csv" label="Tasks CSV" />
          <ExportLink href="/api/export/risks.json" label="Checklist JSON" />
          <ExportLink href="/api/export/risks.csv" label="Checklist CSV" />
          <ExportLink href="/api/export/request-packet.txt" label="Request Packet" />
          <ExportLink
            href="/api/export/commissioner-requests.json"
            label="Request List JSON"
          />
          <ExportLink
            href="/api/export/commissioner-requests.txt"
            label="Request List"
          />
          <ExportLink href="/api/export/evidence-gap-packet.json" label="Evidence Gap JSON" />
          <ExportLink href="/api/export/evidence-gap-packet.csv" label="Evidence Gap CSV" />
          <ExportLink href="/api/export/evidence-gap-packet.txt" label="Evidence Gap Packet" />
          <ExportLink href="/api/export/source-search-ledger.json" label="Source Ledger JSON" />
          <ExportLink href="/api/export/source-search-ledger.csv" label="Source Ledger CSV" />
          <ExportLink href="/api/export/verification-runs.json" label="Verification JSON" />
          <ExportLink href="/api/export/verification-runs.csv" label="Verification CSV" />
          <ExportLink href="/api/export/readiness.json" label="Readiness JSON" />
          <ExportLink href="/api/export/launch-checks.json" label="Launch Checks JSON" />
          <ExportLink href="/api/export/launch-checks.csv" label="Launch Checks CSV" />
          <ExportLink href="/api/export/launch-gate-checklist.json" label="Launch Checklist JSON" />
          <ExportLink href="/api/export/launch-gate-checklist.csv" label="Launch Checklist CSV" />
          <ExportLink href="/api/export/launch-gate-checklist.txt" label="Launch Checklist" />
          <ExportLink href="/api/export/launch-packet.txt" label="Launch Packet" />
          <ExportLink href="/api/export/completion-audit.json" label="Completion Audit" />
          <ExportLink href="/api/export/completion-audit.csv" label="Completion CSV" />
          <ExportLink href="/api/export/archive.json" label="Archive Manifest" />
          <ExportLink href="/api/export/database" label="Database Backup" />
        </div>
      </section>

      {advanced && (
        <section
          id="admin-full-workbench"
          className="scroll-mt-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200"
        >
          <div className="px-1 pb-3">
            <h2 className="text-base font-semibold text-stone-900">
              Full Operations
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Complete operations workbench retained here: settings, task queue,
              launch gates, schedule confirmation, rule audit, exports,
              closeout, payout ledger, and source evidence.
            </p>
          </div>
          {advanced}
        </section>
      )}
    </div>
  );
}

function RoleBoundary({ role, detail }: { role: string; detail: string }) {
  return (
    <div className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
      <div className="text-sm font-semibold text-stone-900">{role}</div>
      <div className="mt-0.5 text-xs leading-5 text-stone-600">{detail}</div>
    </div>
  );
}

function AdminMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 p-3">
      <Icon className="mb-1 h-4 w-4 text-stone-300" />
      <div className="text-xl font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-300">
        {label}
      </div>
    </div>
  );
}

function AdminActionButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: typeof WalletCards;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-200 disabled:text-stone-400"
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function AdminToolButton({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: typeof WalletCards;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-16 rounded-xl bg-stone-50 p-3 text-left ring-1 ring-stone-200 hover:bg-stone-100"
    >
      <Icon className="h-4 w-4 text-fairway-700" />
      <span className="mt-1 block text-sm font-semibold text-stone-900">
        {label}
      </span>
      <span className="block truncate text-xs text-stone-500">{detail}</span>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-stone-50 p-2 text-center">
      <div className="text-lg font-semibold text-stone-900">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </div>
    </div>
  );
}

function ScoreReviewRow({
  date,
  time,
  course,
  player,
  detail,
  actionLabel,
  onAction,
}: {
  date: string;
  time: string;
  course: string;
  player: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {player}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">{detail}</p>
        </div>
        <p className="shrink-0 text-right text-[11px] font-semibold text-stone-500">
          {formatDateLabel(date)}
          <br />
          {formatTimeLabel(time)}
        </p>
      </div>
      <p className="mt-1 truncate text-xs text-stone-500">{course}</p>
      {onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 w-full rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function TeeTimeOversightRow({
  teeTime,
  guestCount,
  missingScores,
  pendingAttestations,
  tournamentName,
}: {
  teeTime: TeeTime;
  guestCount: number;
  missingScores: boolean;
  pendingAttestations: number;
  tournamentName: string | null;
}) {
  const details = [
    teeTime.interested.length > 0
      ? `${teeTime.interested.length} maybe`
      : null,
    guestCount > 0 ? `${guestCount} guest${guestCount === 1 ? "" : "s"}` : null,
    missingScores ? "scores needed" : null,
    pendingAttestations > 0
      ? `${pendingAttestations} attestation${
          pendingAttestations === 1 ? "" : "s"
        }`
      : null,
  ].filter(Boolean);

  return (
    <div className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {teeTime.course}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            {teeTime.claims.length}/{teeTime.spots} committed
            {tournamentName ? ` · ${tournamentName}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-right text-[11px] font-semibold text-stone-500">
          {formatDateLabel(teeTime.date)}
          <br />
          {formatTimeLabel(teeTime.time)}
        </p>
      </div>
      <p className="mt-1 text-xs font-semibold text-amber-800">
        {details.join(" · ")}
      </p>
    </div>
  );
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

function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const className =
    tone === "ok"
      ? "bg-fairway-50 text-fairway-800"
      : tone === "danger"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-800";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={apiPath(href)}
      download
      className="inline-flex items-center justify-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-200"
    >
      <Download className="h-3.5 w-3.5" />
      {label}
      <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
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
