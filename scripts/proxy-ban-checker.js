#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const ROOT_DIR = process.env.SNIPER_ROOT || '/root/colosseum-sniper';
const CONFIG_PATH = process.env.SNIPER_CONFIG || path.join(ROOT_DIR, 'config.json');
const NODE_ID = String(process.env.NODE_ID || process.argv[2] || readText(path.join(ROOT_DIR, '.node_id')) || '').trim();
const BASE_INTERVAL_MS = Number(process.env.PROXY_CHECK_INTERVAL_MS || 120000);
const JITTER_MS = Number(process.env.PROXY_CHECK_JITTER_MS || 30000);
const CONNECT_TIMEOUT_SEC = Number(process.env.PROXY_CHECK_CONNECT_TIMEOUT_SEC || 8);
const MAX_TIME_SEC = Number(process.env.PROXY_CHECK_MAX_TIME_SEC || 25);
const CONCURRENCY = Math.max(1, Number(process.env.PROXY_CHECK_CONCURRENCY || 2));
const SCOPE = String(process.env.PROXY_CHECK_SCOPE || 'all').toLowerCase();
const RUN_ONCE = process.env.PROXY_CHECK_ONCE === '1';
const LOG_FILE = process.env.PROXY_CHECK_LOG || `/tmp/proxy-ban-checker-node${NODE_ID || 'unknown'}.log`;
const RESULT_FILE = process.env.PROXY_CHECK_RESULT || `/tmp/sniper-proxy-check-node${NODE_ID || 'unknown'}.json`;
const BAN_STATE_FILE = process.env.PROXY_BAN_STATE_FILE || `/tmp/sniper-proxy-bans-node${NODE_ID || 'unknown'}.json`;
const CHECK_REPORT_TIMEOUT_MS = Number(process.env.PROXY_CHECK_REPORT_TIMEOUT_MS || 1000);
const CHECK_PLAN_TIMEOUT_MS = Number(process.env.PROXY_CHECK_PLAN_TIMEOUT_MS || 1000);
const CHECK_PLAN_LIMIT = process.env.PROXY_CHECK_PLAN_LIMIT ? Number(process.env.PROXY_CHECK_PLAN_LIMIT) : 0;
const NEUTRAL_CHECK_URL = process.env.PROXY_NEUTRAL_CHECK_URL || 'https://api.ipify.org/';
const COLOSSEO_BROWSER_TIMEOUT_MS = Number(process.env.PROXY_COLOSSEO_BROWSER_TIMEOUT_MS || 30000);
const COLOSSEO_BROWSER_SETTLE_MS = Number(process.env.PROXY_COLOSSEO_BROWSER_SETTLE_MS || 1200);
const USER_AGENT = process.env.PROXY_CHECK_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let browserProbePuppeteer = null;

const BLOCK_MARKERS = [
  'hosting provider ip address',
  'you have received a 403 error',
  'you have been blocked',
  'octofence',
  'cf-ray',
  'cloudflare',
  'block_style',
  '/cdn-cgi/',
  'error 403',
];

if (!NODE_ID || !/^\d+$/.test(NODE_ID)) {
  log(`fatal missing NODE_ID argv=${JSON.stringify(process.argv.slice(2))}`);
  process.exit(2);
}

process.on('unhandledRejection', (error) => {
  log(`unhandled rejection ${error && error.stack ? error.stack : error}`);
});

