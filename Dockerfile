# DJDI Golf Board — multi-stage Dockerfile for Fly.io
#
# DESIGN NOTES
# ------------
# - Stage 1 (`builder`) installs ALL deps (incl. devDependencies like vite, tsx,
#   typescript) so we can run `vite build` to produce `dist/`. It also compiles
#   the better-sqlite3 native binding against this image's libc/Node ABI.
# - Stage 2 (`runtime`) starts from a clean slim image and runs a SECOND
#   `npm ci --omit=dev` against package*.json. This is intentionally not a copy
#   of the builder's node_modules, because:
#     a) we want the runtime image to be small (no vite/typescript/etc.), and
#     b) better-sqlite3 still needs to be rebuilt for the runtime stage anyway,
#        so a fresh `npm ci` keeps things simple and predictable.
#   We then `npm install --omit=dev tsx@^4` separately so we can run `server.ts`
#   directly while keeping the runtime image limited to production deps plus
#   the TypeScript entrypoint runner.
#
# - The SQLite file is expected to live at `/data/golf_coordinator.db` so that
#   it can sit on a Fly persistent volume mounted at `/data`. We expose this
#   via the DB_PATH env var.

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 (node-gyp).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        libc6-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including dev) so `vite build` is available.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the client bundle to ./dist.
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# better-sqlite3 prebuilds usually cover this image, but keep the toolchain
# available in case `npm ci --omit=dev` needs to rebuild the native binding.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        libc6-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/golf_coordinator.db

WORKDIR /app

# Install production deps only. We deliberately do NOT copy node_modules from
# the builder — see DESIGN NOTES at top of file.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# tsx lives in devDependencies in package.json, but we need it at runtime to
# execute the TypeScript entrypoint. Install it without modifying package.json.
RUN npm install --omit=dev --no-save tsx@^4

# Copy built client and the server entrypoint.
COPY --from=builder /app/dist ./dist
COPY server.ts ./server.ts
COPY tsconfig.json ./tsconfig.json

# Fly will mount the persistent volume here at runtime.
RUN mkdir -p /data

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
