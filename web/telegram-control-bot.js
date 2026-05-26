const fs = require('fs');
const path = require('path');

const DEFAULT_REFRESH_INTERVAL_MS = 15000;
const DEFAULT_VIEW = 'bots';
const MAX_TELEGRAM_TEXT_LENGTH = 3900;
const ACTIVE_CART_STATES = new Set(['carted', 'hold', 'checkout', 'paying', 'payment']);
const OPERATOR_TIME_ZONE = 'Europe/Rome';
const CART_RELEASE_WINDOW_MS = 15 * 60 * 1000;

const HEALTH_META = {
  checkout: { icon: '🟪', code: 'PAY', label: 'оплата' },
  hold: { icon: '🟨', code: 'HOLD', label: 'hold' },
  running: { icon: '🟩', code: 'LIVE', label: 'работает' },
  idle: { icon: '⬜', code: 'IDLE', label: 'idle' },
  stopped: { icon: '🟥', code: 'STOP', label: 'стоп' },
  offline: { icon: '⬛', code: 'OFF', label: 'offline' },
  stale: { icon: '🟫', code: 'OLD', label: 'stale' },
  problem: { icon: '🟧', code: 'CHECK', label: 'проверить' },
  unconfirmed: { icon: '🟧', code: 'CHK', label: 'проверить' },
  disabled: { icon: '◼️', code: 'SKIP', label: 'выкл' },
  unknown: { icon: '⬜', code: 'UNK', label: 'unknown' }
};

const NODE_STATUS_LABELS = {
  online: 'онлайн',
  offline: 'офлайн',
  stale: 'устарел',
  degraded: 'деградация',
  error: 'ошибка',
  unknown: 'неизвестно'
};

const BOT_STATUS_LABELS = {
  running: 'работает',
  stopped: 'остановлен',
  starting: 'запуск',
  restarting: 'перезапуск',
  deploying: 'деплой',
  checkout: 'оплата',
  hold: 'удержание',
  idle: 'ожидание',
  error: 'ошибка',
  unknown: 'неизвестно'
};

const MODE_LABELS = {
  group: 'Группа',
  underground: 'Underground',
  single: 'Одиночный',
  payment: 'Оплата',
  headless: 'Без графики'
};

const CART_STATE_LABELS = {
  idle: 'пусто',
  carted: 'в корзине',
  hold: 'удержание',
  checkout: 'оплата',
  paying: 'оплата',
  payment: 'оплата',
  released: 'отпущена',
  unknown: 'неизвестно'
};

const CART_CODE_LABELS = {
  idle: 'IDLE',
  carted: 'CART',
  hold: 'HOLD',
  checkout: 'PAY',
  paying: 'PAY',
  payment: 'PAY',
  released: 'REL',
  unknown: 'UNK'
};

function formatLabel(map, value, fallback = 'unknown') {
  const normalized = String(value || fallback).toLowerCase();
  return map[normalized] || normalized;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clippedHtml(lines) {
  const result = [];
  let length = 0;
  for (const line of lines) {
    const nextLength = length + (result.length > 0 ? 1 : 0) + String(line).length;
    if (nextLength > MAX_TELEGRAM_TEXT_LENGTH - 2) {
      result.push('…');
      break;
    }
    result.push(line);
    length = nextLength;
  }
  return result.join('\n');
}

function pad(value, width, align = 'left') {
  const text = String(value ?? '');
  if (text.length >= width) return text.slice(0, width);
  return align === 'right' ? text.padStart(width, ' ') : text.padEnd(width, ' ');
}

function codeLine(value) {
  return escapeHtml(value);
}

function formatNodeLabel(nodeId) {
  return `Узел ${String(nodeId).padStart(2, '0')}`;
}

function formatRelativeSeconds(value) {
  if (value === null || value === undefined) return 'нет';
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 5) return 'сейчас';
  if (seconds < 60) return `${Math.floor(seconds)} сек`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes} мин ${restSeconds} сек`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

function formatCompactAge(value) {
  if (value === null || value === undefined) return '--';
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function fixedDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '----';
  const seconds = Math.max(0, Math.round(Number(value)));
  if (seconds < 60) return `${String(seconds).padStart(3, '0')}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes).padStart(3, '0')}m`;
  const hours = Math.min(999, Math.floor(minutes / 60));
  return `${String(hours).padStart(3, '0')}h`;
}

function fixedSignedDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '----';
  const seconds = Math.round(Number(value));
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${sign}${String(abs).padStart(sign ? 2 : 3, '0')}s`;
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return `${sign}${String(minutes).padStart(sign ? 2 : 3, '0')}m`;
  const hours = Math.min(999, Math.floor(minutes / 60));
  return `${sign}${String(hours).padStart(sign ? 2 : 3, '0')}h`;
}