main().catch((error) => {
  log(`fatal ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});

async function main() {
  log(`started node=${NODE_ID} interval_ms=${BASE_INTERVAL_MS} jitter_ms=${JITTER_MS} scope=${SCOPE} concurrency=${CONCURRENCY}`);
  if (RUN_ONCE) {
    await runRound();
    return;
  }
  await sleep(randomInt(0, JITTER_MS));

  while (true) {
    const startedAt = Date.now();
    try {
      await runRound();
    } catch (error) {
      log(`round failed error="${error.message}"`);
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(5000, BASE_INTERVAL_MS + randomInt(0, JITTER_MS) - elapsed);
    await sleep(waitMs);
  }
}

async function runRound() {
  const config = readJson(CONFIG_PATH, null);
  if (!config) {
    log(`config missing path=${CONFIG_PATH}`);
    return;
  }

  if (isSharedProxyPoolEnabled(config)) {
    await runSharedRound(config);
    return;
  }

  const proxies = getNodeProxies(config, NODE_ID);
  if (!proxies.length) {
    log(`no proxies configured node=${NODE_ID}`);
    writeResult({ nodeId: NODE_ID, checkedAt: Date.now(), targetUrl: null, totals: { configured: 0 }, proxies: [] });
    return;
  }

  const targetUrl = getProbeUrl(config);
  const state = readBanState();
  clearExpiredBans(state);
  const now = Date.now();
  const activeBanIndexes = getActiveBanIndexes(state, proxies.length, now);
  const indexes = SCOPE !== 'active' ? proxies.map((_, idx) => idx) : activeBanIndexes;

  log(`round started configured=${proxies.totalCount || proxies.length} shard_size=${proxies.length} active_bans=${activeBanIndexes.length} checked=${indexes.length} target=${targetUrl}`);

  const records = await mapWithConcurrency(indexes, CONCURRENCY, async (idx) => {
    const proxy = proxies[idx];
    const globalIdx = Number.isInteger(Number(proxy.index)) ? Number(proxy.index) : idx;
    const banUntil = Number(state.proxyBans && state.proxyBans[idx] || 0);
    const activeBan = banUntil > Date.now();
    const probe = await probeProxy(proxy, targetUrl, globalIdx);
    const record = {
      index: globalIdx,
      proxyId: String(globalIdx),
      host: proxy.host,
      port: proxy.port,
      activeBan,
      banUntil: activeBan ? banUntil : 0,
      status: probe.status,
      reason: probe.reason,
      httpCode: probe.httpCode,
      exitCode: probe.exitCode,
      remoteIp: probe.remoteIp,
      timeTotal: probe.timeTotal,
      snippet: probe.snippet,
    };

    if (activeBan && probe.status === 'healthy') {
      record.action = clearBanIfUnchanged(idx, banUntil) ? 'cleared' : 'skip_state_changed';
      log(`proxy #${idx} healthy http=${probe.httpCode} remote_ip=${probe.remoteIp || '-'} action=${record.action}`);
    } else if (activeBan) {
      record.action = 'keep';
      log(`proxy #${idx} ${probe.status} http=${probe.httpCode || '-'} reason=${probe.reason} action=keep`);
    } else {
      record.action = 'audit_only';
    }

    return record;
  });

  const totals = records.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc.actions[item.action] = (acc.actions[item.action] || 0) + 1;
    return acc;
  }, { configured: proxies.totalCount || proxies.length, shardSize: proxies.length, checked: indexes.length, activeBans: activeBanIndexes.length, actions: {} });

  writeResult({ nodeId: NODE_ID, checkedAt: Date.now(), targetUrl, scope: SCOPE, totals, proxies: records });
  await reportCheckerResults(config, records, targetUrl).catch((error) => {
    log(`checker report failed error="${error.message}"`);
  });
  log(`round finished checked=${totals.checked} active_bans=${totals.activeBans} healthy=${totals.healthy || 0} blocked=${totals.blocked || 0} rate_limited=${totals.rate_limited || 0} transient=${totals.transient || 0} cleared=${totals.actions.cleared || 0}`);
}

