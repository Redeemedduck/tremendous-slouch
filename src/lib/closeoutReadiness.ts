import { auditLeagueRules, type RuleIssue } from "./audit";
import {
  computeTournamentLeaderboard,
  type LeaderboardRow,
} from "./tournamentLeaderboard";
import {
  buildPayoutEvidence,
  type PayoutEvidence,
} from "./payoutEvidence";
import type { Player, TeeTime, Tournament } from "./types";

export type CloseoutStatus =
  | "closed"
  | "upcoming"
  | "active"
  | "blocked"
  | "no_scores"
  | "ready";

export type CloseoutReadiness = {
  status: CloseoutStatus;
  buttonLabel: string;
  detail: string;
  board: LeaderboardRow[];
  issues: RuleIssue[];
  payoutEvidence: PayoutEvidence;
};

export function buildCloseoutReadiness({
  tournament,
  tournaments,
  teeTimes,
  players,
  today,
  getHandicap,
}: {
  tournament: Tournament;
  tournaments: Tournament[];
  teeTimes: TeeTime[];
  players: Player[];
  today: string;
  getHandicap: (name: string) => number | null;
}): CloseoutReadiness {
  const board = computeTournamentLeaderboard(tournament, teeTimes, getHandicap);
  const payoutEvidence = buildPayoutEvidence(tournament);
  const issues = auditLeagueRules(
    teeTimes,
    tournaments,
    players,
    "9999-12-31"
  ).filter((issue) => issue.tournamentId === tournament.id);

  if (tournament.closedAt) {
    return {
      status: "closed",
      buttonLabel: "Reopen",
      detail: `Closed ${tournament.closedAt.slice(0, 10)}`,
      board,
      issues,
      payoutEvidence,
    };
  }

  if (tournament.type !== "post" && today < tournament.windowStart) {
    return {
      status: "upcoming",
      buttonLabel: "Upcoming",
      detail: `Window opens ${tournament.windowStart}`,
      board,
      issues,
      payoutEvidence,
    };
  }

  if (tournament.type !== "post" && today <= tournament.windowEnd) {
    return {
      status: "active",
      buttonLabel: "Active",
      detail: `Window active through ${tournament.windowEnd}`,
      board,
      issues,
      payoutEvidence,
    };
  }

  if (issues.length > 0) {
    return {
      status: "blocked",
      buttonLabel: "Blocked",
      detail: `${issues.length} score review item${issues.length === 1 ? "" : "s"}`,
      board,
      issues,
      payoutEvidence,
    };
  }

  if (tournament.type !== "post" && board.length === 0) {
    return {
      status: "no_scores",
      buttonLabel: "No scores",
      detail: "No scored rounds",
      board,
      issues,
      payoutEvidence,
    };
  }

  return {
    status: "ready",
    buttonLabel: "Close",
    detail: "Ready to close",
    board,
    issues,
    payoutEvidence,
  };
}
