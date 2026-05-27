import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const rawUrl =
  process.env.REMOTE_SMOKE_URL ??
  process.env.DJDI_REMOTE_SMOKE_URL ??
  process.env.DJDI_PRODUCTION_URL ??
  process.env.PRODUCTION_URL;
const accessCode =
  process.env.REMOTE_SMOKE_ACCESS_CODE ??
  process.env.DJDI_REMOTE_SMOKE_ACCESS_CODE ??
  process.env.ACCESS_CODE;
const commissionerCode =
  process.env.REMOTE_SMOKE_COMMISSIONER_CODE ??
  process.env.DJDI_REMOTE_SMOKE_COMMISSIONER_CODE ??
  process.env.COMMISSIONER_CODE;

if (!rawUrl) {
  console.error(
    "Remote smoke verification failed: set REMOTE_SMOKE_URL=https://your-app.example"
  );
  process.exit(1);
}

const baseUrl = rawUrl.replace(/\/+$/, "");
const parsedBaseUrl = new URL(baseUrl);
const originUrl = parsedBaseUrl.origin;
const appMountPath = parsedBaseUrl.pathname.replace(/\/+$/, "");
const apiBaseUrl =
  appMountPath && appMountPath !== "/"
    ? `${originUrl}${appMountPath}-api`
    : `${baseUrl}/api`;
const REQUEST_TIMEOUT_MS = 15_000;

