// Tests for agent/inbound.ts — run with: npx tsx --test agent/inbound.test.ts
// Fakes for parse/exec/render/fetchLeagueData; real store on ":memory:".

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store";
import { createInboundHandler, resetRateLimitsForTests, REPLIES } from "./inbound";
import type { InboundDeps, LeagueData, ResolveScoreResult } from "./inbound";
import {
  AgentOfflineError,
  CONFIRM_WINDOW_MINUTES,
  UNDO_WINDOW_MINUTES,
} from "./types";
import type {
  CommittedFacts,
  ExecuteResult,
  InboundMessage,
  LeagueContext,
  ParsedAction,
  ParseResult,
  UndoSpec,
} from "./types";

// ---------- fixtures ----------

const T0 = Date.parse("2026-08-05T12:00:00.000Z");

const scoreAction = {
  kind: "record_score",
  ref: { course: "Common Ground", date: "2026-08-08" },
  gross: 82,
  courseHcp: 9,
  attestedBy: "Jason",
} satisfies ParsedAction;

const claimAction = {
  kind: "claim_spot",
  ref: { course: "Common Ground", date: "2026-08-08" },
} satisfies ParsedAction;

const claimFacts = {
  kind: "claim_spot",
  course: "Common Ground",
  date: "2026-08-08",
  time: "08:40",
  open: 1,
  teeTimeId: "tt1",
} satisfies CommittedFacts;

const scoreFacts = {
  kind: "record_score",
  course: "Common Ground",
  date: "2026-08-08",
  gross: 82,
  net: 73,
  attestedBy: "Jason",
  teeTimeId: "tt1",
} satisfies CommittedFacts;

const undoSpec = { kind: "drop_claim", teeTimeId: "tt1", playerName: "Matt" } satisfies UndoSpec;

const UNDO_SUMMARY = "your claim on Common Ground Sat 8:40 was removed";

// ---------- harness ----------

type HarnessOpts = {
  parseAction?: ParsedAction;
  parseImpl?: (text: string, ctx: LeagueContext) => Promise<ParseResult>;
  executeParsedResult?: ExecuteResult;
  executeScoreResult?: ExecuteResult;
  resolveResult?: ResolveScoreResult;
};

function makeHarness(opts: HarnessOpts = {}) {
  resetRateLimitsForTests();
  const store = createStore(":memory:");
  store.upsertMember({ channel: "sms", handle: "+1", playerName: "Matt", active: true });

  const raw: LeagueData = { teeTimes: [], players: [], tournaments: [], polls: [] };
  let nowMs = T0;

  const calls = {
    parse: [] as Array<{ text: string; ctx: LeagueContext }>,
    executeParsed: [] as Array<{ action: ParsedAction; senderName: string }>,
    executeScore: [] as Array<{ action: ParsedAction; teeTimeId: string; senderName: string }>,
    executeUndo: [] as UndoSpec[],
    resolveScoreTarget: [] as Array<{ action: ParsedAction; senderName: string }>,
    renderBoard: [] as unknown[],
    renderCommitted: [] as Array<{ facts: CommittedFacts; undoable: boolean }>,
  };

  const deps: InboundDeps = {
    store,
    parse: async (text, ctx) => {
      calls.parse.push({ text, ctx });
      if (opts.parseImpl) return opts.parseImpl(text, ctx);
      return { action: opts.parseAction ?? { kind: "clarify", question: "Which day?" }, model: "fake" };
    },
    buildContext: (_raw, senderName) => ({
      today: "2026-08-05",
      weekday: "Wednesday",
      senderName,
      courses: [],
      players: [],
      teeTimes: [],
      polls: [],
      liveStop: null,
    }),
    fetchLeagueData: async () => raw,
    exec: {
      executeParsed: (action, senderName) => {
        calls.executeParsed.push({ action, senderName });
        return opts.executeParsedResult ?? { ok: true, committed: claimFacts, undo: undoSpec };
      },
      resolveScoreTarget: (action, senderName) => {
        calls.resolveScoreTarget.push({ action, senderName });
        return opts.resolveResult ?? { ok: true, teeTimeId: "tt1", course: "Common Ground", date: "2026-08-08" };
      },
      executeScore: (action, teeTimeId, senderName) => {
        calls.executeScore.push({ action, teeTimeId, senderName });
        return opts.executeScoreResult ?? { ok: true, committed: scoreFacts, undo: null };
      },
      executeUndo: (spec) => {
        calls.executeUndo.push(spec);
        return { summary: UNDO_SUMMARY };
      },
    },
    render: {
      renderCommitted: (facts, undoable) => {
        calls.renderCommitted.push({ facts, undoable });
        return `COMMITTED:${facts.kind}:${undoable}`;
      },
      renderConfirmRequest: (action, target) => `CONFIRM:${target.course}:${target.date}:${action.gross}`,
      renderBoard: (r) => {
        calls.renderBoard.push(r);
        return "BOARD";
      },
    },
    now: () => new Date(nowMs),
  };

  const handler = createInboundHandler(deps);
  const send = (text: string, over: Partial<InboundMessage> = {}) =>
    handler({ channel: "sms", handle: "+1", text, ...over });
  const advance = (ms: number) => {
    nowMs += ms;
  };
  const nowIsoPlusMin = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString();
  const lastOutcome = () => store.listLog().at(-1)?.outcome;
  const seedConfirmPending = (teeTimeId = "tt1") =>
    store.savePending({
      id: "seed-confirm",
      channel: "sms",
      handle: "+1",
      mode: "confirm",
      actionJson: JSON.stringify({ action: scoreAction, teeTimeId }),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: nowIsoPlusMin(CONFIRM_WINDOW_MINUTES),
    });
  const seedUndoPending = () =>
    store.savePending({
      id: "seed-undo",
      channel: "sms",
      handle: "+1",
      mode: "undo",
      actionJson: JSON.stringify(undoSpec),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: nowIsoPlusMin(UNDO_WINDOW_MINUTES),
    });

  return { store, send, advance, calls, raw, lastOutcome, nowIsoPlusMin, seedConfirmPending, seedUndoPending };
}

