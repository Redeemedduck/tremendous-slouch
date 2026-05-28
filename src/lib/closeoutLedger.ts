import { buildCloseoutReadiness } from "./closeoutReadiness";
import { ACTIVE_LEAGUE_RULES, ACTIVE_RULES_VERSION } from "./leagueRules";
import { buildPayoutEvidence } from "./payoutEvidence";
import { computeTournamentLeaderboard, inWindow } from "./tournamentLeaderboard";
import type { Player, Score, TeeTime, Tournament } from "./types";

const key = (value: string) => value.trim().toLowerCase();

function netFor(score: Score, getHandicap: (name: string) => number | null) {
  if (score.courseHcp != null) {
    return {
      net: score.gross - score.courseHcp,
      source: "course_hcp" as const,
      profileHcp: getHandicap(score.name),
    };
  }
  const profileHcp = getHandicap(score.name);
  return {
    net: profileHcp == null ? null : score.gross - profileHcp,
    source: profileHcp == null ? "missing" as const : "profile_hcp" as const,
    profileHcp,
  };
}

function leaderboardFingerprint(row: unknown) {
  if (row == null || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  return {
    position: record.position,
    name: record.name,
    rounds: record.rounds,
    bestGross: record.bestGross,
    bestNet: record.bestNet,
  };
}

function scoreStatus(score: Score) {
  return score.attestationStatus ?? "legacy_unconfirmed";
}

function isOfficialScore(score: Score) {
  const status = scoreStatus(score);
  return status === "attested" || status === "overridden";
}

export function buildCloseoutLedger({
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
  const leaderboard = computeTournamentLeaderboard(
    tournament,
    teeTimes,
    getHandicap
  );
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
  const scoreEvidence = tournamentTeeTimes.flatMap((teeTime) => {
    const claims = new Set(teeTime.claims.map((claim) => key(claim.name)));
    return [...teeTime.scores]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((score) => {
        const attesterKey = score.attestedBy ? key(score.attestedBy) : "";
        const net = netFor(score, getHandicap);
        return {
          teeTimeId: teeTime.id,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          host: teeTime.host,
          player: score.name,
          member: memberNames.has(key(score.name)),
          scorerClaimed: claims.has(key(score.name)),
          gross: score.gross,
          courseHcp: score.courseHcp ?? null,
          profileHcp: net.profileHcp,
          net: net.net,
          netSource: net.source,
          attestationStatus: scoreStatus(score),
          official: isOfficialScore(score),
          attestedAt: score.attestedAt ?? null,
          attestationActor: score.attestationActor ?? null,
          attestedBy: score.attestedBy ?? null,
          attesterMember: attesterKey ? memberNames.has(attesterKey) : false,
          attesterClaimed: attesterKey ? claims.has(attesterKey) : false,
          selfAttested: attesterKey ? attesterKey === key(score.name) : false,
          recordedAt: score.recordedAt,
        };
      });
  });
  const closedSnapshot = Array.isArray(tournament.winnerSnapshot)
    ? tournament.winnerSnapshot
    : [];
  const currentFingerprint = leaderboard.map(leaderboardFingerprint);
  const closedFingerprint = closedSnapshot.map(leaderboardFingerprint);
  const snapshotMatchesCurrent = tournament.closedAt
    ? JSON.stringify(closedFingerprint) === JSON.stringify(currentFingerprint)
    : null;
  const winner = leaderboard[0] ?? null;
  const payoutEvidence = buildPayoutEvidence(tournament);

  return {
    exportedAt,
    version: 1,
    rulesVersion: ACTIVE_RULES_VERSION,
    rules: ACTIVE_LEAGUE_RULES,
    app: "DJDI Golf Board",
    today,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      course: tournament.course,
      windowStart: tournament.windowStart,
      windowEnd: tournament.windowEnd,
      type: tournament.type,
      closedAt: tournament.closedAt ?? null,
      closedBy: tournament.closedBy ?? null,
      closeoutNotes: tournament.closeoutNotes ?? null,
    },
    readiness: {
      status: readiness.status,
      detail: readiness.detail,
      issueCount: readiness.issues.length,
      scoreReviewItemCount: readiness.issues.length,
      readyToClose: readiness.status === "ready",
    },
    payout: {
      first: tournament.payoutFirst,
      second: tournament.payoutSecond,
      third: tournament.payoutThird,
      projectedWinner: winner
        ? {
            name: winner.name,
            position: winner.position,
            bestGross: winner.bestGross,
            bestNet: winner.bestNet,
          }
        : null,
      confirmed: !!tournament.payoutConfirmed,
      paidAt: tournament.payoutPaidAt ?? null,
      evidenceStatus: payoutEvidence.status,
      evidenceNote: payoutEvidence.note,
      evidenceMissing: payoutEvidence.missing,
    },
    integrity: {
      rulesVersion: ACTIVE_RULES_VERSION,
      closed: !!tournament.closedAt,
      closedSnapshotRows: closedSnapshot,
      snapshotMatchesCurrent,
      scoreEvidenceRows: scoreEvidence.length,
      scoreReviewItems: readiness.issues.length,
      ruleBlockers: readiness.issues.length,
      payoutEvidenceMissing: payoutEvidence.missing,
    },
    leaderboard,
    teeTimes: tournamentTeeTimes.map((teeTime) => ({
      id: teeTime.id,
      date: teeTime.date,
      time: teeTime.time,
      course: teeTime.course,
      host: teeTime.host,
      spots: teeTime.spots,
      claims: teeTime.claims,
      scoresPosted: teeTime.scores.length,
    })),
    scoreEvidence,
    scoreReviewItems: readiness.issues,
    ruleBlockers: readiness.issues,
  };
}
