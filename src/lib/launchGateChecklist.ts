type LaunchCheckRecord = {
  key:
    | "dockerBuildVerified"
    | "tailnetServeVerified"
    | "productionUrlVerified"
    | "mobileSafariVerified";
  label: string;
  envVar: string;
  verified: boolean;
  source: "env" | "database" | "none";
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  updatedAt: string | null;
};

export type LaunchGateChecklistStep = {
  id: string;
  label: string;
  requiredEvidence: string;
  command?: string;
};

export type LaunchGateChecklistItem = {
  key: LaunchCheckRecord["key"];
  label: string;
  status: "verified" | "open" | "not_required";
  source: LaunchCheckRecord["source"];
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  envVar: string;
  steps: LaunchGateChecklistStep[];
  finalAction: string;
};

type LaunchGateChecklistOptions = {
  productionUrlRequired?: boolean;
};

const checklistSteps: Record<
  LaunchCheckRecord["key"],
  {
    steps: LaunchGateChecklistStep[];
    finalAction: string;
  }
> = {
  dockerBuildVerified: {
    steps: [
      {
        id: "docker-smoke",
        label: "Run production Docker smoke.",
        requiredEvidence: "The verifier exits 0 and prints ok: true.",
        command: "npm run verify:docker",
      },
      {
        id: "docker-note",
        label: "Record Docker gate evidence in Admin.",
        requiredEvidence: "Admin Launch Gates shows Docker image build verified.",
      },
    ],
    finalAction: "Mark Docker image build verified in Admin after the smoke passes.",
  },
  tailnetServeVerified: {
    steps: [
      {
        id: "tailscale-funnel-status",
        label: "Confirm Tailscale Funnel route.",
        requiredEvidence:
          "tailscale funnel status shows the DJDI hostname proxying /golf to local port 3131 and /golf-api to /api.",
        command: "tailscale funnel status",
      },
      {
        id: "funnel-health",
        label: "Check Funnel HTTPS health.",
        requiredEvidence:
          "The Funnel API health endpoint returns ok: true and database: ok.",
        command:
          "curl -fsS https://duckbookpro.clouded-tailor.ts.net/golf-api/health",
      },
      {
        id: "funnel-smoke",
        label: "Run Funnel remote smoke.",
        requiredEvidence: "The verifier exits 0 and prints ok: true.",
        command:
          "REMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net/golf REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke",
      },
      {
        id: "funnel-mobile",
        label: "Run Funnel mobile viewport smoke.",
        requiredEvidence: "The verifier exits 0 and prints ok: true.",
        command:
          "REMOTE_MOBILE_URL=https://duckbookpro.clouded-tailor.ts.net/golf REMOTE_MOBILE_ACCESS_CODE=<code> REMOTE_MOBILE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-mobile-ux",
      },
      {
        id: "funnel-note",
        label: "Record Funnel evidence in Admin.",
        requiredEvidence:
          "Admin Launch Gates shows Tailscale Funnel smoke verified with the Funnel URL and date.",
      },
    ],
    finalAction:
      "Mark Tailscale Funnel smoke verified in Admin after Funnel status, health, remote smoke, and mobile smoke pass.",
  },
  productionUrlVerified: {
    steps: [
      {
        id: "production-prereqs",
        label: "Check public URL prerequisites.",
        requiredEvidence:
          "The verifier shows either Fly deploy prerequisites are ready or a dedicated public Funnel route is configured for DJDI.",
        command: "npm run verify:deploy-prereqs",
      },
      {
        id: "final-url",
        label: "Use the final public or always-on production URL.",
        requiredEvidence:
          "The URL is not localhost or a Funnel-disabled URL. If using Tailscale Funnel, record that it is public but depends on this Mac staying online.",
      },
      {
        id: "funnel-fallback",
        label: "Use the dedicated Funnel route.",
        requiredEvidence:
          "Tailscale Funnel is enabled in the admin console and `tailscale funnel status` shows the DJDI route as Funnel on.",
        command:
          "tailscale funnel --bg --yes --https=443 --set-path=/golf 3131 && tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api",
      },
      {
        id: "remote-smoke",
        label: "Run read-only remote production smoke.",
        requiredEvidence: "The verifier exits 0 and prints ok: true for the final URL.",
        command:
          "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke",
      },
      {
        id: "production-note",
        label: "Record URL and smoke timestamp in Admin.",
        requiredEvidence:
          "Admin Launch Gates shows Production URL smoke verified with a note naming the final URL.",
      },
    ],
    finalAction:
      "Mark Production URL smoke verified in Admin only after remote smoke passes against the final URL.",
  },
  mobileSafariVerified: {
    steps: [
      {
        id: "iphone-open",
        label: "Open the direct Tailscale-IP phone URL on physical iPhone Safari.",
        requiredEvidence:
          "http://100.102.92.28:3131/golf loads in Safari, not desktop Chrome emulation.",
      },
      {
        id: "iphone-unlock",
        label: "Unlock with the shared access code.",
        requiredEvidence: "The board opens after entering the access code.",
      },
      {
        id: "iphone-navigation",
        label: "Check Board, Season, Money, Roster, and Admin navigation.",
        requiredEvidence: "All five sections are reachable without clipped or overlapping controls.",
      },
      {
        id: "iphone-score-ops",
        label: "Check score controls and Admin export links.",
        requiredEvidence:
          "Score controls, League Checklist, Commissioner Tasks, Closeout exports, Archive, handoff, and launch gate controls are usable.",
      },
      {
        id: "iphone-note",
        label: "Record physical device evidence in Admin.",
        requiredEvidence:
          "Admin Launch Gates shows iPhone Safari golden path verified with device/date notes.",
      },
    ],
    finalAction:
      "Mark iPhone Safari verified in Admin only after the physical-device golden path passes.",
  },
};

