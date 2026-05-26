const ISSUE_ORDER = [
  'offline',
  'browser_launch_failed',
  'x_display_missing',
  'ws_timeout',
  'dom_selector_error',
  'proxy_ban_pool',
  'waf_429',
  'state_mismatch',
  'stale_log',
  'calendar_empty',
  'other'
];

const NOISE_ISSUE_CODES = new Set([
  'state_mismatch',
  'stale_log',
  'calendar_empty'
]);

const ISSUE_DEFS = {
  offline: {
    code: 'offline',
    label: 'Офлайн',
    severity: 'danger',
    summary: 'Узел не присылает пульс или бот остановлен.'
  },
  state_mismatch: {
    code: 'state_mismatch',
    label: 'Спорное состояние',
    severity: 'info',
    summary: 'Heartbeat, runtime и логи расходятся между собой.'
  },
  browser_launch_failed: {
    code: 'browser_launch_failed',
    label: 'Браузер не стартует',
    severity: 'danger',
    summary: 'Puppeteer или Chrome не смогли запустить процесс браузера.'
  },
  x_display_missing: {
    code: 'x_display_missing',
    label: 'X display не найден',
    severity: 'danger',
    summary: 'На узле нет готового X server / DISPLAY для графического режима.'
  },
  stale_log: {
    code: 'stale_log',
    label: 'Лог устарел',
    severity: 'info',
    summary: 'Лог не подтверждает текущее состояние узла.'
  },
  ws_timeout: {
    code: 'ws_timeout',
    label: 'Таймаут WS',
    severity: 'danger',
    summary: 'Не дождались адреса WS endpoint для рабочего сценария.'
  },
  dom_selector_error: {
    code: 'dom_selector_error',
    label: 'DOM / selector error',
    severity: 'danger',
    summary: 'Сайт изменил DOM, скрипт наткнулся на null-элемент.'
  },
  proxy_ban_pool: {
    code: 'proxy_ban_pool',
    label: 'Пул прокси забанен',
    severity: 'danger',
    summary: 'Для узла закончились рабочие прокси.'
  },
  waf_429: {
    code: 'waf_429',
    label: 'WAF / 429',
    severity: 'warning',
    summary: 'Узел получает защитные ответы 403/429 или блок WAF.'
  },
  calendar_empty: {
    code: 'calendar_empty',
    label: 'Пустой календарь',
    severity: 'info',
    summary: 'Календарь отвечает пусто, слот не подтвержден.'
  },
  other: {
    code: 'other',
    label: 'Прочее',
    severity: 'warning',
    summary: 'Есть ошибка, но причина не попала в известную группу.'
  }
};

const NOISE_PATTERNS = [
  /google_apis\/gcm/i,
  /DEPRECATED_ENDPOINT/i,
  /ConnectionHandler failed with net error/i
];

const ACTIONABLE_ERROR_PATTERNS = [
  /All proxies banned/i,
  /Failed to launch the browser process/i,
  /Missing X server|\$DISPLAY/i,
  /Cannot read properties of null/i,
  /WS endpoint|while waiting for the WS endpoint/i,
  /Unauthorized|Unauthorised|not authorized|not authorised|forbidden|access denied/i,
  /unable to proceed|checkout failed|payment failed/i,
  /\b(?:error|failed|failure|fatal|critical|exception|timeout|timed out)\b/i,
  /\b(?:403|429)\b|WAF|hard_blocked|rate_limited|rate limit/i,
  /ошиб|критич|авториз|таймаут|забан|блок/i
];

const BENIGN_STATUS_PATTERNS = [
  /Telegram notifications disabled|read-only control bot/i,
  /\bSCHEDULER\b|strict_grid|allowed_by_slot=true|next_poll/i,
  /calendar_api|page_load/i,
  /DevTools listening/i,
  /persistent profile page opened/i,
  /Proxy ban-state preserved/i,
  /Bot NodeJS process launched/i,
  /addtocart raw: status=200 success=true isWaf=false/i,
  /Cart item saved|HOLD\] cart_alive|success=true/i,
  /Profile:\s*proxy-\d+|profile-\d+|\bproxy-\d+\b/i
];

