// ============================================================
// Integration tests for agent/execute.ts + agent/api.ts + agent/confirm.ts.
// Spawns the REAL server (npx tsx server.ts) against a throwaway SQLite file,
// with the access gate enabled, and drives it through the agent's own client.
//
// Narrowing note: this project compiles without strictNullChecks, where
// boolean-discriminant truthiness narrowing doesn't apply — so guards use
// `=== true` / `=== false` plus assert.fail() (typed never), which do narrow.
// ============================================================

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeParsed,
  executeScore,
  executeUndo,
  resolveScoreTarget,
} from "./execute";
import {
  fetchLeagueData,
  getPolls,
  getTeeTimes,
  postClaim,
  postTeeTime,
} from "./api";
import {
  renderBoard,
  renderCommitted,
  renderConfirmRequest,
} from "./confirm";
import type { ParsedAction, TeeTimeRef, UndoSpec } from "./types";
import { todayISO } from "../src/lib/format";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const PORT = 4300 + (process.pid % 500);
const ACCESS_CODE = "test-code";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(
  os.tmpdir(),
  `golf-agent-exec-test-${process.pid}-${Date.now()}.db`
);
const STARTUP_TIMEOUT_MS = 20_000;

let child: ChildProcess | undefined;

const isoPlusDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const waitForListening = (proc: ChildProcess, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`Server didn't start within ${timeoutMs}ms. Output:\n${output}`)
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Server listening")) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Server exited early (code ${code}). Output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("exit", onExit);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", onExit);
  });

// Raw helpers for endpoints the agent client deliberately doesn't wrap.
const rawHeaders = {
  "Content-Type": "application/json",
  Cookie: `golf_access=${ACCESS_CODE}`,
};

