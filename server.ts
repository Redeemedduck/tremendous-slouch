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
  created_at: string;
};

type Claim = { name: string; claimedAt: string };
type Interest = { name: string; interestedAt: string };

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
  const PORT = 3000;

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
