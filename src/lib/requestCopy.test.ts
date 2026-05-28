import { describe, expect, it } from "vitest";
import {
  buildAccessCodeSetup,
  buildCollectionAsk,
  buildHandicapAsk,
  buildIphoneSafariChecklist,
  buildProductionUrlChecklist,
  buildScheduleAsk,
} from "./requestCopy";
import type { Buyin, Player, Tournament } from "./types";

function buyin(overrides: Partial<Buyin>): Buyin {
  return {
    playerName: "Player",
    amount: 325,
    paid: false,
    paidAt: null,
    notes: null,
    updatedAt: "now",
    ...overrides,
  };
}

function player(overrides: Partial<Player>): Player {
  return {
    name: "Player",
    handicap: null,
    member: true,
    updatedAt: "now",
    ...overrides,
  };
}

function tournament(overrides: Partial<Tournament>): Tournament {
  return {
    id: "event",
    name: "Event",
    course: "Common Ground",
    windowStart: "2026-05-18",
    windowEnd: "2026-05-24",
    type: "regular",
    pointsToFirst: 100,
    payoutFirst: 334,
    payoutSecond: null,
    payoutThird: null,
    notes: null,
    createdAt: "now",
    ...overrides,
  };
}

describe("request copy builders", () => {
  it("builds a compact status ask when all open amounts match", () => {
    expect(
      buildCollectionAsk([
        buyin({ playerName: "Beck" }),
        buyin({ playerName: "Chris" }),
        buyin({ playerName: "Kyle", paid: true }),
      ])
    ).toBe(
      [
        "DJDI buy-in status tracker:",
        "Status still open ($325 each): Beck, Chris",
        "Outstanding total: $650",
      ].join("\n")
    );
  });

  it("builds a per-player status ask when amounts differ", () => {
    expect(
      buildCollectionAsk([
        buyin({ playerName: "Beck", amount: 325 }),
        buyin({ playerName: "Guest", amount: 100 }),
      ])
    ).toBe(
      [
        "DJDI buy-in status tracker:",
        "Status still open:",
        "Beck: $325",
        "Guest: $100",
        "Outstanding total: $425",
      ].join("\n")
    );
  });

  it("handles a fully settled status list", () => {
    expect(buildCollectionAsk([buyin({ paid: true })])).toBe(
      "DJDI buy-in status tracker:\nAll buy-ins are recorded as settled."
    );
  });

  it("builds a handicap-record request for missing member handicaps only", () => {
    expect(
      buildHandicapAsk([
        player({ name: "Beck" }),
        player({ name: "Guest", member: false }),
        player({
          name: "Kyle",
          handicap: 3.6,
          handicapSource: "GHIN lookup",
          handicapVerifiedAt: "now",
          handicapVerifiedBy: "Commissioner",
        }),
      ])
    ).toBe(
      [
        "DJDI handicap records still needed:",
        "Beck",
        "Please send your current handicap index or GHIN/CGA source note. The board stores the source and uses the entered course handicap for league scoring evidence.",
      ].join("\n")
    );
  });

  it("handles complete member handicap data", () => {
    expect(
      buildHandicapAsk([
        player({
          handicap: 10.6,
          handicapSource: "GHIN lookup",
          handicapVerifiedAt: "now",
          handicapVerifiedBy: "Commissioner",
        }),
      ])
    ).toBe(
      "DJDI handicap records:\nAll member handicap indexes are recorded with source notes."
    );
  });

  it("builds a schedule ask for seeded TBD events", () => {
    expect(
      buildScheduleAsk([
        tournament({
          name: "Mid-season major",
          course: "TBD",
          windowStart: "2026-07-01",
          windowEnd: "2026-07-12",
          notes: "TBD course and purse",
        }),
        tournament({ name: "Stop 1" }),
      ])
    ).toBe(
      [
        "DJDI schedule details still needed:",
        "Mid-season major: TBD, 2026-07-01 to 2026-07-12, TBD course and purse",
        "Please send confirmed course, window, and notes so the league board can stop carrying TBDs.",
      ].join("\n")
    );
  });

  it("handles confirmed schedule details", () => {
    expect(buildScheduleAsk([tournament({ name: "Stop 1" })])).toBe(
      "DJDI schedule details:\nAll seeded event details are confirmed."
    );
  });

  it("builds copy-ready access-code setup commands", () => {
    expect(buildAccessCodeSetup("djdi-test")).toBe(
      [
        "DJDI access-code setup:",
        "1. Create a shared access code in 1Password or another password manager.",
        "2. Set the production secret:",
        "fly secrets set ACCESS_CODE='<shared-code>' -a djdi-test",
        "3. Restart the app so the runtime picks it up:",
        "fly apps restart djdi-test",
        "4. Verify the locked public URL:",
        "REMOTE_SMOKE_URL=https://djdi-test.fly.dev REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke",
      ].join("\n")
    );
  });

  it("builds copy-ready public URL unblocker commands", () => {
    const text = buildProductionUrlChecklist("djdi-test");

    expect(text).toContain("fly auth login");
    expect(text).toContain("npm run verify:deploy-prereqs");
    expect(text).toContain("fly deploy");
    expect(text).toContain(
      "REMOTE_SMOKE_URL=https://djdi-test.fly.dev REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke"
    );
    expect(text).toContain(
      "https://login.tailscale.com/f/funnel?node=nnRP2Xzazg11CNTRL"
    );
    expect(text).toContain(
      "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131"
    );
    expect(text).toContain(
      "tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api"
    );
    expect(text).toContain(
      "REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net/golf REMOTE_SMOKE_ACCESS_CODE='<shared-code>' REMOTE_SMOKE_COMMISSIONER_CODE='<admin-code>' npm run verify:remote-smoke"
    );
    expect(text).toContain("Do not mark Production URL smoke verified");
  });

  it("builds a physical iPhone Safari verification checklist", () => {
    const text = buildIphoneSafariChecklist();
    expect(text).toContain("http://100.102.92.28:3131/golf");
    expect(text).toContain("https://duckbookpro.clouded-tailor.ts.net/golf");
    expect(text).toContain("Board, Season, Money, Roster, and Admin");
    expect(text).toContain("Archive export links");
    expect(text).toContain("mark iPhone Safari verified");
  });
});
