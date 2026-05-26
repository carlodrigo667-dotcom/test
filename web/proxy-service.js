const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  RAW_PROXY_SOURCE_PATH,
  loadConfig,
  saveConfig,
  getNodeMode
} = require('./config-store');

function parseProxyLine(line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed) {
    return { empty: true };
  }

  const parts = trimmed.split(':');
  if (parts.length !== 4) {
    return {
      error: {
        lineNumber,
        line: trimmed,
        reason: 'Expected host:port:username:password'
      }
    };
  }

  const [host, portRaw, username, password] = parts;
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0 || !username || !password) {
    return {
      error: {
        lineNumber,
        line: trimmed,
        reason: 'Invalid host, port, username, or password'
      }
    };
  }

  return {
    proxy: {
      host,
      port,
      username,
      password
    }
  };
}

function loadRawProxyInput(filePath = RAW_PROXY_SOURCE_PATH) {
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Proxy source file not found: ${filePath}`);
    error.code = 'PROXY_SOURCE_NOT_FOUND';
    throw error;
  }

  return fs.readFileSync(filePath, 'utf8');
}

function parseProxyFile(filePath = RAW_PROXY_SOURCE_PATH) {
  const raw = loadRawProxyInput(filePath);
  const lines = raw.split(/\r?\n/);
  const invalidLines = [];
  const seen = new Set();
  const proxies = [];

  lines.forEach((line, index) => {
    const result = parseProxyLine(line, index + 1);
    if (result.empty) return;
    if (result.error) {
      invalidLines.push(result.error);
      return;
    }

    const key = `${result.proxy.host}:${result.proxy.port}:${result.proxy.username}:${result.proxy.password}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    proxies.push(result.proxy);
  });

  return {
    totalInput: lines.filter(line => line.trim().length > 0).length,
    validUnique: proxies.length,
    invalidCount: invalidLines.length,
    invalidLines,
    proxies
  };
}

function getProxyPoolSize(totalProxies, nodeCount, nodeIndex) {
  const baseSize = Math.floor(totalProxies / nodeCount);
  const remainder = totalProxies % nodeCount;
  return baseSize + (nodeIndex < remainder ? 1 : 0);
}

function getDistributionNodeIds(config, nodeCount) {
  const allNodeIds = Array.from({ length: nodeCount }, (_, index) => index + 1);
  const explicit = Array.isArray(config?.proxyPool?.activeNodeIds)
    ? config.proxyPool.activeNodeIds.map(Number).filter(nodeId => Number.isInteger(nodeId) && nodeId > 0)
    : [];
  const disabled = new Set(
    (Array.isArray(config?.proxyPool?.disabledNodeIds) ? config.proxyPool.disabledNodeIds : [])
      .map(Number)
      .filter(nodeId => Number.isInteger(nodeId) && nodeId > 0)
  );
  const candidates = explicit.length ? explicit : allNodeIds;
  return Array.from(new Set(candidates))
    .filter(nodeId => nodeId <= nodeCount && !disabled.has(nodeId))
    .sort((a, b) => a - b);
}

function resolveProxySourcePath(config, filePath) {
  if (filePath) return filePath;
  const configured = config?.proxyPool?.sourceFile || RAW_PROXY_SOURCE_PATH;
  return path.isAbsolute(configured) ? configured : path.join(PROJECT_ROOT, configured);
}

function buildDistributedProxyMap(proxies, nodeIdsOrCount) {
  const nodeIds = Array.isArray(nodeIdsOrCount)
    ? nodeIdsOrCount
    : Array.from({ length: Number(nodeIdsOrCount) || 0 }, (_, index) => index + 1);
  const result = {};
  let cursor = 0;

  for (let nodeIndex = 0; nodeIndex < nodeIds.length; nodeIndex += 1) {
    const nodeId = String(nodeIds[nodeIndex]);
    const poolSize = getProxyPoolSize(proxies.length, nodeIds.length, nodeIndex);
    result[nodeId] = proxies.slice(cursor, cursor + poolSize);
    cursor += poolSize;
  }

  return result;
}

