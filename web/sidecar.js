const fs = require('fs');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const NODE_ID = parseInt(args[0], 10);
const COORDINATOR_IP = args[1] || '127.0.0.1';
const COORDINATOR_PORT = parseInt(args[2], 10) || 3000;
const LOG_FILE = '/root/colosseum-sniper/sniper.log';
const HEARTBEAT_INTERVAL_MS = 5000;
const LOG_SCAN_INTERVAL_MS = 1000;
const INITIAL_TAIL_BYTES = 160 * 1024;

if (!NODE_ID) {
  console.error('Usage: node sidecar.js <NODE_ID> <COORDINATOR_IP> [PORT]');
  process.exit(1);
}

console.log(`[SIDECAR] Node ${NODE_ID} -> ${COORDINATOR_IP}:${COORDINATOR_PORT}`);

let state = {
  botStatus: 'stopped',
  currentSlot: null,
  currentProxy: 0,
  proxyBans: {},
  cartItems: null,
  lastError: null,
  holdCycle: 0,
  uptimeSeconds: 0,
  extra: { mode: null, cartState: 'idle', cartUpdatedAt: null, slotUpdatedAt: null }
};

const startTime = Date.now();
let logCursor = 0;
let logInode = null;
let pendingPartial = '';

function getBotPids() {
  try {
    const output = execSync(
      `ps -eo pid=,args= | awk '/[n]ode/ && /src\\/sniper\\.js([[:space:]]|$)/ { print $1 }'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return output ? output.split('\n').map((value) => parseInt(value.trim(), 10)).filter((value) => Number.isInteger(value) && value > 0) : [];
  } catch {
    return [];
  }
}

function sendJson(path, payload) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    let settled = false;

    const tryRequest = (transport, fallbackTransport) => {
      const req = transport.request({
        hostname: COORDINATOR_IP,
        port: COORDINATOR_PORT,
        path,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: data });
        });
      });

      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (error) => {
        if (settled) return;
        if (fallbackTransport) {
          tryRequest(fallbackTransport, null);
          return;
        }
        settled = true;
        reject(error);
      });
      req.write(body);
      req.end();
    };

    tryRequest(https, http);
  });
}

function isBotRunning() {
  return getBotPids().length > 0;
}

function ensureExtra() {
  if (!state.extra || typeof state.extra !== 'object') {
    state.extra = {};
  }
  if (!Object.prototype.hasOwnProperty.call(state.extra, 'mode')) state.extra.mode = null;
  if (!Object.prototype.hasOwnProperty.call(state.extra, 'cartState')) state.extra.cartState = 'idle';
  if (!Object.prototype.hasOwnProperty.call(state.extra, 'cartUpdatedAt')) state.extra.cartUpdatedAt = null;
  if (!Object.prototype.hasOwnProperty.call(state.extra, 'slotUpdatedAt')) state.extra.slotUpdatedAt = null;
}

function markCartState(cartState) {
  ensureExtra();
  state.extra.cartState = cartState;
  state.extra.cartUpdatedAt = new Date().toISOString();
}

function setCurrentSlot(slot) {
  ensureExtra();
  state.currentSlot = slot;
  state.extra.slotUpdatedAt = new Date().toISOString();
}

function hasActiveCartState() {
  ensureExtra();
  return ['hold', 'checkout', 'carted', 'paying', 'payment'].includes(String(state.extra.cartState || '').toLowerCase());
}

function clearProxyBan(proxyId) {
  delete state.proxyBans[String(proxyId)];
  if (Object.keys(state.proxyBans).length === 0 && state.botStatus === 'banned') {
    state.botStatus = 'running';
    if (state.lastError === 'All proxies banned') state.lastError = null;
  }
}

function cleanupExpiredProxyBans(now = Date.now()) {
  for (const [proxyId, untilMs] of Object.entries(state.proxyBans || {})) {
    if (Number(untilMs) > 0 && Number(untilMs) <= now) clearProxyBan(proxyId);
  }
}

function isHealthyPollingLine(line) {
  return (
    line.includes('API Проверка слотов') ||
    line.includes('API РџСЂРѕРІРµСЂРєР° СЃР»РѕС‚РѕРІ') ||
    line.includes('Запрашиваем') ||
    line.includes('Р—Р°РїСЂР°С€РёРІР°РµРј') ||
    line.includes('[RANGE] Минимум') ||
    line.includes('[RANGE] РњРёРЅРёРј') ||
    line.includes('[RANGE] Вне окна можно взять') ||
    line.includes('[RANGE] Р’РЅРµ РѕРєРЅР° РјРѕР¶РЅРѕ') ||
    line.includes('Слот вне окна:') ||
    line.includes('РЎР»РѕС‚ РІРЅРµ РѕРєРЅР°:') ||
    line.includes('Следующий цикл через') ||
    line.includes('РЎР»РµРґСѓСЋС‰РёР№ С†РёРєР» С‡РµСЂРµР·') ||
    line.includes('За наш промежуток времени билетов нет.') ||
    line.includes('Р—Р° РЅР°С€ РїСЂРѕРјРµР¶СѓС‚РѕРє РІСЂРµРјРµРЅРё Р±РёР»РµС‚РѕРІ РЅРµС‚.')
  );
}

function isNoTicketLine(line) {
  return (
    line.includes('За наш промежуток времени билетов нет.') ||
    line.includes('Р—Р° РЅР°С€ РїСЂРѕРјРµР¶СѓС‚РѕРє РІСЂРµРјРµРЅРё Р±РёР»РµС‚РѕРІ РЅРµС‚.') ||
    line.includes('Ответ календаря пуст') ||
    line.includes('РћС‚РІРµС‚ РєР°Р»РµРЅРґР°СЂСЏ РїСѓСЃС‚') ||
    line.includes('Слотов нет') ||
    line.includes('РЎР»РѕС‚РѕРІ РЅРµС‚') ||
    line.includes('calendar response empty') ||
    line.includes('Response calendar empty')
  );
}

function markRecoveredPolling(line) {
  if (!isHealthyPollingLine(line)) return false;

  let changed = false;

  if (!hasActiveCartState()) {
    if (state.botStatus !== 'running') {
      state.botStatus = 'running';
      changed = true;
    }

    if (!state.cartItems && state.extra.cartState !== 'idle') {
      state.extra.cartState = 'idle';
      state.extra.cartUpdatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (isNoTicketLine(line) && !hasActiveCartState()) {
    if (state.currentSlot !== null) {
      state.currentSlot = null;
      state.extra.slotUpdatedAt = new Date().toISOString();
      changed = true;
    }
    if (state.cartItems !== null) {
      state.cartItems = null;
      changed = true;
    }
  }

  if (state.lastError) {
    state.lastError = null;
    changed = true;
  }

  return changed;
}

function reportState() {
  ensureExtra();
  cleanupExpiredProxyBans();
  state.uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const botPids = getBotPids();
  const running = botPids.length > 0;
  state.extra.processState = running ? 'running' : 'stopped';
  state.extra.processId = running ? botPids[botPids.length - 1] : null;

  if (!running) {
    state.botStatus = 'stopped';
    state.holdCycle = 0;
    state.cartItems = null;
    state.currentSlot = null;
    state.extra.cartState = 'inactive';
    state.extra.cartUpdatedAt = null;
    state.extra.slotUpdatedAt = null;
  } else if (!['hold', 'checkout', 'banned', 'starting'].includes(state.botStatus)) {
    state.botStatus = 'running';
    if (!state.cartItems && !['released', 'inactive'].includes(state.extra.cartState)) {
      state.extra.cartState = 'idle';
    }
  }

  void sendJson('/api/heartbeat', { nodeId: NODE_ID, ...state }).catch(() => {});
}

function parseLogLines(lines) {
  let changed = false;
  ensureExtra();

  for (const rawLine of lines) {
    const line = String(rawLine || '').trimEnd();
    if (!line.trim()) continue;

    if (markRecoveredPolling(line)) {
      changed = true;
    }

    if (line.includes('\u0420\u0435\u0436\u0438\u043c \u043d\u043e\u0434\u044b:')) {
      state.extra = { ...state.extra, mode: line.split(':').pop().trim().toLowerCase() };
      changed = true;
    }

    const hotReload = line.match(/\[HOT RELOAD\] version=(\d+) reason=([a-z]+) mode=([a-z_]+) hold=(?:on|off) window=(.+)$/i);
    if (hotReload) {
      ensureExtra();
      state.extra.configVersion = parseInt(hotReload[1], 10);
      state.extra.runtimeMode = hotReload[3].trim().toLowerCase();
      state.extra.runtimeWindow = hotReload[4].trim();
      if (!state.extra.mode) state.extra.mode = state.extra.runtimeMode;
      changed = true;
    }

    if (line.includes('\u0414\u041e\u0411\u0410\u0412\u041b\u0415\u041d\u042b \u0412 \u041a\u041e\u0420\u0417\u0418\u041d\u0423:')) {
      const idx = line.indexOf(':');
      if (idx >= 0) {
        state.cartItems = line.slice(idx + 1).trim();
        markCartState(state.botStatus === 'checkout' ? 'checkout' : 'hold');
        changed = true;
      }
    }

    if (line.includes('Cart item saved:')) {
      const idx = line.indexOf(':');
      if (idx >= 0) {
        state.cartItems = line.slice(idx + 1).trim();
        markCartState(state.botStatus === 'checkout' ? 'checkout' : 'hold');
        changed = true;
      }
    }

    if (line.includes('[HOLD] cart_alive')) {
      const adults = parseInt(line.match(/\badults=(\d+)/i)?.[1] || '0', 10) || 0;
      const children = parseInt(line.match(/\bchildren=(\d+)/i)?.[1] || '0', 10) || 0;
      const guide = parseInt(line.match(/\bguide=(\d+)/i)?.[1] || '1', 10) || 1;
      const total = parseInt(line.match(/\btotal=(\d+)/i)?.[1] || String(adults + children + guide), 10) || (adults + children + guide);
      state.cartItems = `${adults} Intero + ${children} Under18 + ${guide} Guide (total ${total})`;
      state.botStatus = 'hold';
      markCartState('hold');
      changed = true;
    }

    if (line.includes('[HOLD] cart_released')) {
      state.cartItems = null;
      state.currentSlot = null;
      state.holdCycle = 0;
      state.botStatus = 'running';
      markCartState('released');
      changed = true;
    }

    if (line.includes('\u0411\u0418\u041b\u0415\u0422\u042b \u0423\u0421\u041f\u0415\u0428\u041d\u041e \u0414\u041e\u0411\u0410\u0412\u041b\u0415\u041d\u042b \u0412 \u041a\u041e\u0420\u0417\u0418\u041d\u0423') || line.includes('\u0420\u0415\u0410\u041b\u042c\u041d\u042b\u0419 \u0423\u0421\u041f\u0415\u0425')) {
      state.botStatus = 'hold';
      markCartState('hold');
      changed = true;
    }

    let m = line.match(/HOLD \u0446\u0438\u043a\u043b #(\d+)/);
    if (m) {
      state.holdCycle = parseInt(m[1], 10);
      state.botStatus = 'hold';
      markCartState('hold');
      changed = true;
    }

    m = line.match(/RE-CATCH #(\d+) \u0423\u0421\u041f\u0415\u0425/);
    if (m) {
      state.holdCycle = parseInt(m[1], 10);
      state.botStatus = 'hold';
      markCartState('hold');
      changed = true;
    }

    m = line.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)/);
    if (m && (line.includes('\u041b\u0443\u0447\u0448\u0438\u0439:') || line.includes('\u0412\u044b\u0431\u0438\u0440\u0430\u044e') || line.includes('HOLD') || line.includes('heartbeat') || line.includes('\u043a\u043e\u0440\u0437\u0438\u043d'))) {
      setCurrentSlot(m[1]);
      changed = true;
    }

    if (line.includes('\u0421\u041c\u0415\u041d\u0410 \u041f\u0420\u041e\u041a\u0421\u0418') && line.includes('\u2192')) {
      const pm = line.match(/#\d+\s*\u2192\s*#(\d+)/);
      if (pm) {
        state.currentProxy = parseInt(pm[1], 10);
        changed = true;
      }
    }

    if (line.includes('\u041f\u0440\u043e\u043a\u0441\u0438:')) {
      const pm = line.match(/#(\d+)\//);
      if (pm) {
        state.currentProxy = parseInt(pm[1], 10);
        changed = true;
      }
    }

    if ((line.includes('\u041f\u0440\u043e\u043a\u0441\u0438 #') && line.includes('\u0437\u0430\u0431\u0430\u043d\u0435\u043d')) || (line.includes('WAF 403') && line.includes('\u041f\u0440\u043e\u043a\u0441\u0438 #'))) {
      const pm = line.match(/#(\d+)/);
      if (pm) {
        state.proxyBans[pm[1]] = Date.now() + 2 * 3600 * 1000;
        changed = true;
      }
    }

    if (line.includes('\u0411\u0430\u043d \u043f\u0440\u043e\u043a\u0441\u0438 #') && (line.includes('\u0421\u041b\u0415\u0422\u0415\u041b') || line.includes('\u0438\u0441\u0442\u0435\u043a'))) {
      const pm = line.match(/#(\d+)/);
      if (pm) {
        clearProxyBan(pm[1]);
        changed = true;
      }
    }

    const proxyBanClear = line.match(/\[PROXY BAN\]\s+(?:proxy|expired proxy)\s+#(\d+).*?(?:unbanned|cleared)/i);
    if (proxyBanClear) {
      clearProxyBan(proxyBanClear[1]);
      changed = true;
    }

    if (
      line.includes('\u0427\u0438\u0441\u0442\u044b\u0439 Chrome \u0437\u0430\u043f\u0443\u0449\u0435\u043d') ||
      line.includes('Hold Mode \u0412\u042b\u041a\u041b\u042e\u0427\u0415\u041d') ||
      line.includes('/pay \u043f\u043e\u043b\u0443\u0447\u0435\u043d') ||
      line.includes('\u041f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u043c \u043a \u043e\u043f\u043b\u0430\u0442\u0435') ||
      line.includes('[PAYMENT] cart_modified') ||
      line.includes('[PAYMENT] checkout_ready') ||
      line.includes('[PAYMENT] checkout_controlled_started') ||
      line.includes('[PAYMENT] checkout_controlled_ready')
    ) {
      state.botStatus = 'checkout';
      markCartState('checkout');
      changed = true;
    }

    if (line.includes('Re-catch \u043d\u0435 \u0443\u0434\u0430\u043b\u0441\u044f')) {
      state.cartItems = null;
      state.currentSlot = null;
      state.holdCycle = 0;
      state.botStatus = 'running';
      markCartState('released');
      changed = true;
    }

    if (line.includes('\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u041e\u0448\u0438\u0431\u043a\u0430:')) {
      const idx = line.indexOf(':');
      if (idx >= 0) {
        state.lastError = line.slice(idx + 1).trim().substring(0, 120);
        changed = true;
      }
    }

    if (line.includes('WAF BLOCK')) {
      state.lastError = 'WAF block';
      changed = true;
    }

    if (line.includes('Failed to launch the browser process')) {
      state.lastError = 'Failed to launch the browser process';
      changed = true;
    }

    if (line.includes('Missing X server') || line.includes('$DISPLAY')) {
      state.lastError = 'Missing X server / $DISPLAY';
      changed = true;
    }

    if (
      (line.includes('\u0412\u0441\u0435 ') && line.includes('\u043f\u0440\u043e\u043a\u0441\u0438 \u0437\u0430\u0431\u0430\u043d\u0435\u043d\u044b')) ||
      /\[PROXY BAN\].*all proxies banned/i.test(line)
    ) {
      state.botStatus = 'banned';
      state.lastError = 'All proxies banned';
      changed = true;
    }
  }

  return changed;
}

function readLogDelta() {
  if (!fs.existsSync(LOG_FILE)) {
    return { lines: [], cursor: logCursor, truncated: false };
  }

  const stat = fs.statSync(LOG_FILE);
  const inode = stat.ino || `${stat.dev}:${stat.size}`;
  let start = logCursor;
  let truncated = false;
  const initialRead = logInode === null;

  if (logInode !== inode || stat.size < logCursor) {
    logInode = inode;
    truncated = true;
    pendingPartial = '';
    start = Math.max(0, stat.size - INITIAL_TAIL_BYTES);
  }

  if (stat.size <= start) {
    logCursor = stat.size;
    return { lines: [], cursor: logCursor, truncated };
  }

  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(LOG_FILE, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  logCursor = stat.size;
  const text = pendingPartial + buffer.toString('utf8');
  const chunks = text.split('\n');
  pendingPartial = chunks.pop() || '';

  return {
    lines: chunks.map((line) => line.replace(/\r$/, '')),
    cursor: logCursor,
    truncated,
    initialRead
  };
}

function sendLogDelta(lines, cursor, truncated) {
  if ((!Array.isArray(lines) || lines.length === 0) && !truncated) return;
  void sendJson('/api/telemetry/logs', {
    nodeId: NODE_ID,
    cursor,
    truncated,
    source: 'sidecar',
    lines
  }).catch(() => {});
}

function scanLog() {
  try {
    const delta = readLogDelta();
    if (delta.lines.length === 0) {
      if (delta.truncated) sendLogDelta([], delta.cursor, true);
      return;
    }
    if (parseLogLines(delta.lines)) reportState();
    // On sidecar restart the first read is a historical tail. Parse it for state,
    // but do not publish old HOLD/cart lines as fresh realtime evidence.
    sendLogDelta(delta.initialRead || delta.truncated ? [] : delta.lines, delta.cursor, delta.truncated);
  } catch (e) {
    console.error(`[SIDECAR] log scan failed: ${e.message}`);
  }
}

reportState();
scanLog();
setInterval(reportState, HEARTBEAT_INTERVAL_MS);
setInterval(scanLog, LOG_SCAN_INTERVAL_MS);
