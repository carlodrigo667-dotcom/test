import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CircleCheck, Clock3, RadioTower, ShoppingCart } from 'lucide-react';
import { apiWithRetry } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';
import type { JobRecord, MetricsHistoryPayload, MetricSnapshotPoint, NodeRecord, OverviewPayload } from '@/types';

type MetricsRange = '1h' | '6h' | '24h' | '72h';
type MetricKey =
  | 'onlineCount'
  | 'activeSlotCount'
  | 'paymentCount'
  | 'problemCount'
  | 'diagnosticNoiseCount'
  | 'runningJobCount';

interface StatsViewProps {
  overview: OverviewPayload | null;
  nodes: NodeRecord[];
  jobs: JobRecord[];
  connected: boolean;
}

const RANGE_OPTIONS: Array<{ value: MetricsRange; label: string }> = [
  { value: '1h', label: '1ч' },
  { value: '6h', label: '6ч' },
  { value: '24h', label: '24ч' },
  { value: '72h', label: '72ч' }
];

function buildCurrentPoint(overview: OverviewPayload | null, nodes: NodeRecord[], jobs: JobRecord[]): MetricSnapshotPoint {
  const issueCounts = overview?.problemCounts || {};
  return {
    capturedAt: overview?.generatedAt || new Date().toISOString(),
    nodeCount: nodes.length,
    onlineCount: nodes.filter((node) => node.status === 'online').length,
    paymentCount: overview?.paymentCount || 0,
    holdCount: overview?.holdCount || 0,
    checkoutCount: overview?.checkoutCount || 0,
    activeSlotCount: overview?.activeSlotCount || 0,
    problemCount: Object.values(issueCounts).reduce((sum, value) => sum + Number(value || 0), 0),
    diagnosticNoiseCount: overview?.diagnosticNoiseCount || 0,
    runningJobCount: jobs.filter((job) => ['queued', 'running'].includes(job.status)).length,
    statusCounts: nodes.reduce<Record<string, number>>((acc, node) => {
      const status = String(node.status || 'unknown');
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
    issueCounts
  };
}

function getMetric(point: MetricSnapshotPoint, key: MetricKey) {
  return Number(point[key] || 0);
}

function buildPolyline(points: MetricSnapshotPoint[], key: MetricKey, width: number, height: number) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const y = height - 10;
    return `0,${y} ${width},${y}`;
  }

  const values = points.map((point) => getMetric(point, key));
  const max = Math.max(...values, 1);
  const step = width / Math.max(1, points.length - 1);
  return points
    .map((point, index) => {
      const x = index * step;
      const y = height - (getMetric(point, key) / max) * (height - 16) - 8;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function TrendChart({
  points,
  metric,
  label,
  tone = 'info'
}: {
  points: MetricSnapshotPoint[];
  metric: MetricKey;
  label: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  const width = 640;
  const height = 128;
  const line = buildPolyline(points, metric, width, height);
  const latest = points.length ? getMetric(points[points.length - 1], metric) : 0;
  const first = points.length ? getMetric(points[0], metric) : latest;
  const delta = latest - first;

  return (
    <article className={`trend-card tone-${tone}`}>
      <div className="trend-card-head">
        <span>
          <strong>{label}</strong>
          <small>{points.length ? `${points.length} точек` : 'нет истории'}</small>
        </span>
        <b>{latest}</b>
      </div>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Тренд: ${label}`}>
        <line x1="0" y1="32" x2={width} y2="32" />
        <line x1="0" y1="80" x2={width} y2="80" />
        {line ? <polyline points={line} /> : null}
      </svg>
      <div className="trend-foot">
        <span>{points[0] ? formatTimestamp(points[0].capturedAt) : 'ожидание снимка'}</span>
        <span className={delta > 0 ? 'success-text' : delta < 0 ? 'danger-text' : ''}>
          {delta > 0 ? '+' : ''}
          {delta}
        </span>
      </div>
    </article>
  );
}

export function StatsView({ overview, nodes, jobs, connected }: StatsViewProps) {
  const [range, setRange] = useState<MetricsRange>('24h');
  const [history, setHistory] = useState<MetricsHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPoint = useMemo(() => buildCurrentPoint(overview, nodes, jobs), [overview, nodes, jobs]);

  const loadHistory = async (nextRange = range) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiWithRetry<MetricsHistoryPayload>(`/metrics/history?range=${nextRange}`);
      setHistory(response);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить историю метрик.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory(range);
  }, [range]);

  const points = useMemo(() => {
    const rows = history?.points || [];
    if (!rows.length) return [currentPoint];
    const last = rows[rows.length - 1];
    if (last?.capturedAt === currentPoint.capturedAt) return rows;
    return [...rows, currentPoint].slice(-360);
  }, [currentPoint, history?.points]);

  const uptimePercent = currentPoint.nodeCount
    ? Math.round((currentPoint.onlineCount / currentPoint.nodeCount) * 100)
    : 0;

  return (
    <div className="page-stack">
      <section className="panel page-hero stats-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Статистика</h2>
            <span className="panel-caption">
              история трендов по флоту, корзинам, слотам, авариям и активным задачам
            </span>
          </div>

          <div className="toolbar-inline wrap">
            <span className={connected ? 'status-pill online' : 'status-pill offline'}>
              {connected ? 'realtime активен' : 'realtime reconnect'}
            </span>
            <div className="segmented-control" aria-label="Диапазон истории">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? 'active' : ''}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" className="icon-text-btn" onClick={() => void loadHistory()} disabled={loading}>
              <Clock3 size={16} />
              {loading ? 'Обновление' : 'Обновить'}
            </button>
          </div>
        </div>

        {error ? <div className="panel panel-danger">{error}</div> : null}

        <div className="kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label"><RadioTower size={14} /> Онлайн</span>
            <strong className="kpi-value">{currentPoint.onlineCount}/{currentPoint.nodeCount}</strong>
            <span className="kpi-sub">{uptimePercent}% узлов с живым heartbeat</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label"><ShoppingCart size={14} /> Корзины</span>
            <strong className="kpi-value">{currentPoint.paymentCount}</strong>
            <span className="kpi-sub">hold {currentPoint.holdCount} / checkout {currentPoint.checkoutCount}</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label"><CircleCheck size={14} /> Слоты</span>
            <strong className="kpi-value">{currentPoint.activeSlotCount}</strong>
            <span className="kpi-sub">активные operator-state слоты</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label"><AlertTriangle size={14} /> Проблемы</span>
            <strong className="kpi-value">{currentPoint.problemCount}</strong>
            <span className="kpi-sub">drift {currentPoint.diagnosticNoiseCount}</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label"><Activity size={14} /> Jobs</span>
            <strong className="kpi-value">{currentPoint.runningJobCount}</strong>
            <span className="kpi-sub">queued/running сейчас</span>
          </article>
        </div>
      </section>

      <section className="trend-grid">
        <TrendChart points={points} metric="onlineCount" label="Онлайн узлы" tone="success" />
        <TrendChart points={points} metric="activeSlotCount" label="Активные слоты" tone="info" />
        <TrendChart points={points} metric="paymentCount" label="Корзины" tone="success" />
        <TrendChart points={points} metric="problemCount" label="Аварии" tone="danger" />
        <TrendChart points={points} metric="diagnosticNoiseCount" label="Drift" tone="warning" />
        <TrendChart points={points} metric="runningJobCount" label="Активные jobs" tone="info" />
      </section>
    </div>
  );
}
