import type { CommandKind, NodeIssue, NodeRecord } from '@/types';

const NODE_STATUS_LABELS: Record<string, string> = {
  online: 'онлайн',
  offline: 'офлайн',
  stale: 'устарел',
  degraded: 'деградация',
  error: 'ошибка',
  unknown: 'неизвестно'
};

const BOT_STATUS_LABELS: Record<string, string> = {
  running: 'работает',
  stopped: 'остановлен',
  starting: 'запуск',
  restarting: 'перезапуск',
  deploying: 'деплой',
  checkout: 'оплата',
  hold: 'удержание',
  idle: 'ожидание',
  banned: 'заблокирован',
  unknown: 'неизвестно'
};

const MODE_LABELS: Record<string, string> = {
  group: 'Группа',
  individual: 'Individual 24h',
  underground: 'Underground',
  single: 'Одиночный',
  payment: 'Оплата',
  headless: 'Без графики'
};

const CART_STATE_LABELS: Record<string, string> = {
  idle: 'пусто',
  carted: 'в корзине',
  hold: 'удержание',
  checkout: 'оплата',
  paying: 'оплата',
  payment: 'оплата',
  released: 'отпущена',
  unknown: 'неизвестно'
};

const OPERATOR_HEALTH_LABELS: Record<string, string> = {
  checkout: 'Оплата',
  hold: 'Hold',
  running: 'Live',
  idle: 'Idle',
  stopped: 'Stop',
  offline: 'Offline',
  stale: 'Stale',
  problem: 'Проблема',
  unconfirmed: 'Спорно',
  unknown: 'Unknown'
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'в очереди',
  running: 'в работе',
  completed: 'завершено',
  done: 'завершено',
  success: 'успех',
  failed: 'ошибка',
  partial: 'частично',
  canceled: 'отменено'
};

const COMMAND_LABELS: Record<CommandKind, string> = {
  start: 'Старт',
  stop: 'Стоп',
  restart: 'Рестарт',
  pay: 'Оплата',
  'reset-cart': 'Сброс корзины',
  deploy: 'Деплой',
  'sidecar-sync': 'Сайдкар'
};

const ISSUE_LABELS: Record<string, string> = {
  offline: 'Офлайн',
  state_mismatch: 'Спорное состояние',
  browser_launch_failed: 'Браузер не стартует',
  x_display_missing: 'X display не найден',
  stale_log: 'Лог устарел',
  ws_timeout: 'Таймаут WS',
  dom_selector_error: 'DOM / селектор',
  proxy_ban_pool: 'Пул прокси забанен',
  waf_429: 'WAF / 429',
  calendar_empty: 'Пустой календарь',
  other: 'Прочее'
};

const SEVERITY_LABELS: Record<string, string> = {
  danger: 'критично',
  warning: 'внимание',
  info: 'инфо'
};

const LOG_SOURCE_LABELS: Record<string, string> = {
  fallback: 'резервный канал',
  remote: 'удаленный лог',
  telemetry: 'телеметрия',
  sidecar: 'сайдкар',
  database: 'база',
  db: 'база',
  stdout: 'stdout',
  ssh: 'ssh',
  stream: 'поток',
  'workstation-ssh': 'ssh',
  'ssh-snapshot': 'ssh'
};

const PROCESS_STATE_LABELS: Record<string, string> = {
  unknown: 'неизвестно',
  running: 'работает',
  stopped: 'остановлен',
  offline: 'офлайн',
  missing: 'нет процесса'
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  cart_update: 'Корзина',
  config_updated: 'Конфиг',
  config_apply: 'Применение конфига',
  bot_started: 'Бот запущен',
  bot_stopped: 'Бот остановлен',
  cart_reset: 'Сброс корзины',
  deployed: 'Деплой',
  pay_triggered: 'Оплата',
  vnc_started: 'VNC',
  error: 'Ошибка'
};

const SECRET_KEY_RE = /(password|secret|token|authorization|cookie|private[_-]?key|ssh[_-]?key)/i;
const NODE_PREFIX_RE = /\[NODE\s+(\d+)\]|NODE_(\d+)/gi;
const OPERATOR_TIME_ZONE = 'Europe/Rome';

