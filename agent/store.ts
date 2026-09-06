// ============================================================
// Text-the-Board agent — SQLite-backed state.
//
// Owns the allowlist (agent_members), the YES/NO pending queue
// (agent_pending, at most one row per sender), and the audit log
// (agent_log). All methods are synchronous better-sqlite3 calls.
// Timestamps are ISO-8601 UTC strings, which compare correctly
// as plain text.
// ============================================================

import Database from "better-sqlite3";
import type { Member, PendingAction } from "./types";

/** One audit-log write. Everything except `outcome` is optional. */
export type LogEntry = {
  /** ISO-8601 UTC; defaults to now. */
  at?: string;
  channel?: string | null;
  handle?: string | null;
  playerName?: string | null;
  rawMessage?: string | null;
  parsedJson?: string | null;
  outcome?: string | null;
};

/** A row read back from agent_log. */
export type LogRow = {
  id: number;
  at: string;
  channel: string | null;
  handle: string | null;
  playerName: string | null;
  rawMessage: string | null;
  parsedJson: string | null;
  outcome: string | null;
};

export type AgentStore = {
  /** Handle is matched case-insensitively and trimmed. Inactive members are returned too. */
  findMember(channel: string, handle: string): Member | null;
  upsertMember(member: Member): void;
  listMembers(): Member[];
  /** Replaces any existing pending for that (channel, handle) — at most ONE per sender. */
  savePending(p: PendingAction): void;
  /**
   * Atomically consumes and returns the sender's pending action.
   * Expired rows are deleted and null is returned. `now` is injectable for tests.
   */
  takeLatestPending(
    channel: string,
    handle: string,
    now?: Date,
    mode?: "confirm" | "undo",
  ): PendingAction | null;
  logAction(entry: LogEntry): void;
  /** Audit-log readback (oldest first). */
  listLog(): LogRow[];
  close(): void;
};

/** Shared sender-key normalization: trim + lowercase. */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

type MemberRow = { channel: string; handle: string; player_name: string; active: number };
type PendingRow = {
  id: string;
  channel: string;
  handle: string;
  mode: "confirm" | "undo";
  action_json: string;
  created_at: string;
  expires_at: string;
};

function toMember(row: MemberRow): Member {
  return {
    channel: row.channel,
    handle: row.handle,
    playerName: row.player_name,
    active: row.active !== 0,
  };
}

function toPending(row: PendingRow): PendingAction {
  return {
    id: row.id,
    channel: row.channel,
    handle: row.handle,
    mode: row.mode,
    actionJson: row.action_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createStore(dbPath: string): AgentStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_members (
      channel     TEXT NOT NULL,
      handle      TEXT NOT NULL,
      player_name TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (channel, handle)
    );
    CREATE TABLE IF NOT EXISTS agent_pending (
      id          TEXT PRIMARY KEY,
      channel     TEXT,
      handle      TEXT,
      mode        TEXT CHECK(mode IN ('confirm','undo')),
      action_json TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          TEXT NOT NULL,
      channel     TEXT,
      handle      TEXT,
      player_name TEXT,
      raw_message TEXT,
      parsed_json TEXT,
      outcome     TEXT
    );
  `);

  const findMemberStmt = db.prepare(
    `SELECT channel, handle, player_name, active
       FROM agent_members
      WHERE channel = ? AND lower(trim(handle)) = ?`,
  );
  const upsertMemberStmt = db.prepare(
    `INSERT INTO agent_members (channel, handle, player_name, active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(channel, handle)
     DO UPDATE SET player_name = excluded.player_name, active = excluded.active`,
  );
  const listMembersStmt = db.prepare(
    `SELECT channel, handle, player_name, active FROM agent_members ORDER BY channel, handle`,
  );
  const deletePendingForSenderStmt = db.prepare(
    `DELETE FROM agent_pending WHERE channel = ? AND lower(trim(handle)) = ?`,
  );
  const insertPendingStmt = db.prepare(
    `INSERT INTO agent_pending (id, channel, handle, mode, action_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const latestPendingStmt = db.prepare(
    `SELECT id, channel, handle, mode, action_json, created_at, expires_at
       FROM agent_pending
      WHERE channel = ? AND lower(trim(handle)) = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
  );
  const deletePendingByIdStmt = db.prepare(`DELETE FROM agent_pending WHERE id = ?`);
  const insertLogStmt = db.prepare(
    `INSERT INTO agent_log (at, channel, handle, player_name, raw_message, parsed_json, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const listLogStmt = db.prepare(
    `SELECT id, at, channel, handle, player_name, raw_message, parsed_json, outcome
       FROM agent_log ORDER BY id`,
  );

  const savePendingTx = db.transaction((p: PendingAction) => {
    deletePendingForSenderStmt.run(p.channel, normalizeHandle(p.handle));
    insertPendingStmt.run(p.id, p.channel, p.handle, p.mode, p.actionJson, p.createdAt, p.expiresAt);
  });

  const takeLatestPendingTx = db.transaction(
    (channel: string, handle: string, nowIso: string, mode?: "confirm" | "undo"): PendingAction | null => {
      const row = latestPendingStmt.get(channel, normalizeHandle(handle)) as PendingRow | undefined;
      if (!row) return null;
      // A mode filter must not consume a pending of the other mode — a "yes"
      // texted after an auto-commit would otherwise silently destroy the
      // sender's undo window while replying "nothing is waiting on a yes".
      if (mode && row.mode !== mode) {
        if (row.expires_at <= nowIso) deletePendingByIdStmt.run(row.id);
        return null;
      }
      deletePendingByIdStmt.run(row.id);
      if (row.expires_at <= nowIso) return null;
      return toPending(row);
    },
  );

  return {
    findMember(channel: string, handle: string): Member | null {
      const row = findMemberStmt.get(channel, normalizeHandle(handle)) as MemberRow | undefined;
      return row ? toMember(row) : null;
    },

    upsertMember(member: Member): void {
      upsertMemberStmt.run(member.channel, member.handle, member.playerName, member.active ? 1 : 0);
    },

    listMembers(): Member[] {
      return (listMembersStmt.all() as MemberRow[]).map(toMember);
    },

    savePending(p: PendingAction): void {
      savePendingTx(p);
    },

    takeLatestPending(
      channel: string,
      handle: string,
      now?: Date,
      mode?: "confirm" | "undo",
    ): PendingAction | null {
      const nowIso = (now ?? new Date()).toISOString();
      return takeLatestPendingTx(channel, handle, nowIso, mode);
    },

    logAction(entry: LogEntry): void {
      insertLogStmt.run(
        entry.at ?? new Date().toISOString(),
        entry.channel ?? null,
        entry.handle ?? null,
        entry.playerName ?? null,
        entry.rawMessage ?? null,
        entry.parsedJson ?? null,
        entry.outcome ?? null,
      );
    },

    listLog(): LogRow[] {
      const rows = listLogStmt.all() as Array<{
        id: number;
        at: string;
        channel: string | null;
        handle: string | null;
        player_name: string | null;
        raw_message: string | null;
        parsed_json: string | null;
        outcome: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        at: r.at,
        channel: r.channel,
        handle: r.handle,
        playerName: r.player_name,
        rawMessage: r.raw_message,
        parsedJson: r.parsed_json,
        outcome: r.outcome,
      }));
    },

    close(): void {
      db.close();
    },
  };
}
