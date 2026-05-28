import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { chromium } from "playwright";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const accessCode = (
  process.env.ACCESS_CODE ??
  process.env.REMOTE_MOBILE_ACCESS_CODE ??
  process.env.DJDI_REMOTE_MOBILE_ACCESS_CODE ??
  process.env.REMOTE_SMOKE_ACCESS_CODE ??
  process.env.DJDI_REMOTE_SMOKE_ACCESS_CODE
)?.trim();
const commissionerCode = (
  process.env.COMMISSIONER_CODE ??
  process.env.REMOTE_MOBILE_COMMISSIONER_CODE ??
  process.env.DJDI_REMOTE_MOBILE_COMMISSIONER_CODE ??
  process.env.REMOTE_SMOKE_COMMISSIONER_CODE ??
  process.env.DJDI_REMOTE_SMOKE_COMMISSIONER_CODE
)?.trim();
const magicDnsUrl = (
  process.env.DJDI_MAGICDNS_URL ?? "https://duckbookpro.clouded-tailor.ts.net/golf"
).replace(/\/+$/, "");
const appUrl = (
  process.env.DJDI_TAILNET_URL ?? "https://duckbookpro.clouded-tailor.ts.net/golf"
).replace(/\/+$/, "");
const apiUrl = (
  process.env.DJDI_TAILNET_API_URL ?? "https://duckbookpro.clouded-tailor.ts.net/golf-api"
).replace(/\/+$/, "");
const directUrl = (
  process.env.DJDI_DIRECT_TAILSCALE_URL ??
  process.env.DJDI_PHONE_ROOT_URL ??
  "http://100.102.92.28:3131/golf"
).replace(/\/+$/, "");
const directUrlPath = new URL(directUrl).pathname.replace(/\/+$/, "");
const directApiUrl = (
  process.env.DJDI_DIRECT_TAILSCALE_API_URL ??
  `${new URL(directUrl).origin}${
    directUrlPath && directUrlPath !== "/" ? `${directUrlPath}-api` : "/api"
  }`
).replace(/\/+$/, "");
const expectedDnsName =
  process.env.DJDI_TAILNET_DNS_NAME ?? "duckbookpro.clouded-tailor.ts.net";
const expectedTailscaleIp = process.env.DJDI_TAILSCALE_IP ?? "100.102.92.28";
const TAILSCALE_CANDIDATES = [
  process.env.TAILSCALE_BIN,
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
].filter(Boolean) as string[];

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function findTailscaleCommand() {
  for (const candidate of TAILSCALE_CANDIDATES) {
    const version = run(candidate, ["version"]);
    if (version.ok) return candidate;
  }
  throw new Error("Tailscale CLI is not available");
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text}`);
  }
  return { response, body };
}

async function proveApi(label: string, baseApiUrl: string) {
  const health = await fetchJson(`${baseApiUrl}/health`);
  const network = await fetchJson(`${baseApiUrl}/network-status`);
  const accessBefore = await fetchJson(`${baseApiUrl}/access`);
  if (!(accessBefore.body as { required?: boolean }).required) {
    throw new Error(`${label} shared access gate is not configured`);
  }
  if (!accessCode) {
    throw new Error(
      "ACCESS_CODE or REMOTE_MOBILE_ACCESS_CODE is required for phone access proof"
    );
  }
  if (!commissionerCode) {
    throw new Error(
      "COMMISSIONER_CODE or REMOTE_MOBILE_COMMISSIONER_CODE is required for phone access proof"
    );
  }
  const access = await fetchJson(`${baseApiUrl}/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  const accessCookie = access.response.headers.get("set-cookie")?.split(";")[0];
  if (!accessCookie) throw new Error(`${label} did not set player access cookie`);
  const comm = await fetchJson(`${baseApiUrl}/commissioner`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: accessCookie,
    },
    body: JSON.stringify({ code: commissionerCode }),
  });
  const commissionerCookie = comm.response.headers.get("set-cookie")?.split(";")[0];
  if (!commissionerCookie) {
    throw new Error(`${label} did not set commissioner cookie`);
  }
  await fetchJson(`${baseApiUrl}/launch-checks`, {
    headers: { cookie: `${accessCookie}; ${commissionerCookie}` },
  });
  return {
    label,
    health: (health.body as { ok?: boolean }).ok === true ? "verified" : "bad",
    networkStatus:
      typeof (network.body as { directUrl?: unknown; phoneRootUrl?: unknown })
        .directUrl === "string" ||
      typeof (network.body as { phoneRootUrl?: unknown }).phoneRootUrl === "string"
        ? "verified"
        : "bad",
    commissioner: "verified",
  };
}

