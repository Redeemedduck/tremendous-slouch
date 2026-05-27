import { describe, expect, it } from "vitest";
import { buildBlockerHandoff, buildBlockerHandoffText } from "./blockerHandoff";
import type { CommissionerTask } from "./commissionerTasks";
import { SOURCE_SEARCH_LEDGER } from "./sourceSearchLedger";

const task = (overrides: Partial<CommissionerTask>): CommissionerTask => ({
  id: "collect-buyins",
  area: "money",
  severity: "risk",
  title: "Track buy-in status",
  detail: "$3,575 outstanding.",
  nextAction: "Record paid evidence or leave outstanding.",
  items: ["Beck: $325"],
  copyText: "DJDI buy-in status:\nStill owed: Beck",
  done: false,
  ...overrides,
});

describe("blocker handoff", () => {
  it("joins open tasks to source-search decisions", () => {
    const handoff = buildBlockerHandoff(
      [
        task({ id: "collect-buyins", title: "Track buy-in status" }),
        task({
          id: "collect-ghin-indexes",
          area: "roster",
          title: "Record handicap indexes",
        }),
        task({
          id: "verify-production-url",
          area: "launch",
          severity: "external",
          title: "Verify production URL",
          nextAction: "Run remote smoke against the final URL.",
          copyText:
            "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke",
        }),
      ],
      SOURCE_SEARCH_LEDGER
    );

    expect(handoff.summary).toMatchObject({
      taskCount: 3,
      manualActionRequired: 3,
    });
    expect(handoff.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "collect-buyins",
          evidenceStatus: "blocked_source",
          manualEvidencePath: expect.stringContaining(
            "Ops > One-Paste Intake"
          ),
          sourceSearchEntryIds: expect.arrayContaining([
            "additional-buyin-searches",
            "messages-access-denied",
          ]),
        }),
        expect.objectContaining({
          taskId: "collect-ghin-indexes",
          evidenceStatus: "blocked_source",
          sourceSearchEntryIds: expect.arrayContaining(["missing-ghin-searches"]),
        }),
        expect.objectContaining({
          taskId: "verify-production-url",
          evidenceStatus: "not_searched",
          manualEvidencePath: "Run remote smoke against the final URL.",
          sourceSearchEntryIds: [],
        }),
      ])
    );
  });

  it("renders a concise text handoff", () => {
    const text = buildBlockerHandoffText(
      [task({ id: "confirm-schedule", area: "schedule", title: "Confirm schedule" })],
      SOURCE_SEARCH_LEDGER
    );

    expect(text).toContain("DJDI Commissioner Handoff");
    expect(text).toContain("[1. Confirm schedule]");
    expect(text).toContain("Evidence: blocked_source");
    expect(text).toContain("Manual evidence path:");
    expect(text).toContain("Ops > One-Paste Intake");
    expect(text).toContain("Left the mid-season major and championship details as TBD.");
  });
});
