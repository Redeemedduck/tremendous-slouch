import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { auditLeagueRules } from "./src/lib/audit";
import {
  buildBlockerHandoff,
  buildBlockerHandoffText,
} from "./src/lib/blockerHandoff";
import { buildCloseoutLedger } from "./src/lib/closeoutLedger";
import { buildCloseoutPacket } from "./src/lib/closeoutPacket";
import { buildCloseoutReadiness } from "./src/lib/closeoutReadiness";
import {
  buildPayoutEvidence,
  findMissingPayoutEvidence,
} from "./src/lib/payoutEvidence";
import {
  buildCommissionerRequestPacket,
  buildCommissionerTaskSummary,
  buildCommissionerTasks,
} from "./src/lib/commissionerTasks";
import {
  buildEvidenceGapPacket,
  buildEvidenceGapPacketText,
} from "./src/lib/evidenceGapPacket";
import { buildLaunchRisks } from "./src/lib/launchRisks";
import {
  buildLaunchGateChecklist,
  buildLaunchGateChecklistText,
} from "./src/lib/launchGateChecklist";
import { parseUnifiedBlockerIntake } from "./src/lib/bulkIntake";
import {
  buildCollectionAsk,
  buildHandicapAsk,
  buildScheduleAsk,
} from "./src/lib/requestCopy";
import { computeTournamentLeaderboard } from "./src/lib/tournamentLeaderboard";
import { computeStandings, sortStandings } from "./src/lib/standings";
import {
  ACTIVE_LEAGUE_RULES,
  ACTIVE_RULES_VERSION,
  LEAGUE_DEFAULT_BUYIN,
  POST_PAYOUTS,
  REGULAR_PAYOUT,
  STROKE_ADVANTAGES,
} from "./src/lib/leagueRules";
import {
  findPaymentEvidenceReviews,
  findPaymentNoteReviews,
} from "./src/lib/paymentNoteReview";
import { missingSourceBackedHandicapPlayers } from "./src/lib/handicapEvidence";
import {
  SOURCE_SEARCH_AS_OF,
  SOURCE_SEARCH_LEDGER,
  sourceSearchSummary,
} from "./src/lib/sourceSearchLedger";
import type { TeeTime as PublicTeeTime, Tournament as PublicTournament } from "./src/lib/types";

loadEnv({ path: [".env.local", ".env"], quiet: true });