// ---------- pre-parse gates ----------

test("empty message replies with the usage hint", async () => {
  const h = makeHarness();
  const res = await h.send("   ");
  assert.equal(res.reply, REPLIES.help);
  assert.equal(h.calls.parse.length, 0);
});

test("unknown sender is rejected before any parse call", async () => {
  const h = makeHarness();
  const res = await h.send("claim me in", { handle: "+999" });
  assert.equal(res.reply, REPLIES.unknownSender);
  assert.equal(h.calls.parse.length, 0);
  assert.equal(h.lastOutcome(), "unknown_sender");
});

test("inactive member is treated as unknown sender", async () => {
  const h = makeHarness();
  h.store.upsertMember({ channel: "sms", handle: "+2", playerName: "Ghost", active: false });
  const res = await h.send("claim me in", { handle: "+2" });
  assert.equal(res.reply, REPLIES.unknownSender);
  assert.equal(h.calls.parse.length, 0);
  assert.equal(h.lastOutcome(), "unknown_sender");
});

// ---------- YES ----------

test("YES with a pending confirm commits the score", async () => {
  const h = makeHarness();
  h.seedConfirmPending("tt7");
  const res = await h.send("YES!");
  assert.equal(h.calls.executeScore.length, 1);
  assert.equal(h.calls.executeScore[0].teeTimeId, "tt7");
  assert.equal(h.calls.executeScore[0].senderName, "Matt");
  assert.deepEqual(h.calls.executeScore[0].action, scoreAction);
  assert.equal(res.reply, "COMMITTED:record_score:false");
  assert.equal(h.lastOutcome(), "yes_commit");
  assert.equal(h.store.takeLatestPending("sms", "+1", new Date(T0)), null); // consumed
});

test("YES with nothing pending", async () => {
  const h = makeHarness();
  const res = await h.send("yes");
  assert.equal(res.reply, REPLIES.nothingForYes);
  assert.equal(h.calls.parse.length, 0);
  assert.equal(h.lastOutcome(), "no_pending");
});

test("YES with an undo-mode pending replies nothing-waiting and leaves the undo window intact", async () => {
  const h = makeHarness();
  h.seedUndoPending();
  const res = await h.send("yep");
  assert.equal(res.reply, REPLIES.nothingForYes);
  assert.equal(h.calls.executeScore.length, 0);
  // The undo pending must survive the stray "yes" — a NO can still undo.
  const survivor = h.store.takeLatestPending("sms", "+1", new Date(T0));
  assert.ok(survivor);
  assert.equal(survivor!.mode, "undo");
});

test("YES with an expired confirm pending finds nothing", async () => {
  const h = makeHarness();
  h.store.savePending({
    id: "stale",
    channel: "sms",
    handle: "+1",
    mode: "confirm",
    actionJson: JSON.stringify({ action: scoreAction, teeTimeId: "tt1" }),
    createdAt: new Date(T0 - 7_200_000).toISOString(),
    expiresAt: new Date(T0 - 3_600_000).toISOString(), // expired an hour ago
  });
  const res = await h.send("yes");
  assert.equal(res.reply, REPLIES.nothingForYes);
  assert.equal(h.calls.executeScore.length, 0);
});

