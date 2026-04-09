#!/usr/bin/env bash
# Usage: bash scripts/backup.sh [--s3]
# Schedule: 0 2 * * * /opt/docker-setup-node/scripts/backup.sh >> /var/log/setup-doc/backup.log 2>&1
# NOTE: Requires pg_dump installed on host: sudo apt install -y postgresql-client
set -euo pipefail

APP_DIR="/opt/docker-setup-node"
BACKUP_DIR="$APP_DIR/backups"
RETENTION_DAYS=7

TIMESTAMP=$(date -u '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/setup_doc_${TIMESTAMP}.sql.gz"

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
find "$BACKUP_DIR" -name "setup_doc_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -u)] Backup complete"
