import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CreditCard,
  Eraser,
  FileSliders,
  LogOut,
  Moon,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  Rocket,
  RotateCw,
  Save,
  Search,
  ScrollText,
  Server,
  ShieldAlert,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  Ticket,
  UploadCloud,
  X
} from 'lucide-react';
import { api, apiWithRetry, ApiError } from '@/lib/api';
import {
  cloneJson,
  cx,
  formatBotStatus,
  formatCartState,
  formatCommandLabel,
  formatEventType,
  formatIssueSummary,
  formatMode,
  formatNodeLabel,
  formatNodeStatus,
  formatRelativeSeconds,
  formatSlotLabel,
  formatTimestamp,
  getCartState,
  getNodeSlot,
  getRuntimeConfirmed,
  getTicketCount,
  isActionableNode,
  isDisputedNode,
  localizeAlertMessage,
  summarizeText
} from '@/lib/format';
import { useLogStream } from '@/hooks/useLogStream';
import { useRealtime } from '@/hooks/useRealtime';
import type {
  CommandJobResponse,
  CommandKind,
  ConfigApplyResult,
  EventRecord,
  JobRecord,
  MetricsHistoryPayload,
  MetricSnapshotPoint,
  NodeRecord,
  OverviewPayload,
  PaymentRequestResponse,
  RealtimeInitPayload,
  WorkstationPayload
} from '@/types';
import brandImage from '@/assets/ticket-sniper-brand.png';

type PageKey = 'logs' | 'servers' | 'payment' | 'stats';
type AuthState = 'checking' | 'guest' | 'ready';
type ThemePreference = 'light' | 'dark';
type ControlScope = 'selected' | 'range' | 'all';
type MetricsRange = '1h' | '6h' | '24h' | '72h';

interface RouteState {
  page: PageKey;
  nodeId: number | null;
}

interface ToastState {
  id: number;
  tone: 'info' | 'success' | 'danger';
  message: string;
}

const commandDefs: Array<{ command: CommandKind; label: string; tone?: 'primary' | 'danger'; icon: typeof Play }> = [
  { command: 'start', label: 'Старт', icon: Play },
  { command: 'restart', label: 'Рестарт', icon: RotateCw },
  { command: 'stop', label: 'Стоп', tone: 'danger', icon: Pause },
  { command: 'deploy', label: 'Деплой', icon: Rocket },
  { command: 'sidecar-sync', label: 'Сайдкар', icon: UploadCloud },
  { command: 'reset-cart', label: 'Сброс корзин', tone: 'danger', icon: Eraser },
  { command: 'pay', label: 'Оплата', tone: 'primary', icon: CreditCard }
];

const metricRanges: Array<{ value: MetricsRange; label: string }> = [
  { value: '1h', label: '1ч' },
  { value: '6h', label: '6ч' },
  { value: '24h', label: '24ч' },
  { value: '72h', label: '72ч' }
];

