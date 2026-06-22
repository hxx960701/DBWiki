# =============================================================================
# DBwiki Docker Image
# =============================================================================
# Build (no proxy):
#   docker build -t dbwiki:latest .
#
# Build (with proxy):
#   docker build --build-arg http_proxy=http://10.36.51.102:10809 \
#                --build-arg https_proxy=http://10.36.51.102:10809 \
#                -t dbwiki:latest .
# =============================================================================

# ── Proxy args (pass via --build-arg) ─────────────────────────────────────────
ARG http_proxy
ARG https_proxy
ARG no_proxy

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Forward proxy args to this stage
ARG http_proxy
ARG https_proxy
ARG no_proxy

# Native module build dependencies (better-sqlite3, tedious, oracledb)
RUN if [ -n "$http_proxy" ]; then \
      echo "Acquire::http::Proxy \"$http_proxy\";" > /etc/apt/apt.conf.d/99proxy ; \
      echo "Acquire::https::Proxy \"$https_proxy\";" >> /etc/apt/apt.conf.d/99proxy ; \
    fi && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99proxy

WORKDIR /app

# Copy workspace config first for better layer caching
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/

# Install ALL dependencies (including devDeps for tsc + vite)
# npm respects HTTP_PROXY / HTTPS_PROXY env vars automatically
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ──────────────────────────────────────────────
FROM node:20-slim

ARG http_proxy
ARG https_proxy
ARG no_proxy

# Native runtime deps for better-sqlite3 (and optional oracledb/tedious)
RUN if [ -n "$http_proxy" ]; then \
      echo "Acquire::http::Proxy \"$http_proxy\";" > /etc/apt/apt.conf.d/99proxy ; \
      echo "Acquire::https::Proxy \"$https_proxy\";" >> /etc/apt/apt.conf.d/99proxy ; \
    fi && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ curl && \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99proxy

WORKDIR /app

# Create non-root user (GID/UID 1000 may already exist in Debian, use 1001)
RUN if getent group dbwiki >/dev/null; then :; else groupadd -g 1001 dbwiki; fi && \
    if id dbwiki >/dev/null 2>&1; then :; else useradd -u 1001 -g dbwiki -s /bin/sh -m dbwiki; fi && \
    mkdir -p /app/data /app/logs && \
    chown -R dbwiki:dbwiki /app

# Copy workspace config
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/

# Install only production dependencies
# Native modules (better-sqlite3, etc.) compile against the runner's libc
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/client/dist client/dist
COPY --from=builder /app/server/dist server/dist

# Copy seed/migration SQL files (loaded at runtime by knex from dist/)
COPY --from=builder /app/server/src/database/migrations server/dist/database/migrations
COPY --from=builder /app/server/src/database/seeds server/dist/database/seeds
COPY --from=builder /app/server/src/templates server/dist/templates

# Drop to non-root
USER dbwiki

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/dist/index.js"]
