#!/bin/bash

if [ -z "$1" ] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
    echo "--- ERROR: NODE_ID argument is required. Usage: bash launcher.sh <node_id> ---"
    exit 1
fi

export NODE_ID="$1"

export XAUTHORITY=/root/.Xauthority
export XVFB_DISPLAY=:99
LAUNCHER_LOCK="/tmp/sniper-launcher-node${NODE_ID}.lock"
exec 9>"$LAUNCHER_LOCK"
if ! flock -w 90 9; then
    echo "--- ERROR: Another launcher is already running for NODE_ID=${NODE_ID}. ---"
    exit 1
fi

printf '%s\n' "$NODE_ID" > /root/colosseum-sniper/.node_id 2>/dev/null || true

normalize_display_id() {
    local RAW="${1:-}"
    local ID=""

    RAW="${RAW%% *}"
    RAW="${RAW%.0}"
    if printf '%s' "$RAW" | grep -Eq '^:[0-9]+$'; then
        ID="${RAW#:}"
    elif printf '%s' "$RAW" | grep -Eq '^[0-9]+$'; then
        ID="$RAW"
    else
        ID="$(printf '%s' "$RAW" | sed -nE 's/.*:([0-9]+)(\.[0-9]+)?.*/\1/p' | head -n1)"
    fi

    if [ -n "$ID" ]; then
        printf ':%s\n' "$ID"
    fi
}

process_lines() {
    local PATTERN="$1"
    ps -eo pid=,args= 2>/dev/null \
        | awk -v pat="$PATTERN" -v self="$$" '
            {
                pid=$1
                $1=""
                sub(/^ +/, "")
                if (pid == self) next
                if ($0 ~ /awk -v pat=/) next
                if ($0 ~ pat) print pid " " $0
            }'
}

process_exists() {
    local PATTERN="$1"
    process_lines "$PATTERN" | head -n 1 | grep -q .
}

kill_processes() {
    local SIGNAL="$1"
    local PATTERN="$2"
    local PID
    process_lines "$PATTERN" | awk '{print $1}' | while IFS= read -r PID; do
        case "$PID" in
            ''|*[!0-9]*) continue ;;
        esac
        [ "$PID" = "$$" ] && continue
        kill "-$SIGNAL" "$PID" 2>/dev/null || true
    done
}

ensure_xvfb_session() {
    touch "$XAUTHORITY" 2>/dev/null || true

    if ! command -v Xvfb >/dev/null 2>&1; then
        apt-get update -y >/dev/null 2>&1 || true
        apt-get install -y xvfb xauth x11-utils >/dev/null 2>&1 || true
    fi

    if ! command -v Xvfb >/dev/null 2>&1; then
        echo "--- ERROR: Xvfb is not installed and could not be installed automatically. ---"
        return 1
    fi

    if ! process_exists "Xvfb ${XVFB_DISPLAY}"; then
        nohup Xvfb ${XVFB_DISPLAY} -screen 0 1920x1080x24 -nolisten tcp -ac >/tmp/xvfb99.log 2>&1 &
        sleep 3
    fi

    if DISPLAY=${XVFB_DISPLAY} XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
        echo "${XVFB_DISPLAY}"
        return 0
    fi

    return 1
}

ensure_xfce_session() {
    local CONF
    CONF="/etc/X11/xrdp/xorg.conf"
    if [ ! -f "$CONF" ]; then
        CONF="/etc/xrdp/xorg.conf"
    fi

    if [ ! -f "$CONF" ]; then
        echo "--- ERROR: xrdp Xorg config not found. ---"
        return 1
    fi

    touch "$XAUTHORITY"

    if ! process_exists "Xorg :20"; then
        nohup Xorg :20 -config "$CONF" -noreset -nolisten tcp -logfile /tmp/xorg20.log >/tmp/xorg20.stdout 2>&1 &
        sleep 5
    fi

    if DISPLAY=:20.0 XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
        if ! process_exists "xfce4-session"; then
            nohup env DISPLAY=:20.0 XAUTHORITY="$XAUTHORITY" dbus-launch startxfce4 >/tmp/startxfce4.log 2>&1 &
            sleep 6
        fi
    fi
}