// ---------- NO ----------

test("NO cancels a pending confirm without posting", async () => {
  const h = makeHarness();
  h.seedConfirmPending();
  const res = await h.send("no");
  assert.equal(res.reply, REPLIES.cancelled);
  assert.equal(h.calls.executeScore.length, 0);
  assert.equal(h.lastOutcome(), "cancelled");
  const followUp = await h.send("yes"); // pending is gone
  assert.equal(followUp.reply, REPLIES.nothingForYes);
});

test("NO with a pending undo executes the undo", async () => {
  const h = makeHarness();
  h.seedUndoPending();
  const res = await h.send("undo");
  assert.equal(h.calls.executeUndo.length, 1);
  assert.deepEqual(h.calls.executeUndo[0], undoSpec);
  assert.equal(res.reply, `Undone: ${UNDO_SUMMARY}`);
  assert.equal(h.lastOutcome(), "undone");
});

test("NO with nothing pending", async () => {
  const h = makeHarness();
  const res = await h.send("nope");
  assert.equal(res.reply, REPLIES.nothingToUndo);
  assert.equal(h.calls.parse.length, 0);
  assert.equal(h.lastOutcome(), "no_pending");
});

// ---------- parse dispatch ----------

test("auto-commit path saves an undo pending and replies rendered text", async () => {
  const h = makeHarness({ parseAction: claimAction });
  const res = await h.send("get me in on saturday");
  assert.equal(res.reply, "COMMITTED:claim_spot:true");
  assert.equal(h.calls.executeParsed.length, 1);
  assert.deepEqual(h.calls.executeParsed[0], { action: claimAction, senderName: "Matt" });
  assert.equal(h.lastOutcome(), "committed");

  const pending = h.store.takeLatestPending("sms", "+1", new Date(T0));
  assert.ok(pending);
  assert.equal(pending.mode, "undo");
  assert.deepEqual(JSON.parse(pending.actionJson), undoSpec);
  assert.equal(pending.expiresAt, h.nowIsoPlusMin(UNDO_WINDOW_MINUTES));
});

test("auto-commit with a null undo saves no pending", async () => {
  const h = makeHarness({
    parseAction: claimAction,
    executeParsedResult: { ok: true, committed: claimFacts, undo: null },
  });
  const res = await h.send("get me in");
  assert.equal(res.reply, "COMMITTED:claim_spot:false");
  assert.equal(h.calls.renderCommitted[0].undoable, false);
  assert.equal(h.store.takeLatestPending("sms", "+1", new Date(T0)), null);
});

test("auto-commit then NO undoes the action", async () => {
  const h = makeHarness({ parseAction: claimAction });
  await h.send("get me in on saturday");
  const res = await h.send("no");
  assert.deepEqual(h.calls.executeUndo[0], undoSpec);
  assert.equal(res.reply, `Undone: ${UNDO_SUMMARY}`);
  assert.equal(h.lastOutcome(), "undone");
});

test("executor failure passes its member-facing reply through", async () => {
  const h = makeHarness({
    parseAction: claimAction,
    executeParsedResult: { ok: false, reply: "That tee time is full." },
  });
  const res = await h.send("get me in");
  assert.equal(res.reply, "That tee time is full.");
  assert.equal(h.lastOutcome(), "exec_failed");
  assert.equal(h.store.takeLatestPending("sms", "+1", new Date(T0)), null);
});

test("record_score parks a confirm pending with the resolved tee time", async () => {
  const h = makeHarness({ parseAction: scoreAction });
  const res = await h.send("shot 82, hcp 9, attested by Jason");
  assert.equal(res.reply, "CONFIRM:Common Ground:2026-08-08:82");
  assert.equal(h.lastOutcome(), "confirm_requested");
  assert.equal(h.calls.executeScore.length, 0); // nothing committed yet

  const pending = h.store.takeLatestPending("sms", "+1", new Date(T0));
  assert.ok(pending);
  assert.equal(pending.mode, "confirm");
  assert.deepEqual(JSON.parse(pending.actionJson), { action: scoreAction, teeTimeId: "tt1" });
  assert.equal(pending.expiresAt, h.nowIsoPlusMin(CONFIRM_WINDOW_MINUTES));
});

