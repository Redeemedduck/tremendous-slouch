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
  process.env.PERSISTENCE_VERIFY_DB_PATH ??
  path.join(os.tmpdir(), `djdi-persistence-${process.pid}-${Date.now()}.db`);
const keepDb = process.env.KEEP_PERSISTENCE_VERIFY_DB === "1";
const sentinel = `persistence-${process.pid}-${Date.now()}`;
const accessCode = process.env.ACCESS_CODE?.trim();

function accessHeaders() {
  return accessCode
    ? { Cookie: `golf_access=${encodeURIComponent(accessCode)}` }
    : {};
}

function cleanup() {
  if (keepDb || process.env.PERSISTENCE_VERIFY_DB_PATH) return;
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
        reject(new Error("Could not determine verifier server port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function start(): Promise<RunningApp> {
  const db = createDb(dbPath);
  const app = createApp(db, { serveAssets: false });
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

let first: RunningApp | null = null;
let second: RunningApp | null = null;

try {
  cleanup();
  first = await start();
  const teeTimePayload = {
    course: "Persistence Check GC",
    date: "2026-05-19",
    time: "09:17",
    spots: 4,
    host: "Persistence Verifier",
    notes: sentinel,
  };
  const profile = await fetchJson<{ ok: boolean }>(`${first.url}/api/profile`, {
    method: "POST",
    headers: { ...accessHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name: teeTimePayload.host }),
  });
  const profileCookie = profile.headers.get("set-cookie")?.split(";")[0];
  if (profile.status !== 200 || !profile.body.ok || !profileCookie) {
    throw new Error(`profile setup returned HTTP ${profile.status}`);
  }
  const cookieHeader = [
    accessHeaders().Cookie,
    profileCookie,
  ].filter(Boolean).join("; ");
  const created = await fetchJson<{ teeTime: { id: string } }>(
    `${first.url}/api/teetimes`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify(teeTimePayload),
    }
  );
  if (created.status !== 201) {
    throw new Error(`tee-time create returned HTTP ${created.status}`);
  }
  const teeTimeId = created.body.teeTime.id;
  await stop(first);
  first = null;

  second = await start();
  const health = await fetchJson<{ ok: boolean; database: string }>(
    `${second.url}/api/health`
  );
  if (health.status !== 200 || !health.body.ok) {
    throw new Error(`restart health failed with HTTP ${health.status}`);
  }
  const loaded = await fetchJson<{
    teeTimes: Array<{
      id: string;
      course: string;
      host: string;
      notes: string | null;
    }>;
  }>(`${second.url}/api/teetimes`, { headers: accessHeaders() });
  const restored = loaded.body.teeTimes.find((teeTime) => teeTime.id === teeTimeId);
  if (!restored) {
    throw new Error("created tee time was missing after restart");
  }
  if (
    restored.course !== teeTimePayload.course ||
    restored.host !== teeTimePayload.host ||
    restored.notes !== teeTimePayload.notes
  ) {
    throw new Error("restored tee time did not match the created record");
  }
  await stop(second);
  second = null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: dbPath,
        accessGate: accessCode ? "cookie verified" : "not configured",
        teeTimeId,
        created: teeTimePayload,
        restartHealth: health.body,
        keptDatabase: keepDb || Boolean(process.env.PERSISTENCE_VERIFY_DB_PATH),
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Persistence verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  if (first) await stop(first).catch(() => {});
  if (second) await stop(second).catch(() => {});
  cleanup();
}
