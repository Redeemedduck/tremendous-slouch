import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { auditLeagueRules } from "../src/lib/audit";
import { buildCommissionerTasks } from "../src/lib/commissionerTasks";
import { missingSourceBackedHandicapPlayers } from "../src/lib/handicapEvidence";
import { buildLaunchRisks } from "../src/lib/launchRisks";
import { computeStandings, sortStandings } from "../src/lib/standings";
import { computeTournamentLeaderboard } from "../src/lib/tournamentLeaderboard";
import type {
  Buyin,
  Claim,
  Comment,
  Interest,
  Player,
  Score,
  TeeTime,
  Tournament,
  TournamentType,
} from "../src/lib/types";

loadEnv({ path: [".env.local", ".env"], quiet: true });

type PlayerRow = {
  name: string;
  handicap: number | null;
  handicap_source: string | null;
  ghin_number?: string | null;
  handicap_source_type?: string | null;
  handicap_verified_at?: string | null;
  handicap_verified_by?: string | null;
  member: number;
  updated_at: string;
};

type BuyinRow = {
  player_name: string;
  amount: number;
  paid: number;
  paid_at: string | null;
  notes: string | null;
  updated_at: string;
};

type TeeTimeRow = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes: string | null;
  claims: string;
  interested: string;
  scores: string;
  comments: string;
  created_at: string;
};

type TournamentRow = {
  id: string;
  name: string;
  course: string;
  window_start: string;
  window_end: string;
  type: TournamentType;
  points_to_first: number | null;
  payout_first: number | null;
  payout_second: number | null;
  payout_third: number | null;
  notes: string | null;
  created_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
  winner_snapshot?: string | null;
  payout_confirmed?: number;
  payout_paid_at?: string | null;
  closeout_notes?: string | null;
};

type LaunchCheckRow = {
  key: string;
  verified: number;
  verified_at: string | null;
  verified_by: string | null;
  note: string | null;
  updated_at: string;
};

const launchCheckDefinitions = [
  {
    key: "dockerBuildVerified",
    envVar: "DJDI_DOCKER_BUILD_VERIFIED",
  },
  {
    key: "tailnetServeVerified",
    envVar: "DJDI_TAILNET_URL_VERIFIED",
  },
  {
    key: "productionUrlVerified",
    envVar: "DJDI_PRODUCTION_URL_VERIFIED",
  },
  {
    key: "mobileSafariVerified",
    envVar: "DJDI_MOBILE_SAFARI_VERIFIED",
  },
] as const;

const dbPath = path.resolve(process.env.DB_PATH ?? "golf_coordinator.db");
const today = process.env.LIVE_STATE_TODAY ?? new Date().toISOString().slice(0, 10);
const skipStopOneExpectation = process.env.SKIP_STOP1_EXPECTATION === "1";

const expectedStopOneScores = [
  { name: "Jayson Post", gross: 82, courseHcp: 12, net: 70 },
  { name: "Kyle Dantzler", gross: 79, courseHcp: 4, net: 75 },
  { name: "Sam Lines", gross: 78, courseHcp: 5, net: 73 },
  { name: "Matt", gross: 76, courseHcp: 7, net: 69 },
  { name: "Jonny Ten Bosch", gross: 80, courseHcp: 7, net: 73 },
  { name: "Will", gross: 82, courseHcp: 12, net: 70 },
];

const key = (value: string) => value.trim().toLowerCase();

function fail(message: string): never {
  throw new Error(message);
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    fail(`invalid JSON in ${label}`);
  }
}

function rowToPlayer(row: PlayerRow): Player {
  return {
    name: row.name,
    handicap: row.handicap,
    handicapSource: row.handicap_source ?? null,
    ghinNumber: row.ghin_number ?? null,
    handicapSourceType: row.handicap_source_type ?? null,
    handicapVerifiedAt: row.handicap_verified_at ?? null,
    handicapVerifiedBy: row.handicap_verified_by ?? null,
    member: !!row.member,
    updatedAt: row.updated_at,
  };
}

