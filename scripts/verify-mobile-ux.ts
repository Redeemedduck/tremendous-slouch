import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { createApp, createDb } from "../server";

type RunningApp = {
  db: ReturnType<typeof createDb>;
  server: http.Server;
  url: string;
  apiUrl: string;
};

const dbPath =
  process.env.MOBILE_UX_DB_PATH ??
  path.join(
    path.resolve(process.env.DJDI_WORK_DIR ?? ".build-work", "verify"),
    `djdi-mobile-ux-${process.pid}-${Date.now()}.db`
  );
const accessCode =
  process.env.MOBILE_UX_ACCESS_CODE ??
  `mobile-ux-${process.pid}-${Date.now()}`;
const commissionerCode =
  process.env.MOBILE_UX_COMMISSIONER_CODE ??
  `mobile-ux-admin-${process.pid}-${Date.now()}`;
const keepDb = process.env.KEEP_MOBILE_UX_DB === "1";
const originalAccessCode = process.env.ACCESS_CODE;
const originalCommissionerCode = process.env.COMMISSIONER_CODE;
const originalHost = process.env.HOST;
const originalNodeEnv = process.env.NODE_ENV;
const originalAppBasePath = process.env.APP_BASE_PATH;
const logPhase = (label: string) => {
  console.error(`[mobile-ux] ${label}`);
};

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

function latestMtimeMs(entry: string): number {
  if (!fs.existsSync(entry)) return 0;
  const stat = fs.statSync(entry);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(entry)
    .reduce(
      (latest, child) => Math.max(latest, latestMtimeMs(path.join(entry, child))),
      stat.mtimeMs
    );
}

function assertFreshClientBuild() {
  const distIndex = path.resolve("dist/index.html");
  if (!fs.existsSync(distIndex)) {
    throw new Error("dist/index.html is missing; run npm run build first");
  }
  const buildMtime = fs.statSync(distIndex).mtimeMs;
  const inputs = [
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "src",
  ];
  const newestInput = Math.max(
    ...inputs.map((entry) => latestMtimeMs(path.resolve(entry)))
  );
  if (newestInput > buildMtime + 1000) {
    throw new Error(
      "dist/index.html is older than client source; run npm run build before verify:mobile-ux"
    );
  }
}

function builtClientBasePath() {
  const distIndex = path.resolve("dist/index.html");
  const html = fs.readFileSync(distIndex, "utf8");
  const assetMatch = html.match(/\s(?:src|href)="([^"]*\/assets\/[^"]+)"/);
  if (!assetMatch) return "";
  const assetPath = assetMatch[1];
  if (!assetPath.startsWith("/")) return "";
  const assetPrefix = assetPath.slice(0, assetPath.indexOf("/assets/"));
  return assetPrefix === "/" ? "" : assetPrefix.replace(/\/+$/, "");
}