const SUCCESS_STATUS_PATTERNS = [
  /addtocart raw: status=200 success=true isWaf=false/i,
  /Cart item saved|HOLD\] cart_alive/i,
  /success=true/i
];

function isStartupConfigLine(line) {
  return /COLOSSEUM TICKET SNIPER|WAF Fix|429 Calendar|403 after 429|Стратегия:.*WAF/i.test(String(line || ''));
}

function isOperationalWafRateLine(line) {
  const text = String(line || '');
  if (isStartupConfigLine(text)) return false;
  return /WAF BLOCK|WAF block|WAF 403|403 Cart body|Octofence|OctoFence|status=hard_blocked|hard_blocked|\b429\b|status=429|rate_limited|rate limit/i.test(text);
}

function isProxyBanPoolLine(line) {
  return /All proxies banned|Все .*прокси .*забанены|\[PROXY BAN\].*all proxies banned/i.test(String(line || ''));
}

const RECOVERY_PATTERNS = [
  /Чистый Chrome запущен/i,
  /Переход по URL \(page\.goto\)/i,
  /Первичная загрузка и обход защиты/i,
  /API Проверка слотов/i,
  /Следующий цикл через/i,
  /За наш промежуток времени билетов нет/i
  ,/DevTools listening/i,
  /persistent profile page opened/i,
  /Bot NodeJS process launched/i,
  /strict_grid\s+(calendar_api|page_load|next_poll)|calendar_api allowed_by_slot=true/i
];

const TRANSLATIONS = [
  [/All proxies banned/gi, 'Все прокси забанены'],
  [/WAF block/gi, 'Блок WAF'],
  [/\bTimed out after\s+(\d+)\s+ms\b/gi, 'Таймаут после $1 мс'],
  [/while waiting for the WS endpoint URL to appear in stdout/gi, 'при ожидании адреса WS endpoint в stdout'],
  [/Cannot read properties of null \(reading 'innerHTML'\)/gi, 'Получен null при чтении innerHTML'],
  [/calendar response empty/gi, 'Пустой ответ календаря'],
  [/Response calendar empty/gi, 'Пустой ответ календаря'],
  [/offline/gi, 'офлайн']
];

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function extractBanUntilMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (!value || typeof value !== 'object') return null;

  const record = value;
  const candidates = [
    record.bannedUntilMs,
    record.untilMs,
    record.bannedUntil,
    record.until,
    record.expiresAtMs,
    record.expiresAt,
    record.ts
  ];

  for (const candidate of candidates) {
    const resolved = extractBanUntilMs(candidate);
    if (resolved !== null) return resolved;
  }

  return null;
}

function isActiveBanValue(value, now = Date.now()) {
  const untilMs = extractBanUntilMs(value);
  if (untilMs !== null) return untilMs > now;

  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function countProxyBans(node) {
  const raw = typeof node?.proxy_bans === 'string'
    ? safeJson(node.proxy_bans, {})
    : (node?.proxy_bans || {});

  if (!raw || typeof raw !== 'object') return 0;
  const now = Date.now();
  return Object.values(raw).filter((entry) => isActiveBanValue(entry, now)).length;
}

function isNoiseLine(line) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function isBenignStatusLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (isNoiseLine(text) || isStartupConfigLine(text)) return true;
  return BENIGN_STATUS_PATTERNS.some((pattern) => pattern.test(text))
    && !ACTIONABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function isActionableErrorText(value) {
  const text = String(value || '').trim();
  if (!text || isNoiseLine(text) || isBenignStatusLine(text) || isStartupConfigLine(text)) return false;
  if (SUCCESS_STATUS_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return ACTIONABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function getActionableLastError(value) {
  const text = String(value || '').trim();
  return isActionableErrorText(text) ? text : '';
}

function sanitizeHeartbeatLastError(value) {
  const text = getActionableLastError(value);
  return text || null;
}

function localizeText(value) {
  let next = String(value || '');
  TRANSLATIONS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  return next;
}

function cleanEvidenceLine(value) {
  const line = String(value || '')
    .replace(/\r/g, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\d{2}:\d{2}\]\s*/, '')
    .replace(/^NODE_\d+\s*/i, '')
    .trim();

  return localizeText(line);
}

function findFirstMatchingLine(text, matcher) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isNoiseLine(line));

  return lines.find((line) => matcher.test(line)) || '';
}

function getRelevantLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isNoiseLine(line));
}

function findLastMatchingLine(text, matcher) {
  const lines = getRelevantLines(text);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (matcher.test(lines[index])) return lines[index];
  }
  return '';
}

function findLastLineByPredicate(text, predicate) {
  const lines = getRelevantLines(text);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index])) return lines[index];
  }
  return '';
}

function hasLineByPredicate(text, predicate) {
  return Boolean(findLastLineByPredicate(text, predicate));
}

function hasRecoveryAfterIssue(text, issueMatcher) {
  const lines = getRelevantLines(text);
  let lastIssueIndex = -1;
  let lastRecoveryIndex = -1;

  lines.forEach((line, index) => {
    if (issueMatcher.test(line)) lastIssueIndex = index;
    if (RECOVERY_PATTERNS.some((pattern) => pattern.test(line))) lastRecoveryIndex = index;
  });

  return lastIssueIndex >= 0 && lastRecoveryIndex > lastIssueIndex;
}

function hasRecoveryLine(text) {
  return getRelevantLines(text).some((line) => RECOVERY_PATTERNS.some((pattern) => pattern.test(line)));
}

function findLastUnrecoveredActionableErrorLine(text) {
  const lines = getRelevantLines(text);
  let lastRecoveryIndex = -1;

  lines.forEach((line, index) => {
    if (RECOVERY_PATTERNS.some((pattern) => pattern.test(line))) lastRecoveryIndex = index;
  });

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (index <= lastRecoveryIndex) return '';
    if (isActionableErrorText(lines[index])) return lines[index];
  }

  return '';
}

function isOperationallyHealthy(node, meta) {
  const heartbeatAgeSec = Number(node?.heartbeatAgeSec);
  const heartbeatFresh = !Number.isFinite(heartbeatAgeSec) || heartbeatAgeSec <= 120;
  return node?.status === 'online'
    && node?.bot_status === 'running'
    && heartbeatFresh
    && !meta?.isStale;
}

function getStaleReasonEvidence(meta) {
  if (!meta?.isStale) return '';
  if (meta.staleReason === 'no_log_file') return 'Процесс запущен, но лог-файл не найден.';
  if (meta.staleReason === 'heartbeat_ahead_of_log') return 'Heartbeat новее лог-файла.';
  if (meta.staleReason === 'log_not_updating') return 'Лог давно не обновлялся.';
  return 'Лог не подтверждает текущее состояние узла.';
}

function buildEvidence(code, node, text, meta) {
  const mismatchFlags = node?.derivedState?.mismatchFlags || [];

  if (code === 'offline') {
    if (node?.status !== 'online') return `Статус узла: ${localizeText(node.status || 'offline')}.`;
    if (node?.bot_status === 'stopped') return 'Бот остановлен.';
    return 'Узел не присылает heartbeat.';
  }

  if (code === 'state_mismatch') {
    return `Сервер видит расхождение: ${(mismatchFlags.length ? mismatchFlags.join(', ') : 'runtime not confirmed')}.`;
  }

  if (code === 'browser_launch_failed') {
    const line = findLastMatchingLine(text, /Failed to launch the browser process/i);
    return cleanEvidenceLine(line || 'Браузер не смог стартовать.');
  }

  if (code === 'x_display_missing') {
    const line = findLastMatchingLine(text, /Missing X server|\$DISPLAY/i);
    return cleanEvidenceLine(line || 'DISPLAY / X server не подготовлен для бота.');
  }

  if (code === 'stale_log') {
    return getStaleReasonEvidence(meta);
  }

  if (code === 'proxy_ban_pool') {
    const line = findFirstMatchingLine(text, /All proxies banned|Все .*прокси .*забанены/i);
    return cleanEvidenceLine(line || 'Все прокси для узла забанены.');
  }

  if (code === 'waf_429') {
    const line = findLastLineByPredicate(text, isOperationalWafRateLine);
    return cleanEvidenceLine(line || 'Узел получает защитные ответы WAF/429/403.');
  }

  if (code === 'ws_timeout') {
    const line = findFirstMatchingLine(text, /WS endpoint|stdout/i);
    return cleanEvidenceLine(line || 'Таймаут ожидания адреса WS endpoint.');
  }

  if (code === 'dom_selector_error') {
    const line = findFirstMatchingLine(text, /innerHTML|querySelector|Cannot read properties of null/i);
    return cleanEvidenceLine(line || 'DOM-элемент не найден.');
  }

  if (code === 'calendar_empty') {
    const line = findFirstMatchingLine(text, /Ответ календаря пуст|calendar.*empty/i);
    return cleanEvidenceLine(line || 'Календарь отвечает пусто.');
  }

  const fallback = cleanEvidenceLine(
    getActionableLastError(node?.last_error)
    || findLastUnrecoveredActionableErrorLine(text)
    || findFirstMatchingLine(text, /.+/)
  );
  return fallback || ISSUE_DEFS.other.summary;
}

