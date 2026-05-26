import { useEffect, useState } from 'react';
import { apiWithRetry } from '@/lib/api';
import {
  formatIssueLabel,
  formatModeSegment,
  formatNodeLabel,
  formatRelativeSeconds,
  formatTimestamp,
  getIssueTone,
  localizeAlertMessage
} from '@/lib/format';
import type { IssuesOverviewPayload } from '@/types';

interface ProblemsViewProps {
  connected: boolean;
  onOpenNode: (nodeId: number) => void;
  onOpenLogs: (nodeId?: number | null) => void;
}

export function ProblemsView({ connected, onOpenNode, onOpenLogs }: ProblemsViewProps) {
  const [payload, setPayload] = useState<IssuesOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProblems = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiWithRetry<IssuesOverviewPayload>(`/issues/overview${refresh ? '?refresh=1' : ''}`);
      setPayload(next);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить диагностику ботов.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProblems();
  }, [connected]);

  const groups = payload?.groups || [];
  const affectedNodes = payload?.nodes?.filter((node) => node.primaryIssue) || [];

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Проблемы ботов</h2>
            <span className="panel-caption">
              корневые причины по всему кластеру без чтения каждого лога вручную
            </span>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void loadProblems(true)}>
            Обновить диагностику
          </button>
        </div>

        <div className="kpi-grid compact-kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">Проблемных узлов</span>
            <strong className="kpi-value">{affectedNodes.length}</strong>
            <span className="kpi-sub">из тех, кто требует внимания сейчас</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Групп причин</span>
            <strong className="kpi-value">{groups.length}</strong>
            <span className="kpi-sub">нормализованные типы причин</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Обновлено</span>
            <strong className="kpi-value kpi-value-small">{formatTimestamp(payload?.updatedAt)}</strong>
            <span className="kpi-sub">последний серверный проход</span>
          </article>
        </div>
      </section>

      {error ? <div className="panel panel-danger">{error}</div> : null}

      <section className="problem-grid">
        {loading && !payload ? (
          <div className="panel">Загрузка проблем ботов...</div>
        ) : groups.length === 0 ? (
          <div className="panel empty-state">Сейчас сервер не видит критичных проблем у ботов.</div>
        ) : (
          groups.map((group) => (
            <article key={group.code} className={`panel issue-panel tone-${getIssueTone(group)}`}>
              <div className="panel-toolbar">
                <div className="panel-title-block">
                  <h3>{formatIssueLabel(group.code)}</h3>
                  <span className="panel-caption">
                    {group.count} узл. • обновлено {formatTimestamp(group.updatedAt)}
                  </span>
                </div>
                <span className={`status-pill ${group.severity}`}>{group.count}</span>
              </div>

              <div className="issue-proof">{localizeAlertMessage(group.lastEvidence)}</div>

              <div className="list-stack">
                {group.nodes.map((node) => (
                  <div key={`${group.code}-${node.nodeId}`} className="list-row list-row-multi">
                    <div className="list-row-main-block">
                      <span className="list-row-key">{formatNodeLabel(node.nodeId)}</span>
                      <span className="list-row-main">{node.summary}</span>
                      <span className="list-row-sub">
                        {node.ip} • {formatModeSegment(node.displayMode)} • пульс {formatRelativeSeconds(node.heartbeatAgeSec)}
                      </span>
                    </div>
                    <div className="list-row-actions">
                      <button type="button" className="mini-btn" onClick={() => onOpenNode(node.nodeId)}>
                        Станция
                      </button>
                      <button type="button" className="mini-btn" onClick={() => onOpenLogs(node.nodeId)}>
                        Логи
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
