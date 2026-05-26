import { useEffect, useState } from 'react';
import { apiWithRetry } from '@/lib/api';
import { formatEventType, formatNodeLabel, formatTimestamp, localizeAlertMessage } from '@/lib/format';
import type { EventRecord, NodeRecord } from '@/types';

interface EventsViewProps {
  connected: boolean;
  nodes: NodeRecord[];
  onOpenNode: (nodeId: number) => void;
}

export function EventsView({ connected, nodes, onOpenNode }: EventsViewProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState('all');
  const [type, setType] = useState('');
  const [limit, setLimit] = useState('120');

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nodeId !== 'all') params.set('nodeId', nodeId);
      if (type.trim()) params.set('type', type.trim());
      params.set('limit', limit || '120');

      const next = await apiWithRetry<EventRecord[]>(`/events?${params.toString()}`);
      setEvents(next);
    } catch (nextError: any) {
      setError(nextError.message || 'Не удалось загрузить события.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [nodeId, type, limit, connected]);

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>События</h2>
            <span className="panel-caption">аудируемая активность флота, конфига и backend-процессов</span>
          </div>

          <div className="toolbar-inline wrap">
            <select className="select-input" value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="all">Все узлы</option>
              {nodes.map((node) => (
                <option key={node.id} value={String(node.id)}>
                  {formatNodeLabel(node.id)} / {node.ip}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="Фильтр по типу события"
            />
            <input
              className="text-input short"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="лимит"
            />
            <button type="button" className="ghost-btn" onClick={() => void loadEvents()}>
              Обновить
            </button>
          </div>
        </div>

        {error ? <div className="panel panel-danger">{error}</div> : null}
      </section>

      <section className="panel">
        <div className="simple-table">
          <div className="simple-table-row header">
            <span>Время</span>
            <span>Узел</span>
            <span>Тип</span>
            <span>Сообщение</span>
            <span>Действие</span>
          </div>
          {loading ? (
            <div className="empty-state">Загрузка событий...</div>
          ) : events.length === 0 ? (
            <div className="empty-state">По текущим фильтрам событий нет.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="simple-table-row">
                <span>{formatTimestamp(event.created_at)}</span>
                <span>{event.node_id ? formatNodeLabel(event.node_id) : 'Флот'}</span>
                <span>{formatEventType(event.type)}</span>
                <span>{localizeAlertMessage(event.message, event.node_id)}</span>
                <span className="row-actions-inline">
                  {event.node_id ? (
                    <button type="button" className="mini-btn" onClick={() => onOpenNode(event.node_id as number)}>
                      Станция
                    </button>
                  ) : (
                    <span className="muted-inline">—</span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