function normalizeIssueCodes(node, text, meta) {
  const codes = [];
  const lowered = String(text || '');
  const proxyBanCount = countProxyBans(node);
  const mismatchFlags = node?.derivedState?.mismatchFlags || [];
  const signalTypes = node?.derivedState?.signalTypes || [];
  const hasProxyBanPoolLog = hasLineByPredicate(text, isProxyBanPoolLine);
  const hasWafRateLog = hasLineByPredicate(text, isOperationalWafRateLine);
  const wafRecovered = hasRecoveryAfterIssue(text, /WAF BLOCK|WAF block|WAF 403|403 Cart body|Octofence|OctoFence|status=hard_blocked|hard_blocked|\b429\b|status=429|rate_limited|rate limit/i);
  const hasBrowserFailureText = /Failed to launch the browser process/i.test(lowered);
  const hasDisplayFailureText = /Missing X server|\$DISPLAY/i.test(lowered);
  const healthy = isOperationallyHealthy(node, meta);
  const browserRecovered = hasRecoveryAfterIssue(text, /Failed to launch the browser process/i)
    || (!hasBrowserFailureText && (hasRecoveryLine(text) || healthy));
  const displayRecovered = hasRecoveryAfterIssue(text, /Missing X server|\$DISPLAY/i)
    || (!hasDisplayFailureText && (hasRecoveryLine(text) || healthy));

  if (node?.status !== 'online' || node?.bot_status === 'stopped') {
    codes.push('offline');
  }

  if (mismatchFlags.length > 0) {
    codes.push('state_mismatch');
  }

  if (!browserRecovered && (signalTypes.includes('browser_launch_failed') || hasBrowserFailureText)) {
    codes.push('browser_launch_failed');
  }

  if (!displayRecovered && (signalTypes.includes('x_display_missing') || hasDisplayFailureText)) {
    codes.push('x_display_missing');
  }

  if (meta?.isStale) {
    codes.push('stale_log');
  }

  if (signalTypes.includes('ws_timeout') || /WS endpoint|stdout/i.test(lowered)) {
    codes.push('ws_timeout');
  }

  if (signalTypes.includes('dom_selector_error') || /innerHTML|querySelector|Cannot read properties of null/i.test(lowered)) {
    codes.push('dom_selector_error');
  }

  if (proxyBanCount > 0 && (signalTypes.includes('proxy_ban_pool') || hasProxyBanPoolLog || node?.bot_status === 'banned')) {
    codes.push('proxy_ban_pool');
  }

  if (false && (
    signalTypes.includes('proxy_ban_pool')
    || /All proxies banned|Все .*прокси .*забанены/i.test(lowered)
    || (node?.bot_status === 'banned' && proxyBanCount > 0)
  )) {
    codes.push('proxy_ban_pool');
  }

  if (!wafRecovered && (hasWafRateLog || signalTypes.includes('waf_blocked') || signalTypes.includes('rate_limited'))) {
    codes.push('waf_429');
  }

  if (false && (
    signalTypes.includes('waf_blocked')
    || signalTypes.includes('rate_limited')
    || /WAF block|\b429\b|\b403\b|rate limit/i.test(lowered)
  )) {
    codes.push('waf_429');
  }

  if (/Ответ календаря пуст|calendar.*empty/i.test(lowered)) {
    codes.push('calendar_empty');
  }

  if (codes.length === 0 && findLastUnrecoveredActionableErrorLine(text)) {
    codes.push('other');
  }

  return Array.from(new Set(codes)).sort((left, right) => ISSUE_ORDER.indexOf(left) - ISSUE_ORDER.indexOf(right));
}