async function runSharedRound(config) {
  const targetUrl = getProbeUrl(config);
  if (isCoordinatorCheckerMode(config) && !isCoordinatorCheckerNode(config)) {
    const coordinatorNodeId = getCoordinatorNodeId(config);
    log(`shared checker disabled on worker node=${NODE_ID} coordinator_node=${coordinatorNodeId}`);
    writeResult({
      nodeId: NODE_ID,
      checkedAt: Date.now(),
      targetUrl,
      scope: 'shared_coordinator_only_worker_idle',
      totals: { configured: 0, planned: 0, checked: 0, actions: {} },
      proxies: [],
      coordinatorNodeId
    });
    return;
  }

  let plan;
  try {
    plan = await fetchCheckerPlan(config, targetUrl);
  } catch (error) {
    log(`shared check-plan unavailable error="${error.message}"`);
    writeResult({
      nodeId: NODE_ID,
      checkedAt: Date.now(),
      targetUrl,
      scope: 'shared_idle_plan_unavailable',
      totals: { configured: 0, planned: 0, checked: 0, actions: {} },
      proxies: [],
      error: error.message
    });
    return;
  }

  if (!plan || !plan.ok) {
    const error = plan?.error || 'check_plan_not_granted';
    log(`shared check-plan skipped error="${error}"`);
    writeResult({
      nodeId: NODE_ID,
      checkedAt: Date.now(),
      targetUrl,
      scope: 'shared_idle_plan_skipped',
      totals: {
        configured: plan?.totalProxies || 0,
        planned: 0,
        checked: 0,
        actions: {}
      },
      proxies: [],
      error,
      activeNodeIds: plan?.activeNodeIds || []
    });
    return;
  }

  const plannedRaw = Array.isArray(plan.proxies) ? plan.proxies : [];
  const colosseoBatchLimit = getColosseoCheckBatchLimit(config);
  let colosseoSlots = colosseoBatchLimit;
  const planned = plannedRaw
    .map((proxy) => {
      if (!proxy.colosseoDue) return proxy;
      if (colosseoSlots <= 0) return { ...proxy, colosseoDue: false, colosseoDeferred: true };
      colosseoSlots -= 1;
      return proxy;
    })
    .filter((proxy) => proxy.neutralDue !== false || proxy.colosseoDue);
  const planScope = isCoordinatorCheckerMode(config) ? 'coordinator_idle' : 'shared_idle';
  const colosseoProbeMode = getColosseoProbeMode(config);
  log(`round started ${planScope} configured=${plan.totalProxies || 0} shard=${(plan.shardIndex ?? '?')}/${plan.shardCount || '?'} planned=${planned.length}/${plannedRaw.length} neutral=${NEUTRAL_CHECK_URL} colosseo=${targetUrl} colosseo_probe=${colosseoProbeMode} colosseo_batch=${colosseoBatchLimit}`);
  if (!planned.length) {
    const totals = {
      configured: plan.totalProxies || 0,
      shardIndex: plan.shardIndex,
      shardCount: plan.shardCount,
      planned: 0,
      checked: 0,
      neutralChecked: 0,
      colosseoChecked: 0,
      skippedColosseo: 0,
      actions: {}
    };
    writeResult({ nodeId: NODE_ID, checkedAt: Date.now(), targetUrl, scope: `${planScope}_plan`, totals, proxies: [] });
    log(`round finished ${planScope} planned=0 checked=0`);
    return;
  }

  const recordGroups = await mapWithConcurrency(planned, CONCURRENCY, async (proxy) => {
    const idx = Number.isInteger(Number(proxy.index)) ? Number(proxy.index) : Number(proxy.proxyId);
    const group = [];
    let neutralOk = true;

    if (proxy.neutralDue !== false) {
      const probe = await probeProxy(proxy, NEUTRAL_CHECK_URL, idx, 'neutral', config);
      const record = buildProbeRecord(proxy, probe, 'neutral', NEUTRAL_CHECK_URL);
      group.push(record);
      neutralOk = probe.status === 'healthy';
      log(`proxy #${idx} neutral ${probe.status} http=${probe.httpCode || '-'} remote_ip=${probe.remoteIp || '-'} reason=${probe.reason}`);
    }

    if (proxy.colosseoDue && neutralOk) {
      const probe = await probeProxy(proxy, targetUrl, idx, 'colosseo', config);
      const record = buildProbeRecord(proxy, probe, 'colosseo', targetUrl);
      group.push(record);
      log(`proxy #${idx} colosseo ${probe.status} http=${probe.httpCode || '-'} remote_ip=${probe.remoteIp || '-'} reason=${probe.reason}`);
    } else if (proxy.colosseoDue && !neutralOk) {
      log(`proxy #${idx} colosseo skipped reason=neutral_failed`);
    }

    return group;
  });

  const records = recordGroups.flat();
  const totals = records.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc.actions[item.action] = (acc.actions[item.action] || 0) + 1;
    if (item.probeType === 'neutral') acc.neutralChecked += 1;
    if (item.probeType === 'colosseo') acc.colosseoChecked += 1;
    return acc;
  }, {
    configured: plan.totalProxies || 0,
    shardIndex: plan.shardIndex,
    shardCount: plan.shardCount,
    planned: planned.length,
    checked: records.length,
    neutralChecked: 0,
    colosseoChecked: 0,
    skippedColosseo: planned.filter((proxy) => proxy.colosseoDue).length,
    actions: {}
  });
  totals.skippedColosseo = Math.max(0, totals.skippedColosseo - totals.colosseoChecked);

  writeResult({ nodeId: NODE_ID, checkedAt: Date.now(), targetUrl, scope: `${planScope}_plan`, totals, proxies: records });
  await reportCheckerResults(config, records, targetUrl).catch((error) => {
    log(`checker report failed error="${error.message}"`);
  });
  log(`round finished ${planScope} planned=${totals.planned} checked=${totals.checked} neutral=${totals.neutralChecked} colosseo=${totals.colosseoChecked} healthy=${totals.healthy || 0} blocked=${totals.blocked || 0} transient=${totals.transient || 0}`);
}

function buildProbeRecord(proxy, probe, probeType, targetUrl) {
  const idx = Number.isInteger(Number(proxy.index)) ? Number(proxy.index) : Number(proxy.proxyId);
  return {
    index: idx,
    proxyId: String(proxy.proxyId ?? idx),
    host: proxy.host,
    port: proxy.port,
    activeBan: false,
    banUntil: 0,
    status: probe.status,
    reason: probe.reason,
    httpCode: probe.httpCode,
    exitCode: probe.exitCode,
    remoteIp: probe.remoteIp,
    timeTotal: probe.timeTotal,
    snippet: probe.snippet,
    action: 'audit_only',
    probeType,
    targetUrl,
    checkedAt: Date.now()
  };
}

