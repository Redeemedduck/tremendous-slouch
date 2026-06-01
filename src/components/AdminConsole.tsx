import { type ReactNode, useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  CheckCircle2,
  ClipboardPaste,
  Database,
  Download,
  ExternalLink,
  Settings,
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

export function AdminConsole({
  teeTimes,
  tournaments,
  players,
  buyins,
  onOpenView,
  onFixIssue,
  onAttestScore,
  onApplyUnifiedIntake,
  advanced,
}: {
  teeTimes: TeeTime[];
  tournaments: Tournament[];
  players: Player[];
  buyins: Buyin[];
  onOpenView: (view: AdminViewTarget) => void;
  onFixIssue: (issue: RuleIssue) => void;
  onAttestScore: (teeTimeId: string, playerName: string) => void | Promise<void>;
  onApplyUnifiedIntake: (text: string) => Promise<void>;
  advanced?: ReactNode;
}) {
  const [intakeText, setIntakeText] = useState("");
  const [intakeStatus, setIntakeStatus] = useState("");
  const [applyingIntake, setApplyingIntake] = useState(false);
  const [intakeConfirmed, setIntakeConfirmed] = useState(false);
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
            icon={WalletCards}
            label="Buy-ins open"
            value={String(unpaid.length)}
          />
        </div>
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
            icon={Trophy}
            label="Closeout"
            detail={activeTournament?.name ?? "season"}
            onClick={() => scrollToAdminSection("ops-tournament-closeout")}
          />
          <AdminToolButton
            icon={Download}
            label="Exports"
            detail="downloads"
            onClick={() => scrollToLocalSection("admin-exports")}
          />
        </div>
      </section>

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
              Score Review
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Posted scores stay editable. Commissioner can confirm or correct
              anything here.
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
              Commissioner confirm
            </p>
            <p className="mt-1 text-sm leading-5 text-amber-950">
              Use this when the score is good enough for league standings.
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
        id="admin-exports"
        className="scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200"
      >
        <h2 className="text-base font-semibold text-stone-900">Exports</h2>
        <p className="mt-0.5 text-sm text-stone-500">
          The files a commissioner needs. The full set is under Full Operations.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ExportLink href="/api/export/season.json" label="Season JSON" />
          <ExportLink href="/api/export/standings.csv" label="Standings CSV" />
          <ExportLink href="/api/export/roster.csv" label="Roster CSV" />
          <ExportLink href="/api/export/buyins.csv" label="Buy-ins CSV" />
          <ExportLink href="/api/export/payouts.csv" label="Payouts CSV" />
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