function withTimeout(init?: RequestInit): RequestInit {
  return {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

async function fetchText(path: string, init?: RequestInit) {
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, withTimeout(init));
  } catch (error) {
    throw new Error(
      `${url} fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

async function fetchJson<T>(path: string, init?: RequestInit) {
  const apiPath = path.startsWith("/api/") ? path.slice(4) : path;
  const url = `${apiBaseUrl}${apiPath}`;
  let response: Response;
  try {
    response = await fetch(url, withTimeout(init));
  } catch (error) {
    throw new Error(
      `${url} fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`${path} returned non-JSON body with HTTP ${response.status}`);
  }
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

try {
  const root = await fetchText("/");
  if (
    root.status !== 200 ||
    !root.text.includes("DJDI Golf Board") ||
    root.text.includes("Bandon Camp") ||
    root.text.includes("BANDON CAMP") ||
    root.text.includes("Transition Command Center")
  ) {
    throw new Error(`client root check failed with HTTP ${root.status}`);
  }

  const health = await fetchJson<{ ok: boolean; database: string }>("/api/health");
  if (health.status !== 200 || !health.body.ok || health.body.database !== "ok") {
    throw new Error(`health check failed with HTTP ${health.status}`);
  }

  const accessBefore = await fetchJson<{
    required: boolean;
    ok: boolean;
    launchChecks?: {
      dockerBuildVerified?: boolean;
      tailnetServeVerified?: boolean;
      productionUrlVerified?: boolean;
      mobileSafariVerified?: boolean;
    };
  }>("/api/access");
  if (accessBefore.status !== 200) {
    throw new Error(`access check failed with HTTP ${accessBefore.status}`);
  }

  if (!accessBefore.body.required) {
    throw new Error("remote app ACCESS_CODE gate is not configured");
  }
  const unauthenticated = await fetchJson<{ error?: string }>("/api/tournaments");
  if (unauthenticated.status !== 401) {
    throw new Error(
      `protected API did not reject unauthenticated request: HTTP ${unauthenticated.status}`
    );
  }
  if (!accessCode) {
    throw new Error(
      "remote app requires ACCESS_CODE; set REMOTE_SMOKE_ACCESS_CODE, DJDI_REMOTE_SMOKE_ACCESS_CODE, or ACCESS_CODE"
    );
  }
  const unlock = await fetchJson<{ ok: boolean }>("/api/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  const setCookie = unlock.headers.get("set-cookie");
  if (unlock.status !== 200 || !unlock.body.ok || !setCookie) {
    throw new Error(`remote access unlock failed with HTTP ${unlock.status}`);
  }
  const cookie = setCookie.split(";")[0];
  const accessGate: "verified" = "verified";

  let authCookie = cookie;
  const commissionerBefore = await fetchJson<{ required: boolean; ok: boolean }>(
    "/api/commissioner",
    authCookie ? { headers: { Cookie: authCookie } } : undefined
  );
  if (commissionerBefore.status !== 200) {
    throw new Error(
      `commissioner gate check failed with HTTP ${commissionerBefore.status}`
    );
  }
  if (!commissionerBefore.body.required) {
    throw new Error("remote app has no COMMISSIONER_CODE configured");
  }
  let commissionerGate: "verified" | "cookie" = "cookie";
  if (!commissionerBefore.body.ok) {
    if (!commissionerCode) {
      throw new Error(
        "remote app requires COMMISSIONER_CODE; set REMOTE_SMOKE_COMMISSIONER_CODE, DJDI_REMOTE_SMOKE_COMMISSIONER_CODE, or COMMISSIONER_CODE"
      );
    }
    const commissionerUnlock = await fetchJson<{ ok: boolean }>("/api/commissioner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authCookie ? { Cookie: authCookie } : {}),
      },
      body: JSON.stringify({ code: commissionerCode }),
    });
    const setCommissionerCookie = commissionerUnlock.headers.get("set-cookie");
    if (
      commissionerUnlock.status !== 200 ||
      !commissionerUnlock.body.ok ||
      !setCommissionerCookie
    ) {
      throw new Error(
        `remote commissioner unlock failed with HTTP ${commissionerUnlock.status}`
      );
    }
    authCookie = authCookie
      ? `${authCookie}; ${setCommissionerCookie.split(";")[0]}`
      : setCommissionerCookie.split(";")[0];
    commissionerGate = "verified";
  }

  const headers = authCookie ? { Cookie: authCookie } : undefined;
  const tournaments = await fetchJson<{
    tournaments: Array<{ id: string; name: string }>;
  }>("/api/tournaments", { headers });
  if (
    tournaments.status !== 200 ||
    !tournaments.body.tournaments.some((tournament) => tournament.id === "2026-w1")
  ) {
    throw new Error(`tournaments check failed with HTTP ${tournaments.status}`);
  }

  const season = await fetchJson<{
    app: string;
    tournaments: unknown[];
    buyins: unknown[];
  }>("/api/export/season.json", { headers });
  if (
    season.status !== 200 ||
    season.body.app !== "DJDI Golf Board" ||
    season.body.tournaments.length < 9 ||
    season.body.buyins.length < 12
  ) {
    throw new Error(`season JSON export check failed with HTTP ${season.status}`);
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
  }>("/api/export/rules.json", { headers });
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
    throw new Error(`rules JSON export check failed with HTTP ${rules.status}`);
  }

  const readiness = await fetchJson<{
    app: string;
    counts: { members: number; buyins: number; tournaments: number; launchRisks: number };
    status: { ready: boolean; riskCount: number; externalCount: number };
    money: { expected: number; outstanding: number; total: number };
    missingHandicaps: string[];
    unconfirmedEvents: string[];
    activeStop: {
      leader: { name: string; bestNet: number | null } | null;
      leaderboard: unknown[];
    } | null;
    closeoutReadiness: Array<{ packetUrl: string; ledgerUrl: string }>;
    launchCheckEvidence: Array<{ key: string; verified: boolean; source: string }>;
    launchRisks: Array<{ label: string }>;
    commissionerTasks: Array<{ id: string; copyText: string | null }>;
  }>("/api/export/readiness.json", { headers });
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
      (check) => check.key === "dockerBuildVerified"
    ) ||
    !readiness.body.launchRisks.some((risk) => risk.label === "Buy-in tracking") ||
    !readiness.body.commissionerTasks.some(
      (task) =>
        task.id === "collect-buyins" &&
        task.copyText?.includes("Outstanding total")
    )
  ) {
    throw new Error(`readiness JSON export check failed with HTTP ${readiness.status}`);
  }

  const closeoutPacket = await fetchText(
    readiness.body.closeoutReadiness[0].packetUrl,
    { headers }
  );
  if (
    closeoutPacket.status !== 200 ||
    !closeoutPacket.text.includes("DJDI Tournament Closeout Packet") ||
    !closeoutPacket.text.includes("Score Evidence") ||
    !closeoutPacket.text.includes("Payout evidence:") ||
    (!closeoutPacket.text.includes("official:") &&
      !closeoutPacket.text.includes("not official:"))
  ) {
    throw new Error(
      `closeout packet export check failed with HTTP ${closeoutPacket.status}`
    );
  }

  const closeoutLedger = await fetchJson<{
    app: string;
    tournament: { id: string };
    payout: { evidenceStatus: string; evidenceMissing: boolean };
    integrity: { scoreEvidenceRows: number; payoutEvidenceMissing: boolean };
    scoreEvidence: unknown[];
  }>(readiness.body.closeoutReadiness[0].ledgerUrl, { headers });
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
    throw new Error(
      `closeout ledger export check failed with HTTP ${closeoutLedger.status}`
    );
  }

  const auditJson = await fetchJson<{
    app: string;
    count: number;
    events: unknown[];
  }>("/api/export/audit.json", { headers });
  if (
    auditJson.status !== 200 ||
    auditJson.body.app !== "DJDI Golf Board" ||
    typeof auditJson.body.count !== "number" ||
    !Array.isArray(auditJson.body.events)
  ) {
    throw new Error(`audit JSON export check failed with HTTP ${auditJson.status}`);
  }

  const auditCsv = await fetchText("/api/export/audit.csv", { headers });
  if (
    auditCsv.status !== 200 ||
    !auditCsv.text.includes("created_at,action,actor,subject_type,subject_id,summary")
  ) {
    throw new Error(`audit CSV export check failed with HTTP ${auditCsv.status}`);
  }

  const verificationJson = await fetchJson<{
    app: string;
    count: number;
    verificationRuns: unknown[];
  }>("/api/export/verification-runs.json", { headers });
  if (
    verificationJson.status !== 200 ||
    verificationJson.body.app !== "DJDI Golf Board" ||
    typeof verificationJson.body.count !== "number" ||
    !Array.isArray(verificationJson.body.verificationRuns)
  ) {
    throw new Error(
      `verification JSON export check failed with HTTP ${verificationJson.status}`
    );
  }

  const verificationCsv = await fetchText("/api/export/verification-runs.csv", {
    headers,
  });
  if (
    verificationCsv.status !== 200 ||
    !verificationCsv.text.includes(
      "created_at,command,status,recorded_by,scope,summary"
    )
  ) {
    throw new Error(
      `verification CSV export check failed with HTTP ${verificationCsv.status}`
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
  }>("/api/export/completion-audit.json", { headers });
  if (
    completionAudit.status !== 200 ||
    completionAudit.body.app !== "DJDI Golf Board" ||
    typeof completionAudit.body.ready !== "boolean" ||
    typeof completionAudit.body.appReady !== "boolean" ||
    typeof completionAudit.body.statusCounts.open !== "number" ||
    typeof completionAudit.body.appStatusCounts.open !== "number" ||
    !Array.isArray(completionAudit.body.items) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "score-rules" &&
        item.artifactUrls.includes("/api/export/scores.csv")
    ) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "docker-gate" &&
        item.artifactUrls.includes("/api/export/launch-checks.json") &&
        item.artifactUrls.includes("/api/export/launch-checks.csv")
    ) ||
    !completionAudit.body.items.some(
      (item) =>
        item.id === "source-search-ledger" &&
        item.readinessScope === "app" &&
        item.artifactUrls.includes("/api/export/source-search-ledger.json") &&
        item.artifactUrls.includes("/api/export/source-search-ledger.csv")
    )
  ) {
    throw new Error(
      `completion audit export check failed with HTTP ${completionAudit.status}`
    );
  }

  const completionAuditCsv = await fetchText("/api/export/completion-audit.csv", {
    headers,
  });
  if (
    completionAuditCsv.status !== 200 ||
    !completionAuditCsv.text.includes(
      "id,area,requirement,status,readiness_scope,proof_strength,evidence,next_action,artifact_urls"
    ) ||
    !completionAuditCsv.text.includes("score-rules,Scoring") ||
    !completionAuditCsv.text.includes(",app,derived,") ||
    !completionAuditCsv.text.includes("source-search-ledger,Evidence")
  ) {
    throw new Error(
      `completion audit CSV export check failed with HTTP ${completionAuditCsv.status}`
    );
  }

  const launchChecksExport = await fetchJson<{
    app: string;
    count: number;
    verifiedCount: number;
    openCount: number;
    records: Array<{ key: string; verified: boolean; source: string }>;
  }>("/api/export/launch-checks.json", { headers });
  if (
    launchChecksExport.status !== 200 ||
    launchChecksExport.body.app !== "DJDI Golf Board" ||
    launchChecksExport.body.count !== 4 ||
    typeof launchChecksExport.body.verifiedCount !== "number" ||
    typeof launchChecksExport.body.openCount !== "number" ||
    !launchChecksExport.body.records.some(
      (record) => record.key === "dockerBuildVerified"
    ) ||
    !launchChecksExport.body.records.some(
      (record) => record.key === "tailnetServeVerified"
    )
  ) {
    throw new Error(
      `launch checks export check failed with HTTP ${launchChecksExport.status}`
    );
  }

  const launchChecksCsv = await fetchText("/api/export/launch-checks.csv", {
    headers,
  });
  if (
    launchChecksCsv.status !== 200 ||
    !launchChecksCsv.text.includes(
      "key,label,verified,source,verified_at,verified_by,note,env_var,updated_at"
    ) ||
    !launchChecksCsv.text.includes("dockerBuildVerified,Docker image build") ||
    !launchChecksCsv.text.includes("tailnetServeVerified,Tailscale Funnel smoke")
  ) {
    throw new Error(
      `launch checks CSV export check failed with HTTP ${launchChecksCsv.status}`
    );
  }

  const launchGateChecklist = await fetchJson<{
    app: string;
    summary: { total: number; verified: number; open: number };
    items: Array<{ key: string; steps: Array<{ id: string }> }>;
  }>("/api/export/launch-gate-checklist.json", { headers });
  if (
    launchGateChecklist.status !== 200 ||
    launchGateChecklist.body.app !== "DJDI Golf Board" ||
    launchGateChecklist.body.summary.total !== 4 ||
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
      `launch gate checklist export check failed with HTTP ${launchGateChecklist.status}`
    );
  }

  const launchGateChecklistCsv = await fetchText(
    "/api/export/launch-gate-checklist.csv",
    { headers }
  );
  if (
    launchGateChecklistCsv.status !== 200 ||
    !launchGateChecklistCsv.text.includes(
      "key,label,status,source,verified_at,verified_by,note,env_var,step_count,steps,final_action"
    ) ||
    !launchGateChecklistCsv.text.includes(
      "tailnetServeVerified,Tailscale Funnel smoke"
    ) ||
    !launchGateChecklistCsv.text.includes(
      "productionUrlVerified,Production URL smoke"
    )
  ) {
    throw new Error(
      `launch gate checklist CSV export check failed with HTTP ${launchGateChecklistCsv.status}`
    );
  }

  const launchGateChecklistText = await fetchText(
    "/api/export/launch-gate-checklist.txt",
    { headers }
  );
  if (
    launchGateChecklistText.status !== 200 ||
    !launchGateChecklistText.text.includes("DJDI Launch Gate Checklist") ||
    !launchGateChecklistText.text.includes("physical-device golden path")
  ) {
    throw new Error(
      `launch gate checklist text export check failed with HTTP ${launchGateChecklistText.status}`
    );
  }

  const sourceSearchLedger = await fetchJson<{
    app: string;
    count: number;
    blockedSources: number;
    entries: Array<{ id: string; status: string }>;
  }>("/api/export/source-search-ledger.json", { headers });
  if (
    sourceSearchLedger.status !== 200 ||
    sourceSearchLedger.body.app !== "DJDI Golf Board" ||
    sourceSearchLedger.body.count < 7 ||
    sourceSearchLedger.body.blockedSources < 1 ||
    !sourceSearchLedger.body.entries.some(
      (entry) => entry.id === "messages-access-denied" && entry.status === "blocked"
    )
  ) {
    throw new Error(
      `source search ledger export check failed with HTTP ${sourceSearchLedger.status}`
    );
  }

  const sourceSearchLedgerCsv = await fetchText("/api/export/source-search-ledger.csv", {
    headers,
  });
  if (
    sourceSearchLedgerCsv.status !== 200 ||
    !sourceSearchLedgerCsv.text.includes(
      "id,area,claim_type,status,claim,source_checked,result,decision,evidence_ids,related_open_items"
    ) ||
    !sourceSearchLedgerCsv.text.includes("matt-buyin-venmo,Money,fact,recorded")
  ) {
    throw new Error(
      `source search ledger CSV export check failed with HTTP ${sourceSearchLedgerCsv.status}`
    );
  }

  const archive = await fetchJson<{
    app: string;
    snapshotHash: string;
    counts: {
      members: number;
      buyins: number;
      tournaments: number;
      closeoutItems: number;
      verificationRuns: number;
    };
    artifacts: Array<{ id: string; url: string }>;
    verificationRuns: unknown[];
    completionAudit: { ready: boolean; url: string };
    closeouts: Array<{ packetUrl: string; ledgerUrl: string }>;
    remainingRisks: Array<{ label: string }>;
  }>("/api/export/archive.json", { headers });
  if (
    archive.status !== 200 ||
    archive.body.app !== "DJDI Golf Board" ||
    !/^[a-f0-9]{64}$/.test(archive.body.snapshotHash) ||
    archive.body.counts.members !== 12 ||
    archive.body.counts.buyins < 12 ||
    archive.body.counts.tournaments < 9 ||
    archive.body.counts.closeoutItems < 7 ||
    typeof archive.body.counts.verificationRuns !== "number" ||
    !archive.body.artifacts.some((artifact) => artifact.id === "readiness-json") ||
    !archive.body.artifacts.some((artifact) => artifact.id === "rules-json") ||
    !archive.body.artifacts.some(
      (artifact) => artifact.id === "verification-runs-json"
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
      (artifact) => artifact.id === "completion-audit-json"
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
    !Array.isArray(archive.body.verificationRuns) ||
    !archive.body.closeouts.some(
      (closeout) =>
        closeout.packetUrl.startsWith("/api/export/closeout/") &&
        closeout.ledgerUrl.startsWith("/api/export/closeout/")
    ) ||
    !archive.body.remainingRisks.some((risk) => risk.label === "Buy-in tracking")
  ) {
    throw new Error(`archive manifest export check failed with HTTP ${archive.status}`);
  }

  const taskExport = await fetchJson<{
    app: string;
    count: number;
    copyPacket: string;
    requestPacket: string;
    tasks: Array<{ id: string; copyText: string | null }>;
  }>("/api/export/tasks.json", { headers });
  if (
    taskExport.status !== 200 ||
    taskExport.body.app !== "DJDI Golf Board" ||
    taskExport.body.count !== readiness.body.commissionerTasks.length ||
    !taskExport.body.copyPacket.includes("DJDI commissioner tasks:") ||
    !taskExport.body.requestPacket.includes("DJDI request packet") ||
    !taskExport.body.requestPacket.includes("DJDI buy-in status tracker") ||
    !taskExport.body.requestPacket.includes("DJDI handicap records still needed") ||
    !taskExport.body.tasks.some(
      (task) =>
        task.id === "collect-ghin-indexes" &&
        task.copyText?.includes("DJDI handicap records still needed")
    )
  ) {
    throw new Error(`task JSON export check failed with HTTP ${taskExport.status}`);
  }

  const taskExportCsv = await fetchText("/api/export/tasks.csv", { headers });
  if (
    taskExportCsv.status !== 200 ||
    !taskExportCsv.text.includes(
      "id,area,severity,title,detail,next_action,items,copy_text,done"
    ) ||
    !taskExportCsv.text.includes("collect-ghin-indexes,roster,risk")
  ) {
    throw new Error(`task CSV export check failed with HTTP ${taskExportCsv.status}`);
  }

  const riskExport = await fetchJson<{
    app: string;
    count: number;
    severityCounts: { risk: number; external: number };
    risks: Array<{ id: string; label: string; severity: string }>;
  }>("/api/export/risks.json", { headers });
  if (
    riskExport.status !== 200 ||
    riskExport.body.app !== "DJDI Golf Board" ||
    riskExport.body.count !== readiness.body.launchRisks.length ||
    riskExport.body.severityCounts.risk < 1 ||
    riskExport.body.severityCounts.external < 1 ||
    !riskExport.body.risks.some((risk) => risk.id === "money-collection") ||
    riskExport.body.risks.some((risk) => risk.id === "production-url")
  ) {
    throw new Error(`risk JSON export check failed with HTTP ${riskExport.status}`);
  }

  const riskExportCsv = await fetchText("/api/export/risks.csv", { headers });
  if (
    riskExportCsv.status !== 200 ||
    !riskExportCsv.text.includes("id,severity,label,detail,next_action") ||
    !riskExportCsv.text.includes("money-collection,risk,Buy-in tracking") ||
    riskExportCsv.text.includes("production-url,external")
  ) {
    throw new Error(`risk CSV export check failed with HTTP ${riskExportCsv.status}`);
  }

  const requestPacket = await fetchText("/api/export/request-packet.txt", {
    headers,
  });
  if (
    requestPacket.status !== 200 ||
    !requestPacket.text.includes("DJDI request packet") ||
    !requestPacket.text.includes("DJDI buy-in status tracker") ||
    !requestPacket.text.includes("DJDI handicap records still needed")
  ) {
    throw new Error(
      `request packet export check failed with HTTP ${requestPacket.status}`
    );
  }

  const blockerHandoff = await fetchJson<{
    app: string;
    summary: { taskCount: number; manualActionRequired: number };
    rows: Array<{ taskId: string; evidenceStatus: string }>;
  }>("/api/export/blocker-handoff.json", { headers });
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
      `blocker handoff export check failed with HTTP ${blockerHandoff.status}`
    );
  }

  const blockerHandoffText = await fetchText("/api/export/blocker-handoff.txt", {
    headers,
  });
  if (
    blockerHandoffText.status !== 200 ||
    !blockerHandoffText.text.includes("DJDI Commissioner Handoff") ||
    !blockerHandoffText.text.includes("Evidence: blocked_source")
  ) {
    throw new Error(
      `blocker handoff text export check failed with HTTP ${blockerHandoffText.status}`
    );
  }

  const evidenceGapPacket = await fetchJson<{
    app: string;
    summary: { total: number; onePasteReady: number; launchVerification: number };
    items: Array<{ blockerId: string; intakePath: string }>;
  }>("/api/export/evidence-gap-packet.json", { headers });
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
      `evidence gap packet JSON export check failed with HTTP ${evidenceGapPacket.status}`
    );
  }

  const evidenceGapPacketCsv = await fetchText("/api/export/evidence-gap-packet.csv", {
    headers,
  });
  if (
    evidenceGapPacketCsv.status !== 200 ||
    !evidenceGapPacketCsv.text.includes(
      "id,area,blocker_id,label,owner,requested_evidence,paste_back_template,intake_path,source_status,source_decision,related_task_id"
    ) ||
    !evidenceGapPacketCsv.text.includes("money-collected")
  ) {
    throw new Error(
      `evidence gap packet CSV export check failed with HTTP ${evidenceGapPacketCsv.status}`
    );
  }

  const evidenceGapPacketText = await fetchText("/api/export/evidence-gap-packet.txt", {
    headers,
  });
  if (
    evidenceGapPacketText.status !== 200 ||
    !evidenceGapPacketText.text.includes("DJDI Evidence Gap Packet") ||
    !evidenceGapPacketText.text.includes("Paste back:")
  ) {
    throw new Error(
      `evidence gap packet text export check failed with HTTP ${evidenceGapPacketText.status}`
    );
  }

  const summary = await fetchText("/api/export/summary.txt", { headers });
  if (
    summary.status !== 200 ||
    !summary.text.includes("DJDI Golf Board Season Summary") ||
    !summary.text.includes("League Checklist")
  ) {
    throw new Error(`summary export check failed with HTTP ${summary.status}`);
  }

  const buyinsCsv = await fetchText("/api/export/buyins.csv", { headers });
  if (
    buyinsCsv.status !== 200 ||
    !buyinsCsv.text.includes("player_name,amount,payment_status,paid") ||
    !buyinsCsv.text.includes("Jayson Post,325")
  ) {
    throw new Error(`buy-ins CSV export check failed with HTTP ${buyinsCsv.status}`);
  }

  const rosterCsv = await fetchText("/api/export/roster.csv", { headers });
  if (
    rosterCsv.status !== 200 ||
    !rosterCsv.text.includes("name,member,ghin_number,handicap_index") ||
    !rosterCsv.text.includes("Jayson Post,yes,,10.6")
  ) {
    throw new Error(`roster CSV export check failed with HTTP ${rosterCsv.status}`);
  }

  const scoresCsv = await fetchText("/api/export/scores.csv", { headers });
  if (
    scoresCsv.status !== 200 ||
    !scoresCsv.text.includes(
      "tournament,tee_time_id,date,time,course,host,player,gross,round_course,round_date,tee_name,tee_rating,tee_slope,tee_par,handicap_index_used,calculated_course_hcp,course_hcp_rounded,course_hcp"
    )
  ) {
    throw new Error(`scores CSV export check failed with HTTP ${scoresCsv.status}`);
  }

  const payoutsCsv = await fetchText("/api/export/payouts.csv", { headers });
  if (
    payoutsCsv.status !== 200 ||
    !payoutsCsv.text.includes(
      "rules_version,tournament_id,tournament,type,closed,closed_at,closed_by,winner,winner_net"
    ) ||
    !payoutsCsv.text.includes("2026-w1,Stop 1")
  ) {
    throw new Error(`payouts CSV export check failed with HTTP ${payoutsCsv.status}`);
  }

  const launchPacket = await fetchText("/api/export/launch-packet.txt", {
    headers,
  });
  if (
    launchPacket.status !== 200 ||
    !launchPacket.text.includes("DJDI Launch Packet") ||
    !launchPacket.text.includes("Copy/Paste Asks") ||
    !launchPacket.text.includes("Commissioner Tasks") ||
    !launchPacket.text.includes("Outbound Request Packet") ||
    !launchPacket.text.includes("League Checklist") ||
    !launchPacket.text.includes("Source Search Coverage") ||
    !launchPacket.text.includes("/api/export/rules.json") ||
    !launchPacket.text.includes("/api/export/request-packet.txt") ||
    !launchPacket.text.includes("/api/export/blocker-handoff.json") ||
    !launchPacket.text.includes("/api/export/blocker-handoff.txt") ||
    !launchPacket.text.includes("/api/export/evidence-gap-packet.json") ||
    !launchPacket.text.includes("/api/export/evidence-gap-packet.csv") ||
    !launchPacket.text.includes("/api/export/evidence-gap-packet.txt") ||
    !launchPacket.text.includes("/api/export/source-search-ledger.json") ||
    !launchPacket.text.includes("/api/export/source-search-ledger.csv") ||
    !launchPacket.text.includes("/api/export/risks.json") ||
    !launchPacket.text.includes("/api/export/risks.csv") ||
    !launchPacket.text.includes("/api/export/launch-checks.json") ||
    !launchPacket.text.includes("/api/export/launch-checks.csv") ||
    !launchPacket.text.includes("/api/export/launch-gate-checklist.json") ||
    !launchPacket.text.includes("/api/export/launch-gate-checklist.csv") ||
    !launchPacket.text.includes("/api/export/launch-gate-checklist.txt")
  ) {
    throw new Error(
      `launch packet export check failed with HTTP ${launchPacket.status}`
    );
  }

  const verificationRun = await fetchJson<{
    verificationRun?: { id?: string; status?: string };
    error?: string;
  }>("/api/verification-runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify({
      command: "npm run verify:remote-smoke",
      status: "passed",
      scope: [
        "remote access gate",
        "remote commissioner gate",
        "remote health",
        "remote exports",
        "remote launch packet",
      ],
      summary:
        "Remote smoke verifier passed the live private URL access, commissioner, health, export, completion audit, and launch packet checks.",
      recordedBy: "Remote Smoke",
      metadata: {
        url: baseUrl,
        apiBaseUrl,
        appMountPath: appMountPath || "/",
      },
    }),
  });
  if (
    verificationRun.status !== 201 ||
    verificationRun.body.verificationRun?.status !== "passed"
  ) {
    throw new Error(
      verificationRun.body.error ||
        `verification-run recording failed with HTTP ${verificationRun.status}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: baseUrl,
        accessGate,
        commissionerGate,
        client: "verified",
        health: "verified",
        tournaments: tournaments.body.tournaments.length,
        seasonExport: "verified",
        readinessExport: "verified",
        closeoutExports: "verified",
        auditExport: "verified",
        verificationExport: "verified",
        completionAudit: "verified",
        archiveExport: "verified",
        taskExport: "verified",
        summaryExport: "verified",
        csvExports: "verified",
        launchPacketExport: "verified",
        verificationRun: verificationRun.body.verificationRun.id,
        launchChecks: accessBefore.body.launchChecks ?? {},
        nextFlag:
          "Set DJDI_TAILNET_URL_VERIFIED=1 after this passes against the private Tailscale URL. Set DJDI_PRODUCTION_URL_VERIFIED=1 only when DJDI_REQUIRE_PRODUCTION_URL=1.",
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Remote smoke verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
