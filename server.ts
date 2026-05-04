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
`);

type TeeTimeRow = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes: string | null;
  claims: string;
  created_at: string;
};

type Claim = { name: string; claimedAt: string };

const rowToTeeTime = (row: TeeTimeRow) => ({
  id: row.id,
  course: row.course,
  date: row.date,
  time: row.time,
  spots: row.spots,
  host: row.host,
  notes: row.notes,
  claims: JSON.parse(row.claims) as Claim[],
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
const stmtUpdateFields = db.prepare(
  `UPDATE tee_times
   SET course = ?, date = ?, time = ?, spots = ?, host = ?, notes = ?
   WHERE id = ?
   RETURNING *`
);
const stmtDelete = db.prepare(`DELETE FROM tee_times WHERE id = ?`);

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

// ============================================================
// TRANSACTIONS
// ============================================================
const claimTx = db.transaction(
  (teeId: string, claimerName: string, claimedAt: string): TeeTimeRow => {
    const row = stmtSelectById.get(teeId) as TeeTimeRow | undefined;
    if (!row) throw new NotFoundError("Tee time not found");
    const claims = JSON.parse(row.claims) as Claim[];
    if (claims.length >= row.spots) throw new ConflictError("That tee time is full");
    const lower = claimerName.toLowerCase();
    if (claims.some((c) => c.name.toLowerCase() === lower)) {
      throw new ConflictError("That name already has a spot");
    }
    claims.push({ name: claimerName, claimedAt });
    return stmtUpdateClaims.get(JSON.stringify(claims), teeId) as TeeTimeRow;
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
