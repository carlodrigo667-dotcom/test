#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/root/colosseum-sniper/web/data/watchdog.log"
STATE_FILE="/root/colosseum-sniper/web/data/watchdog-state"
HEALTH_URL="https://127.0.0.1:3000/api/healthz"
FAIL_LIMIT=3

mkdir -p "$(dirname "$LOG_FILE")"

check_health() {
  curl -sk --connect-timeout 2 --max-time 8 "$HEALTH_URL" | grep -q '"ok":true'
}

if check_health || { sleep 2; check_health; }; then
  rm -f "$STATE_FILE"
  exit 0
fi

fail_count=0
if [ -f "$STATE_FILE" ]; then
  fail_count="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
fi
if ! [[ "$fail_count" =~ ^[0-9]+$ ]]; then
  fail_count=0
fi
fail_count=$((fail_count + 1))
printf '%s\n' "$fail_count" > "$STATE_FILE"

if [ "$fail_count" -lt "$FAIL_LIMIT" ]; then
  echo "[$(date -Is)] health check failed count=$fail_count/$FAIL_LIMIT; not restarting yet" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -Is)] health check failed count=$fail_count/$FAIL_LIMIT, restarting control-center"
  pm2 restart control-center --update-env
  sleep 3
  rm -f "$STATE_FILE"
  curl -sk --connect-timeout 2 --max-time 8 "$HEALTH_URL" || true
  echo
} >> "$LOG_FILE" 2>&1
