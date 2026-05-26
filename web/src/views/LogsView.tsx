import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { apiWithRetry } from '@/lib/api';
import {
  formatCartState,
  formatConfidence,
  formatEventType,
  formatIssueSummary,
  formatLogSource,
  formatMode,
  formatNodeLabel,
  formatProcessState,
  formatSeverityLabel,
  formatSlotLabel,
  formatTimestamp,
  getCartState,
  getNodeSlot,
  getNoiseIssues,
  getPrimaryIssue,
  getRuntimeConfirmed,
  getStateConfidence,
  isDisputedNode,
  localizeAlertMessage
} from '@/lib/format';
import { useLogStream } from '@/hooks/useLogStream';
import { LogConsole } from '@/components/LogConsole';
import type { EventRecord, IssuesOverviewPayload, NodeRecord, WorkstationPayload } from '@/types';

type DiagnosticsTab = 'tail' | 'issues' | 'events' | 'drift';

interface LogsViewProps {
  connected: boolean;
  nodes: NodeRecord[];
  socket: Socket | null;
  initialNodeId?: number | null;
  onOpenNode: (nodeId: number) => void;
}

function summarizeEvent(event: EventRecord) {
  return localizeAlertMessage(event.message, event.node_id || undefined);
}

export function LogsView({ connected, nodes, socket, initialNodeId, onOpenNode }: LogsViewProps) {
  const defaultNodeId = initialNodeId || nodes[0]?.id || null;
  const [nodeId, setNodeId] = useState<number | null>(defaultNodeId);
  const [payload, setPayload] = useState<WorkstationPayload | null>(null);
  const [issuesOverview, setIssuesOverview] = useState<IssuesOverviewPayload | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>('tail');
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodes.length) return;
    if (!nodeId || !nodes.some((node) => node.id === nodeId)) {
      setNodeId(initialNodeId || nodes[0].id);
    }
  }, [initialNodeId, nodeId, nodes]);

  const loadDiagnostics = async (forceIssues = false) => {
    setMetaLoading(true);
    try {
      const [nextIssues, nextEvents] = await Promise.all([
        apiWithRetry<IssuesOverviewPayload>(`/issues/overview${forceIssues ? '?refresh=1' : ''}`),
        apiWithRetry<EventRecord[]>('/events?limit=160')
      ]);
      setIssuesOverview(nextIssues);
      setEvents(nextEvents);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить диагностику.');
    } finally {
      setMetaLoading(false);
    }
  };

  const loadNode = async (targetNodeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiWithRetry<WorkstationPayload>(`/workstation/${targetNodeId}`);
      setPayload(next);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить лог-канал.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!nodeId) return;
    void loadNode(nodeId);
  }, [nodeId, connected]);

  useEffect(() => {
    void loadDiagnostics();
  }, [connected]);

  const { snapshot, meta, error: streamError } = useLogStream({
    socket,
    nodeId,
    enabled: !!nodeId,
    seed: payload?.logs || null
  });

  const activeNode = useMemo(
    () => nodes.find((node) => node.id === nodeId) || payload?.node || null,
    [nodeId, nodes, payload?.node]
  );

  const effectiveMeta = meta || payload?.logMeta || null;
  const primaryIssue = payload?.issues?.[0] || getPrimaryIssue(activeNode) || null;
  const noiseIssues = payload?.noiseIssues || getNoiseIssues(activeNode);
  const selectedIssueRow = useMemo(
    () => issuesOverview?.nodes.find((row) => row.nodeId === nodeId) || null,
    [issuesOverview?.nodes, nodeId]
  );
  const recentSelectedEvents = payload?.recentEvents || [];
  const globalProblemCount = useMemo(
    () => Object.values(issuesOverview?.problemCounts || {}).reduce((sum, value) => sum + value, 0),
    [issuesOverview?.problemCounts]
  );
  const globalNoiseCount = useMemo(
    () => Object.values(issuesOverview?.diagnosticNoiseCounts || {}).reduce((sum, value) => sum + value, 0),
    [issuesOverview?.diagnosticNoiseCounts]
  );
  const driftNodes = useMemo(() => {
    return nodes
      .filter((node) => isDisputedNode(node) || !getRuntimeConfirmed(node))
      .sort((left, right) => {
        const leftWeight = Number(isDisputedNode(left)) + Number(!getRuntimeConfirmed(left));
        const rightWeight = Number(isDisputedNode(right)) + Number(!getRuntimeConfirmed(right));
        return rightWeight - leftWeight || left.id - right.id;
      });
  }, [nodes]);

  const selectNode = (nextNodeId: number, nextTab: DiagnosticsTab = 'tail') => {
    setNodeId(nextNodeId);
    setActiveTab(nextTab);
  };

  const selectedNodeSlot = activeNode ? getNodeSlot(activeNode) : null;
  const selectedNodeCartState = activeNode ? getCartState(activeNode) : null;
  const selectedNodeConfidence = activeNode ? getStateConfidence(activeNode) : null;

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Логи и диагностика</h2>
            <span className="panel-caption">
              единый диагностический центр: живой хвост, операторские проблемы, шум и drift без разъезда по отдельным вкладкам сайта
            </span>
          </div>

          <div className="toolbar-inline wrap">
            <select
              className="select-input"
              value={nodeId || ''}
              onChange={(event) => setNodeId(Number(event.target.value))}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {formatNodeLabel(node.id)} / {node.ip}
                </option>
              ))}
            </select>
            <button type="button" className="ghost-btn" disabled={!nodeId} onClick={() => nodeId && onOpenNode(nodeId)}>
              Рабочая станция
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={loading || metaLoading || !nodeId}
              onClick={() => {
                if (!nodeId) return;
                void Promise.all([loadNode(nodeId), loadDiagnostics(true)]);
              }}
            >
              {loading || metaLoading ? 'Обновление...' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="kpi-grid compact-kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">Проблемы</span>
            <strong className="kpi-value">{globalProblemCount}</strong>
            <span className="kpi-sub">headline-ошибки, которые реально мешают работе флота</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Шум</span>
            <strong className="kpi-value">{globalNoiseCount}</strong>
            <span className="kpi-sub">drift, stale-log и прочие вторичные сигналы</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Drift</span>
            <strong className="kpi-value">{driftNodes.length}</strong>
            <span className="kpi-sub">узлы с mismatch, недосошедшимся runtime или шумовыми причинами</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Узел</span>
            <strong className="kpi-value kpi-value-small">{activeNode ? formatNodeLabel(activeNode.id) : 'нет'}</strong>
            <span className="kpi-sub">
              {primaryIssue ? primaryIssue.label : noiseIssues[0]?.label || 'отдельная проблема не выделена'}
            </span>
          </article>
        </div>

        <div className="meta-strip wrap">
          <span className="chip tone-muted">{activeNode ? activeNode.ip : 'узел не выбран'}</span>
          <span className="chip tone-muted">режим {formatMode(activeNode?.displayMode || payload?.runtime?.runtimeMode || 'group')}</span>
          <span className="chip tone-muted">корзина {formatCartState(selectedNodeCartState)}</span>
          <span className="chip tone-muted">слот {formatSlotLabel(selectedNodeSlot)}</span>
          {selectedNodeConfidence ? <span className="chip tone-muted">доверие {formatConfidence(selectedNodeConfidence)}</span> : null}
          <span className={getRuntimeConfirmed(activeNode || undefined) ? 'chip tone-success' : 'chip tone-warning'}>
            {getRuntimeConfirmed(activeNode || undefined) ? 'runtime подтверждён' : 'runtime не подтверждён'}
          </span>
          {primaryIssue ? <span className="chip tone-warning">{formatIssueSummary(primaryIssue)}</span> : null}
          {noiseIssues[0] ? <span className="chip tone-info">{formatIssueSummary(noiseIssues[0])}</span> : null}
        </div>
      </section>

      {error ? <div className="panel panel-danger">{error}</div> : null}

      <section className="logs-layout">
        <LogConsole lines={snapshot.lines} meta={effectiveMeta} error={streamError} />

        <article className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Проблемы</h3>
              <span className="panel-caption">
                выбранный узел, причины и последние события
              </span>
            </div>
          </div>

          <div className="tab-row">
            <button type="button" className={activeTab === 'tail' ? 'tab-btn active' : 'tab-btn'} onClick={() => setActiveTab('tail')}>
              Хвост
            </button>
            <button type="button" className={activeTab === 'issues' ? 'tab-btn active' : 'tab-btn'} onClick={() => setActiveTab('issues')}>
              Проблемы
            </button>
            <button type="button" className={activeTab === 'events' ? 'tab-btn active' : 'tab-btn'} onClick={() => setActiveTab('events')}>
              События
            </button>
            <button type="button" className={activeTab === 'drift' ? 'tab-btn active' : 'tab-btn'} onClick={() => setActiveTab('drift')}>
              Drift
            </button>
          </div>

          {activeTab === 'tail' ? (
            <div className="panel-stack">
              <div className="list-stack">
                <div className="list-row">
                  <span className="list-row-key">Узел</span>
                  <span className="list-row-main">{activeNode ? formatNodeLabel(activeNode.id) : 'нет'}</span>
                  <span className="list-row-aside">{activeNode?.ip || 'нет'}</span>
                </div>
                <div className="list-row">
                  <span className="list-row-key">Источник лога</span>
                  <span className="list-row-main">{formatLogSource(effectiveMeta?.source)}</span>
                  <span className="list-row-aside">{formatProcessState(effectiveMeta?.processState)}</span>
                </div>
                <div className="list-row">
                  <span className="list-row-key">Обновлено</span>
                  <span className="list-row-main">{formatTimestamp(payload?.logMeta?.mtimeMs || payload?.logMeta?.updatedAt)}</span>
                  <span className="list-row-aside">{metaLoading ? 'диагностика обновляется' : 'актуальный снимок'}</span>
                </div>
                <div className="list-row">
                  <span className="list-row-key">Главная причина</span>
                  <span className="list-row-main">{primaryIssue ? primaryIssue.label : 'не выделена'}</span>
                  <span className="list-row-aside">{formatSeverityLabel(primaryIssue?.severity || 'info')}</span>
                </div>
                <div className="list-row">
                  <span className="list-row-key">Доказательство</span>
                  <span className="list-row-main">
                    {primaryIssue?.evidence || noiseIssues[0]?.evidence || localizeAlertMessage(activeNode?.last_error, activeNode?.id) || 'нет'}
                  </span>
                  <span className="list-row-aside">{formatTimestamp(primaryIssue?.updatedAt || noiseIssues[0]?.updatedAt || activeNode?.last_heartbeat)}</span>
                </div>
              </div>

              <div className="panel-subsection">
                <div className="section-label">Последние события выбранного узла</div>
                <div className="list-stack">
                  {recentSelectedEvents.length === 0 ? (
                    <div className="empty-state compact">Для этого узла пока нет локальных событий.</div>
                  ) : (
                    recentSelectedEvents.slice(0, 10).map((event) => (
                      <div key={event.id} className="list-row">
                        <span className="list-row-key">{formatEventType(event.type)}</span>
                        <span className="list-row-main">{summarizeEvent(event)}</span>
                        <span className="list-row-aside">{formatTimestamp(event.created_at)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'issues' ? (
            <div className="panel-stack">
              <div className="panel-subsection">
              <div className="section-label">Проблемы</div>
                <div className="list-stack">
                  {(issuesOverview?.groups || []).length === 0 ? (
                    <div className="empty-state compact">Сервер сейчас не видит headline-проблем по флоту.</div>
                  ) : (
                    issuesOverview?.groups.map((group) => (
                      <div key={group.code} className="list-row">
                        <div className="list-row-main-block">
                          <span className="list-row-key">{group.label}</span>
                          <span className="list-row-main">{group.count} узл.</span>
                          <span className="list-row-sub">{group.lastEvidence}</span>
                          <div className="badge-row">
                            {group.nodes.slice(0, 5).map((node) => (
                              <button
                                key={`${group.code}-${node.nodeId}`}
                                type="button"
                                className="badge tone-warning"
                                onClick={() => selectNode(node.nodeId, 'tail')}
                              >
                                {formatNodeLabel(node.nodeId)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <span className="list-row-aside">
                          {formatSeverityLabel(group.severity)}
                          <br />
                          {formatTimestamp(group.updatedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="panel-subsection">
                <div className="section-label">Диагностический шум</div>
                <div className="list-stack">
                  {(issuesOverview?.noiseGroups || []).length === 0 ? (
                    <div className="empty-state compact">Шумовые причины сейчас не доминируют.</div>
                  ) : (
                    issuesOverview?.noiseGroups.map((group) => (
                      <div key={group.code} className="list-row">
                        <div className="list-row-main-block">
                          <span className="list-row-key">{group.label}</span>
                          <span className="list-row-main">{group.count} узл.</span>
                          <span className="list-row-sub">{group.lastEvidence}</span>
                          <div className="badge-row">
                            {group.nodes.slice(0, 5).map((node) => (
                              <button
                                key={`${group.code}-${node.nodeId}`}
                                type="button"
                                className="badge tone-info"
                                onClick={() => selectNode(node.nodeId, 'drift')}
                              >
                                {formatNodeLabel(node.nodeId)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <span className="list-row-aside">
                          {formatSeverityLabel(group.severity)}
                          <br />
                          {formatTimestamp(group.updatedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'events' ? (
            <div className="panel-subsection">
              <div className="section-label">Последние события флота</div>
              <div className="list-stack">
                {events.length === 0 ? (
                  <div className="empty-state compact">Пока нет событий для отображения.</div>
                ) : (
                  events.slice(0, 24).map((event) => (
                    <div key={event.id} className="list-row interactive" onClick={() => event.node_id && selectNode(event.node_id, 'tail')}>
                      <div className="list-row-main-block">
                        <span className="list-row-key">{formatEventType(event.type)}</span>
                        <span className="list-row-main">{summarizeEvent(event)}</span>
                        <span className="list-row-sub">
                          {event.node_id ? formatNodeLabel(event.node_id) : 'системное событие'}
                        </span>
                      </div>
                      <span className="list-row-aside">{formatTimestamp(event.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeTab === 'drift' ? (
            <div className="panel-stack">
              <div className="panel-subsection">
                <div className="section-label">Узлы с drift и спорным состоянием</div>
                <div className="list-stack">
                  {driftNodes.length === 0 ? (
                    <div className="empty-state compact">Сейчас нет узлов со спорным состоянием.</div>
                  ) : (
                    driftNodes.slice(0, 28).map((node) => {
                      const nodePrimaryIssue = getPrimaryIssue(node);
                      const nodeNoiseIssues = getNoiseIssues(node);
                      return (
                        <div key={node.id} className="list-row interactive" onClick={() => selectNode(node.id, 'tail')}>
                          <div className="list-row-main-block">
                            <span className="list-row-key">{formatNodeLabel(node.id)}</span>
                            <span className="list-row-main">
                              {formatCartState(getCartState(node))} / {formatSlotLabel(getNodeSlot(node))}
                            </span>
                            <span className="list-row-sub">
                              {nodePrimaryIssue?.summary || nodeNoiseIssues[0]?.summary || 'runtime и лог расходятся'}
                            </span>
                          </div>
                          <span className="list-row-aside">
                            {formatConfidence(getStateConfidence(node))}
                            <br />
                            {getRuntimeConfirmed(node) ? 'runtime ok' : 'runtime drift'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedIssueRow ? (
                <div className="panel-subsection">
                  <div className="section-label">Снимок выбранного узла</div>
                  <div className="list-stack">
                    <div className="list-row">
                      <span className="list-row-key">Коды причин</span>
                      <span className="list-row-main">{selectedIssueRow.issueCodes.join(', ') || 'нет'}</span>
                      <span className="list-row-aside">{selectedIssueRow.confidence || 'нет'}</span>
                    </div>
                    <div className="list-row">
                      <span className="list-row-key">Спорные флаги</span>
                      <span className="list-row-main">{(selectedIssueRow.mismatchFlags || []).join(', ') || 'нет'}</span>
                      <span className="list-row-aside">{formatTimestamp(selectedIssueRow.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
