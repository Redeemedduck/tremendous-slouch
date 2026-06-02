import { execFileSync } from "node:child_process";

const rootUrl =
  process.env.LIVE_ROUTING_URL ||
  process.env.REMOTE_SMOKE_URL ||
  process.env.REMOTE_MOBILE_URL ||
  "https://duckbookpro.clouded-tailor.ts.net/golf";
const directUrl =
  process.env.LIVE_ROUTING_DIRECT_URL || "http://100.102.92.28:3131/golf";
const expectedTitle = "DJDI Golf Board";

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function apiUrl(baseUrl, path) {
  const url = new URL(withoutTrailingSlash(baseUrl));
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath =
    basePath && basePath !== "/" ? `${basePath}-api` : "/api";
  return `${url.origin}${apiBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return { status: response.status, ok: response.ok, body: JSON.parse(text) };
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 120)}`);
  }
}

function assertDjdiHtml(label, result) {
  if (result.status !== 200) throw new Error(`${label} returned HTTP ${result.status}`);
  if (!result.text.includes(`<title>${expectedTitle}`)) {
    throw new Error(`${label} did not render ${expectedTitle}`);
  }
  for (const forbidden of ["Bandon Camp", "BANDON CAMP", "Transition Command Center"]) {
    if (result.text.includes(forbidden)) {
      throw new Error(`${label} rendered competing app marker: ${forbidden}`);
    }
  }
}

try {
  const root = withoutTrailingSlash(rootUrl);
  const direct = withoutTrailingSlash(directUrl);

  const [rootHtml, directHtml] = await Promise.all([
    getText(root),
    getText(direct),
  ]);
  assertDjdiHtml("/golf URL", rootHtml);
  assertDjdiHtml("direct Tailscale-IP URL", directHtml);

  const [
    rootHealth,
    directHealth,
    rootAccess,
    directAccess,
  ] =
    await Promise.all([
      getJson(apiUrl(root, "/health")),
      getJson(apiUrl(direct, "/health")),
      getJson(apiUrl(root, "/access")),
      getJson(apiUrl(direct, "/access")),
    ]);

  for (const [label, result] of [
    ["/golf health", rootHealth],
    ["direct health", directHealth],
  ]) {
    if (result.status !== 200 || !result.body.ok || result.body.database !== "ok") {
      throw new Error(`${label} failed`);
    }
  }

  for (const [label, result] of [
    ["/golf access", rootAccess],
    ["direct Tailscale-IP access", directAccess],
  ]) {
    if (result.status !== 200 || !result.body.required || result.body.ok) {
      throw new Error(`${label} did not prove a locked shared access gate`);
    }
  }

  const funnelStatus = execFileSync("tailscale", ["funnel", "status"], {
    encoding: "utf8",
  });
  if (!funnelStatus.includes("https://duckbookpro.clouded-tailor.ts.net (Funnel on)")) {
    throw new Error(
      `Tailscale Funnel is not public on duckbookpro.clouded-tailor.ts.net: ${funnelStatus.trim()}`
    );
  }
  if (funnelStatus.includes("|-- /         proxy http://127.0.0.1:3131")) {
    throw new Error(`root Funnel proxy should not be claimed by DJDI: ${funnelStatus.trim()}`);
  }
  if (!funnelStatus.includes("|-- /golf     proxy http://127.0.0.1:3131")) {
    throw new Error(`/golf Funnel proxy is missing: ${funnelStatus.trim()}`);
  }
  if (!funnelStatus.includes("|-- /golf-api proxy http://127.0.0.1:3131/api")) {
    throw new Error(`/golf-api Funnel proxy is missing: ${funnelStatus.trim()}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        direct,
        title: expectedTitle,
        accessGate: "verified",
        health: "verified",
        funnelRoutes: {
          "/golf": "http://127.0.0.1:3131",
          "/golf-api": "http://127.0.0.1:3131/api",
        },
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    `Live routing verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
