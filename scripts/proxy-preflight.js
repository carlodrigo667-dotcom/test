#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT_DIR = process.env.SNIPER_ROOT || '/root/colosseum-sniper';
const CONFIG_PATH = process.env.SNIPER_CONFIG || path.join(ROOT_DIR, 'config.json');
const NODE_ID = String(process.env.NODE_ID || process.argv[2] || readText(path.join(ROOT_DIR, '.node_id')) || '').trim();
const DEFAULT_TARGET_URL = 'https://ticketing.colosseo.it/eventi/24h-colosseo-foro-romano-palatino-gruppi/';
const LOG_FILE = process.env.PROXY_PREFLIGHT_LOG || path.join(ROOT_DIR, 'logs', `proxy-preflight-node${NODE_ID || 'unknown'}.log`);
const RESULT_FILE = process.env.PROXY_PREFLIGHT_RESULT || `/tmp/sniper-proxy-preflight-node${NODE_ID || 'unknown'}.json`;
const BAN_STATE_FILE = process.env.PROXY_BAN_STATE_FILE || `/tmp/sniper-proxy-bans-node${NODE_ID || 'unknown'}.json`;
const LOCK_FILE = process.env.PROXY_PREFLIGHT_LOCK || `/tmp/sniper-proxy-preflight-node${NODE_ID || 'unknown'}.lock`;

const BLOCK_MARKERS = [
  'hosting provider ip address',
  'you have received a 403 error',
  'you have been blocked',
  'octofence',
  'cf-ray',
  'cloudflare',
  'block_style',
  '/cdn-cgi/',
  'error 403'
];