function formatSignedCompact(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const seconds = Math.round(Number(value));
  const prefix = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${prefix}${abs}s`;
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return `${prefix}${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${prefix}${hours}h`;
}

function formatUpdated(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: OPERATOR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
  return `${formatted} Рим`;
}

function formatSlotLabel(value) {
  if (!value) return 'нет';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: OPERATOR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
  return `${formatted} Рим`;
}

function getSlotDateKey(value) {
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

function getSlotTime(value) {
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

function parseAllowedChatIds(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseExtra(node) {
  if (!node) return {};
  if (node.extra && typeof node.extra === 'object') return node.extra;
  try {
    return JSON.parse(node.extra || '{}');
  } catch {
    return {};
  }
}

function getDisabledNodeIds(config) {
  return new Set((config?.proxyPool?.disabledNodeIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0));
}

function getCartState(node) {
  if (!node) return 'idle';
  const operator = String(node.operatorState?.cartState || '').toLowerCase();
  if (operator) return operator;
  const derived = String(node.derivedState?.cartState || '').toLowerCase();
  if (derived) return derived;
  const extra = parseExtra(node);
  return String(extra.cartState || '').toLowerCase()
    || (node.cart_items && node.cart_items !== 'null' ? 'carted' : 'idle');
}

function getNodeSlot(node) {
  if (!node) return null;
  return node.operatorState?.slot || node.derivedState?.slot || node.current_slot || null;
}

function getTicketCount(node) {
  if (!node) return 0;
  if (typeof node.operatorState?.ticketCount === 'number') return node.operatorState.ticketCount;
  if (typeof node.derivedState?.ticketCount === 'number') return node.derivedState.ticketCount;
  const raw = String(node.cart_items || '');
  const totalMatch = raw.match(/\btotal\s*[:=]?\s*(\d+)\b/i) || raw.match(/\(total\s+(\d+)\)/i);
  if (totalMatch) return parseInt(totalMatch[1] || '0', 10) || 0;
  return Array.from(raw.matchAll(/qty=(\d+)/g))
    .reduce((sum, entry) => sum + (parseInt(entry[1] || '0', 10) || 0), 0);
}

function getNodeMode(node) {
  return node?.displayMode || node?.extra?.runtimeMode || node?.extra?.mode || 'group';
}

function isActiveCartState(value) {
  return ACTIVE_CART_STATES.has(String(value || '').toLowerCase());
}

function isActionableNode(node) {
  if (!node) return false;
  if (typeof node.operatorState?.actionable === 'boolean') return node.operatorState.actionable;
  return isActiveCartState(getCartState(node));
}

function isDisputedNode(node) {
  if (!node) return false;
  if (node.operatorState?.disputed) return true;
  if ((node.operatorState?.mismatchFlags || []).length > 0) return true;
  if ((node.derivedState?.mismatchFlags || []).length > 0) return true;
  return Array.isArray(node.noiseIssues) && node.noiseIssues.length > 0;
}

function getPrimaryIssue(node) {
  return node?.primaryIssue || null;
}

function formatIssue(node) {
  const primary = getPrimaryIssue(node);
  if (primary?.summary) return ` • проблема: ${String(primary.summary).slice(0, 42)}`;
  if (primary?.code) return ` • проблема: ${primary.code}`;
  return '';
}

function getNodeHealth(node, config) {
  const disabledNodeIds = getDisabledNodeIds(config);
  if (disabledNodeIds.has(Number(node?.id))) return 'disabled';
  if (node?.status !== 'online') return 'offline';
  const cartState = getCartState(node);
  if (['checkout', 'paying', 'payment'].includes(cartState) && isActionableNode(node)) return 'checkout';
  if (['hold', 'carted'].includes(cartState) && isActionableNode(node)) return 'hold';
  const operatorHealth = String(node?.operatorState?.health || '').toLowerCase();
  if (operatorHealth && operatorHealth !== 'problem') return operatorHealth;
  if (getPrimaryIssue(node)) return 'problem';
  if (isActiveCartState(cartState)) return 'unconfirmed';
  if (String(node?.bot_status || '').toLowerCase() === 'stopped') return 'stopped';
  if (String(node?.bot_status || '').toLowerCase() === 'running') return 'running';
  return 'idle';
}

function getHealthMeta(node, config) {
  return HEALTH_META[getNodeHealth(node, config)] || HEALTH_META.unknown;
}

function getCartCode(node) {
  return formatLabel(CART_CODE_LABELS, getCartState(node), 'idle');
}

function getStatusCode(node, config) {
  const value = getNodeHealth(node, config);
  return {
    checkout: 'PAY',
    hold: 'HLD',
    running: 'RUN',
    idle: 'IDL',
    stopped: 'STP',
    offline: 'OFF',
    stale: 'OLD',
    problem: 'CHK',
    unconfirmed: 'CHK',
    disabled: 'SKP',
    unknown: 'UNK'
  }[value] || 'UNK';
}

function getCartShortCode(node) {
  const value = getCartState(node);
  return {
    idle: '-',
    carted: 'C',
    hold: 'H',
    checkout: 'P',
    paying: 'P',
    payment: 'P',
    released: 'R',
    unknown: '?'
  }[value] || '?';
}

function getReleaseInSec(node) {
  if (typeof node?.operatorState?.releaseInSec === 'number') return node.operatorState.releaseInSec;
  const extra = parseExtra(node);
  const cartUpdatedAt = extra.cartUpdatedAt || node?.operatorState?.cartUpdatedAt || null;
  const cartUpdatedMs = Date.parse(cartUpdatedAt || '');
  if (!Number.isFinite(cartUpdatedMs) || !isActiveCartState(getCartState(node))) return null;
  return Math.floor((cartUpdatedMs + CART_RELEASE_WINDOW_MS - Date.now()) / 1000);
}

function formatNodeId(node) {
  return `#${String(node?.id || 0).padStart(2, '0')}`;
}

function formatProxy(node) {
  return Number.isFinite(Number(node?.current_proxy)) ? `P${Number(node.current_proxy)}` : 'P-';
}

function formatNodeSlotCompact(node) {
  const slot = getNodeSlot(node);
  return slot ? `${getSlotDateKey(slot).slice(0, 5)}/${getSlotTime(slot)}` : '--.--/--:--';
}

function formatReleaseCompact(node) {
  const release = formatSignedCompact(getReleaseInSec(node));
  return release === '--' ? 'ETA --' : `ETA ${release}`;
}

function sortNodesById(nodes) {
  return [...(nodes || [])].sort((left, right) => Number(left?.id || 0) - Number(right?.id || 0));
}

function sortNodesBySlot(nodes) {
  return [...(nodes || [])].sort((left, right) => String(getNodeSlot(left) || '').localeCompare(String(getNodeSlot(right) || '')));
}

function buildSlotNodes(nodes) {
  return sortNodesBySlot((nodes || []).filter((node) => getNodeSlot(node) && isActionableNode(node)));
}

function buildSummary(overview, config) {
  const disabledNodeIds = getDisabledNodeIds(config);
  const nodes = overview?.nodes || [];
  const enabledNodes = nodes.filter((node) => !disabledNodeIds.has(Number(node.id)));
  const slotNodes = buildSlotNodes(enabledNodes);
  const totalTickets = slotNodes.reduce((sum, node) => sum + getTicketCount(node), 0);
  const checkoutCount = slotNodes.filter((node) => getCartState(node) === 'checkout').length;
  const holdCount = slotNodes.filter((node) => getCartState(node) === 'hold').length;
  const problemCount = enabledNodes.filter((node) => node.status !== 'online' || getPrimaryIssue(node)).length;
  const diagnosticCount = enabledNodes.filter((node) => isDisputedNode(node)).length;

  return {
    total: nodes.length,
    enabled: enabledNodes.length,
    online: enabledNodes.filter((node) => node.status === 'online').length,
    running: enabledNodes.filter((node) => node.bot_status === 'running').length,
    slotNodes,
    totalTickets,
    checkoutCount,
    holdCount,
    problemCount,
    diagnosticCount
  };
}

function formatBotLine(node, config) {
  const status = getStatusCode(node, config);
  const cart = getCartShortCode(node);
  const tickets = String(Math.min(99, getTicketCount(node))).padStart(2, '0');
  const proxy = Number.isFinite(Number(node.current_proxy))
    ? `P${String(Number(node.current_proxy)).padStart(3, '0')}`
    : 'P---';
  return [
    formatNodeId(node),
    status,
    cart,
    tickets,
    formatNodeSlotCompact(node),
    proxy,
    fixedDuration(node.heartbeatAgeSec)
  ].join('|');
}

function formatSlotNodeLine(node, config) {
  const slot = getNodeSlot(node);
  const status = getStatusCode(node, config);
  const tickets = String(Math.min(99, getTicketCount(node))).padStart(2, '0');
  const proxy = Number.isFinite(Number(node.current_proxy))
    ? `P${String(Number(node.current_proxy)).padStart(3, '0')}`
    : 'P---';
  return [
    getSlotTime(slot),
    formatNodeId(node),
    status,
    tickets,
    proxy,
    fixedSignedDuration(getReleaseInSec(node))
  ].join('|');
}

function buildHealthLegend(summary, nodes, config) {
  const counts = new Map();
  for (const node of nodes || []) {
    const meta = getHealthMeta(node, config);
    counts.set(meta.code, (counts.get(meta.code) || 0) + 1);
  }
  const checkCount = (counts.get('CHECK') || 0) + (counts.get('OFF') || 0) + (counts.get('OLD') || 0) + (counts.get('STOP') || 0) + (counts.get('CHK') || 0);
  return [
    `${HEALTH_META.hold.icon} Hold ${counts.get('HOLD') || 0}`,
    `${HEALTH_META.checkout.icon} Pay ${counts.get('PAY') || 0}`,
    `${HEALTH_META.running.icon} Live ${counts.get('LIVE') || 0}`,
    `${HEALTH_META.problem.icon} Check ${checkCount}`,
    `🎟 ${summary.totalTickets}`
  ].join(' · ');
}

function buildDashboardKeyboard(view) {
  const botsText = view === 'bots' ? 'Боты · активна' : 'Боты';
  const ticketsText = view === 'tickets' ? 'Билеты · активна' : 'Билеты';

  return {
    inline_keyboard: [
      [
        { text: botsText, callback_data: 'tg:view:bots' },
        { text: ticketsText, callback_data: 'tg:view:tickets' }
      ],
      [{ text: 'Обновить', callback_data: `tg:refresh:${view}` }]
    ]
  };
}

function buildFocusLine(nodes, config) {
  const issueNodes = (nodes || [])
    .filter((node) => ['offline', 'stale', 'problem', 'stopped', 'unconfirmed'].includes(getNodeHealth(node, config)))
    .sort((left, right) => Number(left?.id || 0) - Number(right?.id || 0));
  if (issueNodes.length === 0) return null;

  const preview = issueNodes
    .slice(0, 8)
    .map((node) => {
      const meta = getHealthMeta(node, config);
      return `${formatNodeId(node)} ${meta.code}`;
    })
    .join(', ');
  const rest = issueNodes.length > 8 ? `, +${issueNodes.length - 8}` : '';
  return `Проверить: ${preview}${rest}`;
}

function buildBotsView(overview, config) {
  const summary = buildSummary(overview, config);
  const nodes = sortNodesById(overview?.nodes || []);
  const enabledNodes = nodes.filter((node) => !getDisabledNodeIds(config).has(Number(node.id)));
  const focusLine = buildFocusLine(enabledNodes, config);
  const header = 'BOT|STA|C|TT|SLOT       |PROX|HB  ';
  const lines = [
    '<b>CONTROL</b>',
    escapeHtml(buildHealthLegend(summary, enabledNodes, config)),
    escapeHtml(`online ${summary.online}/${summary.enabled} · slots ${summary.slotNodes.length} · drift ${summary.diagnosticCount}`),
    '',
    codeLine(header),
    ...nodes.map((node) => codeLine(formatBotLine(node, config))),
    ...(focusLine ? ['', escapeHtml(focusLine)] : []),
    '',
    escapeHtml(`updated ${formatUpdated(overview?.generatedAt || new Date())}`)
  ];

  return {
    view: 'bots',
    text: clippedHtml(lines),
    keyboard: buildDashboardKeyboard('bots')
  };
}

function buildTicketsView(overview, config) {
  const summary = buildSummary(overview, config);
  const grouped = new Map();

  for (const node of summary.slotNodes) {
    const dateKey = getSlotDateKey(getNodeSlot(node));
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey).push(node);
  }

  const lines = [
    '<b>TICKETS</b>',
    escapeHtml(`slots ${summary.slotNodes.length} · tickets ${summary.totalTickets} · hold/pay ${summary.holdCount}/${summary.checkoutCount}`)
  ];

  if (summary.slotNodes.length === 0) {
    lines.push('', 'Сейчас нет подтвержденных удержаний или оплаты.');
  } else {
    for (const [date, nodes] of grouped.entries()) {
      const header = 'TIME |BOT|STA|TT|PROX|ETA ';
      lines.push('', `<b>${escapeHtml(date)} · ${nodes.length} слотов</b>`);
      lines.push(codeLine(header));
      lines.push(...nodes.map((node) => codeLine(formatSlotNodeLine(node, config))));
    }
  }

  lines.push('', escapeHtml(`updated ${formatUpdated(overview?.generatedAt || new Date())}`));

  return {
    view: 'tickets',
    text: clippedHtml(lines),
    keyboard: buildDashboardKeyboard('tickets')
  };
}

