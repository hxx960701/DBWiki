# =============================================================================
# DBwiki Docker Image
# =============================================================================
# Build:
#   docker build -t dbwiki:latest .
#
# Run (with docker-compose — recommended):
#   docker compose up -d
#
# Run (standalone):
#   docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env dbwiki:latest
# =============================================================================

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Native module build dependencies (better-sqlite3, tedious, oracledb)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config first for better layer caching
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/

# Install ALL dependencies (including devDeps for tsc + vite)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ──────────────────────────────────────────────
FROM node:20-slim

# Native runtime deps for better-sqlite3 (and optional oracledb/tedious)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd -g 1000 dbwiki && \
    useradd -u 1000 -g dbwiki -s /bin/sh -m dbwiki && \
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

# Drop to non-root
USER dbwiki

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/dist/index.js"]
