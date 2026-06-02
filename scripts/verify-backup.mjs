import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve(process.env.DB_PATH ?? "golf_coordinator.db");
const keepBackup = process.env.KEEP_BACKUP_VERIFY === "1";
const workDir = path.resolve(process.env.DJDI_WORK_DIR ?? ".build-work", "verify");
const backupPath =
  process.env.BACKUP_VERIFY_PATH ??
  path.join(workDir, `djdi-backup-verify-${process.pid}-${Date.now()}.db`);

const requiredTables = [
  "players",
  "tee_times",
  "tournaments",
  "league_buyins",
  "polls",
  "launch_checks",
  "audit_events",
  "verification_runs",
];

function fail(message) {
  console.error(`Backup verification failed: ${message}`);
  process.exitCode = 1;
}

function quickCheck(db, label) {
  const rows = db.prepare("PRAGMA quick_check").all();
  const result = rows
    .map((row) => Object.values(row)[0])
    .filter(Boolean)
    .join("; ");
  if (result !== "ok") {
    throw new Error(`${label} quick_check returned ${result || "no result"}`);
  }
  return result;
}

function ensureBackupSchema(db) {
  db.exec(`
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
}

let source;
let backup;

try {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source database does not exist at ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  source = new Database(sourcePath, { fileMustExist: true });
  source.pragma("busy_timeout = 5000");
  ensureBackupSchema(source);

  const sourceQuickCheck = quickCheck(source, "source");
  await source.backup(backupPath);

  const backupStats = fs.statSync(backupPath);
  if (backupStats.size <= 0) {
    throw new Error("backup file is empty");
  }

  backup = new Database(backupPath, {
    readonly: true,
    fileMustExist: true,
  });
  const backupQuickCheck = quickCheck(backup, "backup");

  const tables = backup
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => String(row.name));
  const missingTables = requiredTables.filter((table) => !tables.includes(table));
  if (missingTables.length > 0) {
    throw new Error(`missing tables in restored backup: ${missingTables.join(", ")}`);
  }

  const counts = {
    members: backup
      .prepare("SELECT COUNT(*) AS count FROM players WHERE member = 1")
      .get().count,
    buyins: backup.prepare("SELECT COUNT(*) AS count FROM league_buyins").get()
      .count,
    tournaments: backup.prepare("SELECT COUNT(*) AS count FROM tournaments").get()
      .count,
    teeTimes: backup.prepare("SELECT COUNT(*) AS count FROM tee_times").get()
      .count,
    launchChecks: backup.prepare("SELECT COUNT(*) AS count FROM launch_checks").get()
      .count,
    auditEvents: backup.prepare("SELECT COUNT(*) AS count FROM audit_events").get()
      .count,
    verificationRuns: backup
      .prepare("SELECT COUNT(*) AS count FROM verification_runs")
      .get().count,
  };

  const countExpectations = [
    [counts.members >= 12, "expected at least 12 member players"],
    [counts.buyins >= 12, "expected at least 12 buy-in rows"],
    [counts.tournaments >= 9, "expected at least 9 seeded tournaments"],
  ];
  const failedExpectation = countExpectations.find(([ok]) => !ok);
  if (failedExpectation) {
    throw new Error(failedExpectation[1]);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: sourcePath,
        backup: backupPath,
        backupBytes: backupStats.size,
        sourceQuickCheck,
        backupQuickCheck,
        tables: requiredTables,
        counts,
        keptBackup: keepBackup || Boolean(process.env.BACKUP_VERIFY_PATH),
      },
      null,
      2
    )
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  backup?.close();
  source?.close();
  if (
    process.exitCode !== 1 &&
    !keepBackup &&
    !process.env.BACKUP_VERIFY_PATH &&
    fs.existsSync(backupPath)
  ) {
    fs.unlinkSync(backupPath);
  }
}