export function buildLaunchGateChecklist(
  records: LaunchCheckRecord[],
  options: LaunchGateChecklistOptions = {}
) {
  const items = records.map((record) => {
    const definition = checklistSteps[record.key];
    const status =
      record.key === "productionUrlVerified" &&
      !record.verified &&
      !options.productionUrlRequired
        ? "not_required"
        : record.verified
          ? "verified"
          : "open";
    return {
      key: record.key,
      label: record.label,
      status,
      source: record.source,
      verifiedAt: record.verifiedAt,
      verifiedBy: record.verifiedBy,
      note: record.note,
      envVar: record.envVar,
      steps: definition.steps,
      finalAction:
        status === "not_required"
          ? "No action needed unless the league later requires an always-on host that does not depend on this Mac."
          : definition.finalAction,
    } satisfies LaunchGateChecklistItem;
  });

  return {
    summary: {
      total: items.length,
      verified: items.filter((item) => item.status === "verified").length,
      open: items.filter((item) => item.status === "open").length,
      notRequired: items.filter((item) => item.status === "not_required").length,
    },
    items,
  };
}

export function buildLaunchGateChecklistText(
  records: LaunchCheckRecord[],
  options: LaunchGateChecklistOptions = {}
) {
  const checklist = buildLaunchGateChecklist(records, options);
  return [
    "DJDI Launch Gate Checklist",
    `Verified: ${checklist.summary.verified} of ${checklist.summary.total}`,
    checklist.summary.notRequired > 0
      ? `Not required for current Tailscale hosting: ${checklist.summary.notRequired}`
      : "",
    "",
    ...checklist.items.flatMap((item) => [
      `[${item.label}]`,
      `Status: ${item.status}${item.verifiedAt ? ` at ${item.verifiedAt}` : ""}`,
      `Evidence source: ${item.source}`,
      item.note ? `Note: ${item.note}` : `Env flag: ${item.envVar}`,
      "Steps:",
      ...item.steps.map((step, index) =>
        `${index + 1}. ${step.label} Evidence: ${step.requiredEvidence}${
          step.command ? ` Command: ${step.command}` : ""
        }`
      ),
      `Final action: ${item.finalAction}`,
      "",
    ]),
  ].join("\n");
}
