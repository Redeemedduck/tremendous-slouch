# Running with Tailscale Funnel

The app runs locally on this Mac and Tailscale Funnel publishes that local
server over HTTPS. No Fly/Vercel/Railway signup is required. Keep `ACCESS_CODE`
set before using Funnel because the URL is reachable by people outside the
tailnet.

## Prerequisites

- Tailscale installed on the machine that will run the app (laptop, NAS,
  Pi, whatever is on when you want to use the app).
- Funnel enabled for this node in the Tailscale admin console.
- Node.js 20+ on the host.

Verify on the host:

```sh
tailscale status              # confirms this Mac is connected
tailscale ip -4               # the 100.x.x.x address others on your tailnet see
hostname                      # short name → reachable as https://<hostname>.<tailnet>.ts.net
tailscale funnel status       # should show "(Funnel on)" once configured
```

## One-time setup

```sh
git clone <repo> && cd tremendous-slouch
npm install
```

## Run the app

```sh
npm run start:phone           # rebuilds dist/ and serves on 0.0.0.0:3131
```

`npm start` rebuilds the client and compiles the server to
`dist-server/server.mjs` before launching, so it cannot serve stale/missing
client assets and does not depend on dev-time `tsx` to run production. The
normal `npm start` default remains private on `127.0.0.1:3000`; `start:phone`
intentionally overrides that to `0.0.0.0:3131`.

For this Mac's Tailscale setup, keep one production copy running:

- `npm run start:phone` serves DJDI on port `3131` with `APP_BASE_PATH=/golf`
  and `VITE_BASE_PATH=/golf/`.
- `npm run start:tailnet` aliases to `start:phone`; it no longer starts a
  second server on port `3000`.

```sh
npm run start:phone
```

## Expose it with Funnel

In another terminal on the same host:

```sh
tailscale funnel --bg --yes --https=443 --set-path=/golf 3131
tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api
```

This makes the app available at `https://<hostname>.<tailnet>.ts.net/golf`.
The API is available at `/golf-api`, and the hostname root is intentionally
left unclaimed so another app can use it. The certificate is provisioned
automatically by Tailscale.

Current target URL:

```text
https://duckbookpro.clouded-tailor.ts.net/golf
```

To check or stop Funnel:

```sh
tailscale funnel status
tailscale funnel --https=443 off
```

Read-only browser proof from this machine:

```sh
npm run verify:tailnet
npm run verify:phone-access
```

`verify:tailnet` now expects Funnel, not Serve: `tailscale funnel status` must
show the DJDI hostname as `(Funnel on)` and route `/golf` to
`http://127.0.0.1:3131` plus `/golf-api` to `http://127.0.0.1:3131/api`.
`verify:phone-access` still checks the direct
Tailscale-IP and LAN fallbacks for troubleshooting.

`verify:phone-access` confirms MagicDNS resolution, pings the iPhone over
Tailscale, unlocks player access in a mobile-sized browser, unlocks
commissioner access through the API, and checks the DNS-bypass fallback.

## DNS-bypass fallback

If the phone cannot resolve the MagicDNS name, use the direct Tailscale-IP copy:

```sh
npm run start:phone
```

Then open this URL on the phone:

```text
http://100.102.92.28:3131/golf
```

That URL bypasses MagicDNS and the Funnel hostname. It goes
straight to this Mac's Tailscale IP while keeping the app on `/golf`, so the
root URL remains available for another app.

If the phone is on the same Wi-Fi as the Mac, this LAN-only URL also works
without Tailscale:

```text
http://192.168.8.210:3131/golf
```

The Tailscale-IP URLs still require the phone to be connected to Tailscale. The
direct servers use non-secure cookies because they are plain HTTP over a private
network.

## Then on your phone

Open the Funnel URL:

```text
https://duckbookpro.clouded-tailor.ts.net/golf
```

If DNS on the phone is the problem, open the direct Tailscale-IP URL:

```text
http://100.102.92.28:3131/golf
```

That bypasses MagicDNS and the Funnel hostname.

If Tailscale itself is the problem but the phone is on the same Wi-Fi, open:

```text
http://192.168.8.210:3131/golf
```

Bookmark whichever one works on the phone.

The Funnel URL is public. The app's access code is the protection layer.

## When you're done

```sh
tailscale funnel --https=443 off
pkill -f 'node dist-server/server.mjs'      # or Ctrl-C in the terminal running it
```

## Caveats

- The host machine has to be awake/online when you want to use the app.
  Sleeping laptop = unreachable. A cheap always-on box (old Mac mini, Pi
  4, NAS docker container) avoids that.
- `ACCESS_CODE` env var (the cookie gate built in COL-95) is optional on a
  private tailnet, but useful when you want the same protected path that a
  public deploy will use.
- The seeded SQLite file `golf_coordinator.db` lives wherever you run the
  app from. Run from a stable directory (don't `cd /tmp && npm start` or
  you'll lose data on reboot).

## Going from solo to the whole group later

Three options when you're ready:

1. **Stay on Tailscale**: invite the group to your tailnet. They install
   Tailscale on their phones, sign in to your tailnet, hit the same URL.
   Free up to 100 devices.
2. **Tailscale Funnel**: use `tailscale funnel --bg --yes --https=443 --set-path=/golf 3131`
   and `tailscale funnel --bg --yes --https=443 --set-path=/golf-api http://127.0.0.1:3131/api`.
   `ACCESS_CODE` should be set, and the host machine still has to stay awake.
   If the CLI says Funnel is not enabled, approve it in the Tailscale admin
   console before rerunning the command.
3. **Move to a hosted box** (Fly/Railway/VPS) per `DEPLOY.md` so the
   group doesn't depend on your laptop being awake.
