import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

type Check = {
  id: string;
  ok: boolean;
  detail: string;
  remediation?: string;
};

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error,
  };
}

function findFly() {
  for (const candidate of ["flyctl", "fly"]) {
    const found = run("which", [candidate]);
    if (found.status === 0 && found.stdout) return candidate;
  }
  return null;
}

function findCommand(name: string) {
  const found = run("which", [name]);
  return found.status === 0 && found.stdout ? found.stdout : null;
}

function findTailscale() {
  const pathCommand = findCommand("tailscale");
  if (pathCommand) return pathCommand;
  const appBinary = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const version = run(appBinary, ["version"]);
  return version.status === 0 ? appBinary : null;
}

const appName = process.env.FLY_APP_NAME ?? "djdi-golf-board";
const checks: Check[] = [];
const blockers: string[] = [];
let flyAppReady = false;

const fly = findFly();
if (!fly) {
  checks.push({
    id: "fly-cli",
    ok: false,
    detail: "Fly CLI is not installed or not in PATH.",
    remediation: "Install with `brew install flyctl` or Fly's official installer.",
  });
  blockers.push("fly-cli");
} else {
  const version = run(fly, ["version"]);
  checks.push({
    id: "fly-cli",
    ok: version.status === 0,
    detail: version.stdout || version.stderr,
  });

  const whoami = run(fly, ["auth", "whoami"]);
  const authed = whoami.status === 0 && !!whoami.stdout;
  checks.push({
    id: "fly-auth",
    ok: authed,
    detail: authed ? whoami.stdout : whoami.stderr || "Fly auth is not configured.",
    remediation: "Run `flyctl auth login` or set a valid FLY_ACCESS_TOKEN.",
  });
  if (!authed) blockers.push("fly-auth");

  if (authed) {
    const status = run(fly, ["status", "--app", appName]);
    const appReadable = status.status === 0;
    checks.push({
      id: "fly-app",
      ok: appReadable,
      detail:
        appReadable
          ? `${appName} exists and status is readable.`
          : status.stderr || status.stdout || `Could not read app ${appName}.`,
      remediation: `Run \`fly launch --no-deploy --name ${appName}\` or update FLY_APP_NAME/fly.toml.`,
    });
    if (!appReadable) blockers.push("fly-app");

    const volumes = run(fly, ["volumes", "list", "--app", appName]);
    const hasDataVolume = /\bdata\b/.test(volumes.stdout);
    checks.push({
      id: "fly-volume",
      ok: volumes.status === 0 && hasDataVolume,
      detail:
        volumes.status === 0
          ? hasDataVolume
            ? "Persistent volume `data` is present."
            : "No `data` volume was found."
          : volumes.stderr || volumes.stdout || "Could not list Fly volumes.",
      remediation: `Run \`fly volumes create data --size 1 --region den --app ${appName}\`.`,
    });
    if (volumes.status !== 0 || !hasDataVolume) blockers.push("fly-volume");
    flyAppReady = appReadable && hasDataVolume;
  }
}

const accessCodeReady = Boolean(process.env.ACCESS_CODE?.trim());
checks.push({
  id: "access-code",
  ok: accessCodeReady,
  detail: accessCodeReady
    ? "ACCESS_CODE is configured locally for smoke verification."
    : "ACCESS_CODE is not configured locally.",
  remediation: "Set ACCESS_CODE in .env.local and as a Fly secret before deploy.",
});
if (!accessCodeReady) blockers.push("access-code");

const tailscale = findTailscale();
let publicFunnelReady = false;
if (!tailscale) {
  checks.push({
    id: "tailscale-cli",
    ok: false,
    detail: "Tailscale CLI is not installed or not in PATH.",
    remediation:
      "Install or repair Tailscale before using Funnel as the public URL fallback.",
  });
} else {
  const funnel = run(tailscale, ["funnel", "status"]);
  publicFunnelReady =
    funnel.status === 0 &&
    funnel.stdout.includes("duckbookpro.clouded-tailor.ts.net") &&
    funnel.stdout.includes("http://127.0.0.1:3131");
  checks.push({
    id: "tailscale-funnel-443",
    ok: publicFunnelReady,
    detail: publicFunnelReady
      ? "Dedicated public Funnel route is configured on duckbookpro.clouded-tailor.ts.net."
      : funnel.status === 0
        ? "No dedicated public Funnel route for DJDI on :443. Current Funnel status still shows the DJDI route as tailnet-only or absent."
        : funnel.stderr || funnel.stdout || "Could not read Tailscale Funnel status.",
    remediation:
      "Enable Funnel in the Tailscale admin console, then run `tailscale funnel --bg --yes --https=443 --set-path=/golf 3131` and `tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api`, then verify https://duckbookpro.clouded-tailor.ts.net/golf.",
  });
}

const publicUrlPathReady = (flyAppReady && accessCodeReady) || publicFunnelReady;
checks.push({
  id: "public-url-path",
  ok: publicUrlPathReady,
  detail: publicUrlPathReady
    ? publicFunnelReady
      ? "A public Tailscale Funnel URL path is available for remote smoke verification."
      : "Fly app, volume, and local access-code prerequisites are ready for deployment."
    : "No public production URL path is currently ready: Fly auth/app/volume is incomplete and the DJDI Funnel fallback is not enabled.",
  remediation:
    "Either authenticate Fly and provision the app/volume, or enable Tailscale Funnel for the DJDI route before marking Production URL smoke verified.",
});
if (!publicUrlPathReady) blockers.push("public-url-path");

checks.push({
  id: "remote-smoke-url",
  ok: Boolean(
    process.env.REMOTE_SMOKE_URL ??
      process.env.DJDI_REMOTE_SMOKE_URL ??
      process.env.DJDI_PRODUCTION_URL ??
      process.env.PRODUCTION_URL
  ),
  detail:
    process.env.REMOTE_SMOKE_URL ??
    process.env.DJDI_REMOTE_SMOKE_URL ??
    process.env.DJDI_PRODUCTION_URL ??
    process.env.PRODUCTION_URL ??
    "No remote production URL is configured yet.",
  remediation:
    "Set REMOTE_SMOKE_URL or DJDI_PRODUCTION_URL after the app has a stable public URL.",
});

const output = {
  ok: blockers.length === 0,
  app: appName,
  flyCommand: fly,
  blockers,
  checks,
};

console.log(JSON.stringify(output, null, 2));
if (blockers.length > 0) process.exitCode = 1;
