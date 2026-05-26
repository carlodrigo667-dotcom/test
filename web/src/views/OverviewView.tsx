import type { CommandKind, JobRecord, NodeRecord, OverviewPayload } from '@/types';
import {
  formatCartState,
  formatIssueLabel,
  formatNodeLabel,
  formatRelativeSeconds,
  formatSlotLabel,
  isActionableNode,
  isDisputedNode
} from '@/lib/format';
import { NodeTile } from '@/components/NodeTile';

interface OverviewViewProps {
  overview: OverviewPayload | null;
  nodes: NodeRecord[];
  jobs: JobRecord[];
  connected: boolean;
  onOpenNode: (nodeId: number) => void;
  onNavigate: (
    page: 'servers' | 'payment' | 'logs' | 'stats',
    nodeId?: number | null
  ) => void;
  onCommand: (command: CommandKind, nodeIds: number[]) => Promise<void>;
}

export function OverviewView({
  overview,
  nodes,
  jobs,
  connected,
  onOpenNode,
  onNavigate,
  onCommand
}: OverviewViewProps) {
  const online = nodes.filter((node) => node.status === 'online').length;
  const activeCartNodes = nodes.filter((node) => isActionableNode(node));
  const disputedNodes = nodes.filter((node) => isDisputedNode(node));
  const topProblems = overview?.topProblems || [];
  const runningJobs = jobs.filter((job) => ['queued', 'running'].includes(job.status));
  const hotNodes = nodes
    .filter((node) => node.primaryIssue || isActionableNode(node) || isDisputedNode(node))
    .slice(0, 6);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Мониторинг флота</p>
            <h2>Операторская сводка</h2>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
             <span className={connected ? 'status-badge tone-success' : 'status-badge tone-danger'}>
              {connected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        <div className="kpi-grid">
          <article className="kpi">
            <span className="eyebrow">Онлайн</span>
            <b>{online}/{nodes.length}</b>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>узлы с живым heartbeat</p>
          </article>
          <article className="kpi">
            <span className="eyebrow">Живые корзины</span>
            <b>{overview?.paymentCount ?? activeCartNodes.length}</b>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>удержание {overview?.holdCount ?? 0} / оплата {overview?.checkoutCount ?? 0}</p>
          </article>
          <article className="kpi">
            <span className="eyebrow">Активные слоты</span>
            <b>{overview?.activeSlotCount ?? 0}</b>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>подтверждённые слоты</p>
          </article>
          <article className="kpi">
            <span className="eyebrow">Аварии</span>
            <b style={{ color: 'var(--red)' }}>
              {Object.values(overview?.problemCounts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)}
            </b>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>operator-facing проблемы</p>
          </article>
        </div>
      </section>

      <div className="asymmetric-grid">
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
          <article className="panel">
            <div className="panel-head">
              <h3>Аварии первого уровня</h3>
              <button type="button" className="btn ghost" onClick={() => onNavigate('logs')}>
                Все логи
              </button>
            </div>

            <div className="list-stack">
              {topProblems.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', opacity: 0.5 }}>Проблем первого уровня не обнаружено.</div>
              ) : (
                topProblems.map((group) => (
                  <button
                    key={group.code}
                    type="button"
                    className="list-row interactive"
                    onClick={() => onNavigate('logs', group.nodes?.[0]?.nodeId || null)}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <span className="list-row-key" style={{ color: 'var(--red)' }}>{formatIssueLabel(group.code)}</span>
                    <span className="list-row-main">{group.lastEvidence || group.nodes?.[0]?.summary || 'Нужна проверка'}</span>
                    <span className="list-row-aside">{group.count} узл.</span>
                  </button>
                ))
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h3>Горячие узлы</h3>
            </div>
            <div className="node-grid" style={{ padding: '32px', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {hotNodes.map((node) => (
                <NodeTile
                  key={node.id}
                  node={node}
                  compact
                  onClick={() => onOpenNode(node.id)}
                />
              ))}
            </div>
          </article>
        </div>

        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
          <article className="panel">
            <div className="panel-head">
              <h3>Оплата</h3>
            </div>
            <div className="list-stack">
              {activeCartNodes.slice(0, 6).map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className="list-row interactive"
                  onClick={() => onNavigate('payment', node.id)}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <span className="list-row-key">{formatNodeLabel(node.id)}</span>
                  <span className="list-row-main">{formatSlotLabel(node.operatorState?.slot)}</span>
                  <span className="list-row-aside" style={{ color: 'var(--green)' }}>{formatCartState(node.operatorState?.cartState || 'idle')}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h3>Активные задачи</h3>
            </div>
            <div className="list-stack">
              {runningJobs.slice(0, 8).map((job) => (
                <div key={job.id} className="list-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="list-row-key">#{job.id}</span>
                  <span className="list-row-main">{job.title}</span>
                  <span className="list-row-aside">{job.status}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