function buildDashboardView(overview, config, view = DEFAULT_VIEW) {
  if (view === 'tickets') return buildTicketsView(overview, config);
  return buildBotsView(overview, config);
}

function loadDashboardState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { chats: {} };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const chats = {};
    for (const [chatId, entry] of Object.entries(raw?.chats || {})) {
      const messageId = Number(entry?.messageId || 0);
      if (!Number.isInteger(messageId) || messageId <= 0) continue;
      const view = entry?.view === 'tickets' ? 'tickets' : 'bots';
      chats[String(chatId)] = { messageId, view };
    }
    return { chats };
  } catch {
    return { chats: {} };
  }
}

function saveDashboardState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

function createTelegramControlBot(options = {}) {
  const token = String(options.token || process.env.TELEGRAM_CONTROL_BOT_TOKEN || '').trim();
  const getOverview = typeof options.getOverview === 'function' ? options.getOverview : () => ({ nodes: [] });
  const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});
  const logger = options.logger || console;
  const statePath = options.statePath || path.join(__dirname, 'data', 'telegram-control-state.json');
  const refreshIntervalMs = Math.max(
    5000,
    Number(options.refreshIntervalMs || process.env.TELEGRAM_CONTROL_REFRESH_INTERVAL_MS || DEFAULT_REFRESH_INTERVAL_MS)
  );

  let bot = null;
  let refreshTimer = null;
  let dashboardState = loadDashboardState(statePath);
  let pollingConflictLogged = false;

  function safeGetOverview() {
    try {
      return getOverview() || { nodes: [] };
    } catch (error) {
      logger.warn?.(`[TG] overview unavailable: ${error.message}`);
      return { nodes: [] };
    }
  }

  function safeGetConfig() {
    try {
      return getConfig() || {};
    } catch {
      return {};
    }
  }

  function getAllowedChatIds() {
    const config = safeGetConfig();
    const raw = process.env.TELEGRAM_CONTROL_CHAT_ID
      || process.env.TELEGRAM_CHAT_ID
      || config?.telegram?.chatId
      || '';
    return parseAllowedChatIds(raw);
  }

  function isAllowedChat(chatId) {
    const allowed = getAllowedChatIds();
    if (allowed.length === 0) return false;
    return allowed.includes(String(chatId));
  }

  function getChatState(chatId) {
    const key = String(chatId);
    if (!dashboardState.chats[key]) {
      dashboardState.chats[key] = { messageId: null, view: DEFAULT_VIEW };
    }
    return dashboardState.chats[key];
  }

  function setChatState(chatId, updates) {
    const key = String(chatId);
    const current = getChatState(chatId);
    dashboardState.chats[key] = {
      messageId: Number(updates?.messageId ?? current.messageId) || null,
      view: updates?.view === 'tickets' ? 'tickets' : (updates?.view || current.view || DEFAULT_VIEW)
    };
    saveDashboardState(statePath, dashboardState);
    return dashboardState.chats[key];
  }

  async function sendText(chatId, text, keyboard) {
    if (!bot) return null;
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      disable_web_page_preview: true,
      disable_notification: true
    }).catch((error) => {
      logger.warn?.(`[TG] send failed: ${error.message}`);
      return null;
    });
  }

  async function tryEditMessage(chatId, messageId, text, keyboard) {
    if (!bot || !messageId) return null;
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: keyboard,
      disable_web_page_preview: true
    }).then(() => ({ message_id: messageId })).catch((error) => {
      if (/message is not modified/i.test(error.message || '')) {
        return { message_id: messageId };
      }
      if (/message to edit not found|message can't be edited/i.test(error.message || '')) {
        return null;
      }
      logger.warn?.(`[TG] edit failed: ${error.message}`);
      return null;
    });
  }

  async function renderDashboard(chatId, requestedView = null, preferredMessageId = null) {
    if (!bot) return null;
    const state = getChatState(chatId);
    const view = requestedView === 'tickets' ? 'tickets' : (requestedView || state.view || DEFAULT_VIEW);
    const payload = buildDashboardView(safeGetOverview(), safeGetConfig(), view);
    const candidateMessageIds = [];

    if (state.messageId) candidateMessageIds.push(state.messageId);
    if (preferredMessageId && !candidateMessageIds.includes(Number(preferredMessageId))) {
      candidateMessageIds.push(Number(preferredMessageId));
    }

    for (const messageId of candidateMessageIds) {
      const edited = await tryEditMessage(chatId, messageId, payload.text, payload.keyboard);
      if (edited?.message_id) {
        setChatState(chatId, { messageId: edited.message_id, view });
        return edited;
      }
    }

    const sent = await sendText(chatId, payload.text, payload.keyboard);
    if (sent?.message_id) {
      setChatState(chatId, { messageId: sent.message_id, view });
    } else {
      setChatState(chatId, { view });
    }
    return sent;
  }

  function viewFromCommand(command) {
    if (command === '/tickets') return 'tickets';
    return 'bots';
  }

  function viewFromCallback(data, fallbackView = DEFAULT_VIEW) {
    if (data === 'tg:view:tickets') return 'tickets';
    if (data === 'tg:view:bots') return 'bots';
    const refreshMatch = String(data || '').match(/^tg:refresh:(bots|tickets)$/);
    if (refreshMatch) return refreshMatch[1];
    return fallbackView;
  }

  async function refreshDashboards() {
    const allowed = getAllowedChatIds();
    for (const chatId of allowed) {
      const state = getChatState(chatId);
      await renderDashboard(chatId, state.view || DEFAULT_VIEW);
    }
  }

  function start() {
    if (!token) {
      logger.log?.('[TG] control bot disabled: TELEGRAM_CONTROL_BOT_TOKEN is not set');
      return false;
    }

    const chatIds = getAllowedChatIds();
    if (chatIds.length === 0) {
      logger.warn?.('[TG] control bot disabled: TELEGRAM_CONTROL_CHAT_ID or telegram.chatId is required');
      return false;
    }

    let TelegramBot;
    try {
      TelegramBot = require('node-telegram-bot-api');
    } catch (error) {
      logger.warn?.(`[TG] control bot disabled: node-telegram-bot-api is unavailable (${error.message})`);
      return false;
    }

    try {
      bot = new TelegramBot(token, { polling: true });
    } catch (error) {
      bot = null;
      logger.warn?.(`[TG] control bot disabled: failed to start polling (${error.message})`);
      return false;
    }

    bot.on('message', (msg) => {
      const chatId = msg.chat?.id;
      if (!isAllowedChat(chatId)) return;
      if (msg.from?.is_bot) return;
      const parts = String(msg.text || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return;
      const command = parts[0].toLowerCase().replace(/@[^\s]+$/, '');
      if (!['/start', '/status', '/bots', '/tickets', '/refresh'].includes(command)) return;
      const view = viewFromCommand(command);
      void renderDashboard(chatId, view);
    });

    bot.on('callback_query', (query) => {
      const chatId = query.message?.chat?.id;
      if (!isAllowedChat(chatId)) return;
      const currentState = getChatState(chatId);
      const view = viewFromCallback(String(query.data || ''), currentState.view || DEFAULT_VIEW);
      void bot.answerCallbackQuery(query.id).catch(() => {});
      void renderDashboard(chatId, view, query.message?.message_id);
    });

    bot.on('polling_error', (error) => {
      const message = error?.message || String(error || 'unknown polling error');
      if (/409 Conflict/i.test(message)) {
        if (!pollingConflictLogged) {
          pollingConflictLogged = true;
          logger.warn?.('[TG] control bot polling disabled: another Telegram poller is active for this token');
        }
        stop();
        return;
      }
      logger.warn?.(`[TG] polling error: ${message}`);
    });

    void refreshDashboards();
    refreshTimer = setInterval(() => {
      void refreshDashboards().catch((error) => logger.warn?.(`[TG] refresh failed: ${error.message}`));
    }, refreshIntervalMs);
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
    logger.log?.(`[TG] dashboard bot started for ${chatIds.length} chat(s)`);
    return true;
  }

  function stop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (bot) {
      bot.stopPolling().catch(() => {});
      bot = null;
    }
  }

  return {
    start,
    stop,
    isEnabled: () => Boolean(bot)
  };
}

module.exports = {
  createTelegramControlBot
};
