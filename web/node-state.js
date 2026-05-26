const ACTIVE_CART_STATES = new Set(['carted', 'hold', 'checkout', 'paying', 'payment']);
const CART_STATE_BY_EVENT = {
  cart_added: 'carted',
  cart_alive: 'hold',
  hold_started: 'hold',
  checkout_started: 'checkout',
  cart_modified: 'checkout',
  checkout_ready: 'checkout'
};
const ISSUE_SIGNAL_TYPES = new Set([
  'browser_launch_failed',
  'x_display_missing',
  'dom_selector_error',
  'ws_timeout',
  'waf_blocked',
  'rate_limited',
  'proxy_ban_pool'
]);

const ACTIVE_CART_STALE_MS = 30 * 60 * 1000;
const RELEASE_VISIBLE_MS = 2 * 60 * 1000;
const LOG_FRESHNESS_MS = 25 * 1000;
const ISSUE_SIGNAL_VISIBLE_MS = 10 * 60 * 1000;

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseDbUtc(value) {
  if (!value) return null;
  const normalized = String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = parseDbUtc(value) || new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMs(value) {
  const parsed = toDate(value);
  return parsed ? parsed.getTime() : null;
}

function toIso(value) {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString() : null;
}

function parseNodeExtra(node) {
  if (!node) return {};
  if (node.extra && typeof node.extra === 'object') return node.extra;
  return safeJson(node.extra || '{}', {});
}

function parseGuideCountFromLine(line, fallback = 1) {
  const match = String(line || '').match(/\bguide=(\d+)/i);
  if (!match) return fallback;
  const parsed = parseInt(match[1] || '0', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getHeartbeatCartState(node) {
  const extra = parseNodeExtra(node);
  const extraState = String(extra.cartState || '').toLowerCase().trim();
  if (extraState) return extraState;
  if (node?.cart_items && node.cart_items !== 'null') return 'carted';
  return 'idle';
}

function extractTicketCountFromText(value) {
  const text = String(value || '');
  if (!text) return 0;

  const qtyMatches = Array.from(text.matchAll(/qty=(\d+)/gi));
  if (qtyMatches.length > 0) {
    return qtyMatches.reduce((sum, match) => sum + (parseInt(match[1] || '0', 10) || 0), 0);
  }

  const totalMatch = text.match(/\btotal\s*[:=]?\s*(\d+)\b/i) || text.match(/\(total\s+(\d+)\)/i);
  if (totalMatch) return parseInt(totalMatch[1] || '0', 10) || 0;

  const xMatches = Array.from(text.matchAll(/(\d+)\s*x\b/gi));
  if (xMatches.length > 0) {
    return xMatches.reduce((sum, match) => sum + (parseInt(match[1] || '0', 10) || 0), 0);
  }

  const ticketObjects = Array.from(text.matchAll(/(?:qty|quantity)["']?\s*[:=]\s*(\d+)/gi));
  if (ticketObjects.length > 0) {
    return ticketObjects.reduce((sum, match) => sum + (parseInt(match[1] || '0', 10) || 0), 0);
  }

  return 0;
}

function isStartupConfigLine(line) {
  return /COLOSSEUM TICKET SNIPER|WAF Fix|429 Calendar|403 after 429|Стратегия:.*WAF/i.test(String(line || ''));
}

function isOperationalWafLine(line) {
  const text = String(line || '');
  if (isStartupConfigLine(text)) return false;
  return /WAF BLOCK|WAF block|WAF 403|403 Cart body|Octofence|OctoFence|status=hard_blocked|hard_blocked/i.test(text);
}

function isOperationalRateLimitLine(line) {
  const text = String(line || '');
  if (isStartupConfigLine(text)) return false;
  return /\b429\b|status=429|rate_limited|rate limit/i.test(text);
}

function isProxyBanPoolLine(line) {
  return /All proxies banned|Все .*прокси .*забанены|\[PROXY BAN\].*all proxies banned/i.test(String(line || ''));
}

function isProxyBanClearedLine(line) {
  return /Бан прокси #.*(СЛЕТЕЛ|истек)|\[PROXY BAN\]\s+(?:proxy|expired proxy)\s+#\d+.*?(?:unbanned|cleared)/i.test(String(line || ''));
}

function extractSlotFromText(value) {
  const match = String(value || '').match(/([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)/);
  return match ? match[1] : null;
}

function normalizeSnapshotLines(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.lines)) return [];
  return snapshot.lines
    .map((entry) => ({
      ...entry,
      line: String(entry.line || '').replace(/\r/g, '').trimEnd(),
      ts: entry.ts || snapshot.updatedAt || null
    }))
    .filter((entry) => entry.line.length > 0);
}

function normalizeRecentEvents(events) {
  return (events || [])
    .map((event) => ({
      ...event,
      message: String(event.message || ''),
      created_at: event.created_at || null
    }))
    .filter((event) => event.message.length > 0);
}

function buildEvent(type, at, details = {}) {
  return {
    type,
    atMs: toMs(at) || Date.now(),
    at: toIso(at) || new Date().toISOString(),
    ...details
  };
}

function parseLogEvents(snapshot) {
  const lines = normalizeSnapshotLines(snapshot);
  const events = [];

  lines.forEach((entry) => {
    const line = entry.line;
    const at = entry.ts || snapshot?.updatedAt || null;
    const slot = extractSlotFromText(line);
    const ticketCount = extractTicketCountFromText(line);
    const paymentMarker = line.match(/\[PAYMENT\]\s+(payment_request_received|cart_modify_started|cart_modified|cart_modify_failed|checkout_ready|checkout_controlled_started|checkout_controlled_ready)\b/i);

    if (/\[HOLD\]\s+cart_alive\b/i.test(line)) {
      const adults = parseInt(line.match(/\badults=(\d+)/i)?.[1] || '0', 10) || 0;
      const children = parseInt(line.match(/\bchildren=(\d+)/i)?.[1] || '0', 10) || 0;
      const guide = parseGuideCountFromLine(line, 1);
      const total = parseInt(line.match(/\btotal=(\d+)/i)?.[1] || String(adults + children + guide), 10) || (adults + children + guide);
      events.push(buildEvent('cart_alive', at, { slot, ticketCount: total, adults, children, guide, raw: line }));
    }

    if (/\[HOLD\]\s+cart_released\b/i.test(line)) {
      events.push(buildEvent('cart_released', at, { slot, raw: line }));
    }

    if (paymentMarker) {
      const adults = parseInt(line.match(/\badults=(\d+)/i)?.[1] || '0', 10) || 0;
      const children = parseInt(line.match(/\bchildren=(\d+)/i)?.[1] || '0', 10) || 0;
      const guide = parseGuideCountFromLine(line, 1);
      const paymentTicketCount = adults || children ? adults + children + guide : 0;
      const type = paymentMarker[1].toLowerCase();
      const paymentDetails = { slot, ticketCount: paymentTicketCount, adults, children, guide, raw: line };

      if (type === 'cart_modified') {
        events.push(buildEvent('cart_modified', at, paymentDetails));
      } else if (type === 'checkout_ready') {
        events.push(buildEvent('checkout_ready', at, paymentDetails));
        events.push(buildEvent('checkout_started', at, paymentDetails));
      } else if (type === 'checkout_controlled_started' || type === 'checkout_controlled_ready') {
        events.push(buildEvent('checkout_started', at, paymentDetails));
      } else if (type === 'cart_modify_failed') {
        events.push(buildEvent('cart_modify_failed', at, { slot, raw: line }));
      }
    }

    if (/API Проверка слотов|Запрашиваем\s+\d+\s+мес/i.test(line)) {
      events.push(buildEvent('search_cycle_started', at, { slot, raw: line }));
    }

    if (/За наш промежуток времени билетов нет|calendar response empty|Response calendar empty/i.test(line)) {
      events.push(buildEvent('search_empty', at, { slot, raw: line }));
    }

    if (/ДОБАВЛЕНЫ В КОРЗИНУ:|Cart item saved:/i.test(line)) {
      events.push(buildEvent('cart_added', at, { slot, ticketCount, raw: line }));
    }

    if (/БИЛЕТЫ УСПЕШНО ДОБАВЛЕНЫ В КОРЗИНУ|РЕАЛЬНЫЙ УСПЕХ|HOLD цикл #|RE-CATCH #\d+\s+УСПЕХ/i.test(line)) {
      events.push(buildEvent('hold_started', at, { slot, ticketCount, raw: line }));
    }

    if (/Чистый Chrome запущен|Hold Mode ВЫКЛЮЧЕН|\/pay получен|Переходим к оплате/i.test(line)) {
      events.push(buildEvent('checkout_started', at, { slot, raw: line }));
    }

    if (/Re-catch не удался/i.test(line)) {
      events.push(buildEvent('cart_released', at, { raw: line }));
    }

    if (/Failed to launch the browser process/i.test(line)) {
      events.push(buildEvent('browser_launch_failed', at, { raw: line }));
    }

    if (/Missing X server|\$DISPLAY/i.test(line)) {
      events.push(buildEvent('x_display_missing', at, { raw: line }));
    }

    if (/innerHTML|querySelector|Cannot read properties of null/i.test(line)) {
      events.push(buildEvent('dom_selector_error', at, { raw: line }));
    }

    if (/WS endpoint|stdout/i.test(line)) {
      events.push(buildEvent('ws_timeout', at, { raw: line }));
    }

    if (isOperationalWafLine(line)) {
      events.push(buildEvent('waf_blocked', at, { raw: line }));
    }

    if (isOperationalRateLimitLine(line)) {
      events.push(buildEvent('rate_limited', at, { raw: line }));
    }

    if (/All proxies banned|Все .*прокси .*забанены/i.test(line)) {
      events.push(buildEvent('proxy_ban_pool', at, { raw: line }));
    }

    if (/Прокси #\d+.*забанен|WAF 403.*Прокси #/i.test(line)) {
      events.push(buildEvent('proxy_ban_added', at, { raw: line }));
    }

    if (/Бан прокси #.*(СЛЕТЕЛ|истек)/i.test(line)) {
      events.push(buildEvent('proxy_ban_cleared', at, { raw: line }));
    }

    if (slot && /(Выбираю|Лучший:|зарегистрирован в реестре|API POST \/addtocart|корзин|HOLD|checkout)/i.test(line)) {
      events.push(buildEvent('slot_seen', at, { slot, raw: line }));
    }
  });

  return events.sort((left, right) => left.atMs - right.atMs);
}

function parseEventRows(eventRows) {
  const rows = normalizeRecentEvents(eventRows);
  const events = [];

  rows.forEach((event) => {
    const message = event.message;
    const at = event.created_at || null;
    const ticketCount = extractTicketCountFromText(message);
    const slot = extractSlotFromText(message);

    if (event.type === 'cart_update') {
      events.push(buildEvent('cart_added', at, { slot, ticketCount, raw: message, source: 'db' }));
    }

    if (/Failed to launch the browser process/i.test(message)) {
      events.push(buildEvent('browser_launch_failed', at, { raw: message, source: 'db' }));
    }

    if (/Missing X server|\$DISPLAY/i.test(message)) {
      events.push(buildEvent('x_display_missing', at, { raw: message, source: 'db' }));
    }

    if (/WS endpoint|stdout/i.test(message)) {
      events.push(buildEvent('ws_timeout', at, { raw: message, source: 'db' }));
    }

    if (/innerHTML|querySelector|Cannot read properties of null/i.test(message)) {
      events.push(buildEvent('dom_selector_error', at, { raw: message, source: 'db' }));
    }

    if (/WAF block|\b429\b|\b403\b|rate limit/i.test(message)) {
      events.push(buildEvent('waf_blocked', at, { raw: message, source: 'db' }));
    }
  });

  return events.sort((left, right) => left.atMs - right.atMs);
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function compareRuntime(node) {
  const extra = parseNodeExtra(node);
  const expectedMode = extra.expectedMode || node.displayMode || 'group';
  const expectedWindow = extra.expectedWindow || null;
  const expectedVersion = Number(extra.expectedVersion || 0) || 0;
  const runtimeMode = extra.runtimeMode || extra.mode || null;
  const runtimeWindow = extra.runtimeWindow || null;
  const runtimeVersion = Number(extra.configVersion || 0) || 0;
  const expectsVersion = expectedVersion > 0;

  const mismatchFlags = [];
  if (expectsVersion && runtimeVersion !== expectedVersion) mismatchFlags.push('config_version_mismatch');
  if (expectedMode && runtimeMode && runtimeMode !== expectedMode) mismatchFlags.push('runtime_mode_mismatch');
  if (expectedWindow && runtimeWindow && runtimeWindow !== expectedWindow) mismatchFlags.push('runtime_window_mismatch');
  if (!runtimeMode || !runtimeWindow || !runtimeVersion) mismatchFlags.push('runtime_not_reported');

  const runtimeConfirmed = Boolean(
    runtimeMode &&
    runtimeWindow &&
    runtimeMode === expectedMode &&
    runtimeWindow === expectedWindow &&
    (!expectsVersion || runtimeVersion === expectedVersion)
  );

  return {
    runtimeConfirmed,
    expectedVersion,
    expectedMode,
    expectedWindow,
    runtimeVersion,
    runtimeMode,
    runtimeWindow,
    mismatchFlags
  };
}

function deriveFromSignals(node, logEvents, dbEvents, snapshot, nowMs) {
  const extra = parseNodeExtra(node);
  const heartbeatState = getHeartbeatCartState(node);
  const heartbeatUpdatedAt = toMs(extra.cartUpdatedAt) || toMs(node.last_heartbeat);
  const heartbeatFresh = heartbeatUpdatedAt ? nowMs - heartbeatUpdatedAt <= ACTIVE_CART_STALE_MS : false;
  const heartbeatSlot = node.current_slot || extractSlotFromText(node.cart_items) || null;
  const heartbeatTicketCount = extractTicketCountFromText(node.cart_items);

  const orderedEvents = (logEvents.length > 0 ? logEvents : dbEvents).sort((left, right) => left.atMs - right.atMs);
  const signalTypes = unique(orderedEvents
    .filter((event) => ISSUE_SIGNAL_TYPES.has(event.type) && (!event.atMs || nowMs - event.atMs <= ISSUE_SIGNAL_VISIBLE_MS))
    .map((event) => event.type));
  const activeLogEvents = orderedEvents.filter((event) => ['cart_added', 'cart_alive', 'hold_started', 'checkout_started', 'cart_modified', 'checkout_ready'].includes(event.type));
  const lastActiveLogEvent = activeLogEvents.length > 0 ? activeLogEvents[activeLogEvents.length - 1] : null;
  const activeTicketEvent = [...activeLogEvents].reverse().find((event) => Number(event.ticketCount || 0) > 0) || null;
  const paymentTicketEvent = [...activeLogEvents]
    .reverse()
    .find((event) => ['cart_modified', 'checkout_ready'].includes(event.type) && Number(event.ticketCount || 0) > 0) || null;
  const lastCheckoutEvent = orderedEvents.filter((event) => event.type === 'checkout_started').slice(-1)[0] || null;
  const lastReleaseEvent = orderedEvents.filter((event) => event.type === 'cart_released').slice(-1)[0] || null;
  const lastSlotEvent = orderedEvents.filter((event) => event.slot).slice(-1)[0] || null;
  const postActiveEvents = lastActiveLogEvent
    ? orderedEvents.filter((event) => event.atMs > lastActiveLogEvent.atMs)
    : [];
  const searchResetCount = postActiveEvents.filter((event) => event.type === 'search_empty' || event.type === 'search_cycle_started').length;
  const logFresh = Boolean(snapshot?.updatedAt && nowMs - (toMs(snapshot.updatedAt) || 0) <= LOG_FRESHNESS_MS);

  let cartState = 'idle';
  let source = 'heartbeat';
  let confidence = 'medium';
  let evidenceAt = toIso(heartbeatUpdatedAt) || toIso(snapshot?.updatedAt) || new Date(nowMs).toISOString();
  let mismatchFlags = [];
  let ticketCount = heartbeatTicketCount;
  let cartAdults = null;
  let cartChildren = null;
  let guideCount = null;
  let slot = heartbeatSlot || (lastSlotEvent ? lastSlotEvent.slot : null);
  let slotState = slot ? 'candidate' : 'idle';

  const logDerivedState = (() => {
    if (!lastActiveLogEvent) return null;
    if (lastReleaseEvent && lastReleaseEvent.atMs > lastActiveLogEvent.atMs) return null;
    if (searchResetCount >= 2) return null;
    if (nowMs - lastActiveLogEvent.atMs > ACTIVE_CART_STALE_MS) return null;
    return CART_STATE_BY_EVENT[lastActiveLogEvent.type] || 'hold';
  })();

  if (logDerivedState) {
    cartState = logDerivedState;
    source = heartbeatFresh ? 'hybrid' : 'logs';
    confidence = heartbeatFresh && heartbeatState === logDerivedState ? 'high' : 'medium';
    evidenceAt = lastActiveLogEvent.at;
    if (paymentTicketEvent && nowMs - paymentTicketEvent.atMs <= ACTIVE_CART_STALE_MS) {
      ticketCount = Number(paymentTicketEvent.ticketCount || 0) || 0;
      cartAdults = Number(paymentTicketEvent.adults || 0) || null;
      cartChildren = Number(paymentTicketEvent.children || 0) || 0;
      guideCount = Number.isFinite(Number(paymentTicketEvent.guide)) ? Math.max(0, Number(paymentTicketEvent.guide)) : 1;
    } else if (activeTicketEvent) {
      ticketCount = Math.max(Number(activeTicketEvent.ticketCount || 0) || 0, heartbeatTicketCount);
      cartAdults = Number(activeTicketEvent.adults || 0) || null;
      cartChildren = Number(activeTicketEvent.children || 0) || 0;
      guideCount = Number.isFinite(Number(activeTicketEvent.guide)) ? Math.max(0, Number(activeTicketEvent.guide)) : 1;
    } else {
      ticketCount = heartbeatTicketCount;
    }
    slot = lastActiveLogEvent.slot || slot;
    slotState = cartState === 'checkout' ? 'checkout' : 'held';

    if (heartbeatFresh && heartbeatState && heartbeatState !== logDerivedState) {
      mismatchFlags.push('heartbeat_state_conflicts_with_logs');
    }
  } else if (lastReleaseEvent && nowMs - lastReleaseEvent.atMs <= RELEASE_VISIBLE_MS) {
    cartState = 'released';
    source = 'logs';
    confidence = 'medium';
    evidenceAt = lastReleaseEvent.at;
    ticketCount = 0;
    slotState = 'released';

    if (heartbeatFresh && ACTIVE_CART_STATES.has(heartbeatState)) {
      mismatchFlags.push('heartbeat_active_after_release');
    }
  } else if (logFresh) {
    cartState = 'idle';
    source = 'logs';
    confidence = 'high';
    ticketCount = 0;
    slot = lastSlotEvent?.slot || heartbeatSlot || slot;
    slotState = slot ? 'candidate' : 'idle';

    if (heartbeatFresh && ACTIVE_CART_STATES.has(heartbeatState)) {
      mismatchFlags.push('logs_do_not_confirm_active_cart');
    }
  } else if (ACTIVE_CART_STATES.has(heartbeatState) && heartbeatFresh) {
    cartState = heartbeatState;
    source = 'heartbeat';
    confidence = 'low';
    evidenceAt = toIso(heartbeatUpdatedAt) || evidenceAt;
    ticketCount = heartbeatTicketCount;
    slot = heartbeatSlot || slot;
    slotState = cartState === 'checkout' ? 'checkout' : 'held';
    mismatchFlags.push('heartbeat_only_active_cart');

    if (searchResetCount >= 1 || signalTypes.includes('browser_launch_failed')) {
      mismatchFlags.push('logs_do_not_confirm_active_cart');
    }
  } else {
    cartState = 'idle';
    source = logFresh ? 'logs' : 'heartbeat';
    confidence = logFresh ? 'high' : 'medium';
    ticketCount = 0;
    slotState = slot ? 'candidate' : 'idle';

    if (ACTIVE_CART_STATES.has(heartbeatState) && !heartbeatFresh) {
      mismatchFlags.push('heartbeat_cart_stale');
    }
  }

  if (cartState === 'idle' && slot && logFresh) {
    mismatchFlags.push('slot_without_confirmed_cart');
  }

  if (lastCheckoutEvent && cartState !== 'checkout' && nowMs - lastCheckoutEvent.atMs <= ACTIVE_CART_STALE_MS) {
    mismatchFlags.push('checkout_not_confirmed');
  }

  return {
    cartState,
    ticketCount,
    cartAdults,
    cartChildren,
    guideCount,
    slot,
    slotState,
    confidence,
    source,
    evidenceAt,
    mismatchFlags: unique(mismatchFlags),
    heartbeatState,
    heartbeatFresh,
    logFresh,
    signalTypes,
    lastEvidence: lastActiveLogEvent?.raw || lastReleaseEvent?.raw || node.last_error || null
  };
}

function getNodeDerivedState(node, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const snapshot = options.logSnapshot || null;
  const logEvents = parseLogEvents(snapshot);
  const dbEvents = parseEventRows(options.recentEvents || []);
  const runtime = compareRuntime(node);
  const derived = deriveFromSignals(node, logEvents, dbEvents, snapshot, nowMs);

  return {
    ...derived,
    runtimeConfirmed: runtime.runtimeConfirmed,
    expectedVersion: runtime.expectedVersion,
    expectedMode: runtime.expectedMode,
    expectedWindow: runtime.expectedWindow,
    runtimeVersion: runtime.runtimeVersion,
    runtimeMode: runtime.runtimeMode,
    runtimeWindow: runtime.runtimeWindow,
    mismatchFlags: unique([
      ...(derived.mismatchFlags || []),
      ...(runtime.runtimeConfirmed ? [] : runtime.mismatchFlags)
    ])
  };
}

function groupEventsByNode(events) {
  return (events || []).reduce((acc, event) => {
    const nodeId = Number(event.node_id || 0);
    if (!nodeId) return acc;
    if (!acc[nodeId]) acc[nodeId] = [];
    acc[nodeId].push(event);
    return acc;
  }, {});
}

function buildActiveSlotRegistry(nodes) {
  return (nodes || []).reduce((registry, node) => {
    const slot = node?.derivedState?.slot || node?.current_slot || null;
    if (!slot) return registry;
    if (!ACTIVE_CART_STATES.has(node?.derivedState?.cartState)) return registry;
    registry[node.id] = {
      slot,
      updated: node?.derivedState?.evidenceAt || node?.last_heartbeat || null
    };
    return registry;
  }, {});
}

function buildOverviewSummary(nodes) {
  const summary = {
    paymentCount: 0,
    holdCount: 0,
    checkoutCount: 0,
    activeSlotCount: 0,
    mismatchCount: 0
  };

  (nodes || []).forEach((node) => {
    const derived = node.derivedState || {};
    if (ACTIVE_CART_STATES.has(derived.cartState)) summary.paymentCount += 1;
    if (derived.cartState === 'hold') summary.holdCount += 1;
    if (derived.cartState === 'checkout') summary.checkoutCount += 1;
    if (ACTIVE_CART_STATES.has(derived.cartState) && derived.slot) summary.activeSlotCount += 1;
    if ((derived.mismatchFlags || []).length > 0) summary.mismatchCount += 1;
  });

  return summary;
}

function createNodeStateReconciler({ db, telemetry }) {
  function attachDerivedState(nodes) {
    const recentEvents = db.getEvents({ limit: 600 });
    const groupedEvents = groupEventsByNode(recentEvents);

    return (nodes || []).map((node) => ({
      ...node,
      derivedState: getNodeDerivedState(node, {
        logSnapshot: telemetry.getSnapshot(node.id),
        recentEvents: groupedEvents[node.id] || []
      })
    }));
  }

  return {
    ACTIVE_CART_STATES,
    attachDerivedState,
    buildActiveSlotRegistry,
    buildOverviewSummary,
    getNodeDerivedState,
    parseLogEvents
  };
}

module.exports = {
  ACTIVE_CART_STATES,
  buildActiveSlotRegistry,
  buildOverviewSummary,
  createNodeStateReconciler,
  getNodeDerivedState
};
