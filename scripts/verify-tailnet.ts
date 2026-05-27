import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const rawUrl =
  process.env.TAILNET_URL ??
  process.env.DJDI_TAILNET_URL ??
  "https://duckbookpro.clouded-tailor.ts.net";
const baseUrl = rawUrl.replace(/\/+$/, "");
const parsedBaseUrl = new URL(baseUrl);
const originUrl = parsedBaseUrl.origin;
const appMountPath = parsedBaseUrl.pathname.replace(/\/+$/, "");
const apiBaseUrl = (
  process.env.DJDI_TAILNET_API_URL ??
  (appMountPath === "/djdi"
    ? `${originUrl}/djdi-api`
    : `${baseUrl}/api`)
).replace(/\/+$/, "");
const expectedTarget =
  process.env.DJDI_TAILNET_EXPECTED_TARGET ??
  "http://127.0.0.1:3131";
const expectedApiTarget =
  process.env.DJDI_TAILNET_EXPECTED_API_TARGET ??
  (appMountPath === "/djdi" ? "http://127.0.0.1:3131/api" : expectedTarget);
const localUrl = (
  process.env.DJDI_LOCAL_URL ??
  "http://127.0.0.1:3131"
).replace(/\/+$/, "");
const accessCode = process.env.ACCESS_CODE;
const commissionerCode = process.env.COMMISSIONER_CODE;
const TAILSCALE_CANDIDATES = [
  process.env.TAILSCALE_BIN,
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
].filter(Boolean) as string[];

function shellQuote(value: string) {
  return /[^a-zA-Z0-9_./:=@-]/.test(value)
    ? `'${value.replace(/'/g, "'\\''")}'`
    : value;
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  if (result.status !== 0) {
    throw new Error(
      [
        `${[command, ...args].map(shellQuote).join(" ")} failed`,
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
        result.error && `error: ${result.error.message}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return { stdout, stderr };
}

function findTailscaleCommand() {
  for (const candidate of TAILSCALE_CANDIDATES) {
    const version = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      env: process.env,
    });
    if (version.status === 0) return candidate;
  }
  throw new Error(
    "Tailscale CLI is not available on PATH or at /Applications/Tailscale.app/Contents/MacOS/Tailscale"
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchText(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`${baseUrl}${path} returned HTTP ${response.status}`);
  }
  return text;
}

async function fetchJson<T>(path: string) {
  const apiPath = path.startsWith("/api/") ? path.slice(4) : path;
  const response = await fetch(`${apiBaseUrl}${apiPath}`);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`${baseUrl}${path} returned non-JSON HTTP ${response.status}`);
  }
  if (response.status !== 200) {
    throw new Error(`${baseUrl}${path} returned HTTP ${response.status}`);
  }
  return body;
}

function assertDjdiHtml(path: string, html: string) {
  if (!html.includes("DJDI Golf Board")) {
    throw new Error(`${baseUrl}${path} did not render DJDI Golf Board`);
  }
  for (const forbidden of ["Bandon Camp", "BANDON CAMP", "Transition Command Center"]) {
    if (html.includes(forbidden)) {
      throw new Error(
        `${baseUrl}${path} rendered competing app marker ${forbidden}; Funnel may be pointed at the wrong app`
      );
    }
  }
}

async function recordVerificationRun(summary: string) {
  if (!accessCode) return null;

  const login = await fetch(`${localUrl}/api/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  if (!login.ok) return null;

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) return null;
  if (!commissionerCode) return null;

  const commissionerLogin = await fetch(`${localUrl}/api/commissioner`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ code: commissionerCode }),
  });
  if (!commissionerLogin.ok) return null;
  const commissionerCookie = commissionerLogin.headers.get("set-cookie")?.split(";")[0];
  if (!commissionerCookie) return null;
  const authCookie = `${cookie}; ${commissionerCookie}`;

  const command = [
    "tailscale funnel status",
    `DJDI_TAILNET_URL=${baseUrl} DJDI_TAILNET_API_URL=${apiBaseUrl} npm run verify:tailnet`,
  ].join(" && ");
  const response = await fetch(`${localUrl}/api/verification-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: authCookie },
    body: JSON.stringify({
      command,
      status: "passed",
      scope: [
        "tailscale funnel",
        "tailnet app mount title",
        "tailnet health",
        "tailnet mounted API",
      ],
      summary,
      recordedBy: "verify:tailnet",
      metadata: {
        url: baseUrl,
        apiUrl: apiBaseUrl,
        expectedTarget,
        expectedApiTarget,
        localUrl,
      },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    verificationRun?: { id: string; status: string };
  };
  return body.verificationRun ?? null;
}

try {
  const tailscale = findTailscaleCommand();
  const funnelStatus = run(tailscale, ["funnel", "status"]);
  const publicFunnelLine = new RegExp(
    `^${escapeRegex(originUrl)}\\s+\\(Funnel on\\)`,
    "m"
  );
  if (!publicFunnelLine.test(funnelStatus.stdout)) {
    throw new Error(
      `Tailscale Funnel must expose ${originUrl} publicly and show "(Funnel on)".\n${funnelStatus.stdout}`
    );
  }
  const target = escapeRegex(expectedTarget);
  const routePath = appMountPath || "/";
  const routeLabel = escapeRegex(routePath);
  const appRoute = new RegExp(`\\|--\\s+${routeLabel}\\s+proxy\\s+${target}`);
  if (!appRoute.test(funnelStatus.stdout)) {
    throw new Error(
      `Tailscale Funnel must route ${routePath} to ${expectedTarget}.\n${funnelStatus.stdout}`
    );
  }
  if (appMountPath === "/djdi") {
    const apiTarget = escapeRegex(expectedApiTarget);
    const apiRoute = new RegExp(`\\|--\\s+/djdi-api\\s+proxy\\s+${apiTarget}`);
    if (!apiRoute.test(funnelStatus.stdout)) {
      throw new Error(
        `Tailscale Funnel must route /djdi-api to ${expectedApiTarget}.\n${funnelStatus.stdout}`
      );
    }
  }

  const [appHtml, health] = await Promise.all([
    fetchText(""),
    fetchJson<{ ok: boolean; database: string }>("/api/health"),
  ]);
  assertDjdiHtml("", appHtml);
  if (!health.ok || health.database !== "ok") {
    throw new Error(`tailnet health returned ${JSON.stringify(health)}`);
  }
  if (appMountPath === "/djdi" && !appHtml.includes("/djdi/assets/")) {
    throw new Error(`${baseUrl} did not reference mounted /djdi assets`);
  }

  const summary = `Tailscale Funnel route verified at ${baseUrl}: ${routePath} proxies to ${expectedTarget}, API proxies via ${apiBaseUrl}, and health passed.`;
  const recorded = await recordVerificationRun(summary);

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: baseUrl,
        apiUrl: apiBaseUrl,
        expectedTarget,
        expectedApiTarget,
        funnelRoute: "verified",
        appTitle: "DJDI Golf Board",
        health: "verified",
        verificationRun: recorded?.id ?? null,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Tailnet verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