async function proveBrowser(url: string) {
  if (!accessCode) {
    throw new Error(
      "ACCESS_CODE or REMOTE_MOBILE_ACCESS_CODE is required for browser proof"
    );
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const failures: string[] = [];
    page.on("requestfailed", (request) => {
      failures.push(`${request.url()} ${request.failure()?.errorText}`);
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const gateText = await page.locator("body").innerText();
    if (!gateText.includes("DJDI Golf Board")) {
      throw new Error(`${url} did not show the access gate`);
    }
    if (!gateText.includes("Enter the group access code to continue.")) {
      throw new Error(`${url} did not show the simplified access prompt`);
    }
    const removedGateCopy = [
      "Phone access",
      "Primary phone link",
      "Clean DNS link",
      "Same Wi-Fi",
      "DNS",
      expectedTailscaleIp,
      expectedDnsName,
    ].filter((text) => gateText.includes(text));
    if (removedGateCopy.length) {
      throw new Error(
        `${url} still shows pre-login network/link copy: ${removedGateCopy.join(", ")}`
      );
    }
    const input = page.getByPlaceholder("Access code");
    if (await input.count()) {
      await input.fill(accessCode);
      await page.getByRole("button", { name: "Unlock" }).click();
      await page.waitForTimeout(1800);
    }
    const body = await page.locator("body").innerText();
    const boardLoaded =
      body.includes("Past tee times") ||
      body.includes("Nothing on the board yet") ||
      body.includes("Common Ground");
    if (!boardLoaded) throw new Error(`${url} did not load the board`);
    if (failures.length) throw new Error(`${url} request failures: ${failures.join("; ")}`);
    return { url, board: "verified", simplifiedAccessGate: "verified" };
  } finally {
    await browser.close();
  }
}

try {
  const tailscale = findTailscaleCommand();
  const dns = run("dscacheutil", ["-q", "host", "-a", "name", expectedDnsName]);
  if (!dns.stdout.includes(expectedTailscaleIp)) {
    throw new Error(
      `${expectedDnsName} did not resolve to ${expectedTailscaleIp}: ${dns.stdout || dns.stderr}`
    );
  }
  const ping = run(tailscale, ["ping", "--c=1", "--timeout=3s", "iphone"]);
  if (!ping.ok && !ping.stdout.includes("pong from iphone")) {
    throw new Error(`iPhone tailnet ping failed: ${ping.stdout || ping.stderr}`);
  }

  const [magicApi, directApi, magicBrowser, appBrowser, directBrowser] =
    await Promise.all([
      proveApi("magicdns", apiUrl),
      proveApi("direct", directApiUrl),
      proveBrowser(magicDnsUrl),
      proveBrowser(appUrl),
      proveBrowser(directUrl),
    ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dns: {
          name: expectedDnsName,
          ip: expectedTailscaleIp,
          source: "dscacheutil",
        },
        iphonePing: "verified",
        urls: {
          magicDnsUrl,
          appUrl,
          apiUrl,
          directUrl,
          directApiUrl,
        },
        api: [magicApi, directApi],
        browser: [magicBrowser, appBrowser, directBrowser],
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Phone access verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
