const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, RAW_PROXY_SOURCE_PATH } = require('./config-store');
const { parseProxyFile } = require('./proxy-service');

const STATE_PATH = path.join(__dirname, 'data', 'proxy-leases.json');
const DEFAULT_LEASE_TTL_MS = 180000;
const DEFAULT_NEUTRAL_CHECK_INTERVAL_MS = 120000;
const DEFAULT_COLOSSEO_CHECK_INTERVAL_MS = 600000;
const CHECKER_LOG_LIMIT = 300;
const HEALTH_TTL_MS = {
  ok: 0,
  waf_pressure: 30 * 60 * 1000,
  cart_pressure: 3 * 60 * 1000,
  blocked: 60 * 60 * 1000,
  connect_fail: 10 * 60 * 1000,
  auth_fail: 60 * 60 * 1000
};
const HEALTH_SCORE = {
  ok: 0,
  waf_pressure: 30,
  cart_pressure: 25,
  blocked: 70,
  connect_fail: 60,
  auth_fail: 100
};

function isSharedProxyPoolEnabled(config) {
  return String(config?.proxyPool?.mode || '').toLowerCase() === 'shared_proxy_pool';
}

function getActiveNodeIds(config) {
  const explicit = Array.isArray(config?.proxyPool?.activeNodeIds)
    ? config.proxyPool.activeNodeIds
    : (Array.isArray(config?.scheduler?.activeNodeIds) ? config.scheduler.activeNodeIds : []);
  const disabled = new Set(
    (Array.isArray(config?.proxyPool?.disabledNodeIds) ? config.proxyPool.disabledNodeIds : [2])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  const ids = explicit
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && !disabled.has(value));
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function getCoordinatorNodeId(config) {
  const configured = Number(config?.proxyPool?.coordinatorNodeId || 0);
  return Number.isInteger(configured) && configured > 0 ? configured : 12;
}

function getCheckerMode(config) {
  return String(config?.proxyPool?.checkerMode || 'distributed').toLowerCase();
}

function getProxySourcePath(config) {
  const configured = config?.proxyPool?.sourceFile || 'Webshare 2500 proxies.txt';
  return path.isAbsolute(configured) ? configured : path.join(PROJECT_ROOT, configured);
}

function flattenConfiguredProxies(config) {
  const seen = new Set();
  const result = [];
  const disabled = new Set(getDisabledNodeIds(config));
  const pools = config?.proxies && typeof config.proxies === 'object' ? config.proxies : {};
  for (const [nodeId, proxies] of Object.entries(pools)) {
    if (disabled.has(Number(nodeId)) || !Array.isArray(proxies)) continue;
    for (const proxy of proxies) {
      if (!proxy?.host || !proxy?.port) continue;
      const key = `${proxy.host}:${proxy.port}:${proxy.username || ''}:${proxy.password || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(proxy);
    }
  }
  return result;
}

function getDisabledNodeIds(config) {
  const ids = Array.isArray(config?.proxyPool?.disabledNodeIds) ? config.proxyPool.disabledNodeIds : [2];
  return ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
}

function loadProxyInventory(config) {
  const sourcePath = getProxySourcePath(config);
  let proxies = [];
  let source = sourcePath;
  let sourceError = null;
  try {
    proxies = parseProxyFile(sourcePath).proxies;
  } catch (error) {
    sourceError = error.message;
    source = 'config.proxies';
    proxies = flattenConfiguredProxies(config);
  }

  return {
    source,
    sourceError,
    proxies: proxies.map((proxy, index) => ({
      proxyId: String(index),
      index,
      host: proxy.host,
      port: Number(proxy.port),
      username: proxy.username || '',
      password: proxy.password || ''
    }))
  };
}

function readState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return { proxies: {}, checkerLog: [], savedAt: 0 };
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  state.savedAt = Date.now();
  const tmpPath = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATE_PATH);
}

function ensureStateForInventory(state, inventory) {
  if (!state.proxies || typeof state.proxies !== 'object') state.proxies = {};
  if (!Array.isArray(state.checkerLog)) state.checkerLog = [];
  const now = Date.now();
  for (const proxy of inventory.proxies) {
    const existing = state.proxies[proxy.proxyId] || {};
    state.proxies[proxy.proxyId] = {
      proxyId: proxy.proxyId,
      index: proxy.index,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      leaseOwnerNodeId: existing.leaseOwnerNodeId || null,
      leaseUntilMs: Number(existing.leaseUntilMs || 0),
      healthStatus: existing.healthStatus || 'ok',
      penaltyUntilMs: Number(existing.penaltyUntilMs || 0),
      lastUsedAt: Number(existing.lastUsedAt || 0),
      lastCheckedAt: Number(existing.lastCheckedAt || 0),
      lastNeutralCheckedAt: Number(existing.lastNeutralCheckedAt || 0),
      lastColosseoCheckedAt: Number(existing.lastColosseoCheckedAt || 0),
      lastReportedAt: Number(existing.lastReportedAt || 0),
      lastRuntimeReport: existing.lastRuntimeReport || null,
      lastRuntimeHealthyAt: Number(existing.lastRuntimeHealthyAt || 0),
      lastRuntimeHealthyStatus: existing.lastRuntimeHealthyStatus || '',
      lastCheckerResult: existing.lastCheckerResult || null,
      lastNeutralResult: existing.lastNeutralResult || (existing.lastCheckerResult?.probeType === 'neutral' ? existing.lastCheckerResult : null),
      lastColosseoResult: existing.lastColosseoResult || (existing.lastCheckerResult?.probeType === 'colosseo' ? existing.lastCheckerResult : null),
      score: Number(existing.score || 0),
      updatedAt: Number(existing.updatedAt || now)
    };
  }
  return state;
}

function normalizeProxyId(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) return String(numeric);
  return String(value);
}

function normalizeHealthEvent(event, context = '') {
  const value = `${event || ''} ${context || ''}`.toLowerCase();
  if (/blocked/.test(value)) return 'blocked';
  if (/auth/.test(value)) return 'auth_fail';
  if (/connect|timeout|curl_exit|net::|proxy_error|chrome-error|site can.?t be reached|tunnel|econn|socket|navigation/.test(value)) return 'connect_fail';
  if (/cart|429|rate/.test(value)) return 'cart_pressure';
  if (/waf|403|block|octofence/.test(value)) return 'waf_pressure';
  if (/healthy|ok|success/.test(value)) return 'ok';
  return 'waf_pressure';
}

function getLeaseStaleGraceMs(config) {
  return Math.max(0, Number(config?.proxyPool?.leaseStaleGraceMs || 15 * 60 * 1000));
}

function getLeaseLastActivityMs(record) {
  const runtimeAt = Number(record.lastRuntimeReport?.at || 0);
  return Math.max(
    Number(record.lastUsedAt || 0),
    Number(record.lastReportedAt || 0),
    runtimeAt
  );
}

function isLeaseFree(record, now, config = null) {
  if (!record.leaseOwnerNodeId) return true;
  if (Number(record.leaseUntilMs || 0) > now) return false;
  const graceMs = getLeaseStaleGraceMs(config);
  if (graceMs > 0) {
    const lastActivityMs = getLeaseLastActivityMs(record);
    if (lastActivityMs > 0 && now - lastActivityMs <= graceMs) return false;
  }
  return true;
}

function getHealthPenaltyMs(config, healthStatus) {
  if (healthStatus === 'waf_pressure') return Math.max(60000, Number(config?.proxyPool?.wafPenaltyMs || HEALTH_TTL_MS.waf_pressure));
  if (healthStatus === 'blocked') return Math.max(60000, Number(config?.proxyPool?.blockedPenaltyMs || HEALTH_TTL_MS.blocked));
  if (healthStatus === 'connect_fail') return Math.max(60000, Number(config?.proxyPool?.connectPenaltyMs || HEALTH_TTL_MS.connect_fail));
  if (healthStatus === 'cart_pressure') return Math.max(30000, Number(config?.proxyPool?.cartPenaltyMs || HEALTH_TTL_MS.cart_pressure));
  if (healthStatus === 'auth_fail') return Math.max(60000, Number(config?.proxyPool?.authPenaltyMs || HEALTH_TTL_MS.auth_fail));
  return HEALTH_TTL_MS[healthStatus] || HEALTH_TTL_MS.waf_pressure;
}

function hasRecentColosseoHealthy(record, now, config) {
  if (config?.proxyPool?.requireColosseoHealthyForLease === false) return true;
  const ttlMs = Math.max(60000, Number(config?.proxyPool?.colosseoHealthyTtlMs || 15 * 60 * 1000));
  const result = record.lastColosseoResult || record.lastCheckerResult || {};
  return result.probeType === 'colosseo'
    && result.status === 'healthy'
    && isAcceptedColosseoProof(result, config)
    && Number(result.at || 0) > 0
    && now - Number(result.at || 0) <= ttlMs;
}

function hasRecentNeutralHealthy(record, now, config) {
  if (config?.proxyPool?.allowNeutralHealthyForLease !== true) return false;
  const ttlMs = Math.max(60000, Number(config?.proxyPool?.neutralHealthyTtlMs || 10 * 60 * 1000));
  const result = record.lastNeutralResult || (record.lastCheckerResult?.probeType === 'neutral' ? record.lastCheckerResult : null) || {};
  return result.probeType === 'neutral'
    && result.status === 'healthy'
    && Number(result.at || 0) > 0
    && now - Number(result.at || 0) <= ttlMs;
}

function isAcceptedColosseoProof(result, config) {
  if (config?.proxyPool?.requireBotLikeColosseoProofForLease === false) return true;
  const reason = String(result?.reason || '').toLowerCase();
  return reason.startsWith('bot_like_calendar_json_') || reason === 'bot_like_calendar_dom_usable';
}

function hasRecentRuntimeHealthy(record, now, config) {
  const ttlMs = Math.max(60000, Number(config?.proxyPool?.runtimeHealthyTtlMs || 30 * 60 * 1000));
  const at = Number(record.lastRuntimeHealthyAt || 0);
  if (at <= 0 || now - at > ttlMs) return false;
  const healthyStatus = String(record.lastRuntimeHealthyStatus || '');
  if (healthyStatus.startsWith('runtime_log_import') && config?.proxyPool?.allowImportedRuntimeProofForLease !== true) {
    return false;
  }

  const lastRuntime = record.lastRuntimeReport || {};
  const lastRuntimeAt = Number(lastRuntime.at || 0);
  if (lastRuntimeAt > at) {
    const event = String(lastRuntime.event || '');
    if (!['release', 'lease_refresh'].includes(event)) {
      const lastHealth = normalizeHealthEvent(event, lastRuntime.context || '');
      if (lastHealth !== 'ok') return false;
    }
  }
  return true;
}

function hasRecentLeaseProof(record, now, config) {
  return hasRecentRuntimeHealthy(record, now, config)
    || hasRecentColosseoHealthy(record, now, config)
    || hasRecentNeutralHealthy(record, now, config);
}

function isLeaseEligible(record, now, config) {
  if (!isLeaseFree(record, now, config)) return false;
  normalizeExpiredHealth(record, now, config);
  const runtimeHealthy = hasRecentRuntimeHealthy(record, now, config);
  if (record.healthStatus !== 'ok' && !runtimeHealthy) return false;
  return hasRecentLeaseProof(record, now, config);
}

function isRuntimeReportEventIgnored(event) {
  return ['release', 'lease_refresh', 'acquire'].includes(String(event || ''));
}

function getLatestRuntimeBad(record, now, config = null) {
  const candidates = [];
  if (record.lastReportEvent && Number(record.lastReportedAt || 0) > 0) {
    candidates.push({
      at: Number(record.lastReportedAt || 0),
      event: record.lastReportEvent,
      context: record.lastReportContext || ''
    });
  }
  if (record.lastRuntimeReport && Number(record.lastRuntimeReport.at || 0) > 0) {
    candidates.push({
      at: Number(record.lastRuntimeReport.at || 0),
      event: record.lastRuntimeReport.event || '',
      context: record.lastRuntimeReport.context || ''
    });
  }

  candidates.sort((a, b) => b.at - a.at);
  for (const item of candidates) {
    if (isRuntimeReportEventIgnored(item.event)) continue;
    const healthStatus = normalizeHealthEvent(item.event, item.context);
    if (healthStatus === 'ok') return null;
    const untilMs = item.at + getHealthPenaltyMs(config, healthStatus);
    if (untilMs > now) return { healthStatus, untilMs, at: item.at };
  }
  return null;
}

function normalizeExpiredHealth(record, now, config = null) {
  const runtimeBad = getLatestRuntimeBad(record, now, config);
  if (runtimeBad && (
    record.healthStatus === 'ok'
    || Number(record.penaltyUntilMs || 0) < runtimeBad.untilMs
  )) {
    record.healthStatus = runtimeBad.healthStatus;
    record.penaltyUntilMs = runtimeBad.untilMs;
    record.score = Math.min(1000, Math.max(Number(record.score || 0), HEALTH_SCORE[runtimeBad.healthStatus] || 25));
    return;
  }

  if (record.healthStatus !== 'ok' && Number(record.penaltyUntilMs || 0) <= now) {
    record.healthStatus = 'ok';
    record.penaltyUntilMs = 0;
    record.score = Math.max(0, Number(record.score || 0) - 10);
  }
}

function candidateScore(record, now, config) {
  normalizeExpiredHealth(record, now, config);
  const leasePenalty = isLeaseFree(record, now, config) ? 0 : 1000;
  const healthPenalty = HEALTH_SCORE[record.healthStatus] ?? 50;
  const proofPenalty = hasRecentRuntimeHealthy(record, now, config)
    ? 0
    : (hasRecentColosseoHealthy(record, now, config)
      ? 10
      : (hasRecentNeutralHealthy(record, now, config) ? 150 : 300));
  const recentPenalty = Math.max(0, 30 - Math.floor((now - Number(record.lastUsedAt || 0)) / 1000));
  return leasePenalty + healthPenalty + proofPenalty + Number(record.score || 0) + recentPenalty;
}

function positiveModulo(value, divisor) {
  if (!divisor) return 0;
  return ((value % divisor) + divisor) % divisor;
}

function getSelectionCycleMs(config) {
  return Math.max(30000, Number(config?.scheduler?.cycleMs || 63000));
}

function getProxySelectionOffset(records, nodeId, now, config) {
  const total = Math.max(1, records.length);
  const activeNodeIds = getActiveNodeIds(config);
  const slotIndex = Math.max(0, activeNodeIds.indexOf(Number(nodeId)));
  const stride = Math.max(1, Math.floor(total / Math.max(1, activeNodeIds.length)));
  const cycleShift = positiveModulo(Math.floor(now / getSelectionCycleMs(config)) * activeNodeIds.length, total);
  return positiveModulo((slotIndex * stride) + cycleShift, total);
}

function selectionDistance(record, offset, total) {
  const index = Number(record.index ?? record.proxyId ?? 0);
  return positiveModulo(index - offset, Math.max(1, total));
}

function getCheckerPlanPriority(entry, now, config) {
  const record = entry.record;
  const hasProof = hasRecentLeaseProof(record, now, config);
  const penaltyActive = Number(record.penaltyUntilMs || 0) > now;
  if (record.healthStatus === 'ok' && !hasProof) return 0;
  if (record.healthStatus === 'ok' && entry.neutralDue) return 1;
  if (record.healthStatus === 'ok') return 2;
  if (record.healthStatus === 'cart_pressure' && !penaltyActive) return 3;
  if (['connect_fail', 'auth_fail'].includes(record.healthStatus)) return 4;
  if (record.healthStatus === 'waf_pressure' && !penaltyActive) return 5;
  if (record.healthStatus === 'waf_pressure') return 8;
  return 6;
}

function selectCandidate(records, now, avoidProxyId, config, nodeId) {
  let freeRecords = records.filter((record) => isLeaseEligible(record, now, config));
  let unverifiedFallback = false;
  if (freeRecords.length === 0 && config?.proxyPool?.allowUnverifiedLeaseWhenNoEligible !== false) {
    freeRecords = records.filter((record) => {
      if (!isLeaseFree(record, now, config)) return false;
      normalizeExpiredHealth(record, now, config);
      if (Number(record.penaltyUntilMs || 0) > now) return false;
      return record.healthStatus === 'ok';
    });
    unverifiedFallback = freeRecords.length > 0;
  }
  const total = Math.max(1, records.length);
  const offset = getProxySelectionOffset(records, nodeId, now, config);
  const sorted = freeRecords
    .map((record) => ({
      record,
      score: candidateScore(record, now, config)
        + (unverifiedFallback ? 500 : 0)
        + (avoidProxyId && record.proxyId === avoidProxyId ? 200 : 0),
      distance: selectionDistance(record, offset, total)
    }))
    .sort((a, b) => a.score - b.score || a.distance - b.distance || Number(a.record.proxyId) - Number(b.record.proxyId));
  const selected = sorted[0]?.record || null;
  if (selected) selected.lastSelectionFallback = unverifiedFallback ? 'unverified_ok_no_eligible' : '';
  return selected;
}

function isPreloadLeaseRequest(reason) {
  const text = String(reason || '').toLowerCase();
  return text === 'preload' || text.startsWith('preload_') || text.includes('_preload');
}

function releaseNodeLeasesBeforeAcquire(records, nodeId, now, reason) {
  const preloadRequest = isPreloadLeaseRequest(reason);
  let released = 0;

  for (const record of records) {
    if (Number(record.leaseOwnerNodeId) !== nodeId) continue;

    const previousAcquireReason = record.lastAcquireReason || record.lastRuntimeReport?.context || '';
    if (preloadRequest && !isPreloadLeaseRequest(previousAcquireReason)) continue;

    record.leaseOwnerNodeId = null;
    record.leaseUntilMs = 0;
    record.lastRuntimeReport = {
      at: now,
      nodeId,
      event: 'release',
      context: `auto_release_before_acquire:${reason || 'browser_start'}`,
      currentProxyIndex: null,
      previousProxyId: record.proxyId,
      previousAcquireReason
    };
    record.updatedAt = now;
    released += 1;
  }

  return released;
}

function appendCheckerLog(state, entry) {
  if (!Array.isArray(state.checkerLog)) state.checkerLog = [];
  state.checkerLog.push({
    at: Date.now(),
    proxyId: entry.proxyId,
    index: entry.index,
    nodeId: entry.nodeId,
    probeType: entry.probeType,
    status: entry.status,
    reason: entry.reason,
    httpCode: entry.httpCode || 0,
    remoteIp: entry.remoteIp || '',
    targetUrl: entry.targetUrl || ''
  });
  if (state.checkerLog.length > CHECKER_LOG_LIMIT) {
    state.checkerLog = state.checkerLog.slice(-CHECKER_LOG_LIMIT);
  }
}

function getCheckIntervals(config) {
  return {
    neutralIntervalMs: Math.max(30000, Number(config?.proxyPool?.neutralCheckIntervalMs || DEFAULT_NEUTRAL_CHECK_INTERVAL_MS)),
    colosseoIntervalMs: Math.max(120000, Number(config?.proxyPool?.colosseoCheckIntervalMs || DEFAULT_COLOSSEO_CHECK_INTERVAL_MS))
  };
}

function buildProxyPublicView(record, now, config = null) {
  const leased = !isLeaseFree(record, now, config);
  return {
    proxyId: record.proxyId,
    index: record.index,
    host: record.host,
    port: record.port,
    leaseOwnerNodeId: leased ? record.leaseOwnerNodeId : null,
    leaseUntilMs: leased ? record.leaseUntilMs : 0,
    leaseTtlRemainingMs: leased ? Math.max(0, Number(record.leaseUntilMs || 0) - now) : 0,
    healthStatus: record.healthStatus,
    penaltyUntilMs: record.penaltyUntilMs,
    lastUsedAt: record.lastUsedAt,
    lastCheckedAt: record.lastCheckedAt,
    lastNeutralCheckedAt: record.lastNeutralCheckedAt,
    lastColosseoCheckedAt: record.lastColosseoCheckedAt,
    lastReportedAt: record.lastReportedAt,
    lastRuntimeHealthyAt: record.lastRuntimeHealthyAt || 0,
    lastRuntimeHealthyStatus: record.lastRuntimeHealthyStatus || '',
    lastRuntimeReport: record.lastRuntimeReport || null,
    lastCheckerResult: record.lastCheckerResult || null,
    lastNeutralResult: record.lastNeutralResult || null,
    lastColosseoResult: record.lastColosseoResult || null,
    score: record.score
  };
}

function acquireProxyLease(config, request = {}) {
  if (!isSharedProxyPoolEnabled(config)) {
    return { ok: false, error: 'shared_proxy_pool_disabled' };
  }

  const nodeId = Number(request.nodeId);
  const activeNodeIds = getActiveNodeIds(config);
  if (!Number.isInteger(nodeId) || !activeNodeIds.includes(nodeId)) {
    return { ok: false, error: 'node_not_active_for_shared_pool', activeNodeIds };
  }

  const inventory = loadProxyInventory(config);
  const state = ensureStateForInventory(readState(), inventory);
  const now = Date.now();
  const avoidProxyId = normalizeProxyId(request.avoidProxyId ?? request.currentProxyId);
  const records = Object.values(state.proxies).filter((record) => inventory.proxies.some((proxy) => proxy.proxyId === record.proxyId));
  const releasedExistingLeases = releaseNodeLeasesBeforeAcquire(records, nodeId, now, request.reason || '');
  const selected = selectCandidate(records, now, avoidProxyId, config, nodeId);
  if (!selected) {
    const leasedRecords = records.filter((record) => !isLeaseFree(record, now, config));
    const eligibleFree = records.filter((record) => isLeaseEligible(record, now, config)).length;
    const freeRecords = records.filter((record) => isLeaseFree(record, now, config));
    const nextLeaseUntilMs = leasedRecords
      .map((record) => Number(record.leaseUntilMs || 0))
      .filter((value) => value > now)
      .sort((a, b) => a - b)[0] || 0;
    const nextPenaltyUntilMs = freeRecords
      .map((record) => Number(record.penaltyUntilMs || 0))
      .filter((value) => value > now)
      .sort((a, b) => a - b)[0] || 0;
    writeState(state);
    return {
      ok: false,
      error: records.length ? 'no_verified_proxy_lease' : 'no_proxies_available',
      totalProxies: inventory.proxies.length,
      leased: leasedRecords.length,
      free: freeRecords.length,
      eligibleFree,
      releasedExistingLeases,
      retryAfterMs: nextLeaseUntilMs
        ? Math.max(1000, Math.min(10000, nextLeaseUntilMs - now))
        : (nextPenaltyUntilMs ? Math.max(3000, Math.min(30000, nextPenaltyUntilMs - now)) : 5000),
      requireColosseoHealthyForLease: config?.proxyPool?.requireColosseoHealthyForLease !== false,
      activeNodeIds
    };
  }

  const ttlMs = Math.max(30000, Number(config?.proxyPool?.leaseTtlMs || DEFAULT_LEASE_TTL_MS));
  selected.leaseOwnerNodeId = nodeId;
  selected.leaseUntilMs = now + ttlMs;
  selected.lastUsedAt = now;
  selected.updatedAt = now;
  selected.lastAcquireReason = request.reason || '';
  selected.score = Math.max(0, Number(selected.score || 0) - 1);
  selected.lastRuntimeReport = {
    at: now,
    nodeId,
    event: 'acquire',
    context: request.reason || '',
    currentProxyIndex: request.currentProxyId ?? null
  };
  writeState(state);

  return {
    ok: true,
    proxy: {
      proxyId: selected.proxyId,
      index: selected.index,
      host: selected.host,
      port: selected.port,
      username: selected.username,
      password: selected.password
    },
    leaseOwnerNodeId: nodeId,
    leaseUntilMs: selected.leaseUntilMs,
    leaseTtlMs: ttlMs,
    releasedExistingLeases,
    inventorySource: inventory.source,
    inventorySourceError: inventory.sourceError,
    totalProxies: inventory.proxies.length,
    activeNodeIds
  };
}

function reportProxyHealth(config, request = {}) {
  const proxyId = normalizeProxyId(request.proxyId ?? request.index);
  const nodeId = Number(request.nodeId);
  if (proxyId === null) return { ok: false, error: 'proxyId_required' };

  const inventory = loadProxyInventory(config);
  const state = ensureStateForInventory(readState(), inventory);
  const record = state.proxies[proxyId];
  if (!record) {
    writeState(state);
    return { ok: false, error: 'proxy_not_found', proxyId };
  }

  const now = Date.now();
  const event = String(request.event || request.status || '');
  if (event === 'release') {
    if (!record.leaseOwnerNodeId || record.leaseOwnerNodeId === nodeId) {
      record.leaseOwnerNodeId = null;
      record.leaseUntilMs = 0;
    }
    record.lastRuntimeReport = {
      at: now,
      nodeId,
      event,
      context: request.context || request.reason || '',
      currentProxyIndex: request.currentProxyIndex ?? null
    };
  } else if (event === 'lease_refresh') {
    if (record.leaseOwnerNodeId && record.leaseOwnerNodeId !== nodeId && !isLeaseFree(record, now, config)) {
      writeState(state);
      return {
        ok: false,
        error: 'lease_owner_conflict',
        proxyId,
        leaseOwnerNodeId: record.leaseOwnerNodeId,
        leaseUntilMs: record.leaseUntilMs
      };
    }
    normalizeExpiredHealth(record, now, config);
    if (record.healthStatus !== 'ok' && Number(record.penaltyUntilMs || 0) > now) {
      if (!record.leaseOwnerNodeId || record.leaseOwnerNodeId === nodeId) {
        record.leaseOwnerNodeId = null;
        record.leaseUntilMs = 0;
      }
      record.lastRuntimeReport = {
        at: now,
        nodeId,
        event,
        context: `ignored_penalized:${request.context || request.reason || ''}`,
        currentProxyIndex: request.currentProxyIndex ?? null
      };
      record.updatedAt = now;
      writeState(state);
      return {
        ok: false,
        error: 'lease_health_penalized',
        proxyId,
        healthStatus: record.healthStatus,
        penaltyUntilMs: record.penaltyUntilMs
      };
    }
    const ttlMs = Math.max(30000, Number(config?.proxyPool?.leaseTtlMs || DEFAULT_LEASE_TTL_MS));
    record.leaseOwnerNodeId = nodeId;
    record.leaseUntilMs = now + ttlMs;
    record.lastUsedAt = now;
    record.lastRuntimeReport = {
      at: now,
      nodeId,
      event,
      context: request.context || request.reason || '',
      currentProxyIndex: request.currentProxyIndex ?? null
    };
  } else {
    if (record.leaseOwnerNodeId && record.leaseOwnerNodeId !== nodeId && !isLeaseFree(record, now, config)) {
      writeState(state);
      return {
        ok: false,
        error: 'lease_owner_conflict',
        proxyId,
        leaseOwnerNodeId: record.leaseOwnerNodeId,
        leaseUntilMs: record.leaseUntilMs
      };
    }
    const healthStatus = normalizeHealthEvent(event, request.context || request.reason || '');
    record.healthStatus = healthStatus;
    record.penaltyUntilMs = healthStatus === 'ok' ? 0 : now + getHealthPenaltyMs(config, healthStatus);
    record.score = healthStatus === 'ok'
      ? Math.max(0, Number(record.score || 0) - 5)
      : Math.min(1000, Number(record.score || 0) + (HEALTH_SCORE[healthStatus] || 25));
    record.lastReportedAt = now;
    record.lastReportEvent = event;
    record.lastReportContext = request.context || request.reason || '';
    record.lastRuntimeReport = {
      at: now,
      nodeId,
      event,
      context: request.context || request.reason || '',
      currentProxyIndex: request.currentProxyIndex ?? null,
      httpCode: request.httpCode
    };
    if (healthStatus === 'ok') {
      record.lastRuntimeHealthyAt = now;
      record.lastRuntimeHealthyStatus = request.context || event || 'runtime_ok';
    } else if (['waf_pressure', 'blocked', 'connect_fail', 'auth_fail'].includes(healthStatus)
      && (!record.leaseOwnerNodeId || record.leaseOwnerNodeId === nodeId)) {
      record.leaseOwnerNodeId = null;
      record.leaseUntilMs = 0;
    }
    if (request.httpCode !== undefined) record.lastHttpCode = request.httpCode;
    if (request.checkedAt !== undefined) record.lastCheckedAt = Number(request.checkedAt || now);
  }
  record.updatedAt = now;
  writeState(state);
  return { ok: true, proxyId, healthStatus: record.healthStatus, penaltyUntilMs: record.penaltyUntilMs };
}

function reportCheckerResults(config, request = {}) {
  const records = Array.isArray(request.records) ? request.records : [];
  const inventory = loadProxyInventory(config);
  const state = ensureStateForInventory(readState(), inventory);
  const result = { ok: true, updated: 0, skippedLeased: 0 };
  const now = Date.now();
  for (const item of records) {
    const proxyId = normalizeProxyId(item.proxyId ?? item.index);
    const record = proxyId === null ? null : state.proxies[proxyId];
    if (!record) continue;
    if (!isLeaseFree(record, now, config)) {
      result.skippedLeased += 1;
      continue;
    }
    const status = String(item.status || '');
    const probeType = String(item.probeType || request.probeType || 'colosseo');
    const event = status === 'healthy' ? 'healthy'
      : status === 'rate_limited' ? 'cart_pressure'
        : status === 'blocked' ? 'blocked'
          : (/auth/i.test(String(item.reason || '')) ? 'auth_fail' : 'connect_fail');
    const healthStatus = normalizeHealthEvent(event, item.reason || '');
    const checkedAt = Number(item.checkedAt || request.checkedAt || now);
    record.lastCheckedAt = checkedAt;
    if (probeType === 'neutral') record.lastNeutralCheckedAt = checkedAt;
    if (probeType === 'colosseo') record.lastColosseoCheckedAt = checkedAt;
    record.lastCheckerResult = {
      at: checkedAt,
      nodeId: Number(request.nodeId) || null,
      probeType,
      status,
      healthStatus,
      reason: item.reason || '',
      httpCode: item.httpCode,
      remoteIp: item.remoteIp || '',
      timeTotal: item.timeTotal || 0,
      targetUrl: request.targetUrl || item.targetUrl || ''
    };
    if (probeType === 'neutral') record.lastNeutralResult = record.lastCheckerResult;
    if (probeType === 'colosseo') record.lastColosseoResult = record.lastCheckerResult;
    appendCheckerLog(state, {
      proxyId: record.proxyId,
      index: record.index,
      nodeId: Number(request.nodeId) || null,
      probeType,
      status,
      reason: item.reason || '',
      httpCode: item.httpCode,
      remoteIp: item.remoteIp,
      targetUrl: request.targetUrl || item.targetUrl || ''
    });

    if (probeType === 'neutral' && status === 'healthy' && !['connect_fail', 'auth_fail'].includes(record.healthStatus)) {
      record.updatedAt = now;
      result.updated += 1;
      continue;
    }

    if (probeType === 'neutral' && status === 'healthy') {
      record.healthStatus = 'ok';
      record.penaltyUntilMs = 0;
      record.score = Math.max(0, Number(record.score || 0) - 5);
    } else if (probeType === 'colosseo' && status !== 'healthy' && (
      hasRecentRuntimeHealthy(record, now, config) || config?.proxyPool?.checkerColosseoBlocksLease === false
    )) {
      // The background Colosseo probe has a different session/profile than the bot.
      // Keep it as observability unless explicitly configured to block leases.
      record.score = Math.min(1000, Number(record.score || 0) + 1);
    } else {
      record.healthStatus = healthStatus;
      record.penaltyUntilMs = healthStatus === 'ok' ? 0 : now + getHealthPenaltyMs(config, healthStatus);
      record.score = healthStatus === 'ok'
        ? Math.max(0, Number(record.score || 0) - 5)
        : Math.min(1000, Number(record.score || 0) + (HEALTH_SCORE[healthStatus] || 25));
    }
    record.updatedAt = now;
    result.updated += 1;
  }
  writeState(state);
  return result;
}

function buildCheckerPlan(config, request = {}) {
  if (!isSharedProxyPoolEnabled(config)) {
    return { ok: false, error: 'shared_proxy_pool_disabled' };
  }
  const nodeId = Number(request.nodeId);
  const activeNodeIds = getActiveNodeIds(config);
  if (!Number.isInteger(nodeId) || !activeNodeIds.includes(nodeId)) {
    return { ok: false, error: 'node_not_active_for_shared_pool', activeNodeIds };
  }
  const coordinatorMode = getCheckerMode(config) === 'coordinator';
  const coordinatorNodeId = getCoordinatorNodeId(config);
  const coordinatorCheck = coordinatorMode && (request.coordinator === '1' || request.coordinator === true || nodeId === coordinatorNodeId);
  if (coordinatorMode && !coordinatorCheck) {
    return {
      ok: false,
      error: 'checker_runs_on_coordinator_only',
      activeNodeIds,
      coordinatorNodeId,
      checkerMode: 'coordinator'
    };
  }

  const inventory = loadProxyInventory(config);
  const state = ensureStateForInventory(readState(), inventory);
  const now = Date.now();
  const slotIndex = activeNodeIds.indexOf(nodeId);
  const { neutralIntervalMs, colosseoIntervalMs } = getCheckIntervals(config);
  const maxPlanSize = Math.max(1, Math.min(coordinatorCheck ? 80 : 25, Number(request.limit || config?.proxyPool?.checkerPlanLimit || 12)));
  const records = Object.values(state.proxies)
    .filter((record) => inventory.proxies.some((proxy) => proxy.proxyId === record.proxyId))
    .filter((record) => isLeaseFree(record, now, config))
    .filter((record) => coordinatorCheck || Number(record.index) % activeNodeIds.length === slotIndex)
    .map((record) => {
      normalizeExpiredHealth(record, now, config);
      const neutralDue = now - Number(record.lastNeutralCheckedAt || 0) >= neutralIntervalMs;
      const missingVerifiedColosseo = !hasRecentLeaseProof(record, now, config);
      const colosseoDue = missingVerifiedColosseo || now - Number(record.lastColosseoCheckedAt || 0) >= colosseoIntervalMs;
      return { record, neutralDue, colosseoDue };
    })
    .filter((entry) => entry.neutralDue || entry.colosseoDue)
    .sort((a, b) => {
      const priorityDiff = getCheckerPlanPriority(a, now, config) - getCheckerPlanPriority(b, now, config);
      if (priorityDiff) return priorityDiff;
      const aLast = Math.min(Number(a.record.lastNeutralCheckedAt || 0), Number(a.record.lastColosseoCheckedAt || 0));
      const bLast = Math.min(Number(b.record.lastNeutralCheckedAt || 0), Number(b.record.lastColosseoCheckedAt || 0));
      return aLast - bLast || Number(a.record.index) - Number(b.record.index);
    })
    .slice(0, maxPlanSize)
    .map((entry) => ({
      proxyId: entry.record.proxyId,
      index: entry.record.index,
      host: entry.record.host,
      port: entry.record.port,
      username: entry.record.username,
      password: entry.record.password,
      healthStatus: entry.record.healthStatus,
      score: entry.record.score,
      neutralDue: entry.neutralDue,
      colosseoDue: entry.colosseoDue
    }));

  writeState(state);
  return {
    ok: true,
    nodeId,
    activeNodeIds,
    totalProxies: inventory.proxies.length,
    shardIndex: slotIndex,
    shardCount: activeNodeIds.length,
    generatedAt: now,
    neutralIntervalMs,
    colosseoIntervalMs,
    targetUrl: request.targetUrl || null,
    proxies: records
  };
}

function getProxyLeaseSnapshot(config) {
  const inventory = loadProxyInventory(config);
  const state = ensureStateForInventory(readState(), inventory);
  const now = Date.now();
  const totals = {
    total: inventory.proxies.length,
    leased: 0,
    free: 0,
    ok: 0,
    waf_pressure: 0,
    cart_pressure: 0,
    blocked: 0,
    connect_fail: 0,
    auth_fail: 0,
    eligible: 0,
    verified_colosseo: 0,
    verified_runtime: 0,
    unverified: 0
  };

  const proxies = Object.values(state.proxies)
    .filter((record) => inventory.proxies.some((proxy) => proxy.proxyId === record.proxyId))
    .map((record) => {
      normalizeExpiredHealth(record, now, config);
      if (!isLeaseFree(record, now, config)) totals.leased += 1;
      else totals.free += 1;
      const checkerHealthy = hasRecentColosseoHealthy(record, now, config);
      const runtimeHealthy = hasRecentRuntimeHealthy(record, now, config);
      if (checkerHealthy) totals.verified_colosseo += 1;
      if (runtimeHealthy) totals.verified_runtime += 1;
      if (!checkerHealthy && !runtimeHealthy) totals.unverified += 1;
      if (isLeaseEligible(record, now, config)) totals.eligible += 1;
      totals[record.healthStatus] = (totals[record.healthStatus] || 0) + 1;
      return buildProxyPublicView(record, now, config);
    });

  const activeOwners = new Map();
  const duplicateProxyLeaseIds = [];
  for (const proxy of proxies) {
    if (!proxy.leaseOwnerNodeId || !proxy.leaseUntilMs || proxy.leaseUntilMs <= now) continue;
    const owners = activeOwners.get(proxy.proxyId) || new Set();
    owners.add(proxy.leaseOwnerNodeId);
    activeOwners.set(proxy.proxyId, owners);
  }
  for (const [proxyId, owners] of activeOwners.entries()) {
    if (owners.size > 1) duplicateProxyLeaseIds.push(proxyId);
  }

  writeState(state);
  return {
    ok: true,
    mode: config?.proxyPool?.mode || 'legacy',
    activeNodeIds: getActiveNodeIds(config),
    source: inventory.source,
    sourceError: inventory.sourceError,
    totals,
    duplicateProxyLeaseIds,
    checkerLog: (state.checkerLog || []).slice(-100).reverse(),
    proxies
  };
}

module.exports = {
  acquireProxyLease,
  reportProxyHealth,
  reportCheckerResults,
  buildCheckerPlan,
  getProxyLeaseSnapshot,
  isSharedProxyPoolEnabled,
  getActiveNodeIds,
  getCoordinatorNodeId,
  loadProxyInventory
};
