# Production Deployment Guide: Node.js on AWS EC2 with Docker

> A complete, reusable tutorial for deploying any Node.js app on AWS EC2 using Docker.
> Written for the Zorvyn stack (Express 5 + PostgreSQL + Sequelize) but applies to any Node.js project.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [EC2 Instance Setup](#3-ec2-instance-setup)
4. [SSH Hardening](#4-ssh-hardening)
5. [Install Docker](#5-install-docker)
6. [Dockerfile — Multi-Stage Build](#6-dockerfile--multi-stage-build)
7. [.dockerignore](#7-dockerignore)
8. [Docker Compose](#8-docker-compose)
9. [NGINX Reverse Proxy](#9-nginx-reverse-proxy)
10. [SSL with Let's Encrypt](#10-ssl-with-lets-encrypt)
11. [Security Headers](#11-security-headers)
12. [Express Configuration for Reverse Proxy](#12-express-configuration-for-reverse-proxy)
13. [Deployment Scripts](#13-deployment-scripts)
14. [CI/CD with GitHub Actions](#14-cicd-with-github-actions)
15. [Makefile for Operations](#15-makefile-for-operations)
16. [Backup and Restore](#16-backup-and-restore)
17. [Monitoring and Logging](#17-monitoring-and-logging)
18. [Zero-Downtime Deployment (Advanced)](#18-zero-downtime-deployment-advanced)
19. [Disaster Recovery](#19-disaster-recovery)
20. [New Project vs Existing Project](#20-new-project-vs-existing-project)
21. [Common Mistakes](#21-common-mistakes)
22. [Quick Reference](#22-quick-reference)

---

## 1. Architecture Overview

```
Internet
   |
   v
[ AWS Security Group ] -- ports 80, 443 only
   |
   v
[ EC2 Instance (Ubuntu 24.04) ]
   |
   +-- UFW Firewall (ports 22, 80, 443)
   |
   +-- Docker Engine
       |
       +-- [ NGINX Container ] -- ports 80, 443 (public)
       |       |
       |       | (Docker internal network)
       |       v
       +-- [ App Container ] -- port 8080 (internal only)
       |       |
       |       | (outbound to external DB)
       |       v
       +-- [ External PostgreSQL ] -- Neon / RDS / Supabase (managed)
       |
       +-- [ Certbot Container ] -- SSL certificate management
```

### Why this architecture?

| Decision               | Why                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| Docker instead of PM2  | Reproducible builds, isolated dependencies, easy rollback           |
| NGINX in front of Node | SSL termination, request buffering, rate limiting at network edge   |
| External PostgreSQL    | Managed backups, scaling, connection pooling — no ops overhead      |
| No ECS                 | Cost savings — single EC2 instance is sufficient for most startups  |

### What changed from your old PM2 setup

| Before (PM2 + bare metal)       | After (Docker)                                 |
| ------------------------------- | ---------------------------------------------- |
| PM2 manages process             | Docker `restart: unless-stopped` + healthcheck |
| Node.js installed on host       | Node.js inside Docker image                    |
| NGINX installed on host         | NGINX in a container                           |
| `pm2 startup` for boot          | Docker daemon auto-restarts containers         |
| Manual certbot renewal          | Certbot container + cron                       |
| Deps installed on host          | Isolated in Docker image                       |
| Hard to reproduce env           | `docker compose up` anywhere                   |
| Rollback = git revert + restart | Rollback = point to previous image tag         |

---

## 2. Prerequisites

Before you start, make sure you have:

- [ ] An AWS account (free tier works for t2.micro)
- [ ] A domain name with DNS access (for SSL)
- [ ] A GitHub account (for CI/CD and container registry)
- [ ] Git installed locally
- [ ] SSH client (terminal on Mac/Linux, Git Bash or WSL on Windows)

### Generate an SSH key pair (if you don't have one)

```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

---

## 3. EC2 Instance Setup

### 3.1 Launch the Instance

1. Go to AWS Console > EC2 > Launch Instance
2. Configure:

| Setting       | Value                             | Why                                                |
| ------------- | --------------------------------- | -------------------------------------------------- |
| Name          | `zorvyn-production`               | Descriptive name                                   |
| AMI           | Ubuntu 24.04 LTS                  | Long-term support, well-documented                 |
| Instance type | `t3.small` (2 vCPU, 2GB RAM)      | Minimum for production. `t3.micro` for low traffic |
| Key pair      | Create new or use existing `.pem` | SSH access                                         |
| Storage       | 20GB gp3                          | Default 8GB fills fast with Docker images          |

3. **Security Group** — create a new one called `zorvyn-sg`:

| Type  | Port | Source               | Why                                           |
| ----- | ---- | -------------------- | --------------------------------------------- |
| SSH   | 22   | My IP (`x.x.x.x/32`) | Admin access — **never** use 0.0.0.0/0        |
| HTTP  | 80   | 0.0.0.0/0            | Let's Encrypt ACME challenge + HTTPS redirect |
| HTTPS | 443  | 0.0.0.0/0            | All client traffic                            |

**Do NOT open port 8080.** Node.js is only reachable via NGINX inside Docker.

### 3.2 Assign an Elastic IP

Without an Elastic IP, your public IP changes every time the instance stops/starts.

1. EC2 > Elastic IPs > Allocate Elastic IP address
2. Actions > Associate > select your instance
3. Point your domain's DNS A record to this IP

### 3.3 SSH into the Instance

```bash
# Set correct permissions on key file (required)
chmod 400 your-key.pem

# Connect
ssh -i your-key.pem ubuntu@your-elastic-ip
```

### 3.4 Update the System

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 4. SSH Hardening

> Do this BEFORE anything else. An exposed SSH is the #1 attack vector.

### 4.1 Hardening: Disable Root Login + Key-Only Auth

**NOTE:** AWS EC2 instances have EC2 Instance Connect which overrides custom SSH ports. **Keep SSH on port 22** — security comes from restricting access at the AWS Security Group level (IP-only), not port obscurity.

Run these sed commands to harden SSH:

```bash
# Disable root login — if compromised, game over
sudo sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

# Disable password auth — key-only authentication
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Enable pubkey auth
sudo sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Disable challenge-response auth
sudo sed -i 's/#ChallengeResponseAuthentication yes/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config

# Add security settings
echo "MaxAuthTries 3" | sudo tee -a /etc/ssh/sshd_config
echo "ClientAliveInterval 300" | sudo tee -a /etc/ssh/sshd_config
echo "ClientAliveCountMax 1" | sudo tee -a /etc/ssh/sshd_config
echo "LogLevel VERBOSE" | sudo tee -a /etc/ssh/sshd_config
```

### 4.2 Test and Restart SSH

```bash
# Test config for syntax errors (silence = success)
sudo sshd -t

# Restart SSH service
sudo systemctl restart ssh

# Verify it's running
sudo systemctl status ssh
```

You should see: `Active: active (running)`

### 4.3 Restrict SSH Access at AWS Security Group Level

Since we're keeping port 22, restrict access to **your IP only**:

1. Go to **AWS Console → EC2 → Security Groups**
2. Select your security group
3. Edit **Inbound rules**
4. Find the SSH rule (port 22)
5. Change **Source** from `0.0.0.0/0` to **My IP**
6. Save

This approach is **better than port obscurity** because:

- Port 22 is what AWS EC2 Instance Connect expects
- IP restriction is a real security boundary
- Reduces operational complexity

### 4.2 Install fail2ban

fail2ban monitors logs and auto-bans IPs that show malicious patterns.

```bash
sudo apt install -y fail2ban

sudo nano /etc/fail2ban/jail.local
```

```ini
[DEFAULT]
bantime  = 3600      # Ban for 1 hour
findtime = 600       # Look back 10 minutes
maxretry = 5         # 5 failures = ban
ignoreip = 127.0.0.1/8

[sshd]
enabled  = true
port     = 22        # Keep port 22 (EC2 Instance Connect requirement)
logpath  = /var/log/auth.log
maxretry = 3         # SSH gets stricter — 3 failures
bantime  = 86400     # 24 hour ban for SSH brute force
```

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Verify it's running
sudo fail2ban-client status sshd
```

### 4.3 Configure UFW Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

sudo ufw enable

# Verify
sudo ufw status verbose
```

---

## 5. Install Docker

```bash
# Install dependencies
sudo apt install -y ca-certificates curl gnupg lsb-release jq

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin (v2)
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group (avoids sudo for docker commands)
sudo usermod -aG docker $USER

# Apply group change (or log out and back in)
newgrp docker

# Verify installation
docker --version
docker compose version
```

---

## 6. Dockerfile -- Multi-Stage Build

Create `Dockerfile` in your project root.

### Why multi-stage builds?

A naive Dockerfile copies everything into one layer — including build tools, dev dependencies, and compilation artifacts. Result: 900MB+ images. Multi-stage builds use one stage to install/compile, and a clean stage that only copies runtime needs.

### Why `bookworm-slim` not Alpine?

The `bcrypt` package uses a native C++ addon compiled against glibc. Alpine uses musl libc — they are ABI-incompatible. Your container would crash with "invalid ELF header" errors. `bookworm-slim` is small (~220MB) and uses glibc.

If your project doesn't use `bcrypt` or other native addons, Alpine is fine.

```dockerfile
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
```

### Image size comparison

| Approach                | Final image size |
| ----------------------- | ---------------- |
| Naive single-stage      | ~900MB           |
| This multi-stage        | ~220MB           |
| With Alpine (no bcrypt) | ~60MB            |

---

## 7. .dockerignore

Create `.dockerignore` in your project root. This controls what gets sent to the Docker build daemon.

```
# ── Node.js ──────────────────────────────────────────────────
# NEVER copy local node_modules into the container.
# Your local modules are compiled for your OS (macOS/Windows).
# The container runs Linux. bcrypt would crash with "invalid ELF header".
# The Dockerfile runs npm ci inside the container, compiling for Linux.
node_modules/

# ── Secrets — CRITICAL ───────────────────────────────────────
# If .env gets baked into an image layer, it's readable by anyone
# with docker pull access. Secrets are injected at RUNTIME via
# docker-compose env_file, never built into the image.
.env
.env.*
!.env.example

# ── Git ──────────────────────────────────────────────────────
.git
.gitignore

# ── Editor/IDE ───────────────────────────────────────────────
.vscode/
.idea/
*.swp

# ── OS ───────────────────────────────────────────────────────
.DS_Store
Thumbs.db

# ── Logs ─────────────────────────────────────────────────────
logs/
*.log
npm-debug.log*

# ── Not needed in production image ───────────────────────────
tests/
postman/
documentation/
coverage/
*.md
!package.json

# ── Docker files (don't copy into themselves) ────────────────
Dockerfile
docker-compose*.yml
.dockerignore

# ── CI/CD ────────────────────────────────────────────────────
.github/
.claude/
```

---

## 8. Docker Compose

Create `docker-compose.yml` in your project root.

This setup uses an **external managed database** (Neon, RDS, Supabase, etc.) instead of a local PostgreSQL container. Benefits: managed backups, connection pooling, automatic scaling, no volume management.

```yaml
services:
  # ═══════════════════════════════════════════════════════════════════════
  # MIGRATE — One-shot container that runs DB migrations then exits
  # ═══════════════════════════════════════════════════════════════════════
  migrate:
    build:
      context: .
      target: build
      # Uses the "build" stage which still has devDependencies (sequelize-cli).
      # The runtime stage prunes them out.
    container_name: zorvyn_migrate
    env_file: .env

    command: npx sequelize-cli db:migrate
    # Runs pending migrations against the external database and exits.

    restart: 'no'
    # One-shot: run once, exit. If migration fails, don't loop — inspect logs.

    networks:
      - appnet
      # Needs internet access to reach external database (Neon/RDS).

    logging:
      driver: 'json-file'
      options:
        max-size: '5m'
        max-file: '2'

  # ═══════════════════════════════════════════════════════════════════════
  # APP — API server
  # ═══════════════════════════════════════════════════════════════════════
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: zorvyn_app
    env_file: .env
    restart: unless-stopped

    # Read-only root filesystem — if app is compromised, attacker can't write to disk.
    read_only: true
    tmpfs:
      - /tmp

    # Drop all Linux capabilities, add back none — Node.js doesn't need any.
    security_opt:
      - no-new-privileges:true

    # Do NOT expose port 8080 to the host!
    # The app is only reachable via NGINX on the Docker network.
    # Exposing 8080 = raw HTTP traffic bypasses NGINX, bypasses TLS.
    expose:
      - '8080'

    depends_on:
      migrate:
        condition: service_completed_successfully
        # service_completed_successfully: if migrations fail, app never starts.
        # Prevents app from booting against a mismatched schema.

    healthcheck:
      test:
        ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1']
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3

    networks:
      - appnet
      # Needs internet access to reach external database (Neon/RDS).

    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        # Without local Postgres, app gets more resources.

    # Docker sends SIGTERM, waits this long, then SIGKILL.
    # Your server.js has a 10s forced-exit timeout. Set this slightly above.
    stop_grace_period: 15s

    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '5'

  # ═══════════════════════════════════════════════════════════════════════
  # NGINX — Reverse proxy + TLS termination
  # ═══════════════════════════════════════════════════════════════════════
  nginx:
    image: nginx:1.27-alpine
    container_name: zorvyn_nginx
    restart: unless-stopped

    ports:
      # ONLY nginx binds to host ports.
      - '80:80'
      - '443:443'

    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      # :ro = read-only mount. Container can't modify its own config.
      - certbot_certs:/etc/letsencrypt:ro
      - certbot_www:/var/www/certbot:ro

    depends_on:
      app:
        condition: service_healthy

    networks:
      - appnet

    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '5'

  # ═══════════════════════════════════════════════════════════════════════
  # CERTBOT — SSL certificate management
  # ═══════════════════════════════════════════════════════════════════════
  certbot:
    image: certbot/certbot:v2.11.0
    container_name: zorvyn_certbot

    volumes:
      - certbot_certs:/etc/letsencrypt
      - certbot_www:/var/www/certbot

    # Checks renewal every 12 hours. certbot renew is a no-op if certs
    # have > 30 days remaining, so frequent checks are safe.
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot --quiet; sleep 12h & wait $${!}; done'"

    restart: unless-stopped

    networks:
      - appnet

# ═══════════════════════════════════════════════════════════════════════════
# NETWORKS
# ═══════════════════════════════════════════════════════════════════════════
networks:
  appnet:
    driver: bridge
    # Single network — all containers need internet access:
    # App connects to external database (Neon/RDS).
    # NGINX and certbot need internet for ACME challenges.
    # Security is handled by the external DB's own firewall + SSL.

# ═══════════════════════════════════════════════════════════════════════════
# VOLUMES
# ═══════════════════════════════════════════════════════════════════════════
volumes:
  certbot_certs:
    # Let's Encrypt certificates

  certbot_www:
    # ACME HTTP-01 challenge files
```

### .env file for Docker (External Database)

Your `.env` connects to a managed database — no local Postgres credentials needed.

```bash
# Database — external managed PostgreSQL (Neon, RDS, Supabase, etc.)
# The connection string comes from your database provider's dashboard.
# Always use ?sslmode=require for external databases.
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"

# JWT secrets — generate with: openssl rand -base64 64
JWT_SECRET="paste-64-char-random-string-here"
JWT_REFRESH_SECRET="paste-different-64-char-random-string-here"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Server
PORT=8080
NODE_ENV=production

# CORS — your actual domain
CORS_ORIGIN="https://yourdomain.com"

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=info
```

---

## 9. NGINX Reverse Proxy

Create the NGINX directory structure:

```bash
mkdir -p nginx/conf.d
```

### 9.1 Main NGINX Config

Create `nginx/nginx.conf`:

```nginx
worker_processes auto;
# auto = one worker per CPU core. Standard for all deployments.

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    # Max simultaneous connections per worker.
    # 1024 is conservative. 2 cores x 1024 = 2048 max connections.
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # ── Log format with timing info for debugging slow requests ──────
    log_format main '$remote_addr - [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    'rt=$request_time '
                    'uct=$upstream_connect_time '
                    'urt=$upstream_response_time';

    access_log /var/log/nginx/access.log main;

    # ── Performance ──────────────────────────────────────────────────
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    # Hide NGINX version from response headers (security through obscurity)
    server_tokens off;

    # ── Gzip compression — critical for JSON APIs ────────────────────
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;       # Sweet spot: 90% of max compression, 30% of CPU
    gzip_min_length 256;     # Don't compress tiny responses
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        application/xml
        image/svg+xml;

    # ── Rate limiting zones (shared across all server blocks) ────────
    # General API: 30 requests/second per IP
    limit_req_zone $binary_remote_addr zone=api_general:10m rate=30r/s;

    # Auth endpoints: 5 requests/minute per IP (brute force protection)
    limit_req_zone $binary_remote_addr zone=api_auth:10m rate=5r/m;

    # Return 429 Too Many Requests (not 503 which implies server error)
    limit_req_status 429;

    # ── Load virtual host configs ────────────────────────────────────
    include /etc/nginx/conf.d/*.conf;
}
```

### 9.2 Phase 1: HTTP-Only Config (Before SSL)

Create `nginx/conf.d/default.conf` — this is the INITIAL config for getting SSL certificates:

```nginx
# Phase 1: HTTP only — used to obtain SSL certificates.
# Replace this with the HTTPS config after running certbot.

server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    # Let's Encrypt ACME challenge — certbot writes files here
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Proxy to app (HTTP for now, switch to HTTPS redirect after certs)
    location / {
        proxy_pass http://app:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 9.3 Phase 2: Full HTTPS Config (After SSL Certificates)

After obtaining certificates, replace `nginx/conf.d/default.conf` with:

```nginx
# ── Upstream definition ──────────────────────────────────────────────
upstream zorvyn_app {
    server app:8080;
    # "app" resolves to the app container via Docker DNS.

    # Reuse connections to Node.js — avoids TCP handshake per request.
    # Reduces latency by 1-3ms per request.
    keepalive 32;
}

# ── HTTP -> HTTPS redirect ───────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    # Still serve ACME challenges for certificate renewal
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 301 = permanent redirect (browsers cache it)
    location / {
        return 301 https://$host$request_uri;
    }
}

# ── HTTPS server ─────────────────────────────────────────────────────
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    # HTTP/2: multiplexes requests, header compression. Requires SSL.

    server_name yourdomain.com www.yourdomain.com;

    # ── SSL certificates ─────────────────────────────────────────
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # ── SSL hardening ────────────────────────────────────────────
    # TLS 1.2 and 1.3 only — TLS 1.0/1.1 have known vulnerabilities
    ssl_protocols TLSv1.2 TLSv1.3;

    # Strong cipher suites with Perfect Forward Secrecy (ECDHE)
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;

    # Session resumption (returning clients skip full handshake)
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    # tickets off = eliminates session ticket key as attack vector

    # OCSP stapling — your server proves cert isn't revoked
    # instead of client asking Let's Encrypt (saves 100-200ms)
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/yourdomain.com/chain.pem;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    resolver_timeout 5s;

    # ── Security headers ─────────────────────────────────────────
    # Clickjacking protection
    add_header X-Frame-Options "DENY" always;

    # Prevent MIME-type sniffing
    add_header X-Content-Type-Options "nosniff" always;

    # XSS filter (legacy browsers)
    add_header X-XSS-Protection "1; mode=block" always;

    # Force HTTPS for 1 year (browsers remember and auto-upgrade)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # CSP for a pure API (block all content types by default)
    add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none';" always;

    # Control referrer information
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Disable browser features the API doesn't need
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    # ── Block exploit probes ─────────────────────────────────────
    # 444 = NGINX closes connection silently (gives zero info to scanners)

    location ~* \.(php|php3|php5|phtml)$ { return 444; }
    location ~* /(wp-admin|wp-login|wp-content|xmlrpc\.php) { return 444; }
    location ~* /\.git { return 444; }
    location ~* /\.(env|htaccess|htpasswd) { return 444; }

    # ── Auth endpoints — tight rate limit ────────────────────────
    location /api/v1/auth/ {
        limit_req zone=api_auth burst=3 nodelay;
        proxy_pass http://zorvyn_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    # ── API endpoints — general rate limit ───────────────────────
    location /api/ {
        limit_req zone=api_general burst=20 nodelay;
        proxy_pass http://zorvyn_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    # ── Health check — no rate limit, no logging ─────────────────
    location /health {
        proxy_pass http://zorvyn_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;    # Don't pollute logs with health check noise
    }

    # ── Block everything else ────────────────────────────────────
    location / {
        return 444;
    }

    # ── Request limits ───────────────────────────────────────────
    client_max_body_size 10k;      # Match Express json limit
    client_body_timeout 10s;       # Prevents slow-read attacks (Slowloris)
    client_header_timeout 10s;
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
}
```

---

## 10. SSL with Let's Encrypt

### The Chicken-and-Egg Problem

NGINX needs certificates to start in SSL mode. Certbot needs NGINX running to complete the ACME challenge. Solution: **two-phase approach**.

### Step-by-Step

**Step 1: Start with HTTP-only config**

Make sure `nginx/conf.d/default.conf` has the Phase 1 config (from section 9.2).

**Step 2: Start the stack**

```bash
docker compose up -d
```

**Step 3: Verify NGINX is serving the ACME challenge path**

```bash
curl -I http://yourdomain.com/.well-known/acme-challenge/test
# Expect: 404 (file doesn't exist yet, but the location block is working)
```

**Step 4: Run certbot to get initial certificates**

```bash
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email your@email.com \
  --agree-tos \
  --no-eff-email \
  -d yourdomain.com \
  -d www.yourdomain.com
```

On success, certs land in the `certbot_certs` volume at `/etc/letsencrypt/live/yourdomain.com/`.

**Step 5: Switch to HTTPS config**

Replace `nginx/conf.d/default.conf` with the Phase 2 HTTPS config from section 9.3.

Replace all instances of `yourdomain.com` with your actual domain.

**Step 6: Test and reload NGINX**

```bash
# Test config (catches syntax errors before applying)
docker compose exec nginx nginx -t

# Reload (zero-downtime — no dropped connections)
docker compose exec nginx nginx -s reload
```

**Step 7: Verify SSL**

```bash
# Quick check
curl -vI https://yourdomain.com/health 2>&1 | grep -E "SSL|TLS|subject"

# Check security headers
curl -sI https://yourdomain.com/health | grep -i "strict\|x-frame\|x-content"
```

Test with online tools:

- SSL Labs: `https://www.ssllabs.com/ssltest/` (target: A+ grade)
- Security Headers: `https://securityheaders.com/` (target: A grade)

### Auto-Renewal

The certbot container already handles renewal (every 12 hours). Add a cron job to reload NGINX after renewal:

```bash
crontab -e
```

```
# Reload NGINX twice daily to pick up renewed certificates
0 3,15 * * * docker compose -f /path/to/docker-compose.yml exec nginx nginx -s reload 2>/dev/null
```

---

## 11. Security Headers

Here's what each header does and why it matters:

| Header                      | Value                             | Prevents                                         |
| --------------------------- | --------------------------------- | ------------------------------------------------ |
| `X-Frame-Options`           | `DENY`                            | Clickjacking (your page in a hidden iframe)      |
| `X-Content-Type-Options`    | `nosniff`                         | Browser MIME-sniffing (executing text as script) |
| `X-XSS-Protection`          | `1; mode=block`                   | Legacy XSS filter (modern browsers use CSP)      |
| `Strict-Transport-Security` | `max-age=31536000`                | SSL stripping (browser always uses HTTPS)        |
| `Content-Security-Policy`   | `default-src 'none'`              | XSS (blocks all unauthorized content sources)    |
| `Referrer-Policy`           | `strict-origin-when-cross-origin` | URL path leakage in referrer headers             |
| `Permissions-Policy`        | `camera=(), microphone=()`        | XSS accessing device hardware                    |

---

## 12. Express Configuration for Reverse Proxy

Since your app runs behind NGINX, Express needs to trust the proxy headers.

Add this to `src/app.js` after `const app = express();`:

```javascript
// Trust exactly one proxy hop (NGINX).
// This makes:
//   - req.ip return the real client IP (from X-Forwarded-For)
//   - req.secure return true for HTTPS (from X-Forwarded-Proto)
//   - express-rate-limit see real IPs (not NGINX's container IP)
//   - cookie secure flag work correctly
//
// WHY '1' not 'true': 'true' trusts the entire X-Forwarded-For chain,
// allowing clients to spoof their IP. '1' trusts only the last hop (NGINX).
app.set('trust proxy', 1);
```

---

## 13. Deployment Scripts

Create a `scripts/` directory in your project root.

### 13.1 `scripts/setup.sh` — First-Time EC2 Provisioning

```bash
#!/usr/bin/env bash
# Run once on a fresh EC2: sudo bash scripts/setup.sh
set -euo pipefail

APP_DIR="/opt/zorvyn"
echo "=== First-time EC2 setup ==="

# 1. System update
echo "[1/5] Updating system..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Install Docker (from official repo, not Ubuntu snap)
echo "[2/5] Installing Docker..."
apt-get install -y -qq ca-certificates curl gnupg lsb-release jq
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# 3. Create app directory
echo "[3/5] Creating directories..."
mkdir -p "$APP_DIR"/{scripts,backups,nginx/conf.d}
mkdir -p /var/log/zorvyn

# 4. Add user to docker group
echo "[4/5] Configuring users..."
usermod -aG docker ubuntu 2>/dev/null || true

# 5. Configure log rotation
echo "[5/5] Setting up log rotation..."
cat > /etc/logrotate.d/zorvyn <<'EOF'
/var/log/zorvyn/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Clone your repo to $APP_DIR"
echo "  2. Copy .env.example to .env and fill in values"
echo "  3. docker compose up -d"
echo "  4. Run ssl-init.sh for HTTPS"
```

### 13.2 `scripts/deploy.sh` — Deploy with Auto-Rollback

```bash
#!/usr/bin/env bash
# Usage: bash scripts/deploy.sh [image_tag]
# Example: bash scripts/deploy.sh main-abc1234
set -euo pipefail

APP_DIR="/opt/zorvyn"
LOG_FILE="/var/log/zorvyn/deploy.log"
ROLLBACK_FILE="$APP_DIR/.previous_image_tag"
HEALTH_URL="http://127.0.0.1:8080/health"
IMAGE_TAG="${1:-latest}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [$1] $2" | tee -a "$LOG_FILE"; }

wait_healthy() {
  for i in $(seq 1 12); do
    STATUS=$(curl -sf --max-time 5 "$HEALTH_URL" | jq -r '.status' 2>/dev/null || echo "")
    if [ "$STATUS" = "ok" ]; then
      log "INFO" "Health check passed (attempt $i)"
      return 0
    fi
    log "INFO" "Attempt $i/12: waiting 5s..."
    sleep 5
  done
  log "ERROR" "Health check failed after 60s"
  return 1
}

log "INFO" "=== Deploy started: $IMAGE_TAG ==="
cd "$APP_DIR"

# Save current state for rollback
CURRENT_TAG=$(grep '^APP_IMAGE_TAG=' .env 2>/dev/null | cut -d= -f2 || echo "")
[ -n "$CURRENT_TAG" ] && echo "$CURRENT_TAG" > "$ROLLBACK_FILE"

# Update image tag
sed -i "s|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=$IMAGE_TAG|" .env
grep -q '^APP_IMAGE_TAG=' .env || echo "APP_IMAGE_TAG=$IMAGE_TAG" >> .env

# Pull new image (BEFORE stopping old container = less downtime)
log "INFO" "Pulling image..."
docker compose pull app

# Run migrations
log "INFO" "Running migrations..."
docker compose run --rm --no-deps app npx sequelize-cli db:migrate

# Swap containers
log "INFO" "Restarting app..."
docker compose up -d --no-deps --force-recreate app

# Verify
if wait_healthy; then
  log "INFO" "=== Deploy successful: $IMAGE_TAG ==="
  docker image prune -f --filter "until=72h" >> "$LOG_FILE" 2>&1
else
  log "ERROR" "Unhealthy — rolling back..."
  if [ -f "$ROLLBACK_FILE" ]; then
    PREV_TAG=$(cat "$ROLLBACK_FILE")
    sed -i "s|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=$PREV_TAG|" .env
    docker compose up -d --no-deps --force-recreate app
    if wait_healthy; then
      log "INFO" "Rollback successful: $PREV_TAG"
    else
      log "ERROR" "Rollback ALSO failed. Manual intervention required."
      exit 1
    fi
  fi
  exit 1
fi
```

### 13.3 `scripts/ssl-init.sh` — First-Time SSL Certificate

```bash
#!/usr/bin/env bash
# Usage: bash scripts/ssl-init.sh yourdomain.com your@email.com
set -euo pipefail

DOMAIN="${1:?Usage: ssl-init.sh <domain> <email>}"
EMAIL="${2:?Usage: ssl-init.sh <domain> <email>}"

echo "=== Obtaining SSL certificate for $DOMAIN ==="

# Make sure NGINX is running with the Phase 1 (HTTP-only) config
docker compose up -d nginx

# Wait for NGINX to start
sleep 3

# Get the certificate
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

echo ""
echo "=== Certificate obtained! ==="
echo ""
echo "Next steps:"
echo "  1. Update nginx/conf.d/default.conf with the HTTPS config"
echo "     (replace 'yourdomain.com' with '$DOMAIN')"
echo "  2. Test:   docker compose exec nginx nginx -t"
echo "  3. Reload: docker compose exec nginx nginx -s reload"
```

### 13.4 `scripts/backup.sh` — Database Backup (External DB)

```bash
#!/usr/bin/env bash
# Usage: bash scripts/backup.sh [--s3]
# Schedule: 0 2 * * * /opt/zorvyn/scripts/backup.sh >> /var/log/zorvyn/backup.log 2>&1
# NOTE: Requires pg_dump installed on host: sudo apt install -y postgresql-client
set -euo pipefail

APP_DIR="/opt/zorvyn"
BACKUP_DIR="$APP_DIR/backups"
RETENTION_DAYS=7

TIMESTAMP=$(date -u '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/zorvyn_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Read DATABASE_URL from .env
DATABASE_URL=$(grep '^DATABASE_URL=' "$APP_DIR/.env" | cut -d'"' -f2)

echo "[$(date -u)] Starting backup..."

# pg_dump using the external DATABASE_URL directly
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date -u)] Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Upload to S3 if requested
if [[ "${1:-}" == "--s3" ]] && [[ -n "${S3_BUCKET:-}" ]]; then
  aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/backups/" --storage-class STANDARD_IA
  echo "[$(date -u)] Uploaded to S3"
fi

# Prune old backups
find "$BACKUP_DIR" -name "zorvyn_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -u)] Backup complete"
```

---

## 14. CI/CD with GitHub Actions

### 14.1 CI Pipeline — Quality Gate on Pull Requests

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Lint & Format
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
```

### 14.2 CD Pipeline — Build, Push, Deploy on Merge to Main

Create `.github/workflows/cd.yml`:

```yaml
name: CD

on:
  push:
    branches: [main]

env:
  IMAGE_NAME: ghcr.io/${{ github.repository }}

# Required permissions for pushing to GHCR
permissions:
  contents: read
  packages: write

jobs:
  # ── Build Docker image and push to GitHub Container Registry ────
  build-push:
    name: Build & Push
    runs-on: ubuntu-24.04
    outputs:
      short_sha: ${{ steps.vars.outputs.sha }}
    steps:
      - uses: actions/checkout@v4

      - name: Set variables
        id: vars
        run: echo "sha=${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=main-,format=short
            type=raw,value=latest

      - uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ── Deploy to EC2 via SSH ───────────────────────────────────────
  deploy:
    name: Deploy
    runs-on: ubuntu-24.04
    needs: build-push
    environment: production # Requires manual approval (set in GitHub Settings)
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          port: 2222
          command_timeout: 10m
          script: |
            cd ${{ secrets.DEPLOY_DIR }}
            bash scripts/deploy.sh "main-${{ needs.build-push.outputs.short_sha }}"

  # ── External health check + auto-rollback ───────────────────────
  verify:
    name: Health Check
    runs-on: ubuntu-24.04
    needs: deploy
    steps:
      - name: Check /health endpoint
        run: |
          for i in $(seq 1 12); do
            STATUS=$(curl -sf --max-time 5 "https://${{ secrets.EC2_HOST }}/health" \
              | jq -r '.status' 2>/dev/null)
            if [ "$STATUS" = "ok" ]; then
              echo "Healthy on attempt $i"
              exit 0
            fi
            echo "Attempt $i: waiting 5s..."
            sleep 5
          done
          echo "FAILED"
          exit 1

      - name: Rollback on failure
        if: failure()
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          port: 2222
          script: |
            cd ${{ secrets.DEPLOY_DIR }}
            bash scripts/rollback.sh
```

### GitHub Secrets to Configure

Go to: Repository > Settings > Secrets and variables > Actions > New repository secret

| Secret        | Value                                      | Example             |
| ------------- | ------------------------------------------ | ------------------- |
| `EC2_HOST`    | Your Elastic IP or domain                  | `52.1.2.3`          |
| `EC2_USER`    | SSH username                               | `ubuntu`            |
| `EC2_SSH_KEY` | Contents of your `.pem` file (entire file) | `-----BEGIN RSA...` |
| `DEPLOY_DIR`  | App directory on EC2                       | `/opt/zorvyn`       |

Also create a GitHub Environment called `production` (Settings > Environments) and add a required reviewer for the manual approval gate.

---

## 15. Makefile for Operations

Create `Makefile` in your project root:

```makefile
# Zorvyn Operations — run from /opt/zorvyn on EC2
COMPOSE := docker compose

.PHONY: help
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build       Build Docker image"
	@echo "  up          Start all services"
	@echo "  down        Stop all services"
	@echo "  restart     Restart app only"
	@echo "  logs        Follow all logs"
	@echo "  logs-app    Follow app logs"
	@echo "  shell       Shell into app container"
	@echo "  db-shell    PostgreSQL shell"
	@echo "  migrate     Run pending migrations"
	@echo "  seed        Seed database"
	@echo "  backup      Backup database"
	@echo "  health      Check /health endpoint"
	@echo "  status      Container status + resources"
	@echo "  clean       Remove unused containers/images"

.PHONY: build up down restart
build:
	$(COMPOSE) build app

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart app

.PHONY: logs logs-app
logs:
	$(COMPOSE) logs -f --tail=100

logs-app:
	$(COMPOSE) logs -f --tail=100 app

.PHONY: shell db-shell
shell:
	docker exec -it zorvyn_app /bin/sh

db-shell:
	@echo "Using external DB — connect via: psql \$DATABASE_URL"

.PHONY: migrate seed
migrate:
	$(COMPOSE) run --rm app npx sequelize-cli db:migrate

seed:
	$(COMPOSE) run --rm app node db/seed.js

.PHONY: backup health status clean
backup:
	bash scripts/backup.sh

health:
	@curl -sf http://127.0.0.1:8080/health | jq . || echo "UNHEALTHY"

status:
	@echo "=== Containers ==="
	$(COMPOSE) ps
	@echo ""
	@echo "=== Resources ==="
	docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

clean:
	docker container prune -f
	docker image prune -f
```

---

## 16. Backup and Restore

### Backup Schedule

```bash
# Add to crontab (crontab -e)
# Daily backup at 2 AM UTC
0 2 * * * /opt/zorvyn/scripts/backup.sh >> /var/log/zorvyn/backup.log 2>&1

# Weekly backup to S3 (Sundays at 3 AM)
0 3 * * 0 /opt/zorvyn/scripts/backup.sh --s3 >> /var/log/zorvyn/backup.log 2>&1
```

### Restore from Backup

```bash
# List available backups
ls -lh /opt/zorvyn/backups/

# Restore to external database (WARNING: overwrites data)
# Requires pg_dump installed on host: sudo apt install -y postgresql-client
gunzip -c /opt/zorvyn/backups/zorvyn_20260409_020000.sql.gz \
  | psql "$DATABASE_URL"
```

---

## 17. Monitoring and Logging

### View Logs

```bash
# Follow all logs
docker compose logs -f

# App logs only
docker compose logs -f app

# Search for errors
docker compose logs app | grep '"level":"error"' | tail -20

# Check container health status
docker inspect zorvyn_app --format='{{.State.Health.Status}}'

# Resource usage
docker stats --no-stream
```

### Disk Alert Script

Create `scripts/disk-alert.sh`:

```bash
#!/usr/bin/env bash
# Alerts when disk usage exceeds 80%
THRESHOLD=80
USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
  echo "[$(date -u)] ALERT: Disk at ${USAGE}% (threshold: ${THRESHOLD}%)"
  # Optional: send Slack webhook
  # curl -s -X POST "$SLACK_WEBHOOK_URL" -d "{\"text\":\"Disk at ${USAGE}%\"}"
fi
```

```bash
# Add to crontab — check every 30 minutes
*/30 * * * * /opt/zorvyn/scripts/disk-alert.sh >> /var/log/zorvyn/disk.log 2>&1
```

### External Monitoring

Use [UptimeRobot](https://uptimerobot.com) (free, 50 monitors, 5-min intervals). Point it at `https://yourdomain.com/health`. It catches problems internal checks miss (NGINX down, EC2 unreachable, DNS failure).

---

## 18. Zero-Downtime Deployment (Advanced)

The standard `deploy.sh` has ~5 seconds of downtime during container swap. For zero-downtime, use blue-green deployment:

1. Run two app containers: `app-blue` and `app-green`
2. Only one is active (receiving traffic via NGINX upstream)
3. Deploy new version to the inactive slot
4. Wait for health check
5. Swap NGINX upstream atomically (`nginx -s reload`)
6. Stop the old slot

This adds ~200MB RAM overhead during deploys but achieves true zero-downtime. See the detailed blue-green scripts in the research docs — implement this after you're comfortable with the standard flow.

---

## 19. Disaster Recovery

### What to Back Up

| Asset           | How Often       | Method                              |
| --------------- | --------------- | ----------------------------------- |
| PostgreSQL data | Managed         | Neon/RDS automatic backups          |
| `.env` file     | On every change | Encrypted S3 or AWS Secrets Manager |
| NGINX config    | In git          | Part of your repo                   |
| Docker images   | Every push      | GHCR (automatic)                    |

### Recovery Timeline (Full Instance Loss)

| Step      | Action                          | Time           |
| --------- | ------------------------------- | -------------- |
| 1         | Launch new EC2 + Elastic IP     | 3 min          |
| 2         | Run `setup.sh`                  | 5 min          |
| 3         | Clone repo + restore `.env`     | 2 min          |
| 4         | `docker compose up -d`          | 3 min          |
| 5         | Verify health + update DNS      | 2 min          |
| **Total** |                                 | **~15 min**    |

**Run a DR drill quarterly** on a fresh EC2 instance (not production). If it takes more than 30 minutes, automate what slowed you down.

---

## 20. New Project vs Existing Project

### Starting a New Project from Scratch

```bash
# 1. Create your Node.js project
mkdir my-app && cd my-app
npm init -y
npm install express

# 2. Copy these files from this guide (or a template repo):
#    - Dockerfile
#    - .dockerignore
#    - docker-compose.yml
#    - nginx/nginx.conf
#    - nginx/conf.d/default.conf
#    - scripts/setup.sh, deploy.sh, ssl-init.sh, backup.sh
#    - Makefile
#    - .github/workflows/ci.yml, cd.yml

# 3. Add a /health endpoint to your app
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

# 4. Add graceful shutdown handling
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

# 5. Add trust proxy if behind NGINX
app.set('trust proxy', 1);

# 6. Push to GitHub, provision EC2, deploy
```

### Adding Docker to an Existing Project

```bash
# 1. Add these files to your project root:
#    - Dockerfile         (adjust entry point: CMD ["node", "your-entry.js"])
#    - .dockerignore      (copy as-is)
#    - docker-compose.yml (adjust service names, ports, env vars)
#    - nginx/             (copy directory, update domain name)
#    - scripts/           (copy directory, update paths)
#    - Makefile           (adjust container names)
#    - .github/workflows/ (copy directory)

# 2. Update .env for Docker:
#    - Set DATABASE_URL to your external DB (Neon, RDS, Supabase)
#    - Always use ?sslmode=require for external databases

# 3. Add to your Express app:
app.set('trust proxy', 1);

# 4. Ensure you have:
#    - A /health endpoint
#    - Graceful shutdown (SIGTERM handler)
#    - CMD in exec form (JSON array) in Dockerfile

# 5. Test locally first:
docker compose up --build

# 6. Verify everything works, then push and deploy
```

### Checklist: What Every Node.js App Needs for Docker

- [ ] `/health` endpoint returning `{ "status": "ok" }`
- [ ] Graceful shutdown on SIGTERM/SIGINT
- [ ] `app.set('trust proxy', 1)` for reverse proxy
- [ ] `CMD ["node", "entry.js"]` (exec form, not shell form)
- [ ] No hardcoded `localhost` in database URLs
- [ ] Secrets via environment variables, never in code

---

## 21. Common Mistakes

| Mistake                     | Symptom                                         | Fix                                      |
| --------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Shell form CMD              | Graceful shutdown never fires, deploys take 10s | `CMD ["node", "src/server.js"]`          |
| Copying local node_modules  | "invalid ELF header" crash                      | `.dockerignore` excludes `node_modules/` |
| .env baked into image       | Secrets visible in `docker history`             | `.dockerignore` excludes `.env`          |
| DATABASE_URL with localhost | "connection refused" on startup                 | Use external DB URL with `?sslmode=require` |
| No trust proxy              | Rate limiting broken, wrong IP in logs          | `app.set('trust proxy', 1)`              |
| Alpine with bcrypt          | musl/glibc incompatibility crash                | Use `bookworm-slim`                      |
| No resource limits          | One bad query kills entire instance             | `deploy.resources.limits`                |
| `docker compose down -v`    | SSL cert volumes deleted                        | Never use `-v` in production             |
| Exposing port 8080          | Bypasses NGINX, no SSL                          | Only NGINX binds to host ports           |
| Running as root             | Container escape = host compromise              | `USER node` in Dockerfile                |

---

## 22. Quick Reference

### First-Time Deploy (Complete Sequence)

```bash
# On EC2:
sudo bash scripts/setup.sh
git clone https://github.com/you/zorvyn.git /opt/zorvyn
cd /opt/zorvyn
cp .env.example .env
nano .env                              # Fill in real values
docker compose up -d                   # Start everything
bash scripts/ssl-init.sh yourdomain.com you@email.com
# Update nginx config to Phase 2 HTTPS
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

### Daily Operations

```bash
make status          # Check container health
make logs-app        # View app logs
make health          # Hit /health endpoint
make backup          # Backup database
make migrate         # Run pending migrations
make restart         # Restart app container
make clean           # Clean up old images
```

### Emergency Commands

```bash
# View what's wrong
docker compose logs --tail=50 app
docker inspect zorvyn_app --format='{{.State.Health.Status}}'

# Restart everything
docker compose down && docker compose up -d

# Rollback to previous version
bash scripts/rollback.sh

# Manual rollback to specific version
bash scripts/rollback.sh main-abc1234

# Restore database from backup (external DB)
gunzip -c backups/zorvyn_20260409.sql.gz | psql "$DATABASE_URL"
```

### Project File Structure

```
your-project/
├── .github/workflows/
│   ├── ci.yml                 # Lint/format on PR
│   └── cd.yml                 # Build/push/deploy on merge
├── nginx/
│   ├── nginx.conf             # Main NGINX config
│   └── conf.d/
│       └── default.conf       # Virtual host config
├── scripts/
│   ├── setup.sh               # First-time EC2 setup
│   ├── deploy.sh              # Deploy with rollback
│   ├── ssl-init.sh            # First-time SSL
│   ├── backup.sh              # Database backup
│   └── disk-alert.sh          # Disk monitoring
├── src/                       # Your app code
├── db/                        # Migrations and seeds
├── .dockerignore
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── Makefile
```