const ALERT_TRANSLATIONS: Array<[RegExp, string]> = [
  [/All proxies banned/gi, 'Все прокси забанены'],
  [/WAF block/gi, 'Блок WAF'],
  [/Timed out after\s+(\d+)\s+ms/gi, 'Таймаут после $1 мс'],
  [/while waiting for the WS endpoint URL to appear in stdout/gi, 'при ожидании адреса WS-канала в stdout'],
  [/WS endpoint/gi, 'WS-канал'],
  [/\bstdout\b/gi, 'stdout'],
  [/Cannot read properties of null \(reading 'innerHTML'\)/gi, 'Получен null при чтении innerHTML'],
  [/Cannot read properties of null/gi, 'Получен null при обращении к DOM'],
  [/calendar response empty/gi, 'Пустой ответ календаря'],
  [/Response calendar empty/gi, 'Пустой ответ календаря'],
  [/Deploy successful/gi, 'Деплой завершен успешно'],
  [/Deploy failed/gi, 'Деплой завершился ошибкой'],
  [/Sidecar synced successfully/gi, 'Сайдкар синхронизирован'],
  [/Sidecar deployed successfully/gi, 'Сайдкар развернут'],
  [/Bot started via web panel/gi, 'Бот запущен из web-панели'],
  [/Bot stopped via web panel/gi, 'Бот остановлен из web-панели'],
  [/Bot stopped via control command/gi, 'Бот остановлен командой управления'],
  [/Bot restarted via control command/gi, 'Бот перезапущен командой управления'],
  [/Pay triggered via web panel/gi, 'Команда \\/pay отправлена из web-панели'],
  [/Pay triggered via control command/gi, 'Команда \\/pay отправлена из панели управления'],
  [/Configuration saved via web panel/gi, 'Конфиг сохранен из web-панели'],
  [/Config version\s+(\d+)\s+applied without restart/gi, 'Конфиг версии $1 применен без рестарта'],
  [/Restarted after proxy redistribution/gi, 'Перезапущен после перераспределения прокси'],
  [/No working SSH key found for\s+([0-9.]+)/gi, 'Не найден рабочий SSH-ключ для $1'],
  [/\boffline\b/gi, 'офлайн'],
  [/\bonline\b/gi, 'онлайн'],
  [/\berror\b/gi, 'ошибка'],
  [/\bstale\b/gi, 'устарел'],
  [/\brunning\b/gi, 'работает'],
  [/\bcheckout\b/gi, 'оплата'],
  [/\bhold\b/gi, 'удержание'],
  [/\bdeploy\b/gi, 'деплой']
];