function cleanup() {
  if (keepDb || process.env.MOBILE_UX_DB_PATH) return;
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
        reject(new Error("Could not determine mobile UX server port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function start(): Promise<RunningApp> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const appBasePath = builtClientBasePath();
  if (appBasePath) process.env.APP_BASE_PATH = appBasePath;
  else delete process.env.APP_BASE_PATH;
  const db = createDb(dbPath);
  const app = createApp(db, { serveAssets: true });
  const server = http.createServer(app);
  const origin = await listen(server);
  const url = `${origin}${appBasePath}`;
  const apiUrl = `${origin}${appBasePath ? `${appBasePath}-api` : "/api"}`;
  return { db, server, url, apiUrl };
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

function apiPath(apiUrl: string, path: string) {
  const suffix = path.startsWith("/api/") ? path.slice(4) : path;
  return `${apiUrl}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function mountedApiHref(appUrl: string, path: string) {
  const basePath = new URL(appUrl).pathname.replace(/\/+$/, "");
  const apiBasePath = basePath && basePath !== "/" ? `${basePath}-api` : "/api";
  const suffix = path.startsWith("/api/") ? path.slice(4) : path;
  return `${apiBasePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

async function seedStopOneScenario(apiUrl: string, cookie: string) {
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const created = await fetchJson<{ teeTime: { id: string } }>(
    apiPath(apiUrl, "/api/teetimes"),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        course: "Common Ground",
        date: "2026-05-18",
        time: "12:50",
        spots: 6,
        host: "Jayson Post",
        notes: "Mobile UX verifier seeded Stop 1 scores.",
      }),
    }
  );
  if (created.status !== 201) {
    throw new Error(`mobile UX tee-time seed failed with HTTP ${created.status}`);
  }

  const teeTimeId = created.body.teeTime.id;
  for (const name of [
    "Kyle Dantzler",
    "Sam Lines",
    "Matt",
    "Jonny Ten Bosch",
    "Will",
  ]) {
    const claim = await fetchJson<{ teeTime: unknown }>(
      apiPath(apiUrl, `/api/teetimes/${teeTimeId}/claims`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      }
    );
    if (claim.status !== 200) {
      throw new Error(`mobile UX claim seed failed for ${name}: HTTP ${claim.status}`);
    }
  }

  const scores = [
    { name: "Jayson Post", gross: 82, courseHcp: 12, attestedBy: "Matt" },
    { name: "Kyle Dantzler", gross: 79, courseHcp: 4, attestedBy: "Jayson Post" },
    { name: "Sam Lines", gross: 78, courseHcp: 5, attestedBy: "Jayson Post" },
    { name: "Matt", gross: 76, courseHcp: 7, attestedBy: "Jayson Post" },
    {
      name: "Jonny Ten Bosch",
      gross: 80,
      courseHcp: 7,
      attestedBy: "Jayson Post",
    },
    { name: "Will", gross: 82, courseHcp: 12, attestedBy: "Jayson Post" },
  ];
  for (const score of scores) {
    const scored = await fetchJson<{ teeTime: unknown }>(
      apiPath(apiUrl, `/api/teetimes/${teeTimeId}/scores`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...score,
          teeName: "Blue",
          teeRating: 70.1,
          teeSlope: 125,
          teePar: 72,
          courseHcpSource: "ghin",
        }),
      }
    );
    if (scored.status !== 200) {
      throw new Error(
        `mobile UX score seed failed for ${score.name}: HTTP ${scored.status}`
      );
    }
    const attested = await fetchJson<{ teeTime: unknown }>(
      apiPath(apiUrl, `/api/teetimes/${teeTimeId}/scores/${encodeURIComponent(
        score.name
      )}/attest`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: score.attestedBy }),
      }
    );
    if (attested.status !== 200) {
      throw new Error(
        `mobile UX attestation seed failed for ${score.name}: HTTP ${attested.status}`
      );
    }
  }

  return teeTimeId;
}