function getNodeProxies(config, nodeId) {
  if (isSharedProxyPoolEnabled(config)) {
    return [];
  }
  const raw = config && config.proxies && config.proxies[String(nodeId)];
  return Array.isArray(raw) ? raw.filter((proxy) => proxy && proxy.host && proxy.port) : [];
}

function isSharedProxyPoolEnabled(config) {
  return String(config && config.proxyPool && config.proxyPool.mode || '').toLowerCase() === 'shared_proxy_pool';
}

function isCoordinatorCheckerMode(config) {
  return String(config && config.proxyPool && config.proxyPool.checkerMode || '').toLowerCase() === 'coordinator';
}

function getCoordinatorNodeId(config) {
  const configured = Number(config && config.proxyPool && config.proxyPool.coordinatorNodeId || 0);
  return Number.isInteger(configured) && configured > 0 ? configured : 12;
}

function isCoordinatorCheckerNode(config) {
  return Number(NODE_ID) === getCoordinatorNodeId(config);
}

function getColosseoProbeMode(config) {
  const configured = process.env.PROXY_COLOSSEO_PROBE_MODE || config?.proxyPool?.colosseoProbeMode || 'browser';
  const value = String(configured).toLowerCase();
  if (value === 'curl') return 'curl';
  if (value === 'bot_like' || value === 'bot-like' || value === 'botlike') return 'bot_like';
  return 'browser';
}

function getColosseoCheckBatchLimit(config) {
  const configured = process.env.PROXY_COLOSSEO_CHECK_BATCH_LIMIT ?? config?.proxyPool?.colosseoCheckBatchLimit ?? 12;
  const value = Number(configured);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 12;
}

function getCoordinatorBaseUrl(config) {
  const configured = config && config.proxyPool && config.proxyPool.coordinatorUrl || process.env.PROXY_LEASE_COORDINATOR_URL || '';
  if (configured) return String(configured).replace(/\/+$/, '');
  const host = config && config.coordination && config.coordination.masterIp || process.env.COORDINATOR_IP || '127.0.0.1';
  return `https://${host}:3000`;
}

async function fetchCheckerPlan(config, targetUrl) {
  const url = new URL(`${getCoordinatorBaseUrl(config)}/api/proxy-leases/check-plan`);
  url.searchParams.set('nodeId', NODE_ID);
  if (CHECK_PLAN_LIMIT > 0) url.searchParams.set('limit', String(CHECK_PLAN_LIMIT));
  if (isCoordinatorCheckerMode(config) && isCoordinatorCheckerNode(config)) {
    url.searchParams.set('coordinator', '1');
  }
  if (targetUrl) url.searchParams.set('targetUrl', targetUrl);
  return getJsonWithTimeout(url.toString(), CHECK_PLAN_TIMEOUT_MS);
}

async function reportCheckerResults(config, records, targetUrl) {
  if (!isSharedProxyPoolEnabled(config) || !records.length) return;
  const url = `${getCoordinatorBaseUrl(config)}/api/proxy-leases/checker-result`;
  await postJsonWithTimeout(url, {
    nodeId: Number(NODE_ID),
    checkedAt: Date.now(),
    targetUrl,
    records
  }, CHECK_REPORT_TIMEOUT_MS);
}

function getJsonWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search || ''}`,
      method: 'GET',
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody || '{}'));
        } catch {
          reject(new Error(`invalid_json_http_${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout_${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function postJsonWithTimeout(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload || {});
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve(responseBody));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout_${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getProbeUrl(config) {
  const mode = String(config && config.application && config.application.mode || 'group').toLowerCase();
  const targets = Array.isArray(config.targets) ? config.targets : [];
  const target = targets.find((item) => String(item.type || '').toLowerCase() === mode && item.url) ||
    targets.find((item) => item && item.url);
  return target && target.url ? target.url : 'https://ticketing.colosseo.it/';
}

async function probeProxy(proxy, url, idx, probeType = 'colosseo', config = null) {
  const mode = getColosseoProbeMode(config);
  if (probeType === 'colosseo' && mode !== 'curl') {
    return probeProxyWithBrowser(proxy, url, idx, config, mode);
  }
  return probeProxyWithCurl(proxy, url, idx);
}

async function probeProxyWithCurl(proxy, url, idx) {
  const bodyPath = path.join(os.tmpdir(), `proxy-check-${NODE_ID}-${idx}-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  const args = [
    '-k',
    '-L',
    '-sS',
    '--connect-timeout', String(CONNECT_TIMEOUT_SEC),
    '--max-time', String(MAX_TIME_SEC),
    '--proxy', `http://${proxy.host}:${proxy.port}`,
    '-A', USER_AGENT,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: it-IT,it;q=0.9,en-US;q=0.7,en;q=0.6',
    '-o', bodyPath,
    '-w', ' http_code=%{http_code} remote_ip=%{remote_ip} time_total=%{time_total} url_effective=%{url_effective}',
    url,
  ];
  if (proxy.username) {
    args.splice(9, 0, '--proxy-user', `${proxy.username}:${proxy.password || ''}`);
  }

  const result = await runCommand('curl', args, MAX_TIME_SEC * 1000 + 5000);
  let body = '';
  try {
    body = fs.readFileSync(bodyPath, 'utf8').slice(0, 65536);
  } catch {}
  try {
    fs.unlinkSync(bodyPath);
  } catch {}

  const meta = parseCurlMeta(result.stdout);
  const httpCode = meta.httpCode || 0;
  const bodyLower = body.toLowerCase();
  const stderrLower = String(result.stderr || '').toLowerCase();
  const marker = BLOCK_MARKERS.find((item) => bodyLower.includes(item) || stderrLower.includes(item));
  const snippet = compactSnippet(body || result.stderr || '');

  if (result.exitCode !== 0) {
    return {
      status: 'transient',
      reason: `curl_exit_${result.exitCode}`,
      httpCode,
      exitCode: result.exitCode,
      remoteIp: meta.remoteIp,
      timeTotal: meta.timeTotal,
      snippet,
    };
  }

  if (httpCode === 429) {
    return { status: 'rate_limited', reason: 'http_429', httpCode, exitCode: 0, remoteIp: meta.remoteIp, timeTotal: meta.timeTotal, snippet };
  }
  if (httpCode === 403 || marker) {
    return { status: 'blocked', reason: marker ? `marker_${marker.replace(/\s+/g, '_')}` : 'http_403', httpCode, exitCode: 0, remoteIp: meta.remoteIp, timeTotal: meta.timeTotal, snippet };
  }
  if (httpCode >= 200 && httpCode < 400) {
    return { status: 'healthy', reason: `http_${httpCode}`, httpCode, exitCode: 0, remoteIp: meta.remoteIp, timeTotal: meta.timeTotal, snippet: '' };
  }

  return { status: 'transient', reason: `http_${httpCode || 'none'}`, httpCode, exitCode: 0, remoteIp: meta.remoteIp, timeTotal: meta.timeTotal, snippet };
}

async function probeProxyWithBrowser(proxy, url, idx, config = null, mode = 'browser') {
  const startedAt = Date.now();
  const botLike = mode === 'bot_like';
  const userDataDir = botLike
    ? getBrowserProbeProfileDir(config, idx)
    : path.join(os.tmpdir(), `proxy-browser-check-${NODE_ID}-${idx}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let browser = null;
  try {
    const puppeteer = getBrowserProbePuppeteer();
    const proxyTarget = `${proxy.host}:${proxy.port}`;
    const headless = getBrowserProbeHeadless(config, botLike);
    const display = headless === false ? getBrowserProbeDisplay(config) : '';
    if (headless === false && !display) {
      return {
        status: 'transient',
        reason: 'browser_display_missing',
        httpCode: 0,
        exitCode: 0,
        remoteIp: '',
        timeTotal: (Date.now() - startedAt) / 1000,
        snippet: 'headed bot-like probe requested but no DISPLAY was found'
      };
    }

    fs.mkdirSync(userDataDir, { recursive: true });
    cleanChromeProfileLocks(userDataDir);
    const viewport = botLike ? { width: 1920, height: 1080 } : { width: 1365, height: 768 };
    const args = buildBrowserProbeArgs({ proxyTarget, userDataDir, botLike, viewport });
    const launchOptions = {
      headless,
      executablePath: process.env.CHROME_PATH || config?.proxyPool?.chromePath || '/usr/bin/google-chrome-stable',
      args,
      ignoreHTTPSErrors: true,
      defaultViewport: botLike ? null : viewport,
      env: display
        ? { ...process.env, DISPLAY: display, XAUTHORITY: process.env.XAUTHORITY || config?.proxyPool?.colosseoBrowserXauthority || '/root/.Xauthority' }
        : process.env
    };
    if (botLike) {
      launchOptions.ignoreDefaultArgs = ['--enable-automation', '--user-data-dir'];
    }

    browser = await puppeteer.launch({
      ...launchOptions
    });
    const page = await browser.newPage();
    if (proxy.username) {
      await page.authenticate({ username: proxy.username, password: proxy.password || '' });
    }
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.7,en;q=0.6'
    });

    return await runBrowserColosseoProbe(page, url, startedAt, botLike);
  } catch (error) {
    return {
      status: 'transient',
      reason: classifyBrowserProbeError(error),
      httpCode: 0,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet: compactSnippet(error && error.message ? error.message : String(error || 'browser_probe_failed'))
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (!botLike) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

function buildBrowserProbeArgs({ proxyTarget, userDataDir, botLike, viewport }) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    '--lang=it-IT,it',
    `--proxy-server=http://${proxyTarget}`
  ];
  if (botLike) {
    args.splice(2, 0, '--disable-blink-features=AutomationControlled');
    args.push('--disable-infobars');
    args.push('--password-store=basic');
    args.push('--proxy-bypass-list=prenocolosseo-customer.midaticket.com');
  } else {
    args.push('--disable-background-networking');
    args.push('--disable-extensions');
  }
  return args;
}

function getBrowserProbeHeadless(config, botLike) {
  const configured = process.env.PROXY_COLOSSEO_BROWSER_HEADLESS ?? config?.proxyPool?.colosseoBrowserHeadless;
  if (configured === undefined || configured === null || configured === '') return botLike ? false : 'new';
  if (typeof configured === 'boolean') return configured;
  const value = String(configured).trim().toLowerCase();
  if (['0', 'false', 'no', 'headed', 'visible'].includes(value)) return false;
  if (['1', 'true', 'yes', 'new'].includes(value)) return 'new';
  return configured;
}

function getBrowserProbeDisplay(config) {
  const configured = process.env.PROXY_COLOSSEO_BROWSER_DISPLAY || config?.proxyPool?.colosseoBrowserDisplay;
  if (configured) return String(configured);
  for (const candidate of [
    path.join(os.tmpdir(), `sniper-active-display-node${NODE_ID}`),
    path.join(os.tmpdir(), `sniper-preferred-display-node${NODE_ID}`),
    path.join(os.tmpdir(), 'sniper-active-display'),
    path.join(os.tmpdir(), 'sniper-preferred-display')
  ]) {
    const value = readText(candidate).trim();
    if (/^:\d+(\.\d+)?$/.test(value)) return value;
  }
  try {
    const x11Dir = '/tmp/.X11-unix';
    const displays = fs.readdirSync(x11Dir)
      .map((name) => Number((String(name).match(/^X(\d+)$/) || [])[1]))
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => b - a);
    if (displays.length) return `:${displays[0]}.0`;
  } catch {}
  return process.env.DISPLAY || '';
}

function getBrowserProbeProfileDir(config, idx) {
  const root = process.env.PROXY_COLOSSEO_BROWSER_PROFILE_ROOT
    || config?.proxyPool?.colosseoBrowserProfileRoot
    || '/root/proxy-check-profiles';
  return path.join(root, `proxy-${idx}`);
}

function cleanChromeProfileLocks(userDataDir) {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
    try {
      fs.rmSync(path.join(userDataDir, name), { recursive: true, force: true });
    } catch {}
  }
}