function trimNodePrefix(text: string) {
  return text
    .replace(/^\d{2}:\d{2}\]\s*/, '')
    .replace(/^\[\d{2}:\d{2}\]\s*/, '')
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')
    .replace(/^[•·\-—–:|]+\s*/u, '')
    .trim();
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractBanUntilMs(value: unknown): number | null {
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

  const record = value as Record<string, unknown>;
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

function isActiveBanValue(value: unknown, now = Date.now()) {
  const untilMs = extractBanUntilMs(value);
  if (untilMs !== null) return untilMs > now;

  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(value);
}

export function formatTimestamp(value?: string | number | null) {
  if (!value) return 'нет';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'нет';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

export function formatSlotLabel(value?: string | null) {
  if (!value) return 'нет';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: OPERATOR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
  return `${formatted} Рим`;
}

export function formatSlotDate(value?: string | null) {
  if (!value) return 'без даты';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'без даты';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: OPERATOR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).format(date);
}

export function formatSlotTime(value?: string | null) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: OPERATOR_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function formatRelativeSeconds(value?: number | null) {
  if (value === null || value === undefined) return 'нет';
  if (value < 5) return 'сейчас';
  if (value < 60) return `${value} сек`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes < 60) return `${minutes} мин ${seconds} сек`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

export function formatRelativeSignedSeconds(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'нет';
  const seconds = Math.round(Number(value));
  const abs = Math.abs(seconds);
  const prefix = seconds < 0 ? '-' : '';
  if (abs < 60) return `${prefix}${abs} сек`;
  const minutes = Math.floor(abs / 60);
  const restSeconds = abs % 60;
  if (minutes < 60) return `${prefix}${minutes} мин ${restSeconds} сек`;
  const hours = Math.floor(minutes / 60);
  return `${prefix}${hours} ч ${minutes % 60} мин`;
}

export function formatDuration(value?: number | null) {
  if (!value) return '0 мин';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (!hours) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function getOperatorState(node?: NodeRecord | null) {
  return node?.operatorState || null;
}

export function getPrimaryIssue(node?: NodeRecord | null) {
  return node?.primaryIssue || null;
}

export function getNoiseIssues(node?: NodeRecord | null) {
  return Array.isArray(node?.noiseIssues) ? node.noiseIssues : [];
}

export function isDisputedNode(node?: NodeRecord | null) {
  if (!node) return false;
  if (node.operatorState?.disputed) return true;
  return Boolean(node.derivedState?.mismatchFlags?.length || getNoiseIssues(node).length);
}

export function getCartState(node?: NodeRecord | null) {
  if (!node) return 'idle';
  const operator = String(node.operatorState?.cartState || '').toLowerCase();
  if (operator) return operator;
  const derived = String(node.derivedState?.cartState || '').toLowerCase();
  if (derived) return derived;
  return (
    String(node.extra?.cartState || '').toLowerCase() ||
    (node.cart_items && node.cart_items !== 'null' ? 'carted' : null) ||
    null
  );
}

export function getNodeSlot(node?: NodeRecord | null) {
  if (!node) return null;
  return node.operatorState?.slot || node.derivedState?.slot || node.current_slot || null;
}

export function getTicketCount(node?: NodeRecord | null) {
  if (!node) return 0;
  if (typeof node.operatorState?.ticketCount === 'number') {
    return node.operatorState.ticketCount;
  }
  if (typeof node.derivedState?.ticketCount === 'number') {
    return node.derivedState.ticketCount;
  }

  const raw = String(node.cart_items || '');
  const totalMatch = raw.match(/\btotal\s*[:=]?\s*(\d+)\b/i) || raw.match(/\(total\s+(\d+)\)/i);
  if (totalMatch) return parseInt(totalMatch[1] || '0', 10) || 0;

  const matches = Array.from(raw.matchAll(/qty=(\d+)/g));
  return matches.reduce((sum, entry) => sum + (parseInt(entry[1] || '0', 10) || 0), 0);
}

export function getStateConfidence(node?: NodeRecord | null) {
  if (!node) return null;
  if (node.operatorState?.confidence) {
    return String(node.operatorState.confidence).toLowerCase() || null;
  }
  return String(node.derivedState?.confidence || '').toLowerCase() || null;
}

export function getRuntimeConfirmed(node?: NodeRecord | null) {
  if (!node) return false;
  if (typeof node.operatorState?.runtimeConfirmed === 'boolean') {
    return node.operatorState.runtimeConfirmed;
  }
  return Boolean(node.derivedState?.runtimeConfirmed);
}

export function getOperatorHealth(node?: NodeRecord | null) {
  if (!node) return 'unknown';
  if (node.operatorState?.health) return String(node.operatorState.health).toLowerCase();
  if (node.status !== 'online') return 'offline';
  const cartState = getCartState(node);
  if (isActiveCartState(cartState) && isActionableNode(node)) {
    return ['checkout', 'payment', 'paying'].includes(String(cartState || '').toLowerCase()) ? 'checkout' : 'hold';
  }
  if (node.primaryIssue) return 'problem';
  if (node.bot_status === 'stopped') return 'stopped';
  if (node.bot_status === 'running') return 'running';
  return 'idle';
}

export function formatOperatorHealth(value?: string | null) {
  const normalized = String(value || 'unknown').toLowerCase();
  return OPERATOR_HEALTH_LABELS[normalized] || normalized;
}

export function getOperatorHealthTone(value?: string | null) {
  const normalized = String(value || 'unknown').toLowerCase();
  if (['checkout', 'hold', 'running'].includes(normalized)) return 'success';
  if (['unconfirmed', 'stale'].includes(normalized)) return 'warning';
  if (['offline', 'problem', 'stopped'].includes(normalized)) return 'danger';
  return 'muted';
}

export function formatReleaseWindow(node?: NodeRecord | null) {
  const releaseInSec = node?.operatorState?.releaseInSec;
  if (releaseInSec === null || releaseInSec === undefined) return 'нет';
  if (releaseInSec <= 0) return `окно ${formatRelativeSignedSeconds(releaseInSec)}`;
  return `через ${formatRelativeSignedSeconds(releaseInSec)}`;
}

export function isActiveCartState(value?: string | null) {
  const normalized = String(value || '').toLowerCase();
  return ['carted', 'hold', 'checkout', 'paying', 'payment'].includes(normalized);
}

export function countActiveSlots(nodes: NodeRecord[]) {
  return nodes.filter((node) => getNodeSlot(node) && isActionableNode(node)).length;
}

export function isActionableNode(node?: NodeRecord | null) {
  if (!node) return false;
  if (typeof node.operatorState?.actionable === 'boolean') {
    return node.operatorState.actionable;
  }
  return isActiveCartState(getCartState(node));
}

export function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function countProxyBans(node: NodeRecord) {
  const raw = typeof node.proxy_bans === 'string'
    ? safeJson<Record<string, unknown>>(node.proxy_bans, {})
    : ((node.proxy_bans || {}) as Record<string, unknown>);

  const now = Date.now();
  return Object.values(raw).filter((entry) => isActiveBanValue(entry, now)).length;
}

export function maskSecret(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 'нет';
  const text = String(value);
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

export function formatNodeLabel(nodeId: number) {
  return `Узел ${String(nodeId).padStart(2, '0')}`;
}

export function formatNodeStatus(status?: string | null) {
  const normalized = String(status || 'unknown').toLowerCase();
  return NODE_STATUS_LABELS[normalized] || normalized;
}

export function formatBotStatus(status?: string | null) {
  const normalized = String(status || 'unknown').toLowerCase();
  return BOT_STATUS_LABELS[normalized] || normalized;
}

export function formatMode(mode?: string | null) {
  const normalized = String(mode || 'group').toLowerCase();
  return MODE_LABELS[normalized] || normalized;
}

export function formatModeSegment(mode?: string | null) {
  return formatMode(mode);
}

export function formatCartState(state?: string | null) {
  const normalized = String(state || 'idle').toLowerCase();
  return CART_STATE_LABELS[normalized] || normalized;
}

export function formatJobStatus(status?: string | null) {
  const normalized = String(status || 'unknown').toLowerCase();
  return JOB_STATUS_LABELS[normalized] || normalized;
}

export function formatCommandLabel(command: CommandKind) {
  return COMMAND_LABELS[command];
}

export function formatIssueLabel(code?: string | null) {
  const normalized = String(code || 'other').toLowerCase();
  return ISSUE_LABELS[normalized] || normalized;
}

export function formatSeverityLabel(value?: string | null) {
  const normalized = String(value || 'info').toLowerCase();
  return SEVERITY_LABELS[normalized] || normalized;
}

export function formatLogSource(value?: string | null) {
  const normalized = String(value || 'fallback').toLowerCase();
  return LOG_SOURCE_LABELS[normalized] || normalized;
}

export function formatProcessState(value?: string | null) {
  const normalized = String(value || 'unknown').toLowerCase();
  return PROCESS_STATE_LABELS[normalized] || normalized;
}

export function formatEventType(value?: string | null) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return 'Событие';
  return EVENT_TYPE_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

export function getIssueTone(issue?: Pick<NodeIssue, 'severity'> | null) {
  if (!issue) return 'muted';
  if (issue.severity === 'danger') return 'danger';
  if (issue.severity === 'warning') return 'warning';
  return 'info';
}

export function summarizeText(value?: string | null, max = 72) {
  if (!value) return '';
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function localizeAlertMessage(message?: string | null, nodeId?: number | null) {
  if (!message) {
    return nodeId ? `${formatNodeLabel(nodeId)} требует внимания.` : 'Есть сигнал по кластеру.';
  }

  let next = String(message)
    .replace(/\r/g, ' ')
    .replace(NODE_PREFIX_RE, (_, left: string, right: string) => formatNodeLabel(Number(left || right)))
    .replace(/^\s*\[[^\]]+\]\s*/g, '')
    .trim();

  next = trimNodePrefix(next);

  ALERT_TRANSLATIONS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  next = next
    .replace(/\s+\|\s+/g, ' • ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (nodeId) {
    const nodeLabel = formatNodeLabel(nodeId);
    next = next.replace(new RegExp(`^${nodeLabel}\\s*`, 'i'), '').trim();
  }

  return normalizeWhitespace(next);
}

export function formatIssueSummary(issue?: NodeIssue | null) {
  if (!issue) return 'Причина еще не определена.';
  return issue.summary || formatIssueLabel(issue.code);
}

export function getNodeMode(node?: NodeRecord | null) {
  return node?.displayMode || node?.extra?.runtimeMode || node?.extra?.mode || 'group';
}

export function formatConfidence(value?: string | null) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 'подтверждено';
  if (normalized === 'medium') return 'средняя уверенность';
  if (normalized === 'low') return 'неподтверждено';
  return 'нет';
}

export function formatMismatchFlags(flags?: string[] | null) {
  if (!flags || flags.length === 0) return 'нет';

  const labels: Record<string, string> = {
    heartbeat_state_conflicts_with_logs: 'heartbeat расходится с логами',
    heartbeat_active_after_release: 'heartbeat держит корзину после release',
    heartbeat_only_active_cart: 'активная корзина видна только по heartbeat',
    logs_do_not_confirm_active_cart: 'логи не подтверждают корзину',
    heartbeat_cart_stale: 'heartbeat корзины устарел',
    slot_without_confirmed_cart: 'есть слот без подтвержденной корзины',
    checkout_not_confirmed: 'checkout не подтвержден',
    config_version_mismatch: 'версия runtime не совпала',
    runtime_mode_mismatch: 'режим runtime не совпал',
    runtime_window_mismatch: 'окно runtime не совпало',
    runtime_not_reported: 'runtime не прислал подтверждение'
  };

  return flags.map((flag) => labels[flag] || flag).join(', ');
}

function summarizeProxySets(value: Record<string, unknown>) {
  const nodeCount = Object.keys(value || {}).length;
  const totalEntries = Object.values(value || {}).reduce((sum: number, entry: unknown) => {
    if (Array.isArray(entry)) return sum + entry.length;
    return sum;
  }, 0);

  return {
    hidden: true,
    note: 'Пул прокси скрыт в предпросмотре. Управляйте им во вкладке «Прокси».',
    nodeCount,
    totalEntries
  };
}

export function sanitizeDataForDisplay<T>(value: T, options: { collapseProxySets?: boolean; maxArrayItems?: number } = {}): T {
  const { collapseProxySets = false, maxArrayItems = 10 } = options;

  const walk = (input: unknown): unknown => {
    if (input === null || input === undefined) return input;

    if (Array.isArray(input)) {
      const items = input.slice(0, maxArrayItems).map((entry) => walk(entry));
      if (input.length > maxArrayItems) {
        items.push(`… еще ${input.length - maxArrayItems} элементов`);
      }
      return items;
    }

    if (typeof input === 'object') {
      const source = input as Record<string, unknown>;
      const output: Record<string, unknown> = {};

      Object.entries(source).forEach(([key, entry]) => {
        if (collapseProxySets && key === 'proxies' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
          output[key] = summarizeProxySets(entry as Record<string, unknown>);
          return;
        }

        if (SECRET_KEY_RE.test(key)) {
          output[key] = maskSecret(typeof entry === 'string' || typeof entry === 'number' ? entry : 'hidden');
          return;
        }

        output[key] = walk(entry);
      });

      return output;
    }

    if (typeof input === 'string') {
      return input.length > 220 ? summarizeText(input, 220) : input;
    }

    return input;
  };

  return walk(value) as T;
}

const RDP_USERNAME = 'root';

export function downloadRdpFile(node: Pick<NodeRecord, 'id' | 'ip'>) {
  const content = [
    `full address:s:${node.ip}:3389`,
    `username:s:${RDP_USERNAME}`,
    'authentication level:i:0',
    'enablecredsspsupport:i:0',
    'prompt for credentials:i:0',
    'promptcredentialonce:i:0',
    'screen mode id:i:2',
    'desktopwidth:i:1920',
    'desktopheight:i:1080',
    'session bpp:i:32',
    'redirectclipboard:i:1',
    'autoreconnection enabled:i:1'
  ].join('\r\n');

  const blob = new Blob([content], { type: 'application/rdp' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Node_${String(node.id).padStart(2, '0')}_${node.ip}.rdp`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