main().catch((error) => {
  log(`fatal ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

async function main() {
  if (!/^\d+$/.test(NODE_ID)) {
    log(`fatal invalid NODE_ID value=${JSON.stringify(NODE_ID)}`);
    process.exitCode = 2;
    return;
  }

  const lockFd = acquireLock();
  if (lockFd === null) return;

  try {
    const config = readJson(CONFIG_PATH, null);
    if (!config) {
      log(`config missing path=${CONFIG_PATH}`);
      return;
    }

    const proxies = getNodeProxies(config, NODE_ID);
    const poolHash = hashProxyPool(proxies);
    const targetUrl = process.env.PROXY_PREFLIGHT_URL
      || config.proxyPool?.proxyPreflightUrl
      || config.proxyPool?.safeColosseoProbeUrl
      || DEFAULT_TARGET_URL;
    const concurrency = Math.max(1, Math.min(2, Number(process.env.PROXY_PREFLIGHT_CONCURRENCY || config.proxyPool?.proxyPreflightConcurrency || 1)));
    const invalidBanMs = Math.max(60000, Number(process.env.PROXY_PREFLIGHT_INVALID_BAN_MS || config.proxyPool?.proxyPreflightInvalidBanMs || 2 * 60 * 60 * 1000));
    const delayMinMs = Math.max(0, Number(process.env.PROXY_PREFLIGHT_DELAY_MIN_MS || config.proxyPool?.proxyPreflightDelayMinMs || 2000));
    const delayMaxMs = Math.max(delayMinMs, Number(process.env.PROXY_PREFLIGHT_DELAY_MAX_MS || config.proxyPool?.proxyPreflightDelayMaxMs || 6000));
    const timeoutMs = Math.max(5000, Number(process.env.PROXY_PREFLIGHT_TIMEOUT_MS || config.proxyPool?.proxyPreflightTimeoutMs || 25000));
    const force = process.env.PROXY_PREFLIGHT_FORCE === '1';

    if (!proxies.length) {
      writeResult({ nodeId: NODE_ID, poolHash, checkedAt: Date.now(), targetUrl, totals: { configured: 0, checked: 0 }, proxies: [] });
      log(`no proxies configured node=${NODE_ID}`);
      return;
    }

    const previous = readJson(RESULT_FILE, null);
    if (!force && previous?.poolHash === poolHash && previous?.completed === true) {
      log(`skip already completed node=${NODE_ID} pool_hash=${poolHash} checked=${previous?.totals?.checked || 0}`);
      return;
    }

    log(`started node=${NODE_ID} mode=safe_colosseo_page proxies=${proxies.length} concurrency=${concurrency} target=${targetUrl} pool_hash=${poolHash}`);
    const startedAt = Date.now();
    const records = [];
    let cursor = 0;

    async function worker(workerId) {
      while (cursor < proxies.length) {
        const idx = cursor++;
        const proxy = proxies[idx];
        const record = await probeProxySafePage(proxy, idx, targetUrl, timeoutMs);
        records.push(record);
        applyBanDecision(record, poolHash, invalidBanMs);
        log(formatRecord(workerId, record));
        await sleep(randomInt(delayMinMs, delayMaxMs));
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, proxies.length) }, (_, workerId) => worker(workerId + 1)));

    const totals = buildTotals(records, proxies.length);
    const result = {
      nodeId: NODE_ID,
      poolHash,
      completed: true,
      startedAt,
      checkedAt: Date.now(),
      targetUrl,
      mode: 'safe_colosseo_page',
      totals,
      proxies: records.sort((a, b) => a.index - b.index)
    };
    writeResult(result);
    log(`finished checked=${totals.checked}/${totals.configured} healthy=${totals.healthy || 0} invalid=${totals.technical_invalid || 0} blocked_or_rate_limited=${totals.blocked_or_rate_limited || 0} no_ban=${totals.actions.no_ban || 0} banned=${totals.actions.banned || 0}`);
  } finally {
    releaseLock(lockFd);
  }
}

async function probeProxySafePage(proxy, idx, targetUrl, timeoutMs) {
  const startedAt = Date.now();
  const userDataDir = path.join(os.tmpdir(), `proxy-preflight-${NODE_ID}-${idx}-${process.pid}-${Date.now()}`);
  let browser = null;
  const blockedRequests = [];

  try {
    const puppeteer = getPuppeteer();
    fs.mkdirSync(userDataDir, { recursive: true });
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
      '--lang=it-IT,it',
      '--window-size=1365,768',
      `--user-data-dir=${userDataDir}`,
      `--proxy-server=http://${proxy.host}:${proxy.port}`
    ];

    browser = await puppeteer.launch({
      headless: process.env.PROXY_PREFLIGHT_HEADLESS || 'new',
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
      args: browserArgs,
      ignoreHTTPSErrors: true,
      defaultViewport: { width: 1365, height: 768 }
    });

    const page = await browser.newPage();
    if (proxy.username) {
      await page.authenticate({ username: proxy.username, password: proxy.password || '' });
    }
    await page.setJavaScriptEnabled(false);
    await page.setUserAgent(process.env.PROXY_PREFLIGHT_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.7,en;q=0.6' });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const decision = classifyRequestForSafety(request);
      if (decision.allow) {
        request.continue().catch(() => {});
      } else {
        blockedRequests.push(decision.reason);
        request.abort('blockedbyclient').catch(() => {});
      }
    });

    let response = null;
    try {
      response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (error) {
      return buildRecord({
        idx,
        proxy,
        startedAt,
        status: isTechnicalInvalidReason(classifyBrowserError(error)) ? 'technical_invalid' : 'transient',
        reason: classifyBrowserError(error),
        httpCode: 0,
        finalUrl: page.url(),
        blockedRequests
      });
    }

    const pageState = await capturePageState(page, response);
    const decision = classifyPageState(pageState);
    return buildRecord({
      idx,
      proxy,
      startedAt,
      status: decision.status,
      reason: decision.reason,
      httpCode: pageState.httpCode,
      finalUrl: pageState.finalUrl,
      snippet: pageState.snippet,
      blockedRequests
    });
  } catch (error) {
    const reason = classifyBrowserError(error);
    return buildRecord({
      idx,
      proxy,
      startedAt,
      status: isTechnicalInvalidReason(reason) ? 'technical_invalid' : 'transient',
      reason,
      httpCode: 0,
      finalUrl: '',
      snippet: compactSnippet(error && error.message ? error.message : String(error || 'preflight_failed')),
      blockedRequests
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

function classifyRequestForSafety(request) {
  const url = request.url().toLowerCase();
  const method = request.method().toUpperCase();
  const type = request.resourceType();
  if (method !== 'GET') return { allow: false, reason: `blocked_method_${method}` };
  if (url.includes('/mtajax/') || url.includes('addtocart') || url.includes('editcart') || url.includes('check_cart')) {
    return { allow: false, reason: 'blocked_cart_or_calendar_endpoint' };
  }
  if (['xhr', 'fetch', 'websocket', 'eventsource', 'ping'].includes(type)) {
    return { allow: false, reason: `blocked_resource_${type}` };
  }
  return { allow: true, reason: 'allowed' };
}

async function capturePageState(page, response) {
  const httpCode = response ? response.status() : 0;
  const finalUrl = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.content().catch(() => '');
  const text = `${finalUrl}\n${title}\n${body}`;
  return {
    httpCode,
    finalUrl,
    title,
    body,
    snippet: compactSnippet(text.slice(0, 4096))
  };
}

function classifyPageState(pageState) {
  const text = `${pageState.finalUrl}\n${pageState.title}\n${pageState.body}`.toLowerCase();
  if (/chrome-error:\/\/chromewebdata|err_proxy|err_tunnel|err_connection|err_name_not_resolved|this site can.?t be reached/.test(text)) {
    return { status: 'technical_invalid', reason: 'chrome_proxy_or_connection_error' };
  }
  if (pageState.httpCode === 407) return { status: 'technical_invalid', reason: 'http_407_proxy_auth' };
  if (pageState.httpCode === 403 || pageState.httpCode === 429) {
    return { status: 'blocked_or_rate_limited', reason: `http_${pageState.httpCode}_no_invalid_ban` };
  }
  const marker = BLOCK_MARKERS.find((item) => text.includes(item));
  if (marker) return { status: 'blocked_or_rate_limited', reason: `marker_${marker.replace(/\s+/g, '_')}_no_invalid_ban` };
  if (pageState.httpCode >= 200 && pageState.httpCode < 400) return { status: 'healthy', reason: `http_${pageState.httpCode}` };
  if (pageState.httpCode >= 500) return { status: 'transient', reason: `http_${pageState.httpCode}` };
  return { status: 'transient', reason: `http_${pageState.httpCode || 'none'}` };
}

function classifyBrowserError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  if (/auth|407|credentials/.test(message)) return 'browser_auth_fail';
  if (/timeout|timed out|navigation timeout/.test(message)) return 'browser_timeout';
  if (/err_tunnel|tunnel/.test(message)) return 'browser_tunnel_fail';
  if (/err_proxy|proxy/.test(message)) return 'browser_proxy_fail';
  if (/err_name_not_resolved|dns|getaddrinfo/.test(message)) return 'browser_dns_fail';
  if (/err_connection|econn|socket|connection/.test(message)) return 'browser_connect_fail';
  return 'browser_transient_error';
}

function isTechnicalInvalidReason(reason) {
  return /auth|407|timeout|tunnel|proxy|dns|connect|connection|socket/.test(String(reason || '').toLowerCase());
}

function applyBanDecision(record, poolHash, invalidBanMs) {
  if (record.status === 'technical_invalid') {
    const until = Date.now() + invalidBanMs;
    updateBanState((state) => {
      state.poolHash = poolHash;
      state.proxyBans[String(record.index)] = Math.max(Number(state.proxyBans[String(record.index)] || 0), until);
      state.preflightBans[String(record.index)] = {
        poolHash,
        banUntil: state.proxyBans[String(record.index)],
        reason: record.reason,
        checkedAt: Date.now()
      };
      return state;
    });
    record.action = 'banned';
    record.banUntil = until;
    return;
  }

  if (record.status === 'healthy') {
    updateBanState((state) => {
      const key = String(record.index);
      const meta = state.preflightBans && state.preflightBans[key];
      if (meta && meta.poolHash === poolHash && Number(state.proxyBans[key] || 0) === Number(meta.banUntil || 0)) {
        delete state.proxyBans[key];
        delete state.preflightBans[key];
      }
      state.poolHash = poolHash;
      state.clearedBans = state.clearedBans || {};
      return state;
    });
  }

  record.action = 'no_ban';
}

function updateBanState(mutator) {
  const state = normalizeBanState(readJson(BAN_STATE_FILE, {}));
  const next = mutator(state) || state;
  next.savedAt = Date.now();
  writeJsonAtomic(BAN_STATE_FILE, next);
}

function normalizeBanState(state) {
  const next = state && typeof state === 'object' ? { ...state } : {};
  next.proxyBans = next.proxyBans && typeof next.proxyBans === 'object' ? { ...next.proxyBans } : {};
  next.preflightBans = next.preflightBans && typeof next.preflightBans === 'object' ? { ...next.preflightBans } : {};
  return next;
}

function buildRecord({ idx, proxy, startedAt, status, reason, httpCode, finalUrl, snippet = '', blockedRequests = [] }) {
  return {
    index: idx,
    proxyId: String(idx),
    host: proxy.host,
    port: Number(proxy.port),
    status,
    reason,
    httpCode: Number(httpCode || 0),
    finalUrl: finalUrl || '',
    blockedUnsafeRequests: blockedRequests.length,
    blockedUnsafeReasons: Array.from(new Set(blockedRequests)).slice(0, 8),
    timeTotal: (Date.now() - startedAt) / 1000,
    snippet
  };
}

function formatRecord(workerId, record) {
  return [
    `worker=${workerId}`,
    `proxy=#${record.index}`,
    `${record.host}:${record.port}`,
    `status=${record.status}`,
    `reason=${record.reason}`,
    `http=${record.httpCode || 0}`,
    `action=${record.action || 'no_ban'}`,
    `blocked_unsafe=${record.blockedUnsafeRequests || 0}`,
    `time=${record.timeTotal.toFixed(2)}s`
  ].join(' ');
}

function buildTotals(records, configured) {
  const totals = { configured, checked: records.length, actions: {} };
  for (const record of records) {
    totals[record.status] = (totals[record.status] || 0) + 1;
    totals.actions[record.action || 'no_ban'] = (totals.actions[record.action || 'no_ban'] || 0) + 1;
  }
  return totals;
}

function getNodeProxies(config, nodeId) {
  const list = config?.proxies?.[String(nodeId)];
  if (!Array.isArray(list)) return [];
  return list
    .filter((proxy) => proxy && proxy.host && proxy.port)
    .map((proxy) => ({
      host: String(proxy.host),
      port: Number(proxy.port),
      username: proxy.username ? String(proxy.username) : '',
      password: proxy.password ? String(proxy.password) : ''
    }));
}

function hashProxyPool(proxies) {
  const input = proxies
    .map((proxy) => `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`)
    .join('\n');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getPuppeteer() {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  return puppeteer;
}

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return fd;
  } catch {
    const pid = Number(readText(LOCK_FILE).trim());
    if (pid && isProcessAlive(pid)) {
      log(`skip lock_held pid=${pid}`);
      return null;
    }
    try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      return fd;
    } catch {
      log('skip lock_held');
      return null;
    }
  }
}

function releaseLock(fd) {
  try { fs.closeSync(fd); } catch {}
  try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeResult(result) {
  writeJsonAtomic(RESULT_FILE, result);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function log(message) {
  const line = `[${new Date().toISOString()}] [NODE ${NODE_ID || '?'}] ${message}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {}
  console.log(line);
}

function compactSnippet(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function randomInt(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