async function runBrowserColosseoProbe(page, url, startedAt, botLike) {
  let response = null;
  let interceptedPayload = null;
  const interceptFn = (request) => {
    if (request.url().includes('/mtajax/calendars_month') && request.method() === 'POST' && request.postData()) {
      interceptedPayload = request.postData();
    }
  };
  page.on('request', interceptFn);

  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: COLOSSEO_BROWSER_TIMEOUT_MS });
  } catch (error) {
    page.off('request', interceptFn);
    return {
      status: 'transient',
      reason: classifyBrowserProbeError(error),
      httpCode: 0,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet: compactSnippet(error && error.message ? error.message : String(error || 'browser_navigation_failed'))
    };
  }

  const waitMs = botLike ? Math.max(15000, COLOSSEO_BROWSER_SETTLE_MS) : COLOSSEO_BROWSER_SETTLE_MS;
  for (let elapsed = 0; elapsed < waitMs && !interceptedPayload; elapsed += 500) {
    await sleep(500);
  }
  page.off('request', interceptFn);

  const pageState = await captureBrowserPageState(page, response);
  const pageDecision = classifyBrowserPageState(pageState, startedAt);
  if (pageDecision) {
    if (botLike && pageDecision.status === 'blocked') {
      interceptedPayload = buildStaticCalendarPayload(url);
      if (!interceptedPayload) return pageDecision;
    } else {
      return pageDecision;
    }
  }

  if (!botLike) {
    if (pageState.httpCode >= 200 && pageState.httpCode < 400) {
      return { status: 'healthy', reason: `browser_http_${pageState.httpCode}`, httpCode: pageState.httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet: '' };
    }
    return { status: 'transient', reason: `browser_http_${pageState.httpCode || 'none'}`, httpCode: pageState.httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet: pageState.snippet };
  }

  if (!interceptedPayload) {
    interceptedPayload = await buildManualCalendarPayload(page, url).catch(() => null);
  }

  if (!interceptedPayload) {
    const domUsable = await detectCalendarDomUsable(page).catch(() => false);
    if (domUsable) {
      return { status: 'healthy', reason: 'bot_like_calendar_dom_usable', httpCode: pageState.httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet: '' };
    }
    return {
      status: 'transient',
      reason: 'bot_like_payload_missing',
      httpCode: pageState.httpCode,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet: pageState.snippet
    };
  }

  const apiResult = await fetchCalendarWithPayload(page, patchCalendarPayload(interceptedPayload, url)).catch((error) => ({
    status: 0,
    hasJson: false,
    marker: '',
    snippet: String(error && error.message ? error.message : error || 'calendar_fetch_failed')
  }));
  return classifyCalendarApiResult(apiResult, pageState.httpCode, startedAt);
}