xrdp_display_ids() {
    local ONLY_AUTH="$1"
    process_lines "Xorg" \
        | grep xrdp \
        | while IFS= read -r LINE; do
            if [ "$ONLY_AUTH" = "1" ] && ! printf '%s\n' "$LINE" | grep -q -- ' -auth '; then
                continue
            fi
            printf '%s\n' "$LINE" | grep -oE '(^|[[:space:]]):[0-9]+' | head -n 1 | tr -d ' '
        done \
        | grep -E '^:[0-9]+$' \
        | sort -Vr \
        | awk '!seen[$0]++'
}

probe_display() {
    local D="$1"
    local CANDIDATE

    for CANDIDATE in "${D}.0" "$D"; do
        export DISPLAY="$CANDIDATE"
        if xdpyinfo >/dev/null 2>&1; then
            echo "$CANDIDATE"
            return 0
        fi
    done

    return 1
}

find_display() {
    local ONLY_AUTH
    local D
    local DISPLAY_RESULT
    local PREFERRED

    for PREFERRED in "$PREFERRED_DISPLAY" "$(cat "/tmp/sniper-preferred-display-node${NODE_ID}" 2>/dev/null || true)"; do
        D="$(normalize_display_id "$PREFERRED")"
        if [ -n "$D" ]; then
            if DISPLAY_RESULT="$(probe_display "$D")"; then
                echo "$DISPLAY_RESULT"
                return 0
            fi
        fi
    done

    for ONLY_AUTH in 1 0; do
        for D in $(xrdp_display_ids "$ONLY_AUTH"); do
            if DISPLAY_RESULT="$(probe_display "$D")"; then
                echo "$DISPLAY_RESULT"
                return 0
            fi
        done
    done

    return 1
}

DISPLAY_VALUE="$(find_display)"
if [ -z "$DISPLAY_VALUE" ]; then
    echo "--- No active xrdp/Xorg display found. Bootstrapping XFCE session on :20.0 ---"
    ensure_xfce_session
    DISPLAY_VALUE="$(find_display)"
fi

if [ -z "$DISPLAY_VALUE" ]; then
    echo "--- No xrdp/Xorg display available. Falling back to Xvfb on ${XVFB_DISPLAY}. ---"
    DISPLAY_VALUE="$(ensure_xvfb_session)"
fi

if [ -z "$DISPLAY_VALUE" ]; then
    echo "--- ERROR: Failed to start or find any usable display (xrdp/Xorg or Xvfb). ---"
    exit 1
fi

export DISPLAY="$DISPLAY_VALUE"
printf '%s\n' "$DISPLAY" > "/tmp/sniper-active-display-node${NODE_ID}" 2>/dev/null || true
echo "--- SUCCESSFULLY VERIFIED AND CONNECTED TO DISPLAY $DISPLAY ---"

# Cleanup previous instances safely
kill_processes TERM "^(/usr/bin/)?node .*src/sniper\.js"
sleep 2
kill_processes KILL "^(/usr/bin/)?node .*src/sniper\.js"
kill_processes TERM "/root/chrome-user-data/"
sleep 1
kill_processes KILL "/root/chrome-user-data/"
kill_processes TERM "/root/chrome-checkout-data/"
sleep 1
kill_processes KILL "/root/chrome-checkout-data/"
kill_processes TERM "[p]roxy-relay\.js"
sleep 1
kill_processes KILL "[p]roxy-relay\.js"
mkdir -p logs
if [ -s sniper.log ]; then
    LOG_BACKUP="logs/sniper-pre-restart-node${NODE_ID}-$(date -u +%Y%m%d-%H%M%S).log"
    cp sniper.log "$LOG_BACKUP" 2>/dev/null || cat sniper.log > "$LOG_BACKUP" 2>/dev/null || true
    : > sniper.log 2>/dev/null || rm -f sniper.log
fi
if [ -s state.json ]; then
    cp state.json "logs/state-pre-restart-node${NODE_ID}-$(date -u +%Y%m%d-%H%M%S).json" 2>/dev/null || true
fi
rm -f state.json /tmp/pay_now /tmp/pay_request.json "/tmp/sniper-manual-checkout-node${NODE_ID}.json"

