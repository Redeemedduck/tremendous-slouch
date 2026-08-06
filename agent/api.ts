// ============================================================
// Text-the-Board agent — self-HTTP client for the app's REST API.
// The agent talks to the app the same way the web UI does: over HTTP,
// honoring the access gate. Non-2xx responses become ApiError carrying the
// server's member-readable `{error}` message.
// ============================================================

import type {
  NewTeeTimeInput,
  Player,
  Poll,
  TeeTime,
  Tournament,
} from "../src/lib/types";

/** Thrown on any non-2xx API response. `message` is the server's `{error}`. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Env is read per-request (not at import time) so tests can point the client
// at a freshly spawned server before the first call.
const baseUrl = (): string =>
  process.env.AGENT_SELF_URL ?? `http://127.0.0.1:${process.env.PORT || 3000}`;

const buildHeaders = (hasBody: boolean): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (accessCode) headers["Cookie"] = `golf_access=${accessCode}`;
  return headers;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: buildHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null; // non-JSON body (proxy error page, etc.)
    }
  }
  if (!res.ok) {
    const serverError = (parsed as { error?: unknown } | null)?.error;
    const message =
      typeof serverError === "string" && serverError
        ? serverError
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return parsed as T;
}

// ---------- typed helpers ----------

export type ScoreInput = {
  name: string;
  gross: number;
  courseHcp: number | null;
  attestedBy: string | null;
};

export const getTeeTimes = async (): Promise<TeeTime[]> =>
  (await request<{ teeTimes: TeeTime[] }>("GET", "/api/teetimes")).teeTimes;

export const getPolls = async (): Promise<Poll[]> =>
  (await request<{ polls: Poll[] }>("GET", "/api/polls")).polls;

export const getPlayers = async (): Promise<Player[]> =>
  (await request<{ players: Player[] }>("GET", "/api/players")).players;

export const getTournaments = async (): Promise<Tournament[]> =>
  (await request<{ tournaments: Tournament[] }>("GET", "/api/tournaments"))
    .tournaments;

export const postTeeTime = async (input: NewTeeTimeInput): Promise<TeeTime> =>
  (await request<{ teeTime: TeeTime }>("POST", "/api/teetimes", input)).teeTime;

export const postClaim = async (id: string, name: string): Promise<TeeTime> =>
  (
    await request<{ teeTime: TeeTime }>(
      "POST",
      `/api/teetimes/${encodeURIComponent(id)}/claims`,
      { name }
    )
  ).teeTime;

export const deleteClaim = async (id: string, name: string): Promise<TeeTime> =>
  (
    await request<{ teeTime: TeeTime }>(
      "DELETE",
      `/api/teetimes/${encodeURIComponent(id)}/claims/${encodeURIComponent(name)}`
    )
  ).teeTime;

export const postScore = async (
  id: string,
  score: ScoreInput
): Promise<TeeTime> =>
  (
    await request<{ teeTime: TeeTime }>(
      "POST",
      `/api/teetimes/${encodeURIComponent(id)}/scores`,
      score
    )
  ).teeTime;

export const deleteScore = async (id: string, name: string): Promise<TeeTime> =>
  (
    await request<{ teeTime: TeeTime }>(
      "DELETE",
      `/api/teetimes/${encodeURIComponent(id)}/scores/${encodeURIComponent(name)}`
    )
  ).teeTime;

export const deleteTeeTime = async (id: string): Promise<void> => {
  await request<{ ok: boolean }>(
    "DELETE",
    `/api/teetimes/${encodeURIComponent(id)}`
  );
};

export const togglePollResponse = async (
  pollId: string,
  name: string,
  optionIdx: number
): Promise<Poll> =>
  (
    await request<{ poll: Poll }>(
      "POST",
      `/api/polls/${encodeURIComponent(pollId)}/responses`,
      { name, optionIdx }
    )
  ).poll;

export type LeagueData = {
  teeTimes: TeeTime[];
  players: Player[];
  tournaments: Tournament[];
  polls: Poll[];
};

/** Everything the parser/board needs, fetched in one place. */
export const fetchLeagueData = async (): Promise<LeagueData> => {
  const [teeTimes, players, tournaments, polls] = await Promise.all([
    getTeeTimes(),
    getPlayers(),
    getTournaments(),
    getPolls(),
  ]);
  return { teeTimes, players, tournaments, polls };
};
