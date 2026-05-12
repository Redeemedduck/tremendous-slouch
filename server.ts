import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// ============================================================
// DATABASE
// ============================================================
const DB_PATH = process.env.DB_PATH ?? "golf_coordinator.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tee_times (
    id         TEXT PRIMARY KEY,
    course     TEXT NOT NULL,
    date       TEXT NOT NULL,            -- YYYY-MM-DD (naive local date)
    time       TEXT NOT NULL,            -- HH:MM 24h (naive local time)
    spots      INTEGER NOT NULL,
    host       TEXT NOT NULL,
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
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_polls_created ON polls(created_at);

  CREATE TABLE IF NOT EXISTS players (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    handicap   REAL,
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
    paid_at     TEXT,
    notes       TEXT,
    updated_at  TEXT NOT NULL
  );
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
const playerColumns = db
  .prepare("PRAGMA table_info(players)")
  .all() as { name: string }[];
if (!playerColumns.some((c) => c.name === "member")) {
  db.exec(
    "ALTER TABLE players ADD COLUMN member INTEGER NOT NULL DEFAULT 0"
  );
}

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
const REGULAR_PAYOUT = 334; // from rule sheet @ $325 buy-in × 12 members
const POST_PAYOUTS = { first: 1014, second: 390, third: 156 };
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

// Pre-seed two foursome tee times for Sat 5/16 at Common Ground (Stop 1).
const stmtSeedTeeTime = db.prepare(`
  INSERT OR IGNORE INTO tee_times
  (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?)
`);
const SEED_HOST = "Jason"; // organizer per the SMS thread
const SEED_HOST_CLAIM = JSON.stringify([
  { name: SEED_HOST, claimedAt: NOW_ISO },
]);
stmtSeedTeeTime.run(
  "seed-2026-w1-1240",
  "Common Ground",
  "2026-05-16",
  "12:40",
  4,
  SEED_HOST,
  "Stop 1 — first foursome",
  SEED_HOST_CLAIM,
  NOW_ISO
);
stmtSeedTeeTime.run(
  "seed-2026-w1-1250",
  "Common Ground",
  "2026-05-16",
  "12:50",
  4,
  SEED_HOST,
  "Stop 1 — second foursome (back-to-back with 12:40)",
  SEED_HOST_CLAIM,
  NOW_ISO
);

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

type Claim = { name: string; claimedAt: string };
type Interest = { name: string; interestedAt: string };
type Score = {
  name: string;
  gross: number;
  courseHcp?: number | null;
  attestedBy?: string | null;
  recordedAt: string;
};
type Comment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
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
  created_at: string;
};

type PollResponse = { name: string; optionIdx: number; respondedAt: string };

const rowToPoll = (row: PollRow) => ({
  id: row.id,
  prompt: row.prompt,
  options: JSON.parse(row.options) as string[],
  responses: JSON.parse(row.responses) as PollResponse[],
  host: row.host,
  createdAt: row.created_at,
});

// ============================================================
// PREPARED STATEMENTS (hoisted to module scope so SQLite parses each only once)
// ============================================================
const stmtSelectAll = db.prepare(
  `SELECT * FROM tee_times ORDER BY date ASC, time ASC`
);
const stmtSelectById = db.prepare(`SELECT * FROM tee_times WHERE id = ?`);
const stmtInsert = db.prepare(`
  INSERT INTO tee_times (id, course, date, time, spots, host, notes, claims, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
   SET course = ?, date = ?, time = ?, spots = ?, host = ?, notes = ?
   WHERE id = ?
   RETURNING *`
);
const stmtDelete = db.prepare(`DELETE FROM tee_times WHERE id = ?`);

const stmtSelectAllPolls = db.prepare(
  `SELECT * FROM polls ORDER BY created_at DESC`
);
const stmtSelectPollById = db.prepare(`SELECT * FROM polls WHERE id = ?`);
const stmtInsertPoll = db.prepare(`
  INSERT INTO polls (id, prompt, options, responses, host, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING *
`);
const stmtUpdatePollResponses = db.prepare(
  `UPDATE polls SET responses = ? WHERE id = ? RETURNING *`
);
const stmtDeletePoll = db.prepare(`DELETE FROM polls WHERE id = ?`);

type PlayerRow = {
  name: string;
  handicap: number | null;
  member: number;
  updated_at: string;
};

const rowToPlayer = (row: PlayerRow) => ({
  name: row.name,
  handicap: row.handicap,
  member: !!row.member,
  updatedAt: row.updated_at,
});

