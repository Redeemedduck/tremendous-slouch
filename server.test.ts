import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, createDb } from "./server";

const dbFiles: string[] = [];
const dbHandles: Array<ReturnType<typeof createDb>> = [];

function tempDbPath() {
  const file = path.join(
    os.tmpdir(),
    `djdi-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`
  );
  dbFiles.push(file);
  return file;
}

afterEach(() => {
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
  await request(app)
    .put(`/api/players/${encodeURIComponent(name)}`)
    .send({ handicap: 10, member })
    .expect(200);
}

async function findRegularTournament(app: ReturnType<typeof createApp>) {
  const tournaments = await request(app).get("/api/tournaments").expect(200);
  const regular = tournaments.body.tournaments.find(
    (tournament: any) => tournament.type === "regular"
  );
  expect(regular?.windowStart).toBeTruthy();
  return regular;
}

async function createRegularTeeTime(
  app: ReturnType<typeof createApp>,
  host = "Greg"
) {
  const regular = await findRegularTournament(app);
  const created = await request(app)
    .post("/api/teetimes")
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

describe("server app factory", () => {
  it("serves seeded tee times from a temp database", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    const response = await request(app).get("/api/teetimes").expect(200);

    expect(Array.isArray(response.body.teeTimes)).toBe(true);
    expect(response.body.teeTimes.length).toBeGreaterThan(0);
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

  it("rejects a regular tee-time score for an unclaimed player", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");

    const created = await createRegularTeeTime(app);

    await request(app)
      .post(`/api/teetimes/${created.id}/claims`)
      .send({ name: "Greg" })
      .expect(409);

    await request(app)
      .post(`/api/teetimes/${created.id}/scores`)
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

    await createMember(app, "Alex");
    await createMember(app, "Greg");

    const promoted = await request(app).get("/api/buyins").expect(200);
    expect(promoted.body.buyins).toEqual([
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
    ]);
    expect(
      promoted.body.buyins.reduce(
        (total: number, buyin: any) => total + buyin.amount,
        0
      )
    ).toBe(650);

    await request(app)
      .put("/api/players/Alex")
      .send({ member: false })
      .expect(200);

    const demoted = await request(app).get("/api/buyins").expect(200);
    expect(demoted.body.buyins).toEqual([
      expect.objectContaining({
        playerName: "Greg",
        amount: 325,
      }),
    ]);
    expect(
      demoted.body.buyins.reduce(
        (total: number, buyin: any) => total + buyin.amount,
        0
      )
    ).toBe(325);
  });

  it("requires an attester for regular tee-time scores", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10 })
      .expect(400);
  });

  it("rejects regular tee-time scores from drop-ins", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex", false);
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Greg" })
      .expect(400);
  });

  it("requires course handicap for regular tee-time scores", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, attestedBy: "Greg" })
      .expect(400);
  });

  it("rejects regular tee-time scores self-attested by the player", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Alex" })
      .expect(400);
  });

  it("requires a regular score attester to be both claimed on the tee time and a member", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    await createMember(app, "Morgan");
    await createMember(app, "Drop In", false);
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Morgan" })
      .expect(400);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Drop In" })
      .expect(200);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Drop In" })
      .expect(400);

    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Greg" })
      .expect(200);
  });

  it("prevents scored players and attesters from being removed from the tee time", async () => {
    const db = createTestDb();
    const app = createApp(db, { serveAssets: false });

    await createMember(app, "Alex");
    await createMember(app, "Greg");
    const teeTime = await createRegularTeeTime(app);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/claims`)
      .send({ name: "Alex" })
      .expect(200);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/scores`)
      .send({ name: "Alex", gross: 80, courseHcp: 10, attestedBy: "Greg" })
      .expect(200);

    await request(app)
      .delete(`/api/teetimes/${teeTime.id}/claims/Alex`)
      .expect(409);
    await request(app)
      .delete(`/api/teetimes/${teeTime.id}/claims/Greg`)
      .expect(409);
    await request(app)
      .post(`/api/teetimes/${teeTime.id}/interested`)
      .send({ name: "Alex" })
      .expect(409);
  });
});
