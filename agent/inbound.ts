// ============================================================
// Text-the-Board agent — inbound orchestrator.
//
// createInboundHandler(deps) wires the store, parser, executor and
// renderer (all dependency-injected) into the single function the
// webhook calls per message. Flow: empty check → allowlist → bare
// YES/NO against the pending queue → rate limits → LLM parse →
// dispatch by action kind. Every branch writes one audit-log row.
// ============================================================

import { randomUUID } from "node:crypto";
import {
  AgentOfflineError,
  CONFIRM_WINDOW_MINUTES,
  GLOBAL_PER_DAY,
  NEEDS_CONFIRM,
  NO_RE,
  PER_SENDER_PER_HOUR,
  UNDO_WINDOW_MINUTES,
  YES_RE,
} from "./types";
import type {
  CommittedFacts,
  ExecuteResult,
  InboundMessage,
  InboundReply,
  LeagueContext,
  ParsedAction,
  ParseResult,
  UndoSpec,
} from "./types";
import { normalizeHandle } from "./store";
import type { AgentStore } from "./store";

type MaybePromise<T> = T | Promise<T>;
type RecordScoreAction = Extract<ParsedAction, { kind: "record_score" }>;

/**
 * Raw league data as fetched from the app; the orchestrator never dereferences
 * it, only passes it through to buildContext/renderBoard. Fields are `any` so
 * implementations typed against their concrete row shapes remain assignable.
 */
export type LeagueData = {
  teeTimes: any;
  players: any;
  tournaments: any;
  polls: any;
};

/** exec.resolveScoreTarget output: which tee time a score lands on, or a member-facing miss. */
export type ResolveScoreResult =
  | { ok: true; teeTimeId: string; course: string; date: string }
  | { ok: false; reply: string };

export type InboundDeps = {
  store: AgentStore;
  parse: (text: string, ctx: LeagueContext) => Promise<ParseResult>;
  buildContext: (raw: LeagueData, senderName: string, now?: Date) => LeagueContext;
  fetchLeagueData: () => Promise<LeagueData>;
  exec: {
    executeParsed: (action: ParsedAction, senderName: string) => MaybePromise<ExecuteResult>;
    resolveScoreTarget: (action: RecordScoreAction, senderName: string) => MaybePromise<ResolveScoreResult>;
    executeScore: (action: RecordScoreAction, teeTimeId: string, senderName: string) => MaybePromise<ExecuteResult>;
    executeUndo: (spec: UndoSpec) => MaybePromise<{ summary: string }>;
  };
  render: {
    renderCommitted: (facts: CommittedFacts, undoable: boolean) => string;
    renderConfirmRequest: (action: RecordScoreAction, target: { course: string; date: string }) => string;
    renderBoard: (raw: LeagueData) => string;
  };
  /** Injectable clock for tests; defaults to () => new Date(). */
  now?: () => Date;
};

/** Fixed member-facing reply texts (templates, never LLM output). */
export const REPLIES = {
  help: "Say something like: Common Ground Sat 8:40, room for 2.",
  unknownSender: "I don't recognize this number — ask Matt to add you to the board.",
  nothingForYes: "Nothing is waiting on a yes from you.",
  nothingToUndo: "Nothing to undo.",
  cancelled: "Cancelled — nothing was posted.",
  offline: "The board agent isn't configured yet — use the app.",
  error: "Something broke on my end — try the app.",
  unknown:
    "Didn't catch that. Try like: 'Common Ground Sat 8:40, room for 2' or 'shot 82, hcp 9, attested by Jason'.",
  rateLimitedSender: "You've sent a lot of messages this hour — give it a bit and try again.",
  rateLimitedGlobal: "The board agent hit its daily limit — try again tomorrow, or use the app.",
} as const;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Rate-limit state: in-memory, module scope, counted ONLY for messages that
// reach the parse step. Sender key → epoch-ms timestamps within the last hour;
// UTC day key → parse count for that calendar day.
const senderParseHits = new Map<string, number[]>();
const globalParseHits = new Map<string, number>();

/** Test hook: clears all in-memory rate-limit state. */
export function resetRateLimitsForTests(): void {
  senderParseHits.clear();
  globalParseHits.clear();
}

/** Returns which limit blocks this message, or null after recording a parse-bound hit. */
function checkRateLimits(channel: string, handle: string, now: Date): "sender" | "global" | null {
  const key = `${channel}|${normalizeHandle(handle)}`;
  const cutoff = now.getTime() - HOUR_MS;
  const recent = (senderParseHits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= PER_SENDER_PER_HOUR) {
    senderParseHits.set(key, recent);
    return "sender";
  }
  const day = now.toISOString().slice(0, 10);
  if (!globalParseHits.has(day)) globalParseHits.clear(); // day rolled over — drop stale counters
  const dayCount = globalParseHits.get(day) ?? 0;
  if (dayCount >= GLOBAL_PER_DAY) {
    senderParseHits.set(key, recent);
    return "global";
  }
  senderParseHits.set(key, [...recent, now.getTime()]);
  globalParseHits.set(day, dayCount + 1);
  return null;
}

function isoPlusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * MINUTE_MS).toISOString();
}

