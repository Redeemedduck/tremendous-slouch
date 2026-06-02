import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import type { TeeTime } from "../lib/types";
import type { Player } from "../lib/types";
import { formatDateLabel, formatTimeLabel } from "../lib/format";
import { hasSourceBackedHandicap } from "../lib/handicapEvidence";
import {
  calculateRoundedCourseHandicap,
  fillScoreDraftCourseHandicaps,
  fillScoreDraftAttesters,
  parseScoreSummaryIntake,
  validateScoreDrafts,
  type ScoreDraft,
} from "../lib/scoreDrafts";
import type { ScoreHandicapEvidenceInput } from "../hooks/useTeeTimes";

export function ScoresSheet({
  open,
  onClose,
  teeTime,
  onRecord,
  onRemoveScore,
  canDeleteScores = false,
  isLeagueRound,
  isMember,
  getHandicap,
  getPlayer,
}: {
  open: boolean;
  onClose: () => void;
  teeTime: TeeTime | null;
  onRecord: (
    name: string,
    gross: number,
    courseHcp: number | null,
    attestedBy: string | null,
    handicapEvidence?: ScoreHandicapEvidenceInput
  ) => Promise<void>;
  onRemoveScore?: (name: string) => Promise<void> | void;
  canDeleteScores?: boolean;
  /** True when this tee time falls inside a tournament window. */
  isLeagueRound: boolean;
  /** Whether a given name is a registered league member. */
  isMember: (name: string) => boolean;
  getHandicap: (name: string) => number | null;
  getPlayer: (name: string) => Player | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [summaryStatus, setSummaryStatus] = useState("");
  const [bulkAttester, setBulkAttester] = useState("");
  const [attesterStatus, setAttesterStatus] = useState("");
  const [teeName, setTeeName] = useState("");
  const [teeRating, setTeeRating] = useState("");
  const [teeSlope, setTeeSlope] = useState("");
  const [teePar, setTeePar] = useState("");
  const [handicapStatus, setHandicapStatus] = useState("");
  const [confirmingDeleteName, setConfirmingDeleteName] = useState<string | null>(
    null
  );
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!open || !teeTime) return;
    // Prefill from existing scores so edits are easy.
    const prefill: Record<string, ScoreDraft> = {};
    for (const c of teeTime.claims) {
      const s = teeTime.scores.find(
        (x) => x.name.toLowerCase() === c.name.toLowerCase()
      );
      prefill[c.name] = {
        gross: s ? String(s.gross) : "",
        courseHcp: s?.courseHcp != null ? String(s.courseHcp) : "",
        attestedBy: s?.attestedBy ?? "",
      };
    }
    setDrafts(prefill);
    setError(null);
    setSummaryText("");
    setSummaryStatus("");
    setBulkAttester("");
    setAttesterStatus("");
    setHandicapStatus("");
    setConfirmingDeleteName(null);
    const evidenceScore = teeTime.scores.find(
      (score) =>
        score.teeName ||
        score.teeRating != null ||
        score.teeSlope != null ||
        score.teePar != null
    );
    setTeeName(evidenceScore?.teeName ?? "");
    setTeeRating(
      evidenceScore?.teeRating == null ? "" : String(evidenceScore.teeRating)
    );
    setTeeSlope(
      evidenceScore?.teeSlope == null ? "" : String(evidenceScore.teeSlope)
    );
    setTeePar(evidenceScore?.teePar == null ? "" : String(evidenceScore.teePar));
  }, [open, teeTime]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !teeTime) return null;

  const scoreSummaryMatches = parseScoreSummaryIntake(
    summaryText,
    teeTime.claims.map((claim) => claim.name)
  );
  const claimNames = teeTime.claims.map((claim) => claim.name);
  const bulkAttesterOptions = claimNames.filter((name) => isMember(name));
  const teeRatingNumber = teeRating.trim() ? Number(teeRating) : null;
  const teeSlopeNumber = teeSlope.trim() ? Number(teeSlope) : null;
  const teeParNumber = teePar.trim() ? Number(teePar) : null;
  const hasFullTeeInputs =
    teeRatingNumber != null &&
    Number.isFinite(teeRatingNumber) &&
    teeSlopeNumber != null &&
    Number.isFinite(teeSlopeNumber) &&
    teeParNumber != null &&
    Number.isFinite(teeParNumber);
  const calculatedCourseHcpFor = (name: string) => {
    const handicapIndex = getHandicap(name);
    if (handicapIndex == null || !hasFullTeeInputs) return null;
    return calculateRoundedCourseHandicap({
      handicapIndex,
      teeRating: teeRatingNumber,
      teeSlope: teeSlopeNumber,
      teePar: teeParNumber,
    });
  };
  const handicapSourceFor = (name: string) => {
    const player = getPlayer(name);
    if (!player || !hasSourceBackedHandicap(player)) return "unverified";
    return player.handicapSourceType === "ghin" ? "ghin" : "source-backed";
  };
  const draftsFromForm = () => {
    const form = formRef.current;
    if (!form) return drafts;
    const next: Record<string, ScoreDraft> = {};
    const scoreControls = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "[data-score-name][data-score-field]"
      )
    );
    for (const name of claimNames) {
      const existing = drafts[name] ?? { gross: "", courseHcp: "", attestedBy: "" };
      const findControl = (field: string) =>
        scoreControls.find(
          (control) =>
            control.dataset.scoreName === name &&
            control.dataset.scoreField === field
        );
      const gross = findControl("gross") as HTMLInputElement | undefined;
      const courseHcp = findControl("courseHcp") as HTMLInputElement | undefined;
      const attestedBy = findControl("attestedBy") as HTMLSelectElement | undefined;
      next[name] = {
        gross: gross?.value ?? existing.gross,
        courseHcp: courseHcp?.value ?? existing.courseHcp,
        attestedBy: attestedBy?.value ?? existing.attestedBy,
      };
    }
    return next;
  };
  const applyCourseHandicaps = () => {
    const liveDrafts = draftsFromForm();
    let result = fillScoreDraftCourseHandicaps(liveDrafts, {
      claimNames,
      teeInputs: {
        teeRating: teeRatingNumber,
        teeSlope: teeSlopeNumber,
        teePar: teeParNumber,
      },
      isMember,
      getHandicap,
    });
    if (result.error) {
      setHandicapStatus(result.error);
      return;
    }
    setDrafts((prev) => {
      result = fillScoreDraftCourseHandicaps(draftsFromForm() ?? prev, {
        claimNames,
        teeInputs: {
          teeRating: teeRatingNumber,
          teeSlope: teeSlopeNumber,
          teePar: teeParNumber,
        },
        isMember,
        getHandicap,
      });
      return result.error ? prev : result.drafts;
    });
    const overwritten =
      result.overwrittenManual > 0
        ? ` Replaced ${result.overwrittenManual} manual value${
            result.overwrittenManual === 1 ? "" : "s"
          }.`
        : "";
    const preserved =
      result.preservedManual > 0
        ? ` Preserved ${result.preservedManual} manual value${
            result.preservedManual === 1 ? "" : "s"
          } without Handicap Index.`
        : "";
    const missing =
      result.missingIndexes.length > 0
        ? ` Missing Handicap Index: ${result.missingIndexes.join(", ")}.`
        : "";
    setHandicapStatus(
      `Filled ${result.filled} course HCP${
        result.filled === 1 ? "" : "s"
      }.${overwritten}${preserved}${missing}`
    );
  };
  const autoFillBlankCourseHandicaps = (
    nextRating: string,
    nextSlope: string,
    nextPar: string
  ) => {
    const rating = nextRating.trim() ? Number(nextRating) : null;
    const slope = nextSlope.trim() ? Number(nextSlope) : null;
    const par = nextPar.trim() ? Number(nextPar) : null;
    if (
      rating == null ||
      slope == null ||
      par == null ||
      !Number.isFinite(rating) ||
      !Number.isFinite(slope) ||
      !Number.isFinite(par)
    ) {
      return;
    }
    const result = fillScoreDraftCourseHandicaps(draftsFromForm(), {
      claimNames,
      teeInputs: {
        teeRating: rating,
        teeSlope: slope,
        teePar: par,
      },
      isMember,
      getHandicap,
    });
    if (result.error || result.filled === 0) return;
    setDrafts(result.drafts);
    setHandicapStatus(
      `Auto-filled ${result.filled} blank course HCP${
        result.filled === 1 ? "" : "s"
      } from roster Handicap Index.`
    );
  };
  const applyScoreSummary = () => {
    if (scoreSummaryMatches.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const match of scoreSummaryMatches) {
        const existing = next[match.name] ?? {
          gross: "",
          courseHcp: "",
          attestedBy: "",
        };
        next[match.name] = {
          ...existing,
          gross: String(match.gross),
          courseHcp:
            match.courseHcp == null
              ? existing.courseHcp
              : String(match.courseHcp),
        };
      }
      return next;
    });
    setSummaryStatus(
      `Filled ${scoreSummaryMatches.length} score draft${
        scoreSummaryMatches.length === 1 ? "" : "s"
      }.`
    );
    setSummaryText("");
  };
  const applyBulkAttesters = () => {
    const result = fillScoreDraftAttesters(drafts, {
      claimNames,
      attester: bulkAttester,
      isMember,
    });
    if (result.error) {
      setAttesterStatus(result.error);
      return;
    }
    setDrafts(result.drafts);
    const suffix = result.skippedSelf > 0 ? " Self-attestation skipped." : "";
    setAttesterStatus(
      `Filled ${result.filled} attester${result.filled === 1 ? "" : "s"}.${suffix}`
    );
  };

  const removeExistingScore = async (name: string) => {
    if (!onRemoveScore) return;
    if (confirmingDeleteName !== name) {
      setConfirmingDeleteName(name);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRemoveScore(name);
      setDrafts((prev) => ({
        ...prev,
        [name]: { gross: "", courseHcp: "", attestedBy: "" },
      }));
      setConfirmingDeleteName(null);
    } catch (err: any) {
      setError(err?.message || "Couldn't delete score");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = validateScoreDrafts(drafts, { isLeagueRound, isMember });
    if (result.ok === false) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    try {
      for (const task of result.tasks) {
        const handicapIndexUsed = getHandicap(task.name);
        const calculatedCourseHcp = calculatedCourseHcpFor(task.name);
        const handicapSource = handicapSourceFor(task.name);
        await onRecord(
          task.name,
          task.gross,
          task.courseHcp,
          task.attestedBy,
          {
            teeName: teeName.trim() || null,
            teeRating: teeRatingNumber,
            teeSlope: teeSlopeNumber,
            teePar: teeParNumber,
            handicapIndexUsed,
            courseHcpSource:
              task.courseHcp != null && calculatedCourseHcp === task.courseHcp
                ? handicapSource === "ghin"
                  ? "ghin"
                  : handicapSource === "source-backed"
                    ? "calculated"
                    : "calculated_unverified"
                : task.courseHcp == null
                  ? undefined
                  : "manual_unverified",
          }
        );
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't save scores");
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
      <div className="absolute bottom-0 left-0 right-0 mx-auto max-h-[calc(100dvh-1rem)] max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">
            Record scores
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
                      </div>
        <p className="mb-4 text-sm text-stone-500">
          {teeTime.course} · {formatDateLabel(teeTime.date)} ·{" "}
          {formatTimeLabel(teeTime.time)}
        </p>

        <form ref={formRef} onSubmit={submit} className="space-y-3">
          {teeTime.claims.length === 0 ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
              No one was claimed for this round.
            </p>
          ) : (
            <>
              <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Tee
                    </span>
                    <input
                      value={teeName}
                      onChange={(event) => setTeeName(event.target.value)}
                      placeholder="Blue / White"
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Rating
                    </span>
                    <input
                      inputMode="decimal"
                      value={teeRating}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTeeRating(value);
                        autoFillBlankCourseHandicaps(value, teeSlope, teePar);
                      }}
                      placeholder="70.1"
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Slope
                    </span>
                    <input
                      inputMode="numeric"
                      value={teeSlope}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTeeSlope(value);
                        autoFillBlankCourseHandicaps(teeRating, value, teePar);
                      }}
                      placeholder="125"
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Par
                    </span>
                    <input
                      inputMode="numeric"
                      value={teePar}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTeePar(value);
                        autoFillBlankCourseHandicaps(teeRating, teeSlope, value);
                      }}
                      placeholder="72"
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm tabular-nums text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="min-w-0 text-xs text-stone-500">
                    Auto-fills blank member rows from roster Handicap Index;
                    manual Course HCP values stay untouched.
                  </p>
                  <button
                    type="button"
                    onClick={applyCourseHandicaps}
                    className="shrink-0 rounded-full bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700"
                  >
                    Fill blank HCPs
                  </button>
                </div>
                {handicapStatus && (
                  <p className="mt-2 text-xs font-medium text-fairway-800">
                    {handicapStatus}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-fairway-50 p-3 ring-1 ring-fairway-100">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-fairway-900">
                  Paste score summary
                  <textarea
                    value={summaryText}
                    onChange={(event) => {
                      setSummaryText(event.target.value);
                      setSummaryStatus("");
                    }}
                    placeholder="Jayson: 82 (70)&#10;Jonny: 80 (73)"
                    rows={3}
                    className="mt-1 w-full resize-none rounded-xl border border-fairway-100 bg-white px-3 py-2 text-xs normal-case tracking-normal text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                  />
                </label>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-fairway-900">
                    {scoreSummaryMatches.length > 0
                      ? `${scoreSummaryMatches.length} matched: ${scoreSummaryMatches
                          .map((match) => match.name)
                          .join(", ")}`
                      : summaryText.trim()
                        ? "No claimed players matched yet."
                        : "Fills gross and course HCP; attesters stay explicit."}
                  </span>
                  <button
                    type="button"
                    disabled={scoreSummaryMatches.length === 0}
                    onClick={applyScoreSummary}
                    className="shrink-0 rounded-full bg-fairway-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    {`Fill ${scoreSummaryMatches.length || ""}`.trim()}
                  </button>
                </div>
                {summaryStatus && (
                  <p className="mt-1 text-xs font-medium text-fairway-800">
                    {summaryStatus}
                  </p>
                )}
              </div>
              {isLeagueRound && bulkAttesterOptions.length > 1 && (
                <div className="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <label className="space-y-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                        Bulk attester
                      </span>
                      <select
                        value={bulkAttester}
                        onChange={(event) => {
                          setBulkAttester(event.target.value);
                          setAttesterStatus("");
                        }}
                        aria-label="Bulk attester"
                        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      >
                        <option value="">Choose attester…</option>
                        {bulkAttesterOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={!bulkAttester}
                      onClick={applyBulkAttesters}
                      className="rounded-full bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700 disabled:bg-stone-100 disabled:text-stone-400"
                    >
                      Fill attesters
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    Applies to scored member rows only; existing attesters stay
                    untouched.
                  </p>
                  {attesterStatus && (
                    <p className="mt-1 text-xs font-medium text-fairway-800">
                      {attesterStatus}
                    </p>
                  )}
                </div>
              )}
              {teeTime.claims.map((c) => {
                const existingScore = teeTime.scores.find(
                  (score) => score.name.toLowerCase() === c.name.toLowerCase()
                );
                const scorerIsMember = isMember(c.name);
                const draft =
                  drafts[c.name] ?? { gross: "", courseHcp: "", attestedBy: "" };
                const handicapIndex = getHandicap(c.name);
                const handicapSource = handicapSourceFor(c.name);
                const calculatedCourseHcp = calculatedCourseHcpFor(c.name);
                // Attester options: other claimers who are registered members.
                const attesters = teeTime.claims
                  .filter(
                    (other) =>
                      other.name.trim().toLowerCase() !==
                        c.name.trim().toLowerCase() && isMember(other.name)
                  )
                  .map((other) => other.name);
                const grossStr = draft.gross.trim();
                const hcpStr = draft.courseHcp.trim();
                const gross = Number(grossStr);
                const hcp = Number(hcpStr);
                const hasManualOverride =
                  isLeagueRound &&
                  scorerIsMember &&
                  calculatedCourseHcp != null &&
                  hcpStr !== "" &&
                  Number.isInteger(hcp) &&
                  hcp !== calculatedCourseHcp;
                const net =
                  grossStr !== "" &&
                  hcpStr !== "" &&
                  Number.isInteger(gross) &&
                  Number.isInteger(hcp)
                    ? gross - hcp
                    : null;
                return (
                  <div
                    key={c.name}
                    className="space-y-3 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <label className="text-base font-semibold text-stone-900">
                          {c.name}
                        </label>
                        {isLeagueRound && !scorerIsMember && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            guest - league score blocked
                          </p>
                        )}
                        {isLeagueRound && scorerIsMember && (
                          <p className="mt-1 text-[11px] text-stone-500">
                            {handicapIndex == null
                              ? "No roster H.I."
                              : hasManualOverride
                                ? `Manual CH ${hcp}; calc ${calculatedCourseHcp} from H.I. ${handicapIndex}`
                                : calculatedCourseHcp == null
                                ? `H.I. ${handicapIndex} (${handicapSource})`
                                : `H.I. ${handicapIndex} -> CH ${calculatedCourseHcp}`}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">
                          {net == null ? "Net -" : `Net ${net}`}
                        </span>
                        {canDeleteScores && existingScore && onRemoveScore && (
                          <button
                            type="button"
                            onClick={() => void removeExistingScore(c.name)}
                            disabled={submitting}
                            aria-label={`Delete ${c.name} score`}
                            title={
                              confirmingDeleteName === c.name
                                ? "Tap again to delete"
                                : "Delete score"
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ${
                              confirmingDeleteName === c.name
                                ? "bg-rose-600 text-white ring-rose-700"
                                : "bg-white text-rose-700 ring-rose-100 hover:bg-rose-50"
                            } disabled:bg-stone-100 disabled:text-stone-400 disabled:ring-stone-200`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {confirmingDeleteName === c.name && (
                      <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                        Tap delete again to permanently remove this score.
                      </p>
                    )}
                    {isLeagueRound && !scorerIsMember && (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Mark this player as a member in Roster before recording
                        a league score, or leave them unscored as a guest.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                          Gross
                        </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        data-score-name={c.name}
                        data-score-field="gross"
                        value={draft.gross}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [c.name]: { ...draft, gross: e.target.value },
                          }))
                        }
                        step={1}
                        min={1}
                        max={300}
                        placeholder="-"
                        aria-label={`${c.name} gross score`}
                          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-lg font-semibold tabular-nums focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                          Course HCP
                        </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        data-score-name={c.name}
                        data-score-field="courseHcp"
                        value={draft.courseHcp}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [c.name]: { ...draft, courseHcp: e.target.value },
                          }))
                        }
                        step={1}
                        min={-10}
                        max={54}
                        placeholder={isLeagueRound ? "req" : "-"}
                        aria-label={`${c.name} course handicap`}
                          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-lg font-semibold tabular-nums focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                      </label>
                    </div>
                    {isLeagueRound && (
                      <div>
                        {attesters.length > 0 ? (
                          <label className="space-y-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                              Attester
                            </span>
                          <select
                            data-score-name={c.name}
                            data-score-field="attestedBy"
                            value={draft.attestedBy}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [c.name]: {
                                  ...draft,
                                  attestedBy: e.target.value,
                                },
                              }))
                            }
                            aria-label={`${c.name} attested by`}
                              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-base text-stone-700 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                          >
                            <option value="">Attested by…</option>
                            {attesters.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                          </label>
                        ) : (
                          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            No other members on this tee time — score can't be
                            attested.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {isLeagueRound && (
                <p className="text-xs text-stone-500">
                  League round — each player needs a course handicap (from
                  GHIN) and an attester (another member who played in your
                  group).
                </p>
              )}
            </>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-3 backdrop-blur">
            <button
              type="submit"
              disabled={submitting || teeTime.claims.length === 0}
              className="w-full rounded-xl bg-fairway-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-fairway-700 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save scores"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
