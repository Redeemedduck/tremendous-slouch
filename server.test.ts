import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, createDb } from "./server";
import { ACTIVE_RULES_VERSION } from "./src/lib/leagueRules";

const dbFiles: string[] = [];
const dbHandles: Array<ReturnType<typeof createDb>> = [];
const isolatedEnvKeys = [
  "ACCESS_CODE",
  "COMMISSIONER_CODE",
  "DJDI_DOCKER_BUILD_VERIFIED",
  "DJDI_TAILNET_URL_VERIFIED",
  "DJDI_PRODUCTION_URL_VERIFIED",
  "DJDI_MOBILE_SAFARI_VERIFIED",
  "DJDI_TODAY",
  "LIVE_STATE_TODAY",
  "STATIC_DIR",
  "COOKIE_SECURE",
] as const;
const originalRuntimeEnv = new Map(
  isolatedEnvKeys.map((key) => [key, process.env[key]])
);
const profileCookies = new WeakMap<
  ReturnType<typeof createApp>,
  Map<string, string | string[]>
>();
const testWorkDir = path.resolve(".build-work", "test");

function ensureTestWorkDir(...parts: string[]) {
  const dir = path.join(testWorkDir, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function clearRuntimeEnv() {
  for (const key of isolatedEnvKeys) delete process.env[key];
}

clearRuntimeEnv();

beforeEach(() => {
  clearRuntimeEnv();
});

function tempDbPath() {
  const file = path.join(
    ensureTestWorkDir("db"),
    `djdi-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`
  );
  dbFiles.push(file);
  return file;
}

afterEach(() => {
  clearRuntimeEnv();
  for (const db of dbHandles.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed by the test body.
    }
  }
  for (const file of dbFiles.splice(0)) {
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
    }
  }
});