async function verifyMobileBrowser(url: string) {
  logPhase("browser:start");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(15_000);

    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByPlaceholder("Access code").fill(accessCode);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    logPhase("browser:access-unlocked");
    await page.evaluate(async () => {
      localStorage.removeItem("golf.coordinator.myName");
      localStorage.removeItem("golf.coordinator.myHandicap");
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Server Cookie Player" }),
      });
      if (!response.ok) {
        throw new Error("could not seed signed server profile");
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: /Playing as Server Cookie Player/ })
      .waitFor();
    logPhase("browser:profile-cookie");
    await page.evaluate(() => {
      localStorage.setItem("golf.coordinator.myName", "Beck");
      localStorage.setItem("golf.coordinator.myHandicap", "8.2");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    const nav = page.getByRole("navigation");
    await page.getByRole("button", { name: "Board", exact: true }).waitFor();
    await page.getByRole("button", { name: "Season", exact: true }).waitFor();
    await page.getByRole("button", { name: "Roster", exact: true }).waitFor();
    if ((await nav.getByRole("button", { name: "Money", exact: true }).count()) > 0) {
      throw new Error("locked player nav exposed Money");
    }
    if ((await nav.getByRole("button", { name: "Ops", exact: true }).count()) > 0) {
      throw new Error("locked player nav exposed Ops");
    }

    const playerFlow = await page.evaluate(async () => {
      const stamp = Date.now();
      const course = `Mobile Player Flow ${stamp}`;
      const profile = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Beck" }),
      });
      if (!profile.ok) {
        throw new Error("could not set Beck profile for player-flow proof");
      }
      const response = await fetch("/api/teetimes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          course,
          date: "2026-09-30",
          time: "09:40",
          spots: 4,
          host: "Beck",
          notes: "Mobile verifier temporary player flow.",
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
    });
    await page.reload({ waitUntil: "networkidle" });
    const hostFlowCard = page.locator("article").filter({ hasText: playerFlow.course });
    await hostFlowCard.getByText("Hosted by Beck").waitFor();
    await hostFlowCard.getByRole("button", { name: "Host options" }).waitFor();
    await hostFlowCard.getByText("1 of 4").first().waitFor();
    await hostFlowCard.getByPlaceholder("Add player").fill("Ryan");
    await hostFlowCard.getByRole("button", { name: "Add", exact: true }).click();
    await hostFlowCard.getByText("Ryan").waitFor();
    await hostFlowCard.getByText("2 of 4").first().waitFor();
    logPhase("browser:host-flow");

    await page.evaluate(async () => {
      localStorage.setItem("golf.coordinator.myName", "Chris");
      localStorage.removeItem("golf.coordinator.myHandicap");
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Chris" }),
      });
      if (!response.ok) {
        throw new Error("could not set Chris profile for player-flow proof");
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    const playerFlowCard = page.locator("article").filter({ hasText: playerFlow.course });
    await playerFlowCard.getByText("Hosted by Beck").waitFor();
    if ((await playerFlowCard.getByRole("button", { name: "Host options" }).count()) > 0) {
      throw new Error("non-host saw host controls on player-flow tee time");
    }
    if (
      (await playerFlowCard
        .getByRole("button", { name: "Commissioner tee-time options" })
        .count()) > 0
    ) {
      throw new Error("non-commissioner saw commissioner controls on player-flow tee time");
    }
    await playerFlowCard.getByRole("button", { name: "Maybe" }).click();
    await playerFlowCard.getByText("You're maybe").waitFor();
    await playerFlowCard.getByRole("button", { name: "Claim a spot" }).click();
    await playerFlowCard.getByText("You're in").waitFor();
    await playerFlowCard.getByText("3 of 4").first().waitFor();
    await playerFlowCard.getByRole("button", { name: "Add a comment" }).click();
    await playerFlowCard
      .getByPlaceholder("Say something to the group…")
      .fill("Mobile player coordination proof");
    await playerFlowCard.getByRole("button", { name: "Post comment" }).click();
    await playerFlowCard.getByText("Mobile player coordination proof").waitFor();
    logPhase("browser:player-flow");

    await page.getByRole("button", { name: "Past tee times (1)" }).click();
    await page.getByText("Scores", { exact: true }).waitFor();
    await page
      .getByText(/attested|commissioner override|needs confirm/)
      .first()
      .waitFor();
    await page.getByText(/net 70/).first().waitFor();
    if ((await page.getByRole("button", { name: "Host options" }).count()) > 0) {
      throw new Error("non-host player saw host controls");
    }
    if ((await page.getByRole("button", { name: "Confirm" }).count()) > 0) {
      throw new Error("plain player saw score attestation action for someone else");
    }
    await page.getByRole("button", { name: "Roster", exact: true }).click();
    await page.getByRole("heading", { name: "League Roster" }).waitFor();
    await page.getByText("Handicap Index:", { exact: false }).first().waitFor();
    if ((await page.getByText("Paste handicap evidence").count()) > 0) {
      throw new Error("public roster exposed commissioner handicap-evidence controls");
    }
    await page.evaluate(() => {
      localStorage.setItem("golf.coordinator.myName", "Jayson Post");
      localStorage.setItem("golf.coordinator.myHandicap", "10.6");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    await page
      .getByRole("button", { name: /Playing as Jayson Post/ })
      .click();
    await page.getByRole("button", { name: "Commissioner tools" }).click();
    const commissionerCodeInput = page.getByPlaceholder("Commissioner code");
    await commissionerCodeInput.waitFor();
    if ((await commissionerCodeInput.getAttribute("type")) !== "text") {
      throw new Error("commissioner code input must stay visible text, not password");
    }
    await commissionerCodeInput.fill(commissionerCode);
    await page.getByRole("button", { name: "Unlock commissioner tools" }).click();
    await nav.getByRole("button", { name: "Money", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Roster", exact: true }).waitFor();
    await nav.getByRole("button", { name: "Ops", exact: true }).waitFor();
    await page.evaluate(async () => {
      const response = await fetch("/api/teetimes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          course: "Commissioner Oversight GC",
          date: "2026-06-30",
          time: "10:40",
          spots: 4,
          host: "Beck",
          notes: "Mobile verifier commissioner non-host oversight.",
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "could not seed commissioner oversight tee time");
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();
    await nav.getByRole("button", { name: "Board", exact: true }).click();
    const commissionerOversightCard = page
      .locator("article")
      .filter({ hasText: "Commissioner Oversight GC" });
    await commissionerOversightCard
      .getByText("Commissioner Oversight GC", { exact: true })
      .waitFor();
    await commissionerOversightCard
      .getByRole("button", { name: "Commissioner tee-time options" })
      .waitFor();
    await nav.getByRole("button", { name: "Ops", exact: true }).click();
    await page.getByText("Admin Console", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Do Next" }).waitFor();
    await page.getByRole("button", { name: "Money", exact: true }).nth(1).waitFor();
    await nav.getByRole("button", { name: "Money", exact: true }).click();
    await page.getByRole("button", { name: /Pool/ }).click();
    await page.getByText(/Open buy-in status:/).waitFor();
    await nav.getByRole("button", { name: "Board", exact: true }).click();
    await page.getByRole("button", { name: "Past tee times (1)" }).click();
    await page.getByText("Committed").first().waitFor();
    await page.getByText("6 of 6").first().waitFor();
    await page.getByText("Open").first().waitFor();
    await page.getByText("Maybe").first().waitFor();
    await page.getByText("Guests").first().waitFor();
    await page.getByRole("button", { name: "Add a comment" }).first().click();
    await page
      .getByPlaceholder("Say something to the group…")
      .fill("Mobile verifier post-round note");
    await page.getByRole("button", { name: "Post comment" }).click();
    await page.getByText("Mobile verifier post-round note").waitFor();
    await page.getByRole("button", { name: "Edit comment" }).click();
    await page.locator("textarea").first().fill("Mobile verifier edited post-round note");
    await page.getByRole("button", { name: "Save comment" }).click();
    await page.getByText("Mobile verifier edited post-round note").waitFor();
    await page.getByText("just now · edited").waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete comment" }).click();
    await page.getByText("Mobile verifier edited post-round note").waitFor({
      state: "detached",
    });
    await page.getByRole("button", { name: "Host options" }).click();
    await page.getByRole("button", { name: "Edit scores" }).click();
    await page.getByRole("button", { name: "Delete Jayson Post score" }).waitFor();
    const jaysonCourseHcp = page.getByLabel("Jayson Post course handicap");
    await jaysonCourseHcp.evaluate((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Fill blank HCPs" }).click();
    await page
      .getByLabel("Jayson Post course handicap")
      .waitFor({ state: "visible" });
    let filledCourseHcp = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      filledCourseHcp = await page
        .getByLabel("Jayson Post course handicap")
        .inputValue();
      if (filledCourseHcp === "10") break;
      await page.waitForTimeout(150);
    }
    const fillStatusVisible = await page
      .getByText(/course HCP/)
      .filter({ hasText: /Filled|Preserved|Missing/ })
      .count();
    if (fillStatusVisible < 1) {
      throw new Error("course handicap fill status was not rendered");
    }
    if (filledCourseHcp !== "10") {
      const scoreSheetText = await page.locator("body").innerText();
      throw new Error(
        `expected Jayson blank course handicap fill to be 10 from roster Handicap Index and tee evidence, got ${filledCourseHcp}. ${scoreSheetText.slice(-1000)}`
      );
    }
    await page
      .getByText(
        "Manual Course HCP 4 - unverified override; calculated 2 from Handicap Index 3.6"
      )
      .waitFor();
    await page.getByLabel("Paste score summary").fill("Jayson: 82 (70)");
    await page.getByText("1 matched: Jayson Post").waitFor();
    await page.getByRole("button", { name: "Fill 1" }).click();
    await page.getByText("Filled 1 score draft.").waitFor();
    await page.getByLabel("Jayson Post attested by").selectOption("");
    await page.getByLabel("Bulk attester").selectOption("Matt");
    await page.getByRole("button", { name: "Fill attesters" }).click();
    await page.getByText("Filled 1 attester.").waitFor();
    await page.keyboard.press("Escape");

    await nav.getByRole("button", { name: "Season", exact: true }).click();
    await page.getByRole("button", { name: /Standings 6 players/ }).click();
    await page.getByRole("button", { name: "Avg net" }).click();
    await page.getByRole("row", { name: /Matt 1 69\.0 69\.0/ }).waitFor();
    await page
      .getByRole("row", { name: /Jayson Post 10\.6 1 70\.0 70\.0/ })
      .waitFor();
    await page.getByText("Net = gross").waitFor();

    await page.evaluate(async () => {
      const jsonHeaders = { "content-type": "application/json" };
      const teeTimeResponse = await fetch("/api/teetimes", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          course: "Admin Override GC",
          date: "2026-05-26",
          time: "08:40",
          spots: 4,
          host: "Jayson Post",
          notes: "Mobile verifier pending attestation for Admin override flow.",
        }),
      });
      const teeTimeBody = await teeTimeResponse.json();
      if (!teeTimeResponse.ok) {
        throw new Error(teeTimeBody.error || "could not create override tee time");
      }
      const teeTimeId = teeTimeBody.teeTime.id;
      const claimResponse = await fetch(`/api/teetimes/${teeTimeId}/claims`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "Matt" }),
      });
      const claimBody = await claimResponse.json().catch(() => ({}));
      if (!claimResponse.ok) {
        throw new Error(claimBody.error || "could not seed override attester");
      }
      const scoreResponse = await fetch(`/api/teetimes/${teeTimeId}/scores`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "Jayson Post",
          gross: 83,
          courseHcp: 12,
          attestedBy: "Matt",
          teeName: "Blue",
          teeRating: 70.1,
          teeSlope: 125,
          teePar: 72,
          courseHcpSource: "ghin",
        }),
      });
      const scoreBody = await scoreResponse.json().catch(() => ({}));
      if (!scoreResponse.ok) {
        throw new Error(scoreBody.error || "could not seed pending override score");
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "DJDI Golf Board" }).waitFor();

    await nav.getByRole("button", { name: "Money", exact: true }).click();
    await page.getByRole("button", { name: /Pool \$0 settled of \$3,900/ }).click();
    await page.getByText("Outstanding", { exact: true }).first().waitFor();
    await page.getByText(/Open buy-in status:/).waitFor();
    await page.getByRole("button", { name: "Copy status request" }).waitFor();
    await page
      .getByLabel("Paste buy-in status replies")
      .fill("Beck buy-in paid cash $325 2026-05-19");
    await page.getByText("1 matched: Beck").waitFor();
    await page.getByRole("button", { name: "Apply 1" }).click();
    await page.getByText("Applied 1 buy-in update.").waitFor();
    await page.getByRole("button", { name: /Pool \$325 settled of \$3,900/ }).waitFor();
    logPhase("browser:money-flow");

    await nav.getByRole("button", { name: "Roster", exact: true }).click();
    await page.getByRole("button", { name: /Roster 12 members.*12 hcp missing/ }).click();
    await page.getByRole("button", { name: "Copy records" }).waitFor();
    await page.getByLabel("Paste handicap evidence").fill("Beck 8.2");
    await page.getByText("1 matched: Beck").waitFor();
    await page.getByRole("button", { name: "Apply 1" }).click();
    await page.getByText("Applied 1 GHIN index.").waitFor();
    await page.getByRole("button", { name: "Save Beck handicap" }).waitFor();
    logPhase("browser:roster-flow");

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
    await page.getByRole("button", { name: "Verify backup" }).click();
    await page.getByText("Backup verified").waitFor();
    logPhase("browser:admin-backup");
    await page.getByRole("button", { name: "Full Ops" }).waitFor();
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
    await page
      .getByRole("heading", { name: "Full Operations Workbench" })
      .waitFor();
    await page.getByRole("button", { name: "Open full workbench" }).waitFor();
    await page.getByRole("heading", { name: "Tee-Time Oversight" }).waitFor();
    await page.getByText("Future", { exact: true }).waitFor();
    await page.getByText("Past", { exact: true }).waitFor();
    await page.getByText("Scores", { exact: true }).waitFor();
    await page.getByText("Attest", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open tee-time board" }).waitFor();
    await page
      .getByRole("heading", { name: "Score & Attestation Review" })
      .waitFor();
    await page.getByText("Official", { exact: true }).waitFor();
    await page.getByText("Needs confirm", { exact: true }).waitFor();
    await page.getByText("Draft", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Override attestation" }).click();
    await page.getByRole("button", { name: "Confirm override" }).click();
    await page.getByText("No pending attestations.").waitFor();
    logPhase("browser:attestation-override");
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
    await page
      .getByRole("link", { name: "Verification JSON", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Verification CSV", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Rules JSON", exact: true }).waitFor();
    await page
      .getByRole("link", { name: "Readiness JSON", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Checks JSON", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Checks CSV", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Checklist JSON", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Checklist CSV", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Checklist", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Launch Packet", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Payouts CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Tasks CSV", exact: true }).waitFor();
    await page.getByRole("link", { name: "Checklist JSON", exact: true }).waitFor();
    await page
      .getByRole("link", { name: "Request Packet", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Handoff", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Evidence Gap Packet", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Source Ledger CSV", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: /Stop 1.*Packet/ })
      .waitFor();
    await page
      .getByRole("link", { name: /Stop 1.*Ledger/ })
      .waitFor();
    await page
      .getByRole("link", { name: /Stop 7.*Packet/ })
      .waitFor();
    await page
      .getByRole("link", { name: /Stop 7.*Ledger/ })
      .waitFor();
    await page
      .locator(`a[href="${mountedApiHref(url, "/api/export/completion-audit.json")}"]`)
      .nth(1)
      .waitFor();
    await page
      .getByRole("link", { name: "Completion CSV", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Archive Manifest", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Database Backup", exact: true })
      .waitFor();
    await page.getByRole("heading", { name: "Advanced Ops" }).waitFor();
    await page.getByRole("heading", { name: "Commissioner Readiness" }).waitFor();
    await page.getByText("Commissioner Settings").click();
    await page.getByText("Buy-in, payout, points, and coordination routes.").waitFor();
    await page.getByLabel("Season buy-in for unpaid rows").waitFor();
    await page.getByText("Points and Payouts").waitFor();
    await page.getByRole("button", { name: "Schedule", exact: true }).waitFor();
    await page.getByRole("button", { name: "Launch", exact: true }).waitFor();
    await page.getByRole("heading", { name: "League Checklist" }).waitFor();
    await page.getByRole("heading", { name: "Commissioner Tasks" }).waitFor();
    await page.getByText("Track buy-in status", { exact: true }).waitFor();
    await page.getByText("Record handicap indexes", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Copy tasks" }).waitFor();
    await page.getByRole("button", { name: "Copy handoff" }).waitFor();
    await page.getByRole("button", { name: "Copy Track buy-in status" }).waitFor();
    await page
      .getByRole("button", { name: "Copy Record handicap indexes" })
      .waitFor();
    await page.getByText("Evidence path", { exact: true }).first().waitFor();
    await page.getByText("Ops > One-Paste Intake").first().waitFor();
    await page.getByRole("heading", { name: "One-Paste Intake" }).waitFor();
    await page
      .getByLabel("Paste group replies")
      .fill(
        [
          "Chris buy-in paid venmo $325 2026-05-19",
          "Chris handicap index 11.4",
          "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
        ].join("\n")
      );
    await page
      .getByText("Buy-in status -> paid · $325 · venmo · 2026-05-19")
      .waitFor();
    await page.getByText("Roster -> index 11.4 · source note only").waitFor();
    await page
      .getByText(
        "Schedule -> Fossil Trace · 2026-10-10 to 2026-10-11"
      )
      .waitFor();
    await page
      .getByLabel("Confirm these exact updates before applying")
      .check();
    await page.getByRole("button", { name: "Apply intake (3)" }).click();
    await page
      .getByText(
        "Applied 1 buy-in status update, 1 handicap record, and 1 schedule update."
      )
      .waitFor();
    await page.getByRole("button", { name: "Copy TBDs" }).waitFor();
    await page
      .getByLabel("Paste schedule replies")
      .fill("Mid-season major: CommonGround Golf Course, 2026-07-18, shotgun");
    await page.getByText("1 matched: Mid-season major").waitFor();
    await page.getByRole("button", { name: "Apply 1" }).click();
    await page.getByText("All event details confirmed").waitFor();
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
    await page
      .getByLabel("Docker image build evidence note")
      .fill("Mobile UX verifier saw Docker gate note field.");
    await page
      .getByRole("button", { name: "Mark Docker image build verified" })
      .waitFor();
    await page.getByRole("heading", { name: "Score Rule Audit" }).waitFor();
    await page.getByRole("heading", { name: "Tournament Closeout" }).waitFor();
    await page.getByText(/leads at net|No scored rounds yet/).first().waitFor();
    await page
      .getByRole("button", { name: /Active|Close|Ready|Closed/ })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: /Confirm first|Add note first|Record paid|Paid/ })
      .first()
      .waitFor();
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
    await page
      .getByRole("link", { name: "Download checklist JSON" })
      .first()
      .waitFor();
    await page
      .getByRole("link", { name: "Download checklist CSV" })
      .first()
      .waitFor();
    await page.getByRole("link", { name: "Download checklist JSON" }).first().waitFor();
    await page.getByRole("link", { name: "Download checklist CSV" }).first().waitFor();
    await page.getByRole("link", { name: "Download request packet" }).waitFor();
    await page
      .getByRole("link", { name: "Download handoff JSON" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download handoff", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "Download evidence gap JSON" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download evidence gap CSV" })
      .waitFor();
    await page
      .getByRole("link", { name: "Download evidence gap packet" })
      .waitFor();
    await page.getByRole("link", { name: "Download source search JSON" }).waitFor();
    await page.getByRole("link", { name: "Download source search CSV" }).waitFor();
    await page.getByRole("link", { name: "Download completion audit" }).waitFor();
    await page.getByRole("link", { name: "Download completion CSV" }).waitFor();
    await page.getByRole("link", { name: "Download launch checks JSON" }).waitFor();
    await page.getByRole("link", { name: "Download launch checks CSV" }).waitFor();
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
    await page.getByRole("link", { name: "Download verification JSON" }).waitFor();
    await page.getByRole("link", { name: "Download verification CSV" }).waitFor();
    await page.getByRole("link", { name: "Download archive manifest" }).waitFor();
    await page.getByRole("link", { name: "Download launch packet" }).waitFor();
    await page.getByRole("button", { name: "Open Roster", exact: true }).click();
    await page.getByRole("button", { name: "Save Beck handicap" }).waitFor();
    logPhase("browser:ops-complete");

    if (errors.length > 0) {
      throw new Error(`mobile browser console errors: ${errors.join(" | ")}`);
    }
  } finally {
    await browser.close();
  }
}

function csvCells(text: string) {
  const cells: string[] = [];
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
  return cells;
}

async function verifyExportArtifacts(apiUrl: string, cookie: string) {
  const exportsToCheck = [
    {
      path: "/api/export/rules.json",
      mustContain: '"rulesVersion"',
      formulaSafe: false,
    },
    {
      path: "/api/export/roster.csv",
      mustContain: "name,member,ghin_number,handicap_index",
    },
    {
      path: "/api/export/tee-times.csv",
      mustContain: "tee_time_id,date,time,course,host,status",
    },
    {
      path: "/api/export/scores.csv",
      mustContain: "rules_version,tournament,tee_time_id",
    },
    {
      path: "/api/export/attestations.csv",
      mustContain: "selected_attester,attestation_status,attested_at",
    },
    {
      path: "/api/export/standings.csv",
      mustContain: "rules_version,rank,player,rounds,official_rounds",
    },
    {
      path: "/api/export/buyins.csv",
      mustContain: "player_name,amount,payment_status",
    },
    {
      path: "/api/export/payouts.csv",
      mustContain: "rules_version,tournament_id,tournament,type,closed",
    },
    {
      path: "/api/export/tasks.csv",
      mustContain: "id,area,severity,title,detail,next_action",
    },
    {
      path: "/api/export/risks.csv",
      mustContain: "id,severity,label,detail,next_action",
    },
    {
      path: "/api/export/evidence-gap-packet.csv",
      mustContain: "id,area,blocker_id,label,owner",
    },
    {
      path: "/api/export/source-search-ledger.csv",
      mustContain: "id,area,claim_type,status",
    },
    {
      path: "/api/export/completion-audit.csv",
      mustContain: "id,area,requirement,status,readiness_scope",
    },
    {
      path: "/api/export/audit.csv",
      mustContain: "created_at,action,actor",
    },
    {
      path: "/api/export/verification-runs.csv",
      mustContain: "created_at,command,status,recorded_by",
    },
    {
      path: "/api/export/launch-checks.csv",
      mustContain: "key,label,verified",
    },
    {
      path: "/api/export/request-packet.txt",
      mustContain: "DJDI request packet",
      formulaSafe: false,
    },
    {
      path: "/api/export/blocker-handoff.txt",
      mustContain: "DJDI Commissioner Handoff",
      formulaSafe: false,
    },
    {
      path: "/api/export/evidence-gap-packet.txt",
      mustContain: "DJDI Evidence Gap Packet",
      formulaSafe: false,
    },
  ];

  for (const item of exportsToCheck) {
    const response = await fetch(apiPath(apiUrl, item.path), {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok || !text.includes(item.mustContain)) {
      throw new Error(`${item.path} did not return expected export content`);
    }
    if (item.formulaSafe === false) continue;
    for (const cell of csvCells(text)) {
      if (/^\s*[=+\-@]/.test(cell)) {
        throw new Error(`${item.path} contains spreadsheet formula cell: ${cell}`);
      }
    }
  }

  const dbResponse = await fetch(apiPath(apiUrl, "/api/export/database"), {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  const dbBytes = await dbResponse.arrayBuffer();
  const contentType = dbResponse.headers.get("content-type") ?? "";
  if (
    !dbResponse.ok ||
    dbBytes.byteLength < 1024 ||
    !contentType.includes("application/octet-stream")
  ) {
    throw new Error("database backup export did not return a SQLite download");
  }
}

let app: RunningApp | null = null;

try {
  logPhase("startup:begin");
  cleanup();
  logPhase("startup:cleanup");
  assertFreshClientBuild();
  logPhase("startup:fresh-build");

  process.env.NODE_ENV = "production";
  process.env.HOST = "127.0.0.1";
  process.env.ACCESS_CODE = accessCode;
  process.env.COMMISSIONER_CODE = commissionerCode;

  app = await start();
  logPhase("startup:server");

  const unlock = await fetchJson<{ ok: boolean }>(`${app.apiUrl}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  const setCookie = unlock.headers.get("set-cookie");
  if (unlock.status !== 200 || !unlock.body.ok || !setCookie) {
    throw new Error(`mobile UX access seed failed with HTTP ${unlock.status}`);
  }
  logPhase("startup:access");
  const cookie = setCookie.split(";")[0];
  const commissionerUnlock = await fetchJson<{ ok: boolean }>(
    `${app.apiUrl}/commissioner`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: commissionerCode }),
    }
  );
  const commissionerSetCookie = commissionerUnlock.headers.get("set-cookie");
  if (
    commissionerUnlock.status !== 200 ||
    !commissionerUnlock.body.ok ||
    !commissionerSetCookie
  ) {
    throw new Error(
      `mobile UX commissioner seed failed with HTTP ${commissionerUnlock.status}`
    );
  }
  logPhase("startup:commissioner");
  const authCookie = `${cookie}; ${commissionerSetCookie.split(";")[0]}`;
  const teeTimeId = await seedStopOneScenario(app.apiUrl, authCookie);
  logPhase("seed:stop-one");
  await verifyMobileBrowser(app.url);
  logPhase("browser:done");
  await verifyExportArtifacts(app.apiUrl, authCookie);
  logPhase("exports:done");
  const recordedVerification = await fetchJson<{
    verificationRun: { id: string; status: string };
  }>(`${app.apiUrl}/verification-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    body: JSON.stringify({
      command: "npm run verify:mobile-ux",
      status: "passed",
      scope: [
        "mobile viewport",
        "player and host tee-time coordination",
        "commissioner workflows",
        "browser console",
      ],
      summary:
        "Mobile UX verifier passed the 390x844 player, host, and commissioner golden path.",
      recordedBy: "Mobile UX",
      metadata: {
        url: app.url,
        teeTimeId,
        viewport: "390x844",
      },
    }),
  });
  if (
    recordedVerification.status !== 201 ||
    recordedVerification.body.verificationRun.status !== "passed"
  ) {
    throw new Error(
      `mobile UX verification run record failed with HTTP ${recordedVerification.status}`
    );
  }
  const verificationExport = await fetchJson<{
    count: number;
    verificationRuns: Array<{ id: string; command: string }>;
  }>(`${app.apiUrl}/export/verification-runs.json`, {
    headers: { Cookie: authCookie },
  });
  if (
    verificationExport.status !== 200 ||
    verificationExport.body.count < 1 ||
    !verificationExport.body.verificationRuns.some(
      (run) =>
        run.id === recordedVerification.body.verificationRun.id &&
        run.command === "npm run verify:mobile-ux"
    )
  ) {
    throw new Error(
      `mobile UX verification export failed with HTTP ${verificationExport.status}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: app.url,
        viewport: "390x844",
        accessGate: "verified",
        bottomNav: "verified",
        playerCoordination: "verified",
        seasonStandings: "course-handicap net verified",
        moneyWorkflow: "verified",
        rosterWorkflow: "verified",
        opsWorkflow: "verified",
        verificationRun: recordedVerification.body.verificationRun.id,
        teeTimeId,
        keptDatabase: keepDb || Boolean(process.env.MOBILE_UX_DB_PATH),
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Mobile UX verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  if (app) await stop(app);
  if (originalAccessCode == null) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = originalAccessCode;
  if (originalCommissionerCode == null) delete process.env.COMMISSIONER_CODE;
  else process.env.COMMISSIONER_CODE = originalCommissionerCode;
  if (originalHost == null) delete process.env.HOST;
  else process.env.HOST = originalHost;
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAppBasePath == null) delete process.env.APP_BASE_PATH;
  else process.env.APP_BASE_PATH = originalAppBasePath;
  cleanup();
}