async function captureBrowserPageState(page, response) {
  const httpCode = response ? response.status() : 0;
  const pageUrl = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.content().catch(() => '');
  const bodyLower = `${pageUrl}\n${title}\n${body}`.toLowerCase();
  const marker = BLOCK_MARKERS.find((item) => bodyLower.includes(item));
  return {
    httpCode,
    pageUrl,
    title,
    body,
    marker,
    snippet: compactSnippet(`${title} ${body}`.slice(0, 4096))
  };
}

function classifyBrowserPageState(pageState, startedAt) {
  const pageText = `${pageState.pageUrl} ${pageState.title} ${pageState.body}`;
  if (/chrome-error:\/\/chromewebdata|err_proxy|err_tunnel|err_connection|this site can.?t be reached/i.test(pageText)) {
    return {
      status: 'transient',
      reason: 'browser_connect_fail',
      httpCode: pageState.httpCode,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet: pageState.snippet
    };
  }
  if (pageState.httpCode === 429) {
    return { status: 'rate_limited', reason: 'http_429_browser', httpCode: pageState.httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet: pageState.snippet };
  }
  if (pageState.httpCode === 403 || pageState.marker) {
    return {
      status: 'blocked',
      reason: pageState.marker ? `browser_marker_${pageState.marker.replace(/\s+/g, '_')}` : 'http_403_browser',
      httpCode: pageState.httpCode,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet: pageState.snippet
    };
  }
  return null;
}

