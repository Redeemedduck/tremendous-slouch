import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp, createDb } from "../server";

type RunningApp = {
  db: ReturnType<typeof createDb>;
  server: http.Server;
  url: string;
};

const dbPath =
  process.env.PROD_SMOKE_DB_PATH ??
  path.join(os.tmpdir(), `djdi-prod-smoke-${process.pid}-${Date.now()}.db`);
const accessCode =
  process.env.PROD_SMOKE_ACCESS_CODE ??
  `prod-smoke-${process.pid}-${Date.now()}`;
const commissionerCode =
  process.env.PROD_SMOKE_COMMISSIONER_CODE ??
  `prod-smoke-admin-${process.pid}-${Date.now()}`;
const keepDb = process.env.KEEP_PROD_SMOKE_DB === "1";
const originalAccessCode = process.env.ACCESS_CODE;
const originalCommissionerCode = process.env.COMMISSIONER_CODE;
const originalHost = process.env.HOST;
const originalNodeEnv = process.env.NODE_ENV;

function latestMtimeMs(entry: string): number {
  if (!fs.existsSync(entry)) return 0;
  const stat = fs.statSync(entry);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(entry)
    .reduce(
      (latest, child) => Math.max(latest, latestMtimeMs(path.join(entry, child))),
      stat.mtimeMs
    );
}

function assertFreshClientBuild() {
  const distIndex = path.resolve("dist/index.html");
  if (!fs.existsSync(distIndex)) {
    throw new Error("dist/index.html is missing; run npm run build first");
  }
  const buildMtime = fs.statSync(distIndex).mtimeMs;
  const inputs = [
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "src",
  ];
  const newestInput = Math.max(
    ...inputs.map((entry) => latestMtimeMs(path.resolve(entry)))
  );
  if (newestInput > buildMtime + 1000) {
    throw new Error(
      "dist/index.html is older than client source; run npm run build before verify:prod-smoke"
    );
  }
}

