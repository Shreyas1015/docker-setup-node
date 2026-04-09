#!/usr/bin/env bash
# Usage: bash scripts/ssl-init.sh <domain> <email>
set -euo pipefail

DOMAIN="${1:?Usage: ssl-init.sh <domain> <email>}"
EMAIL="${2:?Usage: ssl-init.sh <domain> <email>}"

echo "=== Obtaining SSL certificate for $DOMAIN ==="

# Make sure NGINX is running with the Phase 1 (HTTP-only) config
docker compose up -d nginx

# Wait for NGINX to start
sleep 3

# Get the certificate
docker run --rm \
  -v docker-setup-node_certbot_certs:/etc/letsencrypt \
  -v docker-setup-node_certbot_www:/var/www/certbot \
  certbot/certbot:v2.11.0 certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

echo ""
echo "=== Certificate obtained! ==="
echo ""
echo "Next steps:"
echo "  1. Update nginx/conf.d/default.conf with the HTTPS config"
echo "     (replace 'yourdomain.com' with '$DOMAIN')"
echo "  2. Test:   docker compose exec nginx nginx -t"
echo "  3. Reload: docker compose exec nginx nginx -s reload"
