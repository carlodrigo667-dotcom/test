#!/usr/bin/env bash
set -u

ROOT_DIR="/root/colosseum-sniper"
NODE_ID_FILE="$ROOT_DIR/.node_id"
XAUTHORITY_FILE="/root/.Xauthority"
LOG_FILE="/tmp/rdp-login-sync.log"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
}

normalize_display() {
  local raw="${1:-}"
  local id=""

  raw="${raw%% *}"
  raw="${raw%.0}"
  if printf '%s' "$raw" | grep -Eq '^:[0-9]+$'; then
    id="${raw#:}"
  elif printf '%s' "$raw" | grep -Eq '^[0-9]+$'; then
    id="$raw"
  else
    id="$(printf '%s' "$raw" | sed -nE 's/.*:([0-9]+)(\.[0-9]+)?.*/\1/p' | head -n1)"
  fi

  if [ -n "$id" ]; then
    printf ':%s.0\n' "$id"
  fi
}

chrome_pid_list() {
  ps -eo pid=,args= 2>/dev/null | awk 'tolower($0) ~ /(chrome|chromium)/ {print $1}'
}

node_id="${NODE_ID:-}"
if [ -z "$node_id" ] && [ -s "$NODE_ID_FILE" ]; then
  node_id="$(tr -dc '0-9' < "$NODE_ID_FILE" | head -c 4)"
fi

if [ -z "$node_id" ]; then
  log "skip reason=node_id_missing display_arg=${1:-} env_display=${DISPLAY:-}"
  exit 0
fi

display="$(normalize_display "${1:-${DISPLAY:-}}")"
if [ -z "$display" ]; then
  log "skip node=$node_id reason=display_missing display_arg=${1:-} env_display=${DISPLAY:-}"
  exit 0
fi

delay="${RDP_SYNC_DELAY_SECONDS:-8}"
case "$delay" in
  ''|*[!0-9]*) delay=8 ;;
esac
sleep "$delay"

touch "$XAUTHORITY_FILE" 2>/dev/null || true

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if DISPLAY="$display" XAUTHORITY="$XAUTHORITY_FILE" xdpyinfo >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" != "1" ]; then
  log "skip node=$node_id display=$display reason=display_not_ready"
  exit 0
fi

disable_screen_blank() {
  mkdir -p /root/.config/autostart 2>/dev/null || true
  cat > /root/.config/autostart/xfce4-screensaver.desktop <<'EOF' 2>/dev/null || true
[Desktop Entry]
Type=Application
Name=xfce4-screensaver
Hidden=true
EOF

  DISPLAY="$display" XAUTHORITY="$XAUTHORITY_FILE" xset s off -dpms s noblank >/dev/null 2>&1 || true
  DISPLAY="$display" XAUTHORITY="$XAUTHORITY_FILE" xfce4-screensaver-command --exit >/dev/null 2>&1 || true

  for screen_pid in $(pgrep -f '[x]fce4-screensaver' 2>/dev/null || true); do
    screen_display=""
    if [ -r "/proc/$screen_pid/environ" ]; then
      screen_display="$(tr '\0' '\n' < "/proc/$screen_pid/environ" | awk -F= '$1=="DISPLAY"{print $2; exit}')"
      screen_display="$(normalize_display "$screen_display")"
    fi
    if [ -z "$screen_display" ] || [ "$screen_display" = "$display" ]; then
      kill -TERM "$screen_pid" >/dev/null 2>&1 || true
    fi
  done
}

disable_screen_blank

preferred_file="/tmp/sniper-preferred-display-node${node_id}"
active_file="/tmp/sniper-rdp-login-display-node${node_id}"
printf '%s\n' "$display" > "$preferred_file"
printf '%s\n' "$display" > "$active_file"

bot_pid="$(pgrep -f '[n]ode .*src/sniper.js' | head -n1 || true)"
bot_display=""
if [ -n "$bot_pid" ] && [ -r "/proc/$bot_pid/environ" ]; then
  bot_display="$(tr '\0' '\n' < "/proc/$bot_pid/environ" | awk -F= '$1=="DISPLAY"{print $2; exit}')"
  bot_display="$(normalize_display "$bot_display")"
fi

chrome_displays="$(
  for chrome_pid in $(chrome_pid_list | head -n 20); do
    if [ -r "/proc/$chrome_pid/environ" ]; then
      tr '\0' '\n' < "/proc/$chrome_pid/environ" | awk -F= '$1=="DISPLAY"{print $2; exit}'
    fi
  done | while IFS= read -r chrome_display; do
    normalize_display "$chrome_display"
  done | sort -u | paste -sd, -
)"

