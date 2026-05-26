import { useMemo, useState } from 'react';
import type { NodeRecord } from '@/types';
import {
  formatCartState,
  formatMode,
  formatModeSegment,
  formatNodeLabel,
  formatReleaseWindow,
  formatSlotDate,
  formatSlotTime,
  getCartState,
  getNodeMode,
  getNodeSlot,
  getTicketCount,
  isActionableNode
} from '@/lib/format';

interface SlotsViewProps {
  nodes: NodeRecord[];
  onOpenNode: (nodeId: number) => void;
  onNavigatePayment: () => void;
}

export function SlotsView({ nodes, onOpenNode, onNavigatePayment }: SlotsViewProps) {
  const [modeFilter, setModeFilter] = useState<'all' | 'group' | 'underground'>('all');

  const slotNodes = useMemo(() => {
    return nodes
      .filter((node) => getNodeSlot(node) && isActionableNode(node))
      .filter((node) => modeFilter === 'all' || getNodeMode(node) === modeFilter)
      .sort((left, right) => String(getNodeSlot(left) || '').localeCompare(String(getNodeSlot(right) || '')));
  }, [nodes, modeFilter]);

  const grouped = useMemo(() => {
    const buckets: Record<string, NodeRecord[]> = {};
    slotNodes.forEach((node) => {
      const slot = String(getNodeSlot(node) || '');
      const key = formatSlotDate(slot);
      buckets[key] = buckets[key] || [];
      buckets[key].push(node);
    });
    return buckets;
  }, [slotNodes]);

  const totalTickets = slotNodes.reduce((sum, node) => sum + getTicketCount(node), 0);
  const checkoutCount = slotNodes.filter((node) => getCartState(node) === 'checkout').length;
  const holdCount = slotNodes.filter((node) => getCartState(node) === 'hold').length;

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Слоты сейчас</h2>
            <span className="panel-caption">
              все удержания и переходы к оплате по времени, без открытия узлов по одному
            </span>
          </div>
          <div className="toolbar-inline wrap">
            <button
              type="button"
              className={modeFilter === 'all' ? 'mini-btn accent' : 'mini-btn'}
              onClick={() => setModeFilter('all')}
            >
              Все
            </button>
            <button
              type="button"
              className={modeFilter === 'group' ? 'mini-btn accent' : 'mini-btn'}
              onClick={() => setModeFilter('group')}
            >
              {formatMode('group')}
            </button>
            <button
              type="button"
              className={modeFilter === 'underground' ? 'mini-btn accent' : 'mini-btn'}
              onClick={() => setModeFilter('underground')}
            >
              {formatMode('underground')}
            </button>
            <button type="button" className="ghost-btn" onClick={onNavigatePayment}>
              Открыть оплату
            </button>
          </div>
        </div>

        <div className="kpi-grid compact-kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">Активных слотов</span>
            <strong className="kpi-value">{slotNodes.length}</strong>
            <span className="kpi-sub">узлы с подтвержденной корзиной</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Билетов</span>
            <strong className="kpi-value">{totalTickets}</strong>
            <span className="kpi-sub">суммарно в активных корзинах</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Удержание / Оплата</span>
            <strong className="kpi-value">{holdCount} / {checkoutCount}</strong>
            <span className="kpi-sub">распределение текущих состояний</span>
          </article>
        </div>
      </section>

      {slotNodes.length === 0 ? (
        <div className="panel empty-state">Сейчас нет активных удержаний или оплаты по выбранному сегменту.</div>
      ) : (
        Object.entries(grouped).map(([date, bucket]) => (
          <section key={date} className="panel">
            <div className="panel-toolbar">
              <div className="panel-title-block">
                <h3>{date}</h3>
                <span className="panel-caption">{bucket.length} слотов в этой дате</span>
              </div>
            </div>

            <div className="slot-grid">
              {bucket.map((node) => {
                const slot = String(getNodeSlot(node) || '');
                return (
                  <button
                    type="button"
                    key={node.id}
                    className="slot-card"
                    onClick={() => onOpenNode(node.id)}
                  >
                    <span className="slot-time">{formatSlotTime(slot)}</span>
                    <span className="slot-date">{date} · Рим</span>
                    <span className="slot-meta">
                      {formatNodeLabel(node.id)} • {formatModeSegment(getNodeMode(node))} • {getTicketCount(node)} бил.
                    </span>
                    <span className="slot-state">
                      {formatCartState(getCartState(node) || 'carted')} • возврат {formatReleaseWindow(node)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