afterAll(() => {
  for (const key of isolatedEnvKeys) {
    const value = originalRuntimeEnv.get(key);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

function createTestDb() {
  const db = createDb(tempDbPath());
  dbHandles.push(db);
  return db;
}

async function createMember(
  app: ReturnType<typeof createApp>,
  name: string,
  member = true
) {
  const admin = await commissionerAgent(app);
  const response = await admin
    .put(`/api/players/${encodeURIComponent(name)}`)
    .send({ handicap: 10, member });
  expect(
    response.status,
    `createMember(${name}) failed: ${JSON.stringify(response.body)}`
  ).toBe(200);
}

async function commissionerAgent(
  app: ReturnType<typeof createApp>,
  code = "commissioner-test"
) {
  process.env.COMMISSIONER_CODE = code;
  const agent = request.agent(app);
  if (process.env.ACCESS_CODE) {
    await agent
      .post("/api/access")
      .send({ code: process.env.ACCESS_CODE })
      .expect(200);
  }
  await agent
    .post("/api/commissioner")
    .send({ code: process.env.COMMISSIONER_CODE })
    .expect(200);
  return agent;
}

async function createRegularTeeTime(
  app: ReturnType<typeof createApp>,
  host = "Greg"
) {
  const hostCookie = await profileCookie(app, host);
  const tournaments = await request(app).get("/api/tournaments").expect(200);
  const regular = tournaments.body.tournaments.find((t: any) => t.id === "2026-w2");
  expect(regular).toBeTruthy();
  const created = await request(app)
    .post("/api/teetimes")
    .set("Cookie", hostCookie)
    .send({
      course: regular.course,
      date: regular.windowStart,
      time: "09:00",
      spots: 4,
      host,
      notes: "test regular tee time",
    })
    .expect(201);

  return created.body.teeTime;
}

async function profileCookie(app: ReturnType<typeof createApp>, name: string) {
  const key = name.trim().toLowerCase();
  let appCookies = profileCookies.get(app);
  if (!appCookies) {
    appCookies = new Map();
    profileCookies.set(app, appCookies);
  }
  const existing = appCookies.get(key);
  if (existing) return existing;
  const res = await request(app)
    .post("/api/profile")
    .send({ name })
    .expect(200);
  const cookie = res.headers["set-cookie"];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  appCookies.set(key, value);
  return value;
}

async function freshProfileCookie(app: ReturnType<typeof createApp>, name: string) {
  const res = await request(app)
    .post("/api/profile")
    .send({ name })
    .expect(200);
  const cookie = res.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

function expectCsvFormulaSafe(text: string) {
  for (const row of parseCsv(text)) {
    for (const cell of row) {
      expect(cell, `unsafe CSV cell: ${cell}`).not.toMatch(/^\s*[=+\-@]/);
    }
  }
}

const sensitiveCommissionerRequests: Array<{
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { method: "get", path: "/api/buyins" },
  { method: "patch", path: "/api/buyins/Beck", body: { paymentStatus: "paid" } },
  { method: "put", path: "/api/players/Beck", body: { handicap: 10.1 } },
  { method: "post", path: "/api/admin/blocker-intake", body: { text: "Beck paid" } },
  {
    method: "post",
    path: "/api/admin/rename-player",
    body: { from: "Beck", to: "Beck Test" },
  },
  { method: "get", path: "/api/launch-checks" },
  {
    method: "patch",
    path: "/api/launch-checks/tailnetServeVerified",
    body: { verified: true, verifiedBy: "Test", note: "verify:all local test proof" },
  },
  { method: "get", path: "/api/verification-runs" },
  {
    method: "post",
    path: "/api/verification-runs",
    body: { command: "npm test", status: "passed", scope: ["test"] },
  },
  { method: "post", path: "/api/tournaments/2026-w1/closeout", body: { force: true } },
  { method: "post", path: "/api/tournaments/2026-w1/reopen" },
  { method: "patch", path: "/api/tournaments/2026-w1/details", body: { course: "X" } },
  {
    method: "patch",
    path: "/api/tournaments/2026-w1/payout",
    body: { payoutConfirmed: true },
  },
  { method: "delete", path: "/api/teetimes/fake/scores/Beck" },
  { method: "get", path: "/api/export/database" },
  { method: "post", path: "/api/backups/verify" },
  { method: "get", path: "/api/export/season.json" },
  { method: "get", path: "/api/export/rules.json" },
  { method: "get", path: "/api/export/buyins.csv" },
  { method: "get", path: "/api/export/tee-times.csv" },
  { method: "get", path: "/api/export/roster.csv" },
  { method: "get", path: "/api/export/scores.csv" },
  { method: "get", path: "/api/export/attestations.csv" },
  { method: "get", path: "/api/export/standings.csv" },
  { method: "get", path: "/api/export/payouts.csv" },
  { method: "get", path: "/api/export/readiness.json" },
  { method: "get", path: "/api/export/tasks.json" },
  { method: "get", path: "/api/export/tasks.csv" },
  { method: "get", path: "/api/export/risks.json" },
  { method: "get", path: "/api/export/risks.csv" },
  { method: "get", path: "/api/export/source-search-ledger.json" },
  { method: "get", path: "/api/export/source-search-ledger.csv" },
  { method: "get", path: "/api/export/request-packet.txt" },
  { method: "get", path: "/api/export/blocker-handoff.json" },
  { method: "get", path: "/api/export/blocker-handoff.txt" },
  { method: "get", path: "/api/export/evidence-gap-packet.json" },
  { method: "get", path: "/api/export/evidence-gap-packet.csv" },
  { method: "get", path: "/api/export/evidence-gap-packet.txt" },
  { method: "get", path: "/api/export/launch-checks.json" },
  { method: "get", path: "/api/export/launch-checks.csv" },
  { method: "get", path: "/api/export/launch-gate-checklist.json" },
  { method: "get", path: "/api/export/launch-gate-checklist.csv" },
  { method: "get", path: "/api/export/launch-gate-checklist.txt" },
  { method: "get", path: "/api/export/completion-audit.json" },
  { method: "get", path: "/api/export/completion-audit.csv" },
  { method: "get", path: "/api/export/audit.json" },
  { method: "get", path: "/api/export/audit.csv" },
  { method: "get", path: "/api/export/verification-runs.json" },
  { method: "get", path: "/api/export/verification-runs.csv" },
  { method: "get", path: "/api/export/archive.json" },
  { method: "get", path: "/api/export/closeout/2026-w1.txt" },
  { method: "get", path: "/api/export/closeout/2026-w1.json" },
  { method: "get", path: "/api/export/summary.txt" },
  { method: "get", path: "/api/export/launch-packet.txt" },
];

async function attestScore(
  app: ReturnType<typeof createApp>,
  teeTimeId: string,
  playerName: string,
  attesterName: string
) {
  const attesterCookie = await profileCookie(app, attesterName);
  await request(app)
    .post(
      `/api/teetimes/${teeTimeId}/scores/${encodeURIComponent(playerName)}/attest`
    )
    .set("Cookie", attesterCookie)
    .send({ name: attesterName })
    .expect(200);
}

async function claimSpot(
  app: ReturnType<typeof createApp>,
  teeTimeId: string,
  name: string,
  expectedStatus = 200
) {
  const cookie = await profileCookie(app, name);
  return request(app)
    .post(`/api/teetimes/${teeTimeId}/claims`)
    .set("Cookie", cookie)
    .send({ name })
    .expect(expectedStatus);
}

async function scoreAsHost(
  app: ReturnType<typeof createApp>,
  teeTimeId: string,
  hostName: string,
  body: Record<string, unknown>,
  expectedStatus = 200
) {
  const cookie = await profileCookie(app, hostName);
  return request(app)
    .post(`/api/teetimes/${teeTimeId}/scores`)
    .set("Cookie", cookie)
    .send(body)
    .expect(expectedStatus);
}

describe.sequential("server app factory", () => {
  it("fails commissioner routes closed in dev when no commissioner code is configured", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.COMMISSIONER_CODE;
    try {
      const db = createTestDb();
      const app = createApp(db, { serveAssets: false });

      for (const item of sensitiveCommissionerRequests) {
        const req = request(app)[item.method](item.path).timeout({
          response: 2_000,
          deadline: 5_000,
        });
        if (item.body) req.send(item.body);
        const res = await req;
        expect(
          [403, 404],
          `${item.method.toUpperCase()} ${item.path} should stay closed without commissioner code`
        ).toContain(res.status);
      }
    } finally {
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("does not let shared player access act as commissioner", async () => {
    process.env.ACCESS_CODE = "player-only";
    process.env.COMMISSIONER_CODE = "commissioner-only";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    const unlock = await request(app)
      .post("/api/access")
      .send({ code: "player-only" })
      .expect(200);
    const rawCookie = unlock.headers["set-cookie"];
    const playerCookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
    expect(playerCookie).toContain("golf_access=");

    for (const item of sensitiveCommissionerRequests) {
      const req = request(app)[item.method](item.path)
        .set("Cookie", playerCookie)
        .timeout({ response: 2_000, deadline: 5_000 });
      if (item.body) req.send(item.body);
      const res = await req;
      expect(
        [403, 404],
        `${item.method.toUpperCase()} ${item.path} should not be usable with shared player access`
      ).toContain(res.status);
    }
  });

  it("enforces signed profile ownership for player and host actions", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.COMMISSIONER_CODE;
    try {
      const db = createTestDb();
      const app = createApp(db, { serveAssets: false });

      await request(app)
        .post("/api/teetimes")
        .send({
          course: "Ownership GC",
          date: "2026-06-01",
          time: "09:00",
          spots: 4,
          host: "Greg",
        })
        .expect(403);

      const gregCookie = await profileCookie(app, "Greg");
      const alexCookie = await profileCookie(app, "Alex");

      const created = await request(app)
        .post("/api/teetimes")
        .set("Cookie", gregCookie)
        .send({
          course: "Ownership GC",
          date: "2026-06-01",
          time: "09:00",
          spots: 4,
          host: "Greg",
        })
        .expect(201);
      const teeTimeId = created.body.teeTime.id;

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", "golf_profile=forged-local-storage-name")
        .send({ name: "Alex" })
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", alexCookie)
        .send({ name: "Greg" })
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", alexCookie)
        .send({ name: "Alex" })
        .expect(200);

      const impostorAlexCookie = await freshProfileCookie(app, "Alex");
      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/claims/Alex`)
        .set("Cookie", impostorAlexCookie)
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/interested`)
        .set("Cookie", impostorAlexCookie)
        .send({ name: "Alex" })
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/interested`)
        .set("Cookie", alexCookie)
        .send({ name: "Alex" })
        .expect(200);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", impostorAlexCookie)
        .send({ name: "Alex" })
        .expect(403);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/interested/Alex`)
        .set("Cookie", impostorAlexCookie)
        .expect(403);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/interested/Alex`)
        .set("Cookie", alexCookie)
        .expect(200);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", alexCookie)
        .send({ name: "Alex" })
        .expect(200);

      const comment = await request(app)
        .post(`/api/teetimes/${teeTimeId}/comments`)
        .set("Cookie", gregCookie)
        .send({ author: "Alex", body: "Server should keep this as Greg." })
        .expect(200);
      const commentRow = comment.body.teeTime.comments.find(
        (candidate: any) => candidate.body === "Server should keep this as Greg."
      );
      expect(commentRow).toBeTruthy();
      expect(commentRow.author).toBe("Greg");

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", alexCookie)
        .expect(403);

      await request(app)
        .patch(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", alexCookie)
        .send({ body: "Alex should not be able to rewrite Greg's comment." })
        .expect(403);

      const impostorGregCookie = await freshProfileCookie(app, "Greg");
      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", impostorGregCookie)
        .send({ name: "Chris" })
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/interested`)
        .set("Cookie", impostorGregCookie)
        .send({ name: "Chris" })
        .expect(403);

      await request(app)
        .patch(`/api/teetimes/${teeTimeId}`)
        .set("Cookie", impostorGregCookie)
        .send({
          course: "Ownership GC",
          date: "2026-06-01",
          time: "10:00",
          spots: 4,
          host: "Greg",
        })
        .expect(403);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}`)
        .set("Cookie", impostorGregCookie)
        .expect(403);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", impostorGregCookie)
        .expect(403);

      await request(app)
        .patch(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", impostorGregCookie)
        .send({ body: "Same display name still should not edit it." })
        .expect(403);

      const edited = await request(app)
        .patch(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", gregCookie)
        .send({ body: "Greg can edit his own comment." })
        .expect(200);
      expect(edited.body.teeTime.comments[0]).toMatchObject({
        id: commentRow.id,
        author: "Greg",
        body: "Greg can edit his own comment.",
      });
      expect(edited.body.teeTime.comments[0].editedAt).toBeTruthy();

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/comments/${commentRow.id}`)
        .set("Cookie", gregCookie)
        .expect(200);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/claims/Alex`)
        .set("Cookie", gregCookie)
        .expect(200);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", alexCookie)
        .send({ name: "Chris" })
        .expect(403);

      await request(app)
        .post(`/api/teetimes/${teeTimeId}/claims`)
        .set("Cookie", gregCookie)
        .send({ name: "Chris" })
        .expect(200)
        .expect((res) => {
          expect(res.body.teeTime.claims.map((claim: any) => claim.name)).toContain(
            "Chris"
          );
        });

      const chrisCookie = await freshProfileCookie(app, "Chris");
      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/claims/Chris`)
        .set("Cookie", chrisCookie)
        .expect(403);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/claims/Chris`)
        .set("Cookie", gregCookie)
        .expect(200);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}/scores/Greg`)
        .set("Cookie", gregCookie)
        .expect(403);
    } finally {
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("returns clean 403 responses when non-hosts try destructive host actions", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.COMMISSIONER_CODE;
    try {
      const db = createTestDb();
      const app = createApp(db, { serveAssets: false });
      const gregCookie = await profileCookie(app, "Greg");
      const alexCookie = await profileCookie(app, "Alex");

      const teeTime = await request(app)
        .post("/api/teetimes")
        .set("Cookie", gregCookie)
        .send({
          course: "Host Boundary GC",
          date: "2026-06-01",
          time: "09:00",
          spots: 4,
          host: "Greg",
        })
        .expect(201);

      await request(app)
        .delete(`/api/teetimes/${teeTime.body.teeTime.id}`)
        .set("Cookie", alexCookie)
        .expect(403);

      const poll = await request(app)
        .post("/api/polls")
        .set("Cookie", gregCookie)
        .send({
          prompt: "Which course?",
          host: "Greg",
          options: ["A", "B"],
        })
        .expect(201);

      await request(app)
        .post(`/api/polls/${poll.body.poll.id}/responses`)
        .set("Cookie", alexCookie)
        .send({ optionIdx: 0 })
        .expect(200);

      const impostorAlexCookie = await freshProfileCookie(app, "Alex");
      await request(app)
        .post(`/api/polls/${poll.body.poll.id}/responses`)
        .set("Cookie", impostorAlexCookie)
        .send({ optionIdx: 0 })
        .expect(403);

      await request(app)
        .post(`/api/polls/${poll.body.poll.id}/responses`)
        .set("Cookie", alexCookie)
        .send({ optionIdx: 1 })
        .expect(200);

      await request(app)
        .delete(`/api/polls/${poll.body.poll.id}`)
        .set("Cookie", alexCookie)
        .expect(403);

      const impostorGregCookie = await freshProfileCookie(app, "Greg");
      await request(app)
        .delete(`/api/polls/${poll.body.poll.id}`)
        .set("Cookie", impostorGregCookie)
        .expect(403);

      await request(app)
        .delete(`/api/polls/${poll.body.poll.id}`)
        .set("Cookie", gregCookie)
        .expect(200);
    } finally {
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("does not bind commissioner-created host items to the commissioner's profile", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const db = createTestDb();
      const app = createApp(db, { serveAssets: false });
      const admin = await commissionerAgent(app);

      await admin
        .post("/api/profile")
        .send({ name: "Jayson Post" })
        .expect(200);

      const teeTime = await admin
        .post("/api/teetimes")
        .send({
          course: "Admin Host Boundary GC",
          date: "2026-06-01",
          time: "09:00",
          spots: 4,
          host: "Greg",
        })
        .expect(201);

      const poll = await admin
        .post("/api/polls")
        .send({
          prompt: "Where should Greg's group play?",
          host: "Greg",
          options: ["Front", "Back"],
        })
        .expect(201);

      const teeTimeId = teeTime.body.teeTime.id;
      const pollId = poll.body.poll.id;
      expect(teeTimeId).toEqual(expect.any(String));
      expect(pollId).toEqual(expect.any(String));
      const jaysonCookie = await freshProfileCookie(app, "Jayson Post");
      const gregCookie = await freshProfileCookie(app, "Greg");

      await request(app)
        .patch(`/api/teetimes/${teeTimeId}`)
        .set("Cookie", jaysonCookie)
        .send({
          course: "Admin Host Boundary GC",
          date: "2026-06-01",
          time: "09:30",
          spots: 4,
          host: "Greg",
        })
        .expect(403);

      await request(app)
        .delete(`/api/polls/${pollId}`)
        .set("Cookie", jaysonCookie)
        .expect(403);

      await request(app)
        .get("/api/polls")
        .expect(200)
        .expect((res) => {
          expect(res.body.polls.map((row: any) => row.id)).toContain(pollId);
        });

      await request(app)
        .patch(`/api/teetimes/${teeTimeId}`)
        .set("Cookie", gregCookie)
        .send({
          course: "Admin Host Boundary GC",
          date: "2026-06-01",
          time: "09:30",
          spots: 4,
          host: "Greg",
        })
        .expect(200);

      await request(app)
        .delete(`/api/polls/${pollId}`)
        .set("Cookie", gregCookie)
        .expect(200);

      await request(app)
        .delete(`/api/teetimes/${teeTimeId}`)
        .set("Cookie", gregCookie)
        .expect(200);
    } finally {
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("keeps a browser profile subject stable when the same name is re-saved", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.COMMISSIONER_CODE;
    try {
      const db = createTestDb();
      const app = createApp(db, { serveAssets: false });
      const greg = request.agent(app);

      await greg.post("/api/profile").send({ name: "Greg" }).expect(200);
      const created = await greg
        .post("/api/teetimes")
        .send({
          course: "Reload Proof GC",
          date: "2026-06-01",
          time: "09:00",
          spots: 4,
          host: "Greg",
        })
        .expect(201);
      const teeTimeId = created.body.teeTime.id;

      const comment = await greg
        .post(`/api/teetimes/${teeTimeId}/comments`)
        .send({ body: "Same browser after reload should still own this." })
        .expect(200);
      const commentId = comment.body.teeTime.comments[0].id;

      await greg.post("/api/profile").send({ name: "Greg" }).expect(200);

      await greg
        .patch(`/api/teetimes/${teeTimeId}`)
        .send({
          course: "Reload Proof GC",
          date: "2026-06-01",
          time: "09:30",
          spots: 4,
          host: "Greg",
        })
        .expect(200);

      const edited = await greg
        .patch(`/api/teetimes/${teeTimeId}/comments/${commentId}`)
        .send({ body: "Same browser after reload can still edit this." })
        .expect(200);
      expect(edited.body.teeTime.comments[0]).toMatchObject({
        id: commentId,
        body: "Same browser after reload can still edit this.",
      });

      await greg
        .delete(`/api/teetimes/${teeTimeId}/comments/${commentId}`)
        .expect(200);

      await greg.delete(`/api/teetimes/${teeTimeId}`).expect(200);
    } finally {
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("serves seeded tournaments from a temp database", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    const [tournaments, players, buyins] = await Promise.all([
      request(app).get("/api/tournaments").expect(200),
      request(app).get("/api/players").expect(200),
      admin.get("/api/buyins").expect(200),
    ]);

    expect(Array.isArray(tournaments.body.tournaments)).toBe(true);
    expect(tournaments.body.tournaments.length).toBeGreaterThan(0);
    expect(players.body.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Jayson Post", handicap: 10.6, member: true }),
        expect.objectContaining({ name: "Max McCutcheon", handicap: 14.1, member: true }),
      ])
    );
    expect(buyins.body.buyins).toHaveLength(12);
  });

  it("stores and exports a roster handicap source note", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .put("/api/players/Beck")
      .send({
        ghinNumber: "1234567",
        handicap: 8.2,
        handicapSourceType: "ghin",
        handicapSource: "Text reply 2026-05-19: Beck 8.2",
        handicapNote: "Confirmed by Beck in league chat",
        handicapVerifiedAt: "2026-05-19T12:00:00.000Z",
        handicapVerifiedBy: "Duck",
        member: true,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.player).toMatchObject({
          name: "Beck",
          ghinNumber: "1234567",
          handicap: 8.2,
          handicapSourceType: "ghin",
          handicapSource: "Text reply 2026-05-19: Beck 8.2",
          handicapNote: "Confirmed by Beck in league chat",
          handicapVerifiedAt: "2026-05-19T12:00:00.000Z",
          handicapVerifiedBy: "Duck",
          member: true,
        });
      });

    await admin
      .put("/api/players/Beck")
      .send({ member: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.player.handicapSource).toBe(
          "Text reply 2026-05-19: Beck 8.2"
        );
        expect(res.body.player.handicapNote).toBe(
          "Confirmed by Beck in league chat"
        );
      });

    await admin
      .get("/api/export/roster.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          "name,member,ghin_number,handicap_index,handicap_source_type,handicap_source,handicap_note,handicap_verified_at,handicap_verified_by,buyin_amount"
        );
        expect(res.text).toContain(
          "Beck,no,1234567,8.2,ghin,Text reply 2026-05-19: Beck 8.2,Confirmed by Beck in league chat,2026-05-19T12:00:00.000Z,Duck,"
        );
      });
  });

  it("keeps typed roster handicap indexes unverified when no source is provided", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .put("/api/players/Beck")
      .send({ handicap: 8.2, member: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.player).toMatchObject({
          name: "Beck",
          handicap: 8.2,
          handicapSourceType: "unknown",
          handicapSource: null,
          handicapNote: null,
          handicapVerifiedAt: null,
          handicapVerifiedBy: null,
          member: true,
        });
      });

    await admin
      .get("/api/export/roster.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("Beck,yes,,8.2,unknown,,,,,325,no,,,");
      });

    await admin
      .get("/api/export/completion-audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "roster-ghin",
              status: "open",
              evidence: expect.arrayContaining([
                "12 missing/unverified: Beck, Chris, Jayson Post, John, Jonny Ten Bosch, Kyle Dantzler, Matt, Max McCutcheon, Noah, Ryan, Sam Lines, Will",
              ]),
            }),
          ])
        );
      });
  });

  it("keeps public roster basic while commissioner roster includes GHIN evidence", async () => {
    process.env.COMMISSIONER_CODE = "admin-test";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    const unlock = await request(app)
      .post("/api/commissioner")
      .send({ code: "admin-test" })
      .expect(200);
    const commissionerCookie = unlock.headers["set-cookie"];
    const cookie = Array.isArray(commissionerCookie)
      ? commissionerCookie[0]
      : commissionerCookie;
    expect(cookie).toBeTruthy();

    await request(app)
      .put("/api/players/Beck")
      .set("Cookie", cookie)
      .send({
        ghinNumber: "1234567",
        handicap: 8.2,
        handicapSourceType: "ghin",
        handicapSource: "Text reply 2026-05-19: Beck 8.2",
        handicapNote: "Confirmed by Beck in league chat",
        handicapVerifiedAt: "2026-05-19T12:00:00.000Z",
        handicapVerifiedBy: "Duck",
        member: true,
      })
      .expect(200);

    await request(app)
      .get("/api/players")
      .expect(200)
      .expect((res) => {
        const beck = res.body.players.find((player: any) => player.name === "Beck");
        expect(beck).toMatchObject({
          name: "Beck",
          handicap: 8.2,
          handicapSourceType: "ghin",
          handicapVerifiedAt: "2026-05-19T12:00:00.000Z",
          member: true,
        });
        expect(beck).not.toHaveProperty("ghinNumber");
        expect(beck).not.toHaveProperty("handicapSource");
        expect(beck).not.toHaveProperty("handicapNote");
        expect(beck).not.toHaveProperty("handicapVerifiedBy");
      });

    await request(app)
      .get("/api/players")
      .set("Cookie", cookie)
      .expect(200)
      .expect((res) => {
        const beck = res.body.players.find((player: any) => player.name === "Beck");
        expect(beck).toMatchObject({
          ghinNumber: "1234567",
          handicapSource: "Text reply 2026-05-19: Beck 8.2",
          handicapNote: "Confirmed by Beck in league chat",
          handicapVerifiedBy: "Duck",
        });
      });
  });

  it("reports server and database readiness", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await request(app)
      .get("/api/health")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ ok: true, database: "ok" });
      });
  });

  it("fails fast when production assets are missing or incomplete", async () => {
    const originalStaticDir = process.env.STATIC_DIR;
    const tempDirs: string[] = [];
    try {
      const missingDir = fs.mkdtempSync(
        path.join(ensureTestWorkDir("assets"), "djdi-missing-assets-")
      );
      tempDirs.push(missingDir);
      process.env.STATIC_DIR = missingDir;
      expect(() => createApp(createTestDb(), { serveAssets: true })).toThrow(
        /Production assets are missing/
      );

      const incompleteDir = fs.mkdtempSync(
        path.join(ensureTestWorkDir("assets"), "djdi-incomplete-assets-")
      );
      tempDirs.push(incompleteDir);
      fs.writeFileSync(
        path.join(incompleteDir, "index.html"),
        '<!doctype html><div id="root"></div><script type="module" src="/assets/missing.js"></script>'
      );
      process.env.STATIC_DIR = incompleteDir;
      expect(() => createApp(createTestDb(), { serveAssets: true })).toThrow(
        /referenced by .* is missing/
      );
    } finally {
      if (originalStaticDir == null) delete process.env.STATIC_DIR;
      else process.env.STATIC_DIR = originalStaticDir;
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("requires the shared access code when ACCESS_CODE is configured", async () => {
    process.env.ACCESS_CODE = "djdi-test-code";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await request(app).get("/api/health").expect(200);

    await request(app)
      .get("/api/access")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ required: true, ok: false });
      });

    await request(app).get("/api/players").expect(401);

    await request(app)
      .post("/api/access")
      .send({ code: "wrong-code" })
      .expect(401);

    const unlock = await request(app)
      .post("/api/access")
      .send({ code: "djdi-test-code" })
      .expect(200);
    const cookie = unlock.headers["set-cookie"];
    expect(cookie?.[0]).toContain("golf_access=djdi-test-code");
    const accessCookie = Array.isArray(cookie) ? cookie[0] : cookie;
    expect(accessCookie).toBeTruthy();

    await request(app)
      .get("/api/players")
      .set("Cookie", accessCookie)
      .expect(200);
  });

  it("sets access cookies that work on both HTTPS tailnet and HTTP direct phone routes", async () => {
    process.env.ACCESS_CODE = "djdi-test-code";
    process.env.COMMISSIONER_CODE = "commissioner-test";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    const directAccess = await request(app)
      .post("/api/access")
      .send({ code: "djdi-test-code" })
      .expect(200);
    expect(directAccess.headers["set-cookie"]?.[0]).toContain(
      "golf_access=djdi-test-code"
    );
    expect(directAccess.headers["set-cookie"]?.[0]).not.toContain("Secure");

    const directCommissioner = await request(app)
      .post("/api/commissioner")
      .set("Cookie", directAccess.headers["set-cookie"])
      .send({ code: "commissioner-test" })
      .expect(200);
    expect(directCommissioner.headers["set-cookie"]?.[0]).toContain(
      "golf_commissioner=commissioner-test"
    );
    expect(directCommissioner.headers["set-cookie"]?.[0]).not.toContain("Secure");

    const tailnetAccess = await request(app)
      .post("/api/access")
      .set("X-Forwarded-Proto", "https")
      .send({ code: "djdi-test-code" })
      .expect(200);
    expect(tailnetAccess.headers["set-cookie"]?.[0]).toContain("Secure");
  });

  it("allows COOKIE_SECURE to force secure cookies for strict deployments", async () => {
    process.env.ACCESS_CODE = "djdi-test-code";
    process.env.COOKIE_SECURE = "1";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    const response = await request(app)
      .post("/api/access")
      .send({ code: "djdi-test-code" })
      .expect(200);

    expect(response.headers["set-cookie"]?.[0]).toContain("Secure");
  });

  it("rejects a regular tee-time score for an unclaimed player", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");

    const created = await createRegularTeeTime(app);
    const gregCookie = await profileCookie(app, "Greg");

    await request(app)
      .post(`/api/teetimes/${created.id}/claims`)
      .set("Cookie", gregCookie)
      .send({ name: "Greg" })
      .expect(409);

    await request(app)
      .post(`/api/teetimes/${created.id}/scores`)
      .set("Cookie", gregCookie)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Greg" })
      .expect(400);

    const teeTimes = await request(app).get("/api/teetimes").expect(200);
    const updated = teeTimes.body.teeTimes.find(
      (teeTime: any) => teeTime.id === created.id
    );
    expect(updated.scores.some((score: any) => score.name === "Alex")).toBe(
      false
    );
  });

  it("creates default buy-ins for active members and removes them on demotion", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await createMember(app, "Alex");
    await createMember(app, "Greg");

    const promoted = await admin.get("/api/buyins").expect(200);
    expect(promoted.body.buyins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerName: "Alex",
        amount: 325,
        paid: false,
      }),
      expect.objectContaining({
        playerName: "Greg",
        amount: 325,
        paid: false,
      }),
    ]));
    expect(
      promoted.body.buyins.reduce(
        (total: number, buyin: any) => total + buyin.amount,
        0
      )
    ).toBe(4550);

    await admin
      .put("/api/players/Alex")
      .send({ member: false })
      .expect(200);

    const demoted = await admin.get("/api/buyins").expect(200);
    expect(demoted.body.buyins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerName: "Greg",
        amount: 325,
      }),
    ]));
    expect(
      demoted.body.buyins.some((buyin: any) => buyin.playerName === "Alex")
    ).toBe(false);
    expect(
      demoted.body.buyins.reduce(
        (total: number, buyin: any) => total + buyin.amount,
        0
      )
    ).toBe(4225);
  });

  it("includes buy-in amount, paid date, and notes in the commissioner summary", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    const patched = await admin
      .patch("/api/buyins/Beck")
      .send({
        amount: 400,
        paid: true,
        paidAt: "2026-05-19",
        notes: "Venmo confirmed by Jason",
      })
      .expect(200);

    await admin
      .get("/api/export/summary.txt")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("Settled: $400");
        expect(res.text).toContain("Expected: $3,975");
        expect(res.text).toContain("Outstanding: $3,575");
        expect(res.text).toContain(
          "Beck: paid 2026-05-19 $400 — Venmo confirmed by Jason"
        );
      });

    await admin
      .get("/api/export/buyins.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "player_name,amount,payment_status,paid,payment_method,payment_actor,paid_at,outstanding,notes,updated_at"
        );
        expect(res.text).toContain(
          "Beck,400,paid,yes,venmo,Commissioner,2026-05-19,0,Venmo confirmed by Jason,"
        );
      });
  });

  it("neutralizes spreadsheet formulas in CSV exports", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);
    const hostCookie = await profileCookie(app, "Formula Host");
    const witnessCookie = await profileCookie(app, "Formula Witness");

    await admin
      .patch("/api/buyins/Beck")
      .send({
        notes: '=HYPERLINK("https://example.test","paid")',
      })
      .expect(200);

    await admin
      .get("/api/export/buyins.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `"\'=HYPERLINK(""https://example.test"",""paid"")"`
        );
      });

    await admin
      .put("/api/players/Beck")
      .send({
        handicap: 8.2,
        handicapSource: "+SUM(1,2)",
        member: true,
      })
      .expect(200);

    await admin
      .get("/api/export/roster.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(`"\'+SUM(1,2)"`);
      });

    const created = await request(app)
      .post("/api/teetimes")
      .set("Cookie", hostCookie)
      .send({
        course: '=HYPERLINK("https://example.test","course")',
        date: "2027-06-01",
        time: "09:00",
        spots: 4,
        host: "Formula Host",
      })
      .expect(201);
    const teeTimeId = created.body.teeTime.id;

    await admin
      .get("/api/export/tee-times.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `"\'=HYPERLINK(""https://example.test"",""course"")"`
        );
      });

    await request(app)
      .post(`/api/teetimes/${teeTimeId}/claims`)
      .set("Cookie", witnessCookie)
      .send({ name: "Formula Witness" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTimeId}/scores`)
      .set("Cookie", hostCookie)
      .send({
        name: "Formula Host",
        gross: 80,
        attestedBy: "Formula Witness",
        teeName: "@Gold",
      })
      .expect(200);

    await admin
      .get("/api/export/scores.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `"\'=HYPERLINK(""https://example.test"",""course"")"`
        );
        expect(res.text).toContain("'@Gold");
      });

    await admin
      .get("/api/export/attestations.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `"\'=HYPERLINK(""https://example.test"",""course"")"`
        );
      });

    await admin
      .post("/api/verification-runs")
      .send({
        command: "=npm test",
        status: "passed",
        scope: ["@scope"],
        summary: "-passed cleanly",
        recordedBy: "@Verifier",
      })
      .expect(201);

    await admin
      .get("/api/export/verification-runs.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("'=npm test");
        expect(res.text).toContain("'@Verifier");
        expect(res.text).toContain("'-passed cleanly");
      });

    await admin
      .patch("/api/launch-checks/dockerBuildVerified")
      .send({
        verified: true,
        verifiedBy: "+Commissioner",
        note: "=npm run verify:docker",
      })
      .expect(200);

    await admin
      .get("/api/export/launch-checks.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("'+Commissioner");
        expect(res.text).toContain("'=npm run verify:docker");
      });

    await admin
      .get("/api/export/audit.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("'+Commissioner");
        expect(res.text).toContain("'@Verifier");
        expect(res.text).toContain(
          `"Created tee time at =HYPERLINK(""https://example.test"",""course"")"`
        );
      });

    for (const path of [
      "/api/export/buyins.csv",
      "/api/export/roster.csv",
      "/api/export/tee-times.csv",
      "/api/export/scores.csv",
      "/api/export/attestations.csv",
      "/api/export/standings.csv",
      "/api/export/payouts.csv",
      "/api/export/tasks.csv",
      "/api/export/risks.csv",
      "/api/export/source-search-ledger.csv",
      "/api/export/evidence-gap-packet.csv",
      "/api/export/launch-checks.csv",
      "/api/export/launch-gate-checklist.csv",
      "/api/export/completion-audit.csv",
      "/api/export/audit.csv",
      "/api/export/verification-runs.csv",
    ]) {
      await admin
        .get(path)
        .expect(200)
        .expect((res) => {
          expectCsvFormulaSafe(res.text);
        });
    }
  });

  it("exports a launch packet with commissioner asks and league checklist items", async () => {
    process.env.DJDI_TODAY = "2026-05-18";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .get("/api/export/launch-packet.txt")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("DJDI Launch Packet");
        expect(res.text).toContain("Copy/Paste Asks");
        expect(res.text).toContain("[Buy-in Status]");
        expect(res.text).toContain("DJDI buy-in status tracker:");
        expect(res.text).toContain("Outstanding total: $3,900");
        expect(res.text).toContain("[Handicap Records]");
        expect(res.text).toContain("DJDI handicap records still needed:");
        expect(res.text).toContain("[Schedule Details]");
        expect(res.text).toContain("DJDI schedule details still needed:");
        expect(res.text).toContain("League Checklist");
        expect(res.text).toContain("Commissioner Tasks");
        expect(res.text).toContain(
          "RISK - Track buy-in status: $3,900 outstanding across 12 players."
        );
        expect(res.text).toContain(
          "RISK - Record handicap indexes: 12 member indexes missing or unverified."
        );
        expect(res.text).toContain("Outbound Request Packet");
        expect(res.text).toContain("DJDI request packet");
        expect(res.text).toContain("Launch Check Evidence");
        expect(res.text).toContain(
          "OPEN - Docker image build: set DJDI_DOCKER_BUILD_VERIFIED or mark verified in Ops"
        );
        expect(res.text).toContain("Closeout Readiness");
        expect(res.text).toContain("Stop 1 — Common Ground: active");
        expect(res.text).toContain("/api/export/readiness.json");
        expect(res.text).toContain("/api/export/completion-audit.json");
        expect(res.text).toContain("/api/export/completion-audit.csv");
        expect(res.text).toContain("/api/export/rules.json");
        expect(res.text).toContain("/api/export/launch-checks.json");
        expect(res.text).toContain("/api/export/launch-checks.csv");
        expect(res.text).toContain("/api/export/tasks.csv");
        expect(res.text).toContain("/api/export/risks.json");
        expect(res.text).toContain("/api/export/risks.csv");
        expect(res.text).toContain("/api/export/payouts.csv");
        expect(res.text).toContain("/api/export/request-packet.txt");
        expect(res.text).toContain("/api/export/evidence-gap-packet.json");
        expect(res.text).toContain("/api/export/evidence-gap-packet.csv");
        expect(res.text).toContain("/api/export/evidence-gap-packet.txt");
        expect(res.text).toContain("Verification Commands");
        expect(res.text).toContain("REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code>");
      });
  });

  it("exports machine-readable commissioner readiness", async () => {
    process.env.DJDI_TODAY = "2026-05-18";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          rulesVersion: ACTIVE_RULES_VERSION,
          activeRules: {
            version: ACTIVE_RULES_VERSION,
          },
          counts: {
            members: 12,
            buyins: 12,
            tournaments: 9,
            ruleBlockers: 0,
            commissionerTasks: 7,
          },
          money: {
            expected: 3900,
            collected: 0,
            outstanding: 3900,
            paid: 0,
            total: 12,
          },
        });
        expect(res.body.missingHandicaps).toEqual([
          "Beck",
          "Chris",
          "Jayson Post",
          "John",
          "Jonny Ten Bosch",
          "Kyle Dantzler",
          "Matt",
          "Max McCutcheon",
          "Noah",
          "Ryan",
          "Sam Lines",
          "Will",
        ]);
        expect(res.body.unconfirmedEvents).toEqual([
          "Mid-season major",
          "Championship — 2-day post-season",
        ]);
        expect(res.body.launchRisks.map((risk: any) => risk.label)).toEqual(
          expect.arrayContaining([
            "Buy-in tracking",
            "Handicap records",
            "Schedule confirmation",
          ])
        );
        expect(res.body.commissionerTasks.map((task: any) => task.id)).toEqual(
          expect.arrayContaining([
            "collect-buyins",
            "collect-ghin-indexes",
            "confirm-schedule",
            "set-access-code",
            "verify-tailnet-url",
          ])
        );
        expect(
          res.body.commissionerTasks.find(
            (task: any) => task.id === "collect-buyins"
          ).copyText
        ).toContain("Outstanding total: $3,900");
        expect(res.body.activeStop).toMatchObject({
          rulesVersion: ACTIVE_RULES_VERSION,
          id: "2026-w1",
          name: "Stop 1 — Common Ground",
          leader: null,
          scoresPosted: 0,
        });
        expect(res.body.activeStop.leaderboard).toEqual([]);
        expect(res.body.launchCheckEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "dockerBuildVerified",
              verified: false,
              source: "none",
              envVar: "DJDI_DOCKER_BUILD_VERIFIED",
            }),
          ])
        );
        expect(res.body.closeoutReadiness).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              tournamentId: "2026-w1",
              status: "active",
              buttonLabel: "Active",
              issueCount: 0,
              packetUrl: "/api/export/closeout/2026-w1.txt",
              ledgerUrl: "/api/export/closeout/2026-w1.json",
            }),
          ])
        );
      });
  });

  it("exports active league rules as a protected evidence artifact", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .get("/api/export/rules.json")
      .expect(200)
      .expect("content-type", /application\/json/)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          rulesVersion: ACTIVE_RULES_VERSION,
          activeRules: {
            version: ACTIVE_RULES_VERSION,
            points: {
              tournamentTypes: ["regular"],
              noPointsFor: ["major", "post"],
            },
            money: {
              defaultBuyin: 325,
              paymentStatuses: [
                "unpaid",
                "promised",
                "paid",
                "comped",
                "refunded",
                "disputed",
              ],
            },
            payouts: {
              regularWinner: 334,
            },
            ties: {
              tournamentLeaderboard:
                "best net, then best gross, then stable input order",
            },
            guests: {
              canHaveLeagueScoresRecorded: false,
              canAttestLeagueScores: false,
            },
            handicap: {
              requiresRoundCourseHandicapForLeagueScores: true,
            },
          },
        });
      });
  });

  it("exports the open commissioner task queue directly", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .get("/api/export/tasks.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          count: 7,
        });
        expect(res.body.copyPacket).toContain("DJDI commissioner tasks:");
        expect(res.body.requestPacket).toContain("DJDI request packet");
        expect(res.body.requestPacket).toContain("[1. Track buy-in status]");
        expect(res.body.requestPacket).toContain("DJDI buy-in status tracker:");
        expect(res.body.requestPacket).toContain("[2. Record handicap indexes]");
        expect(res.body.requestPacket).toContain("DJDI handicap records still needed");
        expect(res.body.tasks.map((task: any) => task.id)).toEqual(
          expect.arrayContaining([
            "collect-buyins",
            "collect-ghin-indexes",
            "confirm-schedule",
            "verify-docker",
            "verify-tailnet-url",
          ])
        );
        expect(
          res.body.tasks.find((task: any) => task.id === "collect-ghin-indexes")
            .copyText
        ).toContain("DJDI handicap records still needed");
        expect(res.body.launchRisks.map((risk: any) => risk.label)).toContain(
          "Buy-in tracking"
        );
        expect(res.body.launchCheckEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "dockerBuildVerified",
              verified: false,
            }),
          ])
        );
      });

    await admin
      .get("/api/export/tasks.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain(
          "id,area,severity,title,detail,next_action,items,copy_text,done"
        );
        expect(res.text).toContain("collect-buyins,money,risk,Track buy-in status");
        expect(res.text).toContain(
          "collect-ghin-indexes,roster,risk,Record handicap indexes"
        );
        expect(res.text).toContain("DJDI handicap records still needed");
      });

    await admin
      .get("/api/export/request-packet.txt")
      .expect(200)
      .expect("content-type", /text\/plain/)
      .expect((res) => {
        expect(res.text).toContain("DJDI request packet");
        expect(res.text).toContain("[1. Track buy-in status]");
        expect(res.text).toContain("Outstanding total: $3,900");
        expect(res.text).toContain("[2. Record handicap indexes]");
        expect(res.text).toContain("DJDI handicap records still needed");
        expect(res.text).toContain("Paste replies back into Ops > One-Paste Intake");
      });
  });

  it("exports the remaining risk register directly", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .get("/api/export/risks.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          count: 7,
          ready: false,
          severityCounts: {
            blocker: 0,
            risk: 3,
            external: 4,
          },
        });
        expect(res.body.risks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "money-collection",
              severity: "risk",
              label: "Buy-in tracking",
              detail: "$3,900 outstanding",
            }),
            expect.objectContaining({
              id: "tailnet-url",
              severity: "external",
              label: "Tailnet URL",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/risks.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain("id,severity,label,detail,next_action");
        expect(res.text).toContain(
          "money-collection,risk,Buy-in tracking,\"$3,900 outstanding\""
        );
        expect(res.text).not.toContain("production-url,external");
      });
  });

  it("surfaces payment-like notes on unpaid buy-ins without marking them paid", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .patch("/api/buyins/Matt")
      .send({ paid: false, notes: "venmo" })
      .expect(200)
      .expect((res) => {
        expect(res.body.buyin).toMatchObject({
          playerName: "Matt",
          paid: false,
          paidAt: null,
          notes: "venmo",
        });
      });

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.launchRisks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "payment-note-review",
              label: "Payment note review",
              detail: "1 unpaid row with payment-like notes: Matt",
            }),
          ])
        );
        expect(res.body.commissionerTasks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "review-payment-notes",
              title: "Review payment notes",
              items: ["Matt: venmo"],
              copyText: expect.stringContaining("Matt: venmo"),
            }),
          ])
        );
        expect(res.body.money).toMatchObject({
          collected: 0,
          outstanding: 3900,
          paid: 0,
        });
      });

    await admin
      .get("/api/export/risks.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          count: 8,
          severityCounts: {
            blocker: 0,
            risk: 4,
            external: 4,
          },
        });
        expect(res.body.risks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "payment-note-review",
              severity: "risk",
              label: "Payment note review",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/tasks.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          "review-payment-notes,money,risk,Review payment notes"
        );
        expect(res.text).toContain("Matt: venmo");
      });

    await admin
      .get("/api/export/completion-audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "money-note-review",
              status: "open",
              evidence: ["1 review needed: Matt: venmo"],
              nextAction:
                "Open Money and confirm each note means paid, or clear/rewrite the note.",
            }),
          ])
        );
      });
  });

  it("rejects new paid buy-ins without evidence notes and still surfaces legacy gaps", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .patch("/api/buyins/Matt")
      .send({ paid: true, notes: null })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "Paid buy-ins require a receipt or source note"
        );
      });

    await admin
      .patch("/api/buyins/Matt")
      .send({ paid: true, notes: "Confirmed by Jason" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("Paid buy-ins require a payment method");
      });

    await admin
      .patch("/api/buyins/Matt")
      .send({ paid: true, notes: "Venmo confirmed by Jason", paymentMethod: "venmo" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("Paid buy-ins require a payment date");
      });

    db.prepare(
      "UPDATE league_buyins SET paid = 1, paid_at = ?, notes = NULL, updated_at = ? WHERE player_name = ? COLLATE NOCASE"
    ).run(
      "2026-05-19T12:00:00.000Z",
      "2026-05-19T12:00:00.000Z",
      "Matt"
    );

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.launchRisks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "payment-evidence-review",
              label: "Payment evidence review",
              detail: "1 paid row missing evidence notes: Matt",
            }),
          ])
        );
        expect(res.body.commissionerTasks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "review-payment-evidence",
              title: "Add paid evidence notes",
              copyText: expect.stringContaining(
                "DJDI paid buy-in evidence review"
              ),
            }),
          ])
        );
        expect(res.body.money).toMatchObject({
          collected: 325,
          outstanding: 3575,
          paid: 1,
        });
      });

    await admin
      .get("/api/export/risks.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          count: 8,
          severityCounts: {
            blocker: 0,
            risk: 4,
            external: 4,
          },
        });
        expect(res.body.risks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "payment-evidence-review",
              severity: "risk",
              label: "Payment evidence review",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/tasks.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          "review-payment-evidence,money,risk,Add paid evidence notes"
        );
        expect(res.text).toContain("evidence note missing");
      });

    await admin
      .get("/api/export/completion-audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "money-paid-evidence",
              status: "open",
              evidence: ["1 paid row(s) missing evidence notes: Matt"],
              nextAction:
                "Open Money and add receipt/source notes for every paid row.",
            }),
          ])
        );
      });
  });

  it("persists launch check verification for Ops and readiness exports", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .patch("/api/launch-checks/dockerBuildVerified")
      .send({ verified: true, verifiedBy: "Jayson Post" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "Verified launch checks require an evidence note"
        );
      });

    await admin
      .patch("/api/launch-checks/productionUrlVerified")
      .send({
        verified: true,
        verifiedBy: "Jayson Post",
        note: "Remote smoke passed against http://127.0.0.1:3000.",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "Production URL smoke evidence cannot use localhost or loopback URLs"
        );
      });

    await admin
      .patch("/api/launch-checks/mobileSafariVerified")
      .send({
        verified: true,
        verifiedBy: "Jayson Post",
        note: "Desktop mobile viewport passed.",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "iPhone Safari evidence note must mention the physical iPhone"
        );
      });

    await admin
      .patch("/api/launch-checks/mobileSafariVerified")
      .send({
        verified: true,
        verifiedBy: "Jayson Post",
        note: "Physical iPhone Safari passed against http://127.0.0.1:3000.",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "iPhone Safari evidence cannot use localhost or loopback URLs"
        );
      });

    await admin
      .patch("/api/launch-checks/dockerBuildVerified")
      .send({ verified: true, verifiedBy: "Jayson Post", note: "Local Docker smoke passed." })
      .expect(200)
      .expect((res) => {
        expect(res.body.launchChecks.dockerBuildVerified).toBe(true);
        expect(res.body.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "dockerBuildVerified",
              verified: true,
              source: "database",
              verifiedBy: "Jayson Post",
              note: "Local Docker smoke passed.",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.launchChecks.dockerBuildVerified).toBe(true);
        expect(res.body.launchRisks.map((risk: any) => risk.label)).not.toContain(
          "Docker image build"
        );
        expect(res.body.launchCheckEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "dockerBuildVerified",
              verified: true,
              source: "database",
              verifiedBy: "Jayson Post",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/launch-checks.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          count: 4,
          verifiedCount: 1,
          openCount: 3,
          launchChecks: {
            dockerBuildVerified: true,
          },
        });
        expect(res.body.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "dockerBuildVerified",
              label: "Docker image build",
              verified: true,
              source: "database",
              verifiedBy: "Jayson Post",
              note: "Local Docker smoke passed.",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/launch-checks.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "key,label,verified,source,verified_at,verified_by,note,env_var,updated_at"
        );
        expect(res.text).toContain(
          "dockerBuildVerified,Docker image build,yes,database"
        );
        expect(res.text).toContain("tailnetServeVerified,Tailscale Funnel smoke");
      });

    await admin
      .get("/api/export/launch-gate-checklist.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          summary: {
            total: 4,
            verified: 1,
            open: 2,
            notRequired: 1,
          },
        });
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "tailnetServeVerified",
              status: "open",
              steps: expect.arrayContaining([
                expect.objectContaining({ id: "funnel-smoke" }),
              ]),
            }),
            expect.objectContaining({
              key: "productionUrlVerified",
              status: "not_required",
              steps: expect.arrayContaining([
                expect.objectContaining({ id: "remote-smoke" }),
              ]),
            }),
            expect.objectContaining({
              key: "mobileSafariVerified",
              status: "open",
              steps: expect.arrayContaining([
                expect.objectContaining({ id: "iphone-score-ops" }),
              ]),
            }),
          ])
        );
      });

    await admin
      .get("/api/export/launch-gate-checklist.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain(
          "key,label,status,source,verified_at,verified_by,note,env_var,step_count,steps,final_action"
        );
        expect(res.text).toContain("tailnetServeVerified,Tailscale Funnel smoke,open");
        expect(res.text).toContain(
          "productionUrlVerified,Production URL smoke,not_required"
        );
      });

    await admin
      .get("/api/export/launch-gate-checklist.txt")
      .expect(200)
      .expect("content-type", /text\/plain/)
      .expect((res) => {
        expect(res.text).toContain("DJDI Launch Gate Checklist");
        expect(res.text).toContain("Not required for current Tailscale hosting: 1");
        expect(res.text).toContain("Tailscale Funnel smoke");
        expect(res.text).toContain("REMOTE_SMOKE_URL=https://...");
        expect(res.text).toContain("physical-device golden path");
      });

    await admin
      .patch("/api/launch-checks/dockerBuildVerified")
      .send({ verified: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.launchChecks.dockerBuildVerified).toBe(false);
      });

    await admin
      .patch("/api/launch-checks/nope")
      .send({ verified: true })
      .expect(404);
  });

  it("records verification runs and exports the proof ledger", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    const recorded = await admin
      .post("/api/verification-runs")
      .send({
        command: "npm run verify:prod-smoke",
        status: "passed",
        scope: ["access gate", "exports", "archive manifest"],
        summary: "Production smoke verifier passed against a temporary app.",
        recordedBy: "Prod Smoke",
        metadata: { url: "http://127.0.0.1:3000" },
      })
      .expect(201);
    expect(recorded.body.verificationRun).toMatchObject({
      command: "npm run verify:prod-smoke",
      status: "passed",
      recordedBy: "Prod Smoke",
      scope: ["access gate", "exports", "archive manifest"],
    });
    const mobileRecorded = await admin
      .post("/api/verification-runs")
      .send({
        command: "npm run verify:remote-mobile-ux",
        status: "passed",
        scope: [
          "remote mobile viewport",
          "commissioner admin workflows",
          "backup restore proof",
        ],
        summary: "Remote mobile verifier passed against the Tailnet URL.",
        recordedBy: "Remote Mobile UX",
        metadata: { url: "https://duckbookpro.clouded-tailor.ts.net" },
      })
      .expect(201);

    await admin
      .post("/api/verification-runs")
      .send({
        command: "npm run verify:prod-smoke",
        status: "maybe",
        scope: ["exports"],
        summary: "bad status",
      })
      .expect(400);

    await admin
      .get("/api/verification-runs")
      .expect(200)
      .expect((res) => {
        expect(res.body.verificationRuns).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: recorded.body.verificationRun.id,
            status: "passed",
          }),
          expect.objectContaining({
            id: mobileRecorded.body.verificationRun.id,
            status: "passed",
            command: "npm run verify:remote-mobile-ux",
          }),
        ]));
      });

    await admin
      .get("/api/export/verification-runs.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          count: 2,
        });
        expect(res.body.verificationRuns).toEqual(expect.arrayContaining([
          expect.objectContaining({
            command: "npm run verify:prod-smoke",
            status: "passed",
            recordedBy: "Prod Smoke",
          }),
          expect.objectContaining({
            command: "npm run verify:remote-mobile-ux",
            status: "passed",
            recordedBy: "Remote Mobile UX",
          }),
        ]));
      });

    await admin
      .get("/api/export/verification-runs.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "created_at,command,status,recorded_by,scope,summary"
        );
        expect(res.text).toContain("npm run verify:prod-smoke,passed,Prod Smoke");
        expect(res.text).toContain(
          "npm run verify:remote-mobile-ux,passed,Remote Mobile UX"
        );
      });

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.counts.verificationRuns).toBe(2);
        expect(res.body.verificationRuns).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: recorded.body.verificationRun.id }),
          expect.objectContaining({ id: mobileRecorded.body.verificationRun.id }),
        ]));
      });

    await admin
      .get("/api/export/completion-audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          ready: false,
          appReady: false,
          statusCounts: {
            blocked: 0,
          },
          appStatusCounts: {
            blocked: 0,
          },
          leagueDataOpen: expect.any(Number),
          externalVerificationOpen: expect.any(Number),
        });
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "roster-members",
              status: "passed",
              artifactUrls: expect.arrayContaining(["/api/export/roster.csv"]),
            }),
            expect.objectContaining({
              id: "roster-ghin",
              status: "open",
              readinessScope: "league_data",
              evidence: expect.arrayContaining([
                "12 missing/unverified: Beck, Chris, Jayson Post, John, Jonny Ten Bosch, Kyle Dantzler, Matt, Max McCutcheon, Noah, Ryan, Sam Lines, Will",
              ]),
            }),
            expect.objectContaining({
              id: "money-collected",
              status: "open",
              readinessScope: "league_data",
              nextAction: "Open Money and record status evidence or leave outstanding.",
            }),
            expect.objectContaining({
              id: "score-rules",
              status: "passed",
              readinessScope: "league_data",
            }),
            expect.objectContaining({
              id: "closeout-evidence",
              status: "passed",
              requirement:
                "Every non-post tournament has closeout readiness plus packet and ledger export paths.",
              evidence: expect.arrayContaining([
                "8/8 non-post tournaments expose closeout packets and ledgers",
              ]),
              artifactUrls: expect.arrayContaining([
                "/api/export/closeout/2026-w1.txt",
                "/api/export/closeout/2026-w1.json",
              ]),
            }),
            expect.objectContaining({
              id: "commissioner-workflows",
              status: "passed",
            }),
            expect.objectContaining({
              id: "admin-surface-inventory",
              status: "passed",
              readinessScope: "app",
              evidence: expect.arrayContaining([
                expect.stringContaining("roster/GHIN"),
                expect.stringContaining("backup restore proof"),
                expect.stringContaining("advanced ops"),
              ]),
              artifactUrls: expect.arrayContaining([
                "/api/backups/verify",
                "/api/export/database",
                "/api/export/audit.json",
              ]),
            }),
            expect.objectContaining({
              id: "phone-admin-proof",
              status: "passed",
              readinessScope: "app",
              evidence: expect.arrayContaining([
                expect.stringContaining("Remote mobile proof: npm run verify:remote-mobile-ux"),
              ]),
              artifactUrls: expect.arrayContaining([
                "/api/export/verification-runs.json",
                "/api/export/verification-runs.csv",
              ]),
            }),
            expect.objectContaining({
              id: "source-search-ledger",
              status: "passed",
              artifactUrls: expect.arrayContaining([
                "/api/export/source-search-ledger.json",
                "/api/export/source-search-ledger.csv",
              ]),
            }),
            expect.objectContaining({
              id: "access-gate",
              status: "open",
              readinessScope: "app",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/completion-audit.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain(
          "id,area,requirement,status,readiness_scope,proof_strength,evidence,next_action,artifact_urls"
        );
        expect(res.text).toContain(
          "roster-ghin,Roster,Every member has a source-backed handicap index recorded.,open,league_data,direct"
        );
        expect(res.text).toContain(
          "money-collected,Money,All 2026 league buy-ins have settled status evidence.,open,league_data,direct"
        );
        expect(res.text).toContain(
          "source-search-ledger,Evidence,Known source searches behind remaining data gaps are exportable.,passed,app,direct"
        );
      });

    await admin
      .get("/api/export/source-search-ledger.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          count: 7,
          recordedFacts: 2,
          noSourceFound: 3,
          blockedSources: 1,
        });
        expect(res.body.relatedOpenItems).toEqual([
          "money-collected",
          "roster-ghin",
          "schedule-confirmed",
        ]);
        expect(res.body.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "matt-buyin-venmo",
              claimType: "fact",
              status: "recorded",
              evidenceIds: expect.arrayContaining([
                "gmail:19e3d2eb91da7bf9",
              ]),
            }),
            expect.objectContaining({
              id: "messages-access-denied",
              status: "blocked",
              relatedOpenItems: expect.arrayContaining(["money-collected"]),
            }),
          ])
        );
      });

    await admin
      .get("/api/export/source-search-ledger.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain(
          "id,area,claim_type,status,claim,source_checked,result,decision,evidence_ids,related_open_items"
        );
        expect(res.text).toContain("matt-buyin-venmo,Money,fact,recorded");
        expect(res.text).toContain("messages-access-denied,Messaging,fact,blocked");
      });

    await admin
      .get("/api/export/blocker-handoff.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          summary: {
            taskCount: expect.any(Number),
            sourceSearch: {
              count: 7,
            },
          },
        });
        expect(res.body.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              taskId: "collect-buyins",
              evidenceStatus: "blocked_source",
              sourceSearchEntryIds: expect.arrayContaining([
                "additional-buyin-searches",
              ]),
            }),
            expect.objectContaining({
              taskId: "collect-ghin-indexes",
              evidenceStatus: "blocked_source",
              sourceSearchEntryIds: expect.arrayContaining([
                "missing-ghin-searches",
              ]),
            }),
          ])
        );
      });

    await admin
      .get("/api/export/blocker-handoff.txt")
      .expect(200)
      .expect("content-type", /text\/plain/)
      .expect((res) => {
        expect(res.text).toContain("DJDI Commissioner Handoff");
        expect(res.text).toContain("[1. Track buy-in status]");
        expect(res.text).toContain("Evidence: blocked_source");
      });

    await admin
      .get("/api/export/evidence-gap-packet.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          summary: {
            total: expect.any(Number),
            onePasteReady: expect.any(Number),
            launchVerification: expect.any(Number),
          },
        });
        expect(res.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              blockerId: "money-collected",
              intakePath: "Ops > One-Paste Intake",
              pasteBackTemplate: expect.stringContaining("paid $325"),
            }),
            expect.objectContaining({
              blockerId: "iphone-safari-gate",
              intakePath: "Ops > Launch Gates",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/evidence-gap-packet.csv")
      .expect(200)
      .expect("content-type", /text\/csv/)
      .expect((res) => {
        expect(res.text).toContain(
          "id,area,blocker_id,label,owner,requested_evidence,paste_back_template,intake_path,source_status,source_decision,related_task_id"
        );
        expect(res.text).toContain("money-collected");
      });

    await admin
      .get("/api/export/evidence-gap-packet.txt")
      .expect(200)
      .expect("content-type", /text\/plain/)
      .expect((res) => {
        expect(res.text).toContain("DJDI Evidence Gap Packet");
        expect(res.text).toContain("Paste back:");
      });

    await admin
      .get("/api/export/archive.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.counts.verificationRuns).toBe(2);
        expect(res.body.verificationRuns).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: recorded.body.verificationRun.id }),
          expect.objectContaining({ id: mobileRecorded.body.verificationRun.id }),
        ]));
        expect(res.body.artifacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "verification-runs-json",
              url: "/api/export/verification-runs.json",
            }),
            expect.objectContaining({
              id: "verification-runs-csv",
              url: "/api/export/verification-runs.csv",
            }),
            expect.objectContaining({
              id: "rules-json",
              url: "/api/export/rules.json",
            }),
            expect.objectContaining({
              id: "tasks-csv",
              url: "/api/export/tasks.csv",
            }),
            expect.objectContaining({
              id: "risks-json",
              url: "/api/export/risks.json",
            }),
            expect.objectContaining({
              id: "risks-csv",
              url: "/api/export/risks.csv",
            }),
            expect.objectContaining({
              id: "request-packet",
              url: "/api/export/request-packet.txt",
            }),
            expect.objectContaining({
              id: "blocker-handoff-json",
              url: "/api/export/blocker-handoff.json",
            }),
            expect.objectContaining({
              id: "blocker-handoff-text",
              url: "/api/export/blocker-handoff.txt",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-json",
              url: "/api/export/evidence-gap-packet.json",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-csv",
              url: "/api/export/evidence-gap-packet.csv",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-text",
              url: "/api/export/evidence-gap-packet.txt",
            }),
            expect.objectContaining({
              id: "source-search-ledger-json",
              url: "/api/export/source-search-ledger.json",
            }),
            expect.objectContaining({
              id: "source-search-ledger-csv",
              url: "/api/export/source-search-ledger.csv",
            }),
            expect.objectContaining({
              id: "payouts-csv",
              url: "/api/export/payouts.csv",
            }),
            expect.objectContaining({
              id: "completion-audit-csv",
              url: "/api/export/completion-audit.csv",
            }),
            expect.objectContaining({
              id: "launch-checks-json",
              url: "/api/export/launch-checks.json",
            }),
            expect.objectContaining({
              id: "launch-checks-csv",
              url: "/api/export/launch-checks.csv",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-json",
              url: "/api/export/launch-gate-checklist.json",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-csv",
              url: "/api/export/launch-gate-checklist.csv",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-text",
              url: "/api/export/launch-gate-checklist.txt",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.events.map((event: any) => event.action)).toContain(
          "verification_run_record"
        );
      });
  });

  it("requires an attester for regular tee-time scores", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
    }, 400);
  });

  it("rejects regular tee-time scores from drop-ins", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex", false);
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    }, 400);
  });

  it("requires course handicap for regular tee-time scores", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      attestedBy: "Greg",
    }, 400);
  });

  it("rejects regular tee-time scores self-attested by the player", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Alex",
    }, 400);
  });

  it("requires a regular score attester to be both claimed on the tee time and a member", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    await createMember(app, "Morgan");
    await createMember(app, "Drop In", false);
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Morgan",
    }, 400);

    await claimSpot(app, teeTime.id, "Drop In");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Drop In",
    }, 400);

    const scored = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });
    const score = scored.body.teeTime.scores.find(
      (candidate: any) => candidate.name === "Alex"
    );
    expect(score).toMatchObject({
      attestedBy: "Greg",
      attestationStatus: "pending",
      net: 70,
      courseHcpSource: "manual_unverified",
    });
    expect(score.attestedAt).toBe(null);
    await attestScore(app, teeTime.id, "Alex", "Greg");
  });

  it("keeps selected-attester scores out of standings until confirmed", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,0,0,0,1,0,0,0,1,0,,,,`
        );
      });

    await admin
      .get("/api/export/readiness.json")
      .expect(200)
      .expect((res) => {
        const alex = res.body.standings.find((row: any) => row.name === "Alex");
        expect(alex).toMatchObject({
          rounds: 0,
          seasonPoints: 0,
          scoreStatusCounts: {
            official: 0,
            pending: 1,
            attested: 0,
            total: 1,
          },
        });
      });

    await attestScore(app, teeTime.id, "Alex", "Greg");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 79,
      courseHcp: 10,
      attestedBy: "Greg",
    }, 403);

    await admin
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({
        name: "Alex",
        gross: 79,
        courseHcp: 10,
        attestedBy: "Greg",
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.teeTime.scores[0]).toMatchObject({
          name: "Alex",
          gross: 79,
          attestationStatus: "pending",
          attestedAt: null,
          attestationActor: null,
        });
      });

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,0,0,0,1,0,0,0,1,0,,,,`
        );
      });

    await attestScore(app, teeTime.id, "Alex", "Greg");

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,1,1,0,0,1,0,0,1,100,69,69,79,79`
        );
      });
  });

  it("lets the selected attester confirm legacy scores that only stored an attester name", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });

    const row = db.prepare("select scores from tee_times where id = ?").get(teeTime.id) as
      | { scores: string }
      | undefined;
    expect(row).toBeTruthy();
    const legacyScores = (JSON.parse(row!.scores) as Array<Record<string, unknown>>).map(
      (score) =>
        score.name === "Alex"
          ? {
              ...score,
              attestationStatus: undefined,
              attestedAt: undefined,
              attestationActor: undefined,
            }
          : score
    );
    db.prepare("update tee_times set scores = ? where id = ?").run(
      JSON.stringify(legacyScores),
      teeTime.id
    );

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,0,0,0,0,0,0,1,1,0,,,,`
        );
      });

    await attestScore(app, teeTime.id, "Alex", "Greg");

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,1,1,0,0,1,0,0,1,100,70,70,80,80`
        );
      });
  });

  it("rejects a newly minted profile trying to attest another player's claimed spot", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });

    const impostor = await request(app)
      .post("/api/profile")
      .send({ name: "Greg" })
      .expect(200);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores/Alex/attest`)
      .set("Cookie", impostor.headers["set-cookie"])
      .send({ name: "Greg" })
      .expect(403);

    await attestScore(app, teeTime.id, "Alex", "Greg");
  });

  it("records commissioner score attestation overrides as official overrides", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    await createMember(app, "Morgan");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");
    await claimSpot(app, teeTime.id, "Morgan");

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Morgan",
    });

    const overridden = await admin
      .post(`/api/teetimes/${teeTime.id}/scores/Alex/attest`)
      .send({})
      .expect(200);
    expect(overridden.body.teeTime.scores[0]).toMatchObject({
      name: "Alex",
      attestedBy: "Morgan",
      attestationStatus: "overridden",
      attestationActor: "Commissioner",
      net: 70,
    });
    expect(overridden.body.teeTime.scores[0].attestedAt).toBeTruthy();

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Alex,1,1,0,0,0,1,0,1,100,70,70,80,80`
        );
      });
  });

  it("stores course handicap calculation inputs and labels manual overrides", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app, "Greg");
    await claimSpot(app, teeTime.id, "Alex");

    const calculatedScore = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
      teeName: "Blue",
      teeRating: 70.1,
      teeSlope: 125,
      teePar: 72,
      handicapIndexUsed: 10.6,
    });
    expect(calculatedScore.body.teeTime.scores[0]).toMatchObject({
      name: "Alex",
      roundCourse: teeTime.course,
      roundDate: teeTime.date,
      teeName: "Blue",
      teeRating: 70.1,
      teeSlope: 125,
      teePar: 72,
      handicapIndexUsed: 10.6,
      calculatedCourseHcp: 9.8,
      courseHcpRounded: 10,
      net: 70,
      courseHcpSource: "calculated",
      courseHcpOverride: false,
      });
    expect(calculatedScore.body.teeTime.scores[0].courseHcpVerifiedAt).toBeTruthy();

    const overrideScore = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 12,
      attestedBy: "Greg",
      teeName: "Blue",
      teeRating: 70.1,
      teeSlope: 125,
      teePar: 72,
      handicapIndexUsed: 10.6,
    });
    expect(overrideScore.body.teeTime.scores[0]).toMatchObject({
      calculatedCourseHcp: 9.8,
      courseHcpRounded: 10,
      net: 68,
      courseHcpSource: "commissioner_override",
      courseHcpOverride: true,
    });
  });

  it("does not let a typed course handicap self-label as GHIN without calculation inputs", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app, "Greg");
    await claimSpot(app, teeTime.id, "Alex");

    const typedScore = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
      courseHcpSource: "ghin",
    });
    expect(typedScore.body.teeTime.scores[0]).toMatchObject({
      courseHcp: 10,
      courseHcpSource: "manual_unverified",
      courseHcpVerifiedAt: null,
      courseHcpOverride: false,
      calculatedCourseHcp: null,
      courseHcpRounded: null,
    });

    const verifiedScore = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
      courseHcpSource: "ghin",
      teeName: "Blue",
      teeRating: 70.1,
      teeSlope: 125,
      teePar: 72,
      handicapIndexUsed: 10.6,
    });
    expect(verifiedScore.body.teeTime.scores[0]).toMatchObject({
      courseHcpSource: "ghin",
      calculatedCourseHcp: 9.8,
      courseHcpRounded: 10,
      courseHcpOverride: false,
    });
    expect(verifiedScore.body.teeTime.scores[0].courseHcpVerifiedAt).toBeTruthy();

    const unverifiedCalculatedScore = await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
      courseHcpSource: "calculated_unverified",
      teeName: "Blue",
      teeRating: 70.1,
      teeSlope: 125,
      teePar: 72,
      handicapIndexUsed: 10.6,
    });
    expect(unverifiedCalculatedScore.body.teeTime.scores[0]).toMatchObject({
      courseHcpSource: "calculated_unverified",
      calculatedCourseHcp: 9.8,
      courseHcpRounded: 10,
      courseHcpOverride: false,
      courseHcpVerifiedAt: null,
    });
  });

  it("prevents scored players and attesters from being removed from the tee time", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await claimSpot(app, teeTime.id, "Alex");
    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });
    const alexCookie = await profileCookie(app, "Alex");
    const gregCookie = await profileCookie(app, "Greg");

    await request(app)
      .delete(`/api/teetimes/${teeTime.id}/claims/Alex`)
      .set("Cookie", alexCookie)
      .expect(409);
    await request(app)
      .delete(`/api/teetimes/${teeTime.id}/claims/Greg`)
      .set("Cookie", gregCookie)
      .expect(409);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/interested`)
      .set("Cookie", alexCookie)
      .send({ name: "Alex" })
      .expect(409);
  });

  it("renames a player across profile, buy-ins, claims, scores, and attesters", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Jayson Post");
    await createMember(app, "Matt");
    const teeTime = await createRegularTeeTime(app, "Jason");
    const admin = await commissionerAgent(app);
    await claimSpot(app, teeTime.id, "Matt");
    await admin
      .post("/api/admin/rename-player")
      .send({ from: "Jason", to: "Jayson Post" })
      .expect(200);
    await scoreAsHost(app, teeTime.id, "Jayson Post", {
        name: "Jayson Post",
        gross: 82,
        courseHcp: 12,
        attestedBy: "Matt",
      });
    const mergeIntoScorer = await admin
      .post("/api/admin/rename-player")
      .send({ from: "Matt", to: "Jayson Post" })
      .expect(200);
    expect(
      mergeIntoScorer.body.issues.some(
        (issue: any) => issue.message === "Self-attested score"
      )
    ).toBe(true);

    const teeTimes = await request(app).get("/api/teetimes").expect(200);
    const updated = teeTimes.body.teeTimes.find((t: any) => t.id === teeTime.id);
    expect(updated.host).toBe("Jayson Post");
    expect(updated.claims.map((claim: any) => claim.name)).toEqual([
      "Jayson Post",
    ]);
    expect(updated.scores[0]).toMatchObject({
      name: "Jayson Post",
      attestedBy: "Jayson Post",
    });
  });

  it("updates seeded tournament details so commissioner can clear TBD schedule risks", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .patch("/api/tournaments/2026-major/details")
      .send({
        course: "Fossil Trace",
        windowStart: "2026-07-18",
        windowEnd: "2026-07-18",
        pointsToFirst: null,
        payoutFirst: 500,
        payoutSecond: 200,
        payoutThird: 100,
        notes: "Confirmed single-day major.",
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.tournament).toMatchObject({
          id: "2026-major",
          course: "Fossil Trace",
          windowStart: "2026-07-18",
          windowEnd: "2026-07-18",
          pointsToFirst: null,
          payoutFirst: 500,
          payoutSecond: 200,
          payoutThird: 100,
          notes: "Confirmed single-day major.",
        });
      });

    await admin
      .patch("/api/tournaments/2026-post/details")
      .send({
        course: "Common Ground / Riverdale Dunes",
        windowStart: "2026-10-10",
        windowEnd: "2026-10-11",
        notes: "Confirmed two-day championship.",
      })
      .expect(200);

    await admin
      .patch("/api/tournaments/2026-major/details")
      .send({
        course: "Fossil Trace",
        windowStart: "2026-07-20",
        windowEnd: "2026-07-18",
      })
      .expect(400);

    await admin
      .patch("/api/tournaments/2026-major/details")
      .send({
        payoutFirst: 1.5,
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe(
          "First payout must be a whole number between 0 and 100000"
        );
      });

    await admin
      .get("/api/export/summary.txt")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("OK - Schedule: All event details confirmed");
        expect(res.text).not.toContain("Schedule confirmation:");
      });
  });

  it("applies mixed blocker intake atomically with one audit event", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .post("/api/admin/blocker-intake")
      .send({
        actor: "Jayson Post",
        text: [
          "Beck paid cash $325 2026-05-19",
          "Chris GHIN 1234567 index 11.4 paid",
          "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
        ].join("\n"),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.counts).toEqual({
          payments: 1,
          handicaps: 1,
          schedules: 1,
        });
        expect(res.body.updated.buyins[0]).toMatchObject({
          playerName: "Beck",
          paid: true,
          paymentStatus: "paid",
          paymentMethod: "cash",
          paymentActor: "Jayson Post",
          amount: 325,
          paidAt: "2026-05-19",
          notes: "Beck paid cash $325 2026-05-19",
        });
        expect(res.body.updated.players[0]).toMatchObject({
          name: "Chris",
          handicap: 11.4,
          ghinNumber: "1234567",
        });
        expect(res.body.updated.tournaments[0]).toMatchObject({
          id: "2026-post",
          course: "Fossil Trace",
          windowStart: "2026-10-10",
          windowEnd: "2026-10-11",
          notes: "finals",
        });
      });

    await admin
      .get("/api/buyins")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Beck")
        ).toMatchObject({
          paid: true,
          paymentStatus: "paid",
          amount: 325,
          paidAt: "2026-05-19",
        });
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Chris")
        ).toMatchObject({
          paid: false,
          paymentStatus: "unpaid",
          amount: 325,
          notes: null,
        });
      });

    await admin
      .get("/api/export/buyins.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          "Beck,325,paid,yes,cash,Jayson Post,2026-05-19,0,Beck paid cash $325 2026-05-19,"
        );
      });

    await request(app)
      .get("/api/players")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.players.find((player: any) => player.name === "Chris")
        ).toMatchObject({
          handicap: 11.4,
          handicapSourceType: "ghin",
        });
      });

    await admin
      .get("/api/players")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.players.find((player: any) => player.name === "Chris")
        ).toMatchObject({
          ghinNumber: "1234567",
          handicap: 11.4,
          handicapSourceType: "ghin",
          handicapSource: "Chris GHIN 1234567 index 11.4 paid",
          handicapNote: "Chris GHIN 1234567 index 11.4 paid",
        });
      });

    await request(app)
      .get("/api/tournaments")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.tournaments.find(
            (tournament: any) => tournament.id === "2026-post"
          )
        ).toMatchObject({ course: "Fossil Trace" });
      });

    await admin
      .get("/api/export/audit.json")
      .expect(200)
      .expect((res) => {
        const bulkEvents = res.body.events.filter(
          (event: any) => event.action === "bulk_intake_apply"
        );
        expect(bulkEvents).toHaveLength(1);
        expect(bulkEvents[0]).toMatchObject({
          actor: "Jayson Post",
          subjectType: "commissioner_intake",
        });
        expect(bulkEvents[0].metadata.total).toBe(3);
      });
  });

  it("records promised payments without marking them paid", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .post("/api/admin/blocker-intake")
      .send({
        actor: "Jayson Post",
        text: ["Beck can pay Friday", "Chris will Venmo tomorrow"].join("\n"),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.counts.payments).toBe(2);
        expect(res.body.updated.buyins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              playerName: "Beck",
              paid: false,
              paymentStatus: "promised",
              notes: "Beck can pay Friday",
            }),
            expect.objectContaining({
              playerName: "Chris",
              paid: false,
              paymentStatus: "promised",
              paymentMethod: "venmo",
              notes: "Chris will Venmo tomorrow",
            }),
          ])
        );
      });

    await admin
      .get("/api/export/buyins.csv")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain(
          "Beck,325,promised,no,,Jayson Post,,325,Beck can pay Friday,"
        );
        expect(res.text).toContain(
          "Chris,325,promised,no,venmo,Jayson Post,,325,Chris will Venmo tomorrow,"
        );
      });
  });

  it("does not mark vague one-paste payment chatter as paid", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .post("/api/admin/blocker-intake")
      .send({
        actor: "Jayson Post",
        text: ["Beck paid cash", "Chris paid venmo", "Ryan paid cash $325"].join(
          "\n"
        ),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.counts.payments).toBe(0);
        expect(res.body.updated.buyins).toEqual([]);
      });

    await admin
      .get("/api/buyins")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Beck")
        ).toMatchObject({ paid: false, paymentStatus: "unpaid", paidAt: null });
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Chris")
        ).toMatchObject({ paid: false, paymentStatus: "unpaid", paidAt: null });
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Ryan")
        ).toMatchObject({ paid: false, paymentStatus: "unpaid", paidAt: null });
      });
  });

  it("rolls back mixed blocker intake if any matched update is invalid", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await admin
      .post("/api/admin/blocker-intake")
      .send({
        text: [
          "Beck paid cash $325 2026-05-19",
          `Championship — 2-day post-season: Fossil Trace, 2026-10-10, ${"x".repeat(
            260
          )}`,
        ].join("\n"),
      })
      .expect(400);

    await admin
      .get("/api/buyins")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.buyins.find((buyin: any) => buyin.playerName === "Beck")
        ).toMatchObject({ paid: false, paidAt: null });
      });

    await admin
      .get("/api/export/audit.json")
      .expect(200)
      .expect((res) => {
        expect(
          res.body.events.some(
            (event: any) => event.action === "bulk_intake_apply"
          )
        ).toBe(false);
      });
  });

  it("rejects closeout while rule blockers exist and locks edits after closeout", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app, "Greg");
    await claimSpot(app, teeTime.id, "Alex");

    const tournaments = await request(app).get("/api/tournaments").expect(200);
    const regular = tournaments.body.tournaments.find(
      (tournament: any) => tournament.id === "2026-w2"
    );
    expect(regular).toBeTruthy();
    await admin
      .patch(`/api/tournaments/${regular.id}/payout`)
      .send({ payoutConfirmed: true })
      .expect(409);
    await admin
      .post(`/api/tournaments/${regular.id}/closeout`)
      .send({ closedBy: "Greg", force: true })
      .expect(409);

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 80,
      courseHcp: 10,
      attestedBy: "Greg",
    });
    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Greg",
      gross: 82,
      courseHcp: 10,
      attestedBy: "Alex",
    });
    await attestScore(app, teeTime.id, "Alex", "Greg");
    await attestScore(app, teeTime.id, "Greg", "Alex");

    await admin
      .post(`/api/tournaments/${regular.id}/closeout`)
      .send({ closedBy: "Greg" })
      .expect(409);

    const closed = await admin
      .post(`/api/tournaments/${regular.id}/closeout`)
      .send({ closedBy: "Greg", force: true, notes: "Scores reviewed" })
      .expect(200);
    expect(closed.body.tournament.closedAt).toBeTruthy();
    expect(closed.body.tournament.winnerSnapshot.length).toBeGreaterThan(0);

    await admin
      .get(`/api/export/closeout/${regular.id}.txt`)
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("DJDI Tournament Closeout Packet");
        expect(res.text).toContain(`Rules version: ${ACTIVE_RULES_VERSION}`);
        expect(res.text).toContain(`Tournament: ${regular.name}`);
        expect(res.text).toContain("Status: closed");
        expect(res.text).toContain("1. Alex: 80 gross, 70 net");
        expect(res.text).toContain(
          "- Greg (member): 82 gross, CH 10, net 72, official:attested, attested by Alex"
        );
        expect(res.text).toContain("Score Review\nNone");
      });

    await admin
      .get(`/api/export/closeout/${regular.id}.json`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          rulesVersion: ACTIVE_RULES_VERSION,
          tournament: {
            id: regular.id,
            name: regular.name,
            closedBy: "Greg",
          },
          readiness: {
            status: "closed",
            issueCount: 0,
          },
          integrity: {
            rulesVersion: ACTIVE_RULES_VERSION,
            closed: true,
            snapshotMatchesCurrent: true,
            scoreEvidenceRows: 2,
            ruleBlockers: 0,
          },
          payout: {
            first: regular.payoutFirst,
            projectedWinner: {
              name: "Alex",
              bestNet: 70,
            },
          },
        });
        expect(res.body.scoreEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              player: "Greg",
              gross: 82,
              courseHcp: 10,
              net: 72,
              netSource: "course_hcp",
              attestationStatus: "attested",
              official: true,
              attestedBy: "Alex",
              attesterMember: true,
              attesterClaimed: true,
              selfAttested: false,
            }),
          ])
        );
      });

    await admin
      .patch(`/api/tournaments/${regular.id}/payout`)
      .send({ payoutPaid: true })
      .expect(409);
    await admin
      .patch(`/api/tournaments/${regular.id}/payout`)
      .send({ payoutConfirmed: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.tournament.payoutConfirmed).toBe(true);
        expect(res.body.tournament.payoutPaidAt).toBe(null);
      });
    await admin
      .patch(`/api/tournaments/${regular.id}/payout`)
      .send({ payoutPaid: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.tournament.payoutPaidAt).toBeTruthy();
      });
    await admin
      .get(`/api/export/closeout/${regular.id}.json`)
      .expect(200)
      .expect((res) => {
        expect(res.body.payout).toMatchObject({
          evidenceStatus: "missing_evidence",
          evidenceNote: null,
          evidenceMissing: true,
        });
        expect(res.body.integrity.payoutEvidenceMissing).toBe(true);
      });
    await admin
      .get(`/api/export/closeout/${regular.id}.txt`)
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("Payout evidence: missing settlement note");
      });
    await admin
      .get("/api/export/completion-audit.json")
      .expect(200)
      .expect((res) => {
        const item = res.body.items.find(
          (auditItem: any) => auditItem.id === "payout-evidence"
        );
        expect(item).toMatchObject({
          status: "open",
          requirement: "Paid tournament payouts have settlement/evidence notes.",
        });
      });
    await admin
      .patch(`/api/tournaments/${regular.id}/payout`)
      .send({ notes: "Venmo paid Alex 2026-05-25" })
      .expect(200)
      .expect((res) => {
        expect(res.body.tournament.closeoutNotes).toBe("Scores reviewed");
        expect(res.body.tournament.payoutEvidenceNote).toBe(
          "Venmo paid Alex 2026-05-25"
        );
      });
    await admin
      .get(`/api/export/closeout/${regular.id}.json`)
      .expect(200)
      .expect((res) => {
        expect(res.body.payout).toMatchObject({
          evidenceStatus: "evidenced",
          evidenceNote: "Venmo paid Alex 2026-05-25",
          evidenceMissing: false,
        });
        expect(res.body.integrity.payoutEvidenceMissing).toBe(false);
      });

    await admin
      .get("/api/export/audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
        });
        expect(res.body.events.map((event: any) => event.action)).toEqual(
          expect.arrayContaining([
            "player_update",
            "tee_time_create",
            "score_create",
            "tournament_closeout",
            "tournament_payout_update",
          ])
        );
        expect(
          res.body.events.find(
            (event: any) => event.action === "tournament_closeout"
          )
        ).toMatchObject({
          actor: "Greg",
          subjectType: "tournament",
          subjectId: regular.id,
          summary: `Closed ${regular.name}`,
        });
      });

    await admin
      .get("/api/export/audit.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "created_at,action,actor,subject_type,subject_id,summary"
        );
        expect(res.text).toContain("tournament_closeout");
      });

    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 79,
      courseHcp: 10,
      attestedBy: "Greg",
    }, 409);
    await admin
      .delete(`/api/teetimes/${teeTime.id}/scores/Alex`)
      .expect(409);
    await claimSpot(app, teeTime.id, "Morgan", 409);

    await admin
      .post(`/api/tournaments/${regular.id}/reopen`)
      .expect(200)
      .expect((res) => {
        expect(res.body.tournament.payoutConfirmed).toBe(false);
        expect(res.body.tournament.payoutPaidAt).toBe(null);
      });
    await scoreAsHost(app, teeTime.id, "Greg", {
      name: "Alex",
      gross: 79,
      courseHcp: 10,
      attestedBy: "Greg",
    }, 403);
    await admin
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({
        name: "Alex",
        gross: 79,
        courseHcp: 10,
        attestedBy: "Greg",
      })
      .expect(200);
  });

  it("exports JSON, summary text, and a SQLite database backup", async () => {
    process.env.DJDI_TODAY = "2026-05-18";
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });
    const admin = await commissionerAgent(app);
    const hostCookie = await profileCookie(app, "Jayson Post");

    const teeTime = await request(app)
      .post("/api/teetimes")
      .set("Cookie", hostCookie)
      .send({
        course: "Common Ground",
        date: "2026-05-18",
        time: "10:00",
        spots: 4,
        host: "Jayson Post",
      })
      .expect(201);
    await claimSpot(app, teeTime.body.teeTime.id, "Kyle Dantzler");
    await claimSpot(app, teeTime.body.teeTime.id, "Max McCutcheon");
    await scoreAsHost(app, teeTime.body.teeTime.id, "Jayson Post", {
        name: "Jayson Post",
        gross: 82,
        courseHcp: 12,
        attestedBy: "Kyle Dantzler",
        teeName: "Blue",
        teeRating: 70.1,
        teeSlope: 125,
        teePar: 72,
        handicapIndexUsed: 10.6,
      });
    await scoreAsHost(app, teeTime.body.teeTime.id, "Jayson Post", {
        name: "Kyle Dantzler",
        gross: 79,
        courseHcp: 4,
        attestedBy: "Jayson Post",
      });
    await scoreAsHost(app, teeTime.body.teeTime.id, "Jayson Post", {
        name: "Max McCutcheon",
        gross: 85,
        courseHcp: 14,
        attestedBy: "Kyle Dantzler",
      });
    await attestScore(
      app,
      teeTime.body.teeTime.id,
      "Jayson Post",
      "Kyle Dantzler"
    );
    await attestScore(
      app,
      teeTime.body.teeTime.id,
      "Kyle Dantzler",
      "Jayson Post"
    );

    await admin
      .get("/api/export/season.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.app).toBe("DJDI Golf Board");
        expect(res.body.rulesVersion).toBe(ACTIVE_RULES_VERSION);
        expect(res.body.rules.version).toBe(ACTIVE_RULES_VERSION);
        expect(Array.isArray(res.body.tournaments)).toBe(true);
      });

    await admin
      .get("/api/export/roster.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "name,member,ghin_number,handicap_index,handicap_source_type,handicap_source,handicap_note,handicap_verified_at,handicap_verified_by,buyin_amount,buyin_paid,buyin_paid_at,buyin_notes,profile_updated_at"
        );
        expect(res.text).toContain("Jayson Post,yes,,10.6,,,,,,325,no,,,");
        expect(res.text).toContain("Max McCutcheon,yes,,14.1,,,,,,325,no,,,");
      });

    await admin
      .get("/api/export/scores.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "rules_version,tournament,tee_time_id,date,time,course,host,player,gross,round_course,round_date,tee_name,tee_rating,tee_slope,tee_par,handicap_index_used,calculated_course_hcp,course_hcp_rounded,course_hcp,profile_hcp,net,net_source,attested_by,attestation_status,attested_at,attestation_actor,entered_by,course_hcp_source,course_hcp_verified_at,course_hcp_override,recorded_at"
        );
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},Stop 1 — Common Ground,${teeTime.body.teeTime.id},2026-05-18,10:00,Common Ground,Jayson Post,Jayson Post,82,Common Ground,2026-05-18,Blue,70.1,125,72,10.6,9.8,10,12,10.6,70,course_hcp,Kyle Dantzler,attested,`
        );
        expect(res.text).toContain(
          ",Kyle Dantzler,Jayson Post,commissioner_override,"
        );
        expect(res.text).toContain(
          ",yes,"
        );
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},Stop 1 — Common Ground,${teeTime.body.teeTime.id},2026-05-18,10:00,Common Ground,Jayson Post,Kyle Dantzler,79,Common Ground,2026-05-18,,,,,,,,4,3.6,75,course_hcp,Jayson Post,attested,`
        );
      });

    await admin
      .get("/api/export/tee-times.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "tee_time_id,date,time,course,host,status,spots,committed_count,committed_players,maybe_count,maybe_players,guest_count,score_count,pending_attestations,comments_count,notes,tournament,created_at"
        );
        expect(res.text).toContain(
          `${teeTime.body.teeTime.id},2026-05-18,10:00,Common Ground,Jayson Post,open,4,3,Jayson Post; Kyle Dantzler; Max McCutcheon,0,,0,3,1,0,,Stop 1 — Common Ground,`
        );
      });

    await admin
      .get("/api/export/attestations.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "tee_time_id,date,time,course,player,gross,course_hcp,net,selected_attester,attestation_status,attested_at,attestation_actor,entered_by,recorded_at"
        );
        expect(res.text).toContain(
          `${teeTime.body.teeTime.id},2026-05-18,10:00,Common Ground,Jayson Post,82,12,70,Kyle Dantzler,attested,`
        );
        expect(res.text).toContain(
          `${teeTime.body.teeTime.id},2026-05-18,10:00,Common Ground,Max McCutcheon,85,14,71,Kyle Dantzler,pending,`
        );
      });

    await admin
      .get("/api/export/payouts.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "rules_version,tournament_id,tournament,type,closed,closed_at,closed_by,winner,winner_net,second,second_net,third,third_net,payout_first,payout_second,payout_third,payout_confirmed,payout_paid_at,evidence_status,evidence_note,evidence_missing,closeout_packet_url,closeout_ledger_url"
        );
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},2026-w1,Stop 1 — Common Ground,regular,no,,,Jayson Post,70,Kyle Dantzler,75,,,334,,,no,,not_paid,,no,/api/export/closeout/2026-w1.txt,/api/export/closeout/2026-w1.json`
        );
      });

    await admin
      .get("/api/export/standings.csv")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.text).toContain(
          "rules_version,rank,player,rounds,official_rounds,draft_scores,pending_scores,attested_scores,overridden_scores,legacy_unconfirmed_scores,total_scores,season_points,avg_net,best_net,avg_gross,best_gross"
        );
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},1,Jayson Post,1,1,0,0,1,0,0,1,100,70,70,82,82`
        );
        expect(res.text).toContain(
          `${ACTIVE_RULES_VERSION},3,Max McCutcheon,0,0,0,1,0,0,0,1,0,,,,`
        );
      });

    await admin
      .get("/api/export/summary.txt")
      .expect(200)
      .expect((res) => {
        expect(res.text).toContain("DJDI Golf Board Season Summary");
        expect(res.text).toContain(`Rules version: ${ACTIVE_RULES_VERSION}`);
        expect(res.text).toContain("Commissioner Readiness");
        expect(res.text).toContain("OK - Roster: 12 members and 12 buy-ins seeded");
        expect(res.text).toContain("RISK - Money: $3,900 outstanding");
        expect(res.text).toContain("BLOCKER - Rules: 1 score needs review");
        expect(res.text).toContain(
          "Max McCutcheon: Score attestation is still pending"
        );
        expect(res.text).toContain(
          "RISK - Handicaps: 12 missing/unverified: Beck, Chris, Jayson Post, John, Jonny Ten Bosch, Kyle Dantzler, Matt, Max McCutcheon, Noah, Ryan, Sam Lines, Will"
        );
        expect(res.text).toContain(
          "RISK - Schedule: 2 TBD: Mid-season major, Championship — 2-day post-season"
        );
        expect(res.text).toContain(
          "OK - Exports: JSON, summary, DB backup, backup verify, persistence verify, and prod smoke available"
        );
        expect(res.text).toContain("League Checklist");
        expect(res.text).toContain(
          "RISK - Buy-in tracking: $3,900 outstanding"
        );
        expect(res.text).toContain(
          "Action: Open Money and update status evidence or leave open: Beck, Chris, Jayson Post, John + 8 more."
        );
        expect(res.text).toContain(
          "Action: Open Roster and record source-backed handicap indexes for Beck, Chris, Jayson Post, John + 8 more."
        );
        expect(res.text).toContain(
          "Action: Open Ops Schedule Confirmation and replace TBD details for Championship — 2-day post-season, Mid-season major."
        );
        expect(res.text).toContain(
          "EXTERNAL - Access code: ACCESS_CODE is not set in this runtime; set it before public deploy"
        );
        expect(res.text).toContain(
          "EXTERNAL - Docker image build: Run npm run verify:docker, then set DJDI_DOCKER_BUILD_VERIFIED=1"
        );
        expect(res.text).toContain(
          "EXTERNAL - Tailnet URL: Tailscale Funnel URL is not recorded as verified in this runtime"
        );
        expect(res.text).toContain(
          "EXTERNAL - iPhone Safari: Physical iPhone Safari golden path is not verified in this local run"
        );
        expect(res.text).toContain(
          "Action: Open the deployed URL on iPhone Safari and complete the board, claim, score, Ops, and export path."
        );
        expect(res.text).toContain("12 members:");
        expect(res.text).toContain("Expected: $3,900");
        expect(res.text).toContain("Outstanding: $3,900");
        expect(res.text).toContain("Active Stop Snapshot");
        expect(res.text).toContain("Stop 1 — Common Ground through 2026-05-24");
        expect(res.text).toContain("Leader: Jayson Post net 70");
        expect(res.text).toContain("1. Jayson Post: 82 gross, 70 net");
        expect(res.text).toContain("2. Kyle Dantzler: 79 gross, 75 net");
        expect(res.text).toContain(
          "Still to score: Beck, Chris, John, Jonny Ten Bosch, Matt, Max McCutcheon, Noah, Ryan, Sam Lines, Will"
        );
        expect(res.text).toContain("Season Standings");
        expect(res.text).toContain("Jayson Post: 100 pts, 1 round, avg net 70.0");
        expect(res.text).toContain("Kyle Dantzler: 80 pts, 1 round, avg net 75.0");
        expect(res.text).toContain("Post-season Seeds");
        expect(res.text).toContain("1. Jayson Post: 100 pts, -4 strokes");
        expect(res.text).toContain("2. Kyle Dantzler: 80 pts, -3 strokes");
      });

    await admin
      .get("/api/export/archive.json")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          app: "DJDI Golf Board",
          version: 1,
          status: {
            ready: false,
          },
          counts: {
            members: 12,
            buyins: 12,
            tournaments: 9,
            scores: 3,
          },
          money: {
            expected: 3900,
            outstanding: 3900,
          },
        });
        expect(res.body.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(res.body.artifacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "season-json",
              url: "/api/export/season.json",
            }),
            expect.objectContaining({
              id: "audit-json",
              url: "/api/export/audit.json",
            }),
            expect.objectContaining({
              id: "verification-runs-json",
              url: "/api/export/verification-runs.json",
            }),
            expect.objectContaining({
              id: "completion-audit-json",
              url: "/api/export/completion-audit.json",
            }),
            expect.objectContaining({
              id: "tasks-csv",
              url: "/api/export/tasks.csv",
            }),
            expect.objectContaining({
              id: "risks-json",
              url: "/api/export/risks.json",
            }),
            expect.objectContaining({
              id: "risks-csv",
              url: "/api/export/risks.csv",
            }),
            expect.objectContaining({
              id: "request-packet",
              url: "/api/export/request-packet.txt",
            }),
            expect.objectContaining({
              id: "blocker-handoff-json",
              url: "/api/export/blocker-handoff.json",
            }),
            expect.objectContaining({
              id: "blocker-handoff-text",
              url: "/api/export/blocker-handoff.txt",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-json",
              url: "/api/export/evidence-gap-packet.json",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-csv",
              url: "/api/export/evidence-gap-packet.csv",
            }),
            expect.objectContaining({
              id: "evidence-gap-packet-text",
              url: "/api/export/evidence-gap-packet.txt",
            }),
            expect.objectContaining({
              id: "source-search-ledger-json",
              url: "/api/export/source-search-ledger.json",
            }),
            expect.objectContaining({
              id: "source-search-ledger-csv",
              url: "/api/export/source-search-ledger.csv",
            }),
            expect.objectContaining({
              id: "completion-audit-csv",
              url: "/api/export/completion-audit.csv",
            }),
            expect.objectContaining({
              id: "launch-checks-json",
              url: "/api/export/launch-checks.json",
            }),
            expect.objectContaining({
              id: "launch-checks-csv",
              url: "/api/export/launch-checks.csv",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-json",
              url: "/api/export/launch-gate-checklist.json",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-csv",
              url: "/api/export/launch-gate-checklist.csv",
            }),
            expect.objectContaining({
              id: "launch-gate-checklist-text",
              url: "/api/export/launch-gate-checklist.txt",
            }),
            expect.objectContaining({
              id: "database",
              url: "/api/export/database",
            }),
          ])
        );
        expect(res.body.closeouts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              tournamentId: "2026-w1",
              packetUrl: "/api/export/closeout/2026-w1.txt",
              ledgerUrl: "/api/export/closeout/2026-w1.json",
            }),
          ])
        );
        expect(res.body.remainingRisks.map((risk: any) => risk.label)).toEqual(
          expect.arrayContaining(["Buy-in tracking", "Handicap records"])
        );
        expect(res.body.completionAudit).toMatchObject({
          ready: false,
          appReady: expect.any(Boolean),
          leagueDataOpen: expect.any(Number),
          externalVerificationOpen: expect.any(Number),
          url: "/api/export/completion-audit.json",
        });
      });

    await admin
      .get("/api/export/database")
      .expect(200)
      .expect((res) => {
        expect(res.headers["content-disposition"]).toContain(".db");
      });

    await admin
      .post("/api/backups/verify")
      .send({ actor: "Test Commissioner" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          ok: true,
          sourceQuickCheck: "ok",
          backupQuickCheck: "ok",
          counts: {
            members: 12,
            buyins: 12,
            tournaments: 9,
          },
        });
        expect(res.body.backupBytes).toBeGreaterThan(0);
        expect(res.body.tables).toEqual(
          expect.arrayContaining(["players", "tee_times", "league_buyins"])
        );
      });

    await admin
      .get("/api/export/audit.json")
      .expect(200)
      .expect((res) => {
        expect(res.body.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "backup_restore_verify",
              actor: "Test Commissioner",
              subjectType: "database",
            }),
          ])
        );
      });
  });
});
