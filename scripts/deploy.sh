#!/usr/bin/env bash
# Usage: bash scripts/deploy.sh [image_tag]
# Example: bash scripts/deploy.sh main-abc1234
set -euo pipefail

APP_DIR="/opt/docker-setup-node"
LOG_FILE="/var/log/setup-doc/deploy.log"
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
