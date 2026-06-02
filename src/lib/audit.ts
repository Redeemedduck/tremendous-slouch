import type { Player, TeeTime, Tournament } from "./types";

export type RuleIssueSeverity = "blocker" | "warning";

export type RuleIssue = {
  id: string;
  severity: RuleIssueSeverity;
  teeTimeId: string;
  tournamentId: string;
  tournamentName: string;
  date: string;
  time: string;
  course: string;
  player: string;
  message: string;
};

const key = (name: string) => name.trim().toLowerCase();

const isLeagueTournament = (tournament: Tournament) =>
  tournament.type !== "post";

const isInTournament = (teeTime: TeeTime, tournament: Tournament) =>
  teeTime.date >= tournament.windowStart && teeTime.date <= tournament.windowEnd;

const issueId = (...parts: string[]) => parts.map(key).join(":");

export function auditLeagueRules(
  teeTimes: TeeTime[],
  tournaments: Tournament[],
  players: Player[],
  today: string
): RuleIssue[] {
  const playerByKey = new Map(players.map((player) => [key(player.name), player]));
  const issues: RuleIssue[] = [];

  for (const teeTime of teeTimes) {
    const tournament = tournaments.find(
      (candidate) =>
        isLeagueTournament(candidate) && isInTournament(teeTime, candidate)
    );
    if (!tournament) continue;

    const claimsByKey = new Map(
      teeTime.claims.map((claim) => [key(claim.name), claim.name])
    );
    const scoresByKey = new Map(
      teeTime.scores.map((score) => [key(score.name), score])
    );

    if (teeTime.date < today) {
      for (const claim of teeTime.claims) {
        if (!scoresByKey.has(key(claim.name))) {
          issues.push({
            id: issueId(teeTime.id, claim.name, "missing-score"),
            severity: "blocker",
            teeTimeId: teeTime.id,
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            date: teeTime.date,
            time: teeTime.time,
            course: teeTime.course,
            player: claim.name,
            message: "Missing score",
          });
        }
      }
    }

    for (const score of teeTime.scores) {
      const scoreKey = key(score.name);
      const scorer = playerByKey.get(scoreKey);
      if (!claimsByKey.has(scoreKey)) {
        issues.push({
          id: issueId(teeTime.id, score.name, "not-claimed"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Scored player is not claimed on this tee time",
        });
      }
      if (!scorer?.member) {
        issues.push({
          id: issueId(teeTime.id, score.name, "not-member"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Scored player is not marked as a member",
        });
      }
      if (score.courseHcp == null) {
        issues.push({
          id: issueId(teeTime.id, score.name, "missing-course-hcp"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Missing course handicap",
        });
      }

      const attester = score.attestedBy?.trim() ?? "";
      if (!attester) {
        issues.push({
          id: issueId(teeTime.id, score.name, "missing-attester"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Missing attester",
        });
        continue;
      }
      if (
        score.attestationStatus !== "attested" &&
        score.attestationStatus !== "overridden"
      ) {
        issues.push({
          id: issueId(teeTime.id, score.name, "pending-attestation"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: score.attestationStatus
            ? "Score attestation is still pending"
            : "Legacy score needs attestation confirmation",
        });
      }

      const attesterKey = key(attester);
      const attesterPlayer = playerByKey.get(attesterKey);
      if (attesterKey === scoreKey) {
        issues.push({
          id: issueId(teeTime.id, score.name, "self-attested"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Self-attested score",
        });
      }
      if (!claimsByKey.has(attesterKey)) {
        issues.push({
          id: issueId(teeTime.id, score.name, "attester-not-claimed"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Attester is not claimed on this tee time",
        });
      }
      if (!attesterPlayer?.member) {
        issues.push({
          id: issueId(teeTime.id, score.name, "attester-not-member"),
          severity: "blocker",
          teeTimeId: teeTime.id,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: teeTime.date,
          time: teeTime.time,
          course: teeTime.course,
          player: score.name,
          message: "Attester is not marked as a member",
        });
      }
    }
  }

  return issues.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return a.player.localeCompare(b.player, undefined, { sensitivity: "base" });
  });
}
