import { execFileSync, spawnSync } from "node:child_process";

const imageTag = process.env.DOCKER_VERIFY_IMAGE ?? "djdi-golf-board:codex-smoke";
const accessCode =
  process.env.DOCKER_VERIFY_ACCESS_CODE ??
  `docker-smoke-${process.pid}-${Date.now()}`;
const commissionerCode =
  process.env.DOCKER_VERIFY_COMMISSIONER_CODE ??
  `docker-smoke-admin-${process.pid}-${Date.now()}`;
const dbPath = process.env.DOCKER_VERIFY_DB_PATH ?? "/tmp/djdi-docker-smoke.db";

function run(
  command: string,
  args: string[],
  options: { quiet?: boolean } = {}
): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDX_GIT_INFO: process.env.BUILDX_GIT_INFO ?? "false",
      BUILDX_GIT_CHECK_DIRTY: process.env.BUILDX_GIT_CHECK_DIRTY ?? "false",
    },
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${
        stderr ? `: ${stderr}` : ""
      }`
    );
  }
  return result.stdout?.trim() ?? "";
}

function dockerOutput(args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function stopContainer(containerId: string) {
  if (!containerId) return;
  spawnSync("docker", ["stop", containerId], { stdio: "ignore" });
}

async function waitForClient(containerId: string, port: string) {
  let lastError = "";
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const running = run(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", containerId],
      { quiet: true }
    );
    if (running !== "true") {
      throw new Error("container exited before smoke checks completed");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const html = await response.text();
      if (response.status === 200 && html.includes("DJDI Golf Board")) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`container client did not become ready: ${lastError}`);
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

let containerId = "";

try {
  run("docker", ["build", "-t", imageTag, "."]);
  containerId = run(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "-e",
      "HOST=0.0.0.0",
      "-e",
      `ACCESS_CODE=${accessCode}`,
      "-e",
      `COMMISSIONER_CODE=${commissionerCode}`,
      "-e",
      `DB_PATH=${dbPath}`,
      "-p",
      "127.0.0.1::3000",
      imageTag,
    ],
    { quiet: true }
  );
  const portLine = dockerOutput(["port", containerId, "3000/tcp"]);
  const port = portLine.split(":").pop();
  if (!port) throw new Error("could not determine mapped container port");

  await waitForClient(containerId, port);

  const unauthenticated = await fetchJson<{ error: string }>(
    `http://127.0.0.1:${port}/api/tournaments`
  );
  if (unauthenticated.status !== 401) {
    throw new Error(
      `protected API did not reject unauthenticated request: HTTP ${unauthenticated.status}`
    );
  }

  const unlock = await fetchJson<{ ok: boolean }>(
    `http://127.0.0.1:${port}/api/access`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: accessCode }),
    }
  );
  const setCookie = unlock.headers.get("set-cookie");
  if (unlock.status !== 200 || !unlock.body.ok || !setCookie) {
    throw new Error(`container access unlock failed with HTTP ${unlock.status}`);
  }
  const cookie = setCookie.split(";")[0];

  const commissionerUnlock = await fetchJson<{ ok: boolean }>(
    `http://127.0.0.1:${port}/api/commissioner`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
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
      `container commissioner unlock failed with HTTP ${commissionerUnlock.status}`
    );
  }
  const commissionerCookie = commissionerSetCookie.split(";")[0];
  const adminCookie = `${cookie}; ${commissionerCookie}`;

  const tournaments = await fetchJson<{
    tournaments: Array<{ id: string; name: string }>;
  }>(`http://127.0.0.1:${port}/api/tournaments`, {
    headers: { Cookie: cookie },
  });
  if (
    tournaments.status !== 200 ||
    !tournaments.body.tournaments.some((tournament) => tournament.id === "2026-w1")
  ) {
    throw new Error(
      `container tournaments check failed with HTTP ${tournaments.status}`
    );
  }

  const teeTime = await fetchJson<{ teeTime: { id: string } }>(
    `http://127.0.0.1:${port}/api/teetimes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        course: "Common Ground",
        date: "2026-05-19",
        time: "10:11",
        spots: 4,
        host: "Jayson Post",
        notes: `docker-smoke-${process.pid}`,
      }),
    }
  );
  if (teeTime.status !== 201) {
    throw new Error(`container tee-time create failed with HTTP ${teeTime.status}`);
  }

  const attesterProfile = await fetchJson<{ ok: boolean; name: string }>(
    `http://127.0.0.1:${port}/api/profile`,
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
    throw new Error(
      `container attester profile failed with HTTP ${attesterProfile.status}`
    );
  }

  const attesterClaim = await fetchJson<{ teeTime: { id: string } }>(
    `http://127.0.0.1:${port}/api/teetimes/${teeTime.body.teeTime.id}/claims`,
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
    throw new Error(
      `container attester claim failed with HTTP ${attesterClaim.status}`
    );
  }

  const score = await fetchJson<{ teeTime: { id: string } }>(
    `http://127.0.0.1:${port}/api/teetimes/${teeTime.body.teeTime.id}/scores`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
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
    throw new Error(`container score creation failed with HTTP ${score.status}`);
  }

  const attestedScore = await fetchJson<{ teeTime: { id: string } }>(
    `http://127.0.0.1:${port}/api/teetimes/${
      teeTime.body.teeTime.id
    }/scores/${encodeURIComponent("Jayson Post")}/attest`,
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
    throw new Error(
      `container score attestation failed with HTTP ${attestedScore.status}`
    );
  }

  const launchCheck = await fetchJson<{
    launchChecks: { dockerBuildVerified: boolean };
    records: Array<{ key: string; verified: boolean; source: string }>;
  }>(`http://127.0.0.1:${port}/api/launch-checks/dockerBuildVerified`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({
      verified: true,
      verifiedBy: "Docker Smoke",
      note: "verify:docker temporary container check",
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
    throw new Error(
      `container launch-check update failed with HTTP ${launchCheck.status}`
    );
  }

  const summary = await fetch(`http://127.0.0.1:${port}/api/export/summary.txt`, {
    headers: { Cookie: adminCookie },
  });
  const summaryText = await summary.text();
  if (summary.status !== 200 || !summaryText.includes("League Checklist")) {
    throw new Error(`container summary check failed with HTTP ${summary.status}`);
  }

  const buyinsCsv = await fetch(`http://127.0.0.1:${port}/api/export/buyins.csv`, {
    headers: { Cookie: adminCookie },
  });
  const buyinsCsvText = await buyinsCsv.text();
  if (
    buyinsCsv.status !== 200 ||
    !buyinsCsvText.includes("player_name,amount,payment_status,paid") ||
    !buyinsCsvText.includes("Jayson Post,325,unpaid,no")
  ) {
    throw new Error(`container buy-ins CSV check failed with HTTP ${buyinsCsv.status}`);
  }

  const rosterCsv = await fetch(`http://127.0.0.1:${port}/api/export/roster.csv`, {
    headers: { Cookie: adminCookie },
  });
  const rosterCsvText = await rosterCsv.text();
  if (
    rosterCsv.status !== 200 ||
    !rosterCsvText.includes("name,member,ghin_number,handicap_index") ||
    !rosterCsvText.includes("Jayson Post,yes,,10.6")
  ) {
    throw new Error(`container roster CSV check failed with HTTP ${rosterCsv.status}`);
  }

  const scoresCsv = await fetch(`http://127.0.0.1:${port}/api/export/scores.csv`, {
    headers: { Cookie: adminCookie },
  });
  const scoresCsvText = await scoresCsv.text();
  if (
    scoresCsv.status !== 200 ||
    !scoresCsvText.includes(
      "tournament,tee_time_id,date,time,course,host,player,gross,round_course,round_date,tee_name,tee_rating,tee_slope,tee_par,handicap_index_used,calculated_course_hcp,course_hcp_rounded,course_hcp"
    )
  ) {
    throw new Error(`container scores CSV check failed with HTTP ${scoresCsv.status}`);
  }

  const payoutsCsv = await fetch(`http://127.0.0.1:${port}/api/export/payouts.csv`, {
    headers: { Cookie: adminCookie },
  });
  const payoutsCsvText = await payoutsCsv.text();
  if (
    payoutsCsv.status !== 200 ||
    !payoutsCsvText.includes(
      "rules_version,tournament_id,tournament,type,closed,closed_at,closed_by,winner,winner_net"
    ) ||
    !payoutsCsvText.includes("2026-w1,Stop 1")
  ) {
    throw new Error(`container payouts CSV check failed with HTTP ${payoutsCsv.status}`);
  }

  const readiness = await fetchJson<{
    app: string;
    counts: { members: number; buyins: number; tournaments: number };
    money: { expected: number };
    missingHandicaps: string[];
    unconfirmedEvents: string[];
    activeStop: { leaderboard: unknown[] } | null;
    closeoutReadiness: Array<{ packetUrl: string; ledgerUrl: string }>;
    launchCheckEvidence: Array<{ key: string; verified: boolean; source: string }>;
    launchRisks: Array<{ label: string }>;
    commissionerTasks: Array<{ id: string; copyText: string | null }>;
  }>(`http://127.0.0.1:${port}/api/export/readiness.json`, {
    headers: { Cookie: adminCookie },
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
    throw new Error(`container readiness export failed with HTTP ${readiness.status}`);
  }

  const closeoutPacket = await fetch(
    `http://127.0.0.1:${port}${readiness.body.closeoutReadiness[0].packetUrl}`,
    { headers: { Cookie: adminCookie } }
  );
  const closeoutPacketText = await closeoutPacket.text();
  if (
    closeoutPacket.status !== 200 ||
    !closeoutPacketText.includes("DJDI Tournament Closeout Packet") ||
    !closeoutPacketText.includes("Score Evidence") ||
    (!closeoutPacketText.includes("official:") &&
      !closeoutPacketText.includes("not official:"))
  ) {
    throw new Error(
      `container closeout packet check failed with HTTP ${closeoutPacket.status}`
    );
  }

  const closeoutLedger = await fetchJson<{
    app: string;
    tournament: { id: string };
    integrity: { scoreEvidenceRows: number };
    scoreEvidence: unknown[];
  }>(`http://127.0.0.1:${port}${readiness.body.closeoutReadiness[0].ledgerUrl}`, {
    headers: { Cookie: adminCookie },
  });
  if (
    closeoutLedger.status !== 200 ||
    closeoutLedger.body.app !== "DJDI Golf Board" ||
    !closeoutLedger.body.tournament.id ||
    !Array.isArray(closeoutLedger.body.scoreEvidence) ||
    closeoutLedger.body.integrity.scoreEvidenceRows !==
      closeoutLedger.body.scoreEvidence.length ||
    !hasAttestationProof(closeoutLedger.body.scoreEvidence)
  ) {
    throw new Error(
      `container closeout ledger check failed with HTTP ${closeoutLedger.status}`
    );
  }

  const auditJson = await fetchJson<{
    app: string;
    count: number;
    events: Array<{ action: string }>;
  }>(`http://127.0.0.1:${port}/api/export/audit.json`, {
    headers: { Cookie: adminCookie },
  });
  if (
    auditJson.status !== 200 ||
    auditJson.body.app !== "DJDI Golf Board" ||
    auditJson.body.count < 1 ||
    !auditJson.body.events.some(
      (event) => event.action === "launch_check_update"
    )
  ) {
    throw new Error(`container audit JSON check failed with HTTP ${auditJson.status}`);
  }

  const auditCsv = await fetch(`http://127.0.0.1:${port}/api/export/audit.csv`, {
    headers: { Cookie: adminCookie },
  });
  const auditCsvText = await auditCsv.text();
  if (
    auditCsv.status !== 200 ||
    !auditCsvText.includes("created_at,action,actor,subject_type,subject_id,summary") ||
    !auditCsvText.includes("launch_check_update")
  ) {
    throw new Error(`container audit CSV check failed with HTTP ${auditCsv.status}`);
  }

  const recordedVerification = await fetchJson<{
    verificationRun: { id: string; status: string };
  }>(`http://127.0.0.1:${port}/api/verification-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({
      command: "npm run verify:docker",
      status: "passed",
      scope: ["docker image", "access gate", "exports", "archive manifest"],
      summary: "Docker verifier passed against a temporary container.",
      recordedBy: "Docker Smoke",
      metadata: {
        image: imageTag,
        container: containerId,
        url: `http://127.0.0.1:${port}`,
      },
    }),
  });
  if (
    recordedVerification.status !== 201 ||
    recordedVerification.body.verificationRun.status !== "passed"
  ) {
    throw new Error(
      `container verification run record failed with HTTP ${recordedVerification.status}`
    );
  }

  const verificationJson = await fetchJson<{
    app: string;
    count: number;
    verificationRuns: Array<{ id: string; command: string; status: string }>;
  }>(`http://127.0.0.1:${port}/api/export/verification-runs.json`, {
    headers: { Cookie: adminCookie },
  });
  if (
    verificationJson.status !== 200 ||
    verificationJson.body.app !== "DJDI Golf Board" ||
    verificationJson.body.count < 1 ||
    !verificationJson.body.verificationRuns.some(
      (run) =>
        run.id === recordedVerification.body.verificationRun.id &&
        run.command === "npm run verify:docker" &&
        run.status === "passed"
    )
  ) {
    throw new Error(
      `container verification JSON check failed with HTTP ${verificationJson.status}`
    );
  }

  const verificationCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/verification-runs.csv`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const verificationCsvText = await verificationCsv.text();
  if (
    verificationCsv.status !== 200 ||
    !verificationCsvText.includes(
      "created_at,command,status,recorded_by,scope,summary"
    ) ||
    !verificationCsvText.includes("npm run verify:docker")
  ) {
    throw new Error(
      `container verification CSV check failed with HTTP ${verificationCsv.status}`
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
  }>(`http://127.0.0.1:${port}/api/export/completion-audit.json`, {
    headers: { Cookie: adminCookie },
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
      `container completion audit check failed with HTTP ${completionAudit.status}`
    );
  }

  const completionAuditCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/completion-audit.csv`,
    {
      headers: { Cookie: adminCookie },
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
      `container completion audit CSV check failed with HTTP ${completionAuditCsv.status}`
    );
  }

  const launchChecksExport = await fetchJson<{
    app: string;
    count: number;
    verifiedCount: number;
    openCount: number;
    records: Array<{ key: string; verified: boolean; source: string }>;
  }>(`http://127.0.0.1:${port}/api/export/launch-checks.json`, {
    headers: { Cookie: adminCookie },
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
      `container launch checks export failed with HTTP ${launchChecksExport.status}`
    );
  }

  const launchChecksCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/launch-checks.csv`,
    {
      headers: { Cookie: adminCookie },
    }
  );
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
      `container launch checks CSV export failed with HTTP ${launchChecksCsv.status}`
    );
  }

  const launchGateChecklist = await fetchJson<{
    app: string;
    summary: { total: number; verified: number; open: number };
    items: Array<{ key: string; steps: Array<{ id: string }> }>;
  }>(`http://127.0.0.1:${port}/api/export/launch-gate-checklist.json`, {
    headers: { Cookie: adminCookie },
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
      `container launch gate checklist export failed with HTTP ${launchGateChecklist.status}`
    );
  }

  const launchGateChecklistCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/launch-gate-checklist.csv`,
    {
      headers: { Cookie: adminCookie },
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
      `container launch gate checklist CSV export failed with HTTP ${launchGateChecklistCsv.status}`
    );
  }

  const launchGateChecklistText = await fetch(
    `http://127.0.0.1:${port}/api/export/launch-gate-checklist.txt`,
    {
      headers: { Cookie: adminCookie },
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
      `container launch gate checklist text export failed with HTTP ${launchGateChecklistText.status}`
    );
  }

  const sourceSearchLedger = await fetchJson<{
    app: string;
    count: number;
    recordedFacts: number;
    noSourceFound: number;
    blockedSources: number;
    entries: Array<{ id: string; status: string }>;
  }>(`http://127.0.0.1:${port}/api/export/source-search-ledger.json`, {
    headers: { Cookie: adminCookie },
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
      `container source search ledger export failed with HTTP ${sourceSearchLedger.status}`
    );
  }

  const sourceSearchLedgerCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/source-search-ledger.csv`,
    {
      headers: { Cookie: adminCookie },
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
      `container source search ledger CSV export failed with HTTP ${sourceSearchLedgerCsv.status}`
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
  }>(`http://127.0.0.1:${port}/api/export/archive.json`, {
    headers: { Cookie: adminCookie },
  });
  if (
    archive.status !== 200 ||
    archive.body.app !== "DJDI Golf Board" ||
    !/^[a-f0-9]{64}$/.test(archive.body.snapshotHash) ||
    archive.body.counts.members !== 12 ||
    archive.body.counts.buyins < 12 ||
    archive.body.counts.tournaments < 9 ||
    archive.body.counts.auditEvents < 1 ||
    archive.body.counts.verificationRuns < 1 ||
    !archive.body.artifacts.some((artifact) => artifact.id === "audit-json") ||
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
    throw new Error(
      `container archive manifest check failed with HTTP ${archive.status}`
    );
  }

  const taskExport = await fetch(
    `http://127.0.0.1:${port}/api/export/tasks.json`,
    {
      headers: { Cookie: adminCookie },
    }
  );
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
    throw new Error(`container task export failed with HTTP ${taskExport.status}`);
  }

  const taskExportCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/tasks.csv`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const taskExportCsvText = await taskExportCsv.text();
  if (
    taskExportCsv.status !== 200 ||
    !taskExportCsvText.includes(
      "id,area,severity,title,detail,next_action,items,copy_text,done"
    ) ||
    !taskExportCsvText.includes("collect-ghin-indexes,roster,risk")
  ) {
    throw new Error(`container task CSV export failed with HTTP ${taskExportCsv.status}`);
  }

  const riskExport = await fetchJson<{
    app: string;
    count: number;
    severityCounts: { risk: number; external: number };
    risks: Array<{ id: string; label: string; severity: string }>;
  }>(`http://127.0.0.1:${port}/api/export/risks.json`, {
    headers: { Cookie: adminCookie },
  });
  if (
    riskExport.status !== 200 ||
    riskExport.body.app !== "DJDI Golf Board" ||
    riskExport.body.count !== readiness.body.launchRisks.length ||
    riskExport.body.severityCounts.risk < 1 ||
    riskExport.body.severityCounts.external < 1 ||
    !riskExport.body.risks.some((risk) => risk.id === "money-collection") ||
    riskExport.body.risks.some((risk) => risk.id === "production-url")
  ) {
    throw new Error(`container risk JSON export failed with HTTP ${riskExport.status}`);
  }

  const riskExportCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/risks.csv`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const riskExportCsvText = await riskExportCsv.text();
  if (
    riskExportCsv.status !== 200 ||
    !riskExportCsvText.includes("id,severity,label,detail,next_action") ||
    !riskExportCsvText.includes("money-collection,risk,Buy-in tracking") ||
    riskExportCsvText.includes("production-url,external")
  ) {
    throw new Error(`container risk CSV export failed with HTTP ${riskExportCsv.status}`);
  }

  const requestPacket = await fetch(
    `http://127.0.0.1:${port}/api/export/request-packet.txt`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const requestPacketText = await requestPacket.text();
  if (
    requestPacket.status !== 200 ||
    !requestPacketText.includes("DJDI request packet") ||
    !requestPacketText.includes("DJDI buy-in status tracker") ||
    !requestPacketText.includes("DJDI handicap records still needed")
  ) {
    throw new Error(
      `container request packet export failed with HTTP ${requestPacket.status}`
    );
  }

  const blockerHandoff = await fetchJson<{
    app: string;
    summary: { taskCount: number; manualActionRequired: number };
    rows: Array<{ taskId: string; evidenceStatus: string }>;
  }>(`http://127.0.0.1:${port}/api/export/blocker-handoff.json`, {
    headers: { Cookie: adminCookie },
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
      `container blocker handoff export failed with HTTP ${blockerHandoff.status}`
    );
  }

  const blockerHandoffText = await fetch(
    `http://127.0.0.1:${port}/api/export/blocker-handoff.txt`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const blockerHandoffTextBody = await blockerHandoffText.text();
  if (
    blockerHandoffText.status !== 200 ||
    !blockerHandoffTextBody.includes("DJDI Commissioner Handoff") ||
    !blockerHandoffTextBody.includes("Evidence: blocked_source")
  ) {
    throw new Error(
      `container blocker handoff text export failed with HTTP ${blockerHandoffText.status}`
    );
  }

  const evidenceGapPacket = await fetchJson<{
    app: string;
    summary: { total: number; onePasteReady: number; launchVerification: number };
    items: Array<{ blockerId: string; intakePath: string }>;
  }>(`http://127.0.0.1:${port}/api/export/evidence-gap-packet.json`, {
    headers: { Cookie: adminCookie },
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
      `container evidence gap packet JSON export failed with HTTP ${evidenceGapPacket.status}`
    );
  }

  const evidenceGapPacketCsv = await fetch(
    `http://127.0.0.1:${port}/api/export/evidence-gap-packet.csv`,
    {
      headers: { Cookie: adminCookie },
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
      `container evidence gap packet CSV export failed with HTTP ${evidenceGapPacketCsv.status}`
    );
  }

  const evidenceGapPacketText = await fetch(
    `http://127.0.0.1:${port}/api/export/evidence-gap-packet.txt`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const evidenceGapPacketTextBody = await evidenceGapPacketText.text();
  if (
    evidenceGapPacketText.status !== 200 ||
    !evidenceGapPacketTextBody.includes("DJDI Evidence Gap Packet") ||
    !evidenceGapPacketTextBody.includes("Paste back:")
  ) {
    throw new Error(
      `container evidence gap packet text export failed with HTTP ${evidenceGapPacketText.status}`
    );
  }

  const launchPacket = await fetch(
    `http://127.0.0.1:${port}/api/export/launch-packet.txt`,
    {
      headers: { Cookie: adminCookie },
    }
  );
  const launchPacketText = await launchPacket.text();
  if (
    launchPacket.status !== 200 ||
    !launchPacketText.includes("DJDI Launch Packet") ||
    !launchPacketText.includes("Copy/Paste Asks") ||
    !launchPacketText.includes("Commissioner Tasks") ||
    !launchPacketText.includes("Outbound Request Packet") ||
    !launchPacketText.includes("Source Search Coverage") ||
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
      `container launch packet check failed with HTTP ${launchPacket.status}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        image: imageTag,
        container: containerId,
        url: `http://127.0.0.1:${port}`,
        accessGate: "verified",
        commissionerGate: "verified",
        builtClient: "verified",
        tournaments: tournaments.body.tournaments.length,
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
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Docker verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  stopContainer(containerId);
}