chrome_window_visible=0
if command -v xwininfo >/dev/null 2>&1; then
  if DISPLAY="$display" XAUTHORITY="$XAUTHORITY_FILE" xwininfo -root -tree 2>/dev/null \
    | grep -Eiq 'google-chrome|chromium|Google Chrome|ticketing|colosseo|about:blank'; then
    chrome_window_visible=1
  fi
else
  chrome_window_visible=1
fi

json_field() {
  local file="$1"
  local expr="$2"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const expr = process.argv[2];
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = expr.split(".").reduce((obj, key) => obj && obj[key], data);
  if (value !== undefined && value !== null) process.stdout.write(String(value));
} catch {}
' "$file" "$expr" 2>/dev/null || true
}

chrome_cmdline_for_profile() {
  local profile="$1"
  for chrome_pid in $(chrome_pid_list); do
    if [ -r "/proc/$chrome_pid/cmdline" ] && tr '\0' ' ' < "/proc/$chrome_pid/cmdline" | grep -Fq -- "--user-data-dir=$profile"; then
      tr '\0' ' ' < "/proc/$chrome_pid/cmdline"
      return 0
    fi
  done
  return 1
}

relay_port_for_proxy() {
  local proxy_index="$1"
  local base stride
  base="${RELAY_PORT_BASE:-}"
  stride="${RELAY_PORT_STRIDE:-}"

  if [ -z "$base" ] || [ -z "$stride" ]; then
    if [ -s "$ROOT_DIR/config.json" ]; then
      base="${base:-$(node -e 'const fs=require("fs");try{const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(c.proxyPool&&c.proxyPool.relayPortBase||""));}catch{}' "$ROOT_DIR/config.json" 2>/dev/null || true)}"
      stride="${stride:-$(node -e 'const fs=require("fs");try{const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(c.proxyPool&&c.proxyPool.relayPortStride||""));}catch{}' "$ROOT_DIR/config.json" 2>/dev/null || true)}"
    fi
  fi

  base="${base:-20000}"
  stride="${stride:-1000}"
  case "$base" in ''|*[!0-9]*) base=20000 ;; esac
  case "$stride" in ''|*[!0-9]*) stride=1000 ;; esac
  case "$proxy_index" in ''|*[!0-9]*) return 1 ;; esac

  printf '%s\n' $(( base + (node_id * stride) + proxy_index ))
}

port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"
    return $?
  fi
  return 1
}

manual_checkout_proxy_missing() {
  local marker="$1"
  local proxy_index profile cmdline relay_port
  proxy_index="$(json_field "$marker" "proxyIndex")"
  [ -n "$proxy_index" ] || return 1
  profile="/root/chrome-user-data/proxy-${proxy_index}"
  [ -d "$profile" ] || return 1
  cmdline="$(chrome_cmdline_for_profile "$profile" || true)"
  [ -n "$cmdline" ] || return 1
  printf '%s\n' "$cmdline" | grep -Fq -- '--proxy-server=' && return 1
  relay_port="$(relay_port_for_proxy "$proxy_index" || true)"
  [ -n "$relay_port" ] || return 1
  port_is_listening "$relay_port"
}

