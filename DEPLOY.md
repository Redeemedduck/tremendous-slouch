# Deploying DJDI Golf Board to Fly.io

This app runs as a single Node 20 + Express process backed by a local
SQLite (better-sqlite3) database. We deploy it to [Fly.io](https://fly.io)
with a persistent volume so the SQLite file survives machine restarts.
`Dockerfile` and `fly.toml` are checked in; `server.ts` already honors the
`DB_PATH` env var that the Dockerfile sets to `/data/golf_coordinator.db`.

Not on Fly? The Dockerfile is portable to Railway, Render, Cloud Run, a
$5/mo VPS with `docker run`, etc. The only requirements are "long-running
Node process" and "writable persistent volume for the SQLite file." See
README.md → Configuration for the env vars.

---

## Prerequisites

- A Fly.io account: <https://fly.io/app/sign-up>
- The `flyctl` CLI installed and authenticated:
  ```sh
  curl -L https://fly.io/install.sh | sh
  fly auth login
  ```
- Docker installed locally (optional but useful for `docker build .` smoke
  tests before deploying).

---

## One-time setup

1. **Initialize the Fly app.** From the repo root:
   ```sh
   fly launch --no-deploy
   ```
   This command will:
   - Detect the existing `Dockerfile` and `fly.toml`.
   - Ask you to confirm or change the app name (placeholder is
     `djdi-golf-board`).
   - Pick a region (default in `fly.toml` is `den` — change as needed).
   - It may rewrite `fly.toml`. Review the diff and merge anything you want
     to keep (especially the `[mounts]`, `[processes]`, and `[env]` blocks).

2. **Create the persistent volume** for the SQLite database:
   ```sh
   fly volumes create data --size 1 --region den
   ```
   - `data` matches `[mounts] source = "data"` in `fly.toml`.
   - `--size 1` = 1 GiB, plenty for a tee-times SQLite DB.
   - Use the same `--region` you chose for the app.

3. **Set the group access and commissioner codes.** When `ACCESS_CODE` is set,
   the server requires anyone hitting `/api/*` to first POST the code to
   `/api/access` and receive the `golf_access` HttpOnly cookie. Without this
   env var, the URL is fully public. `COMMISSIONER_CODE` is separate and
   required for money, roster, launch checks, backups, destructive cleanup,
   and exports; commissioner routes fail closed when it is missing.
   ```sh
   fly secrets set ACCESS_CODE=<pick-a-shared-code>
   fly secrets set COMMISSIONER_CODE=<pick-a-different-admin-code>
   ```
   Pick memorable but not guessable phrases. Share only `ACCESS_CODE` with the
   group. To rotate either code, run `fly secrets set` again; existing cookies
   become invalid on the next request.

---

## Deploy

```sh
fly deploy
```

Fly will build the `Dockerfile`, push the image, attach the volume at
`/data`, and start the machine.

---

## Verify

1. Open the URL Fly prints (e.g. `https://djdi-golf-board.fly.dev`).
2. Smoke test:
   - Create a tee time via the UI.
   - Refresh the page — it should still be there.
   - `fly machine restart <id>` (or `fly deploy` again) — the tee time
     should *still* be there. If it disappears, the volume is not being
     used (see Troubleshooting).
3. Check logs:
   ```sh
   fly logs
   ```
4. Build and smoke-test the production Docker image locally:
   ```sh
   npm run verify:docker
   ```
5. Run the full local proof suite before deploy:
   ```sh
   npm run verify:all
   ```
   This covers typecheck, tests, build, live DB state, backup, persistence,
   production smoke, mobile UX smoke, Docker smoke, dependency audit, and
   whitespace diff hygiene. The smoke checks include the season JSON,
   readiness JSON, text summary, launch packet, and database backup surfaces.
6. Check deploy prerequisites before mutating Fly state:
   ```sh
   npm run verify:deploy-prereqs
   ```
   This checks Fly CLI availability, Fly auth, app visibility, the persistent
   `data` volume, local access-code configuration, and remote-smoke URL
   configuration. It exits non-zero while a required prerequisite is missing.
7. Verify the real local league database state before deploy:
   ```sh
   npm run verify:live-state
   ```
   This is read-only. It checks SQLite health, roster/buy-in/tournament counts,
   known Stop 1 scores, rule blockers, payment-like notes on unpaid buy-ins,
   and prints the remaining risk inventory from the actual DB.
8. Verify a restorable SQLite backup inside the running machine:
   ```sh
   fly ssh console -C "cd /app && npm run verify:backup"
   ```
9. Verify SQLite persistence with an isolated restart probe:
   ```sh
   fly ssh console -C "cd /app && npm run verify:persistence"
   ```
10. Verify the built client and access-gated API path:
   ```sh
   fly ssh console -C "cd /app && npm run verify:prod-smoke"
   ```
11. Verify the phone-sized commissioner golden path locally against an isolated
   database:
   ```sh
   npm run build
   npm run verify:mobile-ux
   ```
   This uses a 390×844 Chromium viewport, verifies access unlock, bottom
   navigation, Season standings, Money, Roster, and Ops, and does not touch the
   live league database.
12. Verify the public production URL from your local machine without mutating
   the live league database:
   ```sh
   REMOTE_SMOKE_URL=https://djdi-golf-board.fly.dev \
   REMOTE_SMOKE_ACCESS_CODE=<shared-code> \
   REMOTE_SMOKE_COMMISSIONER_CODE=<admin-code> \
   npm run verify:remote-smoke
   ```
   This checks the built client, `/api/health`, access gate, tournaments, JSON
   export, text summary export, and launch-packet export. It does **not**
   create a tee time. The script also accepts `DJDI_REMOTE_SMOKE_URL` and
   `DJDI_REMOTE_SMOKE_ACCESS_CODE` and
   `DJDI_REMOTE_SMOKE_COMMISSIONER_CODE` if you prefer project-prefixed env vars.
13. Verify the public URL's mobile browser layout without mutating the live
   league database:
   ```sh
   REMOTE_MOBILE_URL=https://djdi-golf-board.fly.dev \
   REMOTE_MOBILE_ACCESS_CODE=<shared-code> \
   REMOTE_MOBILE_COMMISSIONER_CODE=<admin-code> \
   npm run verify:remote-mobile-ux
   ```
   This drives a 390×844 Chromium viewport through access unlock, bottom
   navigation, Season, Money, Roster, Ops, launch-risk copy, and export links.
   It is remote browser proof, not a substitute for the physical iPhone Safari
   launch gate.
   `npm run verify:phone-access` accepts the same `REMOTE_MOBILE_ACCESS_CODE`
   and `REMOTE_MOBILE_COMMISSIONER_CODE` values, so the full launch verifier
   does not require duplicating them as `ACCESS_CODE` and `COMMISSIONER_CODE`.
14. Once a gate is proven in the target environment, set the matching launch
   flag or mark it in the Ops Launch Gates panel so Ops stops listing it as an
   external risk:
   ```sh
   fly secrets set DJDI_DOCKER_BUILD_VERIFIED=1
   fly secrets set DJDI_PRODUCTION_URL_VERIFIED=1
   fly secrets set DJDI_MOBILE_SAFARI_VERIFIED=1
   ```

---

## Updating

For any subsequent deploy (code change, dependency bump, etc.):

```sh
fly deploy
```

That's it. The volume persists across deploys.

---

## Troubleshooting

- **"database is locked" / SQLite locking errors.** SQLite + WAL doesn't love
  concurrent writers across processes. We run `min_machines_running = 1`
  precisely to avoid scaling to multiple machines. If you ever scale up
  (`fly scale count 2+`), you'll see corruption — don't.
- **Volume out of space.** Resize it:
  ```sh
  fly volumes extend <volume-id> --size 3
  ```
- **Container won't start / exits immediately.** Check logs:
  ```sh
  fly logs
  fly status
  fly ssh console            # poke around inside the running machine
  ```
- **Data disappears on redeploy.** Almost certainly means `server.ts` is
  still writing to `./golf_coordinator.db` (the working dir, which is
  ephemeral) instead of `/data/golf_coordinator.db`. See follow-up below.
- **`better-sqlite3` build failures during `fly deploy`.** The Dockerfile
  installs `python3`, `make`, `g++`, `libc6-dev` for node-gyp; if Fly's
  builder still fails, try forcing prebuilt binaries:
  `RUN npm ci --omit=dev --build-from-source=false`.
- **Local Docker build for sanity check:**
  ```sh
  docker build -t djdi-golf-board .
  docker run --rm -p 3000:3000 -v $(pwd)/.local-data:/data djdi-golf-board
  ```