// ============================================================
// DATABASE
// ============================================================
function migrateAndSeed(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS tee_times (
    id         TEXT PRIMARY KEY,
    course     TEXT NOT NULL,
    date       TEXT NOT NULL,            -- YYYY-MM-DD (naive local date)
    time       TEXT NOT NULL,            -- HH:MM 24h (naive local time)
    spots      INTEGER NOT NULL,
    host       TEXT NOT NULL,
    host_profile_subject_id TEXT,
    notes      TEXT,
    claims     TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tee_times_when ON tee_times(date, time);

  CREATE TABLE IF NOT EXISTS polls (
    id         TEXT PRIMARY KEY,
    prompt     TEXT NOT NULL,
    options    TEXT NOT NULL,            -- JSON: string[]
    responses  TEXT NOT NULL DEFAULT '[]', -- JSON: [{name, optionIdx, respondedAt}]
    host       TEXT NOT NULL,
    host_profile_subject_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_polls_created ON polls(created_at);

  CREATE TABLE IF NOT EXISTS players (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    handicap   REAL,
    handicap_source TEXT,
    handicap_note TEXT,
    ghin_number TEXT,
    handicap_source_type TEXT,
    handicap_verified_at TEXT,
    handicap_verified_by TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    course          TEXT NOT NULL,
    window_start    TEXT NOT NULL,            -- YYYY-MM-DD
    window_end      TEXT NOT NULL,            -- YYYY-MM-DD
    type            TEXT NOT NULL,            -- 'regular' | 'major' | 'post'
    points_to_first INTEGER,
    payout_first    INTEGER,
    payout_second   INTEGER,
    payout_third    INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tournaments_when ON tournaments(window_start, window_end);

  CREATE TABLE IF NOT EXISTS league_buyins (
    player_name TEXT PRIMARY KEY COLLATE NOCASE,
    amount      INTEGER NOT NULL DEFAULT 325,
    paid        INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_method TEXT,
    payment_actor TEXT,
    paid_at     TEXT,
    notes       TEXT,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS launch_checks (
    key         TEXT PRIMARY KEY,
    verified   INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    verified_by TEXT,
    note        TEXT,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id            TEXT PRIMARY KEY,
    action        TEXT NOT NULL,
    actor         TEXT NOT NULL,
    subject_type  TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    summary       TEXT NOT NULL,
    before_json   TEXT,
    after_json    TEXT,
    metadata_json TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_events_subject ON audit_events(subject_type, subject_id);

  CREATE TABLE IF NOT EXISTS verification_runs (
    id            TEXT PRIMARY KEY,
    command       TEXT NOT NULL,
    status        TEXT NOT NULL,
    scope_json    TEXT NOT NULL,
    summary       TEXT NOT NULL,
    recorded_by   TEXT NOT NULL,
    metadata_json TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_verification_runs_created ON verification_runs(created_at DESC);
`);

// Migrations. SQLite has no `ADD COLUMN IF NOT EXISTS`, so check the table_info.
const teeTimeColumns = db
  .prepare("PRAGMA table_info(tee_times)")
  .all() as { name: string }[];
if (!teeTimeColumns.some((c) => c.name === "interested")) {
  db.exec(
    "ALTER TABLE tee_times ADD COLUMN interested TEXT NOT NULL DEFAULT '[]'"
  );
}
if (!teeTimeColumns.some((c) => c.name === "scores")) {
  db.exec(
    "ALTER TABLE tee_times ADD COLUMN scores TEXT NOT NULL DEFAULT '[]'"
  );
}
if (!teeTimeColumns.some((c) => c.name === "comments")) {
  db.exec(
    "ALTER TABLE tee_times ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'"
  );
}
if (!teeTimeColumns.some((c) => c.name === "host_profile_subject_id")) {
  db.exec("ALTER TABLE tee_times ADD COLUMN host_profile_subject_id TEXT");
}
const pollColumns = db
  .prepare("PRAGMA table_info(polls)")
  .all() as { name: string }[];
if (!pollColumns.some((c) => c.name === "host_profile_subject_id")) {
  db.exec("ALTER TABLE polls ADD COLUMN host_profile_subject_id TEXT");
}
const playerColumns = db
  .prepare("PRAGMA table_info(players)")
  .all() as { name: string }[];
if (!playerColumns.some((c) => c.name === "member")) {
  db.exec(
    "ALTER TABLE players ADD COLUMN member INTEGER NOT NULL DEFAULT 0"
  );
}
if (!playerColumns.some((c) => c.name === "handicap_source")) {
  db.exec("ALTER TABLE players ADD COLUMN handicap_source TEXT");
}
if (!playerColumns.some((c) => c.name === "handicap_note")) {
  db.exec("ALTER TABLE players ADD COLUMN handicap_note TEXT");
}
if (!playerColumns.some((c) => c.name === "ghin_number")) {
  db.exec("ALTER TABLE players ADD COLUMN ghin_number TEXT");
}
if (!playerColumns.some((c) => c.name === "handicap_source_type")) {
  db.exec("ALTER TABLE players ADD COLUMN handicap_source_type TEXT");
}
if (!playerColumns.some((c) => c.name === "handicap_verified_at")) {
  db.exec("ALTER TABLE players ADD COLUMN handicap_verified_at TEXT");
}
if (!playerColumns.some((c) => c.name === "handicap_verified_by")) {
  db.exec("ALTER TABLE players ADD COLUMN handicap_verified_by TEXT");
}
const tournamentColumns = db
  .prepare("PRAGMA table_info(tournaments)")
  .all() as { name: string }[];
const addTournamentColumn = (name: string, ddl: string) => {
  if (!tournamentColumns.some((c) => c.name === name)) db.exec(ddl);
};
addTournamentColumn("closed_at", "ALTER TABLE tournaments ADD COLUMN closed_at TEXT");
addTournamentColumn("closed_by", "ALTER TABLE tournaments ADD COLUMN closed_by TEXT");
addTournamentColumn(
  "winner_snapshot",
  "ALTER TABLE tournaments ADD COLUMN winner_snapshot TEXT NOT NULL DEFAULT '[]'"
);
addTournamentColumn(
  "payout_confirmed",
  "ALTER TABLE tournaments ADD COLUMN payout_confirmed INTEGER NOT NULL DEFAULT 0"
);
addTournamentColumn(
  "payout_paid_at",
  "ALTER TABLE tournaments ADD COLUMN payout_paid_at TEXT"
);
addTournamentColumn(
  "closeout_notes",
  "ALTER TABLE tournaments ADD COLUMN closeout_notes TEXT"
);
addTournamentColumn(
  "payout_evidence_note",
  "ALTER TABLE tournaments ADD COLUMN payout_evidence_note TEXT"
);
const buyinColumns = db
  .prepare("PRAGMA table_info(league_buyins)")
  .all() as { name: string }[];
const addBuyinColumn = (name: string, ddl: string) => {
  if (!buyinColumns.some((c) => c.name === name)) db.exec(ddl);
};
addBuyinColumn(
  "payment_status",
  "ALTER TABLE league_buyins ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'"
);
addBuyinColumn(
  "payment_method",
  "ALTER TABLE league_buyins ADD COLUMN payment_method TEXT"
);
addBuyinColumn(
  "payment_actor",
  "ALTER TABLE league_buyins ADD COLUMN payment_actor TEXT"
);

// ============================================================
// SEED — 2026 league schedule + first-weekend Common Ground tee times.
// Idempotent: each row keyed by a deterministic id, INSERT OR IGNORE so
// re-running on an existing DB doesn't duplicate or overwrite hand-edits.
// ============================================================
const NOW_ISO = new Date().toISOString();
const stmtSeedTournament = db.prepare(`
  INSERT OR IGNORE INTO tournaments
  (id, name, course, window_start, window_end, type, points_to_first,
   payout_first, payout_second, payout_third, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
type SeedTournament = {
  id: string;
  name: string;
  course: string;
  window_start: string;
  window_end: string;
  type: "regular" | "major" | "post";
  points_to_first: number | null;
  payout_first: number | null;
  payout_second: number | null;
  payout_third: number | null;
  notes: string | null;
};
type SeedPlayer = {
  name: string;
  handicap: number | null;
};
const SEASON_PLAYERS: SeedPlayer[] = [
  { name: "Beck", handicap: null },
  { name: "Chris", handicap: null },
  { name: "Jayson Post", handicap: 10.6 },
  { name: "John", handicap: null },
  { name: "Jonny Ten Bosch", handicap: 6.4 },
  { name: "Kyle Dantzler", handicap: 3.6 },
  { name: "Matt", handicap: null },
  { name: "Max McCutcheon", handicap: 14.1 },
  { name: "Noah", handicap: null },
  { name: "Ryan", handicap: null },
  { name: "Sam Lines", handicap: 4.0 },
  { name: "Will", handicap: null },
];
const SEASON_TOURNAMENTS: SeedTournament[] = [
  {
    id: "2026-w1",
    name: "Stop 1 — Common Ground",
    course: "Common Ground",
    window_start: "2026-05-01",
    window_end: "2026-05-24",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: "Originally Murphy Creek; moved to Common Ground.",
  },
  {
    id: "2026-w2",
    name: "Stop 2 — Colorado National",
    course: "Colorado National",
    window_start: "2026-05-25",
    window_end: "2026-06-14",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-w3",
    name: "Stop 3 — Riverdale Dunes",
    course: "Riverdale Dunes",
    window_start: "2026-06-15",
    window_end: "2026-07-05",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-w4",
    name: "Stop 4 — Bear Dance",
    course: "Bear Dance",
    window_start: "2026-07-06",
    window_end: "2026-07-26",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-w5",
    name: "Stop 5 — Common Ground",
    course: "Common Ground",
    window_start: "2026-07-27",
    window_end: "2026-08-16",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-w6",
    name: "Stop 6 — Red Hawk Ridge",
    course: "Red Hawk Ridge",
    window_start: "2026-08-17",
    window_end: "2026-09-06",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-w7",
    name: "Stop 7 — Indian Peaks",
    course: "Indian Peaks",
    window_start: "2026-09-07",
    window_end: "2026-09-27",
    type: "regular",
    points_to_first: 100,
    payout_first: REGULAR_PAYOUT,
    payout_second: null,
    payout_third: null,
    notes: null,
  },
  {
    id: "2026-major",
    name: "Mid-season major",
    course: "TBD",
    window_start: "2026-07-15",
    window_end: "2026-07-15",
    type: "major",
    points_to_first: null, // major awards no season points per rules
    payout_first: null,
    payout_second: null,
    payout_third: null,
    notes: "Optional single-day live event with separate buy-in. Date + course TBD.",
  },
  {
    id: "2026-post",
    name: "Championship — 2-day post-season",
    course: "TBD",
    window_start: "2026-10-01",
    window_end: "2026-10-31",
    type: "post",
    points_to_first: null,
    payout_first: POST_PAYOUTS.first,
    payout_second: POST_PAYOUTS.second,
    payout_third: POST_PAYOUTS.third,
    notes: "Top-4 regular-season seeds get stroke advantages: -4 / -3 / -2 / -1.",
  },
];
for (const t of SEASON_TOURNAMENTS) {
  stmtSeedTournament.run(
    t.id,
    t.name,
    t.course,
    t.window_start,
    t.window_end,
    t.type,
    t.points_to_first,
    t.payout_first,
    t.payout_second,
    t.payout_third,
    t.notes,
    NOW_ISO
  );
}

const stmtSeedPlayer = db.prepare(`
  INSERT OR IGNORE INTO players (name, handicap, member, updated_at)
  VALUES (?, ?, 1, ?)
`);
const stmtSeedBuyin = db.prepare(`
  INSERT OR IGNORE INTO league_buyins
  (player_name, amount, paid, paid_at, notes, updated_at)
  VALUES (?, ?, 0, NULL, NULL, ?)
`);
for (const player of SEASON_PLAYERS) {
  stmtSeedPlayer.run(player.name, player.handicap, NOW_ISO);
  stmtSeedBuyin.run(player.name, LEAGUE_DEFAULT_BUYIN, NOW_ISO);
}

}

export function createDb(dbPath = process.env.DB_PATH ?? "golf_coordinator.db") {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  migrateAndSeed(database);
  return database;
}

type TeeTimeRow = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  host_profile_subject_id: string | null;
  notes: string | null;
  claims: string;
  interested: string;
  scores: string;
  comments: string;
  created_at: string;
};

type Claim = { name: string; claimedAt: string; profileSubjectId?: string | null };
type Interest = { name: string; interestedAt: string; profileSubjectId?: string | null };
type Score = {
  name: string;
  gross: number;
  net?: number | null;
  courseHcp?: number | null;
  attestedBy?: string | null;
  enteredBy?: string | null;
  attestationStatus?: "draft" | "pending" | "attested" | "overridden";
  attestedAt?: string | null;
  attestationActor?: string | null;
  courseHcpSource?: string | null;
  courseHcpVerifiedAt?: string | null;
  courseHcpOverride?: boolean;
  roundCourse?: string | null;
  roundDate?: string | null;
  teeName?: string | null;
  teeRating?: number | null;
  teeSlope?: number | null;
  teePar?: number | null;
  handicapIndexUsed?: number | null;
  calculatedCourseHcp?: number | null;
  courseHcpRounded?: number | null;
  recordedAt: string;
};
type Comment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  profileSubjectId?: string | null;
};

const rowToTeeTime = (row: TeeTimeRow) => ({
  id: row.id,
  course: row.course,
  date: row.date,
  time: row.time,
  spots: row.spots,
  host: row.host,
  notes: row.notes,
  claims: JSON.parse(row.claims) as Claim[],
  interested: JSON.parse(row.interested) as Interest[],
  scores: JSON.parse(row.scores) as Score[],
  comments: JSON.parse(row.comments) as Comment[],
  createdAt: row.created_at,
});

type PollRow = {
  id: string;
  prompt: string;
  options: string;
  responses: string;
  host: string;
  host_profile_subject_id: string | null;
  created_at: string;
};

type PollResponse = {
  name: string;
  optionIdx: number;
  respondedAt: string;
  profileSubjectId?: string | null;
};

const rowToPoll = (row: PollRow) => ({
  id: row.id,
  prompt: row.prompt,
  options: JSON.parse(row.options) as string[],
  responses: JSON.parse(row.responses) as PollResponse[],
  host: row.host,
  createdAt: row.created_at,
});

type AuditEventRow = {
  id: string;
  action: string;
  actor: string;
  subject_type: string;
  subject_id: string;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  metadata_json: string | null;
  created_at: string;
};

const parseOptionalJson = (value: string | null) =>
  value == null ? null : (JSON.parse(value) as unknown);

const rowToAuditEvent = (row: AuditEventRow) => ({
  id: row.id,
  action: row.action,
  actor: row.actor,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  summary: row.summary,
  before: parseOptionalJson(row.before_json),
  after: parseOptionalJson(row.after_json),
  metadata: parseOptionalJson(row.metadata_json),
  createdAt: row.created_at,
});

type VerificationRunRow = {
  id: string;
  command: string;
  status: string;
  scope_json: string;
  summary: string;
  recorded_by: string;
  metadata_json: string | null;
  created_at: string;
};

const rowToVerificationRun = (row: VerificationRunRow) => ({
  id: row.id,
  command: row.command,
  status: row.status as "passed" | "failed",
  scope: JSON.parse(row.scope_json) as string[],
  summary: row.summary,
  recordedBy: row.recorded_by,
  metadata: parseOptionalJson(row.metadata_json),
  createdAt: row.created_at,
});

// ============================================================
// PREPARED STATEMENTS
// ============================================================
export type CreateAppOptions = {
  serveAssets?: boolean;
};

function assertProductionAssets(staticDir: string) {
  const absoluteStaticDir = path.resolve(staticDir);
  const indexPath = path.join(absoluteStaticDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Production assets are missing at ${indexPath}; run npm run build before serving production assets`
    );
  }
  const html = fs.readFileSync(indexPath, "utf8");
  const assetRefs = Array.from(
    html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)
  ).map((match) => match[1]);
  if (assetRefs.length === 0) {
    throw new Error(
      `Production asset manifest in ${indexPath} does not reference built /assets files`
    );
  }
  for (const ref of assetRefs) {
    const relative = ref.replace(/^\/+/, "");
    const candidate = path.join(
      absoluteStaticDir,
      relative.startsWith("assets/") ? relative : relative.replace(/^.*?assets\//, "assets/")
    );
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `Production asset referenced by ${indexPath} is missing: ${candidate}`
      );
    }
  }
}

export function createApp(
  db: Database.Database,
  options: CreateAppOptions = {}
) {
  const app = express();
  const serveAssets =
    options.serveAssets ?? process.env.NODE_ENV === "production";
  const staticDir = process.env.STATIC_DIR || "dist";
  if (serveAssets) assertProductionAssets(staticDir);

const stmtSelectAll = db.prepare(
  `SELECT * FROM tee_times ORDER BY date ASC, time ASC`
);
const stmtSelectById = db.prepare(`SELECT * FROM tee_times WHERE id = ?`);
const stmtInsert = db.prepare(`
  INSERT INTO tee_times
    (id, course, date, time, spots, host, host_profile_subject_id, notes, claims, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING *
`);
const stmtUpdateClaims = db.prepare(
  `UPDATE tee_times SET claims = ? WHERE id = ? RETURNING *`
);
const stmtUpdateClaimsAndInterested = db.prepare(
  `UPDATE tee_times SET claims = ?, interested = ? WHERE id = ? RETURNING *`
);
const stmtUpdateInterested = db.prepare(
  `UPDATE tee_times SET interested = ? WHERE id = ? RETURNING *`
);
const stmtUpdateScores = db.prepare(
  `UPDATE tee_times SET scores = ? WHERE id = ? RETURNING *`
);
const stmtUpdateComments = db.prepare(
  `UPDATE tee_times SET comments = ? WHERE id = ? RETURNING *`
);
const stmtUpdateFields = db.prepare(
  `UPDATE tee_times
   SET course = ?, date = ?, time = ?, spots = ?, host = ?, host_profile_subject_id = ?, notes = ?
   WHERE id = ?
   RETURNING *`
);
const stmtUpdateIdentityFields = db.prepare(
  `UPDATE tee_times
   SET host = ?, host_profile_subject_id = ?, claims = ?, interested = ?, scores = ?, comments = ?
   WHERE id = ?
   RETURNING *`
);
const stmtDelete = db.prepare(`DELETE FROM tee_times WHERE id = ?`);

const stmtSelectAllPolls = db.prepare(
  `SELECT * FROM polls ORDER BY created_at DESC`
);
const stmtSelectPollById = db.prepare(`SELECT * FROM polls WHERE id = ?`);
const stmtInsertPoll = db.prepare(`
  INSERT INTO polls
    (id, prompt, options, responses, host, host_profile_subject_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  RETURNING *
`);
const stmtUpdatePollResponses = db.prepare(
  `UPDATE polls SET responses = ? WHERE id = ? RETURNING *`
);
const stmtDeletePoll = db.prepare(`DELETE FROM polls WHERE id = ?`);

type PlayerRow = {
  name: string;
  handicap: number | null;
  handicap_source: string | null;
  handicap_note: string | null;
  ghin_number: string | null;
  handicap_source_type: string | null;
  handicap_verified_at: string | null;
  handicap_verified_by: string | null;
  member: number;
  updated_at: string;
};

const rowToPlayer = (row: PlayerRow) => ({
  name: row.name,
  handicap: row.handicap,
  handicapSource: row.handicap_source ?? null,
  handicapNote: row.handicap_note ?? null,
  ghinNumber: row.ghin_number ?? null,
  handicapSourceType: row.handicap_source_type ?? null,
  handicapVerifiedAt: row.handicap_verified_at ?? null,
  handicapVerifiedBy: row.handicap_verified_by ?? null,
  member: !!row.member,
  updatedAt: row.updated_at,
});

const rowToPublicPlayer = (row: PlayerRow) => ({
  name: row.name,
  handicap: row.handicap,
  handicapSourceType: row.handicap_source_type ?? null,
  handicapVerifiedAt: row.handicap_verified_at ?? null,
  member: !!row.member,
  updatedAt: row.updated_at,
});

const stmtSelectAllPlayers = db.prepare(
  `SELECT * FROM players ORDER BY name COLLATE NOCASE ASC`
);
const stmtSelectPlayerByName = db.prepare(
  `SELECT * FROM players WHERE name = ? COLLATE NOCASE`
);

type BuyinRow = {
  player_name: string;
  amount: number;
  paid: number;
  payment_status: string | null;
  payment_method: string | null;
  payment_actor: string | null;
  paid_at: string | null;
  notes: string | null;
  updated_at: string;
};

type PaymentStatus = "unpaid" | "promised" | "paid" | "comped" | "refunded" | "disputed";
const PAYMENT_STATUSES = new Set<PaymentStatus>([
  "unpaid",
  "promised",
  "paid",
  "comped",
  "refunded",
  "disputed",
]);

const BACKUP_REQUIRED_TABLES = [
  "players",
  "tee_times",
  "tournaments",
  "league_buyins",
  "polls",
  "launch_checks",
  "audit_events",
  "verification_runs",
] as const;

const paidFromStatus = (status: string | null | undefined) =>
  status === "paid" || status === "comped";

const normalizePaymentStatus = (row: Pick<BuyinRow, "paid" | "payment_status">) => {
  const status = row.payment_status;
  if (row.paid && (!status || status === "unpaid")) return "paid";
  if (status && PAYMENT_STATUSES.has(status as PaymentStatus)) {
    return status as PaymentStatus;
  }
  return row.paid ? "paid" : "unpaid";
};

const rowToBuyin = (row: BuyinRow) => ({
  playerName: row.player_name,
  amount: row.amount,
  paid: paidFromStatus(normalizePaymentStatus(row)),
  paymentStatus: normalizePaymentStatus(row),
  paymentMethod: row.payment_method ?? null,
  paymentActor: row.payment_actor ?? null,
  paidAt: row.paid_at,
  notes: row.notes,
  updatedAt: row.updated_at,
});

const stmtSelectAllBuyins = db.prepare(
  `SELECT * FROM league_buyins ORDER BY player_name COLLATE NOCASE ASC`
);
const stmtSelectBuyin = db.prepare(
  `SELECT * FROM league_buyins WHERE player_name = ? COLLATE NOCASE`
);
const stmtInsertBuyin = db.prepare(`
  INSERT OR IGNORE INTO league_buyins (
    player_name,
    amount,
    paid,
    payment_status,
    payment_method,
    payment_actor,
    paid_at,
    notes,
    updated_at
  )
  VALUES (?, ?, 0, 'unpaid', NULL, NULL, NULL, NULL, ?)
`);
const stmtUpdateBuyin = db.prepare(`
  UPDATE league_buyins
  SET amount = ?,
      paid = ?,
      payment_status = ?,
      payment_method = ?,
      payment_actor = ?,
      paid_at = ?,
      notes = ?,
      updated_at = ?
  WHERE player_name = ? COLLATE NOCASE
`);
const stmtDeleteBuyin = db.prepare(
  `DELETE FROM league_buyins WHERE player_name = ? COLLATE NOCASE`
);
const stmtUpsertPlayer = db.prepare(`
  INSERT INTO players (
    name,
    handicap,
    handicap_source,
    handicap_note,
    ghin_number,
    handicap_source_type,
    handicap_verified_at,
    handicap_verified_by,
    member,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    handicap = excluded.handicap,
    handicap_source = excluded.handicap_source,
    handicap_note = excluded.handicap_note,
    ghin_number = excluded.ghin_number,
    handicap_source_type = excluded.handicap_source_type,
    handicap_verified_at = excluded.handicap_verified_at,
    handicap_verified_by = excluded.handicap_verified_by,
    member = excluded.member,
    updated_at = excluded.updated_at
  RETURNING *
`);

type TournamentRow = {
  id: string;
  name: string;
  course: string;
  window_start: string;
  window_end: string;
  type: string;
  points_to_first: number | null;
  payout_first: number | null;
  payout_second: number | null;
  payout_third: number | null;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  winner_snapshot: string;
  payout_confirmed: number;
  payout_paid_at: string | null;
  closeout_notes: string | null;
  payout_evidence_note: string | null;
};

const rowToTournament = (row: TournamentRow) => ({
  id: row.id,
  name: row.name,
  course: row.course,
  windowStart: row.window_start,
  windowEnd: row.window_end,
  type: row.type as "regular" | "major" | "post",
  pointsToFirst: row.points_to_first,
  payoutFirst: row.payout_first,
  payoutSecond: row.payout_second,
  payoutThird: row.payout_third,
  notes: row.notes,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  closedBy: row.closed_by,
  winnerSnapshot: JSON.parse(row.winner_snapshot) as unknown[],
  payoutConfirmed: !!row.payout_confirmed,
  payoutPaidAt: row.payout_paid_at,
  closeoutNotes: row.closeout_notes,
  payoutEvidenceNote: row.payout_evidence_note,
});

const stmtSelectAllTournaments = db.prepare(
  `SELECT * FROM tournaments ORDER BY window_start ASC, type ASC`
);
const stmtSelectTournamentById = db.prepare(
  `SELECT * FROM tournaments WHERE id = ?`
);
const stmtUpdateTournamentCloseout = db.prepare(`
  UPDATE tournaments
  SET closed_at = ?, closed_by = ?, winner_snapshot = ?, closeout_notes = ?
  WHERE id = ?
  RETURNING *
`);
const stmtReopenTournament = db.prepare(`
  UPDATE tournaments
  SET closed_at = NULL,
      closed_by = NULL,
      winner_snapshot = '[]',
      payout_confirmed = 0,
      payout_paid_at = NULL
  WHERE id = ?
  RETURNING *
`);
const stmtUpdateTournamentPayout = db.prepare(`
  UPDATE tournaments
  SET payout_confirmed = ?, payout_paid_at = ?, payout_evidence_note = ?
  WHERE id = ?
  RETURNING *
`);
const stmtUpdateTournamentDetails = db.prepare(`
  UPDATE tournaments
  SET course = ?,
      window_start = ?,
      window_end = ?,
      points_to_first = ?,
      payout_first = ?,
      payout_second = ?,
      payout_third = ?,
      notes = ?
  WHERE id = ?
  RETURNING *
`);
const stmtSelectClosedTournamentByDate = db.prepare(`
  SELECT * FROM tournaments
  WHERE closed_at IS NOT NULL
    AND ? BETWEEN window_start AND window_end
  LIMIT 1
`);
const LAUNCH_CHECK_DEFINITIONS = [
  {
    key: "dockerBuildVerified",
    label: "Docker image build",
    envVar: "DJDI_DOCKER_BUILD_VERIFIED",
  },
  {
    key: "tailnetServeVerified",
    label: "Tailscale Funnel smoke",
    envVar: "DJDI_TAILNET_URL_VERIFIED",
  },
  {
    key: "productionUrlVerified",
    label: "Production URL smoke",
    envVar: "DJDI_PRODUCTION_URL_VERIFIED",
  },
  {
    key: "mobileSafariVerified",
    label: "iPhone Safari golden path",
    envVar: "DJDI_MOBILE_SAFARI_VERIFIED",
  },
] as const;
type LaunchCheckKey = (typeof LAUNCH_CHECK_DEFINITIONS)[number]["key"];
type LaunchCheckRecordRow = {
  key: string;
  verified: number;
  verified_at: string | null;
  verified_by: string | null;
  note: string | null;
  updated_at: string;
};
const launchCheckKeys = new Set<string>(
  LAUNCH_CHECK_DEFINITIONS.map((definition) => definition.key)
);
const assertLaunchCheckKey: (key: string) => asserts key is LaunchCheckKey = (
  key
) => {
  if (!launchCheckKeys.has(key)) {
    throw new NotFoundError("Launch check not found");
  }
};
const launchCheckUrlRe = /https?:\/\/[^\s<>)]+/gi;
const localLaunchCheckUrlRe =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i;
const validateLaunchCheckEvidenceNote = (
  key: LaunchCheckKey,
  verified: boolean,
  value: string | null | undefined
) => {
  if (!verified) return null;
  const note = validateOptionalNotes(value);
  if (!note) {
    throw new ValidationError("Verified launch checks require an evidence note");
  }
  if (key === "productionUrlVerified") {
    const urls = note.match(launchCheckUrlRe) ?? [];
    if (urls.length === 0) {
      throw new ValidationError(
        "Production URL smoke evidence note must include the final URL"
      );
    }
    if (urls.some((url) => localLaunchCheckUrlRe.test(url))) {
      throw new ValidationError(
        "Production URL smoke evidence cannot use localhost or loopback URLs"
      );
    }
    if (!/remote smoke|verify:remote-smoke|smoke passed/i.test(note)) {
      throw new ValidationError(
        "Production URL smoke evidence note must mention remote smoke proof"
      );
    }
  }
  if (key === "mobileSafariVerified" && !/iphone/i.test(note)) {
    throw new ValidationError(
      "iPhone Safari evidence note must mention the physical iPhone"
    );
  }
  if (key === "mobileSafariVerified" && !/safari/i.test(note)) {
    throw new ValidationError("iPhone Safari evidence note must mention Safari");
  }
  if (key === "mobileSafariVerified") {
    const urls = note.match(launchCheckUrlRe) ?? [];
    if (urls.length === 0) {
      throw new ValidationError(
        "iPhone Safari evidence note must include the URL tested"
      );
    }
    if (urls.some((url) => localLaunchCheckUrlRe.test(url))) {
      throw new ValidationError(
        "iPhone Safari evidence cannot use localhost or loopback URLs"
      );
    }
  }
  return note;
};
const stmtSelectAllLaunchChecks = db.prepare(
  `SELECT * FROM launch_checks ORDER BY key ASC`
);
const stmtUpsertLaunchCheck = db.prepare(`
  INSERT INTO launch_checks (key, verified, verified_at, verified_by, note, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    verified = excluded.verified,
    verified_at = excluded.verified_at,
    verified_by = excluded.verified_by,
    note = excluded.note,
    updated_at = excluded.updated_at
`);
const stmtSelectAllRawTeeTimes = db.prepare(
  `SELECT * FROM tee_times ORDER BY date ASC, time ASC`
);
const stmtSelectAllRawPolls = db.prepare(
  `SELECT * FROM polls ORDER BY created_at DESC`
);
const stmtSelectAllAuditEvents = db.prepare(
  `SELECT * FROM audit_events ORDER BY created_at DESC, id DESC`
);
const stmtInsertAuditEvent = db.prepare(`
  INSERT INTO audit_events
  (id, action, actor, subject_type, subject_id, summary, before_json, after_json, metadata_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtSelectAllVerificationRuns = db.prepare(
  `SELECT * FROM verification_runs ORDER BY created_at DESC, id DESC`
);
const stmtSelectVerificationRunById = db.prepare(
  `SELECT * FROM verification_runs WHERE id = ?`
);
const stmtInsertVerificationRun = db.prepare(`
  INSERT INTO verification_runs
  (id, command, status, scope_json, summary, recorded_by, metadata_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// ============================================================
// ACCESS GATE
// ============================================================
// Optional shared access code stored in env. When set, all /api/* routes
// (except /api/access itself) require a matching `golf_access` cookie. When
// unset, the gate is disabled — convenient for local dev.
const COOKIE_NAME = "golf_access";
const COMMISSIONER_COOKIE_NAME = "golf_commissioner";
const PROFILE_COOKIE_NAME = "golf_profile";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

const getRequiredAccessCode = (): string | undefined => {
  const code = process.env.ACCESS_CODE?.trim();
  return code && code.length > 0 ? code : undefined;
};

const getRequiredCommissionerCode = (): string | undefined => {
  const code = process.env.COMMISSIONER_CODE?.trim();
  return code && code.length > 0 ? code : undefined;
};

const networkAccessStatus = () => {
  const magicDnsUrl =
    process.env.DJDI_MAGICDNS_URL?.trim() ||
    "https://duckbookpro.clouded-tailor.ts.net";
  const appUrl =
    process.env.DJDI_TAILNET_URL?.trim() ||
    "https://duckbookpro.clouded-tailor.ts.net";
  const apiUrl =
    process.env.DJDI_TAILNET_API_URL?.trim() ||
    "https://duckbookpro.clouded-tailor.ts.net/api";
  const directUrl =
    process.env.DJDI_DIRECT_TAILSCALE_URL?.trim() ||
    "http://100.102.92.28:3131";
  const phoneRootUrl =
    process.env.DJDI_PHONE_ROOT_URL?.trim() ||
    process.env.DJDI_DIRECT_TAILSCALE_ROOT_URL?.trim() ||
    "http://100.102.92.28:3131";
  const lanUrl =
    process.env.DJDI_LAN_URL?.trim() ||
    "http://192.168.8.210:3131";
  return {
    magicDnsUrl,
    appUrl,
    apiUrl,
    directUrl,
    phoneRootUrl,
    lanUrl,
    expectedDnsName:
      process.env.DJDI_TAILNET_DNS_NAME?.trim() ||
      "duckbookpro.clouded-tailor.ts.net",
    expectedTailscaleIp:
      process.env.DJDI_TAILSCALE_IP?.trim() || "100.102.92.28",
    magicDnsExplainer:
      "Canonical MagicDNS app route through Tailscale. Use it when the phone is connected to Tailscale and resolving tailnet DNS correctly.",
    directExplainer:
      "Primary phone route. Bypasses DNS and goes directly to this Mac's Tailscale IP.",
    phoneRootExplainer:
      "Primary phone route. Runs the app at the site root on a separate port, so it does not share the MagicDNS hostname path with another app.",
    lanExplainer:
      "Bypasses Tailscale entirely. Use only when the phone and this Mac are on the same Wi-Fi network.",
  };
};

const envFlag = (name: string) => process.env[name] === "1";

const launchCheckRecords = () => {
  const storedRows = new Map(
    (stmtSelectAllLaunchChecks.all() as LaunchCheckRecordRow[]).map((row) => [
      row.key,
      row,
    ])
  );
  return LAUNCH_CHECK_DEFINITIONS.map((definition) => {
    const row = storedRows.get(definition.key);
    const envVerified = envFlag(definition.envVar);
    const storedVerified = !!row?.verified;
    const source: "env" | "database" | "none" = envVerified
      ? "env"
      : storedVerified
        ? "database"
        : "none";
    return {
      key: definition.key,
      label: definition.label,
      envVar: definition.envVar,
      verified: envVerified || storedVerified,
      source,
      verifiedAt: row?.verified_at ?? null,
      verifiedBy: row?.verified_by ?? null,
      note: row?.note ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
};

const launchCheckState = () => {
  const records = launchCheckRecords();
  return {
    dockerBuildVerified:
      records.find((record) => record.key === "dockerBuildVerified")?.verified ??
      false,
    tailnetServeVerified:
      records.find((record) => record.key === "tailnetServeVerified")
        ?.verified ?? false,
    productionUrlRequired: process.env.DJDI_REQUIRE_PRODUCTION_URL === "1",
    productionUrlVerified:
      records.find((record) => record.key === "productionUrlVerified")
        ?.verified ?? false,
    mobileSafariVerified:
      records.find((record) => record.key === "mobileSafariVerified")
        ?.verified ?? false,
  };
};

const parseCookie = (
  header: string | undefined,
  name: string
): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return undefined;
};

const shouldUseSecureCookies = (req: express.Request) => {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === "https";
};

const setAccessCookie = (
  req: express.Request,
  res: express.Response,
  code: string
) => {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(code)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${shouldUseSecureCookies(req) ? "; Secure" : ""}`
  );
};

const setCommissionerCookie = (
  req: express.Request,
  res: express.Response,
  code: string
) => {
  res.setHeader(
    "Set-Cookie",
    `${COMMISSIONER_COOKIE_NAME}=${encodeURIComponent(code)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${shouldUseSecureCookies(req) ? "; Secure" : ""}`
  );
};

const profileSigningSecret = () =>
  process.env.PROFILE_SIGNING_SECRET?.trim() ||
  process.env.COMMISSIONER_CODE?.trim() ||
  process.env.ACCESS_CODE?.trim() ||
  "djdi-local-profile-session";

const signProfilePayload = (payload: string) =>
  createHmac("sha256", profileSigningSecret()).update(payload).digest("base64url");

const makeProfileCookieValue = (name: string, subjectId: string = randomUUID()) => {
  const payload = Buffer.from(
    JSON.stringify({
      name,
      subjectId,
      issuedAt: new Date().toISOString(),
    }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${signProfilePayload(payload)}`;
};

const readProfileCookie = (
  req: express.Request
): { name: string; subjectId: string | null } | null => {
  const cookie = parseCookie(req.headers.cookie, PROFILE_COOKIE_NAME);
  if (!cookie) return null;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;
  if (signProfilePayload(payload) !== signature) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.name === "string" && decoded.name.trim()
      ? {
          name: decoded.name.trim().slice(0, NAME_MAX),
          subjectId:
            typeof decoded.subjectId === "string" && decoded.subjectId.trim()
              ? decoded.subjectId.trim()
              : null,
        }
      : null;
  } catch {
    return null;
  }
};

const setProfileCookie = (
  req: express.Request,
  res: express.Response,
  name: string,
  subjectId?: string | null
) => {
  res.setHeader(
    "Set-Cookie",
    `${PROFILE_COOKIE_NAME}=${encodeURIComponent(makeProfileCookieValue(name, subjectId || undefined))}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${shouldUseSecureCookies(req) ? "; Secure" : ""}`
  );
};

const clearProfileCookie = (req: express.Request, res: express.Response) => {
  res.setHeader(
    "Set-Cookie",
    `${PROFILE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${shouldUseSecureCookies(req) ? "; Secure" : ""}`
  );
};

const hasCommissionerAccess = (req: express.Request) => {
  const required = getRequiredCommissionerCode();
  if (!required) return false;
  const cookie = parseCookie(req.headers.cookie, COMMISSIONER_COOKIE_NAME);
  return !!cookie && cookie === required;
};

const requireAccess: express.RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path === "/api/access") return next();
  const required = getRequiredAccessCode();
  if (!required) return next();
  const cookie = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (cookie && cookie === required) return next();
  res.status(401).json({ error: "Access required" });
};

const requireCommissioner: express.RequestHandler = (req, res, next) => {
  if (hasCommissionerAccess(req)) return next();
  res.status(403).json({ error: "Commissioner unlock required" });
};

// ============================================================
// VALIDATION
// ============================================================
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const NAME_MAX = 30;
const COURSE_MAX = 80;
const NOTES_MAX = 240;
const SPOTS_MIN = 1;
const SPOTS_MAX = 6;
const PROMPT_MAX = 140;
const OPTION_MAX = 60;
const POLL_OPTIONS_MIN = 2;
const POLL_OPTIONS_MAX = 8;
const HANDICAP_MIN = -10;
const HANDICAP_MAX = 54;
const SCORE_MIN = 1;
const SCORE_MAX = 300;
const COMMENT_MAX = 500;

class ValidationError extends Error {
  status = 400;
}
class ConflictError extends Error {
  status = 409;
}
class NotFoundError extends Error {
  status = 404;
}
class ForbiddenError extends Error {
  status = 403;
}

const TEST_TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const localTodayISO = () => {
  const override =
    process.env.DJDI_TODAY?.trim() || process.env.LIVE_STATE_TODAY?.trim();
  if (override && TEST_TODAY_RE.test(override)) return override;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const trimStr = (v: unknown, max: number, label: string) => {
  if (typeof v !== "string") throw new ValidationError(`${label} is required`);
  const trimmed = v.trim();
  if (!trimmed) throw new ValidationError(`${label} is required`);
  if (trimmed.length > max) throw new ValidationError(`${label} is too long`);
  return trimmed;
};

const validateDate = (value: unknown, label = "Date") => {
  const date = String(value ?? "");
  if (!DATE_RE.test(date)) {
    throw new ValidationError(`${label} must be YYYY-MM-DD`);
  }
  return date;
};

const validateNewTeeTime = (body: any) => {
  const course = trimStr(body?.course, COURSE_MAX, "Course");
  const host = trimStr(body?.host, NAME_MAX, "Host name");
  const date = validateDate(body?.date);
  const time = String(body?.time ?? "");
  if (!TIME_RE.test(time)) throw new ValidationError("Time must be HH:MM");
  // Sanity-check the time fields without doing timezone math: server stores
  // these as naive strings and lets the client interpret them in the user's
  // local timezone (single-region group).
  const [hh, mm] = time.split(":").map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new ValidationError("Time must be HH:MM");
  }
  const spots = Number(body?.spots);
  if (!Number.isInteger(spots) || spots < SPOTS_MIN || spots > SPOTS_MAX) {
    throw new ValidationError(
      `Spots must be an integer between ${SPOTS_MIN} and ${SPOTS_MAX}`
    );
  }
  let notes: string | null = null;
  if (body?.notes != null && String(body.notes).trim() !== "") {
    const trimmed = String(body.notes).trim();
    if (trimmed.length > NOTES_MAX) throw new ValidationError("Notes are too long");
    notes = trimmed;
  }
  return { course, host, date, time, spots, notes };
};

const validateNewPoll = (body: any) => {
  const prompt = trimStr(body?.prompt, PROMPT_MAX, "Prompt");
  const host = trimStr(body?.host, NAME_MAX, "Host name");
  const rawOptions = body?.options;
  if (!Array.isArray(rawOptions)) {
    throw new ValidationError("Options must be an array");
  }
  const options: string[] = [];
  for (const raw of rawOptions) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > OPTION_MAX) {
      throw new ValidationError("Option is too long");
    }
    options.push(trimmed);
  }
  if (options.length < POLL_OPTIONS_MIN) {
    throw new ValidationError(
      `Poll needs at least ${POLL_OPTIONS_MIN} options`
    );
  }
  if (options.length > POLL_OPTIONS_MAX) {
    throw new ValidationError(
      `Poll can have at most ${POLL_OPTIONS_MAX} options`
    );
  }
  // Reject duplicate options (case-insensitive) — they can't be distinguished
  // by the UI and would just be confusing.
  const seen = new Set<string>();
  for (const o of options) {
    const key = o.toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError("Options must be unique");
    }
    seen.add(key);
  }
  return { prompt, host, options };
};

// ============================================================
// TRANSACTIONS
// ============================================================
const normalizeName = (value: string) => value.trim().toLowerCase();

const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

const isOfficialScoreRecord = (score: Score) => {
  const status = score.attestationStatus;
  return (
    status === "attested" ||
    status === "overridden"
  );
};

const signedProfile = (req: express.Request) => readProfileCookie(req);

const signedProfileName = (req: express.Request) => signedProfile(req)?.name ?? null;

const signedProfileSubjectId = (req: express.Request) =>
  signedProfile(req)?.subjectId ?? null;

const profileSubjectIdForName = (req: express.Request, name: string) => {
  const profile = signedProfile(req);
  return profile && sameName(profile.name, name) ? profile.subjectId : null;
};

const claimSubjectIdForName = (
  req: express.Request,
  row: TeeTimeRow,
  name: string
) => {
  const playerSubjectId = profileSubjectIdForName(req, name);
  if (playerSubjectId) return playerSubjectId;
  if (hasCommissionerAccess(req)) return `commissioner:${randomUUID()}`;
  const profile = signedProfile(req);
  if (!profile) return null;
  try {
    assertCanManageTeeTime(req, row);
    return `host:${profile.subjectId ?? randomUUID()}`;
  } catch {
    return null;
  }
};

const requireProfileName = (req: express.Request) => {
  const name = signedProfileName(req);
  if (name) return name;
  throw new ForbiddenError("Player profile unlock required");
};

const assertProfileMayActAs = (req: express.Request, name: string) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfileName(req);
  if (profile && sameName(profile, name)) return;
  throw new ForbiddenError("You can only change your own player record");
};

const assertCanManageTeeTime = (req: express.Request, row: TeeTimeRow) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (
    profile &&
    sameName(profile.name, row.host) &&
    (!row.host_profile_subject_id ||
      row.host_profile_subject_id === profile.subjectId)
  ) {
    return;
  }
  throw new ForbiddenError("Only the host or commissioner can manage this tee time");
};

const assertCanManagePoll = (req: express.Request, row: PollRow) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (
    profile &&
    sameName(profile.name, row.host) &&
    (!row.host_profile_subject_id ||
      row.host_profile_subject_id === profile.subjectId)
  ) {
    return;
  }
  throw new ForbiddenError("Only the host or commissioner can delete this poll");
};

const assertCanChangeTeeParticipant = (
  req: express.Request,
  row: TeeTimeRow,
  name: string
) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (profile && sameName(profile.name, name)) {
    const claims = JSON.parse(row.claims) as Claim[];
    const interested = JSON.parse(row.interested) as Interest[];
    const existingClaim = claims.find((claim) => sameName(claim.name, name));
    const existingInterest = interested.find((interest) =>
      sameName(interest.name, name)
    );
    const existingSubjectId =
      existingClaim?.profileSubjectId ?? existingInterest?.profileSubjectId;
    if (!existingSubjectId || existingSubjectId === profile.subjectId) return;
    try {
      assertCanManageTeeTime(req, row);
      return;
    } catch {
      throw new ForbiddenError(
        "Only the existing player profile, host, or commissioner can change this spot"
      );
    }
  }
  try {
    assertCanManageTeeTime(req, row);
    return;
  } catch {
    // Fall through to the participant-facing error below.
  }
  throw new ForbiddenError("Only that player, the host, or commissioner can change this spot");
};

const assertProfileOwnsClaim = (
  req: express.Request,
  row: TeeTimeRow,
  name: string,
  action: string
) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (!profile || !sameName(profile.name, name)) {
    throw new ForbiddenError("Player profile unlock required");
  }
  const claims = JSON.parse(row.claims) as Claim[];
  const claim = claims.find((candidate) => sameName(candidate.name, name));
  if (!claim) {
    throw new ForbiddenError(`${name} does not have a spot on this tee time`);
  }
  if (claim.profileSubjectId && claim.profileSubjectId !== profile.subjectId) {
    throw new ForbiddenError(`Only the claimed player profile can ${action}`);
  }
};

const assertProfileOwnsInterest = (
  req: express.Request,
  row: TeeTimeRow,
  name: string,
  action: string
) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (!profile || !sameName(profile.name, name)) {
    throw new ForbiddenError("Player profile unlock required");
  }
  const interested = JSON.parse(row.interested) as Interest[];
  const interest = interested.find((candidate) => sameName(candidate.name, name));
  if (!interest) {
    throw new ForbiddenError(`${name} is not marked maybe on this tee time`);
  }
  if (interest.profileSubjectId && interest.profileSubjectId !== profile.subjectId) {
    throw new ForbiddenError(`Only the maybe player profile can ${action}`);
  }
};

const getAllTeeTimes = () =>
  (stmtSelectAllRawTeeTimes.all() as TeeTimeRow[]).map(rowToTeeTime);

const getAllPlayers = () =>
  (stmtSelectAllPlayers.all() as PlayerRow[]).map(rowToPlayer);

const getAllBuyins = () =>
  (stmtSelectAllBuyins.all() as BuyinRow[]).map(rowToBuyin);

const getAllPolls = () =>
  (stmtSelectAllRawPolls.all() as PollRow[]).map(rowToPoll);

const getAllTournaments = () =>
  (stmtSelectAllTournaments.all() as TournamentRow[]).map(rowToTournament);

const getAllVerificationRuns = () =>
  (stmtSelectAllVerificationRuns.all() as VerificationRunRow[]).map(
    rowToVerificationRun
  );

const publicTournament = (row: TournamentRow) =>
  rowToTournament(row) as PublicTournament;

const getHandicapFromPlayers = (players: ReturnType<typeof getAllPlayers>) => {
  const byKey = new Map(players.map((p) => [normalizeName(p.name), p.handicap]));
  return (name: string) => byKey.get(normalizeName(name)) ?? null;
};

function buildCompletionAudit({
  teeTimes,
  players,
  buyins,
  tournaments,
  ruleIssues,
  launchChecks,
  launchCheckEvidence,
  commissionerTasks,
  verificationRuns,
}: {
  teeTimes: ReturnType<typeof getAllTeeTimes>;
  players: ReturnType<typeof getAllPlayers>;
  buyins: ReturnType<typeof getAllBuyins>;
  tournaments: ReturnType<typeof getAllTournaments>;
  ruleIssues: ReturnType<typeof auditLeagueRules>;
  launchChecks: ReturnType<typeof launchCheckState>;
  launchCheckEvidence: ReturnType<typeof launchCheckRecords>;
  commissionerTasks: ReturnType<typeof buildCommissionerTasks>;
  verificationRuns: ReturnType<typeof getAllVerificationRuns>;
}) {
  const members = players.filter((player) => player.member);
  const missingHandicaps = missingSourceBackedHandicapPlayers(players);
  const expectedMoney = buyins.reduce((sum, buyin) => sum + buyin.amount, 0);
  const outstandingMoney = buyins.reduce(
    (sum, buyin) => sum + (buyin.paid ? 0 : buyin.amount),
    0
  );
  const paymentNoteReviews = findPaymentNoteReviews(buyins);
  const paymentEvidenceReviews = findPaymentEvidenceReviews(buyins);
  const unconfirmedEvents = tournaments.filter(
    (tournament) =>
      tournament.course.toLowerCase() === "tbd" ||
      tournament.notes?.toLowerCase().includes("tbd")
  );
  const closeoutTournaments = tournaments.filter(
    (tournament) => tournament.type !== "post"
  );
  const closeoutExpected = 8;
  const missingPayoutEvidence = findMissingPayoutEvidence(
    tournaments as PublicTournament[]
  );
  const today = localTodayISO();
  const getHandicap = getHandicapFromPlayers(players);
  const closeoutReadiness = closeoutTournaments.map((tournament) => {
    const readiness = buildCloseoutReadiness({
      tournament: tournament as PublicTournament,
      tournaments: tournaments as PublicTournament[],
      teeTimes: teeTimes as PublicTeeTime[],
      players,
      today,
      getHandicap,
    });
    return {
      tournament,
      readiness,
      packetUrl: `/api/export/closeout/${encodeURIComponent(tournament.id)}.txt`,
      ledgerUrl: `/api/export/closeout/${encodeURIComponent(tournament.id)}.json`,
    };
  });
  const closeoutArtifactUrls = [
    "/api/export/readiness.json",
    "/api/export/archive.json",
    ...closeoutReadiness.flatMap((item) => [item.packetUrl, item.ledgerUrl]),
  ];
  const allTasksCopyReady = commissionerTasks.every((task) => task.copyText);
  const latestPassedProof = verificationRuns.find((run) => run.status === "passed");
  const mobileUxProof = verificationRuns.find(
    (run) => run.status === "passed" && run.command === "npm run verify:mobile-ux"
  );
  const remoteMobileUxProof = verificationRuns.find(
    (run) =>
      run.status === "passed" &&
      run.command === "npm run verify:remote-mobile-ux"
  );
  const launchEvidence = new Map(
    launchCheckEvidence.map((check) => [check.key, check])
  );

  const itemDrafts: CompletionAuditItemDraft[] = [
    {
      id: "roster-members",
      area: "Roster",
      requirement: "Exactly 12 league members are seeded and exportable.",
      status: members.length === 12 ? "passed" : "open",
      proofStrength: "direct",
      evidence: [`${members.length}/12 member rows in players table`],
      artifactUrls: ["/api/export/roster.csv", "/api/export/season.json"],
      nextAction:
        members.length === 12 ? null : "Open Roster and reconcile member flags.",
    },
    {
      id: "roster-ghin",
      area: "Roster",
      requirement: "Every member has a source-backed handicap index recorded.",
      status: missingHandicaps.length === 0 ? "passed" : "open",
      proofStrength: "direct",
      evidence:
        missingHandicaps.length === 0
          ? ["All member handicap indexes have source, verification date, and verifier"]
          : [
              `${missingHandicaps.length} missing/unverified: ${missingHandicaps
                .map((player) => player.name)
                .join(", ")}`,
            ],
      artifactUrls: [
        "/api/export/roster.csv",
        "/api/export/source-search-ledger.json",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction:
        missingHandicaps.length === 0
          ? null
          : "Open Roster and record source-backed handicap indexes.",
    },
    {
      id: "money-ledger",
      area: "Money",
      requirement: "Every member has a buy-in ledger row.",
      status: buyins.length >= members.length ? "passed" : "open",
      proofStrength: "direct",
      evidence: [`${buyins.length} buy-in rows for ${members.length} members`],
      artifactUrls: ["/api/export/buyins.csv", "/api/export/season.json"],
      nextAction:
        buyins.length >= members.length
          ? null
          : "Open Money and create missing buy-in rows.",
    },
    {
      id: "money-collected",
      area: "Money",
      requirement: "All 2026 league buy-ins have settled status evidence.",
      status: outstandingMoney === 0 ? "passed" : "open",
      proofStrength: "direct",
      evidence: [
        `$${(expectedMoney - outstandingMoney).toLocaleString(
          "en-US"
        )} settled of $${expectedMoney.toLocaleString("en-US")}`,
        `$${outstandingMoney.toLocaleString("en-US")} outstanding`,
      ],
      artifactUrls: [
        "/api/export/buyins.csv",
        "/api/export/source-search-ledger.json",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction:
        outstandingMoney === 0
          ? null
          : "Open Money and record status evidence or leave outstanding.",
    },
    {
      id: "money-note-review",
      area: "Money",
      requirement:
        "Payment-like notes on unpaid buy-in rows are confirmed or cleared.",
      status: paymentNoteReviews.length === 0 ? "passed" : "open",
      proofStrength: "derived",
      evidence:
        paymentNoteReviews.length === 0
          ? ["No unpaid buy-in rows carry payment-like notes"]
          : [
              `${paymentNoteReviews.length} review needed: ${paymentNoteReviews
                .map((review) => `${review.playerName}: ${review.note}`)
                .join("; ")}`,
            ],
      artifactUrls: [
        "/api/export/buyins.csv",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
        "/api/export/risks.json",
        "/api/export/risks.csv",
      ],
      nextAction:
        paymentNoteReviews.length === 0
          ? null
          : "Open Money and confirm each note means paid, or clear/rewrite the note.",
    },
    {
      id: "money-paid-evidence",
      area: "Money",
      requirement: "Every paid buy-in row has a receipt/source evidence note.",
      status: paymentEvidenceReviews.length === 0 ? "passed" : "open",
      proofStrength: "derived",
      evidence:
        paymentEvidenceReviews.length === 0
          ? ["Every paid buy-in row has an evidence note"]
          : [
              `${paymentEvidenceReviews.length} paid row(s) missing evidence notes: ${paymentEvidenceReviews
                .map((review) => review.playerName)
                .join(", ")}`,
            ],
      artifactUrls: [
        "/api/export/buyins.csv",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
        "/api/export/risks.json",
        "/api/export/risks.csv",
      ],
      nextAction:
        paymentEvidenceReviews.length === 0
          ? null
          : "Open Money and add receipt/source notes for every paid row.",
    },
    {
      id: "score-rules",
      area: "Scoring",
      requirement: "League scores have no current rule blockers.",
      status: ruleIssues.length === 0 ? "passed" : "blocked",
      proofStrength: "derived",
      evidence: [`${ruleIssues.length} score rule blocker(s)`],
      artifactUrls: ["/api/export/readiness.json", "/api/export/scores.csv"],
      nextAction:
        ruleIssues.length === 0
          ? null
          : "Open Admin Score & Attestation Review, confirm or override each score, then rerun closeout.",
    },
    {
      id: "closeout-evidence",
      area: "Closeout",
      requirement: "Every non-post tournament has closeout readiness plus packet and ledger export paths.",
      status: closeoutReadiness.length >= closeoutExpected ? "passed" : "open",
      proofStrength: "derived",
      evidence: [
        `${closeoutReadiness.length}/${closeoutExpected} non-post tournaments expose closeout packets and ledgers`,
        `Readiness states: ${closeoutReadiness
          .map((item) => `${item.tournament.name}: ${item.readiness.status}`)
          .join("; ")}`,
      ],
      artifactUrls: closeoutArtifactUrls,
      nextAction:
        closeoutReadiness.length >= closeoutExpected
          ? null
          : "Confirm every regular tournament is seeded and exportable.",
    },
    {
      id: "payout-evidence",
      area: "Closeout",
      requirement: "Paid tournament payouts have settlement/evidence notes.",
      status: missingPayoutEvidence.length === 0 ? "passed" : "open",
      proofStrength: "derived",
      evidence:
        missingPayoutEvidence.length === 0
          ? ["No paid payouts are missing settlement notes"]
          : [
              `${missingPayoutEvidence.length} paid payout(s) missing settlement notes: ${missingPayoutEvidence
                .map((item) => item.tournament.name)
                .join(", ")}`,
            ],
      artifactUrls: closeoutArtifactUrls,
      nextAction:
        missingPayoutEvidence.length === 0
          ? null
          : "Open Tournament Closeout and add settlement notes for paid payouts.",
    },
    {
      id: "schedule-confirmed",
      area: "Schedule",
      requirement: "All seeded tournament courses/windows are confirmed.",
      status: unconfirmedEvents.length === 0 ? "passed" : "open",
      proofStrength: "direct",
      evidence:
        unconfirmedEvents.length === 0
          ? ["No tournament rows carry TBD course or notes"]
          : [
              `${unconfirmedEvents.length} TBD: ${unconfirmedEvents
                .map((tournament) => tournament.name)
                .join(", ")}`,
            ],
      artifactUrls: [
        "/api/export/readiness.json",
        "/api/export/source-search-ledger.json",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction:
        unconfirmedEvents.length === 0
          ? null
          : "Open Ops Schedule Confirmation and replace TBD details.",
    },
    {
      id: "commissioner-workflows",
      area: "Workflow",
      requirement: "Open commissioner tasks are copy-ready and mobile-safe.",
      status: allTasksCopyReady ? "passed" : "open",
      proofStrength: "derived",
      evidence: [
        `${commissionerTasks.filter((task) => task.copyText).length}/${
          commissionerTasks.length
        } open tasks include copy text`,
      ],
      artifactUrls: [
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
        "/api/export/request-packet.txt",
        "/api/export/blocker-handoff.json",
        "/api/export/blocker-handoff.txt",
        "/api/export/evidence-gap-packet.json",
        "/api/export/evidence-gap-packet.csv",
        "/api/export/evidence-gap-packet.txt",
      ],
      nextAction:
        allTasksCopyReady ? null : "Add copy payloads to every open task.",
    },
    {
      id: "admin-surface-inventory",
      area: "Admin",
      requirement:
        "Simplified Admin exposes every required commissioner workflow without hiding the full Operations workbench.",
      status: REQUIRED_ADMIN_SURFACES.length >= 13 ? "passed" : "open",
      proofStrength: "direct",
      evidence: [
        `Required Admin surfaces: ${REQUIRED_ADMIN_SURFACES.join(", ")}`,
        "Local and remote mobile verifiers exercise the Admin map, backup proof, exports, audit links, launch checks, and full Operations workbench.",
      ],
      artifactUrls: [
        "/api/export/completion-audit.json",
        "/api/export/readiness.json",
        "/api/export/database",
        "/api/backups/verify",
        "/api/export/audit.json",
        "/api/export/audit.csv",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
      ],
      nextAction:
        REQUIRED_ADMIN_SURFACES.length >= 13
          ? null
          : "Restore any missing Admin map surface or full Operations workbench link.",
    },
    {
      id: "phone-admin-proof",
      area: "Admin",
      requirement:
        "Phone-sized commissioner workflow proof is recorded in the verification ledger.",
      status: mobileUxProof || remoteMobileUxProof ? "passed" : "open",
      proofStrength: "direct",
      evidence: [
        mobileUxProof
          ? `Local mobile proof: ${mobileUxProof.command} at ${mobileUxProof.createdAt}`
          : "Local mobile proof is not recorded in this database",
        remoteMobileUxProof
          ? `Remote mobile proof: ${remoteMobileUxProof.command} at ${remoteMobileUxProof.createdAt}`
          : "Remote mobile proof is not recorded in this database",
      ],
      artifactUrls: [
        "/api/export/verification-runs.json",
        "/api/export/verification-runs.csv",
        "/api/export/completion-audit.json",
      ],
      nextAction:
        mobileUxProof || remoteMobileUxProof
          ? null
          : "Run npm run verify:mobile-ux or npm run verify:remote-mobile-ux and record the result.",
    },
    {
      id: "access-gate",
      area: "Runtime",
      requirement: "Shared access code is configured before public sharing.",
      status: getRequiredAccessCode() ? "passed" : "open",
      proofStrength: "external",
      evidence: [
        getRequiredAccessCode()
          ? "ACCESS_CODE is configured in this runtime"
          : "ACCESS_CODE is not configured in this runtime",
      ],
      artifactUrls: [
        "/api/access",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction: getRequiredAccessCode()
        ? null
        : "Set ACCESS_CODE in deployment environment before sharing the URL.",
    },
    {
      id: "docker-gate",
      area: "Launch",
      requirement: "Production Docker image has been smoke verified.",
      status: launchChecks.dockerBuildVerified ? "passed" : "open",
      proofStrength: "external",
      evidence: [
        launchEvidence.get("dockerBuildVerified")?.verified
          ? `Verified by ${
              launchEvidence.get("dockerBuildVerified")?.verifiedBy ?? "unknown"
            }`
          : "Docker gate not recorded as verified",
      ],
      artifactUrls: [
        "/api/launch-checks",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
        "/api/export/launch-gate-checklist.json",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction: launchChecks.dockerBuildVerified
        ? null
        : "Run npm run verify:docker, then mark Docker verified in Ops.",
    },
    {
      id: "tailnet-url-gate",
      area: "Launch",
      requirement: "Tailscale Funnel URL has passed Funnel status, health, remote smoke, and mobile smoke checks.",
      status: launchChecks.tailnetServeVerified ? "passed" : "open",
      proofStrength: "external",
      evidence: [
        launchEvidence.get("tailnetServeVerified")?.verified
          ? `Verified by ${
              launchEvidence.get("tailnetServeVerified")?.verifiedBy ?? "unknown"
            }`
          : "Tailscale Funnel gate not recorded as verified",
      ],
      artifactUrls: [
        "/api/launch-checks",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
        "/api/export/launch-gate-checklist.json",
        "/api/export/launch-gate-checklist.txt",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction: launchChecks.tailnetServeVerified
        ? null
        : "Run tailscale funnel status plus Funnel remote smoke/mobile checks, then mark verified.",
    },
    {
      id: "production-url-gate",
      area: "Launch",
      requirement:
        "Optional public/always-on URL has passed remote smoke when required.",
      status:
        launchChecks.productionUrlRequired
          ? launchChecks.productionUrlVerified
            ? "passed"
            : "open"
          : "passed",
      proofStrength: "external",
      evidence: [
        !launchChecks.productionUrlRequired
          ? "Private Tailscale hosting mode; public production URL is not required"
          : launchEvidence.get("productionUrlVerified")?.verified
          ? `Verified by ${
              launchEvidence.get("productionUrlVerified")?.verifiedBy ?? "unknown"
            }`
          : "Production URL gate not recorded as verified",
      ],
      artifactUrls: [
        "/api/launch-checks",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
        "/api/export/launch-gate-checklist.json",
        "/api/export/launch-gate-checklist.txt",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction:
        !launchChecks.productionUrlRequired || launchChecks.productionUrlVerified
          ? null
          : "Run remote smoke against the final public URL, then mark verified.",
    },
    {
      id: "iphone-safari-gate",
      area: "Launch",
      requirement: "Physical iPhone Safari golden path has been verified.",
      status: launchChecks.mobileSafariVerified ? "passed" : "open",
      proofStrength: "external",
      evidence: [
        launchEvidence.get("mobileSafariVerified")?.verified
          ? `Verified by ${
              launchEvidence.get("mobileSafariVerified")?.verifiedBy ?? "unknown"
            }`
          : "Physical iPhone Safari gate not recorded as verified",
      ],
      artifactUrls: [
        "/api/launch-checks",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
        "/api/export/launch-gate-checklist.json",
        "/api/export/launch-gate-checklist.txt",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
      ],
      nextAction: launchChecks.mobileSafariVerified
        ? null
        : "Complete physical iPhone Safari checklist, then mark verified in Ops.",
    },
    {
      id: "source-search-ledger",
      area: "Evidence",
      requirement:
        "Known source searches behind remaining data gaps are exportable.",
      status: SOURCE_SEARCH_LEDGER.length > 0 ? "passed" : "open",
      proofStrength: "direct",
      evidence: [
        `${SOURCE_SEARCH_LEDGER.length} source-search entries captured as of ${SOURCE_SEARCH_AS_OF}`,
        `Related open items: ${sourceSearchSummary(
          SOURCE_SEARCH_LEDGER
        ).relatedOpenItems.join(", ")}`,
      ],
      artifactUrls: [
        "/api/export/source-search-ledger.json",
        "/api/export/source-search-ledger.csv",
        "/api/export/evidence-gap-packet.json",
        "/api/export/evidence-gap-packet.txt",
        "/api/export/archive.json",
      ],
      nextAction:
        SOURCE_SEARCH_LEDGER.length > 0
          ? null
          : "Record the searched sources before using the request packet as the only remaining data path.",
    },
    {
      id: "proof-ledger",
      area: "Evidence",
      requirement: "Current proof runs are stored in the verification ledger.",
      status: latestPassedProof ? "passed" : "open",
      proofStrength: "direct",
      evidence: [
        latestPassedProof
          ? `Latest passed proof: ${latestPassedProof.command} at ${latestPassedProof.createdAt}`
          : "No passed verification run recorded",
      ],
      artifactUrls: [
        "/api/export/verification-runs.json",
        "/api/export/archive.json",
      ],
      nextAction: latestPassedProof
        ? null
        : "Run a verifier and record the result.",
    },
  ];

  const items = itemDrafts.map((item) => ({
    ...item,
    readinessScope: completionReadinessScope(item.id),
  }));
  const statusCounts = completionStatusCounts(items);
  const appItems = items.filter((item) => item.readinessScope === "app");
  const leagueDataItems = items.filter(
    (item) => item.readinessScope === "league_data"
  );
  const externalVerificationItems = items.filter(
    (item) => item.readinessScope === "external_verification"
  );
  const appStatusCounts = completionStatusCounts(appItems);
  const leagueDataStatusCounts = completionStatusCounts(leagueDataItems);
  const externalVerificationStatusCounts = completionStatusCounts(
    externalVerificationItems
  );
  return {
    statusCounts,
    ready: statusCounts.open === 0 && statusCounts.blocked === 0,
    appReady: appStatusCounts.open === 0 && appStatusCounts.blocked === 0,
    appStatusCounts,
    leagueDataStatusCounts,
    externalVerificationStatusCounts,
    leagueDataOpen:
      leagueDataStatusCounts.open + leagueDataStatusCounts.blocked,
    externalVerificationOpen:
      externalVerificationStatusCounts.open +
      externalVerificationStatusCounts.blocked,
    items,
  };
}

function assertTournamentOpenForTeeTime(row: TeeTimeRow) {
  const closed = stmtSelectClosedTournamentByDate.get(row.date) as
    | TournamentRow
    | undefined;
  if (closed) {
    throw new ConflictError(`${closed.name} is closed — reopen it before editing`);
  }
}

function auditTournamentForCloseout(tournament: TournamentRow) {
  const teeTimes = getAllTeeTimes();
  const tournaments = getAllTournaments();
  const players = getAllPlayers();
  const issues = auditLeagueRules(
    teeTimes,
    tournaments,
    players,
    "9999-12-31"
  ).filter((issue) => issue.tournamentId === tournament.id);
  return { teeTimes, tournaments, players, issues };
}

function exportSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tournament"
  );
}

function csvCell(value: unknown) {
  if (value == null) return "";
  const raw = String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function auditJson(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function auditActor(value: unknown, fallback = "Commissioner") {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, NAME_MAX) : fallback;
}

function recordAuditEvent({
  action,
  actor = "Commissioner",
  subjectType,
  subjectId,
  summary,
  before = null,
  after = null,
  metadata = null,
}: {
  action: string;
  actor?: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}) {
  stmtInsertAuditEvent.run(
    randomUUID(),
    action,
    auditActor(actor),
    subjectType,
    String(subjectId),
    summary.slice(0, 500),
    auditJson(before),
    auditJson(after),
    auditJson(metadata),
    new Date().toISOString()
  );
}

function sqliteQuickCheck(database: Database.Database, label: string) {
  const rows = database.prepare("PRAGMA quick_check").all() as Array<
    Record<string, unknown>
  >;
  const result = rows
    .map((row) => Object.values(row)[0])
    .filter(Boolean)
    .join("; ");
  if (result !== "ok") {
    throw new Error(`${label} quick_check returned ${result || "no result"}`);
  }
  return result;
}

async function verifySqliteBackup(database: Database.Database) {
  const backupPath = path.join(
    os.tmpdir(),
    `djdi-backup-proof-${Date.now()}-${randomUUID()}.db`
  );
  let backup: Database.Database | null = null;
  try {
    const sourceQuickCheck = sqliteQuickCheck(database, "source");
    await database.backup(backupPath);
    const backupStats = fs.statSync(backupPath);
    if (backupStats.size <= 0) {
      throw new Error("backup file is empty");
    }
    backup = new Database(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    const backupQuickCheck = sqliteQuickCheck(backup, "backup");
    const tables = (
      backup
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => String(row.name));
    const missingTables = BACKUP_REQUIRED_TABLES.filter(
      (table) => !tables.includes(table)
    );
    if (missingTables.length > 0) {
      throw new Error(`missing tables in backup: ${missingTables.join(", ")}`);
    }
    const count = (sql: string) =>
      Number((backup!.prepare(sql).get() as { count: number }).count);
    const counts = {
      members: count("SELECT COUNT(*) AS count FROM players WHERE member = 1"),
      buyins: count("SELECT COUNT(*) AS count FROM league_buyins"),
      tournaments: count("SELECT COUNT(*) AS count FROM tournaments"),
      teeTimes: count("SELECT COUNT(*) AS count FROM tee_times"),
      launchChecks: count("SELECT COUNT(*) AS count FROM launch_checks"),
      auditEvents: count("SELECT COUNT(*) AS count FROM audit_events"),
      verificationRuns: count("SELECT COUNT(*) AS count FROM verification_runs"),
    };
    return {
      ok: true,
      verifiedAt: new Date().toISOString(),
      backupBytes: backupStats.size,
      sourceQuickCheck,
      backupQuickCheck,
      tables: [...BACKUP_REQUIRED_TABLES],
      counts,
    };
  } finally {
    backup?.close();
    fs.rmSync(backupPath, { force: true });
  }
}

function validateStringList(value: unknown, label: string, maxItems = 24) {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list`);
  const items = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
  if (items.length === 0) throw new ValidationError(`${label} is required`);
  return items.map((item) => item.slice(0, 120));
}

function validateVerificationRun(body: any) {
  const command = trimStr(body?.command, 240, "Command");
  const status = String(body?.status ?? "").trim();
  if (status !== "passed" && status !== "failed") {
    throw new ValidationError("Status must be passed or failed");
  }
  const scope = validateStringList(body?.scope, "Scope");
  const summary = trimStr(body?.summary, 500, "Summary");
  const recordedBy = auditActor(body?.recordedBy, "Verifier");
  return {
    command,
    status: status as "passed" | "failed",
    scope,
    summary,
    recordedBy,
    metadata: body?.metadata ?? null,
  };
}

function recordVerificationRun({
  command,
  status,
  scope,
  summary,
  recordedBy,
  metadata = null,
}: {
  command: string;
  status: "passed" | "failed";
  scope: string[];
  summary: string;
  recordedBy: string;
  metadata?: unknown;
}) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  stmtInsertVerificationRun.run(
    id,
    command.slice(0, 240),
    status,
    JSON.stringify(scope),
    summary.slice(0, 500),
    auditActor(recordedBy),
    auditJson(metadata),
    createdAt
  );
  const row = stmtSelectVerificationRunById.get(id) as VerificationRunRow | undefined;
  if (!row) throw new Error("Failed to reload verification run");
  return rowToVerificationRun(row);
}

const validateOptionalNotes = (value: string | null | undefined) => {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (trimmed.length > NOTES_MAX) {
    throw new ValidationError("Notes are too long");
  }
  return trimmed || null;
};

const HANDICAP_SOURCE_TYPES = new Set([
  "ghin",
  "player_reply",
  "commissioner",
  "unknown",
]);

const validateOptionalGhinNumber = (value: unknown) => {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 32) throw new ValidationError("GHIN number is too long");
  if (!/^[0-9A-Za-z -]+$/.test(trimmed)) {
    throw new ValidationError("GHIN number can only use letters, numbers, spaces, or dashes");
  }
  return trimmed;
};

const inferHandicapSourceType = (source: string | null) => {
  if (!source) return "unknown";
  return /\b(ghin|cga|usga)\b/i.test(source) ? "ghin" : "player_reply";
};

const validateHandicapSourceType = (
  value: unknown,
  fallbackSource: string | null
) => {
  if (value == null || value === "") return inferHandicapSourceType(fallbackSource);
  const type = String(value).trim();
  if (!HANDICAP_SOURCE_TYPES.has(type)) {
    throw new ValidationError("Handicap source type must be ghin, player_reply, commissioner, or unknown");
  }
  return type;
};

const validateOptionalIsoDateTime = (value: unknown, label: string) => {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    throw new ValidationError(`${label} must be a valid date`);
  }
  return new Date(timestamp).toISOString();
};

const validateOptionalShortText = (
  value: unknown,
  max: number,
  label: string
) => {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new ValidationError(`${label} is too long`);
  return trimmed;
};

const validateOptionalNumberRange = (
  value: unknown,
  label: string,
  min: number,
  max: number,
  decimals = 1
) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new ValidationError(`${label} must be between ${min} and ${max}`);
  }
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const validateOptionalIntegerRange = (
  value: unknown,
  label: string,
  min: number,
  max: number
) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new ValidationError(`${label} must be a whole number between ${min} and ${max}`);
  }
  return numeric;
};

const roundToTenth = (value: number) => Math.round(value * 10) / 10;

const COURSE_HCP_SOURCES = new Set([
  "ghin",
  "calculated",
  "calculated_unverified",
  "manual_unverified",
  "commissioner_override",
]);

const requestedCourseHcpSource = (value: unknown) => {
  if (value == null || value === "") return null;
  const source = String(value).trim();
  if (!COURSE_HCP_SOURCES.has(source)) {
    throw new ValidationError(
      "Course handicap source must be ghin, calculated, calculated_unverified, manual_unverified, or commissioner_override"
    );
  }
  return source;
};

const calculateCourseHandicap = (
  handicapIndex: number,
  teeSlope: number,
  teeRating: number,
  teePar: number
) => roundToTenth(handicapIndex * (teeSlope / 113) + (teeRating - teePar));

const validateScoreHandicapEvidence = (
  body: any,
  row: TeeTimeRow,
  courseHcp: number | null
): Pick<
  Score,
  | "courseHcpSource"
  | "courseHcpVerifiedAt"
  | "courseHcpOverride"
  | "roundCourse"
  | "roundDate"
  | "teeName"
  | "teeRating"
  | "teeSlope"
  | "teePar"
  | "handicapIndexUsed"
  | "calculatedCourseHcp"
  | "courseHcpRounded"
> => {
  const teeName = validateOptionalShortText(body?.teeName, 40, "Tee name");
  const teeRating = validateOptionalNumberRange(
    body?.teeRating,
    "Course Rating",
    40,
    90,
    1
  );
  const teeSlope = validateOptionalIntegerRange(
    body?.teeSlope,
    "Slope Rating",
    55,
    155
  );
  const teePar = validateOptionalIntegerRange(body?.teePar, "Par", 27, 80);
  const handicapIndexUsed = validateOptionalNumberRange(
    body?.handicapIndexUsed,
    "Handicap Index",
    HANDICAP_MIN,
    HANDICAP_MAX,
    1
  );
  const hasFullCalculation =
    handicapIndexUsed != null &&
    teeSlope != null &&
    teeRating != null &&
    teePar != null;
  const calculatedCourseHcp = hasFullCalculation
    ? calculateCourseHandicap(handicapIndexUsed, teeSlope, teeRating, teePar)
    : null;
  const courseHcpRounded =
    calculatedCourseHcp == null ? null : Math.round(calculatedCourseHcp);
  const courseHcpOverride =
    courseHcp != null && courseHcpRounded != null && courseHcp !== courseHcpRounded;
  const requestedSource = requestedCourseHcpSource(body?.courseHcpSource);
  let courseHcpSource: string | null = null;
  if (courseHcp != null) {
    if (courseHcpOverride) courseHcpSource = "commissioner_override";
    else if (requestedSource === "ghin" && hasFullCalculation) courseHcpSource = "ghin";
    else if (requestedSource === "calculated_unverified" && hasFullCalculation) {
      courseHcpSource = "calculated_unverified";
    }
    else if (hasFullCalculation) courseHcpSource = "calculated";
    else courseHcpSource = "manual_unverified";
  }
  return {
    courseHcpSource,
    courseHcpVerifiedAt:
      courseHcpSource === "calculated" || courseHcpSource === "ghin"
        ? new Date().toISOString()
        : null,
    courseHcpOverride,
    roundCourse: row.course,
    roundDate: row.date,
    teeName,
    teeRating,
    teeSlope,
    teePar,
    handicapIndexUsed,
    calculatedCourseHcp,
    courseHcpRounded,
  };
};
const validateOptionalWholeNumber = (
  value: unknown,
  label: string,
  max = 100000
) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > max) {
    throw new ValidationError(
      `${label} must be a whole number between 0 and ${max}`
    );
  }
  return numeric;
};

const validatePaymentStatus = (value: unknown): PaymentStatus => {
  const status = String(value ?? "").trim();
  if (!PAYMENT_STATUSES.has(status as PaymentStatus)) {
    throw new ValidationError(
      "Payment status must be unpaid, promised, paid, comped, refunded, or disputed"
    );
  }
  return status as PaymentStatus;
};

const inferPaymentMethod = (note: string | null) => {
  if (!note) return null;
  const lower = note.toLowerCase();
  if (/\bvenmo\b/.test(lower)) return "venmo";
  if (/\bzelle\b/.test(lower)) return "zelle";
  if (/\bcash\b/.test(lower)) return "cash";
  if (/\bpaypal\b/.test(lower)) return "paypal";
  if (/\bapple\s*pay\b/.test(lower)) return "apple_pay";
  if (/\bcheck|cheque\b/.test(lower)) return "check";
  if (/\bcomp|waiv/.test(lower)) return "comp";
  return null;
};

const requireSettledPaymentEvidence = (
  paymentStatus: PaymentStatus,
  paymentMethod: string | null,
  paymentActor: string | null,
  notes: string | null,
  paidAt: string | null
) => {
  if (paymentStatus !== "paid" && paymentStatus !== "comped") return;
  if (!notes?.trim()) {
    throw new ValidationError("Paid buy-ins require a receipt or source note");
  }
  if (!paymentMethod?.trim()) {
    throw new ValidationError("Paid buy-ins require a payment method");
  }
  if (!paymentActor?.trim()) {
    throw new ValidationError("Paid buy-ins require a payment actor");
  }
  if (!paidAt?.trim()) {
    throw new ValidationError("Paid buy-ins require a payment date");
  }
};

type CompletionAuditStatus = "passed" | "open" | "blocked";
type CompletionReadinessScope =
  | "app"
  | "league_data"
  | "external_verification";

type CompletionAuditItem = {
  id: string;
  area: string;
  requirement: string;
  status: CompletionAuditStatus;
  readinessScope: CompletionReadinessScope;
  proofStrength: "direct" | "derived" | "external";
  evidence: string[];
  artifactUrls: string[];
  nextAction: string | null;
};

type CompletionAuditItemDraft = Omit<CompletionAuditItem, "readinessScope">;

const REQUIRED_ADMIN_SURFACES = [
  "roster/GHIN",
  "buy-ins",
  "tee-time oversight",
  "score review",
  "attestation review",
  "standings closeout",
  "payout closeout",
  "launch checks",
  "database backup download",
  "backup restore proof",
  "exports",
  "audit log",
  "advanced ops",
] as const;

const completionReadinessScope = (id: string): CompletionReadinessScope => {
  if (
    [
      "roster-ghin",
      "money-collected",
      "money-note-review",
      "money-paid-evidence",
      "score-rules",
      "payout-evidence",
      "schedule-confirmed",
    ].includes(id)
  ) {
    return "league_data";
  }
  if (id === "iphone-safari-gate") return "external_verification";
  return "app";
};

type SourceSearchEntry = (typeof SOURCE_SEARCH_LEDGER)[number];

function completionStatusCounts(items: CompletionAuditItem[]) {
  return {
    passed: items.filter((item) => item.status === "passed").length,
    open: items.filter((item) => item.status === "open").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}

function sourceSearchLedgerCsv(entries: SourceSearchEntry[]) {
  return [
    csvLine([
      "id",
      "area",
      "claim_type",
      "status",
      "claim",
      "source_checked",
      "result",
      "decision",
      "evidence_ids",
      "related_open_items",
    ]),
    ...entries.map((entry) =>
      csvLine([
        entry.id,
        entry.area,
        entry.claimType,
        entry.status,
        entry.claim,
        entry.sourceChecked,
        entry.result,
        entry.decision,
        entry.evidenceIds.join(" | "),
        entry.relatedOpenItems.join(" | "),
      ])
    ),
  ].join("\n");
}

function completionAuditCsv(items: CompletionAuditItem[]) {
  return [
    csvLine([
      "id",
      "area",
      "requirement",
      "status",
      "readiness_scope",
      "proof_strength",
      "evidence",
      "next_action",
      "artifact_urls",
    ]),
    ...items.map((item) =>
      csvLine([
        item.id,
        item.area,
        item.requirement,
        item.status,
        item.readinessScope,
        item.proofStrength,
        item.evidence.join(" | "),
        item.nextAction ?? "",
        item.artifactUrls.join(" | "),
      ])
    ),
  ].join("\n");
}

function launchRisksCsv(risks: ReturnType<typeof buildLaunchRisks>) {
  return [
    csvLine(["id", "severity", "label", "detail", "next_action"]),
    ...risks.map((risk) =>
      csvLine([
        risk.id,
        risk.severity,
        risk.label,
        risk.detail,
        risk.nextAction,
      ])
    ),
  ].join("\n");
}

function commissionerTasksCsv(
  tasks: ReturnType<typeof buildCommissionerTasks>
) {
  return [
    csvLine([
      "id",
      "area",
      "severity",
      "title",
      "detail",
      "next_action",
      "items",
      "copy_text",
      "done",
    ]),
    ...tasks.map((task) =>
      csvLine([
        task.id,
        task.area,
        task.severity,
        task.title,
        task.detail,
        task.nextAction,
        task.items.join(" | "),
        task.copyText ?? "",
        task.done ? "yes" : "no",
      ])
    ),
  ].join("\n");
}

function evidenceGapPacketCsv(
  items: ReturnType<typeof buildEvidenceGapPacket>["items"]
) {
  return [
    csvLine([
      "id",
      "area",
      "blocker_id",
      "label",
      "owner",
      "requested_evidence",
      "paste_back_template",
      "intake_path",
      "source_status",
      "source_decision",
      "related_task_id",
    ]),
    ...items.map((item) =>
      csvLine([
        item.id,
        item.area,
        item.blockerId,
        item.label,
        item.owner,
        item.requestedEvidence,
        item.pasteBackTemplate,
        item.intakePath,
        item.sourceStatus,
        item.sourceDecision,
        item.relatedTaskId ?? "",
      ])
    ),
  ].join("\n");
}

function launchChecksCsv(records: ReturnType<typeof launchCheckRecords>) {
  return [
    csvLine([
      "key",
      "label",
      "verified",
      "source",
      "verified_at",
      "verified_by",
      "note",
      "env_var",
      "updated_at",
    ]),
    ...records.map((record) =>
      csvLine([
        record.key,
        record.label,
        record.verified ? "yes" : "no",
        record.source,
        record.verifiedAt ?? "",
        record.verifiedBy ?? "",
        record.note ?? "",
        record.envVar,
        record.updatedAt ?? "",
      ])
    ),
  ].join("\n");
}

function launchGateChecklistCsv(
  items: ReturnType<typeof buildLaunchGateChecklist>["items"]
) {
  return [
    csvLine([
      "key",
      "label",
      "status",
      "source",
      "verified_at",
      "verified_by",
      "note",
      "env_var",
      "step_count",
      "steps",
      "final_action",
    ]),
    ...items.map((item) =>
      csvLine([
        item.key,
        item.label,
        item.status,
        item.source,
        item.verifiedAt ?? "",
        item.verifiedBy ?? "",
        item.note ?? "",
        item.envVar,
        item.steps.length,
        item.steps
          .map((step) => `${step.label} Evidence: ${step.requiredEvidence}`)
          .join(" | "),
        item.finalAction,
      ])
    ),
  ].join("\n");
}

function sha256Json(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function assertClaimIsNotScoreLocked(row: TeeTimeRow, name: string) {
  const lower = normalizeName(name);
  const scores = JSON.parse(row.scores) as Score[];
  const locksScore = scores.some(
    (score) =>
      normalizeName(score.name) === lower ||
      (score.attestedBy != null && normalizeName(score.attestedBy) === lower)
  );
  if (locksScore) {
    throw new ConflictError(
      "Remove the score before changing a scored player or attester claim"
    );
  }
}

const claimTx = db.transaction(
  (
    teeId: string,
    claimerName: string,
    claimedAt: string,
    profileSubjectId: string | null
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const claims = JSON.parse(row.claims) as Claim[];
    const interested = JSON.parse(row.interested) as Interest[];
    const lower = claimerName.toLowerCase();
    if (claims.some((c) => c.name.toLowerCase() === lower)) {
      throw new ConflictError("That name already has a spot");
    }
    if (claims.length >= row.spots) throw new ConflictError("That tee time is full");
    // If the claimer was on the interested list, move them off it.
    const remainingInterested = interested.filter(
      (i) => i.name.toLowerCase() !== lower
    );
    claims.push({
      name: claimerName,
      claimedAt,
      profileSubjectId,
    });
    return stmtUpdateClaimsAndInterested.get(
      JSON.stringify(claims),
      JSON.stringify(remainingInterested),
      teeId
    ) as TeeTimeRow;
  }
);

const dropTx = db.transaction(
  (teeId: string, claimerName: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const claims = JSON.parse(row.claims) as Claim[];
    const lower = claimerName.toLowerCase();
    const idx = claims.findIndex((c) => c.name.toLowerCase() === lower);
    if (idx === -1) throw new NotFoundError("No claim by that name");
    assertClaimIsNotScoreLocked(row, claimerName);
    claims.splice(idx, 1);
    return stmtUpdateClaims.get(JSON.stringify(claims), teeId) as TeeTimeRow;
  }
);

const interestTx = db.transaction(
  (
    teeId: string,
    claimerName: string,
    interestedAt: string,
    profileSubjectId: string | null
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const claims = JSON.parse(row.claims) as Claim[];
    const interested = JSON.parse(row.interested) as Interest[];
    const lower = claimerName.toLowerCase();
    if (interested.some((i) => i.name.toLowerCase() === lower)) {
      throw new ConflictError("That name is already marked maybe");
    }
    if (claims.some((c) => c.name.toLowerCase() === lower)) {
      assertClaimIsNotScoreLocked(row, claimerName);
    }
    // If the person was claimed, move them to interested.
    const remainingClaims = claims.filter(
      (c) => c.name.toLowerCase() !== lower
    );
    interested.push({ name: claimerName, interestedAt, profileSubjectId });
    return stmtUpdateClaimsAndInterested.get(
      JSON.stringify(remainingClaims),
      JSON.stringify(interested),
      teeId
    ) as TeeTimeRow;
  }
);

const dropInterestTx = db.transaction(
  (teeId: string, claimerName: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const interested = JSON.parse(row.interested) as Interest[];
    const lower = claimerName.toLowerCase();
    const idx = interested.findIndex(
      (i) => i.name.toLowerCase() === lower
    );
    if (idx === -1) throw new NotFoundError("No maybe by that name");
    interested.splice(idx, 1);
    return stmtUpdateInterested.get(
      JSON.stringify(interested),
      teeId
    ) as TeeTimeRow;
  }
);

// Upsert a score for one player on a past tee time. Replaces the existing
// score if (case-insensitive) name already has one. Enforces the league
// attestation rule when the tee time falls inside a non-post tournament
// window: attestedBy must be (a) one of the other claims, (b) a registered
// member, and (c) not the scorer themselves.
const stmtSelectMatchingTournaments = db.prepare(`
  SELECT * FROM tournaments
  WHERE type != 'post'
    AND ? BETWEEN window_start AND window_end
  LIMIT 1
`);
const stmtSelectMemberByName = db.prepare(
  `SELECT * FROM players WHERE name = ? COLLATE NOCASE AND member = 1`
);
const recordScoreTx = db.transaction(
  (
    teeId: string,
    name: string,
    gross: number,
    courseHcp: number | null,
    attestedBy: string | null,
    enteredBy: string | null,
    handicapEvidence: ReturnType<typeof validateScoreHandicapEvidence>
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const claims = JSON.parse(row.claims) as Claim[];
    const lowerScorer = normalizeName(name);

    // Is this tee time inside a non-post tournament window?
    const inTournament = stmtSelectMatchingTournaments.get(row.date) as
      | TournamentRow
      | undefined;
    if (inTournament) {
      const scorerOnTeeTime = claims.some(
        (c) => normalizeName(c.name) === lowerScorer
      );
      if (!scorerOnTeeTime) {
        throw new ValidationError(
          "Player must claim this tee time before recording a score"
        );
      }
      const scorerMemberRow = stmtSelectMemberByName.get(name) as
        | PlayerRow
        | undefined;
      if (!scorerMemberRow) {
        throw new ValidationError(
          `${name} isn't a registered member — drop-ins can't record league scores`
        );
      }
      if (courseHcp == null) {
        throw new ValidationError(
          "League rounds need a course handicap from GHIN"
        );
      }
      if (!attestedBy) {
        throw new ValidationError(
          "League rounds need an attester (another member who played in your group)"
        );
      }
      const lowerAttester = normalizeName(attestedBy);
      if (lowerAttester === lowerScorer) {
        throw new ValidationError("Attester can't be the scorer themselves");
      }
      const attesterOnTeeTime = claims.some(
        (c) => normalizeName(c.name) === lowerAttester
      );
      if (!attesterOnTeeTime) {
        throw new ValidationError(
          `${attestedBy} wasn't on this tee time — pick someone who played in your group`
        );
      }
      const memberRow = stmtSelectMemberByName.get(attestedBy) as
        | PlayerRow
        | undefined;
      if (!memberRow) {
        throw new ValidationError(
          `${attestedBy} isn't a registered member — drop-ins can't attest scores`
        );
      }
    }

    const scores = JSON.parse(row.scores) as Score[];
    const idx = scores.findIndex((s) => s.name.toLowerCase() === lowerScorer);
    const entry: Score = {
      name,
      gross,
      net: courseHcp == null ? null : gross - courseHcp,
      courseHcp,
      attestedBy: attestedBy ?? null,
      enteredBy,
      attestationStatus: attestedBy ? "pending" : "draft",
      attestedAt: null,
      attestationActor: null,
      ...handicapEvidence,
      recordedAt: new Date().toISOString(),
    };
    if (idx === -1) scores.push(entry);
    else scores[idx] = entry;
    return stmtUpdateScores.get(JSON.stringify(scores), teeId) as TeeTimeRow;
  }
);

const attestScoreTx = db.transaction(
  (
    teeId: string,
    name: string,
    actor: string,
    commissionerOverride: boolean
  ): { row: TeeTimeRow; before: Score; after: Score } => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const scores = JSON.parse(row.scores) as Score[];
    const idx = scores.findIndex((s) => sameName(s.name, name));
    if (idx === -1) throw new NotFoundError("No score by that name");
    const before = scores[idx];
    if (!before.attestedBy) {
      throw new ValidationError("Score has no selected attester");
    }
    if (!commissionerOverride && !sameName(actor, before.attestedBy)) {
      throw new ForbiddenError("Only the selected attester can confirm this score");
    }
    const after: Score = {
      ...before,
      attestationStatus: commissionerOverride ? "overridden" : "attested",
      attestedAt: new Date().toISOString(),
      attestationActor: actor,
    };
    scores[idx] = after;
    const updated = stmtUpdateScores.get(JSON.stringify(scores), teeId) as TeeTimeRow;
    return { row: updated, before, after };
  }
);

// Append a free-text comment under the signed browser profile. The display
// name can be re-saved by the client, but the stable subject id remains the
// server boundary for later delete permissions.
const addCommentTx = db.transaction(
  (
    teeId: string,
    author: string,
    body: string,
    commentId: string,
    createdAt: string,
    profileSubjectId: string | null
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const comments = JSON.parse(row.comments) as Comment[];
    comments.push({ id: commentId, author, body, createdAt, profileSubjectId });
    return stmtUpdateComments.get(
      JSON.stringify(comments),
      teeId
    ) as TeeTimeRow;
  }
);

const updateCommentTx = db.transaction(
  (
    teeId: string,
    commentId: string,
    body: string,
    editedAt: string
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const comments = JSON.parse(row.comments) as Comment[];
    const idx = comments.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new NotFoundError("Comment not found");
    comments[idx] = { ...comments[idx], body, editedAt };
    return stmtUpdateComments.get(
      JSON.stringify(comments),
      teeId
    ) as TeeTimeRow;
  }
);

const removeCommentTx = db.transaction(
  (teeId: string, commentId: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const comments = JSON.parse(row.comments) as Comment[];
    const idx = comments.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new NotFoundError("Comment not found");
    comments.splice(idx, 1);
    return stmtUpdateComments.get(
      JSON.stringify(comments),
      teeId
    ) as TeeTimeRow;
  }
);

const assertCanManageComment = (
  req: express.Request,
  comment: Comment,
  action: string
) => {
  if (hasCommissionerAccess(req)) return;
  const profile = signedProfile(req);
  if (!profile || !sameName(profile.name, comment.author)) {
    throw new ForbiddenError(`You can only ${action} your own comments`);
  }
  if (comment.profileSubjectId && comment.profileSubjectId !== profile.subjectId) {
    throw new ForbiddenError(`Only the profile that wrote this comment can ${action} it`);
  }
};

// Remove a score entry (host wants to undo / fix a mistake).
const removeScoreTx = db.transaction(
  (teeId: string, name: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    assertTournamentOpenForTeeTime(row);
    const scores = JSON.parse(row.scores) as Score[];
    const lower = name.toLowerCase();
    const idx = scores.findIndex((s) => s.name.toLowerCase() === lower);
    if (idx === -1) throw new NotFoundError("No score by that name");
    scores.splice(idx, 1);
    return stmtUpdateScores.get(JSON.stringify(scores), teeId) as TeeTimeRow;
  }
);

const replaceName = (value: string, from: string, to: string) =>
  sameName(value, from) ? to : value;

const dedupeNamed = <T extends { name: string }>(items: T[]) => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const itemKey = normalizeName(item.name);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    result.push(item);
  }
  return result;
};

const renamePlayerTx = db.transaction(
  (from: string, to: string, createPlayer: boolean) => {
    const fromRow = stmtSelectPlayerByName.get(from) as PlayerRow | undefined;
    const toRow = stmtSelectPlayerByName.get(to) as PlayerRow | undefined;
    if (!toRow && !createPlayer) {
      throw new ValidationError("Target player does not exist");
    }

    const now = new Date().toISOString();
    if (!toRow) {
      stmtUpsertPlayer.get(
        to,
        fromRow?.handicap ?? null,
        fromRow?.handicap_source ?? null,
        fromRow?.handicap_note ?? null,
        fromRow?.ghin_number ?? null,
        fromRow?.handicap_source_type ?? null,
        fromRow?.handicap_verified_at ?? null,
        fromRow?.handicap_verified_by ?? null,
        fromRow?.member ?? 0,
        now
      );
    } else if (fromRow?.member === 1 && toRow.member !== 1) {
      stmtUpsertPlayer.get(
        toRow.name,
        toRow.handicap,
        toRow.handicap_source,
        toRow.handicap_note,
        toRow.ghin_number,
        toRow.handicap_source_type,
        toRow.handicap_verified_at,
        toRow.handicap_verified_by,
        1,
        now
      );
      stmtInsertBuyin.run(toRow.name, LEAGUE_DEFAULT_BUYIN, now);
    }

    const fromBuyin = stmtSelectBuyin.get(from) as BuyinRow | undefined;
    const toBuyin = stmtSelectBuyin.get(to) as BuyinRow | undefined;
    if (fromBuyin && !toBuyin) {
      stmtInsertBuyin.run(to, fromBuyin.amount, now);
      stmtUpdateBuyin.run(
        fromBuyin.amount,
        paidFromStatus(normalizePaymentStatus(fromBuyin)) ? 1 : 0,
        normalizePaymentStatus(fromBuyin),
        fromBuyin.payment_method,
        fromBuyin.payment_actor,
        fromBuyin.paid_at,
        fromBuyin.notes,
        now,
        to
      );
    }
    if (fromBuyin) stmtDeleteBuyin.run(from);

    const rows = stmtSelectAllRawTeeTimes.all() as TeeTimeRow[];
    let teeTimesChanged = 0;
    for (const row of rows) {
      const claims = dedupeNamed(
        (JSON.parse(row.claims) as Claim[]).map((claim) => {
          const renamed = sameName(claim.name, from);
          return {
            ...claim,
            name: replaceName(claim.name, from, to),
            profileSubjectId: renamed ? null : claim.profileSubjectId,
          };
        })
      );
      const interested = dedupeNamed(
        (JSON.parse(row.interested) as Interest[]).map((interest) => {
          const renamed = sameName(interest.name, from);
          return {
            ...interest,
            name: replaceName(interest.name, from, to),
            profileSubjectId: renamed ? null : interest.profileSubjectId,
          };
        })
      );
      const scores = dedupeNamed(
        (JSON.parse(row.scores) as Score[]).map((score) => ({
          ...score,
          name: replaceName(score.name, from, to),
          attestedBy:
            score.attestedBy != null
              ? replaceName(score.attestedBy, from, to)
              : score.attestedBy,
        }))
      );
      const comments = (JSON.parse(row.comments) as Comment[]).map((comment) => {
        const renamed = sameName(comment.author, from);
        return {
          ...comment,
          author: replaceName(comment.author, from, to),
          profileSubjectId: renamed ? null : comment.profileSubjectId,
        };
      });
      const host = replaceName(row.host, from, to);
      const hostProfileSubjectId = host === row.host ? row.host_profile_subject_id : null;
      const changed =
        host !== row.host ||
        hostProfileSubjectId !== row.host_profile_subject_id ||
        JSON.stringify(claims) !== row.claims ||
        JSON.stringify(interested) !== row.interested ||
        JSON.stringify(scores) !== row.scores ||
        JSON.stringify(comments) !== row.comments;
      if (changed) {
        stmtUpdateIdentityFields.get(
          host,
          hostProfileSubjectId,
          JSON.stringify(claims),
          JSON.stringify(interested),
          JSON.stringify(scores),
          JSON.stringify(comments),
          row.id
        );
        teeTimesChanged += 1;
      }
    }

    const polls = stmtSelectAllPolls.all() as PollRow[];
    for (const poll of polls) {
      const responses = (JSON.parse(poll.responses) as PollResponse[]).map(
        (response) => {
          const renamed = sameName(response.name, from);
          return {
            ...response,
            name: replaceName(response.name, from, to),
            profileSubjectId: renamed ? null : response.profileSubjectId,
          };
        }
      );
      if (JSON.stringify(responses) !== poll.responses) {
        stmtUpdatePollResponses.get(JSON.stringify(responses), poll.id);
      }
    }

    if (fromRow) {
      db.prepare(`DELETE FROM players WHERE name = ? COLLATE NOCASE`).run(from);
    }

    return {
      player: rowToPlayer(stmtSelectPlayerByName.get(to) as PlayerRow),
      teeTimesChanged,
    };
  }
);

// Toggle a poll response: if the same signed profile already selected an
// option, remove it; otherwise append. Allows multi-select per voter without
// dedicated PUT/DELETE endpoints.
const togglePollResponseTx = db.transaction(
  (
    pollId: string,
    name: string,
    optionIdx: number,
    profileSubjectId: string | null
  ): PollRow => {
    const row = stmtSelectPollById.get(pollId) as PollRow | undefined;
    if (!row) throw new NotFoundError("Poll not found");
    const options = JSON.parse(row.options) as string[];
    if (optionIdx < 0 || optionIdx >= options.length) {
      throw new ValidationError("Invalid option");
    }
    const responses = JSON.parse(row.responses) as PollResponse[];
    const lower = name.toLowerCase();
    const sameNameResponses = responses.filter(
      (response) => response.name.toLowerCase() === lower
    );
    const ownedByAnotherProfile = sameNameResponses.some(
      (response) =>
        response.profileSubjectId &&
        profileSubjectId &&
        response.profileSubjectId !== profileSubjectId
    );
    if (ownedByAnotherProfile) {
      throw new ForbiddenError(
        "Only the profile that made this poll response can change it"
      );
    }
    const existingIdx = responses.findIndex(
      (r) =>
        r.name.toLowerCase() === lower &&
        r.optionIdx === optionIdx &&
        (!r.profileSubjectId ||
          !profileSubjectId ||
          r.profileSubjectId === profileSubjectId)
    );
    if (existingIdx !== -1) {
      responses.splice(existingIdx, 1);
    } else {
      responses.push({
        name,
        optionIdx,
        respondedAt: new Date().toISOString(),
        profileSubjectId,
      });
    }
    return stmtUpdatePollResponses.get(
      JSON.stringify(responses),
      pollId
    ) as PollRow;
  }
);

  app.use(express.json());

  const appBasePath = (process.env.APP_BASE_PATH ?? "").replace(/\/+$/, "");
  if (appBasePath) {
    const mountedApiPath = `${appBasePath}-api`;
    app.use((req, _res, next) => {
      if (req.url === mountedApiPath) {
        req.url = "/api";
      } else if (req.url.startsWith(`${mountedApiPath}/`)) {
        req.url = `/api${req.url.slice(mountedApiPath.length)}`;
      }
      next();
    });
  }

  app.get("/api/health", (_req, res) => {
    try {
      const quickCheck = db.pragma("quick_check", { simple: true });
      if (quickCheck !== "ok") {
        return res
          .status(503)
          .json({ ok: false, database: "error", detail: String(quickCheck) });
      }
      res.json({ ok: true, database: "ok" });
    } catch {
      res.status(503).json({ ok: false, database: "error" });
    }
  });

  app.get("/api/network-status", (_req, res) => {
    res.json(networkAccessStatus());
  });

  app.use(requireAccess);

  app.get("/api/access", (req, res) => {
    const required = getRequiredAccessCode();
    if (!required) {
      return res.json({
        required: false,
        ok: true,
      });
    }
    const cookie = parseCookie(req.headers.cookie, COOKIE_NAME);
    const ok = !!cookie && cookie === required;
    res.json({
      required: true,
      ok,
    });
  });

  app.post("/api/access", (req, res) => {
    const required = getRequiredAccessCode();
    if (!required) {
      return res.status(400).json({ error: "No access code is configured" });
    }
    const code = String(req.body?.code ?? "").trim();
    if (!code) return res.status(400).json({ error: "Access code is required" });
    if (code !== required) {
      return res.status(401).json({ error: "Wrong access code" });
    }
    setAccessCookie(req, res, code);
    res.json({ ok: true });
  });

  app.get("/api/commissioner", (req, res) => {
    const required = getRequiredCommissionerCode();
    res.json({
      required: !!required,
      ok: hasCommissionerAccess(req),
    });
  });

  app.post("/api/commissioner", (req, res) => {
    const required = getRequiredCommissionerCode();
    if (!required) {
      return res.status(400).json({ error: "No commissioner code is configured" });
    }
    const code = String(req.body?.code ?? "").trim();
    if (!code) {
      return res.status(400).json({ error: "Commissioner code is required" });
    }
    if (code !== required) {
      return res.status(401).json({ error: "Wrong commissioner code" });
    }
    setCommissionerCookie(req, res, code);
    res.json({ ok: true });
  });

  app.get("/api/profile", (req, res) => {
    res.json({ name: signedProfileName(req) });
  });

  app.post("/api/profile", (req, res) => {
    try {
      const name = trimStr(req.body?.name, NAME_MAX, "Name");
      const existing = signedProfile(req);
      const existingSubjectId =
        existing && sameName(existing.name, name) ? existing.subjectId : null;
      setProfileCookie(req, res, name, existingSubjectId);
      res.json({ ok: true, name });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/profile failed:", err);
      res.status(500).json({ error: "Failed to save profile" });
    }
  });

  app.delete("/api/profile", (req, res) => {
    clearProfileCookie(req, res);
    res.json({ ok: true });
  });

  app.get("/api/launch-checks", requireCommissioner, (_req, res) => {
    try {
      res.json({
        launchChecks: launchCheckState(),
        records: launchCheckRecords(),
      });
    } catch (err) {
      console.error("GET /api/launch-checks failed:", err);
      res.status(500).json({ error: "Failed to load launch checks" });
    }
  });

  app.patch("/api/launch-checks/:key", requireCommissioner, (req, res) => {
    try {
      const key = req.params.key;
      assertLaunchCheckKey(key);
      const verified = !!req.body?.verified;
      const verifiedByRaw = String(req.body?.verifiedBy ?? "Commissioner").trim();
      const verifiedBy = verifiedByRaw.slice(0, NAME_MAX) || "Commissioner";
      const note = validateLaunchCheckEvidenceNote(
        key,
        verified,
        req.body?.note
      );
      const now = new Date().toISOString();
      stmtUpsertLaunchCheck.run(
        key,
        verified ? 1 : 0,
        verified ? now : null,
        verified ? verifiedBy : null,
        note,
        now
      );
      recordAuditEvent({
        action: "launch_check_update",
        actor: verifiedBy,
        subjectType: "launch_check",
        subjectId: key,
        summary: `${verified ? "Verified" : "Cleared"} ${
          LAUNCH_CHECK_DEFINITIONS.find((definition) => definition.key === key)
            ?.label ?? key
        }`,
        after: { key, verified, verifiedAt: verified ? now : null, verifiedBy, note },
      });
      res.json({
        launchChecks: launchCheckState(),
        records: launchCheckRecords(),
      });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/launch-checks failed:", err);
      res.status(500).json({ error: "Failed to update launch check" });
    }
  });

  app.get("/api/verification-runs", requireCommissioner, (_req, res) => {
    try {
      res.json({ verificationRuns: getAllVerificationRuns() });
    } catch (err) {
      console.error("GET /api/verification-runs failed:", err);
      res.status(500).json({ error: "Failed to load verification runs" });
    }
  });

  app.post("/api/verification-runs", requireCommissioner, (req, res) => {
    try {
      const v = validateVerificationRun(req.body);
      const run = recordVerificationRun(v);
      recordAuditEvent({
        action: "verification_run_record",
        actor: run.recordedBy,
        subjectType: "verification_run",
        subjectId: run.id,
        summary: `Recorded ${run.command}: ${run.status}`,
        after: run,
      });
      res.status(201).json({ verificationRun: run });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/verification-runs failed:", err);
      res.status(500).json({ error: "Failed to record verification run" });
    }
  });

  const applyBulkIntakeTx = db.transaction(
    ({
      text,
      actor,
    }: {
      text: string;
      actor: string;
    }) => {
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const unconfirmedTournaments = tournaments.filter(
        (tournament) =>
          tournament.course.toLowerCase() === "tbd" ||
          tournament.notes?.toLowerCase().includes("tbd")
      );
      const matches = parseUnifiedBlockerIntake(text, {
        players,
        buyins,
        tournaments: unconfirmedTournaments,
      });
      const now = new Date().toISOString();
      const before = {
        buyins: [] as ReturnType<typeof rowToBuyin>[],
        players: [] as ReturnType<typeof rowToPlayer>[],
        tournaments: [] as ReturnType<typeof rowToTournament>[],
      };
      const after = {
        buyins: [] as ReturnType<typeof rowToBuyin>[],
        players: [] as ReturnType<typeof rowToPlayer>[],
        tournaments: [] as ReturnType<typeof rowToTournament>[],
      };

      for (const match of matches.payments) {
        const existing = stmtSelectBuyin.get(match.name) as BuyinRow | undefined;
        if (!existing) throw new NotFoundError(`No buy-in for ${match.name}`);
        const amount = match.amount ?? existing.amount;
        if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
          throw new ValidationError(
            "Amount must be a whole dollar amount between 0 and 100000"
          );
        }
        const notes = validateOptionalNotes(match.note);
        before.buyins.push(rowToBuyin(existing));
        const paymentStatus = validatePaymentStatus(match.paymentStatus);
        const paid = paidFromStatus(paymentStatus) ? 1 : 0;
        const method =
          match.paymentMethod ??
          (paymentStatus === "paid" || paymentStatus === "comped"
            ? inferPaymentMethod(notes)
            : null);
        const paidAt = paid ? match.paidAt : null;
        requireSettledPaymentEvidence(paymentStatus, method, actor, notes, paidAt);
        stmtUpdateBuyin.run(
          amount,
          paid,
          paymentStatus,
          method,
          actor,
          paidAt,
          notes,
          now,
          existing.player_name
        );
        const updated = stmtSelectBuyin.get(existing.player_name) as BuyinRow;
        after.buyins.push(rowToBuyin(updated));
      }

      for (const match of matches.handicaps) {
        const existing = stmtSelectPlayerByName.get(match.name) as
          | PlayerRow
          | undefined;
        if (!existing) throw new NotFoundError(`No player for ${match.name}`);
        if (match.handicap < HANDICAP_MIN || match.handicap > HANDICAP_MAX) {
          throw new ValidationError(
            `Handicap must be between ${HANDICAP_MIN} and ${HANDICAP_MAX}`
          );
        }
        const handicap = Math.round(match.handicap * 10) / 10;
        const source = validateOptionalNotes(match.source);
        const note = source;
        before.players.push(rowToPlayer(existing));
        const row = stmtUpsertPlayer.get(
          existing.name,
          handicap,
          source,
          note,
          match.ghinNumber ?? existing.ghin_number,
          inferHandicapSourceType(source),
          now,
          "Commissioner",
          existing.member,
          now
        ) as PlayerRow;
        after.players.push(rowToPlayer(row));
      }

      for (const match of matches.schedules) {
        const row = stmtSelectTournamentById.get(match.id) as
          | TournamentRow
          | undefined;
        if (!row) throw new NotFoundError(`Tournament not found: ${match.name}`);
        if (row.closed_at) {
          throw new ConflictError("Reopen the tournament before changing details");
        }
        const course = trimStr(match.course, COURSE_MAX, "Course");
        const windowStart = validateDate(match.windowStart, "Window start");
        const windowEnd = validateDate(match.windowEnd, "Window end");
        if (windowStart > windowEnd) {
          throw new ValidationError("Window start must be on or before window end");
        }
        const notes = validateOptionalNotes(match.notes);
        before.tournaments.push(rowToTournament(row));
        const updated = stmtUpdateTournamentDetails.get(
          course,
          windowStart,
          windowEnd,
          row.points_to_first,
          row.payout_first,
          row.payout_second,
          row.payout_third,
          notes,
          row.id
        ) as TournamentRow;
        after.tournaments.push(rowToTournament(updated));
      }

      const total =
        matches.payments.length + matches.handicaps.length + matches.schedules.length;
      recordAuditEvent({
        action: "bulk_intake_apply",
        actor,
        subjectType: "commissioner_intake",
        subjectId: randomUUID(),
        summary: `Applied ${matches.payments.length} payment(s), ${matches.handicaps.length} GHIN index(es), and ${matches.schedules.length} schedule update(s)`,
        before,
        after,
        metadata: {
          total,
          sources: {
            payments: matches.payments.map((match) => match.source),
            handicaps: matches.handicaps.map((match) => match.source),
            schedules: matches.schedules.map((match) => match.source),
          },
        },
      });

      return { matches, before, after };
    }
  );

  app.post("/api/admin/blocker-intake", requireCommissioner, (req, res) => {
    try {
      const text = trimStr(req.body?.text, 5000, "Intake text");
      const actor = auditActor(req.body?.actor, "Commissioner");
      const result = applyBulkIntakeTx.immediate({ text, actor });
      res.json({
        ok: true,
        counts: {
          payments: result.matches.payments.length,
          handicaps: result.matches.handicaps.length,
          schedules: result.matches.schedules.length,
        },
        matches: result.matches,
        updated: result.after,
      });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/admin/blocker-intake failed:", err);
      res.status(500).json({ error: "Failed to apply intake" });
    }
  });

  app.get("/api/teetimes", (_req, res) => {
    try {
      const rows = stmtSelectAll.all() as TeeTimeRow[];
      res.json({ teeTimes: rows.map(rowToTeeTime) });
    } catch (err) {
      console.error("GET /api/teetimes failed:", err);
      res.status(500).json({ error: "Failed to load tee times" });
    }
  });

  app.post("/api/teetimes", (req, res) => {
    try {
      const v = validateNewTeeTime(req.body);
      assertProfileMayActAs(req, v.host);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const hostProfileSubjectId = profileSubjectIdForName(req, v.host);
      const claims: Claim[] = [
        {
          name: v.host,
          claimedAt: createdAt,
          profileSubjectId: hostProfileSubjectId,
        },
      ];
      const row = stmtInsert.get(
        id,
        v.course,
        v.date,
        v.time,
        v.spots,
        v.host,
        hostProfileSubjectId,
        v.notes,
        JSON.stringify(claims),
        createdAt
      ) as TeeTimeRow;
      recordAuditEvent({
        action: "tee_time_create",
        actor: v.host,
        subjectType: "tee_time",
        subjectId: id,
        summary: `Created tee time at ${v.course}`,
        after: rowToTeeTime(row),
      });
      res.status(201).json({ teeTime: rowToTeeTime(row) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes failed:", err);
      res.status(500).json({ error: "Failed to create tee time" });
    }
  });

  app.post("/api/teetimes/:id/claims", (req, res) => {
    try {
      const id = req.params.id;
      const name = trimStr(req.body?.name, NAME_MAX, "Name");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      assertCanChangeTeeParticipant(req, row, name);
      const claimedAt = new Date().toISOString();
      const updated = claimTx.immediate(
        id,
        name,
        claimedAt,
        claimSubjectIdForName(req, row, name)
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/claims failed:", err);
      res.status(500).json({ error: "Failed to claim spot" });
    }
  });

  app.post("/api/teetimes/:id/interested", (req, res) => {
    try {
      const id = req.params.id;
      const name = trimStr(req.body?.name, NAME_MAX, "Name");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      assertCanChangeTeeParticipant(req, row, name);
      const interestedAt = new Date().toISOString();
      const updated = interestTx.immediate(
        id,
        name,
        interestedAt,
        profileSubjectIdForName(req, name)
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/interested failed:", err);
      res.status(500).json({ error: "Failed to mark maybe" });
    }
  });

  app.delete("/api/teetimes/:id/interested/:name", (req, res) => {
    try {
      const id = req.params.id;
      const name = decodeURIComponent(req.params.name).trim();
      if (!name) throw new ValidationError("Name is required");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      if (!hasCommissionerAccess(req)) {
        try {
          assertCanManageTeeTime(req, row);
        } catch {
          assertProfileOwnsInterest(req, row, name, "drop this maybe");
        }
      }
      const updated = dropInterestTx.immediate(id, name);
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id/interested/:name failed:", err);
      res.status(500).json({ error: "Failed to drop maybe" });
    }
  });

  app.post("/api/teetimes/:id/scores", (req, res) => {
    try {
      const id = req.params.id;
      const beforeRow = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!beforeRow) throw new NotFoundError("Tee time not found");
      assertCanManageTeeTime(req, beforeRow);
      assertTournamentOpenForTeeTime(beforeRow);
      const name = trimStr(req.body?.name, NAME_MAX, "Name");
      const gross = Number(req.body?.gross);
      if (!Number.isInteger(gross) || gross < SCORE_MIN || gross > SCORE_MAX) {
        throw new ValidationError(
          `Score must be an integer between ${SCORE_MIN} and ${SCORE_MAX}`
        );
      }
      let courseHcp: number | null = null;
      if (req.body?.courseHcp != null && req.body.courseHcp !== "") {
        const h = Number(req.body.courseHcp);
        if (!Number.isInteger(h) || h < HANDICAP_MIN || h > HANDICAP_MAX) {
          throw new ValidationError(
            `Course handicap must be a whole number between ${HANDICAP_MIN} and ${HANDICAP_MAX}`
          );
        }
        courseHcp = h;
      }
      let attestedBy: string | null = null;
      if (req.body?.attestedBy != null && req.body.attestedBy !== "") {
        attestedBy = trimStr(req.body.attestedBy, NAME_MAX, "Attester");
      }
      const enteredBy =
        signedProfileName(req) ?? (hasCommissionerAccess(req) ? "Commissioner" : name);
      const handicapEvidence = validateScoreHandicapEvidence(
        req.body,
        beforeRow,
        courseHcp
      );
      const beforeScore = beforeRow
        ? (JSON.parse(beforeRow.scores) as Score[]).find((score) =>
            sameName(score.name, name)
          ) ?? null
        : null;
      if (beforeScore && isOfficialScoreRecord(beforeScore) && !hasCommissionerAccess(req)) {
        throw new ForbiddenError("Official score fixes require commissioner unlock");
      }
      const updated = recordScoreTx.immediate(
        id,
        name,
        gross,
        courseHcp,
        attestedBy,
        enteredBy,
        handicapEvidence
      );
      const updatedTeeTime = rowToTeeTime(updated);
      const afterScore =
        updatedTeeTime.scores.find((score) => sameName(score.name, name)) ??
        null;
      recordAuditEvent({
        action: beforeScore ? "score_update" : "score_create",
        actor: enteredBy,
        subjectType: "score",
        subjectId: `${id}:${name}`,
        summary: `${beforeScore ? "Updated" : "Recorded"} ${name} score at ${
          updatedTeeTime.course
        }`,
        before: beforeScore,
        after: afterScore,
        metadata: { teeTimeId: id, attestedBy, course: updatedTeeTime.course },
      });
      res.json({ teeTime: updatedTeeTime });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/scores failed:", err);
      res.status(500).json({ error: "Failed to record score" });
    }
  });

  app.post("/api/teetimes/:id/scores/:name/attest", (req, res) => {
    try {
      const id = req.params.id;
      const name = trimStr(decodeURIComponent(req.params.name), NAME_MAX, "Name");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      const scores = JSON.parse(row.scores) as Score[];
      const score = scores.find((candidate) => sameName(candidate.name, name));
      if (!score) throw new NotFoundError("No score by that name");
      const commissionerOverride = hasCommissionerAccess(req);
      const actor =
        signedProfileName(req) ??
        (commissionerOverride ? "Commissioner" : null);
      if (!actor) throw new ForbiddenError("Player profile unlock required");
      if (!commissionerOverride) {
        assertProfileOwnsClaim(req, row, actor, "attest this score");
      }
      const result = attestScoreTx.immediate(
        id,
        name,
        actor,
        commissionerOverride && !sameName(actor, score.attestedBy ?? "")
      );
      const updatedTeeTime = rowToTeeTime(result.row);
      recordAuditEvent({
        action: result.after.attestationStatus === "overridden"
          ? "score_attestation_override"
          : "score_attestation",
        actor,
        subjectType: "score",
        subjectId: `${id}:${name}`,
        summary: `Confirmed ${name} score attestation at ${updatedTeeTime.course}`,
        before: result.before,
        after: result.after,
        metadata: { teeTimeId: id, course: updatedTeeTime.course },
      });
      res.json({ teeTime: updatedTeeTime });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/scores/:name/attest failed:", err);
      res.status(500).json({ error: "Failed to attest score" });
    }
  });

  app.delete("/api/teetimes/:id/scores/:name", requireCommissioner, (req, res) => {
    try {
      const id = req.params.id;
      const name = decodeURIComponent(req.params.name).trim();
      if (!name) throw new ValidationError("Name is required");
      const beforeRow = stmtSelectById.get(id) as TeeTimeRow | undefined;
      const beforeScore = beforeRow
        ? (JSON.parse(beforeRow.scores) as Score[]).find((score) =>
            sameName(score.name, name)
          ) ?? null
        : null;
      const updated = removeScoreTx.immediate(id, name);
      const updatedTeeTime = rowToTeeTime(updated);
      recordAuditEvent({
        action: "score_delete",
        actor: auditActor(req.body?.actor, "Commissioner"),
        subjectType: "score",
        subjectId: `${id}:${name}`,
        summary: `Removed ${name} score at ${updatedTeeTime.course}`,
        before: beforeScore,
        metadata: { teeTimeId: id, course: updatedTeeTime.course },
      });
      res.json({ teeTime: updatedTeeTime });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id/scores/:name failed:", err);
      res.status(500).json({ error: "Failed to remove score" });
    }
  });

  app.post("/api/teetimes/:id/comments", (req, res) => {
    try {
      const id = req.params.id;
      const author = requireProfileName(req);
      const body = trimStr(req.body?.body, COMMENT_MAX, "Comment");
      const commentId = randomUUID();
      const createdAt = new Date().toISOString();
      const updated = addCommentTx.immediate(
        id,
        author,
        body,
        commentId,
        createdAt,
        signedProfileSubjectId(req)
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/comments failed:", err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.patch("/api/teetimes/:id/comments/:commentId", (req, res) => {
    try {
      const id = req.params.id;
      const commentId = req.params.commentId;
      const body = trimStr(req.body?.body, COMMENT_MAX, "Comment");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      const comments = JSON.parse(row.comments) as Comment[];
      const comment = comments.find((c) => c.id === commentId);
      if (!comment) throw new NotFoundError("Comment not found");
      assertCanManageComment(req, comment, "edit");
      const updated = updateCommentTx.immediate(
        id,
        commentId,
        body,
        new Date().toISOString()
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/teetimes/:id/comments/:commentId failed:", err);
      res.status(500).json({ error: "Failed to edit comment" });
    }
  });

  app.delete("/api/teetimes/:id/comments/:commentId", (req, res) => {
    try {
      const id = req.params.id;
      const commentId = req.params.commentId;
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      const comments = JSON.parse(row.comments) as Comment[];
      const comment = comments.find((c) => c.id === commentId);
      if (!comment) throw new NotFoundError("Comment not found");
      assertCanManageComment(req, comment, "delete");
      const updated = removeCommentTx.immediate(id, commentId);
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id/comments/:commentId failed:", err);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  app.delete("/api/teetimes/:id/claims/:name", (req, res) => {
    try {
      const id = req.params.id;
      const name = decodeURIComponent(req.params.name).trim();
      if (!name) throw new ValidationError("Name is required");
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) throw new NotFoundError("Tee time not found");
      if (!hasCommissionerAccess(req)) {
        try {
          assertCanManageTeeTime(req, row);
        } catch {
          assertProfileOwnsClaim(req, row, name, "drop this spot");
        }
      }
      const updated = dropTx.immediate(id, name);
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id/claims/:name failed:", err);
      res.status(500).json({ error: "Failed to drop spot" });
    }
  });

  app.patch("/api/teetimes/:id", (req, res) => {
    try {
      const id = req.params.id;
      const v = validateNewTeeTime(req.body);
      let before: TeeTimeRow | null = null;
      const tx = db.transaction((teeId: string): TeeTimeRow => {
        const existing = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
        if (!existing) throw new NotFoundError("Tee time not found");
        assertCanManageTeeTime(req, existing);
        if (!hasCommissionerAccess(req) && !sameName(v.host, existing.host)) {
          throw new ForbiddenError("Only a commissioner can change the host");
        }
        const hostProfileSubjectId = sameName(v.host, existing.host)
          ? existing.host_profile_subject_id
          : null;
        before = existing;
        assertTournamentOpenForTeeTime(existing);
        const claims = JSON.parse(existing.claims) as Claim[];
        if (claims.length > v.spots) {
          throw new ConflictError(
            `Can't reduce spots below current ${claims.length} claim${claims.length === 1 ? "" : "s"}`
          );
        }
        return stmtUpdateFields.get(
          v.course,
          v.date,
          v.time,
          v.spots,
          v.host,
          hostProfileSubjectId,
          v.notes,
          teeId
        ) as TeeTimeRow;
      });
      const updated = tx.immediate(id);
      recordAuditEvent({
        action: "tee_time_update",
        actor: v.host,
        subjectType: "tee_time",
        subjectId: id,
        summary: `Updated tee time at ${v.course}`,
        before: before ? rowToTeeTime(before) : null,
        after: rowToTeeTime(updated),
      });
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/teetimes/:id failed:", err);
      res.status(500).json({ error: "Failed to update tee time" });
    }
  });

  app.get("/api/polls", (_req, res) => {
    try {
      const rows = stmtSelectAllPolls.all() as PollRow[];
      res.json({ polls: rows.map(rowToPoll) });
    } catch (err) {
      console.error("GET /api/polls failed:", err);
      res.status(500).json({ error: "Failed to load polls" });
    }
  });

  app.post("/api/polls", (req, res) => {
    try {
      const v = validateNewPoll(req.body);
      assertProfileMayActAs(req, v.host);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const hostProfileSubjectId = profileSubjectIdForName(req, v.host);
      const row = stmtInsertPoll.get(
        id,
        v.prompt,
        JSON.stringify(v.options),
        "[]",
        v.host,
        hostProfileSubjectId,
        createdAt
      ) as PollRow;
      res.status(201).json({ poll: rowToPoll(row) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/polls failed:", err);
      res.status(500).json({ error: "Failed to create poll" });
    }
  });

  app.post("/api/polls/:id/responses", (req, res) => {
    try {
      const id = req.params.id;
      const name = requireProfileName(req);
      const optionIdx = Number(req.body?.optionIdx);
      if (!Number.isInteger(optionIdx)) {
        throw new ValidationError("optionIdx must be an integer");
      }
      const updated = togglePollResponseTx.immediate(
        id,
        name,
        optionIdx,
        signedProfileSubjectId(req)
      );
      res.json({ poll: rowToPoll(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/polls/:id/responses failed:", err);
      res.status(500).json({ error: "Failed to record response" });
    }
  });

  app.get("/api/tournaments", (_req, res) => {
    try {
      const rows = stmtSelectAllTournaments.all() as TournamentRow[];
      res.json({ tournaments: rows.map(rowToTournament) });
    } catch (err) {
      console.error("GET /api/tournaments failed:", err);
      res.status(500).json({ error: "Failed to load tournaments" });
    }
  });

  app.post("/api/tournaments/:id/closeout", requireCommissioner, (req, res) => {
    try {
      const row = stmtSelectTournamentById.get(req.params.id) as
        | TournamentRow
        | undefined;
      if (!row) throw new NotFoundError("Tournament not found");
      const closedBy =
        req.body?.closedBy != null && String(req.body.closedBy).trim() !== ""
          ? trimStr(req.body.closedBy, NAME_MAX, "Closed by")
          : "Commissioner";
      const force = req.body?.force === true;
      if (row.type !== "post" && localTodayISO() <= row.window_end && !force) {
        throw new ConflictError(
          "Tournament window is still active — close it after the window ends"
        );
      }
      let notes: string | null = row.closeout_notes;
      if ("notes" in (req.body ?? {})) {
        const raw = req.body.notes;
        notes = raw == null || raw === "" ? null : String(raw).trim();
        if (notes && notes.length > NOTES_MAX) {
          throw new ValidationError("Notes are too long");
        }
      }
      const { teeTimes, players, issues } = auditTournamentForCloseout(row);
      if (issues.length > 0) {
        return res.status(409).json({
          error: "Tournament has rule blockers",
          issues,
        });
      }
      const board = computeTournamentLeaderboard(
        publicTournament(row),
        teeTimes as PublicTeeTime[],
        getHandicapFromPlayers(players)
      );
      if (row.type !== "post" && board.length === 0) {
        throw new ValidationError("Tournament has no scored rounds to close");
      }
      const updated = stmtUpdateTournamentCloseout.get(
        new Date().toISOString(),
        closedBy,
        JSON.stringify(board),
        notes,
        row.id
      ) as TournamentRow;
      recordAuditEvent({
        action: "tournament_closeout",
        actor: closedBy,
        subjectType: "tournament",
        subjectId: row.id,
        summary: `Closed ${row.name}`,
        before: rowToTournament(row),
        after: rowToTournament(updated),
        metadata: { force, leaderboardRows: board.length },
      });
      res.json({ tournament: rowToTournament(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/tournaments/:id/closeout failed:", err);
      res.status(500).json({ error: "Failed to close tournament" });
    }
  });

  app.post("/api/tournaments/:id/reopen", requireCommissioner, (req, res) => {
    try {
      const row = stmtSelectTournamentById.get(req.params.id) as
        | TournamentRow
        | undefined;
      if (!row) throw new NotFoundError("Tournament not found");
      const updated = stmtReopenTournament.get(row.id) as TournamentRow;
      recordAuditEvent({
        action: "tournament_reopen",
        actor: "Commissioner",
        subjectType: "tournament",
        subjectId: row.id,
        summary: `Reopened ${row.name}`,
        before: rowToTournament(row),
        after: rowToTournament(updated),
      });
      res.json({ tournament: rowToTournament(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/tournaments/:id/reopen failed:", err);
      res.status(500).json({ error: "Failed to reopen tournament" });
    }
  });

  app.patch("/api/tournaments/:id/details", requireCommissioner, (req, res) => {
    try {
      const row = stmtSelectTournamentById.get(req.params.id) as
        | TournamentRow
        | undefined;
      if (!row) throw new NotFoundError("Tournament not found");
      if (row.closed_at) {
        throw new ConflictError("Reopen the tournament before changing details");
      }
      const course =
        "course" in (req.body ?? {})
          ? trimStr(req.body.course, COURSE_MAX, "Course")
          : row.course;
      const windowStart =
        "windowStart" in (req.body ?? {})
          ? validateDate(req.body.windowStart, "Window start")
          : row.window_start;
      const windowEnd =
        "windowEnd" in (req.body ?? {})
          ? validateDate(req.body.windowEnd, "Window end")
          : row.window_end;
      if (windowStart > windowEnd) {
        throw new ValidationError("Window start must be on or before window end");
      }
      let notes = row.notes;
      if ("notes" in (req.body ?? {})) {
        const raw = req.body.notes;
        notes = raw == null || raw === "" ? null : String(raw).trim();
        if (notes && notes.length > NOTES_MAX) {
          throw new ValidationError("Notes are too long");
        }
      }
      const pointsToFirst =
        "pointsToFirst" in (req.body ?? {})
          ? validateOptionalWholeNumber(req.body.pointsToFirst, "Points to first", 1000)
          : row.points_to_first;
      const payoutFirst =
        "payoutFirst" in (req.body ?? {})
          ? validateOptionalWholeNumber(req.body.payoutFirst, "First payout")
          : row.payout_first;
      const payoutSecond =
        "payoutSecond" in (req.body ?? {})
          ? validateOptionalWholeNumber(req.body.payoutSecond, "Second payout")
          : row.payout_second;
      const payoutThird =
        "payoutThird" in (req.body ?? {})
          ? validateOptionalWholeNumber(req.body.payoutThird, "Third payout")
          : row.payout_third;
      const updated = stmtUpdateTournamentDetails.get(
        course,
        windowStart,
        windowEnd,
        pointsToFirst,
        payoutFirst,
        payoutSecond,
        payoutThird,
        notes,
        row.id
      ) as TournamentRow;
      recordAuditEvent({
        action: "tournament_details_update",
        actor: "Commissioner",
        subjectType: "tournament",
        subjectId: row.id,
        summary: `Updated details for ${row.name}`,
        before: rowToTournament(row),
        after: rowToTournament(updated),
      });
      res.json({ tournament: rowToTournament(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/tournaments/:id/details failed:", err);
      res.status(500).json({ error: "Failed to update tournament details" });
    }
  });

  app.patch("/api/tournaments/:id/payout", requireCommissioner, (req, res) => {
    try {
      const row = stmtSelectTournamentById.get(req.params.id) as
        | TournamentRow
        | undefined;
      if (!row) throw new NotFoundError("Tournament not found");
      if (!row.closed_at) {
        throw new ConflictError("Close the tournament before updating payout");
      }
      const confirmed =
        "payoutConfirmed" in (req.body ?? {})
          ? req.body.payoutConfirmed
            ? 1
            : 0
          : row.payout_confirmed;
      const paidAt =
        "payoutPaid" in (req.body ?? {})
          ? req.body.payoutPaid
            ? row.payout_paid_at ?? new Date().toISOString()
            : null
          : row.payout_paid_at;
      if (paidAt && !confirmed) {
        throw new ConflictError("Confirm the payout before marking it paid");
      }
      let notes = row.payout_evidence_note;
      if ("notes" in (req.body ?? {})) {
        const raw = req.body.notes;
        notes = raw == null || raw === "" ? null : String(raw).trim();
        if (notes && notes.length > NOTES_MAX) {
          throw new ValidationError("Notes are too long");
        }
      }
      const updated = stmtUpdateTournamentPayout.get(
        confirmed,
        paidAt,
        notes,
        row.id
      ) as TournamentRow;
      recordAuditEvent({
        action: "tournament_payout_update",
        actor: "Commissioner",
        subjectType: "tournament",
        subjectId: row.id,
        summary: `Updated payout state for ${row.name}`,
        before: rowToTournament(row),
        after: rowToTournament(updated),
      });
      res.json({ tournament: rowToTournament(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/tournaments/:id/payout failed:", err);
      res.status(500).json({ error: "Failed to update payout" });
    }
  });

  app.get("/api/players", (req, res) => {
    try {
      const rows = stmtSelectAllPlayers.all() as PlayerRow[];
      res.json({
        players: rows.map(
          hasCommissionerAccess(req) ? rowToPlayer : rowToPublicPlayer
        ),
      });
    } catch (err) {
      console.error("GET /api/players failed:", err);
      res.status(500).json({ error: "Failed to load players" });
    }
  });

  app.put("/api/players/:name", requireCommissioner, (req, res) => {
    try {
      const name = trimStr(decodeURIComponent(req.params.name), NAME_MAX, "Name");
      // Merge with existing row so the caller can update one field at a time
      // without clobbering the other.
      const existing = stmtSelectPlayerByName.get(name) as PlayerRow | undefined;
      let handicap: number | null = existing?.handicap ?? null;
      const hadHandicapPatch = "handicap" in (req.body ?? {});
      if ("handicap" in (req.body ?? {})) {
        if (req.body.handicap == null || req.body.handicap === "") {
          handicap = null;
        } else {
          const h = Number(req.body.handicap);
          if (!Number.isFinite(h)) {
            throw new ValidationError("Handicap must be a number");
          }
          if (h < HANDICAP_MIN || h > HANDICAP_MAX) {
            throw new ValidationError(
              `Handicap must be between ${HANDICAP_MIN} and ${HANDICAP_MAX}`
            );
          }
          handicap = Math.round(h * 10) / 10;
        }
      }
      let handicapSource: string | null = existing?.handicap_source ?? null;
      if ("handicapSource" in (req.body ?? {})) {
        handicapSource = validateOptionalNotes(req.body.handicapSource);
      } else if (hadHandicapPatch && handicap !== existing?.handicap) {
        handicapSource = null;
      }
      let handicapNote: string | null = existing?.handicap_note ?? null;
      if ("handicapNote" in (req.body ?? {})) {
        handicapNote = validateOptionalNotes(req.body.handicapNote);
      } else if (hadHandicapPatch && handicap !== existing?.handicap) {
        handicapNote = null;
      }
      let ghinNumber: string | null = existing?.ghin_number ?? null;
      if ("ghinNumber" in (req.body ?? {})) {
        ghinNumber = validateOptionalGhinNumber(req.body.ghinNumber);
      }
      let handicapSourceType: string | null =
        existing?.handicap_source_type ?? null;
      let handicapVerifiedAt: string | null =
        existing?.handicap_verified_at ?? null;
      let handicapVerifiedBy: string | null =
        existing?.handicap_verified_by ?? null;
      const hadProvenancePatch =
        "handicapSourceType" in (req.body ?? {}) ||
        "handicapVerifiedAt" in (req.body ?? {}) ||
        "handicapVerifiedBy" in (req.body ?? {}) ||
        "handicapNote" in (req.body ?? {}) ||
        "handicapSource" in (req.body ?? {});
      if (handicap == null) {
        handicapSource = null;
        handicapNote = null;
        handicapSourceType = null;
        handicapVerifiedAt = null;
        handicapVerifiedBy = null;
      } else if (hadHandicapPatch || hadProvenancePatch) {
        handicapSourceType = validateHandicapSourceType(
          req.body?.handicapSourceType,
          handicapSource
        );
        const explicitVerifiedAt = validateOptionalIsoDateTime(
          req.body?.handicapVerifiedAt,
          "Handicap verified date"
        );
        const verifier = validateOptionalNotes(req.body?.handicapVerifiedBy);
        const hasVerificationEvidence =
          !!handicapSource || !!handicapNote || !!explicitVerifiedAt || !!verifier;
        handicapVerifiedAt = hasVerificationEvidence
          ? explicitVerifiedAt ?? new Date().toISOString()
          : null;
        handicapVerifiedBy = hasVerificationEvidence
          ? verifier ?? existing?.handicap_verified_by ?? "Commissioner"
          : null;
      }
      const wasMember = existing?.member === 1;
      let member: number = existing?.member ?? 0;
      if ("member" in (req.body ?? {})) {
        member = req.body.member ? 1 : 0;
      }
      const row = stmtUpsertPlayer.get(
        name,
        handicap,
        handicapSource,
        handicapNote,
        ghinNumber,
        handicapSourceType,
        handicapVerifiedAt,
        handicapVerifiedBy,
        member,
        new Date().toISOString()
      ) as PlayerRow;
      // Auto-manage the buy-in entry: create on member-promotion, delete on
      // member-demotion. INSERT OR IGNORE preserves any prior paid state if
      // the player toggles back and forth.
      if (member === 1 && !wasMember) {
        stmtInsertBuyin.run(
          row.name,
          LEAGUE_DEFAULT_BUYIN,
          new Date().toISOString()
        );
      } else if (member === 0 && wasMember) {
        stmtDeleteBuyin.run(row.name);
      }
      recordAuditEvent({
        action: "player_update",
        actor: name,
        subjectType: "player",
        subjectId: row.name,
        summary: `Updated roster profile for ${row.name}`,
        before: existing ? rowToPlayer(existing) : null,
        after: rowToPlayer(row),
        metadata: {
          buyinCreated: member === 1 && !wasMember,
          buyinDeleted: member === 0 && wasMember,
        },
      });
      res.json({ player: rowToPlayer(row) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PUT /api/players/:name failed:", err);
      res.status(500).json({ error: "Failed to save player" });
    }
  });

  app.post("/api/admin/rename-player", requireCommissioner, (req, res) => {
    try {
      const from = trimStr(req.body?.from, NAME_MAX, "From");
      const to = trimStr(req.body?.to, NAME_MAX, "To");
      if (sameName(from, to)) {
        throw new ValidationError("From and To names must differ");
      }
      const result = renamePlayerTx.immediate(
        from,
        to,
        !!req.body?.createPlayer
      );
      recordAuditEvent({
        action: "player_rename",
        actor: "Commissioner",
        subjectType: "player",
        subjectId: to,
        summary: `Renamed ${from} to ${to}`,
        before: { name: from },
        after: result.player,
        metadata: { teeTimesChanged: result.teeTimesChanged },
      });
      const issues = auditLeagueRules(
        getAllTeeTimes(),
        getAllTournaments(),
        getAllPlayers(),
        localTodayISO()
      );
      res.json({ ok: true, ...result, issues });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/admin/rename-player failed:", err);
      res.status(500).json({ error: "Failed to rename player" });
    }
  });

  app.get("/api/buyins", requireCommissioner, (_req, res) => {
    try {
      const rows = stmtSelectAllBuyins.all() as BuyinRow[];
      res.json({ buyins: rows.map(rowToBuyin) });
    } catch (err) {
      console.error("GET /api/buyins failed:", err);
      res.status(500).json({ error: "Failed to load buy-ins" });
    }
  });

  app.get("/api/export/season.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const polls = getAllPolls();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const auditEvents = (stmtSelectAllAuditEvents.all() as AuditEventRow[]).map(
        rowToAuditEvent
      );
      const verificationRuns = getAllVerificationRuns();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-season-${new Date().toISOString().slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        app: "DJDI Golf Board",
        rulesVersion: ACTIVE_RULES_VERSION,
        rules: ACTIVE_LEAGUE_RULES,
        tournaments,
        teeTimes,
        polls,
        players,
        buyins,
        auditEvents,
        verificationRuns,
      });
    } catch (err) {
      console.error("GET /api/export/season.json failed:", err);
      res.status(500).json({ error: "Failed to export season data" });
    }
  });

  app.get("/api/export/rules.json", requireCommissioner, (_req, res) => {
    try {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-rules-${ACTIVE_RULES_VERSION}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        app: "DJDI Golf Board",
        rulesVersion: ACTIVE_RULES_VERSION,
        activeRules: ACTIVE_LEAGUE_RULES,
      });
    } catch (err) {
      console.error("GET /api/export/rules.json failed:", err);
      res.status(500).json({ error: "Failed to export league rules" });
    }
  });

  app.get("/api/export/buyins.csv", requireCommissioner, (_req, res) => {
    try {
      const buyins = getAllBuyins();
      const rows = [
        csvLine([
          "player_name",
          "amount",
          "payment_status",
          "paid",
          "payment_method",
          "payment_actor",
          "paid_at",
          "outstanding",
          "notes",
          "updated_at",
        ]),
        ...buyins.map((buyin) =>
          csvLine([
            buyin.playerName,
            buyin.amount,
            buyin.paymentStatus,
            buyin.paid ? "yes" : "no",
            buyin.paymentMethod ?? "",
            buyin.paymentActor ?? "",
            buyin.paidAt ?? "",
            buyin.paid ? 0 : buyin.amount,
            buyin.notes ?? "",
            buyin.updatedAt,
          ])
        ),
      ];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-buyins-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/buyins.csv failed:", err);
      res.status(500).json({ error: "Failed to export buy-in ledger" });
    }
  });

  app.get("/api/export/roster.csv", requireCommissioner, (_req, res) => {
    try {
      const players = getAllPlayers();
      const buyins = new Map(
        getAllBuyins().map((buyin) => [normalizeName(buyin.playerName), buyin])
      );
      const rows = [
        csvLine([
          "name",
          "member",
          "ghin_number",
          "handicap_index",
          "handicap_source_type",
          "handicap_source",
          "handicap_note",
          "handicap_verified_at",
          "handicap_verified_by",
          "buyin_amount",
          "buyin_paid",
          "buyin_paid_at",
          "buyin_notes",
          "profile_updated_at",
        ]),
        ...players.map((player) => {
          const buyin = buyins.get(normalizeName(player.name));
          return csvLine([
            player.name,
            player.member ? "yes" : "no",
            player.ghinNumber ?? "",
            player.handicap ?? "",
            player.handicapSourceType ?? "",
            player.handicapSource ?? "",
            player.handicapNote ?? "",
            player.handicapVerifiedAt ?? "",
            player.handicapVerifiedBy ?? "",
            buyin?.amount ?? "",
            buyin ? (buyin.paid ? "yes" : "no") : "",
            buyin?.paidAt ?? "",
            buyin?.notes ?? "",
            player.updatedAt,
          ]);
        }),
      ];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-roster-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/roster.csv failed:", err);
      res.status(500).json({ error: "Failed to export roster ledger" });
    }
  });

  app.get("/api/export/scores.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const tournaments = getAllTournaments();
      const players = getAllPlayers();
      const getHandicap = getHandicapFromPlayers(players);
      const rows = [
        csvLine([
          "rules_version",
          "tournament",
          "tee_time_id",
          "date",
          "time",
          "course",
          "host",
          "player",
          "gross",
          "round_course",
          "round_date",
          "tee_name",
          "tee_rating",
          "tee_slope",
          "tee_par",
          "handicap_index_used",
          "calculated_course_hcp",
          "course_hcp_rounded",
          "course_hcp",
          "profile_hcp",
          "net",
          "net_source",
          "attested_by",
          "attestation_status",
          "attested_at",
          "attestation_actor",
          "entered_by",
          "course_hcp_source",
          "course_hcp_verified_at",
          "course_hcp_override",
          "recorded_at",
        ]),
      ];

      for (const teeTime of teeTimes) {
        const tournament =
          tournaments.find(
            (candidate) =>
              candidate.type !== "post" &&
              teeTime.date >= candidate.windowStart &&
              teeTime.date <= candidate.windowEnd
          ) ?? null;
        for (const score of teeTime.scores) {
          const profileHcp = getHandicap(score.name);
          const net =
            score.net ??
            (score.courseHcp != null
              ? score.gross - score.courseHcp
              : profileHcp != null
                ? score.gross - profileHcp
                : null);
          rows.push(
            csvLine([
              ACTIVE_RULES_VERSION,
              tournament?.name ?? "",
              teeTime.id,
              teeTime.date,
              teeTime.time,
              teeTime.course,
              teeTime.host,
              score.name,
              score.gross,
              score.roundCourse ?? teeTime.course,
              score.roundDate ?? teeTime.date,
              score.teeName ?? "",
              score.teeRating ?? "",
              score.teeSlope ?? "",
              score.teePar ?? "",
              score.handicapIndexUsed ?? "",
              score.calculatedCourseHcp ?? "",
              score.courseHcpRounded ?? "",
              score.courseHcp ?? "",
              profileHcp ?? "",
              net ?? "",
              score.courseHcp != null
                ? "course_hcp"
                : profileHcp != null
                  ? "profile_hcp"
                  : "",
              score.attestedBy ?? "",
              score.attestationStatus ?? "legacy_unconfirmed",
              score.attestedAt ?? "",
              score.attestationActor ?? "",
              score.enteredBy ?? "",
              score.courseHcpSource ?? "",
              score.courseHcpVerifiedAt ?? "",
              score.courseHcpOverride ? "yes" : "no",
              score.recordedAt,
            ])
          );
        }
      }

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-scores-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/scores.csv failed:", err);
      res.status(500).json({ error: "Failed to export score evidence" });
    }
  });

  app.get("/api/export/tee-times.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const tournaments = getAllTournaments();
      const memberNames = new Set(
        getAllPlayers()
          .filter((player) => player.member)
          .map((player) => normalizeName(player.name))
      );
      const rows = [
        csvLine([
          "tee_time_id",
          "date",
          "time",
          "course",
          "host",
          "status",
          "spots",
          "committed_count",
          "committed_players",
          "maybe_count",
          "maybe_players",
          "guest_count",
          "score_count",
          "pending_attestations",
          "comments_count",
          "notes",
          "tournament",
          "created_at",
        ]),
      ];
      for (const teeTime of teeTimes) {
        const tournament =
          tournaments.find(
            (candidate) =>
              candidate.type !== "post" &&
              teeTime.date >= candidate.windowStart &&
              teeTime.date <= candidate.windowEnd
          ) ?? null;
        const guestCount = teeTime.claims.filter(
          (claim) => !memberNames.has(normalizeName(claim.name))
        ).length;
        const pendingAttestations = teeTime.scores.filter(
          (score) =>
            score.attestationStatus == null || score.attestationStatus === "pending"
        ).length;
        const status =
          teeTime.claims.length >= teeTime.spots
            ? "full"
            : teeTime.interested.length > 0
              ? "needs_decision"
              : "open";
        rows.push(
          csvLine([
            teeTime.id,
            teeTime.date,
            teeTime.time,
            teeTime.course,
            teeTime.host,
            status,
            teeTime.spots,
            teeTime.claims.length,
            teeTime.claims.map((claim) => claim.name).join("; "),
            teeTime.interested.length,
            teeTime.interested.map((interest) => interest.name).join("; "),
            guestCount,
            teeTime.scores.length,
            pendingAttestations,
            teeTime.comments.length,
            teeTime.notes ?? "",
            tournament?.name ?? "",
            teeTime.createdAt,
          ])
        );
      }
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-tee-times-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/tee-times.csv failed:", err);
      res.status(500).json({ error: "Failed to export tee-time ledger" });
    }
  });

  app.get("/api/export/attestations.csv", requireCommissioner, (_req, res) => {
    try {
      const rows = [
        csvLine([
          "tee_time_id",
          "date",
          "time",
          "course",
          "player",
          "gross",
          "course_hcp",
          "net",
          "selected_attester",
          "attestation_status",
          "attested_at",
          "attestation_actor",
          "entered_by",
          "recorded_at",
        ]),
      ];
      for (const teeTime of getAllTeeTimes()) {
        for (const score of teeTime.scores) {
          rows.push(
            csvLine([
              teeTime.id,
              teeTime.date,
              teeTime.time,
              teeTime.course,
              score.name,
              score.gross,
              score.courseHcp ?? "",
              score.net ??
                (score.courseHcp != null ? score.gross - score.courseHcp : ""),
              score.attestedBy ?? "",
              score.attestationStatus ?? "legacy_unconfirmed",
              score.attestedAt ?? "",
              score.attestationActor ?? "",
              score.enteredBy ?? "",
              score.recordedAt,
            ])
          );
        }
      }
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-attestations-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/attestations.csv failed:", err);
      res.status(500).json({ error: "Failed to export attestation ledger" });
    }
  });

  app.get("/api/export/standings.csv", requireCommissioner, (_req, res) => {
    try {
      const players = getAllPlayers();
      const standings = sortStandings(
        computeStandings(
          getAllTeeTimes() as PublicTeeTime[],
          getHandicapFromPlayers(players),
          getAllTournaments() as PublicTournament[]
        ),
        "seasonPoints"
      );
      const rows = [
        csvLine([
          "rules_version",
          "rank",
          "player",
          "rounds",
          "official_rounds",
          "draft_scores",
          "pending_scores",
          "attested_scores",
          "overridden_scores",
          "legacy_unconfirmed_scores",
          "total_scores",
          "season_points",
          "avg_net",
          "best_net",
          "avg_gross",
          "best_gross",
        ]),
        ...standings.map((row, index) =>
          csvLine([
            row.rulesVersion,
            index + 1,
            row.name,
            row.rounds,
            row.scoreStatusCounts.official,
            row.scoreStatusCounts.draft,
            row.scoreStatusCounts.pending,
            row.scoreStatusCounts.attested,
            row.scoreStatusCounts.overridden,
            row.scoreStatusCounts.legacyUnconfirmed,
            row.scoreStatusCounts.total,
            row.seasonPoints,
            row.avgNet ?? "",
            row.bestNet ?? "",
            row.avgGross ?? "",
            row.bestGross ?? "",
          ])
        ),
      ];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-standings-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/standings.csv failed:", err);
      res.status(500).json({ error: "Failed to export standings ledger" });
    }
  });

  app.get("/api/export/payouts.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const getHandicap = getHandicapFromPlayers(players);
      const rows = [
        csvLine([
          "rules_version",
          "tournament_id",
          "tournament",
          "type",
          "closed",
          "closed_at",
          "closed_by",
          "winner",
          "winner_net",
          "second",
          "second_net",
          "third",
          "third_net",
          "payout_first",
          "payout_second",
          "payout_third",
          "payout_confirmed",
          "payout_paid_at",
          "evidence_status",
          "evidence_note",
          "evidence_missing",
          "closeout_packet_url",
          "closeout_ledger_url",
        ]),
      ];

      for (const tournament of getAllTournaments().filter(
        (item) => item.type !== "post"
      )) {
        const leaderboard = computeTournamentLeaderboard(
          tournament as PublicTournament,
          teeTimes as PublicTeeTime[],
          getHandicap
        );
        const evidence = buildPayoutEvidence(tournament as PublicTournament);
        const first = leaderboard[0] ?? null;
        const second = leaderboard[1] ?? null;
        const third = leaderboard[2] ?? null;
        rows.push(
          csvLine([
            ACTIVE_RULES_VERSION,
            tournament.id,
            tournament.name,
            tournament.type,
            tournament.closedAt ? "yes" : "no",
            tournament.closedAt ?? "",
            tournament.closedBy ?? "",
            first?.name ?? "",
            first?.bestNet ?? "",
            second?.name ?? "",
            second?.bestNet ?? "",
            third?.name ?? "",
            third?.bestNet ?? "",
            tournament.payoutFirst ?? "",
            tournament.payoutSecond ?? "",
            tournament.payoutThird ?? "",
            tournament.payoutConfirmed ? "yes" : "no",
            tournament.payoutPaidAt ?? "",
            evidence.status,
            evidence.note ?? "",
            evidence.missing ? "yes" : "no",
            `/api/export/closeout/${encodeURIComponent(tournament.id)}.txt`,
            `/api/export/closeout/${encodeURIComponent(tournament.id)}.json`,
          ])
        );
      }

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-payouts-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/payouts.csv failed:", err);
      res.status(500).json({ error: "Failed to export payout ledger" });
    }
  });

  app.get("/api/export/readiness.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const getHandicap = getHandicapFromPlayers(players);
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const members = players
        .filter((player) => player.member)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      const buyinKeys = new Set(
        buyins.map((buyin) => normalizeName(buyin.playerName))
      );
      const missingBuyins = members
        .filter((player) => !buyinKeys.has(normalizeName(player.name)))
        .map((player) => player.name);
      const missingHandicaps = missingSourceBackedHandicapPlayers(members).map(
        (player) => player.name
      );
      const unconfirmedTournaments = tournaments.filter(
        (tournament) =>
          tournament.course.toLowerCase() === "tbd" ||
          tournament.notes?.toLowerCase().includes("tbd")
      );
      const unconfirmedEvents = unconfirmedTournaments.map(
        (tournament) => tournament.name
      );
      const expected = buyins.reduce((sum, buyin) => sum + buyin.amount, 0);
      const collected = buyins.reduce(
        (sum, buyin) => sum + (buyin.paid ? buyin.amount : 0),
        0
      );
      const activeTournament =
        tournaments.find(
          (tournament) =>
            tournament.type !== "post" &&
            today >= tournament.windowStart &&
            today <= tournament.windowEnd
        ) ?? null;
      const activeBoard = activeTournament
        ? computeTournamentLeaderboard(
            activeTournament as PublicTournament,
            teeTimes as PublicTeeTime[],
            getHandicap
          )
        : [];
      const rosterNames = Array.from(
        new Map(
          [
            ...members.map(
              (player) => [normalizeName(player.name), player.name] as const
            ),
            ...buyins.map(
              (buyin) => [normalizeName(buyin.playerName), buyin.playerName] as const
            ),
          ]
        ).values()
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      const scored = new Set(activeBoard.map((row) => normalizeName(row.name)));
      const stillToScore = rosterNames.filter(
        (name) => !scored.has(normalizeName(name))
      );
      const launchCheckEvidence = launchCheckRecords();
      const launchChecks = launchCheckState();
      const verificationRuns = getAllVerificationRuns();
      const launchRisks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });
      const closeoutReadiness = tournaments
        .filter((tournament) => tournament.type !== "post")
        .map((tournament) => {
          const readiness = buildCloseoutReadiness({
            tournament: tournament as PublicTournament,
            tournaments: tournaments as PublicTournament[],
            teeTimes: teeTimes as PublicTeeTime[],
            players,
            today,
            getHandicap,
          });
          const leader = readiness.board[0] ?? null;
          return {
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            status: readiness.status,
            detail: readiness.detail,
            buttonLabel: readiness.buttonLabel,
            issueCount: readiness.issues.length,
            packetUrl: `/api/export/closeout/${encodeURIComponent(
              tournament.id
            )}.txt`,
            ledgerUrl: `/api/export/closeout/${encodeURIComponent(
              tournament.id
            )}.json`,
            leader: leader
              ? {
                  name: leader.name,
                  bestGross: leader.bestGross,
                  bestNet: leader.bestNet,
                }
              : null,
          };
        });
      const standings = sortStandings(
        computeStandings(
          teeTimes as PublicTeeTime[],
          getHandicap,
          tournaments as PublicTournament[]
        ),
        "seasonPoints"
      );
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const evidenceGapPacket = buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      });

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-readiness-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        rulesVersion: ACTIVE_RULES_VERSION,
        activeRules: ACTIVE_LEAGUE_RULES,
        today,
        counts: {
          members: members.length,
          buyins: buyins.length,
          tournaments: tournaments.length,
          teeTimes: teeTimes.length,
          ruleBlockers: issues.length,
          launchRisks: launchRisks.length,
          commissionerTasks: commissionerTasks.length,
          closeoutItems: closeoutReadiness.length,
          standingsRows: standings.length,
          verificationRuns: verificationRuns.length,
        },
        status: {
          blockerCount: issues.length,
          riskCount: launchRisks.filter((risk) => risk.severity === "risk")
            .length,
          externalCount: launchRisks.filter(
            (risk) => risk.severity === "external"
          ).length,
          ready: launchRisks.length === 0,
        },
        money: {
          expected,
          collected,
          outstanding: expected - collected,
          paid: buyins.filter((buyin) => buyin.paid).length,
          total: buyins.length,
        },
        missingHandicaps,
        unconfirmedEvents,
        roster: {
          members: members.length,
          expectedMembers: 12,
          missingBuyins,
          missingHandicaps,
        },
        schedule: {
          unconfirmed: unconfirmedTournaments.map((tournament) => ({
            id: tournament.id,
            name: tournament.name,
            course: tournament.course,
            windowStart: tournament.windowStart,
            windowEnd: tournament.windowEnd,
            notes: tournament.notes,
          })),
        },
        rules: {
          version: ACTIVE_RULES_VERSION,
          active: ACTIVE_LEAGUE_RULES,
          blockers: issues,
        },
        activeStop: activeTournament
          ? {
              id: activeTournament.id,
              name: activeTournament.name,
              windowEnd: activeTournament.windowEnd,
              leader: activeBoard[0]
                ? {
                    name: activeBoard[0].name,
                    bestGross: activeBoard[0].bestGross,
                    bestNet: activeBoard[0].bestNet,
                  }
                : null,
              scoresPosted: activeBoard.length,
              stillToScore,
              leaderboard: activeBoard,
              rulesVersion: ACTIVE_RULES_VERSION,
            }
          : null,
        closeoutReadiness,
        standings: standings.map((row) => ({
          rulesVersion: row.rulesVersion,
          name: row.name,
          rounds: row.rounds,
          seasonPoints: row.seasonPoints,
          avgNet: row.avgNet,
          bestNet: row.bestNet,
          avgGross: row.avgGross,
          bestGross: row.bestGross,
          scoreStatusCounts: row.scoreStatusCounts,
        })),
        launchChecks,
        launchCheckEvidence,
        verificationRuns: verificationRuns.slice(0, 10),
        sourceSearchLedger: {
          ...sourceSearchSummary(SOURCE_SEARCH_LEDGER),
          url: "/api/export/source-search-ledger.json",
          csvUrl: "/api/export/source-search-ledger.csv",
        },
        evidenceGapPacket: {
          ...evidenceGapPacket.summary,
          url: "/api/export/evidence-gap-packet.json",
          csvUrl: "/api/export/evidence-gap-packet.csv",
          textUrl: "/api/export/evidence-gap-packet.txt",
        },
        launchRisks,
        commissionerTasks,
      });
    } catch (err) {
      console.error("GET /api/export/readiness.json failed:", err);
      res.status(500).json({ error: "Failed to export readiness" });
    }
  });

  app.get("/api/export/tasks.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const launchCheckEvidence = launchCheckRecords();
      const launchRisks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const taskPacket = buildCommissionerTaskSummary(commissionerTasks);
      const requestPacket = buildCommissionerRequestPacket(commissionerTasks);

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-tasks-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        count: commissionerTasks.length,
        copyPacket: taskPacket,
        requestPacket,
        tasks: commissionerTasks,
        launchRisks,
        launchChecks,
        launchCheckEvidence,
      });
    } catch (err) {
      console.error("GET /api/export/tasks.json failed:", err);
      res.status(500).json({ error: "Failed to export tasks" });
    }
  });

  app.get("/api/export/tasks.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-tasks-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${commissionerTasksCsv(commissionerTasks)}\n`);
    } catch (err) {
      console.error("GET /api/export/tasks.csv failed:", err);
      res.status(500).json({ error: "Failed to export tasks CSV" });
    }
  });

  app.get("/api/export/risks.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const risks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-risks-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        count: risks.length,
        severityCounts: {
          blocker: risks.filter((risk) => risk.severity === "blocker").length,
          risk: risks.filter((risk) => risk.severity === "risk").length,
          external: risks.filter((risk) => risk.severity === "external").length,
        },
        ready: risks.length === 0,
        risks,
      });
    } catch (err) {
      console.error("GET /api/export/risks.json failed:", err);
      res.status(500).json({ error: "Failed to export risk register" });
    }
  });

  app.get("/api/export/risks.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const risks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-risks-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${launchRisksCsv(risks)}\n`);
    } catch (err) {
      console.error("GET /api/export/risks.csv failed:", err);
      res.status(500).json({ error: "Failed to export risk register CSV" });
    }
  });

  app.get("/api/export/source-search-ledger.json", requireCommissioner, (_req, res) => {
    try {
      const entries = SOURCE_SEARCH_LEDGER;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-source-search-ledger-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        ...sourceSearchSummary(entries),
        entries,
      });
    } catch (err) {
      console.error("GET /api/export/source-search-ledger.json failed:", err);
      res.status(500).json({ error: "Failed to export source search ledger" });
    }
  });

  app.get("/api/export/source-search-ledger.csv", requireCommissioner, (_req, res) => {
    try {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-source-search-ledger-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${sourceSearchLedgerCsv(SOURCE_SEARCH_LEDGER)}\n`);
    } catch (err) {
      console.error("GET /api/export/source-search-ledger.csv failed:", err);
      res.status(500).json({ error: "Failed to export source search ledger CSV" });
    }
  });

  app.get("/api/export/request-packet.txt", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-request-packet-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`
      );
      res.send(`${buildCommissionerRequestPacket(commissionerTasks)}\n`);
    } catch (err) {
      console.error("GET /api/export/request-packet.txt failed:", err);
      res.status(500).json({ error: "Failed to export request packet" });
    }
  });

  app.get("/api/export/blocker-handoff.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const handoff = buildBlockerHandoff(
        commissionerTasks,
        SOURCE_SEARCH_LEDGER
      );

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-blocker-handoff-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        ...handoff,
      });
    } catch (err) {
      console.error("GET /api/export/blocker-handoff.json failed:", err);
      res.status(500).json({ error: "Failed to export blocker handoff" });
    }
  });

  app.get("/api/export/blocker-handoff.txt", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-blocker-handoff-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`
      );
      res.send(
        `${buildBlockerHandoffText(commissionerTasks, SOURCE_SEARCH_LEDGER)}\n`
      );
    } catch (err) {
      console.error("GET /api/export/blocker-handoff.txt failed:", err);
      res.status(500).json({ error: "Failed to export blocker handoff text" });
    }
  });

  app.get("/api/export/evidence-gap-packet.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const packet = buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      });

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-evidence-gap-packet-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        sourceSearch: sourceSearchSummary(SOURCE_SEARCH_LEDGER),
        ...packet,
      });
    } catch (err) {
      console.error("GET /api/export/evidence-gap-packet.json failed:", err);
      res.status(500).json({ error: "Failed to export evidence gap packet" });
    }
  });

  app.get("/api/export/evidence-gap-packet.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const packet = buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      });

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-evidence-gap-packet-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${evidenceGapPacketCsv(packet.items)}\n`);
    } catch (err) {
      console.error("GET /api/export/evidence-gap-packet.csv failed:", err);
      res.status(500).json({ error: "Failed to export evidence gap packet CSV" });
    }
  });

  app.get("/api/export/evidence-gap-packet.txt", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const packet = buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      });

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-evidence-gap-packet-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`
      );
      res.send(`${buildEvidenceGapPacketText(packet)}\n`);
    } catch (err) {
      console.error("GET /api/export/evidence-gap-packet.txt failed:", err);
      res.status(500).json({ error: "Failed to export evidence gap packet text" });
    }
  });

  app.get("/api/export/launch-checks.json", requireCommissioner, (_req, res) => {
    try {
      const records = launchCheckRecords();
      const verifiedCount = records.filter((record) => record.verified).length;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-checks-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        count: records.length,
        verifiedCount,
        openCount: records.length - verifiedCount,
        launchChecks: launchCheckState(),
        records,
      });
    } catch (err) {
      console.error("GET /api/export/launch-checks.json failed:", err);
      res.status(500).json({ error: "Failed to export launch checks" });
    }
  });

  app.get("/api/export/launch-checks.csv", requireCommissioner, (_req, res) => {
    try {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-checks-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${launchChecksCsv(launchCheckRecords())}\n`);
    } catch (err) {
      console.error("GET /api/export/launch-checks.csv failed:", err);
      res.status(500).json({ error: "Failed to export launch checks CSV" });
    }
  });

  app.get("/api/export/launch-gate-checklist.json", requireCommissioner, (_req, res) => {
    try {
      const records = launchCheckRecords();
      const checklist = buildLaunchGateChecklist(records, {
        productionUrlRequired: launchCheckState().productionUrlRequired,
      });
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-gate-checklist-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        ...checklist,
      });
    } catch (err) {
      console.error("GET /api/export/launch-gate-checklist.json failed:", err);
      res.status(500).json({ error: "Failed to export launch gate checklist" });
    }
  });

  app.get("/api/export/launch-gate-checklist.csv", requireCommissioner, (_req, res) => {
    try {
      const checklist = buildLaunchGateChecklist(launchCheckRecords(), {
        productionUrlRequired: launchCheckState().productionUrlRequired,
      });
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-gate-checklist-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${launchGateChecklistCsv(checklist.items)}\n`);
    } catch (err) {
      console.error("GET /api/export/launch-gate-checklist.csv failed:", err);
      res
        .status(500)
        .json({ error: "Failed to export launch gate checklist CSV" });
    }
  });

  app.get("/api/export/launch-gate-checklist.txt", requireCommissioner, (_req, res) => {
    try {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-gate-checklist-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`
      );
      res.send(
        `${buildLaunchGateChecklistText(launchCheckRecords(), {
          productionUrlRequired: launchCheckState().productionUrlRequired,
        })}\n`
      );
    } catch (err) {
      console.error("GET /api/export/launch-gate-checklist.txt failed:", err);
      res
        .status(500)
        .json({ error: "Failed to export launch gate checklist text" });
    }
  });

  app.get("/api/export/completion-audit.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const launchCheckEvidence = launchCheckRecords();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const completionAudit = buildCompletionAudit({
        teeTimes,
        players,
        buyins,
        tournaments,
        ruleIssues,
        launchChecks,
        launchCheckEvidence,
        commissionerTasks,
        verificationRuns: getAllVerificationRuns(),
      });

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-completion-audit-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        ...completionAudit,
      });
    } catch (err) {
      console.error("GET /api/export/completion-audit.json failed:", err);
      res.status(500).json({ error: "Failed to export completion audit" });
    }
  });

  app.get("/api/export/completion-audit.csv", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const today = localTodayISO();
      const ruleIssues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const launchCheckEvidence = launchCheckRecords();
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const completionAudit = buildCompletionAudit({
        teeTimes,
        players,
        buyins,
        tournaments,
        ruleIssues,
        launchChecks,
        launchCheckEvidence,
        commissionerTasks,
        verificationRuns: getAllVerificationRuns(),
      });

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-completion-audit-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${completionAuditCsv(completionAudit.items)}\n`);
    } catch (err) {
      console.error("GET /api/export/completion-audit.csv failed:", err);
      res.status(500).json({ error: "Failed to export completion audit CSV" });
    }
  });

  app.get("/api/export/audit.json", requireCommissioner, (_req, res) => {
    try {
      const events = (stmtSelectAllAuditEvents.all() as AuditEventRow[]).map(
        rowToAuditEvent
      );
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-audit-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        count: events.length,
        events,
      });
    } catch (err) {
      console.error("GET /api/export/audit.json failed:", err);
      res.status(500).json({ error: "Failed to export audit events" });
    }
  });

  app.get("/api/export/audit.csv", requireCommissioner, (_req, res) => {
    try {
      const events = (stmtSelectAllAuditEvents.all() as AuditEventRow[]).map(
        rowToAuditEvent
      );
      const rows = [
        csvLine([
          "created_at",
          "action",
          "actor",
          "subject_type",
          "subject_id",
          "summary",
        ]),
        ...events.map((event) =>
          csvLine([
            event.createdAt,
            event.action,
            event.actor,
            event.subjectType,
            event.subjectId,
            event.summary,
          ])
        ),
      ];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-audit-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/audit.csv failed:", err);
      res.status(500).json({ error: "Failed to export audit events" });
    }
  });

  app.get("/api/export/verification-runs.json", requireCommissioner, (_req, res) => {
    try {
      const verificationRuns = getAllVerificationRuns();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-verification-runs-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        count: verificationRuns.length,
        verificationRuns,
      });
    } catch (err) {
      console.error("GET /api/export/verification-runs.json failed:", err);
      res.status(500).json({ error: "Failed to export verification runs" });
    }
  });

  app.get("/api/export/verification-runs.csv", requireCommissioner, (_req, res) => {
    try {
      const verificationRuns = getAllVerificationRuns();
      const rows = [
        csvLine([
          "created_at",
          "command",
          "status",
          "recorded_by",
          "scope",
          "summary",
        ]),
        ...verificationRuns.map((run) =>
          csvLine([
            run.createdAt,
            run.command,
            run.status,
            run.recordedBy,
            run.scope.join(" | "),
            run.summary,
          ])
        ),
      ];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-verification-runs-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.send(`${rows.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/verification-runs.csv failed:", err);
      res.status(500).json({ error: "Failed to export verification runs" });
    }
  });

  app.get("/api/export/archive.json", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const auditEvents = (stmtSelectAllAuditEvents.all() as AuditEventRow[]).map(
        rowToAuditEvent
      );
      const verificationRuns = getAllVerificationRuns();
      const today = localTodayISO();
      const getHandicap = getHandicapFromPlayers(players);
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchChecks = launchCheckState();
      const launchCheckEvidence = launchCheckRecords();
      const launchRisks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const evidenceGapPacket = buildEvidenceGapPacket({
        players,
        buyins,
        tournaments,
        tasks: commissionerTasks,
        sourceEntries: SOURCE_SEARCH_LEDGER,
      });
      const completionAudit = buildCompletionAudit({
        teeTimes,
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        launchChecks,
        launchCheckEvidence,
        commissionerTasks,
        verificationRuns,
      });
      const expected = buyins.reduce((sum, buyin) => sum + buyin.amount, 0);
      const collected = buyins.reduce(
        (sum, buyin) => sum + (buyin.paid ? buyin.amount : 0),
        0
      );
      const closeouts = tournaments
        .filter((tournament) => tournament.type !== "post")
        .map((tournament) => {
          const readiness = buildCloseoutReadiness({
            tournament: tournament as PublicTournament,
            tournaments: tournaments as PublicTournament[],
            teeTimes: teeTimes as PublicTeeTime[],
            players,
            today,
            getHandicap,
          });
          return {
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            status: readiness.status,
            issueCount: readiness.issues.length,
            scoreEvidenceRows: readiness.board.reduce(
              (sum, row) => sum + row.rounds,
              0
            ),
            packetUrl: `/api/export/closeout/${encodeURIComponent(
              tournament.id
            )}.txt`,
            ledgerUrl: `/api/export/closeout/${encodeURIComponent(
              tournament.id
            )}.json`,
          };
        });
      const artifacts = [
        {
          id: "season-json",
          label: "Full season JSON",
          url: "/api/export/season.json",
          format: "json",
          proves: "Raw season tables, players, buy-ins, tee times, polls, audit events",
        },
        {
          id: "rules-json",
          label: "League rules JSON",
          url: "/api/export/rules.json",
          format: "json",
          proves: "Active rules version for points, buy-ins, payouts, ties, guests, postseason, and handicap policy",
        },
        {
          id: "readiness-json",
          label: "Commissioner readiness",
          url: "/api/export/readiness.json",
          format: "json",
          proves: "Current blockers, risks, standings, active stop, closeout readiness",
        },
        {
          id: "tasks-json",
          label: "Open task queue",
          url: "/api/export/tasks.json",
          format: "json",
          proves: "Copy-ready commissioner task list",
        },
        {
          id: "tasks-csv",
          label: "Open task queue CSV",
          url: "/api/export/tasks.csv",
          format: "csv",
          proves: "Spreadsheet-friendly commissioner task queue with copy text",
        },
        {
          id: "risks-json",
          label: "Remaining risk register",
          url: "/api/export/risks.json",
          format: "json",
          proves: "Current blocker, risk, and external launch inventory",
        },
        {
          id: "risks-csv",
          label: "Remaining risk register CSV",
          url: "/api/export/risks.csv",
          format: "csv",
          proves: "Spreadsheet-friendly remaining risk inventory",
        },
        {
          id: "request-packet",
          label: "Outbound request packet",
          url: "/api/export/request-packet.txt",
          format: "txt",
          proves: "One copy-ready packet for money, GHIN, schedule, access, and launch asks",
        },
        {
          id: "blocker-handoff-json",
          label: "Commissioner handoff",
          url: "/api/export/blocker-handoff.json",
          format: "json",
          proves: "Open commissioner tasks joined to source-search decisions and required manual actions",
        },
        {
          id: "blocker-handoff-text",
          label: "Commissioner handoff text",
          url: "/api/export/blocker-handoff.txt",
          format: "txt",
          proves: "Human-readable handoff for unresolved data, launch, and physical-device gates",
        },
        {
          id: "evidence-gap-packet-json",
          label: "Evidence gap packet",
          url: "/api/export/evidence-gap-packet.json",
          format: "json",
          proves: "One-row-per-gap tracker for remaining GHIN, payment, schedule, production URL, and iPhone Safari proof",
        },
        {
          id: "evidence-gap-packet-csv",
          label: "Evidence gap packet CSV",
          url: "/api/export/evidence-gap-packet.csv",
          format: "csv",
          proves: "Spreadsheet-friendly paste-back tracker for every unresolved evidence gap",
        },
        {
          id: "evidence-gap-packet-text",
          label: "Evidence gap packet text",
          url: "/api/export/evidence-gap-packet.txt",
          format: "txt",
          proves: "Human-readable evidence request and paste-back templates for each open gap",
        },
        {
          id: "source-search-ledger-json",
          label: "Source search ledger",
          url: "/api/export/source-search-ledger.json",
          format: "json",
          proves: "Searched sources, recorded facts, exhausted searches, and blocked sources behind remaining gaps",
        },
        {
          id: "source-search-ledger-csv",
          label: "Source search ledger CSV",
          url: "/api/export/source-search-ledger.csv",
          format: "csv",
          proves: "Spreadsheet-friendly source-search evidence ledger",
        },
        {
          id: "completion-audit-json",
          label: "Completion audit",
          url: "/api/export/completion-audit.json",
          format: "json",
          proves: "Requirement-by-requirement proof status and next actions",
        },
        {
          id: "completion-audit-csv",
          label: "Completion audit CSV",
          url: "/api/export/completion-audit.csv",
          format: "csv",
          proves: "Spreadsheet-friendly requirement proof map",
        },
        {
          id: "launch-checks-json",
          label: "Launch checks",
          url: "/api/export/launch-checks.json",
          format: "json",
          proves: "Docker, production URL, and physical mobile launch gate evidence",
        },
        {
          id: "launch-checks-csv",
          label: "Launch checks CSV",
          url: "/api/export/launch-checks.csv",
          format: "csv",
          proves: "Spreadsheet-friendly launch gate evidence",
        },
        {
          id: "launch-gate-checklist-json",
          label: "Launch gate checklist",
          url: "/api/export/launch-gate-checklist.json",
          format: "json",
          proves: "Structured launch-gate evidence checklist for Docker, production URL, and physical iPhone Safari",
        },
        {
          id: "launch-gate-checklist-csv",
          label: "Launch gate checklist CSV",
          url: "/api/export/launch-gate-checklist.csv",
          format: "csv",
          proves: "Spreadsheet-friendly launch-gate checklist",
        },
        {
          id: "launch-gate-checklist-text",
          label: "Launch gate checklist text",
          url: "/api/export/launch-gate-checklist.txt",
          format: "txt",
          proves: "Human-readable launch-gate checklist for the remaining public URL and physical iPhone checks",
        },
        {
          id: "audit-json",
          label: "Audit events JSON",
          url: "/api/export/audit.json",
          format: "json",
          proves: "Durable mutation history with before/after details",
        },
        {
          id: "audit-csv",
          label: "Audit events CSV",
          url: "/api/export/audit.csv",
          format: "csv",
          proves: "Spreadsheet-friendly mutation log",
        },
        {
          id: "verification-runs-json",
          label: "Verification runs JSON",
          url: "/api/export/verification-runs.json",
          format: "json",
          proves: "Durable proof ledger for named verification commands",
        },
        {
          id: "verification-runs-csv",
          label: "Verification runs CSV",
          url: "/api/export/verification-runs.csv",
          format: "csv",
          proves: "Spreadsheet-friendly proof ledger",
        },
        {
          id: "buyins-csv",
          label: "Buy-ins CSV",
          url: "/api/export/buyins.csv",
          format: "csv",
          proves: "Money ledger",
        },
        {
          id: "roster-csv",
          label: "Roster CSV",
          url: "/api/export/roster.csv",
          format: "csv",
          proves: "Member, GHIN, and buy-in reconciliation",
        },
        {
          id: "scores-csv",
          label: "Scores CSV",
          url: "/api/export/scores.csv",
          format: "csv",
          proves: "Round evidence, net source, and attestation",
        },
        {
          id: "payouts-csv",
          label: "Payout ledger CSV",
          url: "/api/export/payouts.csv",
          format: "csv",
          proves: "Tournament payout closeout state, winners, amounts, and settlement evidence",
        },
        {
          id: "summary-text",
          label: "Season summary",
          url: "/api/export/summary.txt",
          format: "txt",
          proves: "Human-readable commissioner handoff",
        },
        {
          id: "launch-packet",
          label: "Launch packet",
          url: "/api/export/launch-packet.txt",
          format: "txt",
          proves: "Readiness, risks, asks, and verification commands",
        },
        {
          id: "database",
          label: "SQLite database backup",
          url: "/api/export/database",
          format: "sqlite",
          proves: "Restorable source of truth",
        },
      ];
      const snapshot = {
        today,
        tournaments,
        teeTimes,
        players,
        buyins,
        auditEventIds: auditEvents.map((event) => event.id),
        verificationRunIds: verificationRuns.map((run) => run.id),
        launchCheckEvidence,
        launchGateChecklist: buildLaunchGateChecklist(launchCheckEvidence, {
          productionUrlRequired: launchChecks.productionUrlRequired,
        }).summary,
        sourceSearchLedgerIds: SOURCE_SEARCH_LEDGER.map((entry) => entry.id),
        evidenceGapPacketIds: evidenceGapPacket.items.map((item) => item.id),
        completionAudit: completionAudit.statusCounts,
      };

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-archive-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        version: 1,
        app: "DJDI Golf Board",
        today,
        snapshotHash: sha256Json(snapshot),
        status: {
          ready: launchRisks.length === 0,
          blockerCount: issues.length,
          riskCount: launchRisks.filter((risk) => risk.severity === "risk")
            .length,
          externalCount: launchRisks.filter(
            (risk) => risk.severity === "external"
          ).length,
        },
        counts: {
          members: players.filter((player) => player.member).length,
          buyins: buyins.length,
          tournaments: tournaments.length,
          teeTimes: teeTimes.length,
          scores: teeTimes.reduce(
            (sum, teeTime) => sum + teeTime.scores.length,
            0
          ),
          auditEvents: auditEvents.length,
          verificationRuns: verificationRuns.length,
          closeoutItems: closeouts.length,
          sourceSearchEntries: SOURCE_SEARCH_LEDGER.length,
        },
        money: {
          expected,
          collected,
          outstanding: expected - collected,
          paid: buyins.filter((buyin) => buyin.paid).length,
          total: buyins.length,
        },
        launchChecks,
        launchCheckEvidence,
        launchGateChecklist: {
          ...buildLaunchGateChecklist(launchCheckEvidence, {
            productionUrlRequired: launchChecks.productionUrlRequired,
          }).summary,
          url: "/api/export/launch-gate-checklist.json",
          csvUrl: "/api/export/launch-gate-checklist.csv",
          textUrl: "/api/export/launch-gate-checklist.txt",
        },
        verificationRuns: verificationRuns.slice(0, 10),
        completionAudit: {
          ready: completionAudit.ready,
          appReady: completionAudit.appReady,
          statusCounts: completionAudit.statusCounts,
          appStatusCounts: completionAudit.appStatusCounts,
          leagueDataOpen: completionAudit.leagueDataOpen,
          externalVerificationOpen: completionAudit.externalVerificationOpen,
          url: "/api/export/completion-audit.json",
        },
        sourceSearchLedger: {
          ...sourceSearchSummary(SOURCE_SEARCH_LEDGER),
          url: "/api/export/source-search-ledger.json",
        },
        evidenceGapPacket: {
          ...evidenceGapPacket.summary,
          url: "/api/export/evidence-gap-packet.json",
          csvUrl: "/api/export/evidence-gap-packet.csv",
          textUrl: "/api/export/evidence-gap-packet.txt",
        },
        remainingRisks: launchRisks,
        commissionerTasks,
        artifacts,
        closeouts,
      });
    } catch (err) {
      console.error("GET /api/export/archive.json failed:", err);
      res.status(500).json({ error: "Failed to export season archive" });
    }
  });

  app.get("/api/export/closeout/:file", requireCommissioner, (req, res) => {
    try {
      const wantsJson = /\.json$/i.test(req.params.file);
      const tournamentId = req.params.file.replace(/\.(txt|json)$/i, "");
      const row = stmtSelectTournamentById.get(tournamentId) as
        | TournamentRow
        | undefined;
      if (!row) throw new NotFoundError("Tournament not found");
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const tournaments = getAllTournaments();
      const getHandicap = getHandicapFromPlayers(players);
      if (wantsJson) {
        const ledger = buildCloseoutLedger({
          tournament: rowToTournament(row) as PublicTournament,
          tournaments: tournaments as PublicTournament[],
          teeTimes: teeTimes as PublicTeeTime[],
          players,
          today: localTodayISO(),
          getHandicap,
        });
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader(
          "content-disposition",
          `attachment; filename="djdi-closeout-${exportSlug(
            row.name
          )}-${new Date().toISOString().slice(0, 10)}.json"`
        );
        return res.json(ledger);
      }
      const packet = buildCloseoutPacket({
        tournament: rowToTournament(row) as PublicTournament,
        tournaments: tournaments as PublicTournament[],
        teeTimes: teeTimes as PublicTeeTime[],
        players,
        today: localTodayISO(),
        getHandicap,
      });

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-closeout-${exportSlug(
          row.name
        )}-${new Date().toISOString().slice(0, 10)}.txt"`
      );
      res.send(packet);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("GET /api/export/closeout/:file failed:", err);
      res.status(500).json({ error: "Failed to export closeout packet" });
    }
  });

  app.get("/api/export/summary.txt", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const getHandicap = getHandicapFromPlayers(players);
      const issues = auditLeagueRules(
        teeTimes,
        tournaments,
        players,
        "9999-12-31"
      );
      const settled = buyins
        .filter((b) => b.paid)
        .reduce((sum, b) => sum + b.amount, 0);
      const expected = buyins.reduce((sum, b) => sum + b.amount, 0);
      const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;
      const formatBuyinLine = (buyin: (typeof buyins)[number]) => {
        const status =
          buyin.paymentStatus === "paid"
            ? `paid${buyin.paidAt ? ` ${buyin.paidAt.slice(0, 10)}` : ""}`
            : buyin.paymentStatus === "comped"
              ? `comped${buyin.paidAt ? ` ${buyin.paidAt.slice(0, 10)}` : ""}`
              : buyin.paymentStatus;
        const note = buyin.notes ? ` — ${buyin.notes}` : "";
        return `${buyin.playerName}: ${status} ${money(buyin.amount)}${note}`;
      };
      const today = localTodayISO();
      const rosterNames = () => {
        const names = new Map<string, string>();
        for (const player of players) {
          if (player.member) names.set(normalizeName(player.name), player.name);
        }
        for (const buyin of buyins) {
          names.set(normalizeName(buyin.playerName), buyin.playerName);
        }
        return Array.from(names.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
      };
      const stillToScoreFor = (board: { name: string }[]) => {
        const scored = new Set(board.map((row) => normalizeName(row.name)));
        return rosterNames().filter((name) => !scored.has(normalizeName(name)));
      };
      const activeTournament =
        tournaments.find(
          (tournament) =>
            tournament.type !== "post" &&
            today >= tournament.windowStart &&
            today <= tournament.windowEnd
        ) ?? null;
      const members = players
        .filter((player) => player.member)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      const buyinKeys = new Set(
        buyins.map((buyin) => normalizeName(buyin.playerName))
      );
      const missingBuyins = members
        .filter((player) => !buyinKeys.has(normalizeName(player.name)))
        .map((player) => player.name);
      const missingHandicaps = missingSourceBackedHandicapPlayers(members).map(
        (player) => player.name
      );
      const unconfirmedEvents = tournaments
        .filter(
          (tournament) =>
            tournament.course.toLowerCase() === "tbd" ||
            tournament.notes?.toLowerCase().includes("tbd")
        )
        .map((tournament) => tournament.name);
      const readinessItems = [
        {
          label: "Roster",
          status:
            members.length === 12 && missingBuyins.length === 0 ? "OK" : "RISK",
          detail:
            members.length === 12 && missingBuyins.length === 0
              ? "12 members and 12 buy-ins seeded"
              : `${members.length}/12 members; ${missingBuyins.length} missing buy-ins`,
        },
        {
          label: "Money",
          status: expected - settled === 0 ? "OK" : "RISK",
          detail:
            expected - settled === 0
              ? "Pool fully settled"
              : `${money(expected - settled)} outstanding`,
        },
        {
          label: "Rules",
          status: issues.length === 0 ? "OK" : "BLOCKER",
          detail:
            issues.length === 0
              ? "Scores ready"
              : `${issues.length} score${issues.length === 1 ? " needs" : "s need"} review`,
        },
        {
          label: "Handicaps",
          status: missingHandicaps.length === 0 ? "OK" : "RISK",
          detail:
            missingHandicaps.length === 0
              ? "All member indexes recorded with source evidence"
              : `${missingHandicaps.length} missing/unverified: ${missingHandicaps.join(", ")}`,
        },
        {
          label: "Closeout",
          status: activeTournament?.closedAt ? "RISK" : "OK",
          detail: activeTournament
            ? activeTournament.closedAt
              ? `${activeTournament.name} is closed`
              : `${activeTournament.name} protected until ${activeTournament.windowEnd}`
            : "No active tournament window",
        },
        {
          label: "Schedule",
          status: unconfirmedEvents.length === 0 ? "OK" : "RISK",
          detail:
            unconfirmedEvents.length === 0
              ? "All event details confirmed"
              : `${unconfirmedEvents.length} TBD: ${unconfirmedEvents.join(", ")}`,
        },
        {
          label: "Exports",
          status: "OK",
          detail:
            "JSON, summary, DB backup, backup verify, persistence verify, and prod smoke available",
        },
      ];
      const launchRisks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchCheckState(),
      });
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks: launchCheckState(),
      });
      const lines: string[] = [
        "DJDI Golf Board Season Summary",
        `Exported: ${new Date().toISOString()}`,
        `Rules version: ${ACTIVE_RULES_VERSION}`,
        "",
        "Commissioner Readiness",
        ...readinessItems.map(
          (item) => `${item.status} - ${item.label}: ${item.detail}`
        ),
        "",
        "League Checklist",
        ...(launchRisks.length === 0
          ? ["None"]
          : launchRisks.map(
              (risk) =>
                `${risk.severity.toUpperCase()} - ${risk.label}: ${risk.detail} | Action: ${risk.nextAction}`
            )),
        "",
        "Commissioner Tasks",
        ...(commissionerTasks.length === 0
          ? ["None"]
          : commissionerTasks.map(
              (task) =>
                `${task.severity.toUpperCase()} - ${task.title}: ${task.detail} | Next: ${task.nextAction}`
            )),
        "",
        "Roster",
        `${rosterNames().length} members: ${rosterNames().join(", ")}`,
        "",
        "Buy-ins",
        `Settled: ${money(settled)}`,
        `Expected: ${money(expected)}`,
        `Outstanding: ${money(expected - settled)}`,
        ...buyins.map(formatBuyinLine),
        "",
      ];

      if (activeTournament) {
        const board = computeTournamentLeaderboard(
          activeTournament as PublicTournament,
          teeTimes as PublicTeeTime[],
          getHandicap
        );
        const leader = board[0];
        const stillToScore = stillToScoreFor(board);
        lines.push(
          "Active Stop Snapshot",
          `${activeTournament.name} through ${activeTournament.windowEnd}`,
          leader
            ? `Leader: ${leader.name} net ${leader.bestNet ?? "-"}`
            : "Leader: no scores posted",
          `Scores posted: ${board.length}`,
          `Still to score: ${
            stillToScore.length > 0 ? stillToScore.join(", ") : "none on roster"
          }`
        );
        if (board.length > 0) {
          lines.push("Leaderboard");
          for (const row of board) {
            lines.push(
              `${row.position}. ${row.name}: ${row.bestGross} gross, ${row.bestNet ?? "-"} net`
            );
          }
        }
        lines.push("");
      }

      const standings = sortStandings(
        computeStandings(
          teeTimes as PublicTeeTime[],
          getHandicap,
          tournaments as PublicTournament[]
        ),
        "seasonPoints"
      );
      lines.push("Season Standings");
      lines.push(`Rules version: ${ACTIVE_RULES_VERSION}`);
      if (standings.length === 0) {
        lines.push("No scored regular rounds yet");
      } else {
        for (const row of standings) {
          lines.push(
            `${row.name}: ${row.seasonPoints} pts, ${row.rounds} round${
              row.rounds === 1 ? "" : "s"
            }, avg net ${row.avgNet == null ? "-" : row.avgNet.toFixed(1)}`
          );
        }
      }
      lines.push("", "Post-season Seeds");
      const seeded = standings
        .filter((row) => row.seasonPoints > 0)
        .slice(0, STROKE_ADVANTAGES.length);
      if (seeded.length === 0) {
        lines.push("No seeded players yet");
      } else {
        seeded.forEach((row, index) => {
          const advantage = STROKE_ADVANTAGES[index];
          lines.push(
            `${index + 1}. ${row.name}: ${row.seasonPoints} pts, ${advantage} stroke${
              Math.abs(advantage) === 1 ? "" : "s"
            }`
          );
        });
      }
      lines.push("");

      lines.push("Tournament Closeout");
      for (const tournament of tournaments) {
        const board = computeTournamentLeaderboard(
          tournament as PublicTournament,
          teeTimes as PublicTeeTime[],
          getHandicap
        );
        const winner = board[0];
        lines.push(
          `${tournament.name}: ${
            winner ? `${winner.name} net ${winner.bestNet ?? "-"}` : "no scores"
          }${tournament.closedAt ? ` (closed ${tournament.closedAt})` : ""}`
        );
      }
      lines.push("", "Score Review");
      if (issues.length === 0) lines.push("None");
      else {
        for (const issue of issues) {
          lines.push(
            `${issue.date} ${issue.time} ${issue.player}: ${issue.message} (${issue.tournamentName})`
          );
        }
      }
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-summary-${new Date().toISOString().slice(0, 10)}.txt"`
      );
      res.send(`${lines.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/summary.txt failed:", err);
      res.status(500).json({ error: "Failed to export summary" });
    }
  });

  app.get("/api/export/launch-packet.txt", requireCommissioner, (_req, res) => {
    try {
      const teeTimes = getAllTeeTimes();
      const players = getAllPlayers();
      const buyins = getAllBuyins();
      const tournaments = getAllTournaments();
      const getHandicap = getHandicapFromPlayers(players);
      const today = localTodayISO();
      const issues = auditLeagueRules(teeTimes, tournaments, players, today);
      const launchCheckEvidence = launchCheckRecords();
      const launchChecks = launchCheckState();
      const launchRisks = buildLaunchRisks({
        players,
        buyins,
        tournaments,
        ruleBlockerCount: issues.length,
        accessCodeRequired: !!getRequiredAccessCode(),
        ...launchChecks,
      });
      const commissionerTasks = buildCommissionerTasks({
        players,
        buyins,
        tournaments,
        ruleIssues: issues,
        accessCodeRequired: !!getRequiredAccessCode(),
        launchChecks,
      });
      const activeTournament =
        tournaments.find(
          (tournament) =>
            tournament.type !== "post" &&
            today >= tournament.windowStart &&
            today <= tournament.windowEnd
        ) ?? null;
      const activeBoard = activeTournament
        ? computeTournamentLeaderboard(
            activeTournament as PublicTournament,
            teeTimes as PublicTeeTime[],
            getHandicap
          )
        : [];
      const rosterNames = Array.from(
        new Map(
          [
            ...players
              .filter((player) => player.member)
              .map((player) => [normalizeName(player.name), player.name] as const),
            ...buyins.map(
              (buyin) => [normalizeName(buyin.playerName), buyin.playerName] as const
            ),
          ]
        ).values()
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      const scored = new Set(activeBoard.map((row) => normalizeName(row.name)));
      const stillToScore = rosterNames.filter(
        (name) => !scored.has(normalizeName(name))
      );
      const standings = sortStandings(
        computeStandings(
          teeTimes as PublicTeeTime[],
          getHandicap,
          tournaments as PublicTournament[]
        ),
        "seasonPoints"
      );
      const topSeeds = standings
        .filter((row) => row.seasonPoints > 0)
        .slice(0, STROKE_ADVANTAGES.length);
      const lines = [
        "DJDI Launch Packet",
        `Generated: ${new Date().toISOString()}`,
        `Rules version: ${ACTIVE_RULES_VERSION}`,
        "",
        "Commissioner Status",
        `Scores needing review: ${issues.length}`,
        `League checklist items: ${launchRisks.length}`,
        `Commissioner tasks: ${commissionerTasks.length}`,
        `Members: ${players.filter((player) => player.member).length}`,
        `Buy-ins outstanding: $${buyins
          .reduce((sum, buyin) => sum + (buyin.paid ? 0 : buyin.amount), 0)
          .toLocaleString("en-US")}`,
        "",
        "Copy/Paste Asks",
        "[Buy-in Status]",
        buildCollectionAsk(buyins),
        "",
        "[Handicap Records]",
        buildHandicapAsk(players),
        "",
        "[Schedule Details]",
        buildScheduleAsk(tournaments),
        "",
        "League Checklist",
        ...(launchRisks.length === 0
          ? ["None"]
          : launchRisks.map(
              (risk) =>
                `${risk.severity.toUpperCase()} - ${risk.label}: ${risk.detail} | Action: ${risk.nextAction}`
            )),
        "",
        "Commissioner Tasks",
        ...(commissionerTasks.length === 0
          ? ["None"]
          : commissionerTasks.map(
              (task) =>
                `${task.severity.toUpperCase()} - ${task.title}: ${task.detail} | Next: ${task.nextAction}`
            )),
        "",
        "Outbound Request Packet",
        buildCommissionerRequestPacket(commissionerTasks),
        "",
        "Launch Check Evidence",
        ...launchCheckEvidence.map(
          (check) =>
            `${check.verified ? "OK" : "OPEN"} - ${check.label}: ${
              check.verified
                ? `${check.source}${check.verifiedAt ? ` ${check.verifiedAt.slice(0, 10)}` : ""}`
                : `set ${check.envVar} or mark verified in Ops`
            }${check.note ? ` — ${check.note}` : ""}`
        ),
        "",
        "Source Search Coverage",
        `As of: ${SOURCE_SEARCH_AS_OF}`,
        ...SOURCE_SEARCH_LEDGER.map(
          (entry) =>
            `${entry.claimType.toUpperCase()} / ${entry.status} - ${entry.area}: ${entry.claim} | Decision: ${entry.decision}`
        ),
        "",
        "Live Stop Snapshot",
      ];

      if (activeTournament) {
        lines.push(
          `${activeTournament.name} through ${activeTournament.windowEnd}`,
          activeBoard[0]
            ? `Leader: ${activeBoard[0].name} net ${activeBoard[0].bestNet ?? "-"}`
            : "Leader: no scores posted",
          `Scores posted: ${activeBoard.length}`,
          `Still to score: ${
            stillToScore.length > 0 ? stillToScore.join(", ") : "none on roster"
          }`
        );
        if (activeBoard.length > 0) {
          lines.push(
            "",
            "Leaderboard",
            ...activeBoard.map(
              (row) =>
                `${row.position}. ${row.name}: ${row.bestGross} gross, ${row.bestNet ?? "-"} net`
            )
          );
        }
      } else {
        lines.push("No active tournament window.");
      }

      lines.push("", "Post-season Seed Snapshot");
      if (topSeeds.length === 0) {
        lines.push("No seeded players yet.");
      } else {
        topSeeds.forEach((row, index) => {
          const advantage = STROKE_ADVANTAGES[index];
          lines.push(
            `${index + 1}. ${row.name}: ${row.seasonPoints} pts, ${advantage} stroke${
              Math.abs(advantage) === 1 ? "" : "s"
            }`
          );
        });
      }

      lines.push("", "Closeout Readiness");
      for (const tournament of tournaments.filter(
        (candidate) => candidate.type !== "post"
      )) {
        const readiness = buildCloseoutReadiness({
          tournament: tournament as PublicTournament,
          tournaments: tournaments as PublicTournament[],
          teeTimes: teeTimes as PublicTeeTime[],
          players,
          today,
          getHandicap,
        });
        const leader = readiness.board[0];
        lines.push(
          `${tournament.name}: ${readiness.status} — ${readiness.detail}${
            leader ? `; leader ${leader.name} net ${leader.bestNet ?? "-"}` : ""
          } | packet /api/export/closeout/${encodeURIComponent(
            tournament.id
          )}.txt | ledger /api/export/closeout/${encodeURIComponent(
            tournament.id
          )}.json`
        );
      }

      lines.push(
        "",
        "Export Links",
        "/api/export/season.json",
        "/api/export/rules.json",
        "/api/export/buyins.csv",
        "/api/export/roster.csv",
        "/api/export/scores.csv",
        "/api/export/payouts.csv",
        "/api/export/readiness.json",
        "/api/export/tasks.json",
        "/api/export/tasks.csv",
        "/api/export/risks.json",
        "/api/export/risks.csv",
        "/api/export/request-packet.txt",
        "/api/export/blocker-handoff.json",
        "/api/export/blocker-handoff.txt",
        "/api/export/evidence-gap-packet.json",
        "/api/export/evidence-gap-packet.csv",
        "/api/export/evidence-gap-packet.txt",
        "/api/export/source-search-ledger.json",
        "/api/export/source-search-ledger.csv",
        "/api/export/completion-audit.json",
        "/api/export/completion-audit.csv",
        "/api/export/launch-checks.json",
        "/api/export/launch-checks.csv",
        "/api/export/launch-gate-checklist.json",
        "/api/export/launch-gate-checklist.csv",
        "/api/export/launch-gate-checklist.txt",
        "/api/export/audit.json",
        "/api/export/audit.csv",
        "/api/export/verification-runs.json",
        "/api/export/verification-runs.csv",
        "/api/export/archive.json",
        "/api/export/summary.txt",
        ...tournaments
          .filter((candidate) => candidate.type !== "post")
          .flatMap((tournament) => [
            `/api/export/closeout/${encodeURIComponent(tournament.id)}.txt`,
            `/api/export/closeout/${encodeURIComponent(tournament.id)}.json`,
          ]),
        "/api/export/database",
        "",
        "Verification Commands",
        "npm run verify:all",
        "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke"
      );

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="djdi-launch-packet-${new Date()
          .toISOString()
          .slice(0, 10)}.txt"`
      );
      res.send(`${lines.join("\n")}\n`);
    } catch (err) {
      console.error("GET /api/export/launch-packet.txt failed:", err);
      res.status(500).json({ error: "Failed to export launch packet" });
    }
  });

  app.get("/api/export/database", requireCommissioner, async (_req, res) => {
    const file = path.join(
      os.tmpdir(),
      `djdi-golf-board-${Date.now()}-${randomUUID()}.db`
    );
    try {
      await db.backup(file);
      res.download(
        file,
        `djdi-golf-board-${new Date().toISOString().slice(0, 10)}.db`,
        () => {
          fs.rm(file, { force: true }, () => {});
        }
      );
    } catch (err) {
      fs.rm(file, { force: true }, () => {});
      console.error("GET /api/export/database failed:", err);
      res.status(500).json({ error: "Failed to export database" });
    }
  });

  app.post("/api/backups/verify", requireCommissioner, async (req, res) => {
    try {
      const proof = await verifySqliteBackup(db);
      recordAuditEvent({
        action: "backup_restore_verify",
        actor: auditActor(req.body?.actor, "Commissioner"),
        subjectType: "database",
        subjectId: "sqlite-backup",
        summary: "Verified SQLite backup restore proof",
        metadata: proof,
      });
      res.json(proof);
    } catch (err) {
      console.error("POST /api/backups/verify failed:", err);
      res.status(500).json({ error: "Failed to verify backup" });
    }
  });

  app.patch("/api/buyins/:name", requireCommissioner, (req, res) => {
    try {
      const name = trimStr(
        decodeURIComponent(req.params.name),
        NAME_MAX,
        "Name"
      );
      const existing = stmtSelectBuyin.get(name) as BuyinRow | undefined;
      if (!existing) throw new NotFoundError("No buy-in for that player");
      let amount = existing.amount;
      if ("amount" in (req.body ?? {})) {
        const a = Number(req.body.amount);
        if (!Number.isInteger(a) || a < 0 || a > 100000) {
          throw new ValidationError(
            "Amount must be a whole dollar amount between 0 and 100000"
          );
        }
        amount = a;
      }
      let notes: string | null = existing.notes;
      if ("notes" in (req.body ?? {})) {
        notes = validateOptionalNotes(req.body.notes);
      }
      let paymentStatus = normalizePaymentStatus(existing);
      if ("paymentStatus" in (req.body ?? {})) {
        paymentStatus = validatePaymentStatus(req.body.paymentStatus);
      } else if ("paid" in (req.body ?? {})) {
        paymentStatus = req.body.paid ? "paid" : "unpaid";
      }
      let paymentMethod: string | null = existing.payment_method ?? null;
      if ("paymentMethod" in (req.body ?? {})) {
        paymentMethod = validateOptionalShortText(
          req.body.paymentMethod,
          40,
          "Payment method"
        );
      } else if (paymentStatus === "paid" || paymentStatus === "comped") {
        paymentMethod = paymentMethod ?? inferPaymentMethod(notes);
      } else if (paymentStatus === "unpaid") {
        paymentMethod = null;
      }
      let paymentActor: string | null = existing.payment_actor ?? null;
      if ("paymentActor" in (req.body ?? {})) {
        paymentActor = validateOptionalShortText(
          req.body.paymentActor,
          NAME_MAX,
          "Payment actor"
        );
      } else if (paymentStatus === "paid" || paymentStatus === "comped") {
        paymentActor = paymentActor ?? "Commissioner";
      } else if (paymentStatus === "unpaid") {
        paymentActor = null;
      }
      const paid = paidFromStatus(paymentStatus) ? 1 : 0;
      const wasPaid = paidFromStatus(normalizePaymentStatus(existing));
      const paidAt = paid
        ? "paidAt" in (req.body ?? {})
          ? validateDate(req.body.paidAt, "Payment date")
          : existing.paid_at && wasPaid
          ? existing.paid_at
          : null
        : null;
      requireSettledPaymentEvidence(
        paymentStatus,
        paymentMethod,
        paymentActor,
        notes,
        paidAt
      );
      stmtUpdateBuyin.run(
        amount,
        paid,
        paymentStatus,
        paymentMethod,
        paymentActor,
        paidAt,
        notes,
        new Date().toISOString(),
        existing.player_name
      );
      const updated = stmtSelectBuyin.get(existing.player_name) as BuyinRow;
      recordAuditEvent({
        action: "buyin_update",
        actor: paymentActor ?? auditActor(req.body?.actor, "Commissioner"),
        subjectType: "buyin",
        subjectId: existing.player_name,
        summary: `Updated buy-in for ${existing.player_name}`,
        before: rowToBuyin(existing),
        after: rowToBuyin(updated),
      });
      res.json({ buyin: rowToBuyin(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PATCH /api/buyins/:name failed:", err);
      res.status(500).json({ error: "Failed to update buy-in" });
    }
  });

  app.delete("/api/polls/:id", (req, res) => {
    try {
      const id = req.params.id;
      const row = stmtSelectPollById.get(id) as PollRow | undefined;
      if (!row) return res.status(404).json({ error: "Poll not found" });
      assertCanManagePoll(req, row);
      const result = stmtDeletePoll.run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Poll not found" });
      }
      recordAuditEvent({
        action: "poll_delete",
        actor: row?.host ?? "Commissioner",
        subjectType: "poll",
        subjectId: id,
        summary: `Deleted poll${row ? `: ${row.prompt}` : ""}`,
        before: row ? rowToPoll(row) : null,
      });
      res.json({ ok: true });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/polls/:id failed:", err);
      res.status(500).json({ error: "Failed to delete poll" });
    }
  });

  app.delete("/api/teetimes/:id", (req, res) => {
    try {
      const id = req.params.id;
      const row = stmtSelectById.get(id) as TeeTimeRow | undefined;
      if (!row) return res.status(404).json({ error: "Tee time not found" });
      assertCanManageTeeTime(req, row);
      assertTournamentOpenForTeeTime(row);
      const result = stmtDelete.run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Tee time not found" });
      }
      recordAuditEvent({
        action: "tee_time_delete",
        actor: row.host,
        subjectType: "tee_time",
        subjectId: id,
        summary: `Deleted tee time at ${row.course}`,
        before: rowToTeeTime(row),
      });
      res.json({ ok: true });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id failed:", err);
      res.status(500).json({ error: "Failed to delete tee time" });
    }
  });

  if (serveAssets) {
    if (appBasePath) {
      app.use(appBasePath, express.static(staticDir));
      app.get(`${appBasePath}/*`, (_req, res) => {
        res.sendFile("index.html", { root: staticDir });
      });
    }
    app.use(express.static(staticDir));
    app.get("*", (_req, res) => {
      res.sendFile("index.html", { root: staticDir });
    });
  }

  return app;
}

// ============================================================
// SERVER
// ============================================================
export async function startServer() {
  const db = createDb();
  const app = createApp(db, {
    serveAssets: process.env.NODE_ENV === "production",
  });
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;
  // Bind to loopback by default. Expose externally (LAN, Tailscale) by
  // setting HOST=0.0.0.0 — or better, leave this as 127.0.0.1 and put a
  // reverse proxy in front (Tailscale serve, nginx, Cloudflare Tunnel...)
  // so the app never has to be reachable directly from the open network.
  const HOST = process.env.HOST || "127.0.0.1";

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
