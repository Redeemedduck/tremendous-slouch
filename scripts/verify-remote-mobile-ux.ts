import { chromium, type Page } from "playwright";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const rawUrl =
  process.env.REMOTE_MOBILE_URL ??
  process.env.DJDI_REMOTE_MOBILE_URL ??
  process.env.REMOTE_SMOKE_URL ??
  process.env.DJDI_REMOTE_SMOKE_URL ??
  process.env.DJDI_PRODUCTION_URL ??
  process.env.PRODUCTION_URL;
const accessCode =
  process.env.REMOTE_MOBILE_ACCESS_CODE ??
  process.env.DJDI_REMOTE_MOBILE_ACCESS_CODE ??
  process.env.REMOTE_SMOKE_ACCESS_CODE ??
  process.env.DJDI_REMOTE_SMOKE_ACCESS_CODE ??
  process.env.ACCESS_CODE;
const commissionerCode =
  process.env.REMOTE_MOBILE_COMMISSIONER_CODE ??
  process.env.DJDI_REMOTE_MOBILE_COMMISSIONER_CODE ??
  process.env.REMOTE_SMOKE_COMMISSIONER_CODE ??
  process.env.DJDI_REMOTE_SMOKE_COMMISSIONER_CODE ??
  process.env.COMMISSIONER_CODE;

if (!rawUrl) {
  console.error(
    "Remote mobile UX verification failed: set REMOTE_MOBILE_URL=https://your-app.example"
  );
  process.exit(1);
}

const baseUrl = rawUrl.replace(/\/+$/, "");
const dollars = (amount: number) => `$${amount.toLocaleString("en-US")}`;
const base = new URL(baseUrl);
const basePath = base.pathname.replace(/\/+$/, "");
const apiBasePath =
  basePath && basePath !== "/" ? `${basePath}-api` : "/api";

