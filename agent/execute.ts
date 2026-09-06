// ============================================================
// Text-the-Board agent — action executor.
// Turns a validated ParsedAction into calls against the app's own REST API.
// Resolution is deterministic: 0 or 2+ matches always produce a member-
// readable clarification reply, never a guess.
// ============================================================

import type {
  CommittedFacts,
  ExecuteResult,
  ParsedAction,
  TeeTimeRef,
  UndoSpec,
} from "./types";
import {
  ApiError,
  deleteClaim,
  deleteScore,
  deleteTeeTime,
  getPolls,
  getTeeTimes,
  postClaim,
  postScore,
  postTeeTime,
  togglePollResponse,
} from "./api";
import type { TeeTime } from "../src/lib/types";
import {
  eqName,
  formatDateLabel,
  formatTimeLabel,
  todayISO,
} from "../src/lib/format";

type CreateAction = Extract<ParsedAction, { kind: "create_tee_time" }>;
type CastVoteAction = Extract<ParsedAction, { kind: "cast_vote" }>;
type RecordScoreAction = Extract<ParsedAction, { kind: "record_score" }>;

export type ScoreTargetResult =
  | { ok: true; teeTimeId: string; course: string; date: string }
  | { ok: false; reply: string };

export type UndoResult = { ok: boolean; summary: string };

// ---------- reference resolution ----------

const matchesRef = (t: TeeTime, ref: TeeTimeRef): boolean => {
  if (ref.course && !t.course.toLowerCase().includes(ref.course.toLowerCase())) {
    return false;
  }
  if (ref.date && t.date !== ref.date) return false;
  if (ref.time && t.time !== ref.time) return false;
  return true;
};

const describeRef = (ref: TeeTimeRef): string => {
  const parts: string[] = [];
  if (ref.course) parts.push(ref.course);
  if (ref.date) parts.push(formatDateLabel(ref.date));
  if (ref.time) parts.push(formatTimeLabel(ref.time));
  return parts.length > 0 ? parts.join(" ") : "that";
};

const teeLabel = (t: Pick<TeeTime, "course" | "date" | "time">): string =>
  `${t.course} ${formatDateLabel(t.date)} ${formatTimeLabel(t.time)}`;

const listCandidates = (question: string, candidates: TeeTime[]): string =>
  `${question} ${candidates
    .map((t, i) => `${i + 1}) ${teeLabel(t)}`)
    .join(" ")}`;

const hasClaim = (t: TeeTime, name: string): boolean =>
  t.claims.some((c) => eqName(c.name, name));

const hasScore = (t: TeeTime, name: string): boolean =>
  t.scores.some((s) => eqName(s.name, name));

type TeeResolution =
  | { ok: true; teeTime: TeeTime }
  | { ok: false; reply: string };

/** Resolve a TeeTimeRef against today-or-later tee times. For drops, only
 *  tee times where the sender actually holds a claim are candidates. */
const resolveUpcoming = async (
  ref: TeeTimeRef,
  senderName: string,
  opts: { requireOwnClaim: boolean }
): Promise<TeeResolution> => {
  const teeTimes = await getTeeTimes();
  const today = todayISO();
  const candidates = teeTimes.filter(
    (t) =>
      t.date >= today &&
      matchesRef(t, ref) &&
      (!opts.requireOwnClaim || hasClaim(t, senderName))
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reply: `Couldn't find that tee time — nothing matching ${describeRef(ref)} on the sheet.`,
    };
  }
  if (candidates.length > 1) {
    return { ok: false, reply: listCandidates("Which one?", candidates) };
  }
  return { ok: true, teeTime: candidates[0] };
};

/** API errors carry member-readable messages — surface them as the reply. */
const apiFailure = (err: unknown): ExecuteResult => {
  if (err instanceof ApiError) return { ok: false, reply: err.message };
  throw err;
};

// ---------- executeParsed ----------

export async function executeParsed(
  action: ParsedAction,
  senderName: string
): Promise<ExecuteResult> {
  switch (action.kind) {
    case "create_tee_time":
      return executeCreate(action, senderName);
    case "claim_spot":
      return executeClaim(action.ref, senderName);
    case "drop_spot":
      return executeDrop(action.ref, senderName);
    case "cast_vote":
      return executeVote(action, senderName);
    default:
      throw new Error(
        `executeParsed can't handle "${action.kind}" — record_score goes through resolveScoreTarget/executeScore`
      );
  }
}

const executeCreate = async (
  action: CreateAction,
  senderName: string
): Promise<ExecuteResult> => {
  try {
    const teeTime = await postTeeTime({
      course: action.course,
      date: action.date,
      time: action.time,
      spots: action.spots,
      notes: action.notes,
      host: senderName, // the API auto-claims the host
    });
    const committed: CommittedFacts = {
      kind: "create_tee_time",
      course: teeTime.course,
      date: teeTime.date,
      time: teeTime.time,
      spots: teeTime.spots,
      teeTimeId: teeTime.id,
    };
    return {
      ok: true,
      committed,
      undo: { kind: "delete_tee_time", teeTimeId: teeTime.id },
    };
  } catch (err) {
    return apiFailure(err);
  }
};

