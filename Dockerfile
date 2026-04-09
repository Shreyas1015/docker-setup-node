# =============================================================================
# STAGE 1: deps — Install ALL dependencies including native compilation
# Base: full Debian so build tools (python3, make, g++) are available for bcrypt
# =============================================================================
FROM node:24-bookworm AS deps

WORKDIR /app

# Copy ONLY package files first — Docker caches this layer.
# If these files haven't changed, npm install is skipped on next build.
# This is the #1 build-time optimization for Node.js images.
COPY package.json package-lock.json ./

# npm ci = clean install from lockfile (deterministic, no surprises)
# All deps including devDependencies (needed for sequelize-cli in migrations)
# BuildKit cache mount: reuses npm cache across builds (~30% faster rebuilds)
RUN --mount=type=cache,target=/root/.npm npm ci

# =============================================================================
# STAGE 2: build — Copy source, then prune dev dependencies
# =============================================================================
FROM node:24-bookworm AS build

WORKDIR /app

# Copy node_modules from deps stage (includes compiled bcrypt binary)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Remove devDependencies (nodemon, eslint, prettier, sequelize-cli)
# These have no place in the production image
RUN npm prune --production

# =============================================================================
# STAGE 3: runtime — Minimal image with only what node needs
# =============================================================================
FROM node:24-bookworm-slim AS runtime

# Express disables stack traces, Sequelize disables SQL logging
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Install wget for healthcheck (not included in bookworm-slim)
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

# Copy pruned node_modules (production deps + compiled bcrypt)
COPY --from=build /app/node_modules ./node_modules

# Copy only what the app needs to run
COPY src/ ./src/
COPY db/ ./db/
COPY package.json ./

# ── NON-ROOT USER ────────────────────────────────────────────────────
# node:24 images ship with a pre-created "node" user (uid 1000).
# Running as root = if app is compromised, attacker has root in container.
USER node

# ── HEALTH CHECK ─────────────────────────────────────────────────────
# Docker probes /health every 30s. wget is available in bookworm-slim.
# This enables depends_on: condition: service_healthy in docker-compose.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

EXPOSE 8080

# ── SIGNAL HANDLING ──────────────────────────────────────────────────
# MUST use exec form (JSON array), NOT shell form (string).
#
# Shell form:  CMD "node src/server.js"
#   -> Docker runs: /bin/sh -c "node src/server.js"
#   -> PID 1 is /bin/sh, NOT node
#   -> SIGTERM goes to sh, which does NOT forward it to node
#   -> Your graceful shutdown code NEVER fires
#   -> Docker waits 10s, sends SIGKILL (abrupt termination)
#
# Exec form:   CMD ["node", "src/server.js"]
#   -> node IS PID 1
#   -> SIGTERM goes directly to node
#   -> Your server.js graceful shutdown fires correctly
CMD ["node", "src/server.js"]