async function buildManualCalendarPayload(page, targetUrl) {
  const { year, month } = getTargetMonthParts(targetUrl);
  return page.evaluate(({ year, month }) => {
    const html = document.body ? document.body.innerHTML : '';
    const match = html.match(/"entranceEvent_guid"\s*(?:=>|:)\s*"([a-f0-9\-]{36})/i)
      || html.match(/name="entranceEvent_guid"\s*value="([a-f0-9\-]{36})/i);
    if (!match) return null;
    return `action=midaabc_calendars_month&guids[entranceEvent_guid][]=${match[1]}&year=${year}&month=${month}&day=`;
  }, { year, month });
}

function getTargetMonthParts(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const tParam = parsed.searchParams.get('t');
    if (tParam) {
      const date = new Date(tParam);
      if (!Number.isNaN(date.getTime())) {
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
      }
    }
  } catch {}
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function buildStaticCalendarPayload(targetUrl) {
  let pageId = null;
  const url = String(targetUrl || '');
  if (url.includes('/24h-colosseo-foro-romano-palatino-gruppi/')) pageId = 332;
  if (!pageId && url.includes('/24h-colosseo-foro-romano-palatino/')) pageId = 35;
  if (!pageId) return null;

  const { year, month } = getTargetMonthParts(targetUrl);
  const params = new URLSearchParams();
  params.set('action', 'midaabc_calendars_month');
  params.set('page', String(pageId));
  params.set('year', String(year));
  params.set('month', String(month));
  params.set('day', '');
  return params.toString();
}

function patchCalendarPayload(payload, targetUrl) {
  const { year, month } = getTargetMonthParts(targetUrl);
  let result = String(payload || '');
  result = /(^|&)year=\d+/.test(result) ? result.replace(/(^|&)year=\d+/, `$1year=${year}`) : `${result}&year=${year}`;
  result = /(^|&)month=\d+/.test(result) ? result.replace(/(^|&)month=\d+/, `$1month=${month}`) : `${result}&month=${month}`;
  return result;
}

async function fetchCalendarWithPayload(page, payload) {
  return page.evaluate(async (pData) => {
    const res = await fetch('/mtajax/calendars_month', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: pData
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    const lower = text.toLowerCase();
    const markers = ['octofence', 'cloudflare', 'cf-ray', 'block_style', '403 error', 'you have been blocked'];
    const marker = markers.find((item) => lower.includes(item)) || '';
    return {
      status: res.status,
      hasJson: data !== null,
      marker,
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 500)
    };
  }, payload);
}

function classifyCalendarApiResult(apiResult, pageHttpCode, startedAt) {
  const httpCode = Number(apiResult.status || pageHttpCode || 0);
  const marker = apiResult.marker || '';
  const snippet = compactSnippet(apiResult.snippet || '');
  if (httpCode === 429) {
    return { status: 'rate_limited', reason: 'bot_like_calendar_http_429', httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet };
  }
  if (httpCode === 403 || marker) {
    return {
      status: 'blocked',
      reason: marker ? `bot_like_calendar_marker_${marker.replace(/\s+/g, '_')}` : 'bot_like_calendar_http_403',
      httpCode,
      exitCode: 0,
      remoteIp: '',
      timeTotal: (Date.now() - startedAt) / 1000,
      snippet
    };
  }
  if (httpCode >= 200 && httpCode < 300 && apiResult.hasJson) {
    return { status: 'healthy', reason: `bot_like_calendar_json_${httpCode}`, httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet: '' };
  }
  if (httpCode >= 200 && httpCode < 300) {
    return { status: 'transient', reason: `bot_like_calendar_non_json_${httpCode}`, httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet };
  }
  return { status: 'transient', reason: `bot_like_calendar_http_${httpCode || 'none'}`, httpCode, exitCode: 0, remoteIp: '', timeTotal: (Date.now() - startedAt) / 1000, snippet };
}

async function detectCalendarDomUsable(page) {
  return page.evaluate(() => {
    const html = document.body ? document.body.innerHTML : '';
    const text = document.body ? document.body.innerText : '';
    return Boolean(
      document.querySelector('.ui-datepicker-calendar, .datepicker, [data-date], [data-slot], [class*="calendar"]')
      || /midaabc_calendars_month|entranceEvent_guid|calendar|calendario/i.test(html)
      || /non ci sono|nessuna disponibilit|sold out|not available|esaurit/i.test(text)
    );
  });
}

function getBrowserProbePuppeteer() {
  if (browserProbePuppeteer) return browserProbePuppeteer;
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  browserProbePuppeteer = puppeteer;
  return browserProbePuppeteer;
}

function classifyBrowserProbeError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  if (/auth|407|credentials/.test(message)) return 'browser_auth_fail';
  if (/proxy|tunnel|econn|timed out|timeout|net::err|connection|socket|navigation/.test(message)) return 'browser_connect_fail';
  return 'browser_probe_error';
}

function parseCurlMeta(stdout) {
  const text = String(stdout || '');
  const httpCode = Number((text.match(/http_code=(\d+)/) || [])[1] || 0);
  const remoteIp = (text.match(/remote_ip=([^ ]*)/) || [])[1] || '';
  const timeTotal = Number((text.match(/time_total=([0-9.]+)/) || [])[1] || 0);
  return { httpCode, remoteIp, timeTotal };
}

function readBanState() {
  const state = readJson(BAN_STATE_FILE, {});
  if (!state.proxyBans || typeof state.proxyBans !== 'object') state.proxyBans = {};
  return state;
}

function getActiveBanIndexes(state, proxyCount, now) {
  const result = [];
  for (let idx = 0; idx < proxyCount; idx++) {
    if (Number(state.proxyBans[idx] || 0) > now) result.push(idx);
  }
  return result;
}

function clearExpiredBans(state) {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(state.proxyBans || {})) {
    if (Number(state.proxyBans[key] || 0) <= now) {
      delete state.proxyBans[key];
      changed = true;
    }
  }
  if (changed) {
    state.savedAt = Date.now();
    atomicWriteJson(BAN_STATE_FILE, state);
  }
}

function clearBanIfUnchanged(idx, observedBanUntil) {
  const latest = readBanState();
  if (Number(latest.proxyBans[idx] || 0) !== Number(observedBanUntil)) return false;
  delete latest.proxyBans[idx];
  if (!latest.clearedBans || typeof latest.clearedBans !== 'object') latest.clearedBans = {};
  latest.clearedBans[idx] = {
    banUntil: Number(observedBanUntil),
    clearedAt: Date.now(),
    by: 'proxy-ban-checker',
  };
  latest.savedAt = Date.now();
  latest.checkedBy = 'proxy-ban-checker';
  atomicWriteJson(BAN_STATE_FILE, latest);
  return true;
}

function writeResult(payload) {
  atomicWriteJson(RESULT_FILE, payload);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function atomicWriteJson(file, payload) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : (code || 0), signal, stdout, stderr, timedOut });
    });
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function compactSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  const line = `[${new Date().toISOString()}] [PROXY CHECKER] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {}
}
