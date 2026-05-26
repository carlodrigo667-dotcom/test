#!/usr/bin/env bash
set -euo pipefail

NODE_ID="${1:-${NODE_ID:-}}"
INTERVAL_MIN="${2:-5}"

if [[ -z "$NODE_ID" ]]; then
  echo "Usage: $0 NODE_ID [INTERVAL_MIN]" >&2
  exit 2
fi

cd /root/colosseum-sniper

if [[ ! -f scripts/calendar-blacklist-sync.js ]]; then
  echo "scripts/calendar-blacklist-sync.js not found" >&2
  exit 1
fi

node --check scripts/calendar-blacklist-sync.js >/dev/null

MARKER_BEGIN="# BEGIN colosseum-calendar-blacklist-node-${NODE_ID}"
MARKER_END="# END colosseum-calendar-blacklist-node-${NODE_ID}"
CRON_EXPR="*/${INTERVAL_MIN} * * * *"
CRON_CMD="cd /root/colosseum-sniper && NODE_ID=${NODE_ID} /usr/bin/node scripts/calendar-blacklist-sync.js --node-id ${NODE_ID} --log sniper.log --state /tmp/sniper-calendar-blacklist-node${NODE_ID}.json --ban-state /tmp/sniper-proxy-bans-node${NODE_ID}.json --audit calendar_blacklist.log >> /tmp/calendar-blacklist-sync-node${NODE_ID}.log 2>&1"

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.new"' EXIT
crontab -l 2>/dev/null > "$tmp" || true
awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$tmp" > "$tmp.new"
{
  cat "$tmp.new"
  echo "$MARKER_BEGIN"
  echo "$CRON_EXPR $CRON_CMD"
  echo "$MARKER_END"
} | crontab -

echo "calendar blacklist cron installed node=${NODE_ID} interval_min=${INTERVAL_MIN}"
