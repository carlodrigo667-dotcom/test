#!/usr/bin/env bash
set -u

idx=0
while IFS= read -r ip; do
  idx=$((idx + 1))
  ip="${ip//$'\r'/}"
  [ -z "$ip" ] && continue
  label="$(printf 'NODE_%02d' "$idx")"
  if ssh -n -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no "root@$ip" \
    "pgrep -af '[n]ode .*src/sniper.js' >/dev/null"; then
    echo "$label $ip RUNNING"
  else
    echo "$label $ip NOT_RUNNING"
  fi
done < /root/colosseum-sniper/ips.txt
