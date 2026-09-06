// ============================================================
// Text-the-Board agent — shared contract.
//
// Every module in agent/ codes against these types. parse.ts turns a raw
// member message into a ParsedAction; execute.ts turns a ParsedAction into
// an API call against the running app; inbound.ts orchestrates the whole
// exchange and owns the reply the member sees. Keep this file dependency-
// free (types only) so ownership stays disjoint.
// ============================================================

/** What a channel relay POSTs to the webhook. */
export type InboundMessage = {
  /** "imessage" | "sms" | "dev" — freeform, recorded in the audit log. */
  channel: string;
  /** Channel-native sender id (E.164 phone, iMessage handle, …). */
  handle: string;
  /** Raw message body as the member typed it. */
  text: string;
};

/** A member row from the allowlist. Resolved BEFORE any LLM call. */
export type Member = {
  channel: string;
  handle: string;
  playerName: string;
  active: boolean;
};

/**
 * How a member points at an existing tee time in natural language
 * ("the Saturday round", "Common Ground tomorrow"). The executor resolves
 * this against the live tee sheet; zero matches or 2+ matches must produce
 * a clarify-style reply, never a guess.
 */
export type TeeTimeRef = {
  course?: string;
  /** YYYY-MM-DD when the member named a day. */
  date?: string;
  /** HH:MM 24h when the member named a time. */
  time?: string;
};

/** One tool call the model may emit — exactly one per message. */
export type ParsedAction =
  | {
      kind: "create_tee_time";
      course: string;
      /** YYYY-MM-DD — the model resolves "Sat" using the prompt's date. */
      date: string;
      /** HH:MM 24h. */
      time: string;
      spots: number;
      notes?: string;
    }
  | { kind: "claim_spot"; ref: TeeTimeRef }
  | { kind: "drop_spot"; ref: TeeTimeRef }
  | {
      kind: "record_score";
      ref: TeeTimeRef;
      gross: number;
      /** Per-round course handicap; null when the member didn't give one. */
      courseHcp: number | null;
      /** Attesting member's name as written; null when not given. */
      attestedBy: string | null;
    }
  | {
      kind: "cast_vote";
      /** Substring of the poll prompt the member referenced, if any. */
      pollHint: string | null;
      /** The option text the member picked, as written. */
      optionText: string;
    }
  | { kind: "board_query" }
  | {
      kind: "clarify";
      /** Question to text back, written for a golfer, one line. */
      question: string;
    }
  | {
      kind: "unknown";
      /** Why the message couldn't be handled — internal, logged not sent. */
      reason: string;
    };

/** Context handed to the parser — built from live app data, pure input. */
export type LeagueContext = {
  /** Today's date, YYYY-MM-DD, America/Denver. */
  today: string;
  /** Weekday name for `today`, e.g. "Tuesday". */
  weekday: string;
  /** The sender's resolved player name — authoritative, from the allowlist. */
  senderName: string;
  /** Known course names (tournament courses + recent tee-time courses). */
  courses: string[];
  /** Roster player names. */
  players: string[];
  /** Upcoming/open tee times, compact, for reference resolution. */
  teeTimes: { course: string; date: string; time: string; open: number }[];
  /** Open polls: prompt + options. */
  polls: { prompt: string; options: string[] }[];
  /** The live stop window, if one is open. */
  liveStop: { name: string; course: string; windowEnd: string } | null;
};

/** parse.ts output. */
export type ParseResult = {
  action: ParsedAction;
  model: string;
};

/** How an executed action is undone. Stored in pending_actions. */
export type UndoSpec =
  | { kind: "delete_tee_time"; teeTimeId: string }
  | { kind: "drop_claim"; teeTimeId: string; playerName: string }
  | { kind: "restore_claim"; teeTimeId: string; playerName: string }
  | { kind: "remove_score"; teeTimeId: string; playerName: string }
  | { kind: "remove_vote"; pollId: string; playerName: string; optionIdx: number };

/** execute.ts output for a committed action. */
export type ExecuteResult =
  | {
      ok: true;
      /** Canonical facts of what was committed — the template's only input. */
      committed: CommittedFacts;
      undo: UndoSpec | null;
    }
  | {
      ok: false;
      /** Member-facing failure text (from API error or resolver). */
      reply: string;
    };

/** Template inputs — never LLM text. */
export type CommittedFacts =
  | { kind: "create_tee_time"; course: string; date: string; time: string; spots: number; teeTimeId: string }
  | { kind: "claim_spot"; course: string; date: string; time: string; open: number; teeTimeId: string }
  | { kind: "drop_spot"; course: string; date: string; time: string; teeTimeId: string }
  | { kind: "record_score"; course: string; date: string; gross: number; net: number | null; attestedBy: string | null; teeTimeId: string }
  | { kind: "cast_vote"; pollPrompt: string; optionText: string; pollId: string; optionIdx: number };

/** A stored pending item awaiting a bare YES/NO from the sender. */
export type PendingAction = {
  id: string;
  channel: string;
  handle: string;
  /** "confirm": YES executes action_json (a ParsedAction).
   *  "undo": NO executes undo_json (an UndoSpec). */
  mode: "confirm" | "undo";
  actionJson: string;
  createdAt: string;
  expiresAt: string;
};

/** The webhook's reply body. */
export type InboundReply = { reply: string };

/** Thrown by parse.ts when no ANTHROPIC_API_KEY is configured. */
export class AgentOfflineError extends Error {
  constructor() {
    super("Agent parsing is not configured (ANTHROPIC_API_KEY missing)");
    this.name = "AgentOfflineError";
  }
}

// -------- policy constants (single source of truth) --------

/** Bare replies that resolve a pending item. */
export const YES_RE = /^\s*(yes|y|yep|yeah|confirm)\s*[.!]*\s*$/i;
export const NO_RE = /^\s*(no|n|nope|undo|cancel)\s*[.!]*\s*$/i;

/** Undo window for auto-committed actions. */
export const UNDO_WINDOW_MINUTES = 10;
/** Confirm window for YES-gated actions. */
export const CONFIRM_WINDOW_MINUTES = 60;

/** Rate limits. */
export const PER_SENDER_PER_HOUR = 10;
export const GLOBAL_PER_DAY = 100;

/** Actions that must be confirmed with YES before committing. */
export const NEEDS_CONFIRM: ReadonlySet<ParsedAction["kind"]> = new Set([
  "record_score",
]);