const executeClaim = async (
  ref: TeeTimeRef,
  senderName: string
): Promise<ExecuteResult> => {
  const resolved = await resolveUpcoming(ref, senderName, {
    requireOwnClaim: false,
  });
  // `=== false` (not `!`) so the union narrows without strictNullChecks.
  if (resolved.ok === false) return { ok: false, reply: resolved.reply };
  try {
    const updated = await postClaim(resolved.teeTime.id, senderName);
    const open = Math.max(0, updated.spots - updated.claims.length);
    const committed: CommittedFacts = {
      kind: "claim_spot",
      course: updated.course,
      date: updated.date,
      time: updated.time,
      open,
      teeTimeId: updated.id,
    };
    return {
      ok: true,
      committed,
      undo: {
        kind: "drop_claim",
        teeTimeId: updated.id,
        playerName: senderName,
      },
    };
  } catch (err) {
    return apiFailure(err);
  }
};

const executeDrop = async (
  ref: TeeTimeRef,
  senderName: string
): Promise<ExecuteResult> => {
  const resolved = await resolveUpcoming(ref, senderName, {
    requireOwnClaim: true,
  });
  if (resolved.ok === false) return { ok: false, reply: resolved.reply };
  try {
    const updated = await deleteClaim(resolved.teeTime.id, senderName);
    const committed: CommittedFacts = {
      kind: "drop_spot",
      course: updated.course,
      date: updated.date,
      time: updated.time,
      teeTimeId: updated.id,
    };
    return {
      ok: true,
      committed,
      undo: {
        kind: "restore_claim",
        teeTimeId: updated.id,
        playerName: senderName,
      },
    };
  } catch (err) {
    return apiFailure(err);
  }
};

const executeVote = async (
  action: CastVoteAction,
  senderName: string
): Promise<ExecuteResult> => {
  // Polls have no closed/archived state in the schema, so every poll on the
  // board counts as open.
  const polls = await getPolls();
  if (polls.length === 0) {
    return { ok: false, reply: "No open polls right now." };
  }
  const hint = action.pollHint?.trim().toLowerCase() ?? "";
  const matched = hint
    ? polls.filter((p) => p.prompt.toLowerCase().includes(hint))
    : polls;
  if (matched.length === 0) {
    return {
      ok: false,
      reply: `Couldn't find a poll matching "${action.pollHint}". Open polls: ${polls
        .map((p) => p.prompt)
        .join(" / ")}`,
    };
  }
  if (matched.length > 1) {
    return {
      ok: false,
      reply: `Which poll? ${matched
        .map((p, i) => `${i + 1}) ${p.prompt}`)
        .join(" ")}`,
    };
  }
  const poll = matched[0];
  const optionNeedle = action.optionText.trim().toLowerCase();
  const optionMatches = poll.options
    .map((text, idx) => ({ text, idx }))
    .filter((o) => o.text.toLowerCase().includes(optionNeedle));
  if (optionMatches.length !== 1) {
    const lead =
      optionMatches.length === 0 ? "Couldn't match that option." : "Which option?";
    return {
      ok: false,
      reply: `${lead} Options for "${poll.prompt}": ${poll.options.join(" / ")}`,
    };
  }
  const optionIdx = optionMatches[0].idx;
  const committed: CommittedFacts = {
    kind: "cast_vote",
    pollPrompt: poll.prompt,
    optionText: poll.options[optionIdx],
    pollId: poll.id,
    optionIdx,
  };
  const undo: UndoSpec = {
    kind: "remove_vote",
    pollId: poll.id,
    playerName: senderName,
    optionIdx,
  };
  // Toggle semantics: the endpoint would REMOVE an existing identical vote.
  // Re-voting the same option must stay a vote, so skip the call (idempotent).
  const alreadyVoted = poll.responses.some(
    (r) => eqName(r.name, senderName) && r.optionIdx === optionIdx
  );
  if (alreadyVoted) return { ok: true, committed, undo };
  try {
    await togglePollResponse(poll.id, senderName, optionIdx);
    return { ok: true, committed, undo };
  } catch (err) {
    return apiFailure(err);
  }
};

// ---------- record_score (YES-gated, two-phase) ----------

export async function resolveScoreTarget(
  action: RecordScoreAction,
  senderName: string
): Promise<ScoreTargetResult> {
  const teeTimes = await getTeeTimes();
  const today = todayISO();
  const candidates = teeTimes
    .filter(
      (t) =>
        t.date <= today &&
        hasClaim(t, senderName) &&
        !hasScore(t, senderName) &&
        matchesRef(t, action.ref)
    )
    .sort((a, b) =>
      a.date === b.date
        ? b.time.localeCompare(a.time)
        : b.date.localeCompare(a.date)
    ); // most recent first
  if (candidates.length === 1) {
    const t = candidates[0];
    return { ok: true, teeTimeId: t.id, course: t.course, date: t.date };
  }
  if (candidates.length === 0) {
    const gaveDetails = Boolean(
      action.ref.course || action.ref.date || action.ref.time
    );
    return {
      ok: false,
      reply: gaveDetails
        ? `Nothing needs a score — no past round matching ${describeRef(action.ref)} where you're on the sheet without a score.`
        : "Nothing needs a score — I don't see a past round you played that's missing your score.",
    };
  }
  return { ok: false, reply: listCandidates("Which round?", candidates) };
}