move_manual_checkout_browser() {
  local marker="$1"
  local proxy_index profile checkout_url cmdline proxy_server chrome_bin relay_port

  proxy_index="$(json_field "$marker" "proxyIndex")"
  checkout_url="$(json_field "$marker" "checkout.url")"
  [ -n "$checkout_url" ] || checkout_url="https://ticketing.colosseo.it/it/checkout"

  profile="$(json_field "$marker" "details.checkoutProfile")"
  if [ -n "$profile" ] && [ -d "$profile" ]; then
    :
  elif [ -n "$proxy_index" ] && [ -d "/root/chrome-user-data/proxy-${proxy_index}" ]; then
    profile="/root/chrome-user-data/proxy-${proxy_index}"
  else
    profile="$(
      for chrome_pid in $(chrome_pid_list); do
        if [ -r "/proc/$chrome_pid/cmdline" ]; then
          tr '\0' '\n' < "/proc/$chrome_pid/cmdline" | sed -n 's/^--user-data-dir=//p' | head -n1
        fi
      done | grep -m1 '^/root/chrome-user-data/'
    )"
  fi

  if [ -z "$profile" ]; then
    log "skip node=$node_id display=$display reason=manual_checkout_profile_missing marker=$marker"
    return 1
  fi

  cmdline="$(chrome_cmdline_for_profile "$profile" || true)"
  if [ -n "$cmdline" ] && printf '%s\n' "$profile" | grep -Fq '/root/chrome-checkout-data/'; then
    log "skip node=$node_id display=$display reason=managed_checkout_profile_running profile=$profile action=keep_controlled_browser"
    return 0
  fi
  proxy_server="$(printf '%s\n' "$cmdline" | grep -oE -- '--proxy-server=[^ ]+' | head -n1 || true)"
  if [ -z "$proxy_server" ] && [ -n "$proxy_index" ]; then
    relay_port="$(relay_port_for_proxy "$proxy_index" || true)"
    if [ -n "$relay_port" ]; then
      if port_is_listening "$relay_port"; then
        proxy_server="--proxy-server=127.0.0.1:${relay_port}"
      else
        log "warn node=$node_id display=$display reason=relay_port_not_listening profile=$profile proxy_index=$proxy_index relay_port=$relay_port"
      fi
    fi
  fi
  if [ -n "$proxy_index" ] && [ -z "$proxy_server" ]; then
    log "skip node=$node_id display=$display reason=manual_checkout_proxy_missing profile=$profile proxy_index=$proxy_index"
    return 1
  fi

  for chrome_pid in $(chrome_pid_list); do
    if [ -r "/proc/$chrome_pid/cmdline" ] && tr '\0' ' ' < "/proc/$chrome_pid/cmdline" | grep -Fq -- "--user-data-dir=$profile"; then
      kill -TERM "$chrome_pid" >/dev/null 2>&1 || true
    fi
  done
  sleep 2
  for chrome_pid in $(chrome_pid_list); do
    if [ -r "/proc/$chrome_pid/cmdline" ] && tr '\0' ' ' < "/proc/$chrome_pid/cmdline" | grep -Fq -- "--user-data-dir=$profile"; then
      kill -KILL "$chrome_pid" >/dev/null 2>&1 || true
    fi
  done

  rm -f "$profile/SingletonLock" "$profile/SingletonCookie" "$profile/SingletonSocket" 2>/dev/null || true
  chrome_bin="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || true)"
  if [ -z "$chrome_bin" ]; then
    log "skip node=$node_id display=$display reason=chrome_bin_missing profile=$profile"
    return 1
  fi

  nohup env DISPLAY="$display" XAUTHORITY="$XAUTHORITY_FILE" "$chrome_bin" \
    --no-sandbox \
    --no-first-run \
    --no-default-browser-check \
    --disable-sync \
    --disable-blink-features=AutomationControlled \
    ${proxy_server:+"$proxy_server"} \
    "--user-data-dir=$profile" \
    --window-size=1920,1080 \
    "$checkout_url" >/tmp/manual-checkout-chrome-node${node_id}.log 2>&1 &

  log "move node=$node_id display=$display reason=manual_checkout_display_mismatch profile=$profile proxy_index=${proxy_index:-unknown} proxy_server=${proxy_server:-none} url=$checkout_url"
  return 0
}

manual_checkout_marker="/tmp/sniper-manual-checkout-node${node_id}.json"
if [ -s "$manual_checkout_marker" ]; then
  marker_age=$(( $(date +%s) - $(stat -c %Y "$manual_checkout_marker" 2>/dev/null || echo 0) ))
  if [ "$marker_age" -lt "${MANUAL_CHECKOUT_RDP_SYNC_SKIP_SECONDS:-7200}" ]; then
    if [ "$chrome_window_visible" != "1" ] \
      || ! printf '%s' "$chrome_displays" | tr ',' '\n' | grep -Fxq "$display" \
      || manual_checkout_proxy_missing "$manual_checkout_marker"; then
      move_manual_checkout_browser "$manual_checkout_marker"
      exit 0
    fi
    log "skip node=$node_id display=$display reason=manual_checkout_active marker_age=${marker_age}s bot_pid=${bot_pid:-none} chrome_displays=${chrome_displays:-none}"
    exit 0
  fi
fi

if [ "$bot_display" = "$display" ]; then
  if { [ -z "$chrome_displays" ] || printf '%s' "$chrome_displays" | tr ',' '\n' | grep -Fxq "$display"; } \
    && [ "$chrome_window_visible" = "1" ]; then
    log "ok node=$node_id display=$display bot_pid=$bot_pid chrome_displays=${chrome_displays:-none} chrome_window=visible action=already_synced"
    exit 0
  fi
fi

if [ ! -f "$ROOT_DIR/launcher.sh" ]; then
  log "skip node=$node_id display=$display reason=launcher_missing"
  exit 0
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
log "restart node=$node_id preferred=$display old_bot_display=${bot_display:-none} old_bot_pid=${bot_pid:-none} chrome_displays=${chrome_displays:-none} chrome_window_visible=$chrome_window_visible"
(
  cd "$ROOT_DIR" || exit 0
  nohup env NODE_ID="$node_id" PREFERRED_DISPLAY="$display" RDP_SYNC_RESTART=1 \
    bash "$ROOT_DIR/launcher.sh" "$node_id" \
    > "/tmp/launcher-node${node_id}-rdp-sync-${stamp}.log" 2>&1 &
) || true

exit 0
