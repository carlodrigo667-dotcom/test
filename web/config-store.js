const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const IPS_PATH = path.join(PROJECT_ROOT, 'ips.txt');
const RAW_PROXY_SOURCE_PATH = path.join(PROJECT_ROOT, 'Webshare 2500 proxies.txt');
const INDIVIDUAL_24H_URL = 'https://ticketing.colosseo.it/eventi/24h-colosseo-foro-romano-palatino/';
const INDIVIDUAL_24H_PAGE_ID = 35;
const INDIVIDUAL_24H_OBJECT_GUID = '2931a83e-6b37-43c2-ace0-3ce60027fc0e';
const INDIVIDUAL_24H_OBJECT_TABLENAME = 'packetTypes';
let configCache = null;
let configCacheMtimeMs = 0;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function buildNextConfigMeta(nextConfig, existingConfig = {}, options = {}) {
  const updatedAt = new Date().toISOString();
  const updatedBy = options.updatedBy || 'system';
  const nextVersion = Math.max(
    Number(nextConfig?.configMeta?.version) || 0,
    Number(existingConfig?.configMeta?.version) || 0
  ) + 1;

  return {
    ...(existingConfig.configMeta || {}),
    ...(nextConfig.configMeta || {}),
    version: nextVersion,
    updatedAt,
    updatedBy
  };
}

function normalizeIndividualTicket(ticket = {}) {
  const quantity = Math.max(1, Math.floor(Number(ticket.quantity || 1)) || 1);
  return {
    ...ticket,
    label: ticket.label || 'Intero',
    quantity,
    object_guid: ticket.object_guid || ticket.objectGuid || INDIVIDUAL_24H_OBJECT_GUID,
    object_tablename: ticket.object_tablename || ticket.objectTablename || INDIVIDUAL_24H_OBJECT_TABLENAME
  };
}

function normalizeTicketLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isGuideTicketLabel(label) {
  const value = normalizeTicketLabel(label);
  return /guide turistiche con tesserino|accompagnatore|visita guidata/.test(value);
}

function normalizeIndividualTickets(tickets) {
  const rows = Array.isArray(tickets) && tickets.length > 0
    ? tickets.filter(ticket => !isGuideTicketLabel(ticket?.label))
    : [{ label: 'Intero', quantity: 1 }];
  if (!rows.length) return [normalizeIndividualTicket({ label: 'Intero', quantity: 1 })];
  return rows.map(normalizeIndividualTicket);
}

function normalizeIndividual24hTarget(config) {
  const nextConfig = { ...config };
  const targets = Array.isArray(nextConfig.targets) ? nextConfig.targets.filter(Boolean) : [];
  const existingIndividual = targets.find(target => target.type === 'individual') || {};
  const normalizedIndividual = {
    ...existingIndividual,
    type: 'individual',
    url: INDIVIDUAL_24H_URL,
    calendar_page_id: INDIVIDUAL_24H_PAGE_ID,
    pageId: INDIVIDUAL_24H_PAGE_ID,
    mode: 'individual',
    ticketSearchMode: existingIndividual.ticketSearchMode || existingIndividual.ticket_search_mode || 'concrete',
    tickets: normalizeIndividualTickets(existingIndividual.tickets)
  };

  const withoutIndividual = targets.filter(target => target.type !== 'individual');
  const groupIndex = withoutIndividual.findIndex(target => target.type === 'group');
  if (groupIndex >= 0) {
    withoutIndividual.splice(groupIndex + 1, 0, normalizedIndividual);
  } else {
    withoutIndividual.unshift(normalizedIndividual);
  }
  nextConfig.targets = withoutIndividual;

  if (nextConfig.nodeOverrides && typeof nextConfig.nodeOverrides === 'object') {
    nextConfig.nodeOverrides = Object.fromEntries(
      Object.entries(nextConfig.nodeOverrides).map(([nodeId, override]) => {
        if (!override || override.mode !== 'individual') return [nodeId, override];
        return [
          nodeId,
          {
            ...override,
            ticketSearchMode: override.ticketSearchMode || override.ticket_search_mode || 'concrete',
            tickets: normalizeIndividualTickets(override.tickets)
          }
        ];
      })
    );
  }

  return nextConfig;
}

function loadConfig() {
  const stat = fs.statSync(CONFIG_PATH);
  if (configCache && stat.mtimeMs === configCacheMtimeMs) {
    return configCache;
  }

  configCache = readJson(CONFIG_PATH);
  configCacheMtimeMs = stat.mtimeMs;
  return configCache;
}