test("record_score then YES commits with the stored tee time", async () => {
  const h = makeHarness({ parseAction: scoreAction });
  await h.send("shot 82, hcp 9, attested by Jason");
  const res = await h.send("y");
  assert.equal(h.calls.executeScore.length, 1);
  assert.equal(h.calls.executeScore[0].teeTimeId, "tt1");
  assert.deepEqual(h.calls.executeScore[0].action, scoreAction);
  assert.equal(res.reply, "COMMITTED:record_score:false");
  assert.equal(h.lastOutcome(), "yes_commit");
});

test("record_score resolver failure replies with its text and parks nothing", async () => {
  const h = makeHarness({
    parseAction: scoreAction,
    resolveResult: { ok: false, reply: "Which round was that — Saturday or Sunday?" },
  });
  const res = await h.send("shot 82");
  assert.equal(res.reply, "Which round was that — Saturday or Sunday?");
  assert.equal(h.lastOutcome(), "exec_failed");
  assert.equal(h.store.takeLatestPending("sms", "+1", new Date(T0)), null);
});

test("clarify replies with the model's question", async () => {
  const h = makeHarness(); // default parse → clarify "Which day?"
  const res = await h.send("put me down");
  assert.equal(res.reply, "Which day?");
  assert.equal(h.lastOutcome(), "clarified");
});

test("unknown action replies with the canned hint and logs the reason", async () => {
  const h = makeHarness({ parseAction: { kind: "unknown", reason: "gibberish" } });
  const res = await h.send("asdfghjkl");
  assert.equal(res.reply, REPLIES.unknown);
  assert.equal(h.lastOutcome(), "unknown");
  const row = h.store.listLog().at(-1);
  assert.ok(row?.parsedJson?.includes("gibberish"));
});

test("board_query renders from the already-fetched raw data", async () => {
  const h = makeHarness({ parseAction: { kind: "board_query" } });
  const res = await h.send("what's on the board?");
  assert.equal(res.reply, "BOARD");
  assert.equal(h.calls.renderBoard.length, 1);
  assert.equal(h.calls.renderBoard[0], h.raw); // exact same object, no refetch
  assert.equal(h.lastOutcome(), "board");
});

// ---------- rate limits ----------

test("per-sender limit trips on the 11th parse-bound message within an hour", async () => {
  const h = makeHarness();
  for (let i = 0; i < 10; i++) {
    const res = await h.send(`message ${i}`);
    assert.equal(res.reply, "Which day?"); // parsed
    h.advance(60_000);
  }
  assert.equal(h.calls.parse.length, 10);

  const blocked = await h.send("message 10");
  assert.equal(blocked.reply, REPLIES.rateLimitedSender);
  assert.equal(h.calls.parse.length, 10); // parse NOT called
  assert.equal(h.lastOutcome(), "rate_limited");

  h.advance(61 * 60_000); // window slides past every earlier hit
  const after = await h.send("message 11");
  assert.equal(after.reply, "Which day?");
  assert.equal(h.calls.parse.length, 11);
});

test("global daily limit trips after 100 parse-bound messages", async () => {
  const h = makeHarness();
  for (let s = 0; s < 10; s++) {
    h.store.upsertMember({ channel: "sms", handle: `+g${s}`, playerName: `P${s}`, active: true });
  }
  h.store.upsertMember({ channel: "sms", handle: "+over", playerName: "Late", active: true });

  for (let s = 0; s < 10; s++) {
    for (let i = 0; i < 10; i++) {
      await h.send(`msg ${i}`, { handle: `+g${s}` }); // stays under each sender's own cap
    }
  }
  assert.equal(h.calls.parse.length, 100);

  const blocked = await h.send("one more", { handle: "+over" });
  assert.equal(blocked.reply, REPLIES.rateLimitedGlobal);
  assert.equal(h.calls.parse.length, 100);
  assert.equal(h.lastOutcome(), "rate_limited");
});

// ---------- parse failures ----------

test("AgentOfflineError replies with the not-configured message", async () => {
  const h = makeHarness({
    parseImpl: async () => {
      throw new AgentOfflineError();
    },
  });
  const res = await h.send("claim me in");
  assert.equal(res.reply, REPLIES.offline);
  assert.equal(h.lastOutcome(), "offline");
});

test("unexpected parse error replies with the generic failure", async () => {
  const h = makeHarness({
    parseImpl: async () => {
      throw new Error("boom");
    },
  });
  const res = await h.send("claim me in");
  assert.equal(res.reply, REPLIES.error);
  assert.equal(h.lastOutcome(), "error");
  const row = h.store.listLog().at(-1);
  assert.ok(row?.parsedJson?.includes("boom"));
});
