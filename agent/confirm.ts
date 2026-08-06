// ============================================================
// Text-the-Board agent — reply templates.
// Every string here is assembled ONLY from validated structs (CommittedFacts,
// ParsedAction, live API data) — never from model output.
// ============================================================

import type { CommittedFacts, ParsedAction } from "./types";
import { UNDO_WINDOW_MINUTES } from "./types";
import type { Poll, TeeTime } from "../src/lib/types";
import {
  formatDateLabel,
  formatTimeLabel,
  todayISO,
} from "../src/lib/format";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const committedLine = (facts: CommittedFacts): string => {
  switch (facts.kind) {
    case "create_tee_time": {
      const open = facts.spots - 1; // the API auto-claims the host
      return `On the sheet: ${facts.course}, ${formatDateLabel(facts.date)}, ${formatTimeLabel(facts.time)} — you're in as host, ${open} of ${facts.spots} spots open.`;
    }
    case "claim_spot": {
      const tail =
        facts.open === 0
          ? "that fills it up"
          : `${plural(facts.open, "spot")} still open`;
      return `You're in: ${facts.course}, ${formatDateLabel(facts.date)}, ${formatTimeLabel(facts.time)} — ${tail}.`;
    }
    case "drop_spot":
      return `Dropped: ${facts.course}, ${formatDateLabel(facts.date)}, ${formatTimeLabel(facts.time)} — your spot is open for someone else.`;
    case "record_score": {
      const net = facts.net != null ? ` (net ${facts.net})` : "";
      const attested = facts.attestedBy
        ? `, attested by ${facts.attestedBy}`
        : "";
      return `Posted: ${facts.gross} gross${net} — ${facts.course}, ${formatDateLabel(facts.date)}${attested}.`;
    }
    case "cast_vote":
      return `Vote counted: "${facts.optionText}" on "${facts.pollPrompt}".`;
  }
};

export const renderCommitted = (
  facts: CommittedFacts,
  undoAvailable: boolean
): string => {
  const base = committedLine(facts);
  return undoAvailable
    ? `${base} Reply NO in the next ${UNDO_WINDOW_MINUTES} min to undo.`
    : base;
};

/** Full echo of a YES-gated score so the member confirms exactly what posts. */
export const renderConfirmRequest = (
  action: Extract<ParsedAction, { kind: "record_score" }>,
  target: { course: string; date: string }
): string => {
  const hcp =
    action.courseHcp != null
      ? `course handicap ${action.courseHcp}`
      : "no course handicap given";
  const attester = action.attestedBy
    ? `attested by ${action.attestedBy}`
    : "no attester given";
  return `Recording: ${action.gross} gross, ${hcp}, ${attester} — ${target.course}, ${formatDateLabel(target.date)}. Reply YES to post it.`;
};

// renderBoard caps: 1 header + 7 tee lines + 1 overflow + 1 header +
// 3 poll lines + 1 overflow = 14 lines max (< 15).
const BOARD_MAX_TEE_TIMES = 7;
const BOARD_MAX_POLLS = 3;

export const renderBoard = (data: {
  teeTimes: TeeTime[];
  polls: Poll[];
}): string => {
  const today = todayISO();
  const upcoming = data.teeTimes
    .filter((t) => t.date >= today)
    .sort((a, b) =>
      a.date === b.date
        ? a.time.localeCompare(b.time)
        : a.date.localeCompare(b.date)
    );
  const lines: string[] = [];
  if (upcoming.length > 0) {
    lines.push("Upcoming:");
    for (const t of upcoming.slice(0, BOARD_MAX_TEE_TIMES)) {
      const open = Math.max(0, t.spots - t.claims.length);
      const tail = open === 0 ? "full" : `${open} of ${t.spots} open`;
      lines.push(
        `- ${t.course} ${formatDateLabel(t.date)} ${formatTimeLabel(t.time)} — ${tail}`
      );
    }
    if (upcoming.length > BOARD_MAX_TEE_TIMES) {
      lines.push(`  …and ${upcoming.length - BOARD_MAX_TEE_TIMES} more`);
    }
  }
  if (data.polls.length > 0) {
    lines.push("Polls:");
    for (const p of data.polls.slice(0, BOARD_MAX_POLLS)) {
      lines.push(`- ${p.prompt} (${plural(p.options.length, "option")})`);
    }
    if (data.polls.length > BOARD_MAX_POLLS) {
      lines.push(`  …and ${data.polls.length - BOARD_MAX_POLLS} more`);
    }
  }
  if (lines.length === 0) {
    return "Nothing on the board — no upcoming tee times or open polls.";
  }
  return lines.join("\n");
};
