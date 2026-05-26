import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import type { CommandKind, NodeRecord } from '@/types';
import { NodeTile } from '@/components/NodeTile';
import {
  formatMode,
  getNodeMode,
  getNodeSlot,
  isActionableNode,
  isDisputedNode
} from '@/lib/format';

interface FleetViewProps {
  nodes: NodeRecord[];
  onOpenNode: (nodeId: number) => void;
  onCommand: (command: CommandKind, nodeIds: number[]) => Promise<void>;
}

export function FleetView({ nodes, onOpenNode, onCommand }: FleetViewProps) {
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | 'online' | 'attention' | 'carted' | 'offline' | 'disputed'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'group' | 'underground'>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<'all' | 'graphical' | 'headless'>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [compactFleet, setCompactFleet] = useState(true);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (deferredSearch) {
        const haystack = [
          String(node.id),
          node.ip,
          node.bot_status,
          node.status,
          getNodeSlot(node),
          node.displayMode,
          node.primaryIssue?.code,
          node.primaryIssue?.summary
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(deferredSearch)) return false;
      }

      if (healthFilter === 'online' && node.status !== 'online') return false;
      if (healthFilter === 'attention' && !node.primaryIssue) return false;
      if (healthFilter === 'carted' && !isActionableNode(node)) return false;
      if (healthFilter === 'offline' && node.status === 'online') return false;
      if (healthFilter === 'disputed' && !isDisputedNode(node)) return false;
      if (modeFilter !== 'all' && getNodeMode(node) !== modeFilter) return false;
      if (capabilityFilter === 'graphical' && !node.capabilities.graphical) return false;
      if (capabilityFilter === 'headless' && !node.capabilities.headless) return false;

      return true;
    });
  }, [nodes, deferredSearch, healthFilter, modeFilter, capabilityFilter]);

  const toggleNode = (nodeId: number) => {
    startTransition(() => {
      setSelectedIds((current) =>
        current.includes(nodeId)
          ? current.filter((value) => value !== nodeId)
          : [...current, nodeId]
      );
    });
  };

  const selectFiltered = () => {
    startTransition(() => {
      setSelectedIds(filteredNodes.map((node) => node.id));
    });
  };

  const runBatch = async (command: CommandKind) => {
    if (selectedIds.length === 0) return;
    await onCommand(command, selectedIds);
  };

  const groupCount = nodes.filter((node) => getNodeMode(node) !== 'underground').length;
  const undergroundCount = nodes.filter((node) => getNodeMode(node) === 'underground').length;
  const liveCartCount = nodes.filter((node) => isActionableNode(node)).length;
  const disputedCount = nodes.filter((node) => isDisputedNode(node)).length;

  return (
    <div className="page-stack">
      <section className="panel page-hero">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>Флот</h2>
            <span className="panel-caption">
              единая сетка узлов, где карточки и фильтры читают только server-side operator-state
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
              {formatMode('group')} {groupCount}
            </button>
            <button
              type="button"
              className={modeFilter === 'underground' ? 'mini-btn accent' : 'mini-btn'}
              onClick={() => setModeFilter('underground')}
            >
              {formatMode('underground')} {undergroundCount}
            </button>
          </div>
        </div>

        <div className="toolbar-inline wrap toolbar-block">
          <input
            className="search-input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск: узел / IP / слот / режим / проблема"
          />
          <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as any)} className="select-input">
            <option value="all">Все по состоянию</option>
            <option value="online">Онлайн</option>
            <option value="attention">Аварии</option>
            <option value="carted">Живые корзины</option>
            <option value="disputed">Спорные</option>
            <option value="offline">Офлайн</option>
          </select>
          <select value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value as any)} className="select-input">
            <option value="all">Все роли</option>
            <option value="graphical">С графикой</option>
            <option value="headless">Без графики</option>
          </select>
        </div>

        <div className="toolbar-inline wrap">
          <span className="chip tone-muted">по фильтру: {filteredNodes.length}</span>
          <span className="chip tone-muted">выбрано: {selectedIds.length}</span>
          <span className="chip tone-muted">живые корзины: {liveCartCount}</span>
          <span className="chip tone-muted">спорные: {disputedCount}</span>
          <button type="button" className="ghost-btn" onClick={selectFiltered}>
            Выбрать отфильтрованные
          </button>
          <button type="button" className="ghost-btn" onClick={() => setSelectedIds([])}>
            Сбросить
          </button>
          <button type="button" className="ghost-btn" onClick={() => setCompactFleet((current) => !current)}>
            {compactFleet ? 'Полный вид' : 'Компактно'}
          </button>
          <button type="button" className="ghost-btn" disabled={!selectedIds.length} onClick={() => void runBatch('start')}>
            Старт
          </button>
          <button type="button" className="ghost-btn" disabled={!selectedIds.length} onClick={() => void runBatch('restart')}>
            Рестарт
          </button>
          <button type="button" className="ghost-btn" disabled={!selectedIds.length} onClick={() => void runBatch('deploy')}>
            Деплой
          </button>
          <button type="button" className="ghost-btn" disabled={!selectedIds.length} onClick={() => void runBatch('sidecar-sync')}>
            Синхр. сайдкар
          </button>
          <button type="button" className="ghost-btn danger" disabled={!selectedIds.length} onClick={() => void runBatch('stop')}>
            Стоп
          </button>
          <button type="button" className="ghost-btn accent" disabled={!selectedIds.length} onClick={() => void runBatch('pay')}>
            Оплата
          </button>
        </div>
      </section>

      <section className={compactFleet ? 'tile-grid fleet-grid fleet-grid-dense' : 'tile-grid fleet-grid'}>
        {filteredNodes.length === 0 ? (
          <div className="panel empty-state">По текущим фильтрам подходящих узлов нет.</div>
        ) : (
          filteredNodes.map((node) => (
            <NodeTile
              key={node.id}
              node={node}
              selected={selectedIds.includes(node.id)}
              compact={compactFleet}
              onToggleSelect={toggleNode}
              onOpen={onOpenNode}
              onCommand={(command, nodeId) => void onCommand(command, [nodeId])}
            />
          ))
        )}
      </section>
    </div>
  );
}
