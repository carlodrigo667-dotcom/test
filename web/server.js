/**
 * Ticket Sniper Control Center — Main Server
 *
 * Express + Socket.IO + SQLite
 * Runs on server 12 (coordinator) — HTTPS with self-signed cert
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function loadEnvFileIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[ENV] failed to load ${filePath}: ${error.message}`);
  }
}

loadEnvFileIfPresent(path.join(__dirname, '..', '.env'));
loadEnvFileIfPresent(path.join(__dirname, '.env'));

const db = require('./db');
const ssh = require('./ssh');
const vnc = require('./vnc');
const telemetry = require('./telemetry');
const { createNodeStateReconciler } = require('./node-state');
const { createIssueTracker, isActionableErrorText, sanitizeHeartbeatLastError } = require('./issues');
const {
  PROJECT_ROOT,
  CONFIG_PATH,
  loadConfig,
  saveConfig,
  loadIps,
  enrichNodesWithMode,
  getEffectiveNodeConfig
} = require('./config-store');
const {
  buildDistributionPreview,
  buildProxyOverview,
  applyDistributedProxies
} = require('./proxy-service');
const proxyLeaseStore = require('./proxy-lease-store');
const { createTelegramControlBot } = require('./telegram-control-bot');

const PORT = process.env.PORT || 3000;
const RUNTIME_AUTH_PATH = path.join(__dirname, 'data', 'runtime-auth.json');
const SESSION_STORE_PATH = path.join(__dirname, 'data', 'sessions.json');
const CLIENT_DIST_DIR = path.join(__dirname, 'dist', 'client');
const LEGACY_PUBLIC_DIR = path.join(__dirname, 'public');
const HAS_CLIENT_DIST = fs.existsSync(path.join(CLIENT_DIST_DIR, 'index.html'));
const clientStaticDir = HAS_CLIENT_DIST ? CLIENT_DIST_DIR : LEGACY_PUBLIC_DIR;
const MIN_PAYMENT_ADULTS = 0;
const MIN_PAYMENT_PARTICIPANTS = 8;
const PAYMENT_PASSENGER_AUTOFILL_ENABLED = false;

function loadRuntimeAuthConfig() {
  const fromEnv = {
    password: process.env.AUTH_PASSWORD || null,
    sessionSecret: process.env.SESSION_SECRET || null
  };

  if (fromEnv.password && fromEnv.sessionSecret) {
    return fromEnv;
  }

  try {
    if (fs.existsSync(RUNTIME_AUTH_PATH)) {
      const persisted = JSON.parse(fs.readFileSync(RUNTIME_AUTH_PATH, 'utf8'));
      return {
        password: fromEnv.password || persisted.password,
        sessionSecret: fromEnv.sessionSecret || persisted.sessionSecret
      };
    }
  } catch {}

  const generated = {
    password: fromEnv.password || crypto.randomBytes(12).toString('base64url'),
    sessionSecret: fromEnv.sessionSecret || crypto.randomBytes(24).toString('base64url')
  };

  try {
    fs.mkdirSync(path.dirname(RUNTIME_AUTH_PATH), { recursive: true });
    fs.writeFileSync(RUNTIME_AUTH_PATH, JSON.stringify(generated, null, 2), 'utf8');
  } catch {}

  return generated;
}

const runtimeAuth = loadRuntimeAuthConfig();
const AUTH_PASSWORD = runtimeAuth.password;
const SESSION_SECRET = runtimeAuth.sessionSecret;

class FileSessionStore extends session.Store {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.sessions = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const sessions = parsed?.sessions && typeof parsed.sessions === 'object'
        ? parsed.sessions
        : parsed;
      this.sessions = new Map(Object.entries(sessions || {}));
      this.cleanupExpired(false);
    } catch (error) {
      console.warn(`[SESSION] failed to load persistent sessions: ${error.message}`);
      this.sessions = new Map();
    }
  }

  getExpiryMs(sess) {
    const expires = sess?.cookie?.expires || sess?.cookie?._expires;
    if (!expires) return 0;
    const ts = new Date(expires).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  cleanupExpired(persist = true) {
    const now = Date.now();
    let changed = false;
    for (const [sid, sess] of this.sessions.entries()) {
      const expiresAt = this.getExpiryMs(sess);
      if (expiresAt && expiresAt <= now) {
        this.sessions.delete(sid);
        changed = true;
      }
    }
    if (changed && persist) this.persist();
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const payload = JSON.stringify({
        savedAt: new Date().toISOString(),
        sessions: Object.fromEntries(this.sessions)
      }, null, 2);
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, payload, 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (error) {
      console.warn(`[SESSION] failed to persist sessions: ${error.message}`);
    }
  }

  get(sid, cb) {
    try {
      const sess = this.sessions.get(sid);
      const expiresAt = this.getExpiryMs(sess);
      if (expiresAt && expiresAt <= Date.now()) {
        this.sessions.delete(sid);
        this.persist();
        return cb(null, null);
      }
      return cb(null, sess || null);
    } catch (error) {
      return cb(error);
    }
  }

  set(sid, sess, cb = () => {}) {
    this.sessions.set(sid, sess);
    this.cleanupExpired(false);
    this.persist();
    cb(null);
  }

  destroy(sid, cb = () => {}) {
    this.sessions.delete(sid);
    this.persist();
    cb(null);
  }

  touch(sid, sess, cb = () => {}) {
    const current = this.sessions.get(sid) || sess;
    if (current) {
      current.cookie = sess.cookie;
      this.sessions.set(sid, current);
      this.persist();
    }
    cb(null);
  }
}

db.init();
const stateReconciler = createNodeStateReconciler({ db, telemetry });

const IPS = loadIps();
console.log(`[INIT] Loaded ${IPS.length} node IPs from ips.txt`);

for (let i = 0; i < IPS.length; i += 1) {
  db.upsertNode(i + 1, IPS[i]);
}

const app = express();

let server;
const certDir = path.join(__dirname, 'certs');
const certPath = path.join(certDir, 'cert.pem');
const keyPath = path.join(certDir, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  server = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  }, app);
  console.log('[INIT] HTTPS enabled (self-signed)');
} else {
  server = http.createServer(app);
  console.log('[INIT] HTTP mode (no certs found in web/certs/)');
}

const io = new Server(server, { cors: { origin: '*' } });
let issueTracker = null;
const OVERVIEW_BROADCAST_MIN_MS = 2000;
const ISSUE_REFRESH_MIN_MS = 10000;
const LOG_STREAM_STALE_MS = 25000;
const LOG_SNAPSHOT_SEED_COOLDOWN_MS = 20000;
const LOG_SNAPSHOT_SEED_TIMEOUT_MS = 2500;
let lastOverviewBroadcastAt = 0;
let overviewBroadcastTimer = null;
let lastIssueRefreshAt = 0;
let issueRefreshTimer = null;
const logSnapshotSeedState = new Map();
let telegramControlBot = null;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  store: new FileSessionStore(SESSION_STORE_PATH),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

if (HAS_CLIENT_DIST) {
  app.use(express.static(CLIENT_DIST_DIR, {
    setHeaders(res, filePath) {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store');
        return;
      }

      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
} else {
  console.warn(`[INIT] Client build missing in ${CLIENT_DIST_DIR}. Legacy UI at ${LEGACY_PUBLIC_DIR} kept only as archive/reference and is not served.`);
}

if (vnc.isNoVNCInstalled()) {
  app.use('/novnc', express.static(vnc.NOVNC_PATH));
  console.log('[INIT] noVNC static files served at /novnc/');
} else {
  console.log('[INIT] noVNC not installed — run: pip3 install websockify && git clone https://github.com/novnc/noVNC /root/noVNC');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function getNodeTargets(nodeIds) {
  const allNodes = db.getAllNodes();
  return nodeIds && nodeIds.length > 0
    ? allNodes.filter(node => nodeIds.includes(node.id))
    : allNodes;
}

function getConfigSafe() {
  return loadConfig();
}

function getNodesWithModeSafe() {
  try {
    return enrichNodesWithMode(db.getAllNodes(), getConfigSafe());
  } catch {
    return db.getAllNodes();
  }
}

function enrichSingleNodeSafe(node) {
  try {
    return enrichNodesWithMode([node], getConfigSafe())[0] || node;
  } catch {
    return node;
  }
}

function parseNodeExtra(node) {
  try {
    if (node?.extra && typeof node.extra === 'object') return node.extra;
    return JSON.parse(node?.extra || '{}');
  } catch {
    return {};
  }
}

function getNodeEffectiveMode(node) {
  const extra = parseNodeExtra(node);
  return String(
    node?.displayMode
    || node?.derivedState?.runtimeMode
    || node?.derivedState?.expectedMode
    || extra.runtimeMode
    || extra.mode
    || extra.expectedMode
    || 'group'
  ).toLowerCase();
}

function getNodeTicketSearchMode(node) {
  const extra = parseNodeExtra(node);
  return String(
    extra.ticketSearchMode
    || extra.ticket_search_mode
    || extra.runtimeTicketSearchMode
    || extra.expectedTicketSearchMode
    || 'dynamic'
  ).toLowerCase() === 'concrete' ? 'concrete' : 'dynamic';
}

function getNodeCartState(node) {
  const derivedState = String(node?.derivedState?.cartState || '').toLowerCase().trim();
  if (derivedState) return derivedState;
  const extra = parseNodeExtra(node);
  if (extra?.cartState) return String(extra.cartState).toLowerCase();
  if (node?.cart_items && node.cart_items !== 'null') return 'carted';
  return null;
}

function parseTicketQuantityFromText(text, labelPatterns) {
  const source = String(text || '');
  if (!source.trim()) return 0;

  for (const pattern of labelPatterns) {
    const qtyBefore = new RegExp(`(\\d+)\\s*x\\s*[^,;\\n]*${pattern}`, 'i');
    const beforeMatch = source.match(qtyBefore);
    if (beforeMatch) return parseInt(beforeMatch[1], 10) || 0;

    const labelThenQty = new RegExp(`${pattern}[^,;\\n]{0,80}?(?:qty|quantity)["']?\\s*[:=]\\s*(\\d+)`, 'i');
    const labelMatch = source.match(labelThenQty);
    if (labelMatch) return parseInt(labelMatch[1], 10) || 0;
  }

  return 0;
}

function parsePaymentCountsFromText(text) {
  const lines = String(text || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!/\[PAYMENT\]\s+(cart_modified|checkout_ready)\b/i.test(line)) continue;
    const adults = parseInt(line.match(/\badults=(\d+)/i)?.[1] || '0', 10) || 0;
    const children = parseInt(line.match(/\bchildren=(\d+)/i)?.[1] || '0', 10) || 0;
    const guideMatch = line.match(/\bguide=(\d+)/i);
    const guide = guideMatch ? Math.max(0, parseInt(guideMatch[1] || '0', 10) || 0) : 1;
    if (adults || children) return { adults, children, guide };
  }
  return null;
}

function buildPaymentCartState(node) {
  const extra = parseNodeExtra(node);
  const mode = getNodeEffectiveMode(node);
  const ticketSearchMode = getNodeTicketSearchMode(node);
  const defaultGuideCount = mode === 'individual' ? 0 : 1;
  const cartText = [
    node?.cart_items,
    extra?.cartItems,
    extra?.cart_items,
    extra?.lastCartItems,
    node?.derivedState?.lastEvidence,
    node?.last_error
  ].filter(Boolean).join('\n');

  const paymentCounts = parsePaymentCountsFromText(cartText);
  const explicitAdults = paymentCounts?.adults ?? parseTicketQuantityFromText(cartText, ['intero']);
  const explicitChildren = paymentCounts?.children ?? parseTicketQuantityFromText(cartText, ['under\\s*18', 'ridotto', 'child']);
  const explicitGuide = paymentCounts?.guide ?? parseTicketQuantityFromText(cartText, ['guide']);
  const derivedTicketCount = Number(node?.derivedState?.ticketCount || 0) || 0;
  const rawDerivedGuide = node?.derivedState?.guideCount;
  const derivedGuide = rawDerivedGuide === null || rawDerivedGuide === undefined ? NaN : Number(rawDerivedGuide);
  const guideCount = Number.isFinite(derivedGuide)
    ? Math.max(0, derivedGuide)
    : (explicitGuide > 0 ? explicitGuide : defaultGuideCount);
  const fallbackAdults = derivedTicketCount > guideCount ? Math.max(0, derivedTicketCount - guideCount - explicitChildren) : 0;
  const caughtAdults = Number(node?.derivedState?.cartAdults || 0) || explicitAdults || Number(extra?.caughtAdults || 0) || fallbackAdults;
  const caughtChildren = Number(node?.derivedState?.cartChildren || 0) || explicitChildren || Number(extra?.caughtChildren || 0) || 0;
  const caughtNonGuide = caughtAdults + caughtChildren;

  return {
    caughtAdults,
    caughtChildren,
    caughtNonGuide,
    guideCount,
    totalTickets: caughtNonGuide + guideCount,
    mode,
    ticketSearchMode,
    slot: node?.derivedState?.slot || node?.current_slot || null,
    confidence: node?.derivedState?.confidence || null,
    source: paymentCounts ? 'payment_marker' : ((explicitAdults || explicitChildren) ? 'cart_items' : (derivedTicketCount ? 'derived_state' : 'unknown'))
  };
}

function normalizePassengerEntry(entry, type) {
  if (!entry || typeof entry !== 'object') return null;
  const firstName = String(entry.firstName || '').trim();
  const lastName = String(entry.lastName || '').trim();
  if (!firstName || !lastName) return null;
  return { firstName, lastName, type };
}

function normalizePaymentPassengerPayload(body, adults, children) {
  if (!PAYMENT_PASSENGER_AUTOFILL_ENABLED) {
    return { participants: [], guide: null };
  }

  const inputParticipants = Array.isArray(body?.participants) ? body.participants : [];
  const adultParticipants = inputParticipants
    .filter((entry) => String(entry?.type || 'adult').toLowerCase() === 'adult')
    .map((entry) => normalizePassengerEntry(entry, 'adult'))
    .filter(Boolean)
    .slice(0, adults);
  const childParticipants = inputParticipants
    .filter((entry) => String(entry?.type || '').toLowerCase() === 'child')
    .map((entry) => normalizePassengerEntry(entry, 'child'))
    .filter(Boolean)
    .slice(0, children);
  const guideSource = body?.guideDetails || body?.guide || {};
  const guide = normalizePassengerEntry({ ...guideSource, type: 'guide' }, 'guide');
  if (guide) {
    guide.licenseNumber = String(guideSource.licenseNumber || guideSource.license || guideSource.cardNumber || '').trim();
  }

  return {
    participants: [...adultParticipants, ...childParticipants],
    guide
  };
}

function normalizePaymentRequestBody(body, caught = null) {
  const adults = Number(body?.adults ?? 0);
  const children = Number(body?.children ?? 0);
  const mode = String(caught?.mode || 'group').toLowerCase();
  const expectedGuide = Math.max(0, Number(caught?.guideCount ?? (mode === 'individual' ? 0 : 1)) || 0);
  const guide = Number(body?.guide ?? expectedGuide);
  const checkoutOnly = Boolean(body?.checkoutOnly || body?.skipCartModification || body?.directCheckout);

  if (!Number.isInteger(adults) || adults < MIN_PAYMENT_ADULTS) {
    return { error: `Adults must be an integer from ${MIN_PAYMENT_ADULTS}.` };
  }

  if (!Number.isInteger(children) || children < 0) {
    return { error: 'Children must be an integer from 0.' };
  }

  if (!Number.isInteger(guide) || guide !== expectedGuide) {
    return { error: `Guide count must be ${expectedGuide} for this cart.` };
  }

  const caughtNonGuide = caught ? Number(caught.caughtNonGuide ?? ((caught.caughtAdults || 0) + (caught.caughtChildren || 0))) || 0 : 0;
  const caughtAdults = caught ? Number(caught.caughtAdults || 0) || 0 : 0;
  const caughtChildren = caught ? Number(caught.caughtChildren || 0) || 0 : 0;
  const exactCaughtRequest = Boolean(caught && adults === caughtAdults && children === caughtChildren);
  const minParticipants = mode === 'individual' ? 1 : MIN_PAYMENT_PARTICIPANTS;

  if (!checkoutOnly && adults + children < minParticipants) {
    const guideSuffix = expectedGuide > 0 ? ` including ${expectedGuide} guide` : '';
    return { error: `Minimum for payment: ${minParticipants + expectedGuide} tickets total${guideSuffix}.` };
  }

  if (caught && caughtNonGuide <= 0) {
    return { error: 'Could not confirm editable caught ticket count from cart state.' };
  }

  if (checkoutOnly && !exactCaughtRequest) {
    return { error: 'Checkout-only payment is allowed only when the requested tickets exactly match the caught cart.' };
  }

  if (caught && adults + children > caughtNonGuide) {
    return { error: `Requested ${adults + children} tickets, but only ${caughtNonGuide} caught non-guide slots are editable.` };
  }

  return {
    value: {
      adults,
      children,
      guide: expectedGuide,
      checkoutOnly,
      source: body?.source || 'web',
      requestedAt: new Date().toISOString()
    }
  };

  if (!Number.isInteger(children) || children < 0) {
    return { error: 'Количество детских билетов должно быть целым числом от 0.' };
  }

  if (guide !== 1) {
    return { error: 'Гид всегда фиксирован как +1 и не редактируется.' };
  }

  const passengerPayload = normalizePaymentPassengerPayload(body, adults, children);

  return {
    value: {
      adults,
      children,
      guide: 1,
      participants: passengerPayload.participants,
      guideDetails: passengerPayload.guide,
      source: body?.source || 'web',
      requestedAt: new Date().toISOString()
    }
  };
}

async function triggerPayOnNode(node, paymentRequest = null) {
  if (!paymentRequest) {
    const result = await ssh.execOnNode(node.ip, 'touch /tmp/pay_now');
    if (result.code && result.code !== 0) throw new Error(result.stderr || result.stdout || 'Failed to trigger pay');
    return result;
  }

  const encoded = Buffer.from(JSON.stringify(paymentRequest), 'utf8').toString('base64');
  const command = [
    `printf '%s' '${encoded}' | base64 -d > /tmp/pay_request.json`,
    'chmod 600 /tmp/pay_request.json'
  ].join(' && ');
  const result = await ssh.execOnNode(node.ip, command);
  if (result.code && result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to write payment request');
  }
  return result;
}

const NOISE_PRIMARY_CODES = new Set(['state_mismatch', 'stale_log', 'calendar_empty']);

function normalizeIssueRow(row) {
  if (!row) return row;

  const issues = Array.isArray(row.issues) ? row.issues : [];
  const issueCodes = Array.isArray(row.issueCodes) && row.issueCodes.length
    ? row.issueCodes
    : issues.map((issue) => issue.code);
  const noiseIssues = Array.isArray(row.noiseIssues) && row.noiseIssues.length
    ? row.noiseIssues
    : issues.filter((issue) => NOISE_PRIMARY_CODES.has(issue.code));
  const operatorIssues = issues.filter((issue) => !NOISE_PRIMARY_CODES.has(issue.code));
  const primaryNoiseIssue = row.primaryNoiseIssue || noiseIssues[0] || null;

  let primaryIssue = row.primaryIssue || operatorIssues[0] || null;
  if (primaryIssue && NOISE_PRIMARY_CODES.has(primaryIssue.code)) {
    primaryIssue = operatorIssues[0] || null;
  }

  return {
    ...row,
    issueCodes,
    issues,
    noiseIssues,
    primaryIssue,
    primaryNoiseIssue
  };
}

function aggregateNormalizedIssueGroups(rows, issueKey) {
  const groupsByCode = new Map();
  const counts = {};

  rows
    .filter((row) => row?.[issueKey])
    .forEach((row) => {
      const issue = row[issueKey];
      if (!groupsByCode.has(issue.code)) {
        groupsByCode.set(issue.code, {
          code: issue.code,
          label: issue.label,
          severity: issue.severity,
          count: 0,
          updatedAt: row.updatedAt || issue.updatedAt || new Date().toISOString(),
          lastEvidence: issue.evidence,
          nodes: []
        });
      }

      const group = groupsByCode.get(issue.code);
      group.count += 1;
      group.lastEvidence = issue.evidence || group.lastEvidence;
      group.updatedAt = row.updatedAt || issue.updatedAt || group.updatedAt;
      group.nodes.push({
        nodeId: row.nodeId,
        ip: row.ip,
        status: row.status,
        botStatus: row.botStatus,
        displayMode: row.displayMode,
        currentSlot: row.currentSlot,
        cartState: row.cartState,
        confidence: row.confidence,
        mismatchFlags: row.mismatchFlags,
        heartbeatAgeSec: row.heartbeatAgeSec,
        summary: issue.summary,
        evidence: issue.evidence,
        updatedAt: row.updatedAt || issue.updatedAt || group.updatedAt
      });
      counts[issue.code] = group.count;
    });

  return {
    groups: Array.from(groupsByCode.values()),
    counts
  };
}

function normalizeIssueOverview(overview) {
  const safeOverview = overview || {};
  const rows = Array.isArray(safeOverview.nodes)
    ? safeOverview.nodes.map((row) => normalizeIssueRow(row))
    : [];
  const operatorGroups = aggregateNormalizedIssueGroups(rows, 'primaryIssue');
  const noiseGroups = aggregateNormalizedIssueGroups(rows, 'primaryNoiseIssue');

  return {
    ...safeOverview,
    updatedAt: safeOverview.updatedAt || null,
    nodes: rows,
    groups: operatorGroups.groups,
    noiseGroups: noiseGroups.groups,
    problemCounts: operatorGroups.counts,
    diagnosticNoiseCounts: noiseGroups.counts
  };
}

function hasActiveCart(node) {
  return ['carted', 'hold', 'checkout', 'payment', 'paying'].includes(getNodeCartState(node) || '');
}

const NON_ACTIONABLE_CART_FLAGS = new Set([
  'heartbeat_only_active_cart',
  'logs_do_not_confirm_active_cart',
  'heartbeat_active_after_release',
  'heartbeat_cart_stale',
  'slot_without_confirmed_cart',
  'checkout_not_confirmed'
]);
const PAYABLE_CART_FRESH_MS = 6 * 60 * 1000;
const PAYABLE_CHECKOUT_FRESH_MS = 30 * 60 * 1000;
const CART_RECATCH_LEAD_MS = 14 * 60 * 1000;
const CART_RELEASE_WINDOW_MS = 15 * 60 * 1000;
const STALE_HEARTBEAT_SEC = 120;

function hasCartRealityMismatch(derived) {
  return (derived?.mismatchFlags || []).some((flag) => NON_ACTIONABLE_CART_FLAGS.has(flag));
}

function isPayableCartState(derived, cartState) {
  const normalizedCartState = String(cartState || '').toLowerCase();
  if (!['carted', 'hold', 'checkout', 'payment', 'paying'].includes(normalizedCartState)) {
    return false;
  }
  if (!derived?.slot) return false;
  if (['candidate', 'released', 'idle'].includes(String(derived?.slotState || '').toLowerCase())) {
    return false;
  }
  if (String(derived?.source || '').toLowerCase() === 'heartbeat') {
    return false;
  }
  if (hasCartRealityMismatch(derived)) {
    return false;
  }
  if (Number(derived?.ticketCount || 0) <= 0) return false;

  const evidenceMs = Date.parse(derived?.evidenceAt || '');
  if (!Number.isFinite(evidenceMs)) return false;
  const maxAgeMs = ['checkout', 'payment', 'paying'].includes(normalizedCartState)
    ? PAYABLE_CHECKOUT_FRESH_MS
    : PAYABLE_CART_FRESH_MS;
  return Date.now() - evidenceMs <= maxAgeMs;
}

function toIsoOrNull(value) {
  const parsed = parseDbUtc(value);
  return parsed ? parsed.toISOString() : null;
}

function buildCartTiming(node, cartState) {
  if (!['carted', 'hold', 'checkout', 'payment', 'paying'].includes(String(cartState || '').toLowerCase())) {
    return {
      cartUpdatedAt: null,
      cartAgeSec: null,
      recatchAt: null,
      recatchInSec: null,
      releaseAt: null,
      releaseInSec: null
    };
  }

  const extra = parseNodeExtra(node);
  const sourceAt = extra.cartUpdatedAt
    || node?.derivedState?.cartUpdatedAt
    || node?.derivedState?.evidenceAt
    || node?.operatorState?.cartUpdatedAt
    || null;
  const cartUpdated = parseDbUtc(sourceAt);
  if (!cartUpdated) {
    return {
      cartUpdatedAt: null,
      cartAgeSec: null,
      recatchAt: null,
      recatchInSec: null,
      releaseAt: null,
      releaseInSec: null
    };
  }

  const nowMs = Date.now();
  const cartUpdatedMs = cartUpdated.getTime();
  const recatchMs = cartUpdatedMs + CART_RECATCH_LEAD_MS;
  const releaseMs = cartUpdatedMs + CART_RELEASE_WINDOW_MS;

  return {
    cartUpdatedAt: cartUpdated.toISOString(),
    cartAgeSec: Math.max(0, Math.floor((nowMs - cartUpdatedMs) / 1000)),
    recatchAt: new Date(recatchMs).toISOString(),
    recatchInSec: Math.floor((recatchMs - nowMs) / 1000),
    releaseAt: new Date(releaseMs).toISOString(),
    releaseInSec: Math.floor((releaseMs - nowMs) / 1000)
  };
}

function classifyOperatorHealth(node, issueRow, cartState, actionable) {
  const normalizedCartState = String(cartState || '').toLowerCase();
  const botStatus = String(node?.bot_status || '').toLowerCase();
  const heartbeatAgeSec = Number(node?.heartbeatAgeSec ?? 0);

  if (node?.status !== 'online') return 'offline';
  if (Number.isFinite(heartbeatAgeSec) && heartbeatAgeSec > STALE_HEARTBEAT_SEC) return 'stale';
  if (['checkout', 'payment', 'paying'].includes(normalizedCartState) && actionable) return 'checkout';
  if (['hold', 'carted'].includes(normalizedCartState) && actionable) return 'hold';
  if (issueRow?.primaryIssue || node?.primaryIssue) return 'problem';
  if (['checkout', 'payment', 'paying', 'hold', 'carted'].includes(normalizedCartState)) return 'unconfirmed';
  if (botStatus === 'stopped') return 'stopped';
  if (botStatus === 'running') return 'running';
  return 'idle';
}

function getCachedIssueMap() {
  const cached = normalizeIssueOverview(issueTracker?.getCachedOverview?.() || {});
  return new Map((cached.nodes || []).map((row) => [row.nodeId, row]));
}

function buildOperatorState(node, issueRow) {
  const derived = node?.derivedState || {};
  const noiseIssues = issueRow?.noiseIssues || [];
  const cartState = derived.cartState || getNodeCartState(node) || 'idle';
  const actionable = isPayableCartState(derived, cartState);
  const timing = buildCartTiming(node, cartState);
  const health = classifyOperatorHealth(node, issueRow, cartState, actionable);

  return {
    cartState,
    ticketCount: Number(derived.ticketCount || 0) || 0,
    slot: derived.slot || node.current_slot || null,
    slotState: derived.slotState || null,
    confidence: derived.confidence || 'medium',
    source: derived.source || 'heartbeat',
    evidenceAt: derived.evidenceAt || node.last_heartbeat || null,
    runtimeConfirmed: Boolean(derived.runtimeConfirmed),
    actionable,
    trust: actionable ? 'confirmed' : (hasActiveCart(node) ? 'diagnostic' : 'idle'),
    health,
    heartbeatAgeSec: node?.heartbeatAgeSec ?? null,
    lastHeartbeat: toIsoOrNull(node?.last_heartbeat),
    disputed: Boolean((derived.mismatchFlags || []).length || noiseIssues.length),
    mismatchFlags: derived.mismatchFlags || [],
    ...timing
  };
}

function attachIssueState(node, issueMap = getCachedIssueMap()) {
  const issueRow = issueMap.get(node.id);
  const nextNode = {
    ...node,
    primaryIssue: issueRow?.primaryIssue || null,
    noiseIssues: issueRow?.noiseIssues || [],
    operatorState: buildOperatorState(node, issueRow)
  };
  return decorateNodeEnvelope(nextNode);
}

function getDangerousLiveNodes(targets) {
  return targets.filter((node) => {
    const operatorState = node.operatorState || {};
    return Boolean(operatorState.actionable);
  });
}

function buildOperatorSummary(nodes) {
  const summary = {
    paymentCount: 0,
    holdCount: 0,
    checkoutCount: 0,
    activeSlotCount: 0,
    mismatchCount: 0
  };
  const activeSlots = new Set();

  (nodes || []).forEach((node) => {
    const operatorState = node.operatorState || {};
    if (operatorState.actionable) {
      summary.paymentCount += 1;
      if (operatorState.cartState === 'hold') summary.holdCount += 1;
      if (operatorState.cartState === 'checkout') summary.checkoutCount += 1;
      if (operatorState.slot) activeSlots.add(operatorState.slot);
    }
    if ((operatorState.mismatchFlags || node?.derivedState?.mismatchFlags || []).length > 0) {
      summary.mismatchCount += 1;
    }
  });

  summary.activeSlotCount = activeSlots.size;
  return summary;
}

function buildGuardrailPayload(actionLabel, blockedNodes) {
  const blockedNodeIds = blockedNodes.map((node) => node.id);
  const preview = blockedNodes
    .slice(0, 8)
    .map((node) => {
      const cartState = node.operatorState?.cartState || getNodeCartState(node) || 'idle';
      const slot = node.operatorState?.slot || node.current_slot || 'без слота';
      return `NODE_${String(node.id).padStart(2, '0')} (${cartState}, ${slot})`;
    })
    .join(', ');

  return {
    code: 'LIVE_STATE_GUARD',
    blockedNodeIds,
    blockedNodes: blockedNodes.map((node) => ({
      nodeId: node.id,
      ip: node.ip,
      cartState: node.operatorState?.cartState || getNodeCartState(node) || 'idle',
      slot: node.operatorState?.slot || node.current_slot || null,
      confidence: node.operatorState?.confidence || node.derivedState?.confidence || null
    })),
    error: `Операция «${actionLabel}» заблокирована: у выбранных узлов есть живые корзины или активные слоты. ${preview}`
  };
}

function maybeBlockDangerousMassAction(req, res, actionLabel, targetNodes) {
  const force = req.body?.force === true || req.body?.allowWithActiveState === true;
  if (force || targetNodes.length <= 1) return false;

  const enrichedTargets = targetNodes.map((node) => buildNodeEnvelopeWithState(node));
  const blockedNodes = getDangerousLiveNodes(enrichedTargets);

  if (blockedNodes.length === 0) return false;
  res.status(409).json(buildGuardrailPayload(actionLabel, blockedNodes));
  return true;
}

function getNodeCapabilities(node) {
  const coordinator = isCoordinatorNode(node);
  const extra = parseNodeExtra(node);
  const headlessOnly = extra?.headless === true || extra?.supportsVnc === false || extra?.allowVnc === false;
  const graphical = !headlessOnly;
  return {
    graphical,
    headless: headlessOnly,
    supportsVnc: !headlessOnly,
    supportsRdp: !headlessOnly,
    coordinator,
    role: coordinator ? 'coordinator' : (graphical ? 'workstation-node' : 'headless-node')
  };
}

function decorateNodeEnvelope(node) {
  const actionableLastError = isActionableErrorText(node?.last_error);
  return {
    ...node,
    degraded:
      node.status !== 'online'
      || !!node.primaryIssue
      || actionableLastError
      || node?.derivedState?.cartState === 'released'
  };
}

function buildNodeEnvelope(node, options = {}) {
  const extra = parseNodeExtra(node);
  const capabilities = getNodeCapabilities(node);
  const heartbeatDate = parseDbUtc(node.last_heartbeat);
  const heartbeatAgeSec = heartbeatDate
    ? Math.max(0, Math.floor((Date.now() - heartbeatDate.getTime()) / 1000))
    : null;

  const baseEnvelope = {
    ...node,
    extra,
    capabilities,
    heartbeatAgeSec,
    displayMode: extra.runtimeMode || extra.mode || extra.expectedMode || 'group'
  };

  if (options.skipDerived) {
    return decorateNodeEnvelope({
      ...baseEnvelope,
      derivedState: options.derivedState || node.derivedState || null
    });
  }

  const derivedState = options.derivedState || stateReconciler.getNodeDerivedState(baseEnvelope, {
    logSnapshot: options.logSnapshot || telemetry.getSnapshot(node.id),
    recentEvents: options.recentEvents || db.getEvents({ nodeId: node.id, limit: 40 })
  });

  return decorateNodeEnvelope({
    ...baseEnvelope,
    derivedState
  });
}

function buildNodeEnvelopeWithState(node, options = {}) {
  if (!node) return null;
  return attachIssueState(buildNodeEnvelope(enrichSingleNodeSafe(node), options));
}

function getNodesEnvelope() {
  const baseNodes = getNodesWithModeSafe().map((node) => buildNodeEnvelope(node, { skipDerived: true }));
  return stateReconciler.attachDerivedState(baseNodes).map((node) => attachIssueState(node));
}

function buildNoVncClientUrl(req, session) {
  const host = req.hostname;
  const port = session.wsPort;
  return `/novnc/vnc.html?autoconnect=true&resize=scale&show_dot=true&host=${host}&port=${port}&encrypt=${req.secure ? 1 : 0}&path=websockify`;
}

function emitNodeUpdate(nodeId, patch = {}) {
  issueTracker?.markDirty();
  scheduleIssueRefresh();
  const node = db.getNode(nodeId);
  if (!node) {
    io.emit('node:update', { nodeId, ...patch });
    scheduleOverviewUpdate();
    return;
  }

  const envelope = buildNodeEnvelopeWithState({ ...node, ...patch });
  io.emit('node:update', envelope);
  scheduleOverviewUpdate();
}

function emitJobUpdate(jobId) {
  const job = db.getJob(jobId);
  if (!job) return;
  io.emit('job:update', {
    ...job,
    items: db.getJobItems(jobId)
  });
  scheduleOverviewUpdate(500);
}

function getOverviewPayload() {
  const nodes = getNodesEnvelope();
  const jobs = db.listJobs(12);
  const slots = stateReconciler.buildActiveSlotRegistry(nodes);
  const cachedIssues = normalizeIssueOverview(issueTracker?.getCachedOverview?.() || {
    groups: [],
    noiseGroups: [],
    problemCounts: {},
    diagnosticNoiseCounts: {},
    updatedAt: null
  });
  const sessions = Object.entries(vnc.getAllSessions()).map(([nodeId, session]) => ({
    nodeId: Number(nodeId),
    ...session
  }));
  const alerts = [];
  const summary = buildOperatorSummary(nodes);
  const activeSlotCount = summary.activeSlotCount;
  const diagnosticNoiseCount = Object.values(cachedIssues.diagnosticNoiseCounts || {}).reduce((sum, value) => sum + value, 0);

  nodes
    .filter((node) => node.primaryIssue)
    .slice(0, 20)
    .forEach((node) => {
      alerts.push({
        severity: node.primaryIssue?.severity || 'warning',
        nodeId: node.id,
        message: node.primaryIssue?.evidence || node.primaryIssue?.summary || node.last_error || ''
      });
    });

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    jobs,
    slots,
    sessions,
    paymentCount: summary.paymentCount,
    holdCount: summary.holdCount,
    checkoutCount: summary.checkoutCount,
    activeSlotCount,
    mismatchCount: summary.mismatchCount,
    problemCounts: cachedIssues.problemCounts || {},
    diagnosticNoiseCount,
    diagnosticNoiseCounts: cachedIssues.diagnosticNoiseCounts || {},
    topProblems: (cachedIssues.groups || []).slice(0, 4).map((group) => ({
      ...group,
      nodes: (group.nodes || []).slice(0, 6)
    })),
    issuesUpdatedAt: cachedIssues.updatedAt || null,
    alerts: alerts.slice(0, 20),
    events: db.getEvents({ limit: 25 })
  };
}

function buildMetricSnapshot(overview) {
  const nodes = overview?.nodes || [];
  const jobs = overview?.jobs || [];
  const statusCounts = nodes.reduce((acc, node) => {
    const status = String(node?.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const issueCounts = overview?.problemCounts || {};

  return {
    capturedAt: overview?.generatedAt || new Date().toISOString(),
    nodeCount: nodes.length,
    onlineCount: nodes.filter((node) => node.status === 'online').length,
    paymentCount: overview?.paymentCount || 0,
    holdCount: overview?.holdCount || 0,
    checkoutCount: overview?.checkoutCount || 0,
    activeSlotCount: overview?.activeSlotCount || 0,
    problemCount: Object.values(issueCounts).reduce((sum, value) => sum + Number(value || 0), 0),
    diagnosticNoiseCount: overview?.diagnosticNoiseCount || 0,
    runningJobCount: jobs.filter((job) => ['queued', 'running'].includes(job.status)).length,
    statusCounts,
    issueCounts
  };
}

function recordMetricSnapshotSafe() {
  try {
    db.pruneMetricSnapshots(72);
    db.recordMetricSnapshot(buildMetricSnapshot(getOverviewPayload()));
  } catch (error) {
    console.warn(`[METRICS] failed to record snapshot: ${error.message}`);
  }
}

function runIssueRefresh(ttlMs = 15000) {
  if (!issueTracker) return;
  lastIssueRefreshAt = Date.now();
  void issueTracker.refreshIfNeeded(ttlMs).catch((error) => {
    console.error('[ISSUES] refresh failed:', error.message);
  });
}

function scheduleIssueRefresh(minIntervalMs = ISSUE_REFRESH_MIN_MS) {
  if (!issueTracker || issueRefreshTimer) return;
  const elapsed = Date.now() - lastIssueRefreshAt;
  const delay = Math.max(0, minIntervalMs - elapsed);
  issueRefreshTimer = setTimeout(() => {
    issueRefreshTimer = null;
    runIssueRefresh(15000);
  }, delay);
  if (typeof issueRefreshTimer.unref === 'function') issueRefreshTimer.unref();
}

function emitOverviewUpdate() {
  lastOverviewBroadcastAt = Date.now();
  io.emit('overview:update', getOverviewPayload());
}

function scheduleOverviewUpdate(minIntervalMs = OVERVIEW_BROADCAST_MIN_MS) {
  if (overviewBroadcastTimer) return;
  const elapsed = Date.now() - lastOverviewBroadcastAt;
  const delay = Math.max(0, minIntervalMs - elapsed);
  overviewBroadcastTimer = setTimeout(() => {
    overviewBroadcastTimer = null;
    emitOverviewUpdate();
  }, delay);
  if (typeof overviewBroadcastTimer.unref === 'function') overviewBroadcastTimer.unref();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeHeartbeatPatch(nodeId, data) {
  const timestamp = new Date().toISOString();
  const lastError = Object.prototype.hasOwnProperty.call(data, 'lastError')
    ? sanitizeHeartbeatLastError(data.lastError)
    : undefined;
  const patch = {
    id: nodeId,
    nodeId,
    status: 'online',
    last_heartbeat: timestamp,
    lastHeartbeat: timestamp
  };

  const fieldMap = {
    botStatus: 'bot_status',
    currentSlot: 'current_slot',
    currentProxy: 'current_proxy',
    proxyBans: 'proxy_bans',
    cartItems: 'cart_items',
    lastError: 'last_error',
    holdCycle: 'hold_cycle',
    uptimeSeconds: 'uptime_seconds'
  };

  Object.entries(fieldMap).forEach(([sourceKey, targetKey]) => {
    if (Object.prototype.hasOwnProperty.call(data, sourceKey)) {
      patch[targetKey] = sourceKey === 'lastError' ? lastError : data[sourceKey];
    }
  });

  if (Object.prototype.hasOwnProperty.call(data, 'extra')) {
    patch.extra = data.extra;
  }

  return patch;
}

function isCoordinatorNode(node) {
  try {
    const coordinatorIp = getConfigSafe().coordination?.masterIp;
    return node.id === 12 || (!!coordinatorIp && node.ip === coordinatorIp);
  } catch {
    return node.id === 12;
  }
}

function signalLocalBotReload() {
  try {
    const output = require('child_process').execSync(
      `bash -lc 'BOT_PID=$(pgrep -f "node .*src/sniper\\.js" | tail -n 1 || true); ` +
      `if [ -z "$BOT_PID" ]; then echo "__NO_PROCESS__"; exit 0; fi; ` +
      `kill -USR1 "$BOT_PID" && echo "__SIGNALED__|$BOT_PID" || echo "__SIGNAL_FAILED__|$BOT_PID"'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (output.startsWith('__SIGNALED__|')) {
      return { ok: true, processId: parseInt(output.split('|')[1], 10) || null, status: 'signaled' };
    }

    if (output.startsWith('__NO_PROCESS__')) {
      return { ok: false, processId: null, status: 'no_process' };
    }

    return { ok: false, processId: null, status: 'signal_failed', error: output || 'Failed to signal local bot reload' };
  } catch (e) {
    return { ok: false, processId: null, status: 'signal_failed', error: e.message };
  }
}

function getLocalLogTail(lines = 300) {
  const logPath = path.join(PROJECT_ROOT, 'sniper.log');
  if (!fs.existsSync(logPath)) return '';
  const text = fs.readFileSync(logPath, 'utf8');
  return text.split('\n').slice(-Math.max(10, lines)).join('\n');
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function waitForConfigReloadConfirmation(node, version, reason = 'signal', timeoutMs = 15000) {
  const marker = `[HOT RELOAD] version=${version} reason=${reason}`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const logText = isCoordinatorNode(node)
        ? getLocalLogTail(400)
        : (await ssh.getLogSnapshot(node.ip, 400)).log || '';
      const match = logText.split('\n').reverse().find(line => line.includes(marker));
      if (match) {
        return {
          ok: true,
          matchedLine: match.trim()
        };
      }
    } catch (e) {
      lastError = e;
    }

    await sleep(1500);
  }

  return {
    ok: false,
    error: lastError ? lastError.message : 'Reload confirmation timed out'
  };
}

function extractRuntimeSnapshot(node) {
  const extra = parseNodeExtra(node);
  return {
    version: Number(extra.configVersion || 0) || 0,
    mode: extra.runtimeMode || extra.mode || null,
    window: extra.runtimeWindow || null,
    heartbeatAt: node?.last_heartbeat || null
  };
}

function isRuntimeConverged(runtime, expected) {
  if (!runtime || !expected) return false;
  const expectsVersion = Number(expected.version || 0) > 0;
  const versionMatches = !expectsVersion || runtime.version === expected.version;
  return versionMatches
    && runtime.mode === expected.mode
    && runtime.window === expected.window;
}

async function waitForRuntimeConvergence(nodeId, expected, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs;
  let lastRuntime = null;

  while (Date.now() < deadline) {
    const currentNode = db.getNode(nodeId);
    if (currentNode) {
      lastRuntime = extractRuntimeSnapshot(currentNode);
      if (isRuntimeConverged(lastRuntime, expected)) {
        return {
          ok: true,
          runtime: lastRuntime
        };
      }
    }

    await sleep(1500);
  }

  return {
    ok: false,
    runtime: lastRuntime,
    error: 'Runtime convergence timed out'
  };
}

function buildSharedExpectedSummary(results) {
  const expectedModes = Array.from(new Set(results.map((item) => item.expected?.mode).filter(Boolean)));
  const expectedWindows = Array.from(new Set(results.map((item) => item.expected?.window).filter(Boolean)));
  const expectedVersions = Array.from(new Set(results.map((item) => item.expected?.version).filter((value) => Number.isFinite(value) && value > 0)));

  return {
    expectedMode: expectedModes.length === 1 ? expectedModes[0] : null,
    expectedWindow: expectedWindows.length === 1 ? expectedWindows[0] : null,
    expectedVersion: expectedVersions.length === 1 ? expectedVersions[0] : null
  };
}

async function applyConfigToNode(node, expected) {
  const result = {
    nodeId: node.id,
    sync: { ok: false },
    signal: { ok: false },
    confirm: { ok: false },
    runtime: { ok: false },
    expected,
    version: expected.version,
    status: 'pending',
    error: null
  };

  try {
    if (isCoordinatorNode(node)) {
      result.sync = { ok: true, mode: 'local' };
    } else {
      const uploaded = await ssh.uploadConfig(node.ip, CONFIG_PATH);
      result.sync = { ok: !!uploaded, mode: 'ssh_upload' };
      if (!uploaded) {
        result.status = 'ssh_error';
        result.error = 'Config upload failed';
        return result;
      }
    }

    const signalResult = isCoordinatorNode(node)
      ? signalLocalBotReload()
      : await ssh.signalBotReload(node.ip);

    if (signalResult.status === 'no_process') {
      result.signal = signalResult;
      result.status = 'synced_no_process';
      result.error = 'Bot process not found';
      return result;
    }

    if (!signalResult.ok) {
      result.signal = signalResult;
      result.status = 'ssh_error';
      result.error = signalResult.error || 'Failed to signal bot reload';
      return result;
    }

    result.signal = signalResult;

    const confirmResult = await waitForConfigReloadConfirmation(node, expected.version, 'signal');
    result.confirm = confirmResult;

    const runtimeResult = await waitForRuntimeConvergence(node.id, expected);
    result.runtime = runtimeResult;

    if (confirmResult.ok && runtimeResult.ok) {
      result.status = 'applied';
      return result;
    }

    if (confirmResult.ok && !runtimeResult.ok) {
      result.status = 'mismatch';
      result.error = runtimeResult.error;
      return result;
    }

    if (!confirmResult.ok && runtimeResult.ok) {
      result.status = 'runtime_confirmed_without_log';
      result.error = confirmResult.error;
      return result;
    }

    result.status = 'synced_but_unconfirmed';
    result.error = confirmResult.error || runtimeResult.error;
    return result;
  } catch (e) {
    result.status = result.sync ? 'synced_but_unconfirmed' : 'ssh_error';
    result.error = e.message;
    return result;
  }
}

function parseDbUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function enrichLogMeta(meta, node) {
  const now = Date.now();
  const heartbeatDate = parseDbUtc(node?.last_heartbeat);
  const heartbeatMs = heartbeatDate ? heartbeatDate.getTime() : null;
  const logMs = meta?.mtimeMs || null;
  const heartbeatAgeSec = heartbeatMs ? Math.max(0, Math.floor((now - heartbeatMs) / 1000)) : null;
  const logAgeSec = logMs ? Math.max(0, Math.floor((now - logMs) / 1000)) : null;
  const heartbeatAheadSec = heartbeatMs && logMs ? Math.floor((heartbeatMs - logMs) / 1000) : null;

  let isStale = false;
  let staleReason = null;

  if (meta?.processState === 'RUNNING') {
    if (!meta?.hasLogFile) {
      isStale = true;
      staleReason = 'no_log_file';
    } else if (heartbeatAheadSec !== null && heartbeatAheadSec > 120) {
      isStale = true;
      staleReason = 'heartbeat_ahead_of_log';
    } else if (heartbeatAgeSec !== null && heartbeatAgeSec < 90 && logAgeSec !== null && logAgeSec > 180) {
      isStale = true;
      staleReason = 'log_not_updating';
    }
  }

  return {
    ...meta,
    heartbeatAgeSec,
    logAgeSec,
    heartbeatAheadSec,
    isStale,
    staleReason,
    nodeStatus: node?.status,
    botStatus: node?.bot_status,
    lastHeartbeat: node?.last_heartbeat,
    lastError: node?.last_error
  };
}

function buildTelemetryLogSnapshot(node, lines = 200) {
  const snapshot = telemetry.getSnapshot(node.id);
  if (!snapshot.lines.length) return null;

  const entries = snapshot.lines.slice(-Math.max(10, Math.min(parseInt(lines, 10) || 200, 2000)));
  const log = entries.map((entry) => entry.line).join('\n');
  const updatedAt = snapshot.updatedAt || entries[entries.length - 1]?.ts || null;
  const mtimeMs = updatedAt ? Date.parse(updatedAt) : null;

  return {
    nodeId: node.id,
    log,
    error: null,
    meta: enrichLogMeta({
      source: 'stream',
      hasLogFile: true,
      mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null,
      sizeBytes: snapshot.cursor || 0,
      processState: node.bot_status === 'stopped' ? 'STOPPED' : 'RUNNING',
      processId: null,
      logPath: 'sidecar-stream'
    }, node)
  };
}

function getLocalLogSnapshot(node, lines = 200) {
  const logPath = path.join(PROJECT_ROOT, 'sniper.log');
  let stat = null;
  let log = '';

  try {
    if (fs.existsSync(logPath)) {
      stat = fs.statSync(logPath);
      log = getLocalLogTail(lines);
    }
  } catch {}

  return {
    nodeId: node.id,
    log,
    error: null,
    meta: enrichLogMeta({
      source: 'local',
      hasLogFile: !!stat,
      mtimeMs: stat ? stat.mtimeMs : null,
      sizeBytes: stat ? stat.size : 0,
      processState: node.bot_status === 'stopped' ? 'STOPPED' : 'RUNNING',
      processId: null,
      logPath
    }, node)
  };
}

async function getNodeLogSnapshot(node, lines = 200, options = {}) {
  const streamSnapshot = buildTelemetryLogSnapshot(node, lines);
  if (streamSnapshot && options.preferStream !== false) return streamSnapshot;

  if (isCoordinatorNode(node)) {
    return getLocalLogSnapshot(node, lines);
  }

  if (options.allowSsh === false) {
    return {
      nodeId: node.id,
      log: '',
      error: 'Log stream is not ready yet',
      meta: enrichLogMeta({
        source: 'stream-pending',
        hasLogFile: false,
        mtimeMs: null,
        sizeBytes: 0,
        processState: node.bot_status === 'stopped' ? 'STOPPED' : 'UNKNOWN',
        processId: null,
        logPath: 'sidecar-stream'
      }, node)
    };
  }

  const timeoutMs = options.timeoutMs || 4500;
  try {
    const result = await withTimeout(ssh.getLogSnapshot(node.ip, lines), timeoutMs, `log snapshot for node ${node.id}`);
    return {
      nodeId: node.id,
      log: result.log || '',
      error: null,
      meta: enrichLogMeta({ ...result.meta, source: 'ssh' }, node)
    };
  } catch (e) {
    return {
      nodeId: node.id,
      log: '',
      error: e.message,
      meta: enrichLogMeta({
        source: 'fallback',
        hasLogFile: false,
        mtimeMs: null,
        sizeBytes: 0,
        processState: 'UNKNOWN',
        processId: null,
        logPath: null
      }, node)
    };
  }
}

function isLogStreamStale(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0) return true;
  if (!snapshot.updatedAt) return true;
  const updatedMs = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedMs)) return true;
  return Date.now() - updatedMs > LOG_STREAM_STALE_MS;
}

async function seedLogStreamFromRealLog(node, options = {}) {
  if (!node) return telemetry.getSnapshot(options.nodeId || 0);

  const nodeId = Number(node.id);
  const current = telemetry.getSnapshot(nodeId);
  if (!options.force && !isLogStreamStale(current)) return current;

  const state = logSnapshotSeedState.get(nodeId) || {};
  const now = Date.now();
  if (!options.force && state.lastAttemptAt && now - state.lastAttemptAt < LOG_SNAPSHOT_SEED_COOLDOWN_MS) {
    return current;
  }
  if (state.pending) return state.pending;

  const pending = (async () => {
    try {
      const lines = Math.max(50, Math.min(parseInt(options.lines, 10) || 180, 500));
      const timeoutMs = Math.max(1000, Math.min(parseInt(options.timeoutMs, 10) || LOG_SNAPSHOT_SEED_TIMEOUT_MS, 6000));
      const result = isCoordinatorNode(node)
        ? getLocalLogSnapshot(node, lines)
        : await withTimeout(ssh.getLogSnapshot(node.ip, lines), timeoutMs, `log seed for node ${nodeId}`);

      if (result?.log) {
        const updatedAt = result.meta?.mtimeMs && Number.isFinite(Number(result.meta.mtimeMs))
          ? new Date(Number(result.meta.mtimeMs)).toISOString()
          : new Date().toISOString();
        return telemetry.appendSnapshotTail(nodeId, result.log, {
          cursor: result.meta?.sizeBytes || result.meta?.cursor || 0,
          source: options.source || (isCoordinatorNode(node) ? 'local-subscribe-seed' : 'ssh-subscribe-seed'),
          updatedAt
        });
      }
      return telemetry.getSnapshot(nodeId);
    } catch {
      return telemetry.getSnapshot(nodeId);
    } finally {
      const latest = logSnapshotSeedState.get(nodeId) || {};
      logSnapshotSeedState.set(nodeId, {
        ...latest,
        pending: null,
        lastAttemptAt: Date.now()
      });
    }
  })();

  logSnapshotSeedState.set(nodeId, {
    ...state,
    pending,
    lastAttemptAt: now
  });
  return pending;
}

async function restartNodes(nodeIds, eventMessage = 'Restarted after config update') {
  const targets = getNodeTargets(nodeIds);

  return Promise.all(targets.map(async node => {
    try {
      await ssh.stopBot(node.ip);
      await new Promise(resolve => setTimeout(resolve, 800));
      await ssh.startBot(node.ip, node.id);
      db.setNodeStatus(node.id, null, 'running');
      emitNodeUpdate(node.id, { bot_status: 'running' });
      db.addEvent(node.id, 'bot_started', eventMessage);
      return { nodeId: node.id, ok: true };
    } catch (e) {
      return { nodeId: node.id, ok: false, error: e.message };
    }
  }));
}

async function launchNodeBot(nodeId) {
  const node = db.getNode(nodeId);
  if (!node) return { nodeId, ok: false, error: 'Node not found' };

  try {
    await ssh.startBot(node.ip, nodeId);
    db.setNodeStatus(nodeId, null, 'running');
    db.addEvent(nodeId, 'bot_started', 'Bot started via web panel');
    emitNodeUpdate(nodeId, { bot_status: 'running' });
    return { nodeId, ok: true };
  } catch (e) {
    db.setNodeStatus(nodeId, 'error', 'stopped');
    db.addEvent(nodeId, 'error', `Start failed: ${e.message}`);
    return { nodeId, ok: false, error: e.message };
  }
}

function buildJobTitle(kind, nodes) {
  const count = nodes.length;
  const label = count === 1 ? `NODE_${String(nodes[0].id).padStart(2, '0')}` : `${count} nodes`;
  return `${kind} • ${label}`;
}

async function executeNodeCommand(kind, node, context = {}) {
  switch (kind) {
    case 'start': {
      return launchNodeBot(node.id);
    }
    case 'stop': {
      await ssh.stopBot(node.ip);
      db.setNodeStatus(node.id, null, 'stopped');
      db.addEvent(node.id, 'bot_stopped', 'Bot stopped via control command');
      emitNodeUpdate(node.id, { bot_status: 'stopped' });
      return { nodeId: node.id, ok: true };
    }
    case 'restart': {
      await ssh.stopBot(node.ip);
      await sleep(800);
      await ssh.startBot(node.ip, node.id);
      db.setNodeStatus(node.id, null, 'running');
      db.addEvent(node.id, 'bot_started', 'Bot restarted via control command');
      emitNodeUpdate(node.id, { bot_status: 'running' });
      return { nodeId: node.id, ok: true };
    }
    case 'pay': {
      await triggerPayOnNode(node);
      db.addEvent(node.id, 'pay_triggered', 'Pay triggered via control command');
      emitNodeUpdate(node.id, { bot_status: 'checkout' });
      return { nodeId: node.id, ok: true };
    }
    case 'reset-cart': {
      const result = await ssh.resetCart(node.ip, node.id);
      if (!result.ok) {
        const error = result.stderr || result.stdout || `Reset cart failed with code ${result.code}`;
        db.addEvent(node.id, 'error', `Cart reset failed: ${error.slice(0, 240)}`);
        return { nodeId: node.id, ok: false, error };
      }
      db.setNodeStatus(node.id, null, 'running');
      db.addEvent(node.id, 'cart_reset', 'Cart reset via control command');
      emitNodeUpdate(node.id, { bot_status: 'running', cart_items: null });
      return { nodeId: node.id, ok: true };
    }
    case 'deploy': {
      const ok = await ssh.deployToNode(node.ip, node.id, context.archivePath);
      db.addEvent(node.id, ok ? 'deployed' : 'error', ok ? 'Deploy successful' : 'Deploy failed');
      return { nodeId: node.id, ok, error: ok ? null : 'Deploy failed' };
    }
    case 'sidecar-sync': {
      const remotePath = '/root/sidecar.js';
      const uploaded = await ssh.uploadFile(node.ip, context.sidecarPath, remotePath);
      if (!uploaded) {
        throw new Error('Upload failed');
      }
      const cmd = `npm install -g pm2 2>/dev/null; pm2 delete heartbeat-agent 2>/dev/null || true && pm2 start /root/sidecar.js --name heartbeat-agent -- ${node.id} ${context.coordinatorIp} ${PORT} && pm2 save`;
      await ssh.execOnNode(node.ip, cmd);
      db.addEvent(node.id, 'deployed', 'Sidecar synced successfully');
      return { nodeId: node.id, ok: true };
    }
    default:
      throw new Error(`Unsupported command: ${kind}`);
  }
}

function finalizeJobStatus(results) {
  if (results.length === 0) return 'done';
  const successCount = results.filter((item) => item.ok).length;
  if (successCount === results.length) return 'done';
  if (successCount === 0) return 'failed';
  return 'partial';
}

function queueNodeJob(kind, targets, context = {}) {
  const job = db.createJob({
    kind,
    title: buildJobTitle(kind, targets),
    payload: context.payload || {},
    items: targets.map((node) => ({
      nodeId: node.id,
      label: `NODE_${String(node.id).padStart(2, '0')}`,
      meta: { ip: node.ip }
    }))
  });

  emitJobUpdate(job.id);

  void (async () => {
    db.setJobStatus(job.id, 'running');
    emitJobUpdate(job.id);

    const items = db.getJobItems(job.id);
    const results = [];

    for (let index = 0; index < targets.length; index += 1) {
      const node = targets[index];
      const jobItem = items[index];

      db.updateJobItem(jobItem.id, { status: 'running', message: `${kind} started` });
      emitJobUpdate(job.id);

      try {
        const result = await executeNodeCommand(kind, node, context);
        results.push(result);
        db.updateJobItem(jobItem.id, {
          status: result.ok ? 'done' : 'failed',
          message: result.ok ? `${kind} completed` : (result.error || `${kind} failed`)
        });
      } catch (error) {
        results.push({ nodeId: node.id, ok: false, error: error.message });
        db.updateJobItem(jobItem.id, {
          status: 'failed',
          message: error.message
        });
      }

      emitJobUpdate(job.id);
    }

    db.setJobStatus(job.id, finalizeJobStatus(results));
    emitJobUpdate(job.id);
  })();

  return {
    ...job,
    items: db.getJobItems(job.id)
  };
}

issueTracker = createIssueTracker({
  getNodesEnvelope,
  ssh,
  telemetry,
  enrichLogMeta
});

runIssueRefresh(1);

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === AUTH_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.get('/api/overview', requireAuth, (req, res) => {
  db.markStaleNodes(30);
  res.json(getOverviewPayload());
});

app.get('/api/issues/overview', requireAuth, async (req, res) => {
  try {
    const overview = normalizeIssueOverview(await issueTracker.getOverview({
      force: req.query.refresh === '1'
    }));
    res.json(overview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/jobs', requireAuth, (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 30, 100));
  const jobs = db.listJobs(limit).map((job) => ({
    ...job,
    items: db.getJobItems(job.id)
  }));
  res.json(jobs);
});

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const job = db.getJob(parseInt(req.params.id, 10));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    ...job,
    items: db.getJobItems(job.id)
  });
});

app.post('/api/commands', requireAuth, async (req, res) => {
  const { command, nodeIds = [] } = req.body || {};
  const targets = getNodeTargets(nodeIds);

  if (!['start', 'stop', 'restart', 'pay', 'reset-cart', 'deploy', 'sidecar-sync'].includes(command)) {
    return res.status(400).json({ error: 'Unsupported command' });
  }

  if (targets.length === 0) {
    return res.status(400).json({ error: 'No nodes selected' });
  }

  if (['stop', 'restart', 'reset-cart', 'deploy', 'sidecar-sync'].includes(command)) {
    if (maybeBlockDangerousMassAction(req, res, command, targets)) {
      return;
    }
  }

  try {
    let context = { payload: { command, nodeIds: targets.map((node) => node.id) } };
    if (command === 'deploy') {
      context.archivePath = ssh.createDeployArchive(PROJECT_ROOT);
    }
    if (command === 'sidecar-sync') {
      context.sidecarPath = path.join(__dirname, 'sidecar.js');
      context.coordinatorIp = getConfigSafe().coordination?.masterIp || '127.0.0.1';
    }

    const job = queueNodeJob(command, targets, context);
    res.json({ ok: true, job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/telemetry/logs', (req, res) => {
  const nodeId = parseInt(req.body?.nodeId, 10);
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const { lines = [], cursor = 0, truncated = false, source = 'sidecar' } = req.body || {};
  if (truncated) telemetry.clearNode(nodeId);

  const { chunk } = telemetry.appendLines(nodeId, lines, {
    cursor,
    source,
    updatedAt: new Date().toISOString()
  });

  if (chunk) {
    io.to(`logs:${nodeId}`).emit('logs:chunk', chunk);
  }

  issueTracker?.markDirty();
  scheduleIssueRefresh();

  res.json({ ok: true, accepted: Array.isArray(lines) ? lines.length : 0 });
});

app.post('/api/heartbeat', (req, res) => {
  const { nodeId, ...data } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const parsedNodeId = parseInt(nodeId, 10);
  const previousNode = db.getNode(parsedNodeId);
  const heartbeatData = {
    ...data,
    lastError: sanitizeHeartbeatLastError(data.lastError)
  };
  db.updateNodeHeartbeat(parsedNodeId, heartbeatData);
  issueTracker?.markDirty();
  io.emit('node:update', normalizeHeartbeatPatch(parsedNodeId, heartbeatData));
  scheduleOverviewUpdate();

  if (heartbeatData.cartItems && heartbeatData.cartItems !== 'null' && previousNode?.cart_items !== heartbeatData.cartItems) {
    db.addEvent(parsedNodeId, 'cart_update', heartbeatData.cartItems);
  }

  res.json({ ok: true });
});

app.post('/api/proxy-leases/acquire', (req, res) => {
  try {
    const config = getConfigSafe();
    res.json(proxyLeaseStore.acquireProxyLease(config, req.body || {}));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/proxy-leases/report', (req, res) => {
  try {
    const config = getConfigSafe();
    res.json(proxyLeaseStore.reportProxyHealth(config, req.body || {}));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/proxy-leases/checker-result', (req, res) => {
  try {
    const config = getConfigSafe();
    res.json(proxyLeaseStore.reportCheckerResults(config, req.body || {}));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/proxy-leases/check-plan', (req, res) => {
  try {
    const config = getConfigSafe();
    res.json(proxyLeaseStore.buildCheckerPlan(config, req.query || {}));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/nodes', requireAuth, (req, res) => {
  db.markStaleNodes(30);
  res.json(getNodesEnvelope());
});

app.get('/api/nodes/:id', requireAuth, (req, res) => {
  const node = db.getNode(parseInt(req.params.id, 10));
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(buildNodeEnvelopeWithState(node));
});

app.post('/api/nodes/:id/start', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  try {
    db.setNodeStatus(nodeId, null, 'starting');
    emitNodeUpdate(nodeId, { bot_status: 'starting' });
    void launchNodeBot(nodeId).catch((e) => {
      console.error(`[START] Node ${nodeId} launch failed:`, e.message);
    });
    res.json({ ok: true, accepted: true });
  } catch (e) {
    db.setNodeStatus(nodeId, 'error', 'stopped');
    db.addEvent(nodeId, 'error', `Start failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/nodes/:id/stop', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  try {
    await ssh.stopBot(node.ip);
    db.setNodeStatus(nodeId, null, 'stopped');
    db.addEvent(nodeId, 'bot_stopped', 'Bot stopped via web panel');
    emitNodeUpdate(nodeId, { bot_status: 'stopped' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/nodes/:id/pay', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  try {
    const hasStructuredPayload = req.body && (req.body.adults !== undefined || req.body.children !== undefined);

    if (hasStructuredPayload) {
      const envelope = buildNodeEnvelopeWithState(node, {
        logSnapshot: telemetry.getSnapshot(nodeId),
        recentEvents: db.getEvents({ nodeId, limit: 40 })
      });
      const caught = buildPaymentCartState(envelope);
      const normalized = normalizePaymentRequestBody(req.body, caught);

      if (normalized.error) {
        return res.status(400).json({ error: normalized.error, caught, nodeId });
      }

      const requestPayload = {
        ...normalized.value,
        nodeId,
        caught
      };

      await triggerPayOnNode(node, requestPayload);
      db.addEvent(
        nodeId,
        'payment_request_received',
        `Web payment request: ${requestPayload.adults} adults, ${requestPayload.children} children, ${requestPayload.guide} guide${requestPayload.checkoutOnly ? ', checkout only' : ''}`
      );
      emitNodeUpdate(nodeId, { bot_status: 'checkout' });
      return res.json({
        ok: true,
        status: 'queued',
        requested: {
          adults: requestPayload.adults,
          children: requestPayload.children,
          guide: requestPayload.guide
        },
        caught,
        nodeId
      });
    }

    await triggerPayOnNode(node);
    db.addEvent(nodeId, 'pay_triggered', 'Pay triggered via web panel');
    emitNodeUpdate(nodeId, { bot_status: 'checkout' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vnc/:id/start', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  if (!vnc.isNoVNCInstalled()) {
    return res.status(503).json({ error: 'noVNC not installed on server. Run: pip3 install websockify && git clone https://github.com/novnc/noVNC /root/noVNC' });
  }

  try {
    const result = await vnc.ensureSession(nodeId, node.ip, ssh.connect);
    db.addEvent(nodeId, 'vnc_started', `VNC session started on port ${result.wsPort}`);
    scheduleOverviewUpdate(500);
    res.json({ ok: true, ...result, iframeUrl: buildNoVncClientUrl(req, result) });
  } catch (e) {
    console.error(`[VNC] Error starting session for node ${nodeId}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/vnc/:id', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  await vnc.stopSession(nodeId, ssh.connect);
  scheduleOverviewUpdate(500);
  res.json({ ok: true });
});

app.get('/api/vnc/:id', requireAuth, (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const session = vnc.getSession(nodeId);
  if (!session) return res.status(404).json({ error: 'No active VNC session' });
  res.json({ ...session, iframeUrl: buildNoVncClientUrl(req, session) });
});

app.get('/api/vnc', requireAuth, (req, res) => {
  res.json(vnc.getAllSessions());
});

app.get('/api/workstation/:id', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const config = getConfigSafe();
  const effectiveConfig = getEffectiveNodeConfig(config, nodeId);
  const nodeOverride = config.nodeOverrides?.[String(nodeId)] || {};
  let recentLog = telemetry.getSnapshot(nodeId);
  const session = vnc.getSession(nodeId);
  const logSnapshot = await getNodeLogSnapshot(node, 160);

  if (logSnapshot.log) {
    telemetry.seedFromSnapshot(nodeId, logSnapshot.log, {
      cursor: logSnapshot.meta?.sizeBytes || 0,
      source: 'workstation-ssh'
    });
    recentLog = telemetry.getSnapshot(nodeId);
  }

  const envelope = buildNodeEnvelopeWithState(node, {
    logSnapshot: recentLog,
    recentEvents: db.getEvents({ nodeId, limit: 40 })
  });
  const issues = normalizeIssueRow(await issueTracker.getNodeIssues(envelope));

  res.json({
    node: envelope,
    runtime: parseNodeExtra(node),
    desired: effectiveConfig,
    override: nodeOverride,
    session: session ? { ...session, iframeUrl: buildNoVncClientUrl(req, session) } : null,
    logs: recentLog,
    logMeta: logSnapshot.meta,
    issues: issues.issues,
    noiseIssues: issues.noiseIssues || [],
    paymentCart: buildPaymentCartState(envelope),
    recentEvents: db.getEvents({ nodeId, limit: 30 })
  });
});

app.post('/api/workstation/:id/attach', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  try {
    const session = await vnc.ensureSession(nodeId, node.ip, ssh.connect);
    scheduleOverviewUpdate(500);
    res.json({
      ok: true,
      session: {
        ...session,
        iframeUrl: buildNoVncClientUrl(req, session)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/nodes/start-all', requireAuth, async (req, res) => {
  const nodes = getNodeTargets();
  nodes.forEach(node => {
    db.setNodeStatus(node.id, null, 'starting');
    emitNodeUpdate(node.id, { bot_status: 'starting' });
  });

  const results = nodes.map(node => {
    void launchNodeBot(node.id).catch((e) => {
      console.error(`[START-ALL] Node ${node.id} launch failed:`, e.message);
    });
    return { nodeId: node.id, ok: true, accepted: true };
  });

  res.json({ ok: true, accepted: true, results });
});

app.post('/api/nodes/stop-all', requireAuth, async (req, res) => {
  const nodes = getNodeTargets();
  const results = await Promise.all(nodes.map(async node => {
    try {
      await ssh.stopBot(node.ip);
      db.setNodeStatus(node.id, null, 'stopped');
      emitNodeUpdate(node.id, { bot_status: 'stopped' });
      return { nodeId: node.id, ok: true };
    } catch (e) {
      return { nodeId: node.id, ok: false, error: e.message };
    }
  }));

  res.json({ results });
});

app.post('/api/deploy', requireAuth, async (req, res) => {
  const { nodeIds } = req.body;
  const targets = getNodeTargets(nodeIds);

  if (maybeBlockDangerousMassAction(req, res, 'deploy', targets)) {
    return;
  }

  try {
    const archivePath = ssh.createDeployArchive(PROJECT_ROOT);
    const results = [];

    for (const node of targets) {
      try {
        io.emit('deploy:progress', { nodeId: node.id, status: 'deploying' });
        const ok = await ssh.deployToNode(node.ip, node.id, archivePath);
        db.addEvent(node.id, 'deployed', ok ? 'Deploy successful' : 'Deploy failed');
        io.emit('deploy:progress', { nodeId: node.id, status: ok ? 'done' : 'error' });
        results.push({ nodeId: node.id, ok });
      } catch (e) {
        db.addEvent(node.id, 'error', `Deploy error: ${e.message}`);
        io.emit('deploy:progress', { nodeId: node.id, status: 'error', error: e.message });
        results.push({ nodeId: node.id, ok: false, error: e.message });
      }
    }

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: `Archive creation failed: ${e.message}` });
  }
});

app.post('/api/deploy-sidecar', requireAuth, async (req, res) => {
  const nodes = getNodeTargets();
  let coordinatorIp = '127.0.0.1';

  if (maybeBlockDangerousMassAction(req, res, 'sidecar-sync', nodes)) {
    return;
  }

  try {
    coordinatorIp = getConfigSafe().coordination?.masterIp || '127.0.0.1';
  } catch {}

  try {
    const sidecarPath = path.join(__dirname, 'sidecar.js');
    const results = [];

    for (const node of nodes) {
      try {
        io.emit('deploy:progress', { nodeId: node.id, status: 'deploying sidecar' });
        const remotePath = '/root/sidecar.js';
        const ok = await ssh.uploadFile(node.ip, sidecarPath, remotePath);

        if (!ok) {
          throw new Error('Upload failed');
        }

        const cmd = `npm install -g pm2 2>/dev/null; pm2 delete heartbeat-agent 2>/dev/null || true && pm2 start /root/sidecar.js --name heartbeat-agent -- ${node.id} ${coordinatorIp} ${PORT} && pm2 save`;
        await ssh.execOnNode(node.ip, cmd);
        db.addEvent(node.id, 'deployed', 'Sidecar deployed successfully');
        io.emit('deploy:progress', { nodeId: node.id, status: 'done' });
        results.push({ nodeId: node.id, ok: true });
      } catch (e) {
        db.addEvent(node.id, 'error', `Sidecar deploy error: ${e.message}`);
        io.emit('deploy:progress', { nodeId: node.id, status: 'error', error: e.message });
        results.push({ nodeId: node.id, ok: false, error: e.message });
      }
    }

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: `Sidecar deploy failed: ${e.message}` });
  }
});

app.get('/api/logs/:id', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  const node = db.getNode(nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const lines = parseInt(req.query.lines, 10) || 200;
  const allowSsh = req.query.ssh === '1' || req.query.source === 'ssh';
  const streamSnapshot = telemetry.getSnapshot(nodeId);
  if (!allowSsh && isLogStreamStale(streamSnapshot)) {
    void seedLogStreamFromRealLog(node, {
      lines: Math.max(120, Math.min(lines, 300)),
      timeoutMs: LOG_SNAPSHOT_SEED_TIMEOUT_MS,
      source: 'logs-api-seed'
    }).catch(() => {});
  }
  res.json(await getNodeLogSnapshot(node, lines, {
    allowSsh,
    timeoutMs: allowSsh ? 4500 : 1000
  }));
});

app.get('/api/slots', requireAuth, (req, res) => {
  res.json(stateReconciler.buildActiveSlotRegistry(getNodesEnvelope()));
});

app.get('/api/proxies', requireAuth, (req, res) => {
  try {
    const config = getConfigSafe();
    const nodes = db.getAllNodes();
    let preview = null;

    try {
      preview = buildDistributionPreview({ config, nodeCount: nodes.length });
    } catch {}

    res.json(buildProxyOverview(nodes, config, preview));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/proxy-leases/status', requireAuth, (req, res) => {
  try {
    const config = getConfigSafe();
    res.json(proxyLeaseStore.getProxyLeaseSnapshot(config));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/proxies/distribution-preview', requireAuth, (req, res) => {
  try {
    const config = getConfigSafe();
    const nodeCount = db.getAllNodes().length;
    res.json(buildDistributionPreview({ config, nodeCount }));
  } catch (e) {
    const status = e.code === 'PROXY_SOURCE_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

app.post('/api/proxies/apply', requireAuth, async (req, res) => {
  try {
    const { restartChanged = false } = req.body || {};
    const nodeCount = db.getAllNodes().length;
    const preview = applyDistributedProxies(nodeCount);

    if (restartChanged) {
      const targets = getNodeTargets(preview.changedNodeIds);
      if (maybeBlockDangerousMassAction(req, res, 'proxy-redistribution', targets)) {
        return;
      }
    }

    db.addEvent(null, 'config_updated', 'Proxy distribution applied via web panel');

    const response = {
      ...preview,
      restartRequested: !!restartChanged
    };

    if (restartChanged) {
      response.restartResults = await restartNodes(preview.changedNodeIds, 'Restarted after proxy redistribution');
    }

    res.json(response);
  } catch (e) {
    const status = e.code === 'PROXY_SOURCE_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

app.get('/api/config', requireAuth, (req, res) => {
  try {
    res.json(getConfigSafe());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/config', requireAuth, (req, res) => {
  try {
    const savedConfig = saveConfig(req.body, { updatedBy: 'web-panel' });
    db.addEvent(null, 'config_updated', `Configuration saved via web panel (version=${savedConfig.configMeta?.version || 'n/a'})`);
    res.json({ ok: true, config: savedConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/apply', requireAuth, async (req, res) => {
  try {
    const { scope = 'global', nodeIds = [] } = req.body || {};
    const requestedNodeIds = Array.isArray(nodeIds)
      ? Array.from(new Set(nodeIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)))
      : [];
    if (scope !== 'global' && requestedNodeIds.length === 0) {
      return res.status(400).json({ error: 'nodeIds required for targeted scope' });
    }
    const targetNodes = requestedNodeIds.length > 0
      ? getNodeTargets(requestedNodeIds)
      : getNodeTargets();
    if (maybeBlockDangerousMassAction(req, res, 'config-apply', targetNodes)) {
      return;
    }
    const currentConfig = getConfigSafe();
    const version = currentConfig.configMeta?.version || 0;
    const results = await Promise.all(targetNodes.map(async (node) => {
      const expected = getEffectiveNodeConfig(currentConfig, node.id);
      const result = await applyConfigToNode(node, expected);
      db.addEvent(node.id, 'config_apply', result.status === 'applied'
        ? `Config version ${version} applied without restart`
        : `Config version ${version} apply result: ${result.status}${result.error ? ` (${result.error})` : ''}`);
      return result;
    }));

    const expectation = buildSharedExpectedSummary(results);

    res.json({
      ok: true,
      version,
      appliedNodeIds: results.filter(item => item.status === 'applied').map(item => item.nodeId),
      runtimeConfirmedNodeIds: results.filter(item => item.runtime?.ok).map(item => item.nodeId),
      blockedNodeIds: [],
      mismatchNodeIds: results
        .filter(item => item.status === 'mismatch' || item.status === 'runtime_confirmed_without_log' || item.status === 'synced_but_unconfirmed')
        .map(item => item.nodeId),
      expectedMode: expectation.expectedMode,
      expectedWindow: expectation.expectedWindow,
      expectedVersion: expectation.expectedVersion,
      results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/restart', requireAuth, async (req, res) => {
  const { nodeIds } = req.body;
  const targets = getNodeTargets(nodeIds);
  if (maybeBlockDangerousMassAction(req, res, 'config-restart', targets)) {
    return;
  }
  const results = await restartNodes(nodeIds);
  res.json({ results });
});

app.get('/api/events', requireAuth, (req, res) => {
  const opts = {
    nodeId: req.query.nodeId ? parseInt(req.query.nodeId, 10) : undefined,
    type: req.query.type,
    limit: parseInt(req.query.limit, 10) || 100
  };
  res.json(db.getEvents(opts));
});

app.get('/api/metrics/history', requireAuth, (req, res) => {
  const range = String(req.query.range || '24h');
  const allowedRanges = new Set(['1h', '6h', '24h', '72h']);
  const normalizedRange = allowedRanges.has(range) ? range : '24h';
  res.json({
    range: normalizedRange,
    points: db.listMetricSnapshots(normalizedRange),
    generatedAt: new Date().toISOString()
  });
});

io.on('connection', socket => {
  console.log(`[WS] Client connected: ${socket.id}`);
  db.markStaleNodes(30);
  socket.emit('init', {
    overview: getOverviewPayload(),
    nodes: getNodesEnvelope(),
    jobs: db.listJobs(12).map((job) => ({ ...job, items: db.getJobItems(job.id) }))
  });

  socket.on('logs:subscribe', async ({ nodeId, afterSeq = 0 }) => {
    const node = db.getNode(nodeId);
    if (!node) return;

    socket.join(`logs:${nodeId}`);

    try {
      const snapshot = telemetry.getSnapshot(nodeId, afterSeq);
      if (snapshot.lines.length === 0 && isCoordinatorNode(node)) {
        const result = getLocalLogSnapshot(node, 150);
        telemetry.seedFromSnapshot(nodeId, result.log, {
          cursor: result.meta?.sizeBytes || 0,
          source: 'local-snapshot'
        });
      }

      const currentSnapshot = telemetry.getSnapshot(nodeId, afterSeq);
      const shouldSeedFromRealLog = isLogStreamStale(currentSnapshot);
      socket.emit('logs:snapshot', currentSnapshot);
      socket.emit('logs:data', {
        nodeId,
        log: '',
        meta: enrichLogMeta({
          source: currentSnapshot.lines.length > 0 ? 'stream' : 'stream-pending',
          processState: node.bot_status === 'stopped' ? 'STOPPED' : 'RUNNING'
        }, node)
      });

      if (shouldSeedFromRealLog) {
        void seedLogStreamFromRealLog(node, {
          lines: 220,
          timeoutMs: LOG_SNAPSHOT_SEED_TIMEOUT_MS,
          source: 'logs-subscribe-seed'
        }).then((seededSnapshot) => {
          const nextSnapshot = telemetry.getSnapshot(nodeId, afterSeq);
          if (nextSnapshot.seq > currentSnapshot.seq || (seededSnapshot?.updatedAt && seededSnapshot.updatedAt !== currentSnapshot.updatedAt)) {
            socket.emit('logs:snapshot', nextSnapshot);
            socket.emit('logs:data', {
              nodeId,
              log: '',
              meta: enrichLogMeta({
                source: nextSnapshot.lines.length > 0 ? 'stream-seeded' : 'stream-pending',
                hasLogFile: nextSnapshot.lines.length > 0,
                mtimeMs: nextSnapshot.updatedAt ? Date.parse(nextSnapshot.updatedAt) : null,
                sizeBytes: nextSnapshot.cursor || 0,
                processState: node.bot_status === 'stopped' ? 'STOPPED' : 'RUNNING',
                processId: null,
                logPath: nextSnapshot.lines.length > 0 ? 'sidecar-stream' : null
              }, node)
            });
          }
        }).catch(() => {});
      }
    } catch (e) {
      socket.emit('logs:data', {
        nodeId,
        log: '',
        error: e.message,
        meta: enrichLogMeta({
          source: 'fallback',
          hasLogFile: false,
          mtimeMs: null,
          sizeBytes: 0,
          processState: 'UNKNOWN',
          processId: null,
          logPath: null
        }, node)
      });
    }
  });

  socket.on('logs:unsubscribe', ({ nodeId }) => {
    socket.leave(`logs:${nodeId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

setInterval(() => {
  db.markStaleNodes(30);
}, 15000);

setInterval(() => {
  runIssueRefresh(15000);
}, 20000);

setInterval(() => {
  recordMetricSnapshotSafe();
}, 60000);

app.get('/api/healthz', (req, res) => {
  res.json({
    ok: true,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    generatedAt: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(clientStaticDir, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  runIssueRefresh(1);
  recordMetricSnapshotSafe();
  telegramControlBot = createTelegramControlBot({
    getOverview: () => {
      db.markStaleNodes(30);
      return getOverviewPayload();
    },
    getConfig: getConfigSafe,
    logger: console
  });
  telegramControlBot.start();
  const proto = fs.existsSync(certPath) ? 'https' : 'http';
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║  Ticket Sniper Control Center                     ║`);
  console.log(`║  ${proto}://0.0.0.0:${PORT}                               ║`);
  console.log(`║  Nodes: ${IPS.length} | DB: SQLite (WAL)                  ║`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);
});

server.on('error', (error) => {
  console.error('[SERVER] fatal listen/runtime error:', error.message);
  process.exit(1);
});

let shutdownStarted = false;
function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[SERVER] ${signal} received, closing web server`);
  if (overviewBroadcastTimer) clearTimeout(overviewBroadcastTimer);
  if (issueRefreshTimer) clearTimeout(issueRefreshTimer);
  try {
    telegramControlBot?.stop?.();
  } catch (error) {
    console.error('[SERVER] Telegram cleanup failed:', error.message);
  }
  try {
    vnc.stopAllLocalSessions?.();
  } catch (error) {
    console.error('[SERVER] VNC cleanup failed:', error.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
