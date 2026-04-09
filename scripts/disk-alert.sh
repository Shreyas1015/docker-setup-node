#!/usr/bin/env bash
# Alerts when disk usage exceeds 80%
THRESHOLD=80
USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
  echo "[$(date -u)] ALERT: Disk at ${USAGE}% (threshold: ${THRESHOLD}%)"
  # Optional: send Slack webhook
  # curl -s -X POST "$SLACK_WEBHOOK_URL" -d "{\"text\":\"Disk at ${USAGE}%\"}"
fi
