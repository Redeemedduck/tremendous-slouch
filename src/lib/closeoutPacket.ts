import { buildCloseoutReadiness } from "./closeoutReadiness";
import { ACTIVE_RULES_VERSION } from "./leagueRules";
import { buildPayoutEvidence } from "./payoutEvidence";
import { computeTournamentLeaderboard, inWindow } from "./tournamentLeaderboard";
import type { Player, Score, TeeTime, Tournament } from "./types";

const key = (value: string) => value.trim().toLowerCase();

function money(value: number | null | undefined) {
  return value == null ? "-" : `$${value.toLocaleString("en-US")}`;
}

function scoreNet(score: Score, getHandicap: (name: string) => number | null) {
  if (score.courseHcp != null) return score.gross - score.courseHcp;
  const hcp = getHandicap(score.name);
  return hcp == null ? null : score.gross - hcp;
}

function scoreStatus(score: Score) {
  return score.attestationStatus ?? "legacy_unconfirmed";
}

function scoreOfficialLabel(score: Score) {
  const status = scoreStatus(score);
  return status === "attested" || status === "overridden"
    ? `official:${status}`
    : `not official:${status}`;
}

function closeoutAction(status: string) {
  switch (status) {
    case "ready":
      return "Ready to close after commissioner review.";
    case "closed":
      return "Closed. Reopen before changing tee times, scores, or payout state.";
    case "blocked":
      return "Blocked. Finish score review before closeout.";
    case "upcoming":
      return "Upcoming. Closeout is available after the tournament window opens and scores exist.";
    case "active":
      return "Window still active. Close after the window ends unless force-closing intentionally.";
    case "no_scores":
      return "No scored rounds are available to close.";
    default:
      return "Review required.";
  }
}

export function buildCloseoutPacket({
  tournament,
  tournaments,
  teeTimes,
  players,
  today,
  getHandicap,
  exportedAt = new Date().toISOString(),
}: {
  tournament: Tournament;
  tournaments: Tournament[];
  teeTimes: TeeTime[];
  players: Player[];
  today: string;
  getHandicap: (name: string) => number | null;
  exportedAt?: string;
}) {
  const readiness = buildCloseoutReadiness({
    tournament,
    tournaments,
    teeTimes,
    players,
    today,
    getHandicap,
  });
  const board = computeTournamentLeaderboard(tournament, teeTimes, getHandicap);
  const payoutEvidence = buildPayoutEvidence(tournament);
  const memberNames = new Set(
    players.filter((player) => player.member).map((player) => key(player.name))
  );
  const tournamentTeeTimes = teeTimes
    .filter((teeTime) => inWindow(tournament, teeTime.date))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time.localeCompare(b.time);
      return a.course.localeCompare(b.course, undefined, { sensitivity: "base" });
    });

  const lines = [
    "DJDI Tournament Closeout Packet",
    `Generated: ${exportedAt}`,
    `Rules version: ${ACTIVE_RULES_VERSION}`,
    `Tournament: ${tournament.name}`,
    `Course: ${tournament.course}`,
    `Window: ${tournament.windowStart} to ${tournament.windowEnd}`,
    `Status: ${readiness.status} - ${readiness.detail}`,
    `Closeout action: ${closeoutAction(readiness.status)}`,
    `Closed: ${
      tournament.closedAt
        ? `${tournament.closedAt} by ${tournament.closedBy ?? "unknown"}`
        : "no"
    }`,
    `Payouts: 1st ${money(tournament.payoutFirst)}, 2nd ${money(
      tournament.payoutSecond
    )}, 3rd ${money(tournament.payoutThird)}`,
    `Payout confirmed: ${tournament.payoutConfirmed ? "yes" : "no"}`,
    `Payout paid: ${tournament.payoutPaidAt ?? "no"}`,
    `Payout evidence: ${
      payoutEvidence.status === "evidenced"
        ? payoutEvidence.note
        : payoutEvidence.status === "missing_evidence"
          ? "missing settlement note"
          : "not required until paid"
    }`,
    "",
    "Leaderboard",
  ];

  if (board.length === 0) {
    lines.push("No scored rounds.");
  } else {
    for (const row of board) {
      lines.push(
        `${row.position}. ${row.name}: ${row.bestGross} gross, ${
          row.bestNet ?? "-"
        } net, ${row.rounds} round${row.rounds === 1 ? "" : "s"}, net source ${
          row.netFromCourseHcp ? "course handicap" : "profile handicap"
        }`
      );
    }
  }

  lines.push("", "Score Evidence");
  if (tournamentTeeTimes.length === 0) {
    lines.push("No tee times in this tournament window.");
  } else {
    for (const teeTime of tournamentTeeTimes) {
      lines.push(
        `${teeTime.date} ${teeTime.time} ${teeTime.course} (${teeTime.host})`
      );
      lines.push(
        `Claims: ${
          teeTime.claims.length > 0
            ? teeTime.claims.map((claim) => claim.name).join(", ")
            : "none"
        }`
      );
      if (teeTime.scores.length === 0) {
        lines.push("Scores: none");
      } else {
        for (const score of [...teeTime.scores].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        )) {
          const net = scoreNet(score, getHandicap);
          const memberLabel = memberNames.has(key(score.name)) ? "member" : "guest";
          lines.push(
            `- ${score.name} (${memberLabel}): ${score.gross} gross, CH ${
              score.courseHcp ?? "-"
            }, net ${net ?? "-"}, ${scoreOfficialLabel(score)}, attested by ${
              score.attestedBy ?? "-"
            }`
          );
        }
      }
    }
  }

  lines.push("", "Score Review");
  if (readiness.issues.length === 0) {
    lines.push("None");
  } else {
    for (const issue of readiness.issues) {
      lines.push(
        `${issue.date} ${issue.time} ${issue.player}: ${issue.message} (${issue.course})`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
