# Deploying DJDI Golf Board to Fly.io

This app runs as a single Node 20 + Express process backed by a local
SQLite (better-sqlite3) database. We deploy it to [Fly.io](https://fly.io)
with a persistent volume so the SQLite file survives machine restarts.

> Status: Config artifacts are checked in (`Dockerfile`, `fly.toml`), but a
> small code change in `server.ts` is still required before this will
> actually persist data. See **Outstanding follow-up** at the bottom.

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

3. **Set the group access code** (recommended). When `ACCESS_CODE` is set,
   the server requires anyone hitting `/api/*` to first POST the code to
   `/api/access` and receive the `golf_access` HttpOnly cookie. Without this
   env var, the URL is fully public.
   ```sh
   fly secrets set ACCESS_CODE=<pick-a-shared-code>
   ```
   Pick something memorable but not guessable (e.g. an inside-joke phrase).
   Share it with the group via SMS once. To rotate, just `fly secrets set`
   again — existing cookies become invalid the next request.

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

---

## Outstanding follow-up (BLOCKING for first real deploy)

`server.ts` currently does:

```ts
const db = new Database("golf_coordinator.db");
```

This writes to the container's working directory (`/app`), which is **not**
the mounted volume. The Fly volume is mounted at `/data`, and the Dockerfile
already sets `DB_PATH=/data/golf_coordinator.db` in the environment. Before
deploying, update `server.ts` to honor that env var:

```ts
// near the top of server.ts
const DB_PATH = process.env.DB_PATH ?? "golf_coordinator.db";
const db = new Database(DB_PATH);
```

The default keeps local dev (`npm run dev`) working unchanged. Once that
one-line change is merged, this deploy is good to go.
