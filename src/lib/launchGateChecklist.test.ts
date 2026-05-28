import { describe, expect, it } from "vitest";
import {
  buildLaunchGateChecklist,
  buildLaunchGateChecklistText,
} from "./launchGateChecklist";

const records = [
  {
    key: "dockerBuildVerified" as const,
    label: "Docker image build",
    envVar: "DJDI_DOCKER_BUILD_VERIFIED",
    verified: true,
    source: "database" as const,
    verifiedAt: "2026-05-19T09:44:35.543Z",
    verifiedBy: "Jayson Post",
    note: null,
    updatedAt: "2026-05-19T09:44:35.543Z",
  },
  {
    key: "tailnetServeVerified" as const,
    label: "Tailscale Funnel smoke",
    envVar: "DJDI_TAILNET_URL_VERIFIED",
    verified: true,
    source: "database" as const,
    verifiedAt: "2026-05-19T20:40:00.000Z",
    verifiedBy: "Codex",
    note: "Tailscale Funnel route verified.",
    updatedAt: "2026-05-19T20:40:00.000Z",
  },
  {
    key: "productionUrlVerified" as const,
    label: "Production URL smoke",
    envVar: "DJDI_PRODUCTION_URL_VERIFIED",
    verified: false,
    source: "none" as const,
    verifiedAt: null,
    verifiedBy: null,
    note: null,
    updatedAt: null,
  },
  {
    key: "mobileSafariVerified" as const,
    label: "iPhone Safari golden path",
    envVar: "DJDI_MOBILE_SAFARI_VERIFIED",
    verified: false,
    source: "none" as const,
    verifiedAt: null,
    verifiedBy: null,
    note: null,
    updatedAt: null,
  },
];

describe("launch gate checklist", () => {
  it("maps launch check records into evidence-grade checklist rows", () => {
    const checklist = buildLaunchGateChecklist(records);

    expect(checklist.summary).toEqual({
      total: 4,
      verified: 2,
      open: 1,
      notRequired: 1,
    });
    expect(checklist.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "tailnetServeVerified",
          status: "verified",
          steps: expect.arrayContaining([
            expect.objectContaining({ id: "funnel-smoke" }),
            expect.objectContaining({ id: "funnel-mobile" }),
          ]),
        }),
        expect.objectContaining({
          key: "productionUrlVerified",
          status: "not_required",
          steps: expect.arrayContaining([
            expect.objectContaining({
              id: "production-prereqs",
              command: "npm run verify:deploy-prereqs",
            }),
            expect.objectContaining({
              id: "funnel-fallback",
              command:
                "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131 && tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api",
            }),
            expect.objectContaining({
              id: "remote-smoke",
              command:
                "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke",
            }),
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

  it("renders a human checklist for the final launch gates", () => {
    const text = buildLaunchGateChecklistText(records);

    expect(text).toContain("DJDI Launch Gate Checklist");
    expect(text).toContain("Verified: 2 of 4");
    expect(text).toContain("Not required for current Tailscale hosting: 1");
    expect(text).toContain("Tailscale Funnel smoke");
    expect(text).toContain("REMOTE_SMOKE_URL=https://...");
    expect(text).toContain("REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code>");
    expect(text).toContain("physical-device golden path");
  });

  it("treats public production URL as open when the optional public gate is required", () => {
    const checklist = buildLaunchGateChecklist(records, {
      productionUrlRequired: true,
    });

    expect(checklist.summary).toEqual({
      total: 4,
      verified: 2,
      open: 2,
      notRequired: 0,
    });
    expect(
      checklist.items.find((item) => item.key === "productionUrlVerified")
    ).toMatchObject({
      status: "open",
      finalAction:
        "Mark Production URL smoke verified in Ops only after remote smoke passes against the final URL.",
    });
  });
});