const putMember = async (name: string) => {
  const res = await fetch(`${BASE}/api/players/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: rawHeaders,
    body: JSON.stringify({ member: true }),
  });
  assert.equal(res.ok, true, `PUT /api/players/${name} failed`);
};

const createPoll = async (prompt: string, options: string[]) => {
  const res = await fetch(`${BASE}/api/polls`, {
    method: "POST",
    headers: rawHeaders,
    body: JSON.stringify({ prompt, options, host: "Jayson" }),
  });
  assert.equal(res.status, 201, `POST /api/polls failed for "${prompt}"`);
  const body = (await res.json()) as { poll: { id: string } };
  return body.poll;
};

const scoreAction = (
  ref: TeeTimeRef,
  overrides: Partial<{
    gross: number;
    courseHcp: number | null;
    attestedBy: string | null;
  }> = {}
): Extract<ParsedAction, { kind: "record_score" }> => ({
  kind: "record_score",
  ref,
  gross: overrides.gross ?? 82,
  courseHcp: "courseHcp" in overrides ? (overrides.courseHcp as number | null) : 9,
  attestedBy:
    "attestedBy" in overrides ? (overrides.attestedBy as string | null) : null,
});

describe("agent execute (integration, real server)", () => {
  before(async () => {
    process.env.AGENT_SELF_URL = BASE;
    process.env.ACCESS_CODE = ACCESS_CODE;
    // detached puts npx AND the tsx/node server it execs into their own
    // process group, so teardown can kill the whole tree. Killing only the
    // npx parent can orphan the real server, which then holds this process's
    // stdio pipes open and hangs the test runner (seen in CI).
    child = spawn("npx", ["tsx", "server.ts"], {
      cwd: REPO_ROOT,
      detached: true,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: "127.0.0.1",
        DB_PATH,
        ACCESS_CODE,
        NODE_ENV: "production", // skips Vite dev middleware; API-only is fine
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForListening(child, STARTUP_TIMEOUT_MS);
    await putMember("Duck");
    await putMember("Jayson");
  });

  after(() => {
    if (child) {
      // Release our ends of the pipes first so an orphaned grandchild can't
      // keep this process's event loop alive, then kill the whole process
      // group (throwaway server + temp DB — SIGKILL is fine).
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (child.pid != null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    }
  });

  test("access gate + client see the seeded schedule", async () => {
    const data = await fetchLeagueData();
    assert.ok(data.tournaments.length >= 9, "seeded tournaments present");
    assert.ok(
      data.teeTimes.some((t) => t.date === "2026-05-16"),
      "seeded Common Ground tee times present"
    );
    assert.ok(data.players.some((p) => p.name === "Duck" && p.member));
  });

  test("executeParsed rejects record_score (contract: wrong entry point)", async () => {
    await assert.rejects(
      () => executeParsed(scoreAction({}), "Duck"),
      /record_score/
    );
  });

  test("create_tee_time: facts + undo, executeUndo deletes, second undo tolerated", async () => {
    const res = await executeParsed(
      {
        kind: "create_tee_time",
        course: "Murphy Creek",
        date: isoPlusDays(3),
        time: "09:10",
        spots: 4,
        notes: "agent test round",
      },
      "Duck"
    );
    if (res.ok === false) assert.fail(`expected ok, got: ${res.reply}`);
    const committed = res.committed;
    if (committed.kind !== "create_tee_time") {
      assert.fail(`wrong facts kind: ${committed.kind}`);
    }
    assert.equal(committed.course, "Murphy Creek");
    assert.equal(committed.spots, 4);
    assert.deepEqual(res.undo, {
      kind: "delete_tee_time",
      teeTimeId: committed.teeTimeId,
    });

    const rendered = renderCommitted(committed, true);
    assert.match(rendered, /Murphy Creek/);
    assert.match(rendered, /Reply NO in the next 10 min to undo\./);

    const undone = await executeUndo(res.undo as UndoSpec);
    assert.equal(undone.ok, true);
    assert.match(undone.summary, /Murphy Creek/);
    const createdId = committed.teeTimeId;
    const teeTimes = await getTeeTimes();
    assert.ok(!teeTimes.some((t) => t.id === createdId), "tee time deleted");

    const again = await executeUndo(res.undo as UndoSpec);
    assert.equal(again.ok, true);
    assert.match(again.summary, /already gone/i);
  });

  test("claim_spot: happy path, double-claim, and full-tee-time server errors", async () => {
    const tee = await postTeeTime({
      course: "Fox Hollow",
      date: isoPlusDays(2),
      time: "10:00",
      spots: 2,
      host: "Jayson", // auto-claims Jayson → one open spot
    });

    const res = await executeParsed(
      { kind: "claim_spot", ref: { course: "fox" } },
      "Duck"
    );
    if (res.ok === false) assert.fail(`expected ok, got: ${res.reply}`);
    const committed = res.committed;
    if (committed.kind !== "claim_spot") {
      assert.fail(`wrong facts kind: ${committed.kind}`);
    }
    assert.equal(committed.teeTimeId, tee.id);
    assert.equal(committed.open, 0);
    assert.deepEqual(res.undo, {
      kind: "drop_claim",
      teeTimeId: tee.id,
      playerName: "Duck",
    });

    const dup = await executeParsed(
      { kind: "claim_spot", ref: { course: "fox" } },
      "Duck"
    );
    if (dup.ok === true) assert.fail("double-claim should fail");
    assert.equal(dup.reply, "That name already has a spot");

    const full = await executeParsed(
      { kind: "claim_spot", ref: { course: "fox" } },
      "Casey"
    );
    if (full.ok === true) assert.fail("claim on a full tee time should fail");
    assert.equal(full.reply, "That tee time is full");
  });

  test("claim_spot resolution: 0 candidates and 2+ candidates never guess", async () => {
    await postTeeTime({
      course: "Bear Dance",
      date: isoPlusDays(4),
      time: "08:00",
      spots: 4,
      host: "Jayson",
    });
    await postTeeTime({
      course: "Bear Dance",
      date: isoPlusDays(5),
      time: "08:30",
      spots: 4,
      host: "Jayson",
    });

    const none = await executeParsed(
      { kind: "claim_spot", ref: { course: "Totally Unknown CC" } },
      "Duck"
    );
    if (none.ok === true) assert.fail("unknown course should not resolve");
    assert.match(none.reply, /Couldn't find that tee time/);
    assert.match(none.reply, /Totally Unknown CC/);

    const ambiguous = await executeParsed(
      { kind: "claim_spot", ref: { course: "bear" } },
      "Duck"
    );
    if (ambiguous.ok === true) assert.fail("two matches should not resolve");
    assert.match(ambiguous.reply, /Which one\?/);
    assert.match(ambiguous.reply, /1\) Bear Dance/);
    assert.match(ambiguous.reply, /2\) Bear Dance/);

    // Adding the date disambiguates deterministically.
    const exact = await executeParsed(
      { kind: "claim_spot", ref: { course: "bear", date: isoPlusDays(4) } },
      "Duck"
    );
    if (exact.ok === false) assert.fail(`expected ok, got: ${exact.reply}`);
    assert.equal(exact.committed.kind, "claim_spot");
  });

  test("drop_spot: only own claims are candidates; restore undo puts you back", async () => {
    // Casey holds no claim on Fox Hollow → not a drop candidate for Casey.
    const notMine = await executeParsed(
      { kind: "drop_spot", ref: { course: "fox" } },
      "Casey"
    );
    if (notMine.ok === true) assert.fail("drop without a claim should fail");
    assert.match(notMine.reply, /Couldn't find that tee time/);

    const drop = await executeParsed(
      { kind: "drop_spot", ref: { course: "fox" } },
      "Duck"
    );
    if (drop.ok === false) assert.fail(`expected ok, got: ${drop.reply}`);
    const committed = drop.committed;
    if (committed.kind !== "drop_spot") {
      assert.fail(`wrong facts kind: ${committed.kind}`);
    }
    const droppedId = committed.teeTimeId;
    const undo = drop.undo as UndoSpec;
    assert.deepEqual(undo, {
      kind: "restore_claim",
      teeTimeId: droppedId,
      playerName: "Duck",
    });
    let fox = (await getTeeTimes()).find((t) => t.id === droppedId);
    assert.ok(fox && !fox.claims.some((c) => c.name === "Duck"), "claim dropped");

    const restored = await executeUndo(undo);
    assert.equal(restored.ok, true);
    assert.match(restored.summary, /Fox Hollow/);
    fox = (await getTeeTimes()).find((t) => t.id === droppedId);
    assert.ok(fox && fox.claims.some((c) => c.name === "Duck"), "claim restored");

    // Retrying the restore is tolerated (already back on).
    const again = await executeUndo(undo);
    assert.equal(again.ok, true);
    assert.match(again.summary, /already/i);
  });

  test("cast_vote: single open poll needs no hint; re-vote is idempotent", async () => {
    const poll = await createPoll("Where for the major?", [
      "Bear Dance",
      "Pinehurst",
    ]);

    const res = await executeParsed(
      { kind: "cast_vote", pollHint: null, optionText: "pine" },
      "Duck"
    );
    if (res.ok === false) assert.fail(`expected ok, got: ${res.reply}`);
    const committed = res.committed;
    if (committed.kind !== "cast_vote") {
      assert.fail(`wrong facts kind: ${committed.kind}`);
    }
    assert.equal(committed.pollId, poll.id);
    assert.equal(committed.optionIdx, 1);
    assert.equal(committed.optionText, "Pinehurst"); // canonical, not "pine"
    assert.deepEqual(res.undo, {
      kind: "remove_vote",
      pollId: poll.id,
      playerName: "Duck",
      optionIdx: 1,
    });

    // Same vote again: must NOT toggle it off.
    const rerun = await executeParsed(
      { kind: "cast_vote", pollHint: null, optionText: "Pinehurst" },
      "Duck"
    );
    if (rerun.ok === false) assert.fail(`expected ok, got: ${rerun.reply}`);
    const polls = await getPolls();
    const live = polls.find((p) => p.id === poll.id);
    assert.ok(live, "poll still exists");
    const duckVotes = live.responses.filter(
      (r) => r.name === "Duck" && r.optionIdx === 1
    );
    assert.equal(duckVotes.length, 1, "vote still present exactly once");
  });

  test("cast_vote: ambiguous poll/option clarify; remove_vote undo only toggles when present", async () => {
    await createPoll("Tee time preference", ["Morning early", "Morning late"]);

    // Two open polls, no hint → must ask which poll.
    const whichPoll = await executeParsed(
      { kind: "cast_vote", pollHint: null, optionText: "Morning early" },
      "Duck"
    );
    if (whichPoll.ok === true) assert.fail("two open polls should not resolve");
    assert.match(whichPoll.reply, /Which poll\?/);
    assert.match(whichPoll.reply, /Tee time preference/);
    assert.match(whichPoll.reply, /Where for the major\?/);

    // Hint resolves the poll, but "morning" matches both options.
    const whichOption = await executeParsed(
      { kind: "cast_vote", pollHint: "preference", optionText: "morning" },
      "Duck"
    );
    if (whichOption.ok === true) assert.fail("two options should not resolve");
    assert.match(whichOption.reply, /Morning early/);
    assert.match(whichOption.reply, /Morning late/);

    const good = await executeParsed(
      { kind: "cast_vote", pollHint: "preference", optionText: "early" },
      "Duck"
    );
    if (good.ok === false) assert.fail(`expected ok, got: ${good.reply}`);
    const undo = good.undo as UndoSpec;

    const undone = await executeUndo(undo);
    assert.equal(undone.ok, true);
    assert.match(undone.summary, /Morning early/);

    // Second undo must NOT toggle the vote back on.
    const again = await executeUndo(undo);
    assert.equal(again.ok, true);
    assert.match(again.summary, /already/i);
    const polls = await getPolls();
    const pref = polls.find((p) => p.prompt === "Tee time preference");
    assert.ok(pref, "poll still exists");
    assert.ok(
      !pref.responses.some((r) => r.name === "Duck"),
      "undo retry did not re-cast the vote"
    );
  });

  test("resolveScoreTarget: 0, 1, and 2+ candidates", async () => {
    // Duck's only claims so far are future-dated → nothing needs a score.
    const none = await resolveScoreTarget(scoreAction({}), "Duck");
    if (none.ok === true) assert.fail("no past rounds should resolve");
    assert.match(none.reply, /Nothing needs a score/);

    // Today is claimable AND already <= today, so it's scoreable.
    const roundA = await postTeeTime({
      course: "Common Ground",
      date: todayISO(),
      time: "07:30",
      spots: 4,
      host: "Duck",
    });
    const one = await resolveScoreTarget(scoreAction({}), "Duck");
    if (one.ok === false) assert.fail(`expected ok, got: ${one.reply}`);
    assert.equal(one.teeTimeId, roundA.id);
    assert.equal(one.course, "Common Ground");
    assert.equal(one.date, todayISO());

    const roundB = await postTeeTime({
      course: "Riverdale Dunes",
      date: todayISO(),
      time: "13:00",
      spots: 4,
      host: "Duck",
    });
    const two = await resolveScoreTarget(scoreAction({}), "Duck");
    if (two.ok === true) assert.fail("two unscored rounds should not resolve");
    assert.match(two.reply, /Which round\?/);
    assert.match(two.reply, /Common Ground/);
    assert.match(two.reply, /Riverdale Dunes/);

    const filtered = await resolveScoreTarget(
      scoreAction({ course: "riverdale" }),
      "Duck"
    );
    if (filtered.ok === false) assert.fail(`expected ok, got: ${filtered.reply}`);
    assert.equal(filtered.teeTimeId, roundB.id);
  });

  test("executeScore: league window enforces attester; success computes net; undo removes", async () => {
    const roundA = (await getTeeTimes()).find(
      (t) => t.course === "Common Ground" && t.date === todayISO()
    );
    assert.ok(roundA, "today's Common Ground round exists from prior test");

    // Today falls inside a regular tournament window (Stops 5/6/7 cover
    // 2026-07-27 through 2026-09-27) → attester required.
    const rejected = await executeScore(
      scoreAction({}, { attestedBy: null }),
      roundA.id,
      "Duck"
    );
    if (rejected.ok === true) assert.fail("league round without attester posted");
    assert.match(rejected.reply, /attester/i);

    // Put a second registered member on the same tee time, then attest.
    await postClaim(roundA.id, "Jayson");
    const good = await executeScore(
      scoreAction({}, { gross: 82, courseHcp: 9, attestedBy: "Jayson" }),
      roundA.id,
      "Duck"
    );
    if (good.ok === false) assert.fail(`expected ok, got: ${good.reply}`);
    const committed = good.committed;
    if (committed.kind !== "record_score") {
      assert.fail(`wrong facts kind: ${committed.kind}`);
    }
    assert.equal(committed.gross, 82);
    assert.equal(committed.net, 73); // 82 gross - 9 course handicap
    assert.equal(committed.attestedBy, "Jayson");
    assert.deepEqual(good.undo, {
      kind: "remove_score",
      teeTimeId: roundA.id,
      playerName: "Duck",
    });

    const rendered = renderCommitted(committed, false);
    assert.match(rendered, /82 gross \(net 73\)/);
    assert.doesNotMatch(rendered, /Reply NO/);

    const undone = await executeUndo(good.undo as UndoSpec);
    assert.equal(undone.ok, true);
    const roundAId = roundA.id;
    const refreshed = (await getTeeTimes()).find((t) => t.id === roundAId);
    assert.ok(refreshed, "round still exists");
    assert.equal(refreshed.scores.length, 0, "score removed");

    const again = await executeUndo(good.undo as UndoSpec);
    assert.equal(again.ok, true);
    assert.match(again.summary, /already gone/i);
  });

  test("confirm templates: score echo spells out missing fields; board stays compact", async () => {
    const withEverything = renderConfirmRequest(
      scoreAction({}, { gross: 82, courseHcp: 9, attestedBy: "Jayson" }),
      { course: "Common Ground", date: todayISO() }
    );
    assert.match(withEverything, /82 gross/);
    assert.match(withEverything, /course handicap 9/);
    assert.match(withEverything, /attested by Jayson/);
    assert.match(withEverything, /Reply YES to post it\./);

    const withNulls = renderConfirmRequest(
      scoreAction({}, { gross: 90, courseHcp: null, attestedBy: null }),
      { course: "Common Ground", date: todayISO() }
    );
    assert.match(withNulls, /no course handicap given/);
    assert.match(withNulls, /no attester given/);

    const { teeTimes, polls } = await fetchLeagueData();
    const board = renderBoard({ teeTimes, polls });
    const lines = board.split("\n");
    assert.ok(lines.length < 15, `board is ${lines.length} lines`);
    assert.match(board, /Fox Hollow/);
    assert.match(board, /Where for the major\?/);
  });
});
