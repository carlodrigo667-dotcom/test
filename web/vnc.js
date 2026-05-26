const { execSync, spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const NOVNC_PATH = '/root/noVNC';
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const REMOTE_XAUTHORITY = '/root/.Xauthority';
const REMOTE_XVFB_DISPLAY = ':99';

const sessions = {};

function waitForLocalPort(port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tryConnect = () => {
      const socket = net.connect({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`websockify did not start listening on ${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

async function ensureRemoteDisplay(nodeIp, nodeId, ssh) {
  const command = `
set -e
export XAUTHORITY="${REMOTE_XAUTHORITY}"
touch "$XAUTHORITY" 2>/dev/null || true

normalize_display() {
  RAW="$1"
  RAW="\${RAW%% *}"
  RAW="\${RAW%.0}"
  ID=""
  if printf '%s' "$RAW" | grep -Eq '^:[0-9]+$'; then
    ID="\${RAW#:}"
  elif printf '%s' "$RAW" | grep -Eq '^[0-9]+$'; then
    ID="$RAW"
  else
    ID="$(printf '%s' "$RAW" | sed -nE 's/.*:([0-9]+)(\\.[0-9]+)?.*/\\1/p' | head -n1)"
  fi
  if [ -n "$ID" ]; then
    printf ':%s.0\\n' "$ID"
  fi
}

probe_display() {
  CANDIDATE="$(normalize_display "$1")"
  if [ -n "$CANDIDATE" ] && DISPLAY="$CANDIDATE" XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
    echo "$CANDIDATE"
    return 0
  fi
  return 1
}

display_from_pid() {
  PID="$1"
  if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
    tr '\\0' '\\n' < "/proc/$PID/environ" | awk -F= '$1=="DISPLAY"{print $2; exit}'
  fi
}

for SOURCE in \
  "/tmp/sniper-active-display-node${nodeId}" \
  "/tmp/sniper-rdp-login-display-node${nodeId}" \
  "/tmp/sniper-preferred-display-node${nodeId}"; do
  if [ -s "$SOURCE" ]; then
    if DISPLAY_VALUE="$(probe_display "$(cat "$SOURCE" 2>/dev/null)")"; then
      echo "$DISPLAY_VALUE"
      exit 0
    fi
  fi
done

BOT_PID="$(pgrep -f '[n]ode .*src/sniper\\.js' | head -n1 || true)"
if DISPLAY_VALUE="$(probe_display "$(display_from_pid "$BOT_PID")")"; then
  echo "$DISPLAY_VALUE"
  exit 0
fi

for CHROME_PID in $(pgrep -f '[g]oogle-chrome|[c]hromium' 2>/dev/null | head -n 20); do
  if DISPLAY_VALUE="$(probe_display "$(display_from_pid "$CHROME_PID")")"; then
    echo "$DISPLAY_VALUE"
    exit 0
  fi
done

find_xrdp_display() {
  for ONLY_AUTH in 1 0; do
    for D in $(pgrep -a Xorg 2>/dev/null | grep xrdp | while IFS= read -r LINE; do
      if [ "$ONLY_AUTH" = "1" ] && ! printf '%s\n' "$LINE" | grep -q -- ' -auth '; then
        continue
      fi
      printf '%s\n' "$LINE" | grep -oE '(^|[[:space:]]):[0-9]+' | head -n 1 | tr -d ' '
    done | grep -E '^:[0-9]+$' | sort -Vr | awk '!seen[$0]++'); do
      if DISPLAY="$D.0" XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
        echo "$D.0"
        return 0
      fi
      if DISPLAY="$D" XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
        echo "$D"
        return 0
      fi
    done
  done
  return 1
}

DISPLAY_VALUE="$(find_xrdp_display || true)"
if [ -n "$DISPLAY_VALUE" ]; then
  echo "$DISPLAY_VALUE"
  exit 0
fi

if DISPLAY="${REMOTE_XVFB_DISPLAY}" XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
  echo "${REMOTE_XVFB_DISPLAY}"
  exit 0
fi

if ! command -v Xvfb >/dev/null 2>&1; then
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y xvfb xauth x11-utils >/dev/null 2>&1 || true
fi

if command -v Xvfb >/dev/null 2>&1; then
  if ! pgrep -af "Xvfb ${REMOTE_XVFB_DISPLAY}" >/dev/null 2>&1; then
    nohup Xvfb ${REMOTE_XVFB_DISPLAY} -screen 0 1920x1080x24 -nolisten tcp -ac >/tmp/xvfb99.log 2>&1 &
    sleep 3
  fi

  if DISPLAY="${REMOTE_XVFB_DISPLAY}" XAUTHORITY="$XAUTHORITY" xdpyinfo >/dev/null 2>&1; then
    echo "${REMOTE_XVFB_DISPLAY}"
    exit 0
  fi
fi

echo NONE
`.trim();

  const result = await ssh.execCommand(command, { cwd: '/root' });
  const display = result.stdout.trim().split('\n').filter(Boolean).pop() || 'NONE';
  if (!display || display === 'NONE') {
    throw new Error(`No graphical display available on ${nodeIp}`);
  }
  return display;
}

async function startX11VNC(nodeIp, nodeId, ssh) {
  const vncPort = 5900 + nodeId;
  const display = await ensureRemoteDisplay(nodeIp, nodeId, ssh);

  await ssh.execCommand(`pkill -9 -f "x11vnc.*rfbport ${vncPort}" 2>/dev/null; pkill -9 -f "x11vnc.*:${vncPort}" 2>/dev/null; sleep 1`, { cwd: '/root' });

  const checkResult = await ssh.execCommand(
    '(which x11vnc >/dev/null 2>&1 && which ss >/dev/null 2>&1 && which xdpyinfo >/dev/null 2>&1 && echo READY) || echo MISSING',
    { cwd: '/root' }
  );
  if (!checkResult.stdout.includes('READY')) {
    await ssh.execCommand('apt-get update -y >/dev/null 2>&1 || true; apt-get install -y x11vnc iproute2 x11-utils xvfb >/dev/null 2>&1', { cwd: '/root' });
  }

  const startCommand = display === REMOTE_XVFB_DISPLAY
    ? `
export XAUTHORITY="${REMOTE_XAUTHORITY}"
touch "$XAUTHORITY" 2>/dev/null || true
DISPLAY="${display}" x11vnc -display "${display}" -rfbport ${vncPort} -nopw -shared -forever -bg -quiet -o /tmp/x11vnc_${nodeId}.log >/dev/null 2>&1
STARTED_FLAG=0
for _ in 1 2 3 4 5 6 7 8; do
  if ss -tlnp | grep -q ":${vncPort}"; then
    STARTED_FLAG=1
    break
  fi
  sleep 1
done
if [ "$STARTED_FLAG" = "1" ]; then
  echo STARTED
else
  echo FAILED
  tail -n 80 /tmp/x11vnc_${nodeId}.log 2>/dev/null
fi
`.trim()
    : `
export XAUTHORITY="${REMOTE_XAUTHORITY}"
touch "$XAUTHORITY" 2>/dev/null || true
if DISPLAY="${display}" XAUTHORITY="$XAUTHORITY" x11vnc -display "${display}" -rfbport ${vncPort} -nopw -auth "$XAUTHORITY" -shared -forever -bg -quiet -o /tmp/x11vnc_${nodeId}.log >/dev/null 2>&1; then
  true
else
  DISPLAY="${display}" XAUTHORITY="$XAUTHORITY" x11vnc -display "${display}" -rfbport ${vncPort} -nopw -auth guess -shared -forever -bg -quiet -o /tmp/x11vnc_${nodeId}.log >/dev/null 2>&1
fi
STARTED_FLAG=0
for _ in 1 2 3 4 5 6 7 8; do
  if ss -tlnp | grep -q ":${vncPort}"; then
    STARTED_FLAG=1
    break
  fi
  sleep 1
done
if [ "$STARTED_FLAG" = "1" ]; then
  echo STARTED
else
  echo FAILED
  tail -n 80 /tmp/x11vnc_${nodeId}.log 2>/dev/null
fi
`.trim();

  const result = await ssh.execCommand(startCommand, { cwd: '/root' });
  if (!result.stdout.includes('STARTED')) {
    const details = result.stdout.replace('FAILED', '').trim();
    throw new Error(`x11vnc failed to start on ${nodeIp}. ${details || `Check /tmp/x11vnc_${nodeId}.log on the node.`}`);
  }

  return { vncPort, display };
}

async function startWebsockify(nodeId, nodeIp, vncPort) {
  const wsPort = 6900 + nodeId;

  try {
    execSync(`pkill -f "websockify.*${wsPort}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}

  let websockifyBin = 'websockify';
  try {
    const found = execSync('which websockify 2>/dev/null || echo /usr/local/bin/websockify', { encoding: 'utf8' }).trim();
    if (found) websockifyBin = found;
  } catch {
    throw new Error('websockify not installed on server 12. Run: pip3 install websockify');
  }

  const args = ['--web', NOVNC_PATH];
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    args.push('--ssl-only', '--cert', CERT_PATH, '--key', KEY_PATH);
  }
  args.push(String(wsPort), `${nodeIp}:${vncPort}`);

  const proc = spawn(websockifyBin, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  proc.unref();
  await waitForLocalPort(wsPort, 6000);

  return { wsPort, pid: proc.pid };
}

async function startSession(nodeId, nodeIp, sshConnect) {
  const existing = sessions[nodeId];
  if (existing) {
    existing.lastTouchedAt = Date.now();
    return {
      wsPort: existing.wsPort,
      vncPort: existing.vncPort,
      warm: true,
      novncUrl: buildNoVncUrl(nodeId, existing.wsPort)
    };
  }

  const ssh = await sshConnect(nodeIp);
  try {
    const { vncPort, display } = await startX11VNC(nodeIp, nodeId, ssh);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const { wsPort, pid } = await startWebsockify(nodeId, nodeIp, vncPort);

    sessions[nodeId] = {
      vncPort,
      wsPort,
      websockifyPid: pid,
      nodeIp,
      display,
      startedAt: Date.now(),
      lastTouchedAt: Date.now()
    };

    return { wsPort, vncPort, warm: false, novncUrl: buildNoVncUrl(nodeId, wsPort) };
  } finally {
    ssh.dispose();
  }
}

async function stopSession(nodeId, sshConnect) {
  const session = sessions[nodeId];
  if (!session) return;

  try {
    execSync(`pkill -f "websockify.*${session.wsPort}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}

  if (sshConnect) {
    try {
      const ssh = await sshConnect(session.nodeIp);
      await ssh.execCommand(`pkill -f "x11vnc.*${session.vncPort}" 2>/dev/null`, { cwd: '/root' });
      ssh.dispose();
    } catch {}
  }

  delete sessions[nodeId];
}

function getSession(nodeId) {
  return sessions[nodeId] || null;
}

function getAllSessions() {
  return sessions;
}

function stopAllLocalSessions() {
  Object.values(sessions).forEach((session) => {
    try {
      execSync(`pkill -f "websockify.*${session.wsPort}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
  });

  Object.keys(sessions).forEach((nodeId) => {
    delete sessions[nodeId];
  });
}

function touchSession(nodeId) {
  if (sessions[nodeId]) {
    sessions[nodeId].lastTouchedAt = Date.now();
  }
  return sessions[nodeId] || null;
}

async function ensureSession(nodeId, nodeIp, sshConnect) {
  if (sessions[nodeId]) {
    touchSession(nodeId);
    return {
      ...sessions[nodeId],
      warm: true,
      healthy: await isSessionHealthy(nodeId),
      novncUrl: buildNoVncUrl(nodeId, sessions[nodeId].wsPort)
    };
  }

  const created = await startSession(nodeId, nodeIp, sshConnect);
  return {
    ...sessions[nodeId],
    ...created,
    healthy: true
  };
}

function buildNoVncUrl(nodeId, wsPort) {
  return `/novnc/vnc.html?autoconnect=true&resize=scale&show_dot=true&path=websockify&node=${nodeId}&wsPort=${wsPort}`;
}

async function isSessionHealthy(nodeId) {
  const session = sessions[nodeId];
  if (!session) return false;

  try {
    await waitForLocalPort(session.wsPort, 300);
    return true;
  } catch {
    return false;
  }
}

function isNoVNCInstalled() {
  return fs.existsSync(path.join(NOVNC_PATH, 'vnc.html'));
}

module.exports = {
  startSession,
  stopSession,
  getSession,
  getAllSessions,
  stopAllLocalSessions,
  touchSession,
  ensureSession,
  isSessionHealthy,
  buildNoVncUrl,
  isNoVNCInstalled,
  NOVNC_PATH
};