BAN_STATE_FILE="/tmp/sniper-proxy-bans-node${NODE_ID}.json"
POOL_HASH_FILE="/tmp/sniper-proxy-pool-hash-node${NODE_ID}"
CURRENT_POOL_HASH="$(/usr/bin/node - <<'NODEHASH' 2>/dev/null || true
const fs = require('fs');
const crypto = require('crypto');
const nodeId = String(process.env.NODE_ID || '');
try {
  const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const proxies = Array.isArray(cfg.proxies?.[nodeId]) ? cfg.proxies[nodeId] : [];
  const normalized = proxies.map((p) => [p.host, p.port, p.username || p.user || '', p.password || p.pass || ''].join(':'));
  process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'));
} catch (err) {
  process.stdout.write('');
}
NODEHASH
)"
PREVIOUS_POOL_HASH="$(cat "$POOL_HASH_FILE" 2>/dev/null || true)"
if [ -n "$CURRENT_POOL_HASH" ]; then
    if [ "$CURRENT_POOL_HASH" != "$PREVIOUS_POOL_HASH" ]; then
        rm -f "$BAN_STATE_FILE"
        printf '%s\n' "$CURRENT_POOL_HASH" > "$POOL_HASH_FILE" 2>/dev/null || true
        echo "Proxy ban-state reset because node proxy pool hash changed."
    else
        echo "Proxy ban-state preserved; node proxy pool hash unchanged."
    fi
else
    echo "--- WARN: Could not compute node proxy pool hash; preserving proxy ban-state. ---"
fi
# Очистка лока Chrome, если он остался от предыдущих запусков
find /root/chrome-user-data -name "SingletonLock" -delete 2>/dev/null
find /root/chrome-user-data -name "SingletonCookie" -delete 2>/dev/null
find /root/chrome-user-data -name "SingletonSocket" -delete 2>/dev/null
find /root/chrome-checkout-data -name "SingletonLock" -delete 2>/dev/null
find /root/chrome-checkout-data -name "SingletonCookie" -delete 2>/dev/null
find /root/chrome-checkout-data -name "SingletonSocket" -delete 2>/dev/null
find /root/chrome-user-data \( -name "Login Data*" -o -name "Web Data*" -o -name "Account Web Data*" -o -name "Affiliation Database*" \) -delete 2>/dev/null || true
if [ "${CHECKOUT_FRESH_CART_SESSION_ON_RESTART:-1}" != "0" ]; then
    echo "--- Clearing persisted cart/browser sessions before new hunt ---"
    find /root/chrome-user-data \( \
        -path "*/Default/Cookies" -o \
        -path "*/Default/Cookies-journal" -o \
        -path "*/Default/Network/Cookies" -o \
        -path "*/Default/Network/Cookies-journal" \
    \) -delete 2>/dev/null || true
    find /root/chrome-user-data \( \
        -path "*/Default/Session Storage" -o \
        -path "*/Default/Local Storage" -o \
        -path "*/Default/IndexedDB" -o \
        -path "*/Default/Service Worker" -o \
        -path "*/Default/Cache" -o \
        -path "*/Default/Code Cache" \
    \) -exec rm -rf {} + 2>/dev/null || true
    rm -rf /root/chrome-checkout-data 2>/dev/null || true
fi

# Install dependencies (in case new packages were added)
npm install --production --silent 2>&1 | tail -1

# Launch in background (NODE_ID передаётся явно в env процесса, а не через shell export)
PROXY_PREFLIGHT_CONFIG_ENABLED="$(/usr/bin/node - <<'NODEPREFLIGHT' 2>/dev/null || true
const fs = require('fs');
try {
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  process.stdout.write(config?.proxyPool?.proxyPreflightEnabled === false ? '0' : '1');
} catch {
  process.stdout.write('1');
}
NODEPREFLIGHT
)"
if [ -z "$PROXY_PREFLIGHT_CONFIG_ENABLED" ]; then
    PROXY_PREFLIGHT_CONFIG_ENABLED="1"
fi

if [ "${PROXY_PREFLIGHT_DISABLED:-0}" = "1" ]; then
    echo "Proxy preflight disabled by PROXY_PREFLIGHT_DISABLED=1."
elif [ "$PROXY_PREFLIGHT_CONFIG_ENABLED" != "1" ]; then
    echo "Proxy preflight disabled by config proxyPool.proxyPreflightEnabled=false."
elif [ -f scripts/proxy-preflight.js ]; then
    mkdir -p logs
    nohup env NODE_ID="$NODE_ID" SNIPER_ROOT=/root/colosseum-sniper /usr/bin/node scripts/proxy-preflight.js > "logs/proxy-preflight-node${NODE_ID}.launcher.log" 2>&1 < /dev/null 9>&- &
    echo "Proxy preflight launched in background."
fi

nohup env NODE_ID="$NODE_ID" /usr/bin/node src/sniper.js > sniper.log 2>&1 < /dev/null 9>&- &
echo "Bot NodeJS process launched in background!"