function saveConfig(config, options = {}) {
  const existingConfig = fs.existsSync(CONFIG_PATH) ? readJson(CONFIG_PATH) : {};
  const normalizedConfig = normalizeIndividual24hTarget(config);
  const nextConfig = {
    ...normalizedConfig,
    configMeta: buildNextConfigMeta(normalizedConfig, existingConfig, options)
  };

  writeJson(CONFIG_PATH, nextConfig);
  configCache = nextConfig;
  configCacheMtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  return nextConfig;
}

function loadIps() {
  try {
    return fs.readFileSync(IPS_PATH, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch (e) {
    return [];
  }
}

function getNodeMode(config, nodeId) {
  const overrides = config.nodeOverrides || {};
  const appMode = config.application?.mode || 'group';
  return overrides[String(nodeId)]?.mode || appMode;
}

function getTargetByMode(config, mode) {
  const targets = config.targets || [];
  return targets.find(target => target.type === mode)
    || targets.find(target => target.type === 'group')
    || targets[0]
    || null;
}

function getWindowValues(entry) {
  if (!entry) return { start: '', end: '' };
  if (entry.target_datetime_start || entry.target_datetime_end) {
    return {
      start: entry.target_datetime_start || '',
      end: entry.target_datetime_end || ''
    };
  }

  const startDate = entry.target_date_start || entry.target_date || '';
  const endDate = entry.target_date_end || entry.target_date || '';
  const startTime = entry.time_range?.start || '';
  const endTime = entry.time_range?.end || '';

  return {
    start: startDate && startTime ? `${startDate}T${startTime}` : (startDate || ''),
    end: endDate && endTime ? `${endDate}T${endTime}` : (endDate || '')
  };
}

function formatWindow(window) {
  return `${window.start || '—'} -> ${window.end || '—'}`;
}

function getEffectiveNodeConfig(config, nodeId) {
  const override = (config.nodeOverrides || {})[String(nodeId)] || {};
  const mode = override.mode || config.application?.mode || 'group';
  const baseTarget = getTargetByMode(config, mode) || {};
  const baseWindow = getWindowValues(baseTarget);
  const overrideWindow = getWindowValues(override);
  const effectiveTickets = Array.isArray(override.tickets)
    ? override.tickets
    : (Array.isArray(baseTarget.tickets) ? baseTarget.tickets : []);
  const ticketSearchMode = String(
    override.ticketSearchMode
    || override.ticket_search_mode
    || baseTarget.ticketSearchMode
    || baseTarget.ticket_search_mode
    || 'dynamic'
  ).toLowerCase() === 'concrete' ? 'concrete' : 'dynamic';
  const effectiveWindow = {
    start: overrideWindow.start || baseWindow.start || '',
    end: overrideWindow.end || baseWindow.end || ''
  };
  const usesOverride = !!(
    override.mode
    || override.target_datetime_start
    || override.target_datetime_end
    || override.target_date
    || override.target_date_start
    || override.target_date_end
    || override.time_range
    || override.tickets
    || override.ticketSearchMode
    || override.ticket_search_mode
  );

  return {
    version: Number(config.configMeta?.version || 0) || 0,
    mode,
    window: formatWindow(effectiveWindow),
    ticketSearchMode,
    tickets: effectiveTickets,
    source: usesOverride ? 'override' : 'global'
  };
}

function enrichNodesWithMode(nodes, config) {
  return nodes.map(node => {
    const expected = getEffectiveNodeConfig(config, node.id);

    let extra = {};

    try {
      extra = typeof node.extra === 'string' ? JSON.parse(node.extra) : (node.extra || {});
    } catch {
      extra = {};
    }

    if (!extra.mode) extra.mode = expected.mode;
    if (!extra.runtimeMode) extra.runtimeMode = extra.mode;

    extra.expectedMode = expected.mode;
    extra.expectedTicketSearchMode = expected.ticketSearchMode;
    extra.expectedWindow = expected.window;
    extra.expectedSource = expected.source;
    extra.expectedVersion = expected.version;

    return { ...node, extra: JSON.stringify(extra) };
  });
}

module.exports = {
  PROJECT_ROOT,
  CONFIG_PATH,
  IPS_PATH,
  RAW_PROXY_SOURCE_PATH,
  buildNextConfigMeta,
  loadConfig,
  saveConfig,
  loadIps,
  getNodeMode,
  getEffectiveNodeConfig,
  enrichNodesWithMode
};