async function expectSectionAnchored(page: Page, id: string) {
  try {
    await page.waitForFunction(
      (sectionId) => {
        const section = document.getElementById(sectionId);
        if (!section) return false;
        const box = section.getBoundingClientRect();
        return box.top < window.innerHeight * 0.75 && box.bottom > 80;
      },
      id,
      { timeout: 5000 }
    );
  } catch (error) {
    throw new Error(
      `Admin map did not bring #${id} into mobile view: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function remoteApiPath(path: string) {
  return `${apiBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${base.origin}${path}`, init);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`${path} returned non-JSON body with HTTP ${response.status}`);
  }
  return { status: response.status, body, headers: response.headers };
}

try {
  const health = await fetchJson<{ ok: boolean; database: string }>(
    remoteApiPath("/health")
  );
  if (health.status !== 200 || !health.body.ok || health.body.database !== "ok") {
    throw new Error(`health check failed with HTTP ${health.status}`);
  }

  const accessBefore = await fetchJson<{ required: boolean; ok: boolean }>(
    remoteApiPath("/access")
  );
  if (accessBefore.status !== 200) {
    throw new Error(`access check failed with HTTP ${accessBefore.status}`);
  }
  if (!accessBefore.body.required) {
    throw new Error("remote app ACCESS_CODE gate is not configured");
  }
  if (!accessCode) {
    throw new Error(
      "remote app requires ACCESS_CODE; set REMOTE_MOBILE_ACCESS_CODE, REMOTE_SMOKE_ACCESS_CODE, or ACCESS_CODE"
    );
  }

  let verificationRun: { id?: string; status?: string } | null = null;
  let cleanupTeeTimeId: string | null = null;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let page: Page | null = null;
  try {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    page.setDefaultTimeout(15_000);

    await page.goto(baseUrl, { waitUntil: "load" });
    if (accessBefore.body.required) {
      await page.getByPlaceholder("Access code").fill(accessCode ?? "");
      await page.getByRole("button", { name: "Unlock" }).click();
    }
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    await page.evaluate(async (apiPrefix) => {
      localStorage.removeItem("golf.coordinator.myName");
      localStorage.removeItem("golf.coordinator.myHandicap");
      const response = await fetch(`${apiPrefix}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Server Cookie Player" }),
      });
      if (!response.ok) {
        throw new Error("could not seed signed server profile");
      }
    }, apiBasePath);
    await page.reload({ waitUntil: "load" });
    await page
      .getByRole("button", { name: /Playing as Server Cookie Player/ })
      .waitFor();
    await page.evaluate(() => {
      localStorage.setItem("golf.coordinator.myName", "Beck");
      localStorage.setItem("golf.coordinator.myHandicap", "8.2");
    });
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    const nav = page.getByRole("navigation");
    await page.getByRole("button", { name: "Board", exact: true }).waitFor();
    await page.getByRole("button", { name: "Season", exact: true }).waitFor();
    await page.getByRole("button", { name: "Roster", exact: true }).waitFor();
    if ((await nav.getByRole("button", { name: "Money", exact: true }).count()) > 0) {
      throw new Error("remote locked player nav exposed Money");
    }
    if ((await nav.getByRole("button", { name: "Ops", exact: true }).count()) > 0) {
      throw new Error("remote locked player nav exposed Ops");
    }

    const playerFlow = await page.evaluate(async (apiPrefix) => {
      const stamp = Date.now();
      const course = `Remote Player Flow ${stamp}`;
      const profile = await fetch(`${apiPrefix}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Beck" }),
      });
      if (!profile.ok) {
        throw new Error("could not set Beck profile for player-flow proof");
      }
      const response = await fetch(`${apiPrefix}/teetimes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          course,
          date: "2026-09-30",
          time: "09:40",
          spots: 4,
          host: "Beck",
          notes: "Remote mobile verifier temporary player flow.",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        teeTime?: { id?: string };
        error?: string;
      };
      if (!response.ok || !body.teeTime?.id) {
        throw new Error(
          body.error || `could not create player-flow tee time: HTTP ${response.status}`
        );
      }
      return { id: body.teeTime.id, course };
    }, apiBasePath);
    cleanupTeeTimeId = playerFlow.id;
    await page.reload({ waitUntil: "load" });
    const hostFlowCard = page.locator("article").filter({ hasText: playerFlow.course });
    await hostFlowCard.getByText("Hosted by Beck").waitFor();
    await hostFlowCard.getByRole("button", { name: "Host options" }).waitFor();
    await hostFlowCard.getByText("1 of 4").first().waitFor();

    await page.evaluate(async (apiPrefix) => {
      localStorage.setItem("golf.coordinator.myName", "Chris");
      localStorage.removeItem("golf.coordinator.myHandicap");
      const response = await fetch(`${apiPrefix}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Chris" }),
      });
      if (!response.ok) {
        throw new Error("could not set Chris profile for player-flow proof");
      }
    }, apiBasePath);
    await page.reload({ waitUntil: "load" });
    const playerFlowCard = page.locator("article").filter({ hasText: playerFlow.course });
    await playerFlowCard.getByText("Hosted by Beck").waitFor();
    if ((await playerFlowCard.getByRole("button", { name: "Host options" }).count()) > 0) {
      throw new Error("remote non-host saw host controls on player-flow tee time");
    }
    if (
      (await playerFlowCard
        .getByRole("button", { name: "Commissioner tee-time options" })
        .count()) > 0
    ) {
      throw new Error("remote non-commissioner saw commissioner controls on player-flow tee time");
    }
    await playerFlowCard.getByRole("button", { name: "Maybe" }).click();
    await playerFlowCard.getByText("You're maybe").waitFor();
    await playerFlowCard.getByRole("button", { name: "Claim a spot" }).click();
    await playerFlowCard.getByText("You're in").waitFor();
    await playerFlowCard.getByText("2 of 4").first().waitFor();
    await playerFlowCard.getByRole("button", { name: "Add a comment" }).click();
    await playerFlowCard
      .getByPlaceholder("Say something to the group…")
      .fill("Remote mobile player coordination proof");
    await playerFlowCard.getByRole("button", { name: "Post comment" }).click();
    await playerFlowCard
      .getByText("Remote mobile player coordination proof")
      .waitFor();

    await page.getByRole("button", { name: /Past tee times/ }).click();
    await page.getByText("Scores", { exact: true }).waitFor();
    await page
      .getByText(/attested|commissioner override|needs confirm/)
      .first()
      .waitFor();
    await page.getByText(/net/).first().waitFor();
    if ((await page.getByRole("button", { name: "Host options" }).count()) > 0) {
      throw new Error("remote non-host player saw host controls");
    }
    if ((await page.getByRole("button", { name: "Confirm" }).count()) > 0) {
      throw new Error("remote plain player saw score attestation action for someone else");
    }
    await page.getByRole("button", { name: "Roster", exact: true }).click();
    await page.getByRole("heading", { name: "League Roster" }).waitFor();
    await page.getByText("Handicap Index:", { exact: false }).first().waitFor();
    if ((await page.getByText("Paste handicap evidence").count()) > 0) {
      throw new Error(
        "remote public roster exposed commissioner handicap-evidence controls"
      );
    }
    if (!commissionerCode) {
      throw new Error(
        "remote app requires COMMISSIONER_CODE; set REMOTE_MOBILE_COMMISSIONER_CODE, REMOTE_SMOKE_COMMISSIONER_CODE, or COMMISSIONER_CODE"
      );
    }
    await page.evaluate(() => {
      localStorage.setItem("golf.coordinator.myName", "Jayson Post");
      localStorage.setItem("golf.coordinator.myHandicap", "10.6");
    });
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    await page
      .getByRole("button", { name: /Playing as Jayson Post/ })
      .click();
    await page.getByRole("button", { name: "Commissioner tools" }).click();
    const commissionerCodeInput = page.getByPlaceholder("Commissioner code");
    await commissionerCodeInput.waitFor();
    if ((await commissionerCodeInput.getAttribute("type")) !== "text") {
      throw new Error("remote commissioner code input must stay visible text, not password");
    }
    await commissionerCodeInput.fill(commissionerCode);
    await page.getByRole("button", { name: "Unlock commissioner tools" }).click();
    await nav.getByRole("button", { name: "Money", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Roster", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Ops", exact: true }).waitFor();

    await nav.getByRole("button", { name: "Board", exact: true }).click();
    await page.getByRole("button", { name: /Past tee times/ }).click();
    await page.getByRole("button", { name: "Host options" }).first().click();
    await page.getByRole("button", { name: "Edit scores" }).click();
    await page.getByRole("button", { name: "Delete Jayson Post score" }).waitFor();
    await page.keyboard.press("Escape");

    if (cleanupTeeTimeId) {
      await page.evaluate(
        async ({ apiPrefix, id }) => {
          const response = await fetch(`${apiPrefix}/teetimes/${id}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(
              body.error ||
                `could not clean remote player-flow tee time: HTTP ${response.status}`
            );
          }
        },
        { apiPrefix: apiBasePath, id: cleanupTeeTimeId }
      );
      cleanupTeeTimeId = null;
    }

    const readiness = await page.evaluate(async (apiPrefix) => {
      const response = await fetch(`${apiPrefix}/export/readiness.json`);
      if (!response.ok) {
        throw new Error(`readiness fetch failed with HTTP ${response.status}`);
      }
      return (await response.json()) as {
        money: { expected: number; outstanding: number };
        missingHandicaps: string[];
        launchRisks: Array<{ label: string; detail: string }>;
      };
    }, apiBasePath);
    const requestPacketCheck = await page.evaluate(async (apiPrefix) => {
      const [launchResponse, packetResponse, evidenceResponse] = await Promise.all([
        fetch(`${apiPrefix}/launch-checks`),
        fetch(`${apiPrefix}/export/request-packet.txt`),
        fetch(`${apiPrefix}/export/evidence-gap-packet.json`),
      ]);
      if (!launchResponse.ok) {
        throw new Error(`launch-checks fetch failed with HTTP ${launchResponse.status}`);
      }
      if (!packetResponse.ok) {
        throw new Error(`request packet fetch failed with HTTP ${packetResponse.status}`);
      }
      if (!evidenceResponse.ok) {
        throw new Error(
          `evidence gap packet fetch failed with HTTP ${evidenceResponse.status}`
        );
      }
      const launchBody = (await launchResponse.json()) as {
        launchChecks?: { tailnetServeVerified?: boolean };
      };
      const packet = await packetResponse.text();
      const evidence = (await evidenceResponse.json()) as {
        summary?: { onePasteReady?: number; launchVerification?: number };
        items?: Array<{ blockerId?: string }>;
      };
      return {
        tailnetServeVerified: !!launchBody.launchChecks?.tailnetServeVerified,
        hasTailnetUrl: packet.includes("https://duckbookpro.clouded-tailor.ts.net"),
        hasPrivateTailnetMode: packet.includes(
          "Private Tailscale hosting is the working access path"
        ),
        hasEvidenceGapPacket:
          (evidence.summary?.onePasteReady ?? 0) > 0 &&
          (evidence.summary?.launchVerification ?? 0) > 0 &&
          !!evidence.items?.some((item) => item.blockerId === "money-collected"),
      };
    }, apiBasePath);
    if (
      requestPacketCheck.tailnetServeVerified &&
      (!requestPacketCheck.hasTailnetUrl || !requestPacketCheck.hasPrivateTailnetMode)
    ) {
      throw new Error(
        "verified tailnet request packet is missing the tailnet URL or private-hosting note"
      );
    }
    if (!requestPacketCheck.hasEvidenceGapPacket) {
      throw new Error("remote evidence gap packet is missing open gap rows");
    }
    const moneyRisk = readiness.launchRisks.find(
      (risk) => risk.label === "Buy-in tracking"
    );
    if (!moneyRisk) {
      throw new Error("remote readiness export is missing Buy-in tracking risk");
    }
    const settled = readiness.money.expected - readiness.money.outstanding;

    for (const tab of ["Board", "Season", "Money", "Roster", "Ops"]) {
      await nav.getByRole("button", { name: tab, exact: true }).waitFor();
    }

    await nav.getByRole("button", { name: "Ops", exact: true }).click();
    await page.getByText("Admin Console", { exact: true }).waitFor();
    await page.getByText("Buy-in tracking", { exact: true }).first().waitFor();
    if (readiness.money.outstanding <= 0) {
      throw new Error("remote readiness export unexpectedly has no outstanding buy-ins");
    }
    await page.getByRole("button", { name: /Backup proof/ }).waitFor();

    await nav.getByRole("button", { name: "Season", exact: true }).click();
    await page
      .getByRole("button", { name: /Season.*(active|upcoming|past)/ })
      .waitFor();
    await page.getByRole("button", { name: /Standings 6 players/ }).waitFor();

    await nav.getByRole("button", { name: "Money", exact: true }).click();
    await page
      .getByRole("button", {
        name: new RegExp(
          `Pool.*${dollars(settled).replace("$", "\\$")} settled of ${dollars(
            readiness.money.expected
          ).replace("$", "\\$")}`
        ),
      })
      .click();
    await page.getByRole("button", { name: "Copy status request" }).waitFor();

    await nav.getByRole("button", { name: "Roster", exact: true }).click();
    await page
      .getByRole("button", {
        name: new RegExp(
          `Roster 12 members.*${readiness.missingHandicaps.length} hcp missing`
        ),
      })
      .click();
    await page.getByRole("button", { name: "Copy records" }).waitFor();

    await nav.getByRole("button", { name: "Ops", exact: true }).click();
    await page.getByText("Admin Console", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Do Next" }).waitFor();
    const readinessPanel = page.locator(
      'section[aria-label="Operational readiness and data gaps"]'
    );
    await readinessPanel
      .getByRole("heading", { name: "Operational Readiness" })
      .waitFor();
    await readinessPanel
      .getByText("App readiness separated from handicap, buy-in status, schedule, and device gaps.")
      .waitFor();
    await readinessPanel.getByText(/App \d+ open/).waitFor();
    await readinessPanel.getByText(/Data \d+ open/).waitFor();
    await readinessPanel
      .getByRole("button", { name: /Roster.*missing\/unverified:/s })
      .waitFor();
    await readinessPanel
      .getByRole("link", { name: "Completion Audit", exact: true })
      .first()
      .waitFor();
    await page.getByRole("heading", { name: "Roles" }).waitFor();
    const rolesSection = page
      .getByRole("heading", { name: "Roles" })
      .locator("..");
    await rolesSection.getByText("Player", { exact: true }).waitFor();
    await rolesSection.getByText("Host", { exact: true }).waitFor();
    await rolesSection.getByText("Commissioner", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Admin Map" }).waitFor();
    await page.getByRole("button", { name: /Roster \/ Handicap/ }).waitFor();
    await page.getByRole("button", { name: /Buy-ins/ }).waitFor();
    await page.getByRole("button", { name: /Tee times/ }).waitFor();
    await page.getByRole("button", { name: /Score review/ }).waitFor();
    await page.getByRole("button", { name: /Attestation review/ }).waitFor();
    await page.getByRole("button", { name: /Standings closeout/ }).waitFor();
    await page.getByRole("button", { name: /Closeout packets/ }).waitFor();
    await page.getByRole("button", { name: /Payout closeout/ }).waitFor();
    await page.getByRole("button", { name: /Launch checks/ }).waitFor();
    await page.getByRole("link", { name: "Backup database" }).waitFor();
    await page.getByRole("button", { name: /Backup proof/ }).waitFor();
    await page.getByRole("button", { name: /Backup proof/ }).click();
    await page.getByText("Backup verified").waitFor();
    await page.getByRole("button", { name: /Exports/ }).waitFor();
    await page.getByRole("button", { name: /Audit log/ }).waitFor();
    await page.getByRole("button", { name: /Advanced Ops/ }).waitFor();
    await page.getByRole("button", { name: /Tee times/ }).click();
    await expectSectionAnchored(page, "admin-tee-time-oversight");
    await page.getByRole("button", { name: /Score review/ }).click();
    await expectSectionAnchored(page, "admin-score-attestation-review");
    await page.getByRole("button", { name: /Attestation review/ }).click();
    await expectSectionAnchored(page, "admin-score-attestation-review");
    await page.getByRole("button", { name: /Launch checks/ }).click();
    await expectSectionAnchored(page, "admin-launch-access");
    await page.getByRole("button", { name: /Exports/ }).click();
    await expectSectionAnchored(page, "admin-exports");
    await page.getByRole("button", { name: /Audit log/ }).click();
    await expectSectionAnchored(page, "admin-audit-log");
    await page.getByRole("heading", { name: "Tee-Time Oversight" }).waitFor();
    await page.getByText("Future", { exact: true }).waitFor();
    await page.getByText("Past", { exact: true }).waitFor();
    await page.getByText("Scores", { exact: true }).waitFor();
    await page.getByText("Attest", { exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "Score & Attestation Review" })
      .waitFor();
    await page.getByText("Official", { exact: true }).waitFor();
    await page.getByText("Needs confirm", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Override attestation" }).first().waitFor();
    await page.getByText("Draft", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open score cards" }).waitFor();
    await page.getByRole("heading", { name: "One-Paste Updates" }).waitFor();
    await page.getByRole("heading", { name: "Launch And Access" }).waitFor();
    await page.getByRole("button", { name: "Fill note with this URL" }).first().waitFor();
    await page.getByRole("heading", { name: "Audit Log" }).waitFor();
    await page.getByRole("link", { name: "Audit JSON", exact: true }).first().waitFor();
    await page.getByRole("link", { name: "Audit CSV", exact: true }).first().waitFor();
    await page.getByRole("heading", { name: "Exports" }).waitFor();
    await page.getByRole("link", { name: "Audit JSON", exact: true }).first().waitFor();
    await page.getByRole("link", { name: "Audit CSV", exact: true }).first().waitFor();
    await page.getByRole("link", { name: "Verification JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Verification CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Rules JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Readiness JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Payouts CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Launch Checks JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Launch Checks CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Launch Checklist JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Launch Checklist CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Launch Checklist", exact: true }).waitFor();
    await page.getByRole("link", { name: "Tasks CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Checklist JSON", exact: true }).waitFor();
    await page.getByRole("link", { name: "Request Packet", exact: true }).waitFor();
    await page.getByRole("link", { name: "Handoff", exact: true }).waitFor();
    await page.getByRole("link", { name: "Evidence Gap Packet", exact: true }).waitFor();
    await page.getByRole("link", { name: "Source Ledger CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: /Stop 1.*Packet/ }).waitFor();
    await page.getByRole("link", { name: /Stop 1.*Ledger/ }).waitFor();
    await page.getByRole("link", { name: /Stop 7.*Packet/ }).waitFor();
    await page.getByRole("link", { name: /Stop 7.*Ledger/ }).waitFor();
    await page.getByRole("link", { name: "Completion CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Archive Manifest", exact: true }).waitFor();
    await page
      .getByRole("link", { name: "Database Backup", exact: true })
      .waitFor();
    await page.getByRole("heading", { name: "Full Operations Workbench" }).waitFor();
    await page.getByRole("heading", { name: "Commissioner Readiness" }).waitFor();
    await page.getByRole("heading", { name: "League Checklist" }).waitFor();
    await page.getByText("Buy-in tracking", { exact: true }).first().waitFor();
    await page.getByText("Handicap records", { exact: true }).waitFor();
    await page.getByText("Schedule confirmation", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Commissioner Tasks" }).waitFor();
    await page.getByRole("button", { name: "Copy tasks" }).waitFor();
    await page.getByRole("button", { name: "Copy handoff" }).waitFor();
    await page.getByText("Evidence path", { exact: true }).first().waitFor();
    await page.getByText("Ops > One-Paste Intake").first().waitFor();
    await page.getByRole("heading", { name: "Launch Gates" }).waitFor();
    await page.getByRole("button", { name: "Copy launch checklist" }).waitFor();
    await page.getByText("Evidence checklist").first().waitFor();
    await page
      .getByText("tailscale funnel --bg --yes --https=443 3131", {
        exact: true,
      })
      .waitFor();
    await page
      .getByText(
        "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke"
      )
      .waitFor();
    await page
      .getByText("Open the direct Tailscale-IP phone URL on physical iPhone Safari.")
      .waitFor();
    await page.getByRole("heading", { name: "Tournament Closeout" }).waitFor();
    await page.getByRole("link", { name: "Closeout packet" }).first().waitFor();
    await page.getByRole("link", { name: "Closeout ledger" }).first().waitFor();
    await page.getByRole("link", { name: "Download rules JSON" }).waitFor();
    await page.getByRole("link", { name: "Download buy-ins CSV" }).waitFor();
    await page.getByRole("link", { name: "Download payouts CSV" }).waitFor();
    await page.getByRole("link", { name: "Download roster CSV" }).waitFor();
    await page.getByRole("link", { name: "Download tee times CSV" }).waitFor();
    await page.getByRole("link", { name: "Download scores CSV" }).waitFor();
    await page
      .getByRole("link", { name: "Download attestations CSV" })
      .waitFor();
    await page.getByRole("link", { name: "Download standings CSV" }).waitFor();
    await page.getByRole("link", { name: "Download readiness JSON" }).waitFor();
    await page.getByRole("link", { name: "Download task JSON" }).waitFor();
    await page.getByRole("link", { name: "Download task CSV" }).waitFor();
    await page.getByRole("link", { name: "Download checklist JSON" }).first().waitFor();
    await page.getByRole("link", { name: "Download checklist CSV" }).first().waitFor();
    await page.getByRole("link", { name: "Download request packet" }).waitFor();
    await page
      .getByRole("link", { name: "Download handoff JSON" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download handoff", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Download source search JSON" }).waitFor();
    await page.getByRole("link", { name: "Download source search CSV" }).waitFor();
    await page
      .getByRole("link", { name: "Download launch checklist JSON" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download launch checklist CSV" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download launch checklist", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Download audit JSON" }).waitFor();
    await page.getByRole("link", { name: "Download audit CSV" }).waitFor();
    await page.getByRole("link", { name: "Download launch packet" }).waitFor();

    await page.evaluate(async (apiPrefix) => {
      const exportsToCheck = [
        {
          path: "/export/rules.json",
          mustContain: '"rulesVersion"',
          formulaSafe: false,
        },
        {
          path: "/export/roster.csv",
          mustContain: "name,member,ghin_number,handicap_index",
        },
        {
          path: "/export/tee-times.csv",
          mustContain: "tee_time_id,date,time,course,host,status",
        },
        {
          path: "/export/scores.csv",
          mustContain: "rules_version,tournament,tee_time_id",
        },
        {
          path: "/export/attestations.csv",
          mustContain: "selected_attester,attestation_status,attested_at",
        },
        {
          path: "/export/standings.csv",
          mustContain: "rules_version,rank,player,rounds,official_rounds",
        },
        {
          path: "/export/buyins.csv",
          mustContain: "player_name,amount,payment_status",
        },
        {
          path: "/export/payouts.csv",
          mustContain: "rules_version,tournament_id,tournament,type,closed",
        },
        {
          path: "/export/tasks.csv",
          mustContain: "id,area,severity,title,detail,next_action",
        },
        {
          path: "/export/risks.csv",
          mustContain: "id,severity,label,detail,next_action",
        },
        {
          path: "/export/evidence-gap-packet.csv",
          mustContain: "id,area,blocker_id,label,owner",
        },
        {
          path: "/export/source-search-ledger.csv",
          mustContain: "id,area,claim_type,status",
        },
        {
          path: "/export/completion-audit.csv",
          mustContain: "id,area,requirement,status,readiness_scope",
        },
        {
          path: "/export/audit.csv",
          mustContain: "created_at,action,actor",
        },
        {
          path: "/export/verification-runs.csv",
          mustContain: "created_at,command,status,recorded_by",
        },
        {
          path: "/export/launch-checks.csv",
          mustContain: "key,label,verified",
        },
        {
          path: "/export/request-packet.txt",
          mustContain: "DJDI request packet",
          formulaSafe: false,
        },
        {
          path: "/export/blocker-handoff.txt",
          mustContain: "DJDI Commissioner Handoff",
          formulaSafe: false,
        },
        {
          path: "/export/evidence-gap-packet.txt",
          mustContain: "DJDI Evidence Gap Packet",
          formulaSafe: false,
        },
      ];
      for (const item of exportsToCheck) {
        const response = await fetch(`${apiPrefix}${item.path}`);
        const text = await response.text();
        if (!response.ok || !text.includes(item.mustContain)) {
          throw new Error(`${item.path} did not return expected export content`);
        }
        if (item.formulaSafe === false) continue;
        const cells = [];
        let cell = "";
        let quoted = false;
        for (let i = 0; i < text.length; i += 1) {
          const char = text[i];
          const next = text[i + 1];
          if (quoted) {
            if (char === '"' && next === '"') {
              cell += '"';
              i += 1;
            } else if (char === '"') {
              quoted = false;
            } else {
              cell += char;
            }
          } else if (char === '"') {
            quoted = true;
          } else if (char === "," || char === "\n") {
            cells.push(cell.replace(/\r$/, ""));
            cell = "";
          } else {
            cell += char;
          }
        }
        if (cell.length > 0) cells.push(cell.replace(/\r$/, ""));
        for (const parsedCell of cells) {
          if (/^\s*[=+\-@]/.test(parsedCell)) {
            throw new Error(
              `${item.path} contains spreadsheet formula cell: ${parsedCell}`
            );
          }
        }
      }

      const dbResponse = await fetch(`${apiPrefix}/export/database`);
      const dbBytes = await dbResponse.arrayBuffer();
      const contentType = dbResponse.headers.get("content-type") ?? "";
      if (
        !dbResponse.ok ||
        dbBytes.byteLength < 1024 ||
        !contentType.includes("application/octet-stream")
      ) {
        throw new Error("database backup export did not return a SQLite download");
      }
    }, apiBasePath);

    if (errors.length > 0) {
      throw new Error(`remote mobile browser console errors: ${errors.join(" | ")}`);
    }

    verificationRun = await page.evaluate(async ({ apiPrefix, targetUrl }) => {
      const response = await fetch(`${apiPrefix}/verification-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "npm run verify:remote-mobile-ux",
          status: "passed",
          scope: [
            "remote mobile viewport",
            "player locked navigation",
            "player and host tee-time coordination",
            "commissioner admin workflows",
            "backup restore proof",
          ],
          summary:
            "Remote mobile UX verifier passed the live Tailnet 390x844 player, host, and commissioner golden path.",
          recordedBy: "Remote Mobile UX",
          metadata: {
            url: targetUrl,
            viewport: "390x844",
            backupRestoreProof: true,
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        verificationRun?: { id?: string; status?: string };
        error?: string;
      };
      if (!response.ok || body.verificationRun?.status !== "passed") {
        throw new Error(
          body.error || `verification run record failed with HTTP ${response.status}`
        );
      }
      return body.verificationRun;
    }, { apiPrefix: apiBasePath, targetUrl: baseUrl });
    if (!verificationRun?.id) {
      throw new Error("remote mobile verification run did not return an id");
    }

    await page.evaluate(async ({ apiPrefix, verificationRunId }) => {
      const response = await fetch(`${apiPrefix}/export/verification-runs.json`);
      const body = (await response.json().catch(() => ({}))) as {
        verificationRuns?: Array<{ id?: string; command?: string }>;
      };
      if (
        !response.ok ||
        !body.verificationRuns?.some(
          (run) =>
            run.id === verificationRunId &&
            run.command === "npm run verify:remote-mobile-ux"
        )
      ) {
        throw new Error(
          `verification export did not include remote mobile run ${verificationRunId}`
        );
      }
    }, { apiPrefix: apiBasePath, verificationRunId: verificationRun.id });
  } finally {
    if (cleanupTeeTimeId && page) {
      await page
        .evaluate(
          async ({ apiPrefix, id, code }) => {
            await fetch(`${apiPrefix}/commissioner`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code }),
            }).catch(() => null);
            await fetch(`${apiPrefix}/teetimes/${id}`, { method: "DELETE" }).catch(
              () => null
            );
          },
          {
            apiPrefix: apiBasePath,
            id: cleanupTeeTimeId,
            code: commissionerCode ?? "",
          }
        )
        .catch(() => undefined);
    }
    await browser.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: baseUrl,
        viewport: "390x844",
        accessGate: "verified",
        apiBasePath,
        client: "verified",
        health: "verified",
        bottomNav: "verified",
        season: "verified",
        playerCoordination: "verified",
        money: "verified",
        roster: "verified",
        ops: "verified",
        commissionerScoreManagement: "verified",
        backupRestoreProof: "verified",
        verificationRun: verificationRun?.id ?? null,
        mutations:
          "backup_restore_verify audit event and remote-mobile verification-run row",
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Remote mobile UX verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