function classifyNodeIssues(node, options = {}) {
  const text = [getActionableLastError(node?.last_error), options.logText || '']
    .filter(Boolean)
    .join('\n');
  const logMeta = options.logMeta || null;
  const codes = normalizeIssueCodes(node, text, logMeta);
  const updatedAt = options.updatedAt || logMeta?.updatedAt || new Date().toISOString();
  const issues = codes.map((code) => ({
    ...ISSUE_DEFS[code],
    evidence: buildEvidence(code, node, text, logMeta),
    updatedAt
  }));

  const noiseIssues = issues.filter((issue) => NOISE_ISSUE_CODES.has(issue.code));
  const operatorIssues = issues.filter((issue) => !NOISE_ISSUE_CODES.has(issue.code));
  const primaryIssue = operatorIssues[0] || null;
  const primaryNoiseIssue = noiseIssues[0] || null;

  return {
    nodeId: node.id,
    ip: node.ip,
    status: node.status,
    botStatus: node.bot_status,
    displayMode: node.displayMode || node?.extra?.runtimeMode || node?.extra?.mode || 'group',
    currentSlot: node.current_slot || null,
    cartState: node?.derivedState?.cartState || node?.extra?.cartState || null,
    confidence: node?.derivedState?.confidence || null,
    mismatchFlags: node?.derivedState?.mismatchFlags || [],
    heartbeatAgeSec: node.heartbeatAgeSec ?? null,
    issueCodes: issues.map((issue) => issue.code),
    issues,
    noiseIssues,
    primaryIssue,
    primaryNoiseIssue,
    updatedAt
  };
}

function buildEmptyOverview() {
  return {
    updatedAt: null,
    groups: [],
    noiseGroups: [],
    nodes: [],
    problemCounts: {},
    diagnosticNoiseCounts: {}
  };
}

function aggregateIssues(rows, updatedAt = new Date().toISOString()) {
  const groupsByCode = new Map();
  const problemCounts = {};
  const noiseGroupsByCode = new Map();
  const diagnosticNoiseCounts = {};

  rows
    .filter((row) => row.primaryIssue)
    .forEach((row) => {
      const issue = row.primaryIssue;
      if (!groupsByCode.has(issue.code)) {
        groupsByCode.set(issue.code, {
          code: issue.code,
          label: issue.label,
          severity: issue.severity,
          count: 0,
          updatedAt,
          lastEvidence: issue.evidence,
          nodes: []
        });
      }

      const group = groupsByCode.get(issue.code);
      group.count += 1;
      group.lastEvidence = issue.evidence || group.lastEvidence;
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
        updatedAt: row.updatedAt
      });
      problemCounts[issue.code] = group.count;
    });

  rows
    .filter((row) => row.primaryNoiseIssue)
    .forEach((row) => {
      const issue = row.primaryNoiseIssue;
      if (!noiseGroupsByCode.has(issue.code)) {
        noiseGroupsByCode.set(issue.code, {
          code: issue.code,
          label: issue.label,
          severity: issue.severity,
          count: 0,
          updatedAt,
          lastEvidence: issue.evidence,
          nodes: []
        });
      }

      const group = noiseGroupsByCode.get(issue.code);
      group.count += 1;
      group.lastEvidence = issue.evidence || group.lastEvidence;
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
        updatedAt: row.updatedAt
      });
      diagnosticNoiseCounts[issue.code] = group.count;
    });

  const groups = Array.from(groupsByCode.values())
    .sort((left, right) => {
      const bySeverity = ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code);
      if (bySeverity !== 0) return bySeverity;
      return right.count - left.count;
    });

  const noiseGroups = Array.from(noiseGroupsByCode.values())
    .sort((left, right) => {
      const bySeverity = ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code);
      if (bySeverity !== 0) return bySeverity;
      return right.count - left.count;
    });

  return {
    updatedAt,
    groups,
    noiseGroups,
    nodes: rows,
    problemCounts,
    diagnosticNoiseCounts
  };
}

