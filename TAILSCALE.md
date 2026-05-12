# Running on Tailscale (solo testing)

The fastest way to use this on your own phone without standing up a public
host. The app stays bound to `127.0.0.1` (loopback only — nothing on your
LAN can hit it), and Tailscale's built-in proxy publishes it over HTTPS on
your tailnet.

## Prerequisites

- Tailscale installed on the machine that will run the app (laptop, NAS,
  Pi, whatever is on when you want to use the app).
- Tailscale installed on your phone, signed in to the same tailnet.
- Node.js 20+ on the host.

Verify on the host:

```sh
tailscale status              # confirms you're connected
tailscale ip -4               # the 100.x.x.x address others on your tailnet see
hostname                      # short name → reachable as https://<hostname>.<tailnet>.ts.net
```

## One-time setup

```sh
git clone <repo> && cd tremendous-slouch
npm install
npm run build
```

## Run the app

```sh
npm run start                 # builds-already-built; serves from dist/ on 127.0.0.1:3000
```

That's the entire server. It's bound to `127.0.0.1` — nothing outside this
machine can reach it directly. The default `HOST=127.0.0.1` and `PORT=3000`
are overridable via env vars if you ever need to bind elsewhere.

## Expose it on your tailnet

In another terminal on the same host:

```sh
tailscale serve --bg --https=443 http://localhost:3000
```

This makes the app available at `https://<hostname>.<tailnet>.ts.net` from
any device on your tailnet. The cert is provisioned automatically.

To check or stop:

```sh
tailscale serve status        # what's currently proxied
tailscale serve --https=443 off   # tear it down
```

## Then on your phone

1. Make sure Tailscale is connected on the phone.
2. Open Safari/Chrome → `https://<hostname>.<tailnet>.ts.net`
3. Bookmark it / add-to-home-screen.

Only devices on your tailnet can reach the URL. Nobody else, even with the
link, can hit it.

## When you're done

```sh
tailscale serve --https=443 off
pkill -f 'tsx server.ts'      # or just Ctrl-C in the terminal running it
```

## Caveats

- The host machine has to be awake/online when you want to use the app.
  Sleeping laptop = unreachable. A cheap always-on box (old Mac mini, Pi
  4, NAS docker container) avoids that.
- `ACCESS_CODE` env var (the cookie gate built in COL-95) is unnecessary
  here — the tailnet is the auth boundary. Leave it unset.
- The seeded SQLite file `golf_coordinator.db` lives wherever you run the
  app from. Run from a stable directory (don't `cd /tmp && npm start` or
  you'll lose data on reboot).

## Going from solo to the whole group later

Three options when you're ready:

1. **Stay on Tailscale**: invite the group to your tailnet. They install
   Tailscale on their phones, sign in to your tailnet, hit the same URL.
   Free up to 100 devices.
2. **Tailscale Funnel**: `tailscale funnel --bg http://localhost:3000`
   exposes the same `.ts.net` URL to the public internet. They can hit it
   without Tailscale. You'd want `ACCESS_CODE` set in this case.
3. **Move to a hosted box** (Fly/Railway/VPS) per `DEPLOY.md` so the
   group doesn't depend on your laptop being awake.
