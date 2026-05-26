import { useEffect, useMemo, useState } from 'react';
import { Eraser, RefreshCw, Rocket, RotateCw, Save, ShoppingCart, Ticket, UploadCloud } from 'lucide-react';
import { ApiError, api, apiWithRetry } from '@/lib/api';
import {
  cloneJson,
  formatEventType,
  formatJobStatus,
  formatMode,
  formatTimestamp,
  localizeAlertMessage,
  maskSecret,
  sanitizeDataForDisplay,
  summarizeText
} from '@/lib/format';
import type {
  CommandKind,
  ConfigApplyResult,
  EventRecord,
  JobRecord,
  NodeRecord,
  ProxyDistributionPreview,
  ProxyLeaseStatus,
  ProxyNodeOverview,
  WorkstationPayload
} from '@/types';

interface ControlStudioViewProps {
  connected: boolean;
  nodes: NodeRecord[];
  jobs: JobRecord[];
  onCommand: (command: CommandKind, nodeIds: number[], options?: { force?: boolean }) => Promise<void>;
  defaultSection?: StudioSection;
  focusedEditing?: boolean;
}

type StudioSection = 'config' | 'proxies' | 'editing';
type ControlScope = 'global' | 'single' | 'range';
type TicketSearchMode = 'dynamic' | 'concrete';

const MIN_GROUP_NON_GUIDE = 8;
const MAX_GROUP_NON_GUIDE = 24;
const MAX_INDIVIDUAL_TICKETS = 24;
const ADULT_TICKET_LABEL = 'Intero';
const CHILD_TICKET_LABEL = 'Gratuito - Under 18';
const GUIDE_TICKET_LABEL = 'Guide turistiche con tesserino';

const TARGET_MODE_OPTIONS = [
  { value: 'group', label: 'Group' },
  { value: 'individual', label: 'Individual 24h' },
  { value: 'underground', label: 'Underground' }
];

function buildLineDiff(originalText: string, draftText: string) {
  const left = originalText.split('\n');
  const right = draftText.split('\n');
  const rows: Array<{ kind: 'same' | 'remove' | 'add'; value: string }> = [];
  const max = Math.max(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    const originalLine = left[index];
    const draftLine = right[index];

    if (originalLine === draftLine) {
      if (originalLine !== undefined) rows.push({ kind: 'same', value: originalLine });
      continue;
    }

    if (originalLine !== undefined) rows.push({ kind: 'remove', value: originalLine });
    if (draftLine !== undefined) rows.push({ kind: 'add', value: draftLine });
  }

  return rows.slice(0, 220);
}

function buildDisplaySnapshot(config: Record<string, any> | null) {
  return sanitizeDataForDisplay(config || {}, {
    collapseProxySets: true,
    maxArrayItems: 8
  });
}

function cleanupScheduleFields(target: Record<string, any>) {
  delete target.target_date;
  delete target.target_date_start;
  delete target.target_date_end;
  delete target.target_datetime_start;
  delete target.target_datetime_end;
  delete target.time_range;
  delete target.rolling_days_ahead;
  delete target.rolling_days_count;
  return target;
}

function pruneOverride(override: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(override || {}).filter(([, value]) => {
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    })
  );
}

function getTargetByMode(config: Record<string, any>, mode: string) {
  const targets = Array.isArray(config?.targets) ? config.targets : [];
  return (
    targets.find((target: Record<string, any>) => target.type === mode) ||
    targets.find((target: Record<string, any>) => target.type === 'group') ||
    targets[0] ||
    null
  );
}

function getWindowValues(entry: Record<string, any> | null | undefined) {
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
    start: startDate && startTime ? `${startDate}T${startTime}` : '',
    end: endDate && endTime ? `${endDate}T${endTime}` : ''
  };
}

function formatTicketsSummary(tickets: Array<Record<string, any>> | null | undefined) {
  if (!Array.isArray(tickets) || tickets.length === 0) return 'билеты не заданы';
  return tickets
    .map((ticket) => `${ticket.quantity || 0}× ${ticket.label || 'без названия'}`)
    .join(', ');
}

function normalizeTicketLabel(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isGuideTicketLabel(label: unknown) {
  const value = normalizeTicketLabel(label);
  return /guide turistiche con tesserino|accompagnatore|visita guidata/.test(value);
}

function isChildTicketLabel(label: unknown) {
  const value = normalizeTicketLabel(label);
  return /under\s*18|under18|u18|child|children|kid|ragazz|bambin|minorenni|minori/.test(value);
}

function getTicketQuantity(ticket: Record<string, any>) {
  const quantity = Number(ticket?.quantity || 0);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
}

function getTicketComposition(tickets: Array<Record<string, any>> | null | undefined) {
  const rows = Array.isArray(tickets) ? tickets : [];
  return rows.reduce(
    (acc, ticket) => {
      const quantity = getTicketQuantity(ticket);
      if (isGuideTicketLabel(ticket.label)) acc.guide += quantity;
      else if (isChildTicketLabel(ticket.label)) acc.children += quantity;
      else acc.adults += quantity;
      return acc;
    },
    { adults: 0, children: 0, guide: 0 }
  );
}

function getTicketSearchMode(entry: Record<string, any> | null | undefined): TicketSearchMode {
  return String(entry?.ticketSearchMode || entry?.ticket_search_mode || '').toLowerCase() === 'concrete'
    ? 'concrete'
    : 'dynamic';
}

function buildDynamicTickets() {
  return [
    { label: ADULT_TICKET_LABEL, quantity: MAX_GROUP_NON_GUIDE },
    { label: GUIDE_TICKET_LABEL, quantity: 1 }
  ];
}

function parseWholeNumber(value: string) {
  const trimmed = String(value || '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function buildConcreteTicketPlan(adultsText: string, childrenText: string) {
  const adults = parseWholeNumber(adultsText);
  const childrenInput = parseWholeNumber(childrenText);
  if (adults === null || childrenInput === null) {
    return { error: 'Adults and children must be whole numbers.', tickets: [], adults: 0, children: 0, nonGuide: 0, summary: '' };
  }

  const requestedNonGuide = adults + childrenInput;
  if (requestedNonGuide > MAX_GROUP_NON_GUIDE) {
    return { error: `Maximum is ${MAX_GROUP_NON_GUIDE} tickets before guide.`, tickets: [], adults, children: childrenInput, nonGuide: requestedNonGuide, summary: '' };
  }

  const filledChildren = childrenInput + Math.max(0, MIN_GROUP_NON_GUIDE - requestedNonGuide);
  const nonGuide = adults + filledChildren;
  const tickets = [
    ...(adults > 0 ? [{ label: ADULT_TICKET_LABEL, quantity: adults }] : []),
    ...(filledChildren > 0 ? [{ label: CHILD_TICKET_LABEL, quantity: filledChildren }] : []),
    { label: GUIDE_TICKET_LABEL, quantity: 1 }
  ];
  const fillerText = filledChildren > childrenInput ? `, auto-fill children +${filledChildren - childrenInput}` : '';

  return {
    error: null,
    tickets,
    adults,
    children: filledChildren,
    nonGuide,
    summary: `${adults}x Intero + ${filledChildren}x Under18 + 1x Guide (${nonGuide + 1} total${fillerText})`
  };
}

function buildIndividualTicketPlan(quantityText: string) {
  const quantity = parseWholeNumber(quantityText);
  if (quantity === null || quantity < 1) {
    return { error: 'Individual mode requires at least 1 Intero ticket.', tickets: [], adults: 0, children: 0, nonGuide: 0, summary: '' };
  }
  if (quantity > MAX_INDIVIDUAL_TICKETS) {
    return { error: `Maximum is ${MAX_INDIVIDUAL_TICKETS} individual tickets.`, tickets: [], adults: quantity, children: 0, nonGuide: quantity, summary: '' };
  }
  return {
    error: null,
    tickets: [{ label: ADULT_TICKET_LABEL, quantity }],
    adults: quantity,
    children: 0,
    nonGuide: quantity,
    summary: `${quantity}x Intero`
  };
}

function formatMsCompact(value?: number | null) {
  const ms = Number(value || 0);
  if (!ms) return 'n/a';
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function formatEpochMs(value?: number | null) {
  const ms = Number(value || 0);
  if (!ms) return 'n/a';
  return new Date(ms).toLocaleTimeString();
}

function compactHost(value?: string | null) {
  const text = String(value || '');
  if (text.length <= 22) return text || 'n/a';
  return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

function parseNodeRangeInput(value: string, nodes: NodeRecord[]) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { nodeIds: [] as number[], error: 'Укажи диапазон узлов, например 7-12 или 3,5,9.' };
  }

  const allowedNodeIds = new Set(nodes.map((node) => node.id));
  const selectedIds = new Set<number>();

  for (const chunk of trimmed.split(',')) {
    const part = chunk.trim();
    if (!part) continue;

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) {
        return { nodeIds: [] as number[], error: `Некорректный диапазон: ${part}` };
      }

      for (let nodeId = start; nodeId <= end; nodeId += 1) {
        if (allowedNodeIds.has(nodeId)) selectedIds.add(nodeId);
      }
      continue;
    }

    const nodeId = Number(part);
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      return { nodeIds: [] as number[], error: `Некорректный узел: ${part}` };
    }
    if (allowedNodeIds.has(nodeId)) selectedIds.add(nodeId);
  }

  const nodeIds = Array.from(selectedIds).sort((left, right) => left - right);
  if (nodeIds.length === 0) {
    return { nodeIds, error: 'По диапазону не найдено ни одного узла.' };
  }

  return { nodeIds, error: null };
}