function rowToBuyin(row: BuyinRow): Buyin {
  return {
    playerName: row.player_name,
    amount: row.amount,
    paid: !!row.paid,
    paidAt: row.paid_at,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function rowToTeeTime(row: TeeTimeRow): TeeTime {
  return {
    id: row.id,
    course: row.course,
    date: row.date,
    time: row.time,
    spots: row.spots,
    host: row.host,
    notes: row.notes,
    claims: parseJson<Claim[]>(row.claims, `${row.id}.claims`),
    interested: parseJson<Interest[]>(row.interested, `${row.id}.interested`),
    scores: parseJson<Score[]>(row.scores, `${row.id}.scores`),
    comments: parseJson<Comment[]>(row.comments, `${row.id}.comments`),
    createdAt: row.created_at,
  };
}

function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    course: row.course,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    type: row.type,
    pointsToFirst: row.points_to_first,
    payoutFirst: row.payout_first,
    payoutSecond: row.payout_second,
    payoutThird: row.payout_third,
    notes: row.notes,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    winnerSnapshot: parseJson<unknown[]>(row.winner_snapshot ?? "[]", `${row.id}.winner_snapshot`),
    payoutConfirmed: !!row.payout_confirmed,
    payoutPaidAt: row.payout_paid_at ?? null,
    closeoutNotes: row.closeout_notes ?? null,
  };
}

function envFlag(name: string) {
  const value = process.env[name];
  return value === "1" || value === "true";
}

function readLaunchChecks(db: Database.Database) {
  const tables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name)
  );
  const storedRows = tables.has("launch_checks")
    ? new Map(
        (
          db.prepare("SELECT * FROM launch_checks").all() as LaunchCheckRow[]
        ).map((row) => [row.key, row])
      )
    : new Map<string, LaunchCheckRow>();
  const records = launchCheckDefinitions.map((definition) => {
    const row = storedRows.get(definition.key);
    const envVerified = envFlag(definition.envVar);
    const storedVerified = !!row?.verified;
    return {
      key: definition.key,
      envVar: definition.envVar,
      verified: envVerified || storedVerified,
      source: envVerified ? "env" : storedVerified ? "database" : "none",
      verifiedAt: row?.verified_at ?? null,
      verifiedBy: row?.verified_by ?? null,
      note: row?.note ?? null,
    };
  });
  return {
    records,
    state: {
      dockerBuildVerified:
        records.find((record) => record.key === "dockerBuildVerified")
          ?.verified ?? false,
      tailnetServeVerified:
        records.find((record) => record.key === "tailnetServeVerified")
          ?.verified ?? false,
      productionUrlVerified:
        records.find((record) => record.key === "productionUrlVerified")
          ?.verified ?? false,
      mobileSafariVerified:
        records.find((record) => record.key === "mobileSafariVerified")
          ?.verified ?? false,
    },
  };
}