function areProxyPoolsEqual(left = [], right = []) {
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (!r) return false;
    if (
      l.host !== r.host ||
      Number(l.port) !== Number(r.port) ||
      l.username !== r.username ||
      l.password !== r.password
    ) {
      return false;
    }
  }

  return true;
}

function buildDistributionPreview({ config, nodeCount, filePath }) {
  const sourcePath = resolveProxySourcePath(config, filePath);
  const activeNodeIds = getDistributionNodeIds(config, nodeCount);
  const parsed = parseProxyFile(sourcePath);
  const nextProxies = buildDistributedProxyMap(parsed.proxies, activeNodeIds);
  const currentProxies = config.proxies || {};
  const changedNodeIds = [];
  const nodes = [];
  const validationErrors = [];

  if (parsed.invalidCount > 0) {
    validationErrors.push('Proxy source contains invalid lines.');
  }
  if (parsed.validUnique < activeNodeIds.length) {
    validationErrors.push(`Need at least ${activeNodeIds.length} valid proxies, got ${parsed.validUnique}.`);
  }

  for (let nodeId = 1; nodeId <= nodeCount; nodeId += 1) {
    const key = String(nodeId);
    const currentPool = currentProxies[key] || [];
    const nextPool = nextProxies[key] || [];
    const changed = !areProxyPoolsEqual(currentPool, nextPool);
    if (changed) changedNodeIds.push(nodeId);

    nodes.push({
      nodeId,
      oldCount: currentPool.length,
      newCount: nextPool.length,
      changed,
      currentProxies: currentPool,
      nextProxies: nextPool
    });
  }

  const activeNodeIdSet = new Set(activeNodeIds);
  const counts = nodes
    .filter(node => activeNodeIdSet.has(node.nodeId))
    .map(node => node.newCount);
  return {
    sourcePath,
    totalInput: parsed.totalInput,
    validUnique: parsed.validUnique,
    invalidCount: parsed.invalidCount,
    invalidLines: parsed.invalidLines.slice(0, 10),
    canApply: validationErrors.length === 0,
    validationErrors,
    distributionSummary: {
      nodeCount,
      activeNodeCount: activeNodeIds.length,
      minPerNode: counts.length ? Math.min(...counts) : 0,
      maxPerNode: counts.length ? Math.max(...counts) : 0
    },
    nodes,
    changedNodeIds,
    nextProxies
  };
}

function buildProxyOverview(nodes, config, preview = null) {
  const result = {};

  for (const node of nodes) {
    let bans = {};
    try {
      bans = JSON.parse(node.proxy_bans || '{}');
    } catch {}

    const key = String(node.id);
    const currentProxies = config.proxies?.[key] || [];
    const nextNode = preview?.nodes.find(item => item.nodeId === node.id);

    result[node.id] = {
      nodeId: node.id,
      ip: node.ip,
      mode: getNodeMode(config, node.id),
      currentProxy: node.current_proxy,
      proxies: currentProxies,
      bans,
      status: node.status,
      currentCount: currentProxies.length,
      nextCount: nextNode ? nextNode.newCount : currentProxies.length,
      changed: nextNode ? nextNode.changed : false,
      activeProxy: currentProxies[node.current_proxy] || null,
      futureProxyPreview: nextNode?.nextProxies?.[0] || null
    };
  }

  return result;
}

function applyDistributedProxies(nodeCount, filePath) {
  const config = loadConfig();
  const preview = buildDistributionPreview({ config, nodeCount, filePath });

  if (!preview.canApply) {
    const error = new Error(preview.validationErrors.join(' '));
    error.code = 'PROXY_DISTRIBUTION_INVALID';
    throw error;
  }

  config.proxies = Object.fromEntries(
    preview.nodes.map(node => [String(node.nodeId), node.nextProxies || []])
  );
  saveConfig(config);

  return preview;
}

module.exports = {
  RAW_PROXY_SOURCE_PATH,
  parseProxyFile,
  buildDistributedProxyMap,
  buildDistributionPreview,
  buildProxyOverview,
  applyDistributedProxies
};