export async function executeScore(
  action: RecordScoreAction,
  teeTimeId: string,
  senderName: string
): Promise<ExecuteResult> {
  try {
    const updated = await postScore(teeTimeId, {
      name: senderName,
      gross: action.gross,
      courseHcp: action.courseHcp,
      attestedBy: action.attestedBy,
    });
    const net =
      action.courseHcp != null ? action.gross - action.courseHcp : null;
    const committed: CommittedFacts = {
      kind: "record_score",
      course: updated.course,
      date: updated.date,
      gross: action.gross,
      net,
      attestedBy: action.attestedBy,
      teeTimeId: updated.id,
    };
    return {
      ok: true,
      committed,
      undo: {
        kind: "remove_score",
        teeTimeId: updated.id,
        playerName: senderName,
      },
    };
  } catch (err) {
    return apiFailure(err);
  }
}

// ---------- undo ----------

/** 404s mean the record already vanished — that's a satisfied undo. Other
 *  API errors surface as failures with the server's message. */
const undoApiFailure = (err: unknown): UndoResult => {
  if (err instanceof ApiError && err.status === 404) {
    return { ok: true, summary: "Already gone." };
  }
  if (err instanceof ApiError) return { ok: false, summary: err.message };
  throw err;
};

export async function executeUndo(spec: UndoSpec): Promise<UndoResult> {
  switch (spec.kind) {
    case "delete_tee_time":
      return undoCreate(spec.teeTimeId);
    case "drop_claim":
      return undoClaim(spec.teeTimeId, spec.playerName);
    case "restore_claim":
      return undoDrop(spec.teeTimeId, spec.playerName);
    case "remove_score":
      return undoScore(spec.teeTimeId, spec.playerName);
    case "remove_vote":
      return undoVote(spec.pollId, spec.playerName, spec.optionIdx);
  }
}

const undoCreate = async (teeTimeId: string): Promise<UndoResult> => {
  const teeTimes = await getTeeTimes();
  const target = teeTimes.find((t) => t.id === teeTimeId);
  if (!target) return { ok: true, summary: "Already gone." };
  try {
    await deleteTeeTime(teeTimeId);
    return { ok: true, summary: `Removed the ${target.course} tee time.` };
  } catch (err) {
    return undoApiFailure(err);
  }
};

const undoClaim = async (
  teeTimeId: string,
  playerName: string
): Promise<UndoResult> => {
  try {
    const updated = await deleteClaim(teeTimeId, playerName);
    return {
      ok: true,
      summary: `Took ${playerName} off the ${updated.course} tee time.`,
    };
  } catch (err) {
    return undoApiFailure(err);
  }
};

const undoDrop = async (
  teeTimeId: string,
  playerName: string
): Promise<UndoResult> => {
  try {
    const updated = await postClaim(teeTimeId, playerName);
    return {
      ok: true,
      summary: `Put ${playerName} back on the ${updated.course} tee time.`,
    };
  } catch (err) {
    // Already re-claimed (e.g. undo retried) — the desired state holds.
    if (
      err instanceof ApiError &&
      err.status === 409 &&
      /already has a spot/i.test(err.message)
    ) {
      return { ok: true, summary: `${playerName} is already back on.` };
    }
    return undoApiFailure(err);
  }
};

const undoScore = async (
  teeTimeId: string,
  playerName: string
): Promise<UndoResult> => {
  try {
    const updated = await deleteScore(teeTimeId, playerName);
    return {
      ok: true,
      summary: `Removed ${playerName}'s score from the ${updated.course} round.`,
    };
  } catch (err) {
    return undoApiFailure(err);
  }
};

const undoVote = async (
  pollId: string,
  playerName: string,
  optionIdx: number
): Promise<UndoResult> => {
  const polls = await getPolls();
  const poll = polls.find((p) => p.id === pollId);
  if (!poll) return { ok: true, summary: "Already gone." };
  // Toggle semantics: only call the endpoint when the vote is actually
  // present, otherwise the "undo" would CAST a vote.
  const present = poll.responses.some(
    (r) => eqName(r.name, playerName) && r.optionIdx === optionIdx
  );
  if (!present) return { ok: true, summary: "That vote is already gone." };
  try {
    await togglePollResponse(pollId, playerName, optionIdx);
    const option = poll.options[optionIdx] ?? `option ${optionIdx + 1}`;
    return {
      ok: true,
      summary: `Removed ${playerName}'s vote for ${option}.`,
    };
  } catch (err) {
    return undoApiFailure(err);
  }
};