try {
  if (!fs.existsSync(dbPath)) {
    fail(`database does not exist at ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const quickCheck = db.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      fail(`database quick_check returned ${String(quickCheck)}`);
    }

    const players = (db
      .prepare("SELECT * FROM players ORDER BY name COLLATE NOCASE")
      .all() as PlayerRow[]).map(rowToPlayer);
    const buyins = (db
      .prepare("SELECT * FROM league_buyins ORDER BY player_name COLLATE NOCASE")
      .all() as BuyinRow[]).map(rowToBuyin);
    const teeTimes = (db
      .prepare("SELECT * FROM tee_times ORDER BY date ASC, time ASC")
      .all() as TeeTimeRow[]).map(rowToTeeTime);
    const tournaments = (db
      .prepare("SELECT * FROM tournaments ORDER BY window_start ASC")
      .all() as TournamentRow[]).map(rowToTournament);

    const members = players.filter((player) => player.member);
    if (members.length !== 12) {
      fail(`expected 12 member players, found ${members.length}`);
    }
    if (buyins.length !== members.length) {
      fail(`expected ${members.length} buy-in rows, found ${buyins.length}`);
    }
    if (tournaments.length < 9) {
      fail(`expected at least 9 tournaments, found ${tournaments.length}`);
    }

    const playerKeySet = new Set(members.map((player) => key(player.name)));
    const orphanBuyins = buyins.filter((buyin) => !playerKeySet.has(key(buyin.playerName)));
    if (orphanBuyins.length > 0) {
      fail(`buy-ins without member rows: ${orphanBuyins.map((b) => b.playerName).join(", ")}`);
    }

    const getHandicap = (name: string) =>
      players.find((player) => key(player.name) === key(name))?.handicap ?? null;
    const issues = auditLeagueRules(teeTimes, tournaments, players, today);

    let stopOneVerified = "skipped";
    if (!skipStopOneExpectation) {
      const stopOne = tournaments.find((tournament) => tournament.id === "2026-w1");
      if (!stopOne) fail("missing Stop 1 tournament row");
      const stopOneTeeTime = teeTimes.find(
        (teeTime) => teeTime.id === "cg-2026-05-18-posted-scores"
      );
      if (!stopOneTeeTime) fail("missing known Stop 1 posted-scores tee time");

      const scoreByKey = new Map(
        stopOneTeeTime.scores.map((score) => [key(score.name), score])
      );
      const claimKeys = new Set(stopOneTeeTime.claims.map((claim) => key(claim.name)));
      for (const expected of expectedStopOneScores) {
        const score = scoreByKey.get(key(expected.name));
        if (!score) fail(`missing Stop 1 score for ${expected.name}`);
        if (!claimKeys.has(key(expected.name))) {
          fail(`Stop 1 score exists but claim is missing for ${expected.name}`);
        }
        if (score.gross !== expected.gross || score.courseHcp !== expected.courseHcp) {
          fail(
            `Stop 1 score mismatch for ${expected.name}: expected ${expected.gross} gross / ${expected.courseHcp} CH, got ${score.gross} / ${score.courseHcp ?? "-"}`
          );
        }
        if (score.gross - score.courseHcp !== expected.net) {
          fail(`Stop 1 net mismatch for ${expected.name}`);
        }
      }

      const stopOneIssueCount = issues.filter(
        (issue) => issue.tournamentId === stopOne.id
      ).length;
      if (stopOneIssueCount === 0) {
        const board = computeTournamentLeaderboard(stopOne, teeTimes, getHandicap);
        const leader = board[0];
        if (leader?.name !== "Matt" || leader.bestNet !== 69) {
          fail(`Stop 1 leaderboard mismatch: expected Matt net 69 leader`);
        }
        const standings = sortStandings(
          computeStandings(teeTimes, getHandicap, tournaments),
          "seasonPoints"
        );
        const matt = standings.find((row) => row.name === "Matt");
        const jayson = standings.find((row) => row.name === "Jayson Post");
        if (matt?.seasonPoints !== 100 || matt.avgNet !== 69) {
          fail("season standings mismatch for Matt");
        }
        if (jayson?.seasonPoints !== 80 || jayson.avgNet !== 70) {
          fail("season standings mismatch for Jayson Post");
        }
        stopOneVerified = "official_verified";
      } else {
        stopOneVerified = "raw_scores_verified_attestation_pending";
      }
    }

    const launchChecks = readLaunchChecks(db);
    const risks = buildLaunchRisks({
      players,
      buyins,
      tournaments,
      ruleBlockerCount: issues.length,
      accessCodeRequired: Boolean(process.env.ACCESS_CODE),
      ...launchChecks.state,
    });
    const commissionerTasks = buildCommissionerTasks({
      players,
      buyins,
      tournaments,
      ruleIssues: issues,
      accessCodeRequired: Boolean(process.env.ACCESS_CODE),
      launchChecks: launchChecks.state,
    });
    const outstanding = buyins.reduce(
      (sum, buyin) => sum + (buyin.paid ? 0 : buyin.amount),
      0
    );
    const missingHandicaps = missingSourceBackedHandicapPlayers(members).map(
      (player) => player.name
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: dbPath,
          quickCheck,
          today,
          members: members.length,
          buyins: buyins.length,
          tournaments: tournaments.length,
          teeTimes: teeTimes.length,
          scoreReviewItems: issues.length,
          scoreReviewItemDetails: issues.map((issue) => ({
            date: issue.date,
            player: issue.player,
            message: issue.message,
          })),
          ruleBlockers: issues.length,
          ruleBlockerDetails: issues.map((issue) => ({
            date: issue.date,
            player: issue.player,
            message: issue.message,
          })),
          stopOneScores: stopOneVerified,
          money: {
            expected: buyins.reduce((sum, buyin) => sum + buyin.amount, 0),
            outstanding,
            paid: buyins.filter((buyin) => buyin.paid).length,
            total: buyins.length,
          },
          missingHandicaps,
          launchChecks: launchChecks.records,
          commissionerTasks: commissionerTasks.map((task) => ({
            severity: task.severity,
            area: task.area,
            title: task.title,
            detail: task.detail,
            copyReady: Boolean(task.copyText),
          })),
          remainingRisks: risks.map((risk) => ({
            severity: risk.severity,
            label: risk.label,
            detail: risk.detail,
            nextAction: risk.nextAction,
          })),
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
} catch (error) {
  console.error(
    `Live state verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