function parseHash(hashValue: string): RouteState {
  const normalized = hashValue.replace(/^#/, '');
  const [pageToken, nodeToken] = normalized.split('/');
  const page = pageToken === 'servers' || pageToken === 'payment' || pageToken === 'stats' || pageToken === 'logs'
    ? pageToken
    : 'logs';
  return {
    page,
    nodeId: nodeToken ? Number(nodeToken) || null : null
  };
}

function buildHash(page: PageKey, nodeId?: number | null) {
  return nodeId ? `#${page}/${nodeId}` : `#${page}`;
}

function upsertNode(nodes: NodeRecord[], nextNode: NodeRecord) {
  const index = nodes.findIndex((node) => node.id === nextNode.id);
  if (index === -1) return [...nodes, nextNode].sort((left, right) => left.id - right.id);
  const clone = nodes.slice();
  clone[index] = { ...clone[index], ...nextNode };
  return clone;
}

function upsertJob(jobs: JobRecord[], nextJob: JobRecord) {
  const index = jobs.findIndex((job) => job.id === nextJob.id);
  if (index === -1) return [nextJob, ...jobs].slice(0, 60);
  const clone = jobs.slice();
  clone[index] = { ...clone[index], ...nextJob };
  return clone.sort((left, right) => right.id - left.id).slice(0, 60);
}

function countProblems(overview: OverviewPayload | null) {
  return Object.values(overview?.problemCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function isRunningJob(job: JobRecord) {
  return ['queued', 'running'].includes(job.status);
}

function readInitialTheme(): ThemePreference {
  const saved = window.localStorage.getItem('botik-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatDateTimeLocal(value: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
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

function pruneObject(record: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([, value]) => {
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
      start: formatDateTimeLocal(entry.target_datetime_start || ''),
      end: formatDateTimeLocal(entry.target_datetime_end || '')
    };
  }
  return { start: '', end: '' };
}

function parseNodeRange(value: string, nodes: NodeRecord[]) {
  const allowed = new Set(nodes.map((node) => node.id));
  const selected = new Set<number>();
  const trimmed = value.trim();
  if (!trimmed) return { nodeIds: [] as number[], error: 'Укажите диапазон: 1-5,7,10.' };

  for (const chunk of trimmed.split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        return { nodeIds: [] as number[], error: `Некорректный диапазон: ${part}` };
      }
      for (let id = start; id <= end; id += 1) {
        if (allowed.has(id)) selected.add(id);
      }
      continue;
    }
    const id = Number(part);
    if (!Number.isInteger(id) || id <= 0) return { nodeIds: [] as number[], error: `Некорректный узел: ${part}` };
    if (allowed.has(id)) selected.add(id);
  }

  const nodeIds = Array.from(selected).sort((left, right) => left - right);
  return nodeIds.length ? { nodeIds, error: null } : { nodeIds, error: 'По диапазону не найдено узлов.' };
}

function buildTickets(mode: string, ticketMode: string, adultsText: string, childrenText: string) {
  const adults = Math.max(0, Number(adultsText || 0) || 0);
  const children = mode === 'individual' ? 0 : Math.max(0, Number(childrenText || 0) || 0);
  if (ticketMode === 'dynamic') {
    return mode === 'individual'
      ? [{ label: 'Intero', quantity: 24 }]
      : [
          { label: 'Intero', quantity: 24 },
          { label: 'Guide turistiche con tesserino', quantity: 1 }
        ];
  }
  return [
    ...(adults > 0 ? [{ label: 'Intero', quantity: adults }] : []),
    ...(children > 0 ? [{ label: 'Gratuito - Under 18', quantity: children }] : []),
    ...(mode === 'individual' ? [] : [{ label: 'Guide turistiche con tesserino', quantity: 1 }])
  ];
}

function getMetric(point: MetricSnapshotPoint, key: keyof MetricSnapshotPoint) {
  return Number(point[key] || 0);
}

function buildLine(points: MetricSnapshotPoint[], key: keyof MetricSnapshotPoint, width = 420, height = 96) {
  if (!points.length) return '';
  const values = points.map((point) => getMetric(point, key));
  const max = Math.max(...values, 1);
  if (points.length === 1) return `0,${height - 10} ${width},${height - 10}`;
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (getMetric(point, key) / max) * (height - 18) - 9;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

const getLogLineStyle = (line: string) => {
  if (line.includes('HOLDING SLOT') || line.includes('CHECKOUT INITIATED')) return { color: 'white' };
  if (line.includes('SEARCHING')) return { color: 'var(--amber)' };
  if (line.includes('SYSTEM: APPLYING') || line.includes('SYSTEM: HEALTH CHECK')) return { color: 'var(--accent)' };
  if (line.includes('CART SUCCESS')) return { color: 'var(--green)' };
  if (line.includes('403 FORBIDDEN') || line.includes('Proxy Ban') || line.includes('ERROR')) return { color: 'var(--red)' };
  return {};
};

interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  className?: string;
  style?: React.CSSProperties;
}

function CustomSelect({ value, onChange, options, className, style }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={containerRef} className={`custom-select ${isOpen ? 'open' : ''} ${className || ''}`} style={style}>
      <button
        type="button"
        className="select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: '100%' }}
      >
        <span>{selectedOption ? selectedOption.label : ''}</span>
      </button>
      {isOpen && (
        <div className="select-options">
          {options.map((option) => (
            <div
              key={option.value}
              className="option"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: ThemePreference; setTheme: (value: ThemePreference) => void }) {
  const options = [
    { key: 'light' as const, icon: Sun, label: 'Светлая тема' },
    { key: 'dark' as const, icon: Moon, label: 'Темная тема' }
  ];

  return (
    <div className="theme-switch" aria-label="Тема">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            className={theme === option.key ? 'active' : ''}
            onClick={() => setTheme(option.key)}
            aria-label={option.label}
            title={option.label}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

function ToastStack({ toasts }: { toasts: ToastState[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast tone-${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ tone = 'muted', children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

function NodeHealth({ node }: { node: NodeRecord }) {
  const cart = getCartState(node);
  const tone =
    node.status !== 'online' ? 'danger' : node.primaryIssue ? 'warning' : isActionableNode(node) ? 'success' : 'muted';
  return (
    <div className="node-health">
      <StatusBadge tone={tone}>{formatNodeStatus(node.status)}</StatusBadge>
      <StatusBadge tone={node.bot_status === 'running' ? 'success' : node.bot_status === 'stopped' ? 'danger' : 'warning'}>
        {formatBotStatus(node.bot_status)}
      </StatusBadge>
      <StatusBadge tone={isActionableNode(node) ? 'success' : 'muted'}>{formatCartState(cart)}</StatusBadge>
      {isDisputedNode(node) ? <StatusBadge tone="warning">drift</StatusBadge> : null}
    </div>
  );
}

function LoginScreen({
  password,
  setPassword,
  loginError,
  onSubmit
}: {
  password: string;
  setPassword: (value: string) => void;
  loginError: string;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-logo-text">TICKET SNIPER</div>
        <div>
          <p className="eyebrow">Control Center</p>
          <h1>Botik операционная панель</h1>
          <p>Логи, серверы, hot reload и оплата в одном чистом интерфейсе.</p>
        </div>
        <label className="field">
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </label>
        {loginError ? <div className="alert danger" role="alert">{loginError}</div> : null}
        <button type="submit" className="btn primary">Войти</button>
      </form>
    </main>
  );
}

function AppShell({
  route,
  navigate,
  theme,
  setTheme,
  overview,
  nodes,
  jobs,
  connected,
  onLogout,
  children
}: {
  route: RouteState;
  navigate: (page: PageKey, nodeId?: number | null) => void;
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
  overview: OverviewPayload | null;
  nodes: NodeRecord[];
  jobs: JobRecord[];
  connected: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const problemCount = countProblems(overview);
  const activeCartCount = overview?.paymentCount ?? nodes.filter(isActionableNode).length;
  const runningJobs = jobs.filter(isRunningJob).length;
  const online = nodes.filter((node) => node.status === 'online').length;
  const nav = [
    { key: 'logs' as const, label: 'Логи', icon: ScrollText, metric: String(problemCount + (overview?.diagnosticNoiseCount || 0)) },
    { key: 'servers' as const, label: 'Редактирование', icon: FileSliders, metric: `${online}/${nodes.length}` },
    { key: 'payment' as const, label: 'Оплата', icon: CreditCard, metric: String(activeCartCount) },
    { key: 'stats' as const, label: 'Статистика', icon: BarChart3, metric: runningJobs ? `${runningJobs} jobs` : 'live' }
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button type="button" className="brand-card" onClick={() => navigate('logs')} aria-label="Открыть логи">
          <span className="brand-logo-text">TICKET SNIPER</span>
        </button>
        <nav className="nav-list" aria-label="Основная навигация">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={route.page === item.key ? 'nav-item active' : 'nav-item'}
                onClick={() => navigate(item.key)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                <b className="nav-metric">{item.metric}</b>
              </button>
            );
          })}
        </nav>
        <section className="side-footer" aria-label="Сводка">
          <div className="facts-list">
            <div><span>Сигнал</span><b>{connected ? 'СТАБИЛЬНО' : 'ПОТЕРЯ'}</b></div>
            <div><span>Узлы</span><b>{nodes.length}</b></div>
          </div>
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button type="button" className="btn ghost sidebar-logout" style={{ width: '100%', marginTop: '16px' }} onClick={onLogout}>
            <LogOut size={16} />
            Выйти
          </button>
        </section>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-actions">
            <span className={cx('status-badge', connected ? 'tone-success' : 'tone-danger')}>
              {connected ? 'СИСТЕМА В НОРМЕ' : 'ПОТЕРЯ СВЯЗИ'}
            </span>
          </div>
        </header>
        <main className="page-content" key={route.page}>{children}</main>
      </div>
    </div>
  );
}

function LogsPage({
  nodes,
  socket,
  connected,
  initialNodeId,
  onOpenServers
}: {
  nodes: NodeRecord[];
  socket: Socket | null;
  connected: boolean;
  initialNodeId: number | null;
  onOpenServers: (nodeId: number) => void;
}) {
  const [nodeId, setNodeId] = useState<number | null>(initialNodeId || nodes[0]?.id || null);
  const [payload, setPayload] = useState<WorkstationPayload | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState(payload?.logs?.lines || []);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    if (!nodes.length) return;
    if (!nodeId || !nodes.some((node) => node.id === nodeId)) setNodeId(initialNodeId || nodes[0].id);
  }, [initialNodeId, nodeId, nodes]);

  const activeNode = useMemo(
    () => nodes.find((node) => node.id === nodeId) || payload?.node || null,
    [nodeId, nodes, payload?.node]
  );

  const loadNode = async (targetNodeId = nodeId) => {
    if (!targetNodeId) return;
    setLoading(true);
    setError('');
    try {
      const [nextPayload, nextEvents] = await Promise.all([
        apiWithRetry<WorkstationPayload>(`/workstation/${targetNodeId}`),
        apiWithRetry<EventRecord[]>(`/events?nodeId=${targetNodeId}&limit=40`)
      ]);
      setPayload(nextPayload);
      setEvents(nextEvents);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить логи.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (nodeId) void loadNode(nodeId);
  }, [nodeId, connected]);

  const { snapshot, meta, error: streamError } = useLogStream({
    socket,
    nodeId,
    enabled: !!nodeId,
    seed: payload?.logs || null
  });

  useEffect(() => {
    if (paused) setFrozen(snapshot.lines || []);
  }, [paused]);

  const sourceLines = paused ? frozen : snapshot.lines || [];
  const lines = deferredQuery
    ? sourceLines.filter((entry) => entry.line.toLowerCase().includes(deferredQuery))
    : sourceLines;

  useEffect(() => {
    if (!follow || paused) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow, paused, lines.length]);

  const issue = payload?.issues?.[0] || activeNode?.primaryIssue || null;

  return (
    <section className="logs-page asymmetric-grid">
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Мониторинг потока</p>
            <h2>Системный лог</h2>
          </div>
          <div className="toolbar-inline">
            <CustomSelect
              style={{ minWidth: '240px' }}
              value={nodeId ? String(nodeId) : ''}
              onChange={(val) => setNodeId(val ? Number(val) : null)}
              options={[
                { value: '', label: 'Все узлы кластера' },
                ...nodes.map((node) => ({
                  value: String(node.id),
                  label: `${formatNodeLabel(node.id)} / ${node.ip}`
                }))
              ]}
            />
            <button type="button" className="btn primary" disabled={loading || !nodeId} onClick={() => void loadNode()}>
              <RefreshCw size={16} />
              {loading ? 'Загрузка...' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="panel-toolbar" style={{ borderBottom: '1px solid var(--border)', padding: '12px 40px', background: 'var(--surface)' }}>
          <div className="search-field" style={{ flexGrow: 1 }}>
            <Search size={16} />
            <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="HOLD / 403 / HOT RELOAD" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className={cx('btn ghost', paused && 'primary')} onClick={() => setPaused((v) => !v)} style={{ boxShadow: 'none', padding: '8px 16px' }}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
              {paused ? 'Продолжить' : 'Пауза'}
            </button>
            <button type="button" className={cx('btn ghost', follow && 'primary')} onClick={() => setFollow((v) => !v)} style={{ boxShadow: 'none', padding: '8px 16px' }}>
              <ScrollText size={16} />
              Хвост
            </button>
          </div>
        </div>

        <div className="log-scroller" ref={scrollerRef}>
          {lines.length ? (
            lines.map((entry) => (
              <div key={entry.seq} className="log-line">
                <span className="log-seq">{String(entry.seq).padStart(4, '0')}</span>
                <time className="log-time">{entry.ts ? formatTimestamp(entry.ts) : '—'}</time>
                <code className="log-text" style={getLogLineStyle(entry.line)}>{entry.line}</code>
              </div>
            ))
          ) : (
            <div className="empty-state" style={{ padding: '60px', textAlign: 'center', opacity: 0.5 }}>
              <ScrollText size={48} style={{ marginBottom: '20px' }} />
              <p>Ожидание входящих логов или применение фильтра...</p>
            </div>
          )}
        </div>
      </div>

      <aside className="panel inspector">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Инспектор</p>
            <h3>Контекст</h3>
          </div>
        </div>

        {activeNode ? (
          <div className="inspector-content">
            <div className="node-tile" style={{ border: 'none', background: 'transparent' }}>
              <div className="node-head">
                <div className="node-title">{formatNodeLabel(activeNode.id)}</div>
                <div className="node-subtitle">{activeNode.ip}</div>
              </div>
              <NodeHealth node={activeNode} />
            </div>

            <div className="facts-list" style={{ padding: '0 32px 32px' }}>
              <div><span>Слот</span><b>{formatSlotLabel(getNodeSlot(activeNode))}</b></div>
              <div><span>Корзина</span><b>{formatCartState(getCartState(activeNode))}</b></div>
              <div><span>Пульс</span><b>{formatRelativeSeconds(activeNode.heartbeatAgeSec)}</b></div>
              {issue && (
                <div className="alert danger" style={{ marginTop: '20px' }}>
                  <ShieldAlert size={16} />
                  {formatIssueSummary(issue)}
                </div>
              )}
            </div>

            <div className="panel-head" style={{ borderTop: 'var(--border-width) solid var(--border)' }}>
              <h3>События</h3>
            </div>
            <div className="event-list" style={{ padding: '20px' }}>
              {events.slice(0, 8).map((ev) => (
                <div key={ev.id} className="list-row" style={{ gridTemplateColumns: '1fr auto', padding: '12px', fontSize: '0.8rem', borderBottom: '1px solid var(--border)' }}>
                  <div className="list-row-main">{localizeAlertMessage(ev.message, ev.node_id)}</div>
                  <time style={{ opacity: 0.5 }}>{formatTimestamp(ev.created_at)}</time>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '40px', textAlign: 'center', opacity: 0.5 }}>
            <Server size={32} style={{ marginBottom: '16px' }} />
            <p>Выберите узел для детального инспектирования.</p>
          </div>
        )}
      </aside>
    </section>
  );

}

function ServersPage({
  nodes,
  jobs,
  overview,
  initialNodeId,
  onCommand,
  onToast
}: {
  nodes: NodeRecord[];
  jobs: JobRecord[];
  overview: OverviewPayload | null;
  initialNodeId: number | null;
  onCommand: (command: CommandKind, nodeIds: number[], options?: { force?: boolean }) => Promise<void>;
  onToast: (message: string, tone?: ToastState['tone']) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(initialNodeId ? [initialNodeId] : []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'problem' | 'cart' | 'offline'>('all');
  const [busyCommand, setBusyCommand] = useState<CommandKind | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (filter === 'online' && node.status !== 'online') return false;
      if (filter === 'problem' && !node.primaryIssue && !isDisputedNode(node)) return false;
      if (filter === 'cart' && !isActionableNode(node)) return false;
      if (filter === 'offline' && node.status === 'online') return false;
      if (!deferredQuery) return true;
      return [
        node.id,
        node.ip,
        node.status,
        node.bot_status,
        node.displayMode,
        getNodeSlot(node),
        getCartState(node),
        node.primaryIssue?.summary
      ]
        .join(' ')
        .toLowerCase()
        .includes(deferredQuery);
    });
  }, [deferredQuery, filter, nodes]);

  const targetIds = selectedIds.length ? selectedIds : filteredNodes.map((node) => node.id);
  const rangeLabel = selectedIds.length ? `${selectedIds.length} выбрано` : `${filteredNodes.length} по фильтру`;

  const toggleNode = (nodeId: number) => {
    setSelectedIds((current) => (
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId].sort((a, b) => a - b)
    ));
  };

  const runCommand = async (command: CommandKind) => {
    if (!targetIds.length) {
      onToast('Нет выбранных серверов.', 'danger');
      return;
    }
    setBusyCommand(command);
    try {
      await onCommand(command, targetIds);
    } finally {
      setBusyCommand(null);
    }
  };

  return (
    <section className="servers-page asymmetric-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Операции кластера</p>
            <h2>Серверы и команды</h2>
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <StatusBadge tone="success">{nodes.filter((n) => n.status === 'online').length} ONLINE</StatusBadge>
            <StatusBadge tone="warning">{countProblems(overview)} ПРОБЛЕМЫ</StatusBadge>
            <StatusBadge>{rangeLabel}</StatusBadge>
          </div>
        </div>

        <div className="panel-toolbar" style={{ borderBottom: '1.5px solid var(--border)', padding: '12px 40px', background: 'var(--surface)' }}>
          <div className="search-field" style={{ flexGrow: 1 }}>
            <Search size={16} />
            <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск узла, IP или слота..." style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <CustomSelect
              style={{ minWidth: '160px' }}
              value={filter}
              onChange={(val) => setFilter(val as any)}
              options={[
                { value: 'all', label: 'Все узлы' },
                { value: 'online', label: 'Онлайн' },
                { value: 'problem', label: 'Проблемы' },
                { value: 'cart', label: 'Корзины' },
                { value: 'offline', label: 'Офлайн' }
              ]}
            />
            <div className="btn-group">
              <button type="button" className="btn ghost" onClick={() => setSelectedIds(filteredNodes.map((n) => n.id))} style={{ boxShadow: 'none' }}>Выбрать все</button>
              <button type="button" className="btn ghost" onClick={() => setSelectedIds([])} style={{ boxShadow: 'none' }}>Сброс</button>
            </div>
          </div>
        </div>

        <div className="command-grid">
          {commandDefs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.command}
                type="button"
                className={cx('btn', item.tone === 'danger' ? 'danger' : 'primary')}
                disabled={!targetIds.length || busyCommand !== null}
                onClick={() => void runCommand(item.command)}
                style={{ width: '100%', height: '80px', flexDirection: 'column', gap: '4px' }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                <small style={{ opacity: 0.7, fontSize: '0.6rem' }}>{busyCommand === item.command ? 'в очереди...' : `${targetIds.length} узл.`}</small>
              </button>
            );
          })}
        </div>

        <div className="node-table" style={{ borderTop: 'var(--border-width) solid var(--border)' }}>
          {filteredNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={cx('list-row interactive', selectedIds.includes(node.id) && 'active')}
              onClick={() => toggleNode(node.id)}
              style={{ gridTemplateColumns: '80px 1fr 200px 200px 100px', textAlign: 'left', width: '100%' }}
            >
              <span style={{ fontWeight: 900 }}>{formatNodeLabel(node.id)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{node.ip}</span>
              <NodeHealth node={node} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontWeight: 700 }}>{formatSlotLabel(getNodeSlot(node))}</span>
                <small style={{ opacity: 0.6 }}>{formatMode(node.displayMode || 'group')}</small>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 900 }}>
                {formatRelativeSeconds(node.heartbeatAgeSec)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <ConfigEditor nodes={nodes} selectedIds={selectedIds} jobs={jobs} onToast={onToast} />
    </section>
  );

}

function ConfigEditor({
  nodes,
  selectedIds,
  jobs,
  onToast
}: {
  nodes: NodeRecord[];
  selectedIds: number[];
  jobs: JobRecord[];
  onToast: (message: string, tone?: ToastState['tone']) => void;
}) {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<ControlScope>('selected');
  const [rangeText, setRangeText] = useState('1-31');
  const [mode, setMode] = useState('group');
  const [ticketMode, setTicketMode] = useState('dynamic');
  const [adults, setAdults] = useState('24');
  const [children, setChildren] = useState('0');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [force, setForce] = useState(false);

  const rangeSelection = useMemo(() => parseNodeRange(rangeText, nodes), [nodes, rangeText]);
  const scopeNodeIds = scope === 'all'
    ? nodes.map((node) => node.id)
    : scope === 'range'
      ? rangeSelection.nodeIds
      : selectedIds;
  const scopeError = scope === 'range' ? rangeSelection.error : null;

  const hydrateFromConfig = (nextConfig: Record<string, any>) => {
    const nextMode = nextConfig.application?.mode || 'group';
    const target = getTargetByMode(nextConfig, nextMode);
    const windowValues = getWindowValues(target);
    setMode(nextMode);
    setTicketMode(String(target?.ticketSearchMode || target?.ticket_search_mode || 'dynamic') === 'concrete' ? 'concrete' : 'dynamic');
    setStart(windowValues.start);
    setEnd(windowValues.end);
  };

  const loadConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await apiWithRetry<Record<string, any>>('/config');
      setConfig(next);
      hydrateFromConfig(next);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить конфиг.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const saveAndApply = async () => {
    if (!config) return;
    if (scopeError) {
      setError(scopeError);
      return;
    }
    if (!scopeNodeIds.length) {
      setError('Выберите серверы для применения.');
      return;
    }
    if (!start || !end || Date.parse(start) >= Date.parse(end)) {
      setError('Укажите корректное окно поиска.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const nextConfig = cloneJson(config);
      nextConfig.nodeOverrides = nextConfig.nodeOverrides || {};
      const tickets = buildTickets(mode, ticketMode, adults, children);

      if (scope === 'all') {
        nextConfig.application = { ...(nextConfig.application || {}), mode };
        const target = getTargetByMode(nextConfig, mode);
        if (target) {
          cleanupScheduleFields(target);
          target.target_datetime_start = start;
          target.target_datetime_end = end;
          target.ticketSearchMode = ticketMode;
          target.tickets = tickets;
        }
      }

      scopeNodeIds.forEach((nodeId) => {
        const key = String(nodeId);
        const override = cleanupScheduleFields({ ...(nextConfig.nodeOverrides[key] || {}) });
        override.mode = mode;
        override.target_datetime_start = start;
        override.target_datetime_end = end;
        override.ticketSearchMode = ticketMode;
        override.tickets = tickets;
        nextConfig.nodeOverrides[key] = pruneObject(override);
      });

      const saved = await api<{ ok: boolean; config: Record<string, any> }>('/config', {
        method: 'PUT',
        body: nextConfig
      });
      setConfig(saved.config);

      const applied = await api<ConfigApplyResult>('/config/apply', {
        method: 'POST',
        body: {
          scope: scope === 'all' ? 'global' : 'selection',
          nodeIds: scope === 'all' ? [] : scopeNodeIds,
          force
        }
      });

      onToast(`Hot reload применен: ${applied.appliedNodeIds.length} узл.`, 'success');
      await loadConfig();
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось сохранить и применить.');
    } finally {
      setSaving(false);
    }
  };

  const recentJobs = jobs.filter((job) => ['deploy', 'restart', 'reset-cart', 'sidecar-sync'].includes(job.kind)).slice(0, 8);

  return (
    <aside className="panel editor-panel">
      <div className="panel-head compact-head">
        <div>
          <h2>Редактирование</h2>
          <p>Окно поиска, режим, билеты и hot reload.</p>
        </div>
        <button type="button" className="btn ghost icon-only" onClick={() => void loadConfig()} disabled={loading} aria-label="Обновить конфиг">
          <RefreshCw size={16} />
        </button>
      </div>

      {error ? <div className="alert danger" role="alert">{error}</div> : null}

      <div className="form-stack">
        <label className="field">
          <span>Область</span>
          <CustomSelect
            value={scope}
            onChange={(val) => setScope(val as ControlScope)}
            options={[
              { value: 'selected', label: 'Выбранные серверы' },
              { value: 'range', label: 'Диапазон' },
              { value: 'all', label: 'Весь флот' }
            ]}
          />
        </label>
        {scope === 'range' ? (
          <label className="field">
            <span>Диапазон</span>
            <input className="input" value={rangeText} onChange={(event) => setRangeText(event.target.value)} placeholder="1-5,7,10" />
          </label>
        ) : null}
        <div className="two-col">
          <label className="field">
            <span>Режим</span>
            <CustomSelect
              value={mode}
              onChange={setMode}
              options={[
                { value: 'group', label: 'Group' },
                { value: 'individual', label: 'Individual 24h' },
                { value: 'underground', label: 'Underground' }
              ]}
            />
          </label>
          <label className="field">
            <span>Билеты</span>
            <CustomSelect
              value={ticketMode}
              onChange={setTicketMode}
              options={[
                { value: 'dynamic', label: 'Динамически' },
                { value: 'concrete', label: 'Конкретно' }
              ]}
            />
          </label>
        </div>
        <div className="two-col">
          <label className="field">
            <span>Взрослые</span>
            <input className="input" type="number" min="0" value={adults} disabled={ticketMode === 'dynamic'} onChange={(event) => setAdults(event.target.value)} />
          </label>
          <label className="field">
            <span>Детские</span>
            <input className="input" type="number" min="0" value={children} disabled={ticketMode === 'dynamic' || mode === 'individual'} onChange={(event) => setChildren(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Ищем с</span>
          <input className="input" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="field">
          <span>Ищем до</span>
          <input className="input" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          Разрешить guardrail override для массовых действий
        </label>
      </div>

      <button type="button" className="btn primary full" disabled={saving || !scopeNodeIds.length} onClick={() => void saveAndApply()}>
        <Save size={16} />
        {saving ? 'Применение...' : `Сохранить и применить (${scopeNodeIds.length})`}
      </button>

      <div className="section-title">Сервисные jobs</div>
      <div className="mini-list">
        {recentJobs.length ? recentJobs.map((job) => (
          <div key={job.id}>
            <b>#{job.id} {summarizeText(job.title, 42)}</b>
            <span>{job.status} · {formatTimestamp(job.updated_at)}</span>
          </div>
        )) : <div className="empty-state compact">Сервисных задач нет.</div>}
      </div>
    </aside>
  );
}

function getPaymentSearchMode(node?: NodeRecord | null, cart?: WorkstationPayload['paymentCart']) {
  const source = String(
    cart?.ticketSearchMode ||
    node?.extra?.ticketSearchMode ||
    node?.extra?.ticket_search_mode ||
    node?.extra?.runtimeTicketSearchMode ||
    node?.extra?.expectedTicketSearchMode ||
    'dynamic'
  ).toLowerCase();
  return source === 'concrete' ? 'concrete' : 'dynamic';
}

function getPaymentCartCounts(node?: NodeRecord | null, cart?: WorkstationPayload['paymentCart']) {
  const adults = Number(cart?.caughtAdults ?? node?.derivedState?.cartAdults ?? 0) || 0;
  const children = Number(cart?.caughtChildren ?? node?.derivedState?.cartChildren ?? 0) || 0;
  const guide = Number(cart?.guideCount ?? node?.derivedState?.guideCount ?? (String(node?.displayMode || '').toLowerCase() === 'individual' ? 0 : 1)) || 0;
  const total = Number(cart?.totalTickets ?? getTicketCount(node) ?? adults + children + guide) || 0;
  return { adults, children, guide, total };
}

function isPaymentCartNode(node?: NodeRecord | null) {
  const cartState = String(getCartState(node) || '').toLowerCase();
  return isActionableNode(node) || ['carted', 'hold', 'checkout', 'paying', 'payment'].includes(cartState) || getTicketCount(node) > 0;
}

function PaymentPage({
  nodes,
  initialNodeId,
  onToast
}: {
  nodes: NodeRecord[];
  initialNodeId: number | null;
  onToast: (message: string, tone?: ToastState['tone']) => void;
}) {
  const paymentNodes = useMemo(() => nodes.filter(isPaymentCartNode).sort((left, right) => left.id - right.id), [nodes]);
  const initialActiveId = initialNodeId && paymentNodes.some((node) => node.id === initialNodeId)
    ? initialNodeId
    : paymentNodes[0]?.id || null;
  const [nodeId, setNodeId] = useState<number | null>(initialActiveId);
  const [payload, setPayload] = useState<WorkstationPayload | null>(null);
  const [adults, setAdults] = useState('8');
  const [children, setChildren] = useState('0');
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!paymentNodes.length) {
      if (nodeId !== null) setNodeId(null);
      setPayload(null);
      setModalOpen(false);
      return;
    }
    if (!nodeId || !paymentNodes.some((node) => node.id === nodeId)) {
      setNodeId(paymentNodes[0].id);
    }
  }, [nodeId, paymentNodes]);

  const activeNode = paymentNodes.find((node) => node.id === nodeId) || null;
  const cart = payload?.paymentCart;
  const cartCounts = getPaymentCartCounts(activeNode, cart);
  const searchMode = getPaymentSearchMode(activeNode, cart);
  const isConcreteSearch = searchMode === 'concrete';

  const loadPaymentNode = async () => {
    if (!nodeId) {
      setPayload(null);
      return;
    }
    setError('');
    try {
      setPayload(await apiWithRetry<WorkstationPayload>(`/workstation/${nodeId}`));
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить корзину.');
    }
  };

  useEffect(() => {
    void loadPaymentNode();
  }, [nodeId]);

  useEffect(() => {
    const counts = getPaymentCartCounts(activeNode, cart);
    setAdults(String(counts.adults || 8));
    setChildren(String(counts.children || 0));
  }, [activeNode?.id, cart?.caughtAdults, cart?.caughtChildren]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setModalOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, modalOpen]);

  const submitPayment = async () => {
    if (!nodeId || !activeNode) return;
    if (!cart) {
      setError('Корзина еще не подтверждена. Обновите данные узла.');
      return;
    }

    const requestAdults = isConcreteSearch ? cartCounts.adults : Number(adults || 0);
    const requestChildren = isConcreteSearch ? cartCounts.children : Number(children || 0);
    setBusy(true);
    setError('');
    try {
      const response = await api<PaymentRequestResponse>(`/nodes/${nodeId}/pay`, {
        method: 'POST',
        body: {
          adults: requestAdults,
          children: requestChildren,
          checkoutOnly: isConcreteSearch,
          source: 'web'
        }
      });
      setModalOpen(false);
      onToast(`Оплата поставлена: узел ${response.nodeId}`, 'success');
      await loadPaymentNode();
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось отправить оплату.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-grid payment-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Оплата</h2>
            <p>Активные корзины, короткая проверка и checkout без лишних полей на странице.</p>
          </div>
          <div className="meta-row">
            <StatusBadge tone={paymentNodes.length ? 'success' : 'muted'}>{paymentNodes.length} активных</StatusBadge>
            <button type="button" className="btn ghost" onClick={() => void loadPaymentNode()} disabled={!nodeId}>
              <RefreshCw size={16} />
              Обновить
            </button>
          </div>
        </div>

        {error ? <div className="alert danger" role="alert">{error}</div> : null}

        {!paymentNodes.length ? (
          <div className="payment-empty">
            <CreditCard size={22} />
            <h3>Активных корзин нет</h3>
            <p>Здесь появятся только серверы с корзиной, удержанием, checkout или платежным состоянием.</p>
          </div>
        ) : (
          <div className="payment-layout">
            <div className="payment-list" aria-label="Серверы с активной корзиной">
              {paymentNodes.map((node) => {
                const counts = getPaymentCartCounts(node, node.id === nodeId ? cart : undefined);
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={node.id === nodeId ? 'payment-node active' : 'payment-node'}
                    onClick={() => setNodeId(node.id)}
                  >
                    <span>
                      <b>{formatNodeLabel(node.id)}</b>
                      <small>{node.ip}</small>
                    </span>
                    <span className="payment-node-meta">
                      <StatusBadge tone="success">{formatCartState(getCartState(node))}</StatusBadge>
                      <small>{counts.total ? `${counts.total} бил.` : 'состав уточняется'}</small>
                    </span>
                    <small>{formatSlotLabel(getNodeSlot(node))}</small>
                  </button>
                );
              })}
            </div>

            <div className="payment-summary">
              <div className="payment-summary-head">
                <div>
                  <p className="eyebrow">{isConcreteSearch ? 'Concrete checkout' : 'Dynamic checkout'}</p>
                  <h3>{activeNode ? `${formatNodeLabel(activeNode.id)} / ${activeNode.ip}` : 'Узел не выбран'}</h3>
                </div>
                <StatusBadge tone={isConcreteSearch ? 'info' : 'warning'}>
                  {isConcreteSearch ? 'сразу checkout' : 'нужно уточнение'}
                </StatusBadge>
              </div>
              <div className="facts-list">
                <div><span>Поймано</span><b>{cart ? `${cartCounts.adults} взрослых / ${cartCounts.children} детских` : 'загрузка'}</b></div>
                <div><span>Гид</span><b>{cart ? cartCounts.guide : 'загрузка'}</b></div>
                <div><span>Всего</span><b>{cart ? cartCounts.total : 'загрузка'}</b></div>
                <div><span>Слот</span><b>{formatSlotLabel(cart?.slot || getNodeSlot(activeNode))}</b></div>
              </div>
              <div className="payment-summary-note">
                {isConcreteSearch
                  ? 'Конкретный поиск отправляется как checkout пойманной корзины без ручной правки состава.'
                  : 'Динамический поиск требует указать состав в модальном окне перед отправкой.'}
              </div>
              <button type="button" className="btn primary full" disabled={!activeNode || !cart} onClick={() => setModalOpen(true)}>
                <CreditCard size={16} />
                {isConcreteSearch ? 'Открыть checkout' : 'Настроить оплату'}
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && activeNode ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setModalOpen(false);
          }}
        >
          <section className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
            <div className="modal-head">
              <div>
                <p className="eyebrow">{formatNodeLabel(activeNode.id)}</p>
                <h2 id="payment-modal-title">{isConcreteSearch ? 'Checkout корзины' : 'Параметры оплаты'}</h2>
              </div>
              <button type="button" className="btn ghost icon-only" onClick={() => setModalOpen(false)} disabled={busy} aria-label="Закрыть окно оплаты">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="facts-list">
                <div><span>Сервер</span><b>{activeNode.ip}</b></div>
                <div><span>Режим</span><b>{isConcreteSearch ? 'concrete' : 'dynamic'}</b></div>
                <div><span>Поймано</span><b>{`${cartCounts.adults} взрослых / ${cartCounts.children} детских`}</b></div>
                <div><span>Всего</span><b>{cartCounts.total}</b></div>
              </div>

              {isConcreteSearch ? (
                <div className="payment-mode-note">
                  Concrete-поиск: отправляем checkout текущей корзины без изменения состава.
                </div>
              ) : (
                <div className="two-col">
                  <label className="field">
                    <span>Взрослые</span>
                    <input className="input" type="number" min="0" value={adults} onChange={(event) => setAdults(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Детские</span>
                    <input className="input" type="number" min="0" value={children} onChange={(event) => setChildren(event.target.value)} />
                  </label>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModalOpen(false)} disabled={busy}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy || !cart} onClick={() => void submitPayment()}>
                <ShoppingCart size={16} />
                {busy ? 'Отправка...' : isConcreteSearch ? 'Checkout' : 'Отправить'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function TrendCard({
  points,
  metric,
  label,
  tone
}: {
  points: MetricSnapshotPoint[];
  metric: keyof MetricSnapshotPoint;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}) {
  const width = 420;
  const height = 96;
  const line = buildLine(points, metric, width, height);
  const latest = points.length ? getMetric(points[points.length - 1], metric) : 0;

  // Construct SVG closed path for translucent background fill
  const strokePath = line ? `M ${line.split(' ').join(' L ')}` : '';
  const areaPath = line ? `M 0,${height} L ${line.split(' ').join(' L ')} L ${width},${height} Z` : '';

  return (
    <article className={`trend-card tone-${tone}`}>
      <div className="trend-header">
        <span className="trend-label">{label}</span>
        <b className="trend-value">{latest}</b>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Тренд ${label}`}>
        <line className="chart-grid" x1="0" y1="28" x2={width} y2="28" />
        <line className="chart-grid" x1="0" y1="66" x2={width} y2="66" />
        {areaPath ? <path className="chart-area" d={areaPath} /> : null}
        {strokePath ? <path className="chart-curve" d={strokePath} /> : null}
      </svg>
    </article>
  );
}

function StatsPage({
  overview,
  nodes,
  jobs
}: {
  overview: OverviewPayload | null;
  nodes: NodeRecord[];
  jobs: JobRecord[];
}) {
  const [range, setRange] = useState<MetricsRange>('24h');
  const [history, setHistory] = useState<MetricsHistoryPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentPoint: MetricSnapshotPoint = useMemo(() => {
    const issueCounts = overview?.problemCounts || {};
    return {
      capturedAt: overview?.generatedAt || new Date().toISOString(),
      nodeCount: nodes.length,
      onlineCount: nodes.filter((node) => node.status === 'online').length,
      paymentCount: overview?.paymentCount || 0,
      holdCount: overview?.holdCount || 0,
      checkoutCount: overview?.checkoutCount || 0,
      activeSlotCount: overview?.activeSlotCount || 0,
      problemCount: countProblems(overview),
      diagnosticNoiseCount: overview?.diagnosticNoiseCount || 0,
      runningJobCount: jobs.filter(isRunningJob).length,
      statusCounts: {},
      issueCounts
    };
  }, [jobs, nodes, overview]);

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await apiWithRetry<MetricsHistoryPayload>(`/metrics/history?range=${range}`));
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить историю.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [range]);

  const points = useMemo(() => {
    const rows = history?.points || [];
    return rows.length ? [...rows, currentPoint].slice(-360) : [currentPoint];
  }, [currentPoint, history?.points]);

  return (
    <section className="stats-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Мониторинг ресурсов</p>
            <h2>Статистика флота</h2>
          </div>
          <div className="toolbar">
            <div className="segmented">
              {metricRanges.map((option) => (
                <button key={option.value} type="button" className={range === option.value ? 'active' : ''} onClick={() => setRange(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary" disabled={loading} onClick={() => void loadHistory()}>
              <RefreshCw size={16} />
              {loading ? 'Обновление...' : 'Обновить данные'}
            </button>
          </div>
        </div>

        <div className="kpi-grid">
          <Kpi icon={RadioTower} label="Узлы ONLINE" value={`${currentPoint.onlineCount}/${currentPoint.nodeCount}`} />
          <Kpi icon={Ticket} label="Активные слоты" value={currentPoint.activeSlotCount} />
          <Kpi icon={ShoppingCart} label="Корзины (удержание)" value={currentPoint.paymentCount} />
          <Kpi icon={AlertTriangle} label="Проблемы флота" value={currentPoint.problemCount} tone={currentPoint.problemCount ? 'danger' : 'success'} />
        </div>
      </div>

      <div className="asymmetric-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Тренды (24ч)</h3>
          </div>
          <div className="trend-grid">
            <TrendCard points={points} metric="onlineCount" label="Онлайн" tone="success" />
            <TrendCard points={points} metric="activeSlotCount" label="Слоты" tone="info" />
            <TrendCard points={points} metric="paymentCount" label="Корзины" tone="success" />
            <TrendCard points={points} metric="problemCount" label="Проблемы" tone="danger" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Статус-контроль</h3>
          </div>
          <div className="facts-list" style={{ padding: '32px' }}>
            <div><span>Работающие задачи</span><b>{currentPoint.runningJobCount}</b></div>
            <div><span>Диагностический шум</span><b>{currentPoint.diagnosticNoiseCount}</b></div>
            <div><span>Последнее обновление</span><b>{formatTimestamp(overview?.generatedAt)}</b></div>
            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
              <p style={{ opacity: 0.6, fontSize: '0.8rem' }}>Данные получены напрямую из координатора кластера. Тренды строятся на основе снимков состояния с интервалом 5 мин.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


function Kpi({
  icon: Icon,
  label,
  value,
  tone = 'neutral'
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <article className={`kpi tone-${tone}`}>
      <span className="kpi-label"><Icon size={16} />{label}</span>
      <b className="kpi-value">{value}</b>
    </article>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash));
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [bootError, setBootError] = useState('');
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = theme;
    window.localStorage.setItem('botik-theme', theme);
  }, [theme]);

  const pushToast = (message: string, tone: ToastState['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, 3600);
  };

  const setGuest = () => {
    setAuthState('guest');
    setOverview(null);
    setNodes([]);
    setJobs([]);
  };

  const handleApiError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setGuest();
      setLoginError('Сессия истекла. Войдите заново.');
      return true;
    }
    return false;
  };

  const bootstrap = async (silent = false) => {
    if (!silent) setBootError('');
    try {
      const [nextOverview, nextJobs] = await Promise.all([
        apiWithRetry<OverviewPayload>('/overview', undefined, { attempts: 6, initialDelayMs: 1000 }),
        apiWithRetry<JobRecord[]>('/jobs', undefined, { attempts: 6, initialDelayMs: 1000 })
      ]);
      setOverview(nextOverview);
      setNodes(nextOverview.nodes || []);
      setJobs(nextJobs || []);
    } catch (error: any) {
      if (!handleApiError(error)) setBootError(error.message || 'Не удалось загрузить панель.');
    }
  };

  useEffect(() => {
    apiWithRetry<{ authenticated: boolean }>('/auth/check', undefined, { attempts: 6, initialDelayMs: 1000 })
      .then((response) => {
        if (response.authenticated) {
          setAuthState('ready');
          void bootstrap();
        } else {
          setAuthState('guest');
        }
      })
      .catch(() => setAuthState('guest'));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { socket, connected } = useRealtime({
    enabled: authState === 'ready',
    onInit: (payload: RealtimeInitPayload) => {
      if (payload.overview) {
        setOverview(payload.overview);
        setNodes(payload.overview.nodes || payload.nodes || []);
      }
      if (payload.nodes) setNodes(payload.nodes);
      if (payload.jobs) setJobs(payload.jobs);
    },
    onNodeUpdate: (node) => setNodes((current) => upsertNode(current, node)),
    onJobUpdate: (job) => setJobs((current) => upsertJob(current, job)),
    onOverviewUpdate: (nextOverview) => {
      setOverview(nextOverview);
      setNodes(nextOverview.nodes || []);
      setJobs((current) => nextOverview.jobs?.length ? nextOverview.jobs : current);
    }
  });

  useEffect(() => {
    if (authState !== 'ready' || !connected) return;
    if (overview && nodes.length > 0 && !bootError) return;
    void bootstrap(true);
  }, [authState, bootError, connected, nodes.length, overview]);

  const navigate = (page: PageKey, nodeId?: number | null) => {
    window.location.hash = buildHash(page, nodeId);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    try {
      await api('/auth/login', { method: 'POST', body: { password } });
      setPassword('');
      setAuthState('ready');
      await bootstrap();
      pushToast('Сессия открыта.', 'success');
    } catch (error: any) {
      setLoginError(error.message || 'Не удалось войти.');
    }
  };

  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    setGuest();
  };

  const runCommand = async (command: CommandKind, nodeIds: number[], options?: { force?: boolean }) => {
    if (!nodeIds.length) return;
    try {
      const response = await api<CommandJobResponse>('/commands', {
        method: 'POST',
        body: { command, nodeIds, force: options?.force === true }
      });
      setJobs((current) => upsertJob(current, response.job));
      pushToast(`${formatCommandLabel(command)} поставлен в очередь: ${nodeIds.length} узл.`, 'success');
    } catch (error: any) {
      if (!handleApiError(error)) pushToast(error.message || `Не удалось выполнить ${formatCommandLabel(command)}.`, 'danger');
      throw error;
    }
  };

  if (authState === 'checking') {
    return (
      <main className="loading-screen">
        <RadioTower size={20} />
        <span>Запуск панели...</span>
      </main>
    );
  }

  if (authState === 'guest') {
    return (
      <LoginScreen
        password={password}
        setPassword={setPassword}
        loginError={loginError}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <AppShell
      route={route}
      navigate={navigate}
      theme={theme}
      setTheme={setTheme}
      overview={overview}
      nodes={nodes}
      jobs={jobs}
      connected={connected}
      onLogout={() => void handleLogout()}
    >
      {bootError ? <div className="alert danger" role="alert">{bootError}</div> : null}

      {route.page === 'logs' ? (
        <LogsPage
          nodes={nodes}
          socket={socket}
          connected={connected}
          initialNodeId={route.nodeId}
          onOpenServers={(nodeId) => navigate('servers', nodeId)}
        />
      ) : null}

      {route.page === 'servers' ? (
        <ServersPage
          nodes={nodes}
          jobs={jobs}
          overview={overview}
          initialNodeId={route.nodeId}
          onCommand={runCommand}
          onToast={pushToast}
        />
      ) : null}

      {route.page === 'payment' ? (
        <PaymentPage nodes={nodes} initialNodeId={route.nodeId} onToast={pushToast} />
      ) : null}

      {route.page === 'stats' ? (
        <StatsPage overview={overview} nodes={nodes} jobs={jobs} />
      ) : null}

      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