function buildFallbackLogMeta(node) {
  return {
    source: 'issues-fallback',
    hasLogFile: false,
    mtimeMs: null,
    sizeBytes: 0,
    processState: node?.bot_status === 'stopped' ? 'STOPPED' : 'UNKNOWN',
    processId: null,
    logPath: null,
    isStale: false,
    staleReason: null
  };
}

function createIssueTracker({ getNodesEnvelope, ssh, telemetry, enrichLogMeta }) {
  let cache = buildEmptyOverview();
  let lastComputedAt = 0;
  let dirty = true;
  let pending = null;
  const allowSshFallback = process.env.ISSUES_SSH_FALLBACK === '1';

  async function readNodeContext(node) {
    const telemetrySnapshot = telemetry.getSnapshot(node.id);
    const telemetryText = (telemetrySnapshot.lines || []).map((entry) => entry.line).join('\n');

    if (telemetrySnapshot.lines.length > 0) {
      return {
        logText: telemetryText,
        logMeta: enrichLogMeta({
          ...buildFallbackLogMeta(node),
          source: 'telemetry',
          hasLogFile: true,
          processState: node?.bot_status === 'stopped' ? 'STOPPED' : 'RUNNING',
          mtimeMs: telemetrySnapshot.updatedAt ? new Date(telemetrySnapshot.updatedAt).getTime() : null,
          sizeBytes: telemetryText.length,
          updatedAt: telemetrySnapshot.updatedAt || null
        }, node)
      };
    }

    if (!allowSshFallback) {
      return {
        logText: '',
        logMeta: enrichLogMeta({
          ...buildFallbackLogMeta(node),
          source: 'stream-pending'
        }, node)
      };
    }

    try {
      const snapshot = await ssh.getLogSnapshot(node.ip, 160);
      if (snapshot?.log) {
        telemetry.seedFromSnapshot(node.id, snapshot.log, {
          cursor: snapshot.meta?.sizeBytes || 0,
          source: 'issues-ssh'
        });
      }

      return {
        logText: snapshot?.log || '',
        logMeta: enrichLogMeta({ ...(snapshot?.meta || {}), source: 'ssh' }, node)
      };
    } catch {
      return {
        logText: '',
        logMeta: enrichLogMeta(buildFallbackLogMeta(node), node)
      };
    }
  }

  async function computeOverview() {
    const nodes = getNodesEnvelope();
    const rows = await Promise.all(nodes.map(async (node) => {
      const context = await readNodeContext(node);
      return classifyNodeIssues(node, {
        ...context,
        updatedAt: new Date().toISOString()
      });
    }));

    cache = aggregateIssues(rows, new Date().toISOString());
    lastComputedAt = Date.now();
    dirty = false;
    return cache;
  }

  async function getOverview(options = {}) {
    const force = Boolean(options.force);
    const ttlMs = options.ttlMs || 15000;

    if (!force && !dirty && cache.updatedAt && Date.now() - lastComputedAt < ttlMs) {
      return cache;
    }

    if (pending) return pending;
    pending = computeOverview().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function getNodeIssues(node) {
    const context = await readNodeContext(node);
    return classifyNodeIssues(node, context);
  }

  function getCachedOverview() {
    return cache;
  }

  function markDirty() {
    dirty = true;
  }

  async function refreshIfNeeded(ttlMs = 15000) {
    if (!dirty && cache.updatedAt && Date.now() - lastComputedAt < ttlMs) return cache;
    return getOverview({ ttlMs });
  }

  return {
    classifyNodeIssues,
    getCachedOverview,
    getOverview,
    getNodeIssues,
    markDirty,
    refreshIfNeeded
  };
}

module.exports = {
  ISSUE_DEFS,
  ISSUE_ORDER,
  NOISE_ISSUE_CODES,
  createIssueTracker,
  classifyNodeIssues,
  isActionableErrorText,
  sanitizeHeartbeatLastError
};