function cleanup() {
  if (keepDb || process.env.PROD_SMOKE_DB_PATH) return;
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine smoke server port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function start(): Promise<RunningApp> {
  const db = createDb(dbPath);
  const app = createApp(db, { serveAssets: true });
  const server = http.createServer(app);
  const url = await listen(server);
  return { db, server, url };
}

async function stop(app: RunningApp) {
  await new Promise<void>((resolve, reject) => {
    app.server.close((error) => (error ? reject(error) : resolve()));
  });
  app.db.close();
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T;
  return { status: response.status, body, headers: response.headers };
}

function hasAttestationProof(rows: unknown[]) {
  return (
    rows.length > 0 &&
    rows.every((row) => {
      if (!row || typeof row !== "object") return false;
      const record = row as Record<string, unknown>;
      return (
        typeof record.attestationStatus === "string" &&
        typeof record.official === "boolean" &&
        Object.prototype.hasOwnProperty.call(record, "attestedAt") &&
        Object.prototype.hasOwnProperty.call(record, "attestationActor")
      );
    })
  );
}

let runningApp: RunningApp | null = null;

try {
  cleanup();
  assertFreshClientBuild();

  process.env.NODE_ENV = "production";
  process.env.HOST = "127.0.0.1";
  process.env.ACCESS_CODE = accessCode;
  process.env.COMMISSIONER_CODE = commissionerCode;

  const app = await start();
  runningApp = app;
  const root = await fetch(`${app.url}/`);
  const html = await root.text();
  if (root.status !== 200 || !html.includes("DJDI Golf Board")) {
    throw new Error(`built client did not serve correctly: HTTP ${root.status}`);
  }

  const unauthenticated = await fetchJson<{ error: string }>(
    `${app.url}/api/tournaments`
  );
  if (unauthenticated.status !== 401) {
    throw new Error(
      `protected API did not reject unauthenticated request: HTTP ${unauthenticated.status}`
    );
  }

  const accessBefore = await fetchJson<{ required: boolean; ok: boolean }>(
    `${app.url}/api/access`
  );
  if (accessBefore.status !== 200 || !accessBefore.body.required || accessBefore.body.ok) {
    throw new Error("access gate did not report locked state before unlock");
  }

  const unlock = await fetchJson<{ ok: boolean }>(`${app.url}/api/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  const setCookie = unlock.headers.get("set-cookie");
  if (unlock.status !== 200 || !unlock.body.ok || !setCookie) {
    throw new Error(`access unlock failed with HTTP ${unlock.status}`);
  }
  const cookie = setCookie.split(";")[0];
  let authCookie = cookie;
  const commissionerBefore = await fetchJson<{ required: boolean; ok: boolean }>(
    `${app.url}/api/commissioner`,
    { headers: { Cookie: authCookie } }
  );
  if (
    commissionerBefore.status !== 200 ||
    !commissionerBefore.body.required ||
    commissionerBefore.body.ok
  ) {
    throw new Error("commissioner gate did not report locked state before unlock");
  }

  const commissionerUnlock = await fetchJson<{ ok: boolean }>(
    `${app.url}/api/commissioner`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({ code: commissionerCode }),
    }
  );
  const commissionerSetCookie = commissionerUnlock.headers.get("set-cookie");
  if (
    commissionerUnlock.status !== 200 ||
    !commissionerUnlock.body.ok ||
    !commissionerSetCookie
  ) {
    throw new Error(
      `commissioner unlock failed with HTTP ${commissionerUnlock.status}`
    );
  }
  authCookie = `${cookie}; ${commissionerSetCookie.split(";")[0]}`;

  const tournaments = await fetchJson<{
    tournaments: Array<{ id: string; name: string }>;
  }>(`${app.url}/api/tournaments`, { headers: { Cookie: authCookie } });
  if (tournaments.status !== 200 || tournaments.body.tournaments.length < 9) {
    throw new Error(
      `authenticated tournaments check failed with HTTP ${tournaments.status}`
    );
  }

  const teeTimePayload = {
    course: "Common Ground",
    date: "2026-05-19",
    time: "10:11",
    spots: 4,
    host: "Jayson Post",
    notes: `prod-smoke-${process.pid}`,
  };
  const created = await fetchJson<{ teeTime: { id: string } }>(
    `${app.url}/api/teetimes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify(teeTimePayload),
    }
  );
  if (created.status !== 201) {
    throw new Error(`authenticated tee-time create failed with HTTP ${created.status}`);
  }

  const attesterProfile = await fetchJson<{ ok: boolean; name: string }>(
    `${app.url}/api/profile`,
    {
      method: "POST",
      body: JSON.stringify({ name: "Sam Lines" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
    }
  );
  const attesterProfileCookie = attesterProfile.headers.get("set-cookie");
  if (
    attesterProfile.status !== 200 ||
    attesterProfile.body.name !== "Sam Lines" ||
    !attesterProfileCookie
  ) {
    throw new Error(`attester profile smoke failed with HTTP ${attesterProfile.status}`);
  }

  const attesterClaim = await fetchJson<{ teeTime: { id: string } }>(
    `${app.url}/api/teetimes/${created.body.teeTime.id}/claims`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookie}; ${attesterProfileCookie.split(";")[0]}`,
      },
      body: JSON.stringify({ name: "Sam Lines" }),
    }
  );
  if (attesterClaim.status !== 200) {
    throw new Error(`attester claim smoke failed with HTTP ${attesterClaim.status}`);
  }

  const score = await fetchJson<{ teeTime: { id: string } }>(
    `${app.url}/api/teetimes/${created.body.teeTime.id}/scores`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({
        name: "Jayson Post",
        gross: 84,
        courseHcp: 12,
        attestedBy: "Sam Lines",
        teeName: "Gold",
        teeRating: 72,
        teeSlope: 130,
        teePar: 72,
        handicapIndexUsed: 10.6,
        courseHcpSource: "calculated",
      }),
    }
  );
  if (score.status !== 200) {
    throw new Error(`score creation smoke failed with HTTP ${score.status}`);
  }

  const attestedScore = await fetchJson<{ teeTime: { id: string } }>(
    `${app.url}/api/teetimes/${created.body.teeTime.id}/scores/${encodeURIComponent(
      "Jayson Post"
    )}/attest`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookie}; ${attesterProfileCookie.split(";")[0]}`,
      },
      body: JSON.stringify({ name: "Sam Lines" }),
    }
  );
  if (attestedScore.status !== 200) {
    throw new Error(`score attestation smoke failed with HTTP ${attestedScore.status}`);
  }

  const launchCheck = await fetchJson<{
    launchChecks: { dockerBuildVerified: boolean };
    records: Array<{ key: string; verified: boolean; source: string }>;
  }>(`${app.url}/api/launch-checks/dockerBuildVerified`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    body: JSON.stringify({
      verified: true,
      verifiedBy: "Prod Smoke",
      note: "verify:prod-smoke temporary database check",
    }),
  });
  if (
    launchCheck.status !== 200 ||
    !launchCheck.body.launchChecks.dockerBuildVerified ||
    !launchCheck.body.records.some(
      (record) =>
        record.key === "dockerBuildVerified" &&
        record.verified &&
        record.source === "database"
    )
  ) {
    throw new Error(`launch-check update smoke failed with HTTP ${launchCheck.status}`);
  }

  const backupProof = await fetchJson<{
    ok: boolean;
    backupBytes: number;
    sourceQuickCheck: string;
    backupQuickCheck: string;
    counts: { members: number; buyins: number; tournaments: number };
    tables: string[];
  }>(`${app.url}/api/backups/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    body: JSON.stringify({ actor: "Prod Smoke" }),
  });
  if (
    backupProof.status !== 200 ||
    !backupProof.body.ok ||
    backupProof.body.backupBytes <= 0 ||
    backupProof.body.sourceQuickCheck !== "ok" ||
    backupProof.body.backupQuickCheck !== "ok" ||
    backupProof.body.counts.members < 12 ||
    backupProof.body.counts.buyins < 12 ||
    backupProof.body.counts.tournaments < 9 ||
    !backupProof.body.tables.includes("league_buyins")
  ) {
    throw new Error(`backup restore proof smoke failed with HTTP ${backupProof.status}`);
  }

  const summary = await fetch(`${app.url}/api/export/summary.txt`, {
    headers: { Cookie: authCookie },
  });
  const summaryText = await summary.text();
  if (
    summary.status !== 200 ||
    !summaryText.includes("League Checklist") ||
    !summaryText.includes("DJDI Golf Board Season Summary")
  ) {
    throw new Error(`summary export smoke failed with HTTP ${summary.status}`);
  }

  const buyinsCsv = await fetch(`${app.url}/api/export/buyins.csv`, {
    headers: { Cookie: authCookie },
  });
  const buyinsCsvText = await buyinsCsv.text();
  if (
    buyinsCsv.status !== 200 ||
    !buyinsCsvText.includes("player_name,amount,payment_status,paid") ||
    !buyinsCsvText.includes("Jayson Post,325,unpaid,no")
  ) {
    throw new Error(`buy-ins CSV smoke failed with HTTP ${buyinsCsv.status}`);
  }

  const rosterCsv = await fetch(`${app.url}/api/export/roster.csv`, {
    headers: { Cookie: authCookie },
  });
  const rosterCsvText = await rosterCsv.text();
  if (
    rosterCsv.status !== 200 ||
    !rosterCsvText.includes("name,member,ghin_number,handicap_index") ||
    !rosterCsvText.includes("Jayson Post,yes,,10.6")
  ) {
    throw new Error(`roster CSV smoke failed with HTTP ${rosterCsv.status}`);
  }

  const scoresCsv = await fetch(`${app.url}/api/export/scores.csv`, {
    headers: { Cookie: authCookie },
  });
  const scoresCsvText = await scoresCsv.text();
  if (
    scoresCsv.status !== 200 ||
    !scoresCsvText.includes(
      "tournament,tee_time_id,date,time,course,host,player,gross,round_course,round_date,tee_name,tee_rating,tee_slope,tee_par,handicap_index_used,calculated_course_hcp,course_hcp_rounded,course_hcp"
    )
  ) {
    throw new Error(`scores CSV smoke failed with HTTP ${scoresCsv.status}`);
  }

  const payoutsCsv = await fetch(`${app.url}/api/export/payouts.csv`, {
    headers: { Cookie: authCookie },
  });
  const payoutsCsvText = await payoutsCsv.text();
  if (
    payoutsCsv.status !== 200 ||
    !payoutsCsvText.includes(
      "rules_version,tournament_id,tournament,type,closed,closed_at,closed_by,winner,winner_net"
    ) ||
    !payoutsCsvText.includes("2026-w1,Stop 1")
  ) {
    throw new Error(`payouts CSV smoke failed with HTTP ${payoutsCsv.status}`);
  }

  const rules = await fetchJson<{
    app: string;
    rulesVersion: string;
    activeRules: {
      version: string;
      points?: unknown;
      money?: unknown;
      payouts?: unknown;
      ties?: unknown;
      guests?: unknown;
      postseason?: unknown;
      handicap?: unknown;
    };
  }>(`${app.url}/api/export/rules.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    rules.status !== 200 ||
    rules.body.app !== "DJDI Golf Board" ||
    !rules.body.rulesVersion ||
    rules.body.activeRules.version !== rules.body.rulesVersion ||
    !rules.body.activeRules.points ||
    !rules.body.activeRules.money ||
    !rules.body.activeRules.payouts ||
    !rules.body.activeRules.ties ||
    !rules.body.activeRules.guests ||
    !rules.body.activeRules.postseason ||
    !rules.body.activeRules.handicap
  ) {
    throw new Error(`rules JSON smoke failed with HTTP ${rules.status}`);
  }

  const readiness = await fetchJson<{
    app: string;
    counts: { members: number; buyins: number; tournaments: number };
    money: { expected: number; outstanding: number; total: number };
    missingHandicaps: string[];
    unconfirmedEvents: string[];
    activeStop: { leaderboard: unknown[] } | null;
    closeoutReadiness: Array<{ packetUrl: string; ledgerUrl: string }>;
    launchCheckEvidence: Array<{ key: string; verified: boolean; source: string }>;
    launchRisks: Array<{ label: string }>;
    commissionerTasks: Array<{ id: string; copyText: string | null }>;
  }>(`${app.url}/api/export/readiness.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    readiness.status !== 200 ||
    readiness.body.app !== "DJDI Golf Board" ||
    readiness.body.counts.members !== 12 ||
    readiness.body.counts.buyins < 12 ||
    readiness.body.counts.tournaments < 9 ||
    readiness.body.money.expected < 3900 ||
    !Array.isArray(readiness.body.missingHandicaps) ||
    !Array.isArray(readiness.body.unconfirmedEvents) ||
    !Array.isArray(readiness.body.activeStop?.leaderboard ?? []) ||
    !Array.isArray(readiness.body.closeoutReadiness) ||
    !readiness.body.closeoutReadiness.some((item) =>
      item.packetUrl?.startsWith("/api/export/closeout/")
    ) ||
    !readiness.body.closeoutReadiness.some((item) =>
      item.ledgerUrl?.startsWith("/api/export/closeout/")
    ) ||
    !readiness.body.launchCheckEvidence.some(
      (check) =>
        check.key === "dockerBuildVerified" &&
        check.verified &&
        check.source === "database"
    ) ||
    readiness.body.launchRisks.some((risk) => risk.label === "Docker image build") ||
    !readiness.body.launchRisks.some((risk) => risk.label === "Buy-in tracking") ||
    !readiness.body.commissionerTasks.some(
      (task) =>
        task.id === "collect-buyins" &&
        task.copyText?.includes("Outstanding total")
    )
  ) {
    throw new Error(`readiness export smoke failed with HTTP ${readiness.status}`);
  }

  const closeoutPacket = await fetch(
    `${app.url}${readiness.body.closeoutReadiness[0].packetUrl}`,
    { headers: { Cookie: authCookie } }
  );
  const closeoutPacketText = await closeoutPacket.text();
  if (
    closeoutPacket.status !== 200 ||
    !closeoutPacketText.includes("DJDI Tournament Closeout Packet") ||
    !closeoutPacketText.includes("Score Evidence") ||
    !closeoutPacketText.includes("Payout evidence:") ||
    (!closeoutPacketText.includes("official:") &&
      !closeoutPacketText.includes("not official:"))
  ) {
    throw new Error(
      `closeout packet smoke failed with HTTP ${closeoutPacket.status}`
    );
  }

  const closeoutLedger = await fetchJson<{
    app: string;
    tournament: { id: string };
    payout: { evidenceStatus: string; evidenceMissing: boolean };
    integrity: {
      scoreEvidenceRows: number;
      snapshotMatchesCurrent: boolean | null;
      payoutEvidenceMissing: boolean;
    };
    scoreEvidence: unknown[];
  }>(`${app.url}${readiness.body.closeoutReadiness[0].ledgerUrl}`, {
    headers: { Cookie: authCookie },
  });
  if (
    closeoutLedger.status !== 200 ||
    closeoutLedger.body.app !== "DJDI Golf Board" ||
    !closeoutLedger.body.tournament.id ||
    typeof closeoutLedger.body.payout.evidenceStatus !== "string" ||
    typeof closeoutLedger.body.payout.evidenceMissing !== "boolean" ||
    typeof closeoutLedger.body.integrity.payoutEvidenceMissing !== "boolean" ||
    !Array.isArray(closeoutLedger.body.scoreEvidence) ||
    closeoutLedger.body.integrity.scoreEvidenceRows !==
      closeoutLedger.body.scoreEvidence.length ||
    !hasAttestationProof(closeoutLedger.body.scoreEvidence)
  ) {
    throw new Error(`closeout ledger smoke failed with HTTP ${closeoutLedger.status}`);
  }

  const auditJson = await fetchJson<{
    app: string;
    count: number;
    events: Array<{ action: string; subjectType: string; summary: string }>;
  }>(`${app.url}/api/export/audit.json`, { headers: { Cookie: authCookie } });
  if (
    auditJson.status !== 200 ||
    auditJson.body.app !== "DJDI Golf Board" ||
    auditJson.body.count < 2 ||
    !auditJson.body.events.some((event) => event.action === "tee_time_create") ||
    !auditJson.body.events.some(
      (event) => event.action === "launch_check_update"
    )
  ) {
    throw new Error(`audit JSON smoke failed with HTTP ${auditJson.status}`);
  }

  const auditCsv = await fetch(`${app.url}/api/export/audit.csv`, {
    headers: { Cookie: authCookie },
  });
  const auditCsvText = await auditCsv.text();
  if (
    auditCsv.status !== 200 ||
    !auditCsvText.includes("created_at,action,actor,subject_type,subject_id,summary") ||
    !auditCsvText.includes("tee_time_create")
  ) {
    throw new Error(`audit CSV smoke failed with HTTP ${auditCsv.status}`);
  }

  const recordedVerification = await fetchJson<{
    verificationRun: { id: string; status: string };
  }>(`${app.url}/api/verification-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    body: JSON.stringify({
      command: "npm run verify:prod-smoke",
      status: "passed",
      scope: ["access gate", "built client", "exports", "archive manifest"],
      summary: "Production smoke verifier passed against a temporary built app.",
      recordedBy: "Prod Smoke",
      metadata: {
        url: app.url,
        teeTimeId: created.body.teeTime.id,
        database: dbPath,
      },
    }),
  });
  if (
    recordedVerification.status !== 201 ||
    recordedVerification.body.verificationRun.status !== "passed"
  ) {
    throw new Error(
      `verification run record failed with HTTP ${recordedVerification.status}`
    );
  }

  const verificationJson = await fetchJson<{
    app: string;
    count: number;
    verificationRuns: Array<{ id: string; command: string; status: string }>;
  }>(`${app.url}/api/export/verification-runs.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    verificationJson.status !== 200 ||
    verificationJson.body.app !== "DJDI Golf Board" ||
    verificationJson.body.count < 1 ||
    !verificationJson.body.verificationRuns.some(
      (run) =>
        run.id === recordedVerification.body.verificationRun.id &&
        run.command === "npm run verify:prod-smoke" &&
        run.status === "passed"
    )
  ) {
    throw new Error(
      `verification JSON export failed with HTTP ${verificationJson.status}`
    );
  }

  const verificationCsv = await fetch(
    `${app.url}/api/export/verification-runs.csv`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const verificationCsvText = await verificationCsv.text();
  if (
    verificationCsv.status !== 200 ||
    !verificationCsvText.includes(
      "created_at,command,status,recorded_by,scope,summary"
    ) ||
    !verificationCsvText.includes("npm run verify:prod-smoke")
  ) {
    throw new Error(
      `verification CSV export failed with HTTP ${verificationCsv.status}`
    );
  }

  const completionAudit = await fetchJson<{
    app: string;
    ready: boolean;
    appReady: boolean;
    statusCounts: { passed: number; open: number; blocked: number };
    appStatusCounts: { passed: number; open: number; blocked: number };
    items: Array<{
      id: string;
      status: string;
      readinessScope: string;
      artifactUrls: string[];
    }>;
  }>(`${app.url}/api/export/completion-audit.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    completionAudit.status !== 200 ||
    completionAudit.body.app !== "DJDI Golf Board" ||
    completionAudit.body.ready ||
    typeof completionAudit.body.appReady !== "boolean" ||
    typeof completionAudit.body.appStatusCounts.open !== "number" ||
    completionAudit.body.statusCounts.open < 1 ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "proof-ledger" &&
        item.status === "passed" &&
        item.artifactUrls.includes("/api/export/verification-runs.json")
    ) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "docker-gate" &&
        item.artifactUrls.includes("/api/export/launch-checks.json") &&
        item.artifactUrls.includes("/api/export/launch-checks.csv")
    ) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "money-collected" &&
        item.status === "open" &&
        item.readinessScope === "league_data"
    ) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "source-search-ledger" &&
        item.status === "passed" &&
        item.artifactUrls.includes("/api/export/source-search-ledger.json") &&
        item.artifactUrls.includes("/api/export/source-search-ledger.csv")
    )
  ) {
    throw new Error(
      `completion audit export failed with HTTP ${completionAudit.status}`
    );
  }

  const completionAuditCsv = await fetch(
    `${app.url}/api/export/completion-audit.csv`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const completionAuditCsvText = await completionAuditCsv.text();
  if (
    completionAuditCsv.status !== 200 ||
    !completionAuditCsvText.includes(
      "id,area,requirement,status,readiness_scope,proof_strength,evidence,next_action,artifact_urls"
    ) ||
    !completionAuditCsvText.includes("money-collected,Money,") ||
    !completionAuditCsvText.includes(",open,league_data,direct,") ||
    !completionAuditCsvText.includes("source-search-ledger,Evidence,")
  ) {
    throw new Error(
      `completion audit CSV export failed with HTTP ${completionAuditCsv.status}`
    );
  }

  const launchChecksExport = await fetchJson<{
    app: string;
    count: number;
    verifiedCount: number;
    openCount: number;
    records: Array<{ key: string; verified: boolean; source: string }>;
  }>(`${app.url}/api/export/launch-checks.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    launchChecksExport.status !== 200 ||
    launchChecksExport.body.app !== "DJDI Golf Board" ||
    launchChecksExport.body.count !== 4 ||
    launchChecksExport.body.verifiedCount < 1 ||
    launchChecksExport.body.openCount > 3 ||
    !launchChecksExport.body.records.some(
      (record) =>
        record.key === "dockerBuildVerified" &&
        record.verified &&
        record.source === "database"
    )
  ) {
    throw new Error(
      `launch checks export failed with HTTP ${launchChecksExport.status}`
    );
  }

  const launchChecksCsv = await fetch(`${app.url}/api/export/launch-checks.csv`, {
    headers: { Cookie: authCookie },
  });
  const launchChecksCsvText = await launchChecksCsv.text();
  if (
    launchChecksCsv.status !== 200 ||
    !launchChecksCsvText.includes(
      "key,label,verified,source,verified_at,verified_by,note,env_var,updated_at"
    ) ||
    !launchChecksCsvText.includes(
      "dockerBuildVerified,Docker image build,yes,database"
    ) ||
    !launchChecksCsvText.includes(
      "tailnetServeVerified,Tailscale Funnel smoke"
    )
  ) {
    throw new Error(
      `launch checks CSV export failed with HTTP ${launchChecksCsv.status}`
    );
  }

  const launchGateChecklist = await fetchJson<{
    app: string;
    summary: { total: number; verified: number; open: number };
    items: Array<{ key: string; status: string; steps: Array<{ id: string }> }>;
  }>(`${app.url}/api/export/launch-gate-checklist.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    launchGateChecklist.status !== 200 ||
    launchGateChecklist.body.app !== "DJDI Golf Board" ||
    launchGateChecklist.body.summary.total !== 4 ||
    launchGateChecklist.body.summary.open > 3 ||
    !launchGateChecklist.body.items.some(
      (item) =>
        item.key === "tailnetServeVerified" &&
        item.steps.some((step) => step.id === "funnel-smoke")
    ) ||
    !launchGateChecklist.body.items.some(
      (item) =>
        item.key === "productionUrlVerified" &&
        item.steps.some((step) => step.id === "remote-smoke")
    ) ||
    !launchGateChecklist.body.items.some(
      (item) =>
        item.key === "mobileSafariVerified" &&
        item.steps.some((step) => step.id === "iphone-score-ops")
    )
  ) {
    throw new Error(
      `launch gate checklist export failed with HTTP ${launchGateChecklist.status}`
    );
  }

  const launchGateChecklistCsv = await fetch(
    `${app.url}/api/export/launch-gate-checklist.csv`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const launchGateChecklistCsvText = await launchGateChecklistCsv.text();
  if (
    launchGateChecklistCsv.status !== 200 ||
    !launchGateChecklistCsvText.includes(
      "key,label,status,source,verified_at,verified_by,note,env_var,step_count,steps,final_action"
    ) ||
    !launchGateChecklistCsvText.includes("tailnetServeVerified,Tailscale Funnel smoke") ||
    !launchGateChecklistCsvText.includes(
      "productionUrlVerified,Production URL smoke"
    )
  ) {
    throw new Error(
      `launch gate checklist CSV export failed with HTTP ${launchGateChecklistCsv.status}`
    );
  }

  const launchGateChecklistText = await fetch(
    `${app.url}/api/export/launch-gate-checklist.txt`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const launchGateChecklistTextBody = await launchGateChecklistText.text();
  if (
    launchGateChecklistText.status !== 200 ||
    !launchGateChecklistTextBody.includes("DJDI Launch Gate Checklist") ||
    !launchGateChecklistTextBody.includes("Tailscale Funnel smoke") ||
    !launchGateChecklistTextBody.includes("physical-device golden path")
  ) {
    throw new Error(
      `launch gate checklist text export failed with HTTP ${launchGateChecklistText.status}`
    );
  }

  const sourceSearchLedger = await fetchJson<{
    app: string;
    count: number;
    recordedFacts: number;
    noSourceFound: number;
    blockedSources: number;
    entries: Array<{ id: string; status: string }>;
  }>(`${app.url}/api/export/source-search-ledger.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    sourceSearchLedger.status !== 200 ||
    sourceSearchLedger.body.app !== "DJDI Golf Board" ||
    sourceSearchLedger.body.count < 7 ||
    sourceSearchLedger.body.recordedFacts < 2 ||
    sourceSearchLedger.body.noSourceFound < 3 ||
    sourceSearchLedger.body.blockedSources < 1 ||
    !sourceSearchLedger.body.entries.some(
      (entry) => entry.id === "messages-access-denied" && entry.status === "blocked"
    )
  ) {
    throw new Error(
      `source search ledger export failed with HTTP ${sourceSearchLedger.status}`
    );
  }

  const sourceSearchLedgerCsv = await fetch(
    `${app.url}/api/export/source-search-ledger.csv`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const sourceSearchLedgerCsvText = await sourceSearchLedgerCsv.text();
  if (
    sourceSearchLedgerCsv.status !== 200 ||
    !sourceSearchLedgerCsvText.includes(
      "id,area,claim_type,status,claim,source_checked,result,decision,evidence_ids,related_open_items"
    ) ||
    !sourceSearchLedgerCsvText.includes("matt-buyin-venmo,Money,fact,recorded")
  ) {
    throw new Error(
      `source search ledger CSV export failed with HTTP ${sourceSearchLedgerCsv.status}`
    );
  }

  const archive = await fetchJson<{
    app: string;
    snapshotHash: string;
    counts: {
      members: number;
      buyins: number;
      tournaments: number;
      auditEvents: number;
      verificationRuns: number;
    };
    artifacts: Array<{ id: string; url: string }>;
    verificationRuns: Array<{ id: string }>;
    completionAudit: { ready: boolean; url: string };
    closeouts: Array<{ packetUrl: string; ledgerUrl: string }>;
    remainingRisks: Array<{ label: string }>;
  }>(`${app.url}/api/export/archive.json`, { headers: { Cookie: authCookie } });
  if (
    archive.status !== 200 ||
    archive.body.app !== "DJDI Golf Board" ||
    !/^[a-f0-9]{64}$/.test(archive.body.snapshotHash) ||
    archive.body.counts.members !== 12 ||
    archive.body.counts.buyins < 12 ||
    archive.body.counts.tournaments < 9 ||
    archive.body.counts.auditEvents < 2 ||
    archive.body.counts.verificationRuns < 1 ||
    !archive.body.artifacts.some((artifact) => artifact.id === "audit-json") ||
    !archive.body.artifacts.some((artifact) => artifact.id === "rules-json") ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "verification-runs-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "completion-audit-json"
    ) ||
    !archive.body.artifacts.some((artifact) => artifact.id === "tasks-csv") ||
    !archive.body.artifacts.some((artifact) => artifact.id === "risks-json") ||
    !archive.body.artifacts.some((artifact) => artifact.id === "risks-csv") ||
    !archive.body.artifacts.some((artifact) => artifact.id === "request-packet") ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "blocker-handoff-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "blocker-handoff-text"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "evidence-gap-packet-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "evidence-gap-packet-csv"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "evidence-gap-packet-text"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "source-search-ledger-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "source-search-ledger-csv"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "completion-audit-csv"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "launch-checks-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "launch-checks-csv"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "launch-gate-checklist-json"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "launch-gate-checklist-csv"
    ) ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "launch-gate-checklist-text"
    ) ||
    !archive.body.artifacts.some((artifact) => artifact.id === "database") ||
    archive.body.completionAudit.url !== "/api/export/completion-audit.json" ||
    !archive.body.verificationRuns.some(
      (run) => run.id === recordedVerification.body.verificationRun.id
    ) ||
    !archive.body.closeouts.some(
      (closeout) =>
        closeout.packetUrl.startsWith("/api/export/closeout/") &&
        closeout.ledgerUrl.startsWith("/api/export/closeout/")
    ) ||
    !archive.body.remainingRisks.some((risk) => risk.label === "Buy-in tracking")
  ) {
    throw new Error(`archive manifest smoke failed with HTTP ${archive.status}`);
  }

  const taskExport = await fetch(`${app.url}/api/export/tasks.json`, {
    headers: { Cookie: authCookie },
  });
  const taskExportJson = (await taskExport.json()) as {
    app: string;
    count: number;
    copyPacket: string;
    requestPacket: string;
    tasks: Array<{ id: string; copyText: string | null }>;
  };
  if (
    taskExport.status !== 200 ||
    taskExportJson.app !== "DJDI Golf Board" ||
    taskExportJson.count !== readiness.body.commissionerTasks.length ||
    !taskExportJson.copyPacket.includes("DJDI commissioner tasks:") ||
    !taskExportJson.requestPacket.includes("DJDI request packet") ||
    !taskExportJson.requestPacket.includes("DJDI buy-in status tracker") ||
    !taskExportJson.requestPacket.includes("DJDI handicap records still needed") ||
    !taskExportJson.tasks.some(
      (task) =>
        task.id === "collect-ghin-indexes" &&
        task.copyText?.includes("DJDI handicap records still needed")
    )
  ) {
    throw new Error(`task export smoke failed with HTTP ${taskExport.status}`);
  }

  const taskExportCsv = await fetch(`${app.url}/api/export/tasks.csv`, {
    headers: { Cookie: authCookie },
  });
  const taskExportCsvText = await taskExportCsv.text();
  if (
    taskExportCsv.status !== 200 ||
    !taskExportCsvText.includes(
      "id,area,severity,title,detail,next_action,items,copy_text,done"
    ) ||
    !taskExportCsvText.includes("collect-ghin-indexes,roster,risk")
  ) {
    throw new Error(`task CSV export smoke failed with HTTP ${taskExportCsv.status}`);
  }

  const riskExport = await fetchJson<{
    app: string;
    count: number;
    severityCounts: { risk: number; external: number };
    risks: Array<{ id: string; label: string; severity: string }>;
  }>(`${app.url}/api/export/risks.json`, { headers: { Cookie: authCookie } });
  if (
    riskExport.status !== 200 ||
    riskExport.body.app !== "DJDI Golf Board" ||
    riskExport.body.count !== readiness.body.launchRisks.length ||
    riskExport.body.severityCounts.risk < 1 ||
    riskExport.body.severityCounts.external < 1 ||
    !riskExport.body.risks.some((risk) => risk.id === "money-collection") ||
    riskExport.body.risks.some((risk) => risk.id === "production-url")
  ) {
    throw new Error(`risk JSON export smoke failed with HTTP ${riskExport.status}`);
  }

  const riskExportCsv = await fetch(`${app.url}/api/export/risks.csv`, {
    headers: { Cookie: authCookie },
  });
  const riskExportCsvText = await riskExportCsv.text();
  if (
    riskExportCsv.status !== 200 ||
    !riskExportCsvText.includes("id,severity,label,detail,next_action") ||
    !riskExportCsvText.includes("money-collection,risk,Buy-in tracking") ||
    riskExportCsvText.includes("production-url,external")
  ) {
    throw new Error(`risk CSV export smoke failed with HTTP ${riskExportCsv.status}`);
  }

  const requestPacket = await fetch(`${app.url}/api/export/request-packet.txt`, {
    headers: { Cookie: authCookie },
  });
  const requestPacketText = await requestPacket.text();
  if (
    requestPacket.status !== 200 ||
    !requestPacketText.includes("DJDI request packet") ||
    !requestPacketText.includes("DJDI buy-in status tracker") ||
    !requestPacketText.includes("DJDI handicap records still needed")
  ) {
    throw new Error(
      `request packet export smoke failed with HTTP ${requestPacket.status}`
    );
  }

  const blockerHandoff = await fetchJson<{
    app: string;
    summary: { taskCount: number; manualActionRequired: number };
    rows: Array<{ taskId: string; evidenceStatus: string }>;
  }>(`${app.url}/api/export/blocker-handoff.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    blockerHandoff.status !== 200 ||
    blockerHandoff.body.app !== "DJDI Golf Board" ||
    blockerHandoff.body.summary.taskCount < 1 ||
    blockerHandoff.body.summary.manualActionRequired < 1 ||
    !blockerHandoff.body.rows.some(
      (row) => row.taskId === "collect-buyins" && row.evidenceStatus === "blocked_source"
    )
  ) {
    throw new Error(
      `blocker handoff export smoke failed with HTTP ${blockerHandoff.status}`
    );
  }

  const blockerHandoffText = await fetch(
    `${app.url}/api/export/blocker-handoff.txt`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const blockerHandoffTextBody = await blockerHandoffText.text();
  if (
    blockerHandoffText.status !== 200 ||
    !blockerHandoffTextBody.includes("DJDI Commissioner Handoff") ||
    !blockerHandoffTextBody.includes("Evidence: blocked_source")
  ) {
    throw new Error(
      `blocker handoff text export smoke failed with HTTP ${blockerHandoffText.status}`
    );
  }

  const evidenceGapPacket = await fetchJson<{
    app: string;
    summary: { total: number; onePasteReady: number; launchVerification: number };
    items: Array<{ id: string; blockerId: string; intakePath: string }>;
  }>(`${app.url}/api/export/evidence-gap-packet.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    evidenceGapPacket.status !== 200 ||
    evidenceGapPacket.body.app !== "DJDI Golf Board" ||
    evidenceGapPacket.body.summary.total < 1 ||
    evidenceGapPacket.body.summary.onePasteReady < 1 ||
    evidenceGapPacket.body.summary.launchVerification < 1 ||
    !evidenceGapPacket.body.items.some(
      (item) => item.blockerId === "money-collected" && item.intakePath === "Ops > One-Paste Intake"
    ) ||
    !evidenceGapPacket.body.items.some(
      (item) => item.blockerId === "iphone-safari-gate"
    )
  ) {
    throw new Error(
      `evidence gap packet JSON export smoke failed with HTTP ${evidenceGapPacket.status}`
    );
  }

  const evidenceGapPacketCsv = await fetch(
    `${app.url}/api/export/evidence-gap-packet.csv`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const evidenceGapPacketCsvText = await evidenceGapPacketCsv.text();
  if (
    evidenceGapPacketCsv.status !== 200 ||
    !evidenceGapPacketCsvText.includes(
      "id,area,blocker_id,label,owner,requested_evidence,paste_back_template,intake_path,source_status,source_decision,related_task_id"
    ) ||
    !evidenceGapPacketCsvText.includes("money-collected")
  ) {
    throw new Error(
      `evidence gap packet CSV export smoke failed with HTTP ${evidenceGapPacketCsv.status}`
    );
  }

  const evidenceGapPacketText = await fetch(
    `${app.url}/api/export/evidence-gap-packet.txt`,
    {
      headers: { Cookie: authCookie },
    }
  );
  const evidenceGapPacketTextBody = await evidenceGapPacketText.text();
  if (
    evidenceGapPacketText.status !== 200 ||
    !evidenceGapPacketTextBody.includes("DJDI Evidence Gap Packet") ||
    !evidenceGapPacketTextBody.includes("Paste back:")
  ) {
    throw new Error(
      `evidence gap packet text export smoke failed with HTTP ${evidenceGapPacketText.status}`
    );
  }

  const launchPacket = await fetch(`${app.url}/api/export/launch-packet.txt`, {
    headers: { Cookie: authCookie },
  });
  const launchPacketText = await launchPacket.text();
  if (
    launchPacket.status !== 200 ||
    !launchPacketText.includes("DJDI Launch Packet") ||
    !launchPacketText.includes("Copy/Paste Asks") ||
    !launchPacketText.includes("Commissioner Tasks") ||
    !launchPacketText.includes("Outbound Request Packet") ||
    !launchPacketText.includes("Source Search Coverage") ||
    !launchPacketText.includes("/api/export/rules.json") ||
    !launchPacketText.includes("/api/export/request-packet.txt") ||
    !launchPacketText.includes("/api/export/blocker-handoff.json") ||
    !launchPacketText.includes("/api/export/blocker-handoff.txt") ||
    !launchPacketText.includes("/api/export/evidence-gap-packet.json") ||
    !launchPacketText.includes("/api/export/evidence-gap-packet.csv") ||
    !launchPacketText.includes("/api/export/evidence-gap-packet.txt") ||
    !launchPacketText.includes("/api/export/source-search-ledger.json") ||
    !launchPacketText.includes("/api/export/source-search-ledger.csv") ||
    !launchPacketText.includes("/api/export/risks.json") ||
    !launchPacketText.includes("/api/export/risks.csv") ||
    !launchPacketText.includes("/api/export/launch-checks.json") ||
    !launchPacketText.includes("/api/export/launch-checks.csv") ||
    !launchPacketText.includes("/api/export/launch-gate-checklist.json") ||
    !launchPacketText.includes("/api/export/launch-gate-checklist.csv") ||
    !launchPacketText.includes("/api/export/launch-gate-checklist.txt")
  ) {
    throw new Error(
      `launch packet export smoke failed with HTTP ${launchPacket.status}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: app.url,
        database: dbPath,
        accessGate: "verified",
        builtClient: "verified",
        tournaments: tournaments.body.tournaments.length,
        teeTimeId: created.body.teeTime.id,
        launchCheckUpdate: "verified",
        readinessExport: "verified",
        closeoutExports: "verified",
        auditExport: "verified",
        verificationRun: recordedVerification.body.verificationRun.id,
        completionAudit: "verified",
        archiveExport: "verified",
        taskExport: "verified",
        summaryExport: "verified",
        csvExports: "verified",
        launchPacketExport: "verified",
        keptDatabase: keepDb || Boolean(process.env.PROD_SMOKE_DB_PATH),
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Production smoke verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  if (runningApp) {
    await stop(runningApp).catch((error) => {
      console.error(
        `Production smoke cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }
  if (originalAccessCode == null) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = originalAccessCode;
  if (originalCommissionerCode == null) delete process.env.COMMISSIONER_CODE;
  else process.env.COMMISSIONER_CODE = originalCommissionerCode;
  if (originalHost == null) delete process.env.HOST;
  else process.env.HOST = originalHost;
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  cleanup();
}
