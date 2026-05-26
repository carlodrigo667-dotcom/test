import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, apiWithRetry } from '@/lib/api';
import {
  formatBotStatus,
  formatCartState,
  formatConfidence,
  formatEventType,
  formatIssueSummary,
  formatLogSource,
  formatMismatchFlags,
  formatMode,
  formatNodeStatus,
  formatProcessState,
  formatRelativeSeconds,
  formatSlotLabel,
  formatTimestamp,
  getCartState,
  getNodeSlot,
  getRuntimeConfirmed,
  getStateConfidence,
  localizeAlertMessage,
  maskSecret,
  sanitizeDataForDisplay
} from '@/lib/format';
import { useLogStream } from '@/hooks/useLogStream';
import { LogConsole } from '@/components/LogConsole';
import type { CommandKind, NodeRecord, WorkstationPayload } from '@/types';

interface WorkstationViewProps {
  connected: boolean;
  nodeId: number | null;
  liveNode?: NodeRecord | null;
  socket: Socket | null;
  onCommand: (command: CommandKind, nodeIds: number[]) => Promise<void>;
}

export function WorkstationView({ connected, nodeId, liveNode, socket, onCommand }: WorkstationViewProps) {
  const [payload, setPayload] = useState<WorkstationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  const loadWorkstation = async (targetNodeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiWithRetry<WorkstationPayload>(`/workstation/${targetNodeId}`);
      setPayload(next);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить рабочую станцию.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!nodeId) return;
    void loadWorkstation(nodeId);
  }, [nodeId, connected]);

  useEffect(() => {
    if (!liveNode) return;
    setPayload((current) => (current ? { ...current, node: liveNode } : current));
  }, [liveNode]);

  const { snapshot, meta, error: logError } = useLogStream({
    socket,
    nodeId,
    enabled: !!nodeId,
    seed: payload?.logs
  });

  if (!nodeId) {
    return <div className="empty-state">Выберите узел в сетке, чтобы открыть рабочую станцию.</div>;
  }

  const node = liveNode || payload?.node;
  const session = payload?.session;
  const cartState = node ? getCartState(node) : null;
  const confidence = node ? getStateConfidence(node) : null;
  const runtimeConfirmed = node ? getRuntimeConfirmed(node) : false;
  const issues = payload?.issues || [];
  const noiseIssues = payload?.noiseIssues || [];
  const effectiveLogMeta = meta || payload?.logMeta || null;
  const displayDesired = payload?.desired ? sanitizeDataForDisplay(payload.desired, { collapseProxySets: true }) : {};
  const displayRuntime = payload?.runtime ? sanitizeDataForDisplay(payload.runtime, { collapseProxySets: true }) : {};
  const displayOverride = payload?.override ? sanitizeDataForDisplay(payload.override, { collapseProxySets: true }) : {};

  const attachSession = async () => {
    if (!nodeId) return;
    setSessionBusy(true);
    try {
      const response = await api<{ ok: boolean; session: WorkstationPayload['session'] }>(`/workstation/${nodeId}/attach`, {
        method: 'POST'
      });
      setPayload((current) => (current ? { ...current, session: response.session } : current));
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось подключить noVNC.');
    } finally {
      setSessionBusy(false);
    }
  };

  const openSessionInNewTab = async () => {
    if (!nodeId) return;
    setSessionBusy(true);
    setError(null);

    try {
      let nextSession = payload?.session || null;

      if (!nextSession?.iframeUrl) {
        const response = await api<{ ok: boolean; session: WorkstationPayload['session'] }>(`/workstation/${nodeId}/attach`, {
          method: 'POST'
        });
        nextSession = response.session || null;
        setPayload((current) => (current ? { ...current, session: nextSession } : current));
      }

      if (!nextSession?.iframeUrl) {
        throw new Error('Не удалось получить ссылку noVNC для новой вкладки.');
      }

      const opened = window.open(nextSession.iframeUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        throw new Error('Браузер заблокировал новую вкладку noVNC.');
      }
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось открыть noVNC в новой вкладке.');
    } finally {
      setSessionBusy(false);
    }
  };

  const runNodeCommand = async (command: CommandKind) => {
    if (!nodeId) return;
    await onCommand(command, [nodeId]);
    await loadWorkstation(nodeId);
  };

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Рабочая станция</h2>
            <span className="panel-caption">
              узел {nodeId} / {node?.ip || 'ожидание'} / {formatMode(node?.displayMode || payload?.runtime?.runtimeMode || 'group')}
            </span>
          </div>

          <div className="toolbar-inline wrap">
            <button type="button" className="ghost-btn" onClick={() => void runNodeCommand('start')}>
              Старт
            </button>
            <button type="button" className="ghost-btn" onClick={() => void runNodeCommand('restart')}>
              Рестарт
            </button>
            <button type="button" className="ghost-btn danger" onClick={() => void runNodeCommand('stop')}>
              Стоп
            </button>
            <button type="button" className="ghost-btn accent" onClick={() => void runNodeCommand('pay')}>
              Оплата
            </button>
            <button type="button" className="ghost-btn" onClick={() => void runNodeCommand('deploy')}>
              Деплой
            </button>
            <button type="button" className="ghost-btn" onClick={() => void runNodeCommand('sidecar-sync')}>
              Синхр. сайдкар
            </button>
            <button type="button" className="ghost-btn" onClick={() => void loadWorkstation(nodeId)}>
              Обновить
            </button>
          </div>
        </div>

        <div className="meta-strip">
          <span className="chip tone-muted">статус: {formatNodeStatus(node?.status)}</span>
          <span className="chip tone-muted">бот: {formatBotStatus(node?.bot_status)}</span>
          <span className="chip tone-muted">корзина: {formatCartState(cartState)}</span>
          <span className="chip tone-muted">слот: {formatSlotLabel(getNodeSlot(node || ({} as NodeRecord)))}</span>
          <span className="chip tone-muted">пульс: {formatRelativeSeconds(node?.heartbeatAgeSec)}</span>
          {confidence ? <span className="chip tone-muted">состояние: {formatConfidence(confidence)}</span> : null}
          <span className={runtimeConfirmed ? 'chip tone-success' : 'chip tone-warning'}>
            {runtimeConfirmed ? 'runtime подтвержден' : 'runtime не сошелся'}
          </span>
          {node?.last_error ? <span className="chip tone-warning">{localizeAlertMessage(node.last_error, node.id)}</span> : null}
        </div>
      </section>

      {error ? <div className="panel panel-danger">{error}</div> : null}
      {loading && !payload ? <div className="panel">Загрузка рабочей станции...</div> : null}

      <section className="workstation-grid">
        <LogConsole lines={snapshot.lines} meta={effectiveLogMeta} error={logError} />

        <section className="panel panel-vnc">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Встроенный noVNC</h3>
              <span className="panel-caption">
                {node?.capabilities?.supportsVnc ? 'постоянная сессия' : 'узел без графики'}
              </span>
            </div>
            {node?.capabilities?.supportsVnc ? (
              <button type="button" className="ghost-btn" disabled={sessionBusy} onClick={() => void openSessionInNewTab()}>
                {sessionBusy ? 'Подготовка...' : 'Открыть в новом окне'}
              </button>
            ) : null}
          </div>

          {node?.capabilities?.supportsVnc ? (
            session?.iframeUrl ? (
              <div className="vnc-stage">
                <iframe
                  title={`noVNC node ${nodeId}`}
                  className="vnc-frame"
                  src={session.iframeUrl}
                  allow="clipboard-read; clipboard-write"
                />
              </div>
            ) : (
              <div className="empty-state">
                <p>Теплая noVNC-сессия еще не подключена.</p>
                <button type="button" className="primary-btn" disabled={sessionBusy} onClick={() => void attachSession()}>
                  {sessionBusy ? 'Подключение...' : 'Подключить noVNC'}
                </button>
                <button type="button" className="ghost-btn" disabled={sessionBusy} onClick={() => void openSessionInNewTab()}>
                  {sessionBusy ? 'Подготовка...' : 'Открыть в новом окне'}
                </button>
              </div>
            )
          ) : (
            <div className="empty-state">
              <p>Этот узел помечен как узел без графики. Здесь доступны логи и телеметрия.</p>
              <div className="stacked-meta">
                <span className="chip tone-muted">режим: {formatMode(payload?.runtime?.runtimeMode || 'group')}</span>
                <span className="chip tone-muted">окно: {payload?.desired?.window || 'нет'}</span>
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="inspector-grid workstation-inspector-grid">
        <article className="panel workstation-drift-panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Дрейф конфигурации</h3>
              <span className="panel-caption">ожидаемое состояние против живого и переопределенного</span>
            </div>
          </div>

          {node?.derivedState?.mismatchFlags?.length ? (
            <div className="panel panel-warning">
              {formatMismatchFlags(node.derivedState.mismatchFlags)}
            </div>
          ) : null}

          <div className="triple-json">
            <div>
              <span className="section-label">ожидаемое</span>
              <pre className="json-block">{JSON.stringify(displayDesired, null, 2)}</pre>
            </div>
            <div>
              <span className="section-label">живое</span>
              <pre className="json-block">{JSON.stringify(displayRuntime, null, 2)}</pre>
            </div>
            <div>
              <span className="section-label">переопределение</span>
              <pre className="json-block">{JSON.stringify(displayOverride, null, 2)}</pre>
            </div>
          </div>

          {noiseIssues.length > 0 ? (
            <div className="panel-subsection">
              <div className="section-label">Вторичный шум</div>
              <div className="list-stack">
                {noiseIssues.map((issue) => (
                  <div key={`noise-${issue.code}`} className="list-row">
                    <span className="list-row-key">{issue.label}</span>
                    <span className="list-row-main">{formatIssueSummary(issue)}</span>
                    <span className="list-row-aside">{formatTimestamp(issue.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Проблемы узла</h3>
              <span className="panel-caption">нормализованная диагностика для выбранного узла</span>
            </div>
          </div>

          <div className="list-stack">
            {issues.length === 0 ? (
              <div className="empty-state compact">Для этого узла сервер не видит отдельной проблемы.</div>
            ) : (
              issues.map((issue) => (
                <div key={issue.code} className="list-row">
                  <span className="list-row-key">{issue.label}</span>
                  <span className="list-row-main">{formatIssueSummary(issue)}</span>
                  <span className="list-row-aside">{localizeAlertMessage(issue.evidence, nodeId)}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Последние события</h3>
              <span className="panel-caption">30 последних локальных событий узла</span>
            </div>
          </div>

          <div className="list-stack">
            {(payload?.recentEvents || []).length === 0 ? (
              <div className="empty-state compact">У этого узла пока нет событий.</div>
            ) : (
              payload?.recentEvents.map((event) => (
                <div key={event.id} className="list-row">
                  <span className="list-row-key">{formatEventType(event.type)}</span>
                  <span className="list-row-main">{localizeAlertMessage(event.message, event.node_id || nodeId)}</span>
                  <span className="list-row-aside">{formatTimestamp(event.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-toolbar">
            <div className="panel-title-block">
              <h3>Состояние сессии</h3>
              <span className="panel-caption">VNC, источник логов и служебные метрики</span>
            </div>
          </div>

          <div className="list-stack">
            <div className="list-row">
              <span className="list-row-key">сессия</span>
              <span className="list-row-main">{session?.warm ? 'теплая' : 'холодная'}</span>
              <span className="list-row-aside">{session?.healthy ? 'здоровая' : 'не готова'}</span>
            </div>
            <div className="list-row">
              <span className="list-row-key">источник</span>
              <span className="list-row-main">{formatLogSource(effectiveLogMeta?.source)}</span>
              <span className="list-row-aside">{formatProcessState(effectiveLogMeta?.processState)}</span>
            </div>
            <div className="list-row">
              <span className="list-row-key">порты</span>
              <span className="list-row-main">ws {session?.wsPort || 'нет'}</span>
              <span className="list-row-aside">vnc {session?.vncPort || 'нет'}</span>
            </div>
            <div className="list-row">
              <span className="list-row-key">прокси</span>
              <span className="list-row-main">{node?.current_proxy ?? 'нет'}</span>
              <span className="list-row-aside">{maskSecret(node?.ip)}</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
