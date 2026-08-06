// Tests for agent/store.ts — run with: npx tsx --test agent/store.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createStore } from "./store";
import type { Member, PendingAction } from "./types";

const makeMember = (over: Partial<Member> = {}): Member => ({
  channel: "sms",
  handle: "+13035550100",
  playerName: "Matt",
  active: true,
  ...over,
});

let pendingSeq = 0;
const makePending = (over: Partial<PendingAction> = {}): PendingAction => {
  pendingSeq += 1;
  return {
    id: `p-${pendingSeq}`,
    channel: "sms",
    handle: "+13035550100",
    mode: "confirm",
    actionJson: JSON.stringify({ n: pendingSeq }),
    createdAt: new Date(Date.now() + pendingSeq).toISOString(), // strictly increasing
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
};

test("findMember matches handle case-insensitively and trimmed", () => {
  const store = createStore(":memory:");
  store.upsertMember(makeMember({ channel: "imessage", handle: "Matt@Example.com" }));

  const hit = store.findMember("imessage", "  matt@EXAMPLE.COM ");
  assert.ok(hit);
  assert.equal(hit.playerName, "Matt");
  assert.equal(hit.handle, "Matt@Example.com"); // stored form preserved
  assert.equal(hit.active, true);

  assert.equal(store.findMember("imessage", "nobody@example.com"), null);
  assert.equal(store.findMember("sms", "Matt@Example.com"), null); // channel must match
  store.close();
});

test("findMember returns inactive members with active=false", () => {
  const store = createStore(":memory:");
  store.upsertMember(makeMember({ active: false }));
  const hit = store.findMember("sms", "+13035550100");
  assert.ok(hit);
  assert.equal(hit.active, false);
  store.close();
});

test("upsertMember replaces on the same (channel, handle)", () => {
  const store = createStore(":memory:");
  store.upsertMember(makeMember({ playerName: "Matt" }));
  store.upsertMember(makeMember({ playerName: "Matty", active: false }));
  const members = store.listMembers();
  assert.equal(members.length, 1);
  assert.equal(members[0].playerName, "Matty");
  assert.equal(members[0].active, false);
  store.close();
});

test("savePending keeps at most one pending per sender (replacement)", () => {
  const store = createStore(":memory:");
  store.savePending(makePending({ actionJson: '{"first":true}' }));
  const second = makePending({ actionJson: '{"second":true}', mode: "undo" });
  store.savePending(second);

  const taken = store.takeLatestPending("sms", "+13035550100");
  assert.ok(taken);
  assert.equal(taken.id, second.id);
  assert.equal(taken.actionJson, '{"second":true}');
  assert.equal(taken.mode, "undo");
  // The replaced first pending must be gone too.
  assert.equal(store.takeLatestPending("sms", "+13035550100"), null);
  store.close();
});

test("savePending replacement is per-sender, not global", () => {
  const store = createStore(":memory:");
  store.savePending(makePending({ handle: "+1000" }));
  store.savePending(makePending({ handle: "+2000" }));
  assert.ok(store.takeLatestPending("sms", "+1000"));
  assert.ok(store.takeLatestPending("sms", "+2000"));
  store.close();
});

test("takeLatestPending consumes the row", () => {
  const store = createStore(":memory:");
  const p = makePending();
  store.savePending(p);
  const first = store.takeLatestPending("sms", "+13035550100");
  assert.ok(first);
  assert.equal(first.id, p.id);
  assert.equal(store.takeLatestPending("sms", "+13035550100"), null);
  store.close();
});

test("takeLatestPending matches sender handle case-insensitively", () => {
  const store = createStore(":memory:");
  store.savePending(makePending({ handle: "Matt@Example.com" }));
  const taken = store.takeLatestPending("sms", "  MATT@example.com ");
  assert.ok(taken);
  store.close();
});

test("expired pending returns null and the row is deleted", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-store-test-"));
  const dbPath = join(dir, "test.db");
  const store = createStore(dbPath);
  store.savePending(
    makePending({ expiresAt: new Date(Date.now() - 1000).toISOString() }), // already expired
  );

  assert.equal(store.takeLatestPending("sms", "+13035550100"), null);

  // Verify the expired row was physically deleted, via a second connection.
  const raw = new Database(dbPath, { readonly: true });
  const row = raw.prepare("SELECT COUNT(*) AS n FROM agent_pending").get() as { n: number };
  assert.equal(row.n, 0);
  raw.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("log rows accumulate with fields mapped", () => {
  const store = createStore(":memory:");
  store.logAction({
    channel: "sms",
    handle: "+13035550100",
    playerName: "Matt",
    rawMessage: "shot 82",
    parsedJson: '{"kind":"record_score"}',
    outcome: "confirm_requested",
  });
  store.logAction({ channel: "sms", handle: "+13035550100", outcome: "unknown_sender" });

  const rows = store.listLog();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].outcome, "confirm_requested");
  assert.equal(rows[0].playerName, "Matt");
  assert.equal(rows[0].rawMessage, "shot 82");
  assert.equal(rows[0].parsedJson, '{"kind":"record_score"}');
  assert.match(rows[0].at, /^\d{4}-\d{2}-\d{2}T.*Z$/); // ISO-8601 UTC
  assert.equal(rows[1].outcome, "unknown_sender");
  assert.equal(rows[1].playerName, null);
  assert.ok(rows[1].id > rows[0].id);
  store.close();
});