function formatScopeLabel(scope: ControlScope, nodeIds: number[], nodeId: number) {
  if (scope === 'single') return `узел ${nodeId}`;
  if (scope === 'range') return nodeIds.length ? `${nodeIds.length} узлов` : 'диапазон пуст';
  return 'весь флот';
}

function buildApplySummary(response: ConfigApplyResult, actionLabel: string) {
  const applied = response.appliedNodeIds.length;
  const runtimeConfirmed = response.runtimeConfirmedNodeIds?.length || 0;
  const mismatches = response.mismatchNodeIds?.length || 0;
  const expectedWindow = response.expectedWindow ? `, окно ${response.expectedWindow}` : '';
  const expectedMode = response.expectedMode ? `, режим ${formatMode(response.expectedMode)}` : '';

  return `${actionLabel}: версия ${response.version}, log+runtime подтверждены у ${applied}, runtime сошелся у ${runtimeConfirmed}, не сошлось у ${mismatches}${expectedMode}${expectedWindow}.`;
}

function formatNodeIdList(nodeIds: number[]) {
  if (!nodeIds.length) return 'нет';
  return nodeIds.map((nodeId) => `NODE_${String(nodeId).padStart(2, '0')}`).join(', ');
}

function describeStudioError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const blockedNodeIds = Array.isArray(error.payload?.blockedNodeIds)
      ? error.payload.blockedNodeIds
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isInteger(value) && value > 0)
      : [];

    if (blockedNodeIds.length > 0) {
      return `${error.message} Заблокированы: ${formatNodeIdList(blockedNodeIds)}.`;
    }

    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function ControlStudioView({
  connected,
  nodes,
  jobs,
  onCommand,
  defaultSection = 'editing',
  focusedEditing = false
}: ControlStudioViewProps) {
  const [section, setSection] = useState<StudioSection>(defaultSection);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forceRiskyOperations, setForceRiskyOperations] = useState(false);

  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [baseConfig, setBaseConfig] = useState<Record<string, any> | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [proxyOverview, setProxyOverview] = useState<Record<string, ProxyNodeOverview>>({});
  const [proxyPreview, setProxyPreview] = useState<ProxyDistributionPreview | null>(null);
  const [proxyLeaseStatus, setProxyLeaseStatus] = useState<ProxyLeaseStatus | null>(null);
  const [probe, setProbe] = useState<WorkstationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [clearQuickBusy, setClearQuickBusy] = useState(false);
  const [resetTicketsBusy, setResetTicketsBusy] = useState(false);
  const [resetCartBusy, setResetCartBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastApplyResponse, setLastApplyResponse] = useState<ConfigApplyResult | null>(null);

  const [appMode, setAppMode] = useState('group');
  const [holdMode, setHoldMode] = useState(true);
  const [masterIp, setMasterIp] = useState('');
  const [registryPath, setRegistryPath] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState('16');
  const [targetsText, setTargetsText] = useState('[]');
  const [participantsText, setParticipantsText] = useState('[]');
  const [guideText, setGuideText] = useState('{}');
  const [nodeOverridesText, setNodeOverridesText] = useState('{}');
  const [scope, setScope] = useState<ControlScope>('global');
  const [scopeNodeId, setScopeNodeId] = useState<number>(12);
  const [scopeRangeText, setScopeRangeText] = useState('1-31');
  const [restartChanged, setRestartChanged] = useState(true);
  const [quickMode, setQuickMode] = useState('group');
  const [quickStart, setQuickStart] = useState('');
  const [quickEnd, setQuickEnd] = useState('');
  const [quickTicketSearchMode, setQuickTicketSearchMode] = useState<TicketSearchMode>('dynamic');
  const [quickAdults, setQuickAdults] = useState(String(MAX_GROUP_NON_GUIDE));
  const [quickChildren, setQuickChildren] = useState('0');

  useEffect(() => {
    if (quickMode !== 'individual') return;
    setQuickChildren('0');
    const quantity = parseWholeNumber(quickAdults);
    if (quickTicketSearchMode === 'concrete' && (quantity === null || quantity < 1)) setQuickAdults('1');
    if (quickTicketSearchMode === 'dynamic' && quickAdults !== String(MAX_INDIVIDUAL_TICKETS)) setQuickAdults(String(MAX_INDIVIDUAL_TICKETS));
  }, [quickMode, quickAdults, quickTicketSearchMode]);

  const hydrateDraft = (nextConfig: Record<string, any>) => {
    setAppMode(nextConfig.application?.mode || 'group');
    setHoldMode(Boolean(nextConfig.application?.holdMode));
    setMasterIp(nextConfig.coordination?.masterIp || '');
    setRegistryPath(nextConfig.coordination?.registryPath || '');
    setTtlMinutes(String(nextConfig.coordination?.ttlMinutes || 16));
    setTargetsText(JSON.stringify(nextConfig.targets || [], null, 2));
    setParticipantsText(JSON.stringify(nextConfig.participants || [], null, 2));
    setGuideText(JSON.stringify(nextConfig.guide || {}, null, 2));
    setNodeOverridesText(JSON.stringify(nextConfig.nodeOverrides || {}, null, 2));
  };

  const loadStudio = async () => {
    setLoading(true);
    setStudioError(null);
    try {
      const [nextConfig, nextEvents, nextProxyOverview, nextProxyPreview, nextProxyLeaseStatus] = await Promise.all([
        apiWithRetry<Record<string, any>>('/config'),
        apiWithRetry<EventRecord[]>('/events?limit=120'),
        apiWithRetry<Record<string, ProxyNodeOverview>>('/proxies'),
        apiWithRetry<ProxyDistributionPreview>('/proxies/distribution-preview'),
        apiWithRetry<ProxyLeaseStatus>('/proxy-leases/status')
      ]);

      setConfig(nextConfig);
      setBaseConfig(cloneJson(nextConfig));
      hydrateDraft(nextConfig);
      setEvents(nextEvents);
      setProxyOverview(nextProxyOverview);
      setProxyPreview(nextProxyPreview);
      setProxyLeaseStatus(nextProxyLeaseStatus);
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось загрузить управление.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStudio();
  }, [connected]);

  useEffect(() => {
    setSection(defaultSection);
  }, [defaultSection]);

  const rangeSelection = useMemo(
    () => parseNodeRangeInput(scopeRangeText, nodes),
    [nodes, scopeRangeText]
  );
  const scopeNodeIds = useMemo(() => {
    if (scope === 'single') return [scopeNodeId];
    if (scope === 'range') return rangeSelection.nodeIds;
    return nodes.map((node) => node.id);
  }, [nodes, rangeSelection.nodeIds, scope, scopeNodeId]);
  const scopeError = scope === 'range' ? rangeSelection.error : null;
  const scopeLabel = formatScopeLabel(scope, scopeNodeIds, scopeNodeId);
  const probeNodeId = scopeNodeIds[0] || scopeNodeId || nodes[0]?.id || 12;

  useEffect(() => {
    if (!probeNodeId) return;
    apiWithRetry<WorkstationPayload>(`/workstation/${probeNodeId}`)
      .then(setProbe)
      .catch(() => setProbe(null));
  }, [connected, probeNodeId]);

  const buildDraft = () => {
    const next = cloneJson(config || {});
    next.application = {
      ...(next.application || {}),
      mode: appMode,
      holdMode
    };
    next.coordination = {
      ...(next.coordination || {}),
      masterIp,
      registryPath,
      ttlMinutes: Number(ttlMinutes) || 0
    };
    next.targets = JSON.parse(targetsText);
    next.participants = JSON.parse(participantsText);
    next.guide = JSON.parse(guideText);
    next.nodeOverrides = JSON.parse(nodeOverridesText);
    return next;
  };

  let draftConfig: Record<string, any> | null = null;
  let draftError: string | null = null;

  try {
    draftConfig = buildDraft();
  } catch (error: any) {
    draftError = error.message || 'Черновик конфига невалиден.';
  }

  useEffect(() => {
    if (!config) return;

    const applyTicketDraft = (entry: Record<string, any> | null | undefined, mode: string) => {
      const ticketMode = getTicketSearchMode(entry);
      const composition = getTicketComposition(Array.isArray(entry?.tickets) ? entry?.tickets : []);
      setQuickTicketSearchMode(ticketMode);
      const dynamicDefault = mode === 'individual' ? MAX_INDIVIDUAL_TICKETS : MAX_GROUP_NON_GUIDE;
      const concreteDefault = mode === 'individual' ? 1 : 0;
      setQuickAdults(String(composition.adults || (ticketMode === 'dynamic' ? dynamicDefault : concreteDefault)));
      setQuickChildren(String(composition.children || 0));
    };

    if (scope === 'single') {
      const override = config.nodeOverrides?.[String(probeNodeId)] || {};
      const mode = override.mode || config.application?.mode || 'group';
      const baseTarget = getTargetByMode(config, mode);
      const baseWindow = getWindowValues(baseTarget);
      const overrideWindow = getWindowValues(override);
      const ticketEntry = {
        ...(baseTarget || {}),
        ...(override.tickets ? { tickets: override.tickets } : {}),
        ...(override.ticketSearchMode || override.ticket_search_mode ? { ticketSearchMode: override.ticketSearchMode || override.ticket_search_mode } : {})
      };

      setQuickMode(mode);
      setQuickStart(overrideWindow.start || baseWindow.start || '');
      setQuickEnd(overrideWindow.end || baseWindow.end || '');
      applyTicketDraft(ticketEntry, mode);
      return;
    }

    const mode = config.application?.mode || 'group';
    const target = getTargetByMode(config, mode);
    const window = getWindowValues(target);

    setQuickMode(mode);
    setQuickStart(window.start || '');
    setQuickEnd(window.end || '');
    applyTicketDraft(target, mode);
  }, [config, probeNodeId, scope]);

  const displayBaseConfig = useMemo(() => buildDisplaySnapshot(baseConfig), [baseConfig]);
  const displayDraftConfig = useMemo(
    () => buildDisplaySnapshot(draftConfig || config),
    [draftConfig, config]
  );
  const diffRows = useMemo(
    () =>
      buildLineDiff(
        JSON.stringify(displayBaseConfig, null, 2),
        JSON.stringify(displayDraftConfig, null, 2)
      ),
    [displayBaseConfig, displayDraftConfig]
  );

  const displayProbeDesired = useMemo(
    () => sanitizeDataForDisplay(probe?.desired || {}, { collapseProxySets: true, maxArrayItems: 6 }),
    [probe?.desired]
  );
  const displayProbeRuntime = useMemo(
    () => sanitizeDataForDisplay(probe?.runtime || {}, { collapseProxySets: true, maxArrayItems: 6 }),
    [probe?.runtime]
  );
  const displayProbeOverride = useMemo(
    () => sanitizeDataForDisplay(probe?.override || {}, { collapseProxySets: true, maxArrayItems: 6 }),
    [probe?.override]
  );
  const activeTicketSummary = useMemo(() => {
    const desiredTickets = Array.isArray(probe?.desired?.tickets) ? probe?.desired?.tickets : [];
    return formatTicketsSummary(desiredTickets);
  }, [probe?.desired?.tickets]);
  const overrideTicketSummary = useMemo(() => {
    const overrideTickets = Array.isArray(probe?.override?.tickets) ? probe?.override?.tickets : [];
    return formatTicketsSummary(overrideTickets);
  }, [probe?.override?.tickets]);
  const quickTicketPlan = useMemo(() => {
    if (quickMode === 'individual') {
      if (quickTicketSearchMode === 'dynamic') {
        return {
          error: null,
          tickets: [{ label: ADULT_TICKET_LABEL, quantity: MAX_INDIVIDUAL_TICKETS }],
          summary: `1-${MAX_INDIVIDUAL_TICKETS}x Intero`
        };
      }
      return buildIndividualTicketPlan(quickAdults);
    }
    if (quickTicketSearchMode === 'dynamic') {
      return {
        error: null,
        tickets: buildDynamicTickets(),
        summary: `${MIN_GROUP_NON_GUIDE}-${MAX_GROUP_NON_GUIDE}x Intero + 1x Guide`
      };
    }
    return buildConcreteTicketPlan(quickAdults, quickChildren);
  }, [quickAdults, quickChildren, quickMode, quickTicketSearchMode]);

  const proxyNodeCount = Object.keys(config?.proxies || {}).length;
  const proxyEntries = Object.values(config?.proxies || {}) as unknown[];
  const proxyTotalCount = proxyEntries.reduce((sum: number, entry: unknown) => {
    if (Array.isArray(entry)) return sum + entry.length;
    return sum;
  }, 0);
  const leaseTotals = proxyLeaseStatus?.totals || {};
  const visibleLeaseRows = (proxyLeaseStatus?.proxies || [])
    .filter((proxy) => proxy.leaseOwnerNodeId || proxy.healthStatus !== 'ok' || proxy.lastRuntimeReport || proxy.lastCheckerResult)
    .sort((left, right) => {
      const leftActive = left.leaseOwnerNodeId ? 0 : 1;
      const rightActive = right.leaseOwnerNodeId ? 0 : 1;
      return leftActive - rightActive || Number(right.lastUsedAt || right.lastCheckedAt || 0) - Number(left.lastUsedAt || left.lastCheckedAt || 0);
    })
    .slice(0, 90);
  const staleCheckerCount = (proxyLeaseStatus?.proxies || []).filter((proxy) => {
    const checkedAt = Math.max(Number(proxy.lastNeutralCheckedAt || 0), Number(proxy.lastColosseoCheckedAt || 0));
    return checkedAt > 0 && Date.now() - checkedAt > 5 * 60 * 1000;
  }).length;
  const blockedLikeCount = Number(leaseTotals.waf_pressure || 0)
    + Number(leaseTotals.cart_pressure || 0)
    + Number(leaseTotals.blocked || 0)
    + Number(leaseTotals.connect_fail || 0)
    + Number(leaseTotals.auth_fail || 0);
  const leaseWarnings = [
    ...(proxyLeaseStatus?.duplicateProxyLeaseIds?.length ? [`duplicate lease: ${proxyLeaseStatus.duplicateProxyLeaseIds.join(', ')}`] : []),
    ...(staleCheckerCount > 0 ? [`stale checker rows: ${staleCheckerCount}`] : []),
    ...(Number(leaseTotals.total || 0) > 0 && blockedLikeCount / Number(leaseTotals.total || 1) > 0.35 ? [`high bad rate: ${blockedLikeCount}/${leaseTotals.total}`] : []),
    ...(Number(leaseTotals.free || 0) === 0 && Number(leaseTotals.leased || 0) > 0 ? ['no free proxy lease'] : [])
  ];

  const runScopedCommand = async (command: CommandKind) => {
    setStudioError(null);
    try {
      await onCommand(command, scopeNodeIds, { force: forceRiskyOperations });
      setLastResult(`Команда применена к области: ${scopeLabel}.`);
    } catch (error: any) {
      setStudioError(describeStudioError(error, 'Не удалось поставить команду в очередь.'));
    }
  };

  const saveDraft = async () => {
    if (!draftConfig) {
      setStudioError(draftError || 'Черновик конфига невалиден.');
      return;
    }

    setSaveBusy(true);
    setStudioError(null);
    try {
      const response = await api<{ ok: boolean; config: Record<string, any> }>('/config', {
        method: 'PUT',
        body: draftConfig
      });
      setConfig(response.config);
      setBaseConfig(cloneJson(response.config));
      hydrateDraft(response.config);
      setLastResult(`Черновик сохранён. Версия ${response.config?.configMeta?.version || 'нет'}.`);
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось сохранить конфиг.');
    } finally {
      setSaveBusy(false);
    }
  };

  const applyConfig = async () => {
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }

    setApplyBusy(true);
    setStudioError(null);
    try {
      const response = await api<ConfigApplyResult>('/config/apply', {
        method: 'POST',
        body: {
          scope,
          nodeIds: scope === 'global' ? [] : scopeNodeIds,
          force: forceRiskyOperations
        }
      });
      setLastApplyResponse(response);
      setLastResult(buildApplySummary(response, 'Применение конфига'));
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось применить конфиг.');
    } finally {
      setApplyBusy(false);
    }
  };

  const restartScope = async () => {
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }

    setRestartBusy(true);
    setStudioError(null);
    try {
      await api('/config/restart', {
        method: 'POST',
        body: {
          nodeIds: scopeNodeIds,
          force: forceRiskyOperations
        }
      });
      setLastResult(`Перезапуск поставлен в очередь для ${scopeNodeIds.length} узлов.`);
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось поставить перезапуск в очередь.');
    } finally {
      setRestartBusy(false);
    }
  };

  const saveAndApplyQuickEdit = async () => {
    if (!config) return;
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }
    if (!quickStart || !quickEnd) {
      setStudioError('Укажи точное окно поиска: начало и конец.');
      return;
    }
    if (Date.parse(quickStart) >= Date.parse(quickEnd)) {
      setStudioError('Конец окна должен быть позже начала.');
      return;
    }
    if (scopeNodeIds.length === 0) {
      setStudioError('Не выбраны узлы для редактирования.');
      return;
    }
    if (quickTicketPlan.error) {
      setStudioError(quickTicketPlan.error);
      return;
    }

    setQuickBusy(true);
    setStudioError(null);
    try {
      const nextConfig = cloneJson(config);
      nextConfig.nodeOverrides = nextConfig.nodeOverrides || {};
      const effectiveTicketSearchMode = quickTicketSearchMode;

      if (scope === 'global') {
        nextConfig.application = {
          ...(nextConfig.application || {}),
          mode: quickMode
        };

        const globalTarget = getTargetByMode(nextConfig, quickMode);
        if (globalTarget) {
          cleanupScheduleFields(globalTarget);
          globalTarget.target_datetime_start = quickStart;
          globalTarget.target_datetime_end = quickEnd;
          globalTarget.ticketSearchMode = effectiveTicketSearchMode;
          globalTarget.tickets = quickTicketPlan.tickets;
        }
      }

      scopeNodeIds.forEach((nodeId) => {
        const key = String(nodeId);
        const nextOverride = { ...(nextConfig.nodeOverrides[key] || {}) };
        cleanupScheduleFields(nextOverride);
        nextOverride.mode = quickMode;
        nextOverride.target_datetime_start = quickStart;
        nextOverride.target_datetime_end = quickEnd;
        nextOverride.ticketSearchMode = effectiveTicketSearchMode;
        nextOverride.tickets = quickTicketPlan.tickets;
        nextConfig.nodeOverrides[key] = pruneOverride(nextOverride);
      });

      const saveResponse = await api<{ ok: boolean; config: Record<string, any> }>('/config', {
        method: 'PUT',
        body: nextConfig
      });

      setConfig(saveResponse.config);
      setBaseConfig(cloneJson(saveResponse.config));
      hydrateDraft(saveResponse.config);

      const applyResponse = await api<ConfigApplyResult>('/config/apply', {
        method: 'POST',
        body: {
          scope: scope === 'global' ? 'global' : 'selection',
          nodeIds: scope === 'global' ? [] : scopeNodeIds,
          force: forceRiskyOperations
        }
      });

      setLastApplyResponse(applyResponse);
      setLastResult(buildApplySummary(applyResponse, 'Редактирование сохранено и применено без рестарта'));
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось сохранить и применить редактирование.');
    } finally {
      setQuickBusy(false);
    }
  };

  const clearQuickOverrides = async () => {
    if (!config) return;
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }
    if (scopeNodeIds.length === 0) {
      setStudioError('Не выбраны узлы для сброса.');
      return;
    }

    setClearQuickBusy(true);
    setStudioError(null);
    try {
      const nextConfig = cloneJson(config);
      nextConfig.nodeOverrides = nextConfig.nodeOverrides || {};

      scopeNodeIds.forEach((nodeId) => {
        const key = String(nodeId);
        const nextOverride = { ...(nextConfig.nodeOverrides[key] || {}) };
        cleanupScheduleFields(nextOverride);
        delete nextOverride.mode;
        const pruned = pruneOverride(nextOverride);
        if (Object.keys(pruned).length > 0) {
          nextConfig.nodeOverrides[key] = pruned;
        } else {
          delete nextConfig.nodeOverrides[key];
        }
      });

      const saveResponse = await api<{ ok: boolean; config: Record<string, any> }>('/config', {
        method: 'PUT',
        body: nextConfig
      });

      setConfig(saveResponse.config);
      setBaseConfig(cloneJson(saveResponse.config));
      hydrateDraft(saveResponse.config);

      const applyResponse = await api<ConfigApplyResult>('/config/apply', {
        method: 'POST',
        body: {
          scope: scope === 'global' ? 'global' : 'selection',
          nodeIds: scope === 'global' ? [] : scopeNodeIds,
          force: forceRiskyOperations
        }
      });

      setLastApplyResponse(applyResponse);
      setLastResult(buildApplySummary(applyResponse, 'Переопределения сброшены и hot reload отправлен'));
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось сбросить переопределения.');
    } finally {
      setClearQuickBusy(false);
    }
  };

  const resetScopedTickets = async () => {
    if (!config) return;
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }
    if (scopeNodeIds.length === 0) {
      setStudioError('Не выбраны узлы для сброса билетов.');
      return;
    }

    setResetTicketsBusy(true);
    setStudioError(null);
    try {
      const nextConfig = cloneJson(config);
      nextConfig.nodeOverrides = nextConfig.nodeOverrides || {};

      scopeNodeIds.forEach((nodeId) => {
        const key = String(nodeId);
        const nextOverride = { ...(nextConfig.nodeOverrides[key] || {}) };
        delete nextOverride.tickets;
        delete nextOverride.ticketSearchMode;
        delete nextOverride.ticket_search_mode;
        const pruned = pruneOverride(nextOverride);
        if (Object.keys(pruned).length > 0) {
          nextConfig.nodeOverrides[key] = pruned;
        } else {
          delete nextConfig.nodeOverrides[key];
        }
      });

      const saveResponse = await api<{ ok: boolean; config: Record<string, any> }>('/config', {
        method: 'PUT',
        body: nextConfig
      });

      setConfig(saveResponse.config);
      setBaseConfig(cloneJson(saveResponse.config));
      hydrateDraft(saveResponse.config);

      const applyResponse = await api<ConfigApplyResult>('/config/apply', {
        method: 'POST',
        body: {
          scope: scope === 'global' ? 'global' : 'selection',
          nodeIds: scope === 'global' ? [] : scopeNodeIds,
          force: forceRiskyOperations
        }
      });

      setLastApplyResponse(applyResponse);
      setLastResult(buildApplySummary(applyResponse, 'Билеты сброшены у выбранных узлов'));
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось сбросить tickets у выбранных узлов.');
    } finally {
      setResetTicketsBusy(false);
    }
  };

  const resetScopedCarts = async () => {
    if (scopeError) {
      setStudioError(scopeError);
      return;
    }
    if (scopeNodeIds.length === 0) {
      setStudioError('Не выбраны узлы для сброса корзин.');
      return;
    }

    setResetCartBusy(true);
    setStudioError(null);
    try {
      await onCommand('reset-cart', scopeNodeIds, { force: forceRiskyOperations });
      setLastResult(`Сброс корзин поставлен в очередь для области: ${scopeLabel}.`);
    } catch (error: any) {
      setStudioError(describeStudioError(error, 'Не удалось поставить сброс корзин в очередь.'));
    } finally {
      setResetCartBusy(false);
    }
  };

  const applyProxyDistribution = async () => {
    setProxyBusy(true);
    setStudioError(null);
    try {
      const response = await api<{ changedNodeIds: number[] }>('/proxies/apply', {
        method: 'POST',
        body: { restartChanged, force: forceRiskyOperations }
      });
      setLastResult(`Распределение прокси применено. Изменились ${response.changedNodeIds.length} узлов.`);
      await loadStudio();
    } catch (error: any) {
      setStudioError(error.message || 'Не удалось применить распределение прокси.');
    } finally {
      setProxyBusy(false);
    }
  };

  const configHistory = events.filter((event) => {
    const message = String(event.message || '').toLowerCase();
    return event.type.includes('config') || message.includes('config') || message.includes('proxy');
  });

  const rolloutJobs = jobs.filter((job) => ['deploy', 'restart', 'reset-cart', 'sidecar-sync'].includes(job.kind));

  if (loading && !config) {
    return <div className="panel">Загрузка управления...</div>;
  }

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>{focusedEditing ? 'Редактирование' : 'Управление'}</h2>
            <span className="panel-caption">
              {focusedEditing
                ? 'быстрое изменение режима, билетов и окна поиска с hot reload без перезапуска ботов'
                : 'конфиг, прокси и быстрое редактирование по всем ботам, одному узлу или диапазону'}
            </span>
          </div>

          <div className="toolbar-inline wrap">
            <button type="button" className="ghost-btn" onClick={() => void loadStudio()}>
              <RefreshCw size={16} />
              Обновить
            </button>
            {!focusedEditing ? (
              <>
                <button type="button" className="ghost-btn" disabled={saveBusy} onClick={() => void saveDraft()}>
                  <Save size={16} />
                  {saveBusy ? 'Сохранение...' : 'Сохранить черновик'}
                </button>
                <button type="button" className="ghost-btn accent" disabled={applyBusy} onClick={() => void applyConfig()}>
                  <UploadCloud size={16} />
                  {applyBusy ? 'Применение...' : 'Применить конфиг'}
                </button>
                <button type="button" className="ghost-btn" disabled={restartBusy} onClick={() => void restartScope()}>
                  <RotateCw size={16} />
                  {restartBusy ? 'Постановка...' : 'Перезапустить узлы'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="meta-strip wrap">
          <button type="button" className={section === 'config' ? 'mini-btn accent' : 'mini-btn'} onClick={() => setSection('config')}>
            Конфиг
          </button>
          <button type="button" className={section === 'proxies' ? 'mini-btn accent' : 'mini-btn'} onClick={() => setSection('proxies')}>
            Прокси
          </button>
          <button type="button" className={section === 'editing' ? 'mini-btn accent' : 'mini-btn'} onClick={() => setSection('editing')}>
            Редактирование
          </button>
          {scopeError ? <span className="chip tone-danger">{scopeError}</span> : null}
          {lastResult ? <span className="chip tone-success">{lastResult}</span> : null}
          {draftError ? <span className="chip tone-danger">{draftError}</span> : null}
        </div>

        <details className="meta-details">
          <summary>Служебные параметры</summary>
          <div className="meta-strip wrap">
            <span className="chip tone-muted">версия: {config?.configMeta?.version || 'нет'}</span>
            <span className="chip tone-muted">обновлено: {formatTimestamp(config?.configMeta?.updatedAt)}</span>
            <span className="chip tone-muted">область: {scopeLabel}</span>
            <span className="chip tone-muted">секреты скрыты в предпросмотре</span>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={forceRiskyOperations}
                onChange={(event) => setForceRiskyOperations(event.target.checked)}
              />
              Разрешить рискованные массовые действия поверх guardrail
            </label>
          </div>
        </details>

        {studioError ? <div className="panel panel-danger">{studioError}</div> : null}
      </section>

      {lastApplyResponse ? (
        <section className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Сходимость hot reload</h3>
              <span className="panel-caption">что ожидали и как реально сошелся runtime по последнему применению</span>
            </div>
          </div>

          <div className="kpi-grid compact-kpi-grid">
            <article className="kpi-card">
              <span className="kpi-label">Подтверждено</span>
              <strong className="kpi-value">{lastApplyResponse.appliedNodeIds.length}</strong>
              <span className="kpi-sub">лог reload и runtime сошлись полностью</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">Runtime сошелся</span>
              <strong className="kpi-value">{lastApplyResponse.runtimeConfirmedNodeIds?.length || 0}</strong>
              <span className="kpi-sub">heartbeat/runtime приняли нужную версию</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">Не сошлось</span>
              <strong className="kpi-value">{lastApplyResponse.mismatchNodeIds?.length || 0}</strong>
              <span className="kpi-sub">нужна проверка логов и runtime</span>
            </article>
          </div>

          <div className="list-stack">
            {(lastApplyResponse.results || []).slice(0, 20).map((result: any) => (
              <div key={result.nodeId} className="list-row">
                <span className="list-row-key">узел {result.nodeId}</span>
                <span className="list-row-main">
                  {result.status}
                  {result.expected?.mode ? ` • ${formatMode(result.expected.mode)}` : ''}
                  {result.expected?.window ? ` • ${result.expected.window}` : ''}
                </span>
                <span className="list-row-aside">
                  {result.runtime?.runtime?.version || result.runtime?.version || result.confirm?.matchedLine || 'нет подтверждения'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {section === 'config' ? (
        <section className="studio-grid">
          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Типизированный конфиг</h3>
                <span className="panel-caption">основные поля и область применения без обязательного JSON-редактирования</span>
              </div>
              <button type="button" className="ghost-btn" onClick={() => setShowAdvanced((current) => !current)}>
                {showAdvanced ? 'Скрыть расширенный режим' : 'Показать расширенный режим'}
              </button>
            </div>

            <div className="kpi-grid compact-kpi-grid studio-kpi-grid">
              <article className="kpi-card">
                <span className="kpi-label">Режим</span>
                <strong className="kpi-value kpi-value-small">{formatMode(appMode)}</strong>
                <span className="kpi-sub">текущий черновик приложения</span>
              </article>
              <article className="kpi-card">
                <span className="kpi-label">Охват</span>
                <strong className="kpi-value kpi-value-small">{scopeLabel}</strong>
                <span className="kpi-sub">куда пойдёт применение и hot reload</span>
              </article>
              <article className="kpi-card">
                <span className="kpi-label">Прокси скрыты</span>
                <strong className="kpi-value kpi-value-small">{proxyNodeCount} узл.</strong>
                <span className="kpi-sub">{String(proxyTotalCount)} записей во вкладке «Прокси»</span>
              </article>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Режим приложения</span>
                <select className="select-input" value={appMode} onChange={(event) => setAppMode(event.target.value)}>
                  {TARGET_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Режим удержания</span>
                <select className="select-input" value={holdMode ? 'on' : 'off'} onChange={(event) => setHoldMode(event.target.value === 'on')}>
                  <option value="on">Вкл.</option>
                  <option value="off">Выкл.</option>
                </select>
              </label>
              <label className="field">
                <span>IP координатора</span>
                <input className="text-input" value={masterIp} onChange={(event) => setMasterIp(event.target.value)} />
              </label>
              <label className="field">
                <span>Путь реестра</span>
                <input className="text-input" value={registryPath} onChange={(event) => setRegistryPath(event.target.value)} />
              </label>
              <label className="field">
                <span>TTL, минут</span>
                <input className="text-input" value={ttlMinutes} onChange={(event) => setTtlMinutes(event.target.value)} />
              </label>
              <label className="field">
                <span>Область применения</span>
                <select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as ControlScope)}>
                  <option value="global">Весь флот</option>
                  <option value="single">Один узел</option>
                  <option value="range">Диапазон</option>
                </select>
              </label>

              {scope === 'single' ? (
                <label className="field">
                  <span>Целевой узел</span>
                  <select className="select-input" value={scopeNodeId} onChange={(event) => setScopeNodeId(Number(event.target.value))}>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.id} / {node.ip}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {scope === 'range' ? (
                <label className="field">
                  <span>Диапазон узлов</span>
                  <input
                    className="text-input"
                    value={scopeRangeText}
                    onChange={(event) => setScopeRangeText(event.target.value)}
                    placeholder="1-5,7,10-12"
                  />
                </label>
              ) : null}
            </div>

            {showAdvanced ? (
              <div className="editor-stack">
                <label className="field">
                  <span>Цели</span>
                  <textarea className="json-input" value={targetsText} onChange={(event) => setTargetsText(event.target.value)} />
                </label>
                <label className="field">
                  <span>Участники</span>
                  <textarea className="json-input" value={participantsText} onChange={(event) => setParticipantsText(event.target.value)} />
                </label>
                <label className="field">
                  <span>Гид</span>
                  <textarea className="json-input" value={guideText} onChange={(event) => setGuideText(event.target.value)} />
                </label>
                <label className="field">
                  <span>Переопределения узлов</span>
                  <textarea className="json-input" value={nodeOverridesText} onChange={(event) => setNodeOverridesText(event.target.value)} />
                </label>
              </div>
            ) : (
              <div className="empty-state compact">
                Сырые JSON-блоки скрыты. Для повседневной работы используй вкладку «Редактирование», а расширенный режим включай только для редких правок.
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Предпросмотр изменений</h3>
                <span className="panel-caption">короткий diff без proxy-пула и чувствительных значений</span>
              </div>
            </div>

            <div className="meta-strip wrap">
              <span className="chip tone-muted">прокси вынесены во вкладку «Прокси»</span>
              <span className="chip tone-muted">секретные значения замаскированы</span>
            </div>

            <div className="diff-block">
              {diffRows.map((row, index) => (
                <div key={`${row.kind}-${index}`} className={`diff-line ${row.kind}`}>
                  <span className="diff-marker">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '}</span>
                  <code>{row.value}</code>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Проба узла</h3>
                <span className="panel-caption">снимок ожидаемого, живого и override для выбранного узла</span>
              </div>
            </div>

            <div className="meta-strip wrap">
              <span className="chip tone-muted">узел пробы: {probeNodeId}</span>
              <span className="chip tone-muted">область: {scopeLabel}</span>
            </div>

            <div className="triple-json">
              <div>
                <span className="section-label">ожидаемое</span>
                <pre className="json-block">{JSON.stringify(displayProbeDesired, null, 2)}</pre>
              </div>
              <div>
                <span className="section-label">живое</span>
                <pre className="json-block">{JSON.stringify(displayProbeRuntime, null, 2)}</pre>
              </div>
              <div>
                <span className="section-label">переопределение</span>
                <pre className="json-block">{JSON.stringify(displayProbeOverride, null, 2)}</pre>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {section === 'proxies' ? (
        <section className="studio-grid">
          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Proxy Lease Live</h3>
                <span className="panel-caption">shared pool, runtime reports, checker results, no secrets</span>
              </div>
            </div>

            <div className="kpi-grid compact-kpi-grid studio-kpi-grid">
              {[
                ['total', leaseTotals.total],
                ['free', leaseTotals.free],
                ['eligible', leaseTotals.eligible],
                ['verified', leaseTotals.verified_colosseo],
                ['leased', leaseTotals.leased],
                ['ok', leaseTotals.ok],
                ['waf', leaseTotals.waf_pressure],
                ['cart', leaseTotals.cart_pressure],
                ['blocked', leaseTotals.blocked],
                ['connect', leaseTotals.connect_fail],
                ['auth', leaseTotals.auth_fail]
              ].map(([label, value]) => (
                <article key={label} className="kpi-card">
                  <span className="kpi-label">{label}</span>
                  <strong className="kpi-value kpi-value-small">{Number(value || 0)}</strong>
                </article>
              ))}
            </div>

            <div className="meta-strip wrap">
              <span className="chip tone-muted">mode: {proxyLeaseStatus?.mode || 'n/a'}</span>
              <span className="chip tone-muted">source: {compactHost(proxyLeaseStatus?.source)}</span>
              <span className="chip tone-muted">active nodes: {(proxyLeaseStatus?.activeNodeIds || []).join(', ') || 'n/a'}</span>
              {leaseWarnings.length === 0 ? <span className="chip tone-success">lease health clean</span> : null}
              {leaseWarnings.map((message) => (
                <span key={message} className="chip tone-warning">{message}</span>
              ))}
            </div>

            <div className="simple-table">
              <div className="simple-table-row header">
                <span>proxy</span>
                <span>owner</span>
                <span>ttl</span>
                <span>health</span>
                <span>runtime</span>
                <span>checker</span>
              </div>
              {visibleLeaseRows.map((proxy) => (
                <div key={proxy.proxyId} className="simple-table-row">
                  <span>#{proxy.index} {compactHost(proxy.host)}:{proxy.port}</span>
                  <span>{proxy.leaseOwnerNodeId ? `NODE_${String(proxy.leaseOwnerNodeId).padStart(2, '0')}` : 'free'}</span>
                  <span>{formatMsCompact(proxy.leaseTtlRemainingMs)}</span>
                  <span>{proxy.healthStatus} / score {proxy.score || 0}</span>
                  <span>{proxy.lastRuntimeReport ? `${proxy.lastRuntimeReport.event || 'event'} ${proxy.lastRuntimeReport.context || ''} ${formatEpochMs(proxy.lastRuntimeReport.at)}` : 'n/a'}</span>
                  <span>{proxy.lastCheckerResult ? `${proxy.lastCheckerResult.probeType || 'check'} ${proxy.lastCheckerResult.status || proxy.lastCheckerResult.healthStatus || ''} ${formatEpochMs(proxy.lastCheckerResult.at)}` : 'n/a'}</span>
                </div>
              ))}
              {visibleLeaseRows.length === 0 ? (
                <div className="simple-table-row">
                  <span>no rows</span>
                  <span>n/a</span>
                  <span>n/a</span>
                  <span>n/a</span>
                  <span>n/a</span>
                  <span>n/a</span>
                </div>
              ) : null}
            </div>

            <div className="simple-table">
              <div className="simple-table-row header">
                <span>time</span>
                <span>node</span>
                <span>proxy</span>
                <span>probe</span>
                <span>status</span>
                <span>reason</span>
              </div>
              {(proxyLeaseStatus?.checkerLog || []).slice(0, 40).map((entry) => (
                <div key={`${entry.at}-${entry.proxyId}-${entry.probeType}`} className="simple-table-row">
                  <span>{formatEpochMs(entry.at)}</span>
                  <span>{entry.nodeId ? `NODE_${String(entry.nodeId).padStart(2, '0')}` : 'n/a'}</span>
                  <span>#{entry.index}</span>
                  <span>{entry.probeType}</span>
                  <span>{entry.status} {entry.httpCode || ''}</span>
                  <span>{entry.reason || 'n/a'}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Распределение прокси</h3>
                <span className="panel-caption">предпросмотр, разнос и применение без ручных скриптов</span>
              </div>
            </div>

            <div className="meta-strip wrap">
              <span className="chip tone-muted">валидных: {proxyPreview?.validUnique || 0}</span>
              <span className="chip tone-muted">битых: {proxyPreview?.invalidCount || 0}</span>
              <span className="chip tone-muted">изменятся: {proxyPreview?.changedNodeIds.length || 0}</span>
              <span className="chip tone-muted">
                разброс: {proxyPreview?.distributionSummary.minPerNode || 0}-{proxyPreview?.distributionSummary.maxPerNode || 0}
              </span>
              <span className="chip tone-muted">логины и пароли здесь не показываются</span>
            </div>

            {(proxyPreview?.validationErrors || []).length > 0 ? (
              <div className="list-stack">
                {proxyPreview?.validationErrors.map((message) => (
                  <div key={message} className="list-row danger-row">
                    <span className="list-row-key">ошибка</span>
                    <span className="list-row-main">{message}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="toolbar-inline wrap">
              <label className="inline-check">
                <input type="checkbox" checked={restartChanged} onChange={(event) => setRestartChanged(event.target.checked)} />
                перезапустить только изменившиеся узлы
              </label>
              <button
                type="button"
                className="ghost-btn accent"
                disabled={proxyBusy || !proxyPreview?.canApply}
                onClick={() => void applyProxyDistribution()}
              >
                {proxyBusy ? 'Применение...' : 'Применить распределение'}
              </button>
            </div>

            <div className="simple-table">
              <div className="simple-table-row header">
                <span>Узел</span>
                <span>IP</span>
                <span>Было → станет</span>
                <span>Следующий прокси</span>
                <span>Текущий активный</span>
                <span>Статус</span>
              </div>
              {(proxyPreview?.nodes || []).filter((node) => node.changed).map((entry) => {
                const current = proxyOverview[String(entry.nodeId)];
                return (
                  <div key={entry.nodeId} className="simple-table-row">
                    <span>{entry.nodeId}</span>
                    <span>{current?.ip || 'нет'}</span>
                    <span>{entry.oldCount} → {entry.newCount}</span>
                    <span>{maskSecret(entry.nextProxies?.[0]?.host)}:{entry.nextProxies?.[0]?.port || 'нет'}</span>
                    <span>{maskSecret(current?.activeProxy?.host)}:{current?.activeProxy?.port || 'нет'}</span>
                    <span>{current?.status || 'нет'}</span>
                  </div>
                );
              })}
            </div>
          </article>
        </section>
      ) : null}

      {section === 'editing' ? (
        <section className="studio-grid">
          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Редактирование без рестарта</h3>
                <span className="panel-caption">меняй режим и окно поиска для всех, одного узла или диапазона и отправляй hot reload одной кнопкой</span>
              </div>
            </div>

            <div className="meta-strip wrap">
              <span className="chip tone-muted">выбрано: {scopeLabel}</span>
              <span className="chip tone-muted">узлов: {scopeNodeIds.length}</span>
              <span className="chip tone-muted">проба: NODE_{String(probeNodeId).padStart(2, '0')}</span>
              <span className="chip tone-success">без перезапуска ботов</span>
              <span className="chip tone-muted">билеты узла: {activeTicketSummary}</span>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Кого редактируем</span>
                <select className="select-input" value={scope} onChange={(event) => setScope(event.target.value as ControlScope)}>
                  <option value="global">Весь флот</option>
                  <option value="single">Один узел</option>
                  <option value="range">Диапазон</option>
                </select>
              </label>

              {scope === 'single' ? (
                <label className="field">
                  <span>Узел</span>
                  <select className="select-input" value={scopeNodeId} onChange={(event) => setScopeNodeId(Number(event.target.value))}>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.id} / {node.ip}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {scope === 'range' ? (
                <label className="field">
                  <span>Диапазон</span>
                  <input
                    className="text-input"
                    value={scopeRangeText}
                    onChange={(event) => setScopeRangeText(event.target.value)}
                    placeholder="1-5,7,10-12"
                  />
                </label>
              ) : null}

              <label className="field">
                <span>Режим</span>
                <select className="select-input" value={quickMode} onChange={(event) => setQuickMode(event.target.value)}>
                  {TARGET_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Режим билетов</span>
                <select
                  className="select-input"
                  value={quickTicketSearchMode}
                  onChange={(event) => setQuickTicketSearchMode(event.target.value as TicketSearchMode)}
                >
                  <option value="dynamic">Динамический</option>
                  <option value="concrete">Конкретный</option>
                </select>
              </label>
              <label className="field">
                <span>Взрослые</span>
                <input
                  className="text-input"
                  type="number"
                  min={quickMode === 'individual' ? 1 : 0}
                  max={quickMode === 'individual' ? MAX_INDIVIDUAL_TICKETS : MAX_GROUP_NON_GUIDE}
                  value={quickAdults}
                  disabled={quickTicketSearchMode === 'dynamic'}
                  onChange={(event) => setQuickAdults(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Детские</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  max={MAX_GROUP_NON_GUIDE}
                  value={quickChildren}
                  disabled={quickMode === 'individual' || quickTicketSearchMode === 'dynamic'}
                  onChange={(event) => setQuickChildren(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Ищем с</span>
                <input className="text-input" type="datetime-local" value={quickStart} onChange={(event) => setQuickStart(event.target.value)} />
              </label>
              <label className="field">
                <span>Ищем до</span>
                <input className="text-input" type="datetime-local" value={quickEnd} onChange={(event) => setQuickEnd(event.target.value)} />
              </label>
            </div>

            <div className="empty-state compact">
              Итоговый состав: {quickTicketPlan.error ? quickTicketPlan.error : quickTicketPlan.summary}
            </div>

            <div className="toolbar-inline wrap">
              <button type="button" className="ghost-btn accent" disabled={quickBusy || Boolean(quickTicketPlan.error)} onClick={() => void saveAndApplyQuickEdit()}>
                <Save size={16} />
                {quickBusy ? 'Применение...' : 'Сохранить и применить без рестарта'}
              </button>
              <button type="button" className="ghost-btn" disabled={clearQuickBusy} onClick={() => void clearQuickOverrides()}>
                <Eraser size={16} />
                {clearQuickBusy ? 'Сброс...' : 'Сбросить окно и режим у выбранных'}
              </button>
              <button type="button" className="ghost-btn" disabled={resetTicketsBusy} onClick={() => void resetScopedTickets()}>
                <Ticket size={16} />
                {resetTicketsBusy ? 'Сброс билетов...' : 'Сбросить билеты у выбранных'}
              </button>
            </div>
            <div className="empty-state compact">
              Сброс билетов удаляет только `tickets` из `nodeOverrides`. Узлы продолжают работать и после hot reload берут набор билетов из базового target.
              <br />
              Сейчас у узла пробы override по билетам: {overrideTicketSummary}.
            </div>
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Команды по области</h3>
                <span className="panel-caption">деплой и сервисные действия по той же выборке узлов</span>
              </div>
            </div>

            <div className="action-matrix compact-action-matrix">
              <button type="button" className="action-btn accent" disabled={resetCartBusy} onClick={() => void resetScopedCarts()}>
                <ShoppingCart size={16} />
                {resetCartBusy ? 'Сброс корзин...' : 'Сброс корзин'}
              </button>
              <button type="button" className="action-btn" onClick={() => void runScopedCommand('deploy')}>
                <Rocket size={16} />
                Деплой области
              </button>
              <button type="button" className="action-btn" onClick={() => void runScopedCommand('sidecar-sync')}>
                <UploadCloud size={16} />
                Синхр. сайдкар
              </button>
              <button type="button" className="action-btn" onClick={() => void runScopedCommand('restart')}>
                <RotateCw size={16} />
                Рестарт области
              </button>
            </div>

            <div className="empty-state compact">
              Сброс корзин закрывает checkout/Chrome-профили, очищает локальные pay/manual-маркеры и запускает выбранные узлы заново.
              Для массового сброса активных корзин включи guardrail override в служебных параметрах.
            </div>

            <div className="list-stack">
              {rolloutJobs.slice(0, 14).map((job) => (
                <div key={job.id} className="list-row">
                  <span className="list-row-key">#{job.id}</span>
                  <span className="list-row-main">{summarizeText(job.title, 72)}</span>
                  <span className="list-row-aside">{formatJobStatus(job.status)}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>История конфига</h3>
                <span className="panel-caption">сохранения, применения и связанные события</span>
              </div>
            </div>

            <div className="list-stack">
              {configHistory.slice(0, 14).map((event) => (
                <div key={event.id} className="list-row">
                  <span className="list-row-key">{formatEventType(event.type)}</span>
                  <span className="list-row-main">{localizeAlertMessage(event.message, event.node_id)}</span>
                  <span className="list-row-aside">{formatTimestamp(event.created_at)}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>Срез выбранного узла</h3>
                <span className="panel-caption">быстрый операторский снимок по узлу для редактирования и hot reload</span>
              </div>
            </div>

            <div className="triple-json">
              <div>
                <span className="section-label">ожидаемое</span>
                <pre className="json-block">{JSON.stringify(displayProbeDesired, null, 2)}</pre>
              </div>
              <div>
                <span className="section-label">живое</span>
                <pre className="json-block">{JSON.stringify(displayProbeRuntime, null, 2)}</pre>
              </div>
              <div>
                <span className="section-label">переопределение</span>
                <pre className="json-block">{JSON.stringify(displayProbeOverride, null, 2)}</pre>
              </div>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