export function createInboundHandler(deps: InboundDeps) {
  const { store, exec, render } = deps;
  const clock = deps.now ?? (() => new Date());

  return async function handleInbound(msg: InboundMessage): Promise<InboundReply> {
    const now = clock();
    const log = (outcome: string, playerName: string | null = null, parsedJson: string | null = null) =>
      store.logAction({
        at: now.toISOString(),
        channel: msg.channel,
        handle: msg.handle,
        playerName,
        rawMessage: msg.text,
        parsedJson,
        outcome,
      });

    // 1. Empty message → usage hint.
    const text = msg.text.trim();
    if (!text) {
      log("empty");
      return { reply: REPLIES.help };
    }

    // 2. Allowlist gate — resolved BEFORE any LLM call.
    const member = store.findMember(msg.channel, msg.handle);
    if (!member || !member.active) {
      log("unknown_sender");
      return { reply: REPLIES.unknownSender };
    }
    const name = member.playerName;

    // 3. Bare YES → commit the pending confirm, if one is waiting. Takes
    // ONLY confirm-mode pendings: a "yes" texted after an auto-commit must
    // not consume (and thereby destroy) the sender's undo window.
    if (YES_RE.test(text)) {
      const pending = store.takeLatestPending(msg.channel, msg.handle, now, "confirm");
      if (!pending) {
        log("no_pending", name);
        return { reply: REPLIES.nothingForYes };
      }
      let stored: { action: RecordScoreAction; teeTimeId: string };
      try {
        stored = JSON.parse(pending.actionJson);
      } catch {
        log("error", name, pending.actionJson);
        return { reply: REPLIES.error };
      }
      const result = await exec.executeScore(stored.action, stored.teeTimeId, name);
      // `=== false` (not `!ok`): this tsconfig has no strictNullChecks, so
      // truthiness checks don't narrow discriminated unions.
      if (result.ok === false) {
        log("exec_failed", name, pending.actionJson);
        return { reply: result.reply };
      }
      log("yes_commit", name, pending.actionJson);
      return { reply: render.renderCommitted(result.committed, false) };
    }

    // 4. Bare NO → undo the last auto-commit, or cancel the pending confirm.
    if (NO_RE.test(text)) {
      const pending = store.takeLatestPending(msg.channel, msg.handle, now);
      if (!pending) {
        log("no_pending", name);
        return { reply: REPLIES.nothingToUndo };
      }
      if (pending.mode === "confirm") {
        log("cancelled", name, pending.actionJson);
        return { reply: REPLIES.cancelled };
      }
      let spec: UndoSpec;
      try {
        spec = JSON.parse(pending.actionJson);
      } catch {
        log("error", name, pending.actionJson);
        return { reply: REPLIES.error };
      }
      const undone = await exec.executeUndo(spec);
      log("undone", name, pending.actionJson);
      return { reply: `Undone: ${undone.summary}` };
    }

    // 5. Rate limits — only parse-bound messages count against them.
    const limited = checkRateLimits(msg.channel, msg.handle, now);
    if (limited) {
      log("rate_limited", name);
      return { reply: limited === "sender" ? REPLIES.rateLimitedSender : REPLIES.rateLimitedGlobal };
    }

    // 6. Fetch live data, build context, parse.
    let raw: LeagueData;
    let result: ParseResult;
    try {
      raw = await deps.fetchLeagueData();
      const ctx = deps.buildContext(raw, name, now);
      result = await deps.parse(text, ctx);
    } catch (err) {
      if (err instanceof AgentOfflineError) {
        log("offline", name);
        return { reply: REPLIES.offline };
      }
      log("error", name, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      return { reply: REPLIES.error };
    }

    // 7. Dispatch on the parsed action.
    const action = result.action;
    const parsedJson = JSON.stringify(action);

    if (action.kind === "clarify") {
      log("clarified", name, parsedJson);
      return { reply: action.question };
    }
    if (action.kind === "unknown") {
      log("unknown", name, parsedJson); // reason stays internal, in parsedJson
      return { reply: REPLIES.unknown };
    }
    if (action.kind === "board_query") {
      log("board", name, parsedJson);
      return { reply: render.renderBoard(raw) };
    }

    // YES-gated actions (today: record_score only) — resolve target, park, ask.
    if (NEEDS_CONFIRM.has(action.kind) && action.kind === "record_score") {
      const target = await exec.resolveScoreTarget(action, name);
      if (target.ok === false) {
        log("exec_failed", name, parsedJson);
        return { reply: target.reply };
      }
      store.savePending({
        id: randomUUID(),
        channel: msg.channel,
        handle: msg.handle,
        mode: "confirm",
        actionJson: JSON.stringify({ action, teeTimeId: target.teeTimeId }),
        createdAt: now.toISOString(),
        expiresAt: isoPlusMinutes(now, CONFIRM_WINDOW_MINUTES),
      });
      log("confirm_requested", name, parsedJson);
      return { reply: render.renderConfirmRequest(action, { course: target.course, date: target.date }) };
    }

    // Everything else auto-commits, with a NO-undo window when undoable.
    const execResult = await exec.executeParsed(action, name);
    if (execResult.ok === false) {
      log("exec_failed", name, parsedJson);
      return { reply: execResult.reply };
    }
    if (execResult.undo !== null) {
      store.savePending({
        id: randomUUID(),
        channel: msg.channel,
        handle: msg.handle,
        mode: "undo",
        actionJson: JSON.stringify(execResult.undo),
        createdAt: now.toISOString(),
        expiresAt: isoPlusMinutes(now, UNDO_WINDOW_MINUTES),
      });
    }
    log("committed", name, parsedJson);
    return { reply: render.renderCommitted(execResult.committed, execResult.undo !== null) };
  };
}