const stmtSelectAllPlayers = db.prepare(
  `SELECT * FROM players ORDER BY name COLLATE NOCASE ASC`
);
const stmtSelectPlayerByName = db.prepare(
  `SELECT * FROM players WHERE name = ? COLLATE NOCASE`
);

const LEAGUE_DEFAULT_BUYIN = 325;

type BuyinRow = {
  player_name: string;
  amount: number;
  paid: number;
  paid_at: string | null;
  notes: string | null;
  updated_at: string;
};

const rowToBuyin = (row: BuyinRow) => ({
  playerName: row.player_name,
  amount: row.amount,
  paid: !!row.paid,
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
  INSERT OR IGNORE INTO league_buyins (player_name, amount, paid, paid_at, notes, updated_at)
  VALUES (?, ?, 0, NULL, NULL, ?)
`);
const stmtUpdateBuyin = db.prepare(`
  UPDATE league_buyins
  SET amount = ?, paid = ?, paid_at = ?, notes = ?, updated_at = ?
  WHERE player_name = ? COLLATE NOCASE
`);
const stmtDeleteBuyin = db.prepare(
  `DELETE FROM league_buyins WHERE player_name = ? COLLATE NOCASE`
);
const stmtUpsertPlayer = db.prepare(`
  INSERT INTO players (name, handicap, member, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    handicap = excluded.handicap,
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
});

const stmtSelectAllTournaments = db.prepare(
  `SELECT * FROM tournaments ORDER BY window_start ASC, type ASC`
);

// ============================================================
// ACCESS GATE
// ============================================================
// Optional shared access code stored in env. When set, all /api/* routes
// (except /api/access itself) require a matching `golf_access` cookie. When
// unset, the gate is disabled — convenient for local dev.
const COOKIE_NAME = "golf_access";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

const getRequiredAccessCode = (): string | undefined => {
  const code = process.env.ACCESS_CODE?.trim();
  return code && code.length > 0 ? code : undefined;
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

const setAccessCookie = (res: express.Response, code: string) => {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(code)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${isProd ? "; Secure" : ""}`
  );
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

const trimStr = (v: unknown, max: number, label: string) => {
  if (typeof v !== "string") throw new ValidationError(`${label} is required`);
  const trimmed = v.trim();
  if (!trimmed) throw new ValidationError(`${label} is required`);
  if (trimmed.length > max) throw new ValidationError(`${label} is too long`);
  return trimmed;
};

const validateNewTeeTime = (body: any) => {
  const course = trimStr(body?.course, COURSE_MAX, "Course");
  const host = trimStr(body?.host, NAME_MAX, "Host name");
  const date = String(body?.date ?? "");
  if (!DATE_RE.test(date)) throw new ValidationError("Date must be YYYY-MM-DD");
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
const claimTx = db.transaction(
  (teeId: string, claimerName: string, claimedAt: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
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
    claims.push({ name: claimerName, claimedAt });
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
    const claims = JSON.parse(row.claims) as Claim[];
    const lower = claimerName.toLowerCase();
    const idx = claims.findIndex((c) => c.name.toLowerCase() === lower);
    if (idx === -1) throw new NotFoundError("No claim by that name");
    claims.splice(idx, 1);
    return stmtUpdateClaims.get(JSON.stringify(claims), teeId) as TeeTimeRow;
  }
);

const interestTx = db.transaction(
  (teeId: string, claimerName: string, interestedAt: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const claims = JSON.parse(row.claims) as Claim[];
    const interested = JSON.parse(row.interested) as Interest[];
    const lower = claimerName.toLowerCase();
    if (interested.some((i) => i.name.toLowerCase() === lower)) {
      throw new ConflictError("That name is already marked maybe");
    }
    // If the person was claimed, move them to interested.
    const remainingClaims = claims.filter(
      (c) => c.name.toLowerCase() !== lower
    );
    interested.push({ name: claimerName, interestedAt });
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
    attestedBy: string | null
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const claims = JSON.parse(row.claims) as Claim[];
    const lowerScorer = name.toLowerCase();

    // Is this tee time inside a non-post tournament window?
    const inTournament = stmtSelectMatchingTournaments.get(row.date) as
      | TournamentRow
      | undefined;
    if (inTournament) {
      if (!attestedBy) {
        throw new ValidationError(
          "League rounds need an attester (another member who played in your group)"
        );
      }
      const lowerAttester = attestedBy.toLowerCase();
      if (lowerAttester === lowerScorer) {
        throw new ValidationError("Attester can't be the scorer themselves");
      }
      const attesterOnTeeTime = claims.some(
        (c) => c.name.toLowerCase() === lowerAttester
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
      courseHcp,
      attestedBy: attestedBy ?? null,
      recordedAt: new Date().toISOString(),
    };
    if (idx === -1) scores.push(entry);
    else scores[idx] = entry;
    return stmtUpdateScores.get(JSON.stringify(scores), teeId) as TeeTimeRow;
  }
);

// Append a free-text comment. Honor-system: anyone can post. Author is
// trusted from the request (the client passes their localStorage name).
const addCommentTx = db.transaction(
  (
    teeId: string,
    author: string,
    body: string,
    commentId: string,
    createdAt: string
  ): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const comments = JSON.parse(row.comments) as Comment[];
    comments.push({ id: commentId, author, body, createdAt });
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

// Remove a score entry (host wants to undo / fix a mistake).
const removeScoreTx = db.transaction(
  (teeId: string, name: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const scores = JSON.parse(row.scores) as Score[];
    const lower = name.toLowerCase();
    const idx = scores.findIndex((s) => s.name.toLowerCase() === lower);
    if (idx === -1) throw new NotFoundError("No score by that name");
    scores.splice(idx, 1);
    return stmtUpdateScores.get(JSON.stringify(scores), teeId) as TeeTimeRow;
  }
);

// Toggle a poll response: if (name, optionIdx) is already present, remove it;
// otherwise append. Allows multi-select per voter without dedicated PUT/DELETE
// endpoints.
const togglePollResponseTx = db.transaction(
  (pollId: string, name: string, optionIdx: number): PollRow => {
    const row = stmtSelectPollById.get(pollId) as PollRow | undefined;
    if (!row) throw new NotFoundError("Poll not found");
    const options = JSON.parse(row.options) as string[];
    if (optionIdx < 0 || optionIdx >= options.length) {
      throw new ValidationError("Invalid option");
    }
    const responses = JSON.parse(row.responses) as PollResponse[];
    const lower = name.toLowerCase();
    const existingIdx = responses.findIndex(
      (r) => r.name.toLowerCase() === lower && r.optionIdx === optionIdx
    );
    if (existingIdx !== -1) {
      responses.splice(existingIdx, 1);
    } else {
      responses.push({
        name,
        optionIdx,
        respondedAt: new Date().toISOString(),
      });
    }
    return stmtUpdatePollResponses.get(
      JSON.stringify(responses),
      pollId
    ) as PollRow;
  }
);

// ============================================================
// SERVER
// ============================================================
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  // Bind to loopback by default. Expose externally (LAN, Tailscale) by
  // setting HOST=0.0.0.0 — or better, leave this as 127.0.0.1 and put a
  // reverse proxy in front (Tailscale serve, nginx, Cloudflare Tunnel...)
  // so the app never has to be reachable directly from the open network.
  const HOST = process.env.HOST || "127.0.0.1";

  app.use(express.json());
  app.use(requireAccess);

  app.get("/api/access", (req, res) => {
    const required = getRequiredAccessCode();
    if (!required) return res.json({ required: false, ok: true });
    const cookie = parseCookie(req.headers.cookie, COOKIE_NAME);
    res.json({ required: true, ok: !!cookie && cookie === required });
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
    setAccessCookie(res, code);
    res.json({ ok: true });
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
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const claims: Claim[] = [{ name: v.host, claimedAt: createdAt }];
      const row = stmtInsert.get(
        id,
        v.course,
        v.date,
        v.time,
        v.spots,
        v.host,
        v.notes,
        JSON.stringify(claims),
        createdAt
      ) as TeeTimeRow;
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
      const claimedAt = new Date().toISOString();
      const updated = claimTx.immediate(id, name, claimedAt);
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
      const interestedAt = new Date().toISOString();
      const updated = interestTx.immediate(id, name, interestedAt);
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
      const updated = recordScoreTx.immediate(
        id,
        name,
        gross,
        courseHcp,
        attestedBy
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/scores failed:", err);
      res.status(500).json({ error: "Failed to record score" });
    }
  });

  app.delete("/api/teetimes/:id/scores/:name", (req, res) => {
    try {
      const id = req.params.id;
      const name = decodeURIComponent(req.params.name).trim();
      if (!name) throw new ValidationError("Name is required");
      const updated = removeScoreTx.immediate(id, name);
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("DELETE /api/teetimes/:id/scores/:name failed:", err);
      res.status(500).json({ error: "Failed to remove score" });
    }
  });

  app.post("/api/teetimes/:id/comments", (req, res) => {
    try {
      const id = req.params.id;
      const author = trimStr(req.body?.author, NAME_MAX, "Author");
      const body = trimStr(req.body?.body, COMMENT_MAX, "Comment");
      const commentId = randomUUID();
      const createdAt = new Date().toISOString();
      const updated = addCommentTx.immediate(
        id,
        author,
        body,
        commentId,
        createdAt
      );
      res.json({ teeTime: rowToTeeTime(updated) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("POST /api/teetimes/:id/comments failed:", err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.delete("/api/teetimes/:id/comments/:commentId", (req, res) => {
    try {
      const id = req.params.id;
      const commentId = req.params.commentId;
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
      const tx = db.transaction((teeId: string): TeeTimeRow => {
        const existing = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
        if (!existing) throw new NotFoundError("Tee time not found");
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
          v.notes,
          teeId
        ) as TeeTimeRow;
      });
      const updated = tx.immediate(id);
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
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const row = stmtInsertPoll.get(
        id,
        v.prompt,
        JSON.stringify(v.options),
        "[]",
        v.host,
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
      const name = trimStr(req.body?.name, NAME_MAX, "Name");
      const optionIdx = Number(req.body?.optionIdx);
      if (!Number.isInteger(optionIdx)) {
        throw new ValidationError("optionIdx must be an integer");
      }
      const updated = togglePollResponseTx.immediate(id, name, optionIdx);
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

  app.get("/api/players", (_req, res) => {
    try {
      const rows = stmtSelectAllPlayers.all() as PlayerRow[];
      res.json({ players: rows.map(rowToPlayer) });
    } catch (err) {
      console.error("GET /api/players failed:", err);
      res.status(500).json({ error: "Failed to load players" });
    }
  });

  app.put("/api/players/:name", (req, res) => {
    try {
      const name = trimStr(decodeURIComponent(req.params.name), NAME_MAX, "Name");
      // Merge with existing row so the caller can update one field at a time
      // without clobbering the other.
      const existing = stmtSelectPlayerByName.get(name) as PlayerRow | undefined;
      let handicap: number | null = existing?.handicap ?? null;
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
      const wasMember = existing?.member === 1;
      let member: number = existing?.member ?? 0;
      if ("member" in (req.body ?? {})) {
        member = req.body.member ? 1 : 0;
      }
      const row = stmtUpsertPlayer.get(
        name,
        handicap,
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
      res.json({ player: rowToPlayer(row) });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      console.error("PUT /api/players/:name failed:", err);
      res.status(500).json({ error: "Failed to save player" });
    }
  });

  app.get("/api/buyins", (_req, res) => {
    try {
      const rows = stmtSelectAllBuyins.all() as BuyinRow[];
      res.json({ buyins: rows.map(rowToBuyin) });
    } catch (err) {
      console.error("GET /api/buyins failed:", err);
      res.status(500).json({ error: "Failed to load buy-ins" });
    }
  });

  app.patch("/api/buyins/:name", (req, res) => {
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
      let paid = existing.paid;
      let paidAt = existing.paid_at;
      if ("paid" in (req.body ?? {})) {
        paid = req.body.paid ? 1 : 0;
        paidAt = paid ? new Date().toISOString() : null;
      }
      let notes: string | null = existing.notes;
      if ("notes" in (req.body ?? {})) {
        const raw = req.body.notes;
        if (raw == null || raw === "") notes = null;
        else {
          const trimmed = String(raw).trim();
          if (trimmed.length > NOTES_MAX) {
            throw new ValidationError("Notes are too long");
          }
          notes = trimmed || null;
        }
      }
      stmtUpdateBuyin.run(
        amount,
        paid,
        paidAt,
        notes,
        new Date().toISOString(),
        existing.player_name
      );
      const updated = stmtSelectBuyin.get(existing.player_name) as BuyinRow;
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
      const result = stmtDeletePoll.run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Poll not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/polls/:id failed:", err);
      res.status(500).json({ error: "Failed to delete poll" });
    }
  });

  app.delete("/api/teetimes/:id", (req, res) => {
    try {
      const id = req.params.id;
      const result = stmtDelete.run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Tee time not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/teetimes/:id failed:", err);
      res.status(500).json({ error: "Failed to delete tee time" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (_req, res) => {
      res.sendFile("index.html", { root: "dist" });
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
