import { Activity, ShieldAlert } from 'lucide-react';
import type { NodeRecord } from '@/types';
import { cx, formatNodeLabel, formatNodeStatus, formatRelativeSeconds, isActionableNode } from '@/lib/format';

interface NodeTileProps {
  node: NodeRecord;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

export function NodeTile({ node, selected, compact, onClick }: NodeTileProps) {
  const isOnline = node.status === 'online';
  const hasIssue = !!node.primaryIssue;
  const isBusy = node.bot_status === 'running';

  return (
    <div
      className={cx('node-tile', selected && 'active', !isOnline && 'offline')}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '12px' : '20px',
        padding: compact ? '20px' : '32px',
        border: 'var(--border-width) solid var(--border)',
        boxShadow: selected ? 'var(--shadow-accent)' : 'var(--shadow)',
        transform: selected ? 'translate(-4px, -4px)' : 'none'
      }}
    >
      <div className="node-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 className="node-title" style={{ fontSize: compact ? '1.2rem' : '1.8rem', margin: 0 }}>
            {formatNodeLabel(node.id)}
          </h3>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', opacity: 0.6, margin: 0 }}>
            {node.ip}
          </p>
        </div>
        <div className={cx('status-badge', isOnline ? 'tone-success' : 'tone-danger')}>
          {isOnline ? 'ON' : 'OFF'}
        </div>
      </div>

      {!compact && (
        <div className="node-stats" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', opacity: 0.6 }}>Состояние</span>
            <b style={{ fontSize: '0.85rem' }}>{formatNodeStatus(node.status)}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', opacity: 0.6 }}>Пульс</span>
            <b style={{ fontSize: '0.85rem' }}>{formatRelativeSeconds(node.heartbeatAgeSec)}</b>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {isBusy && <span className="status-badge tone-success" style={{ fontSize: '0.65rem' }}>RUNNING</span>}
        {hasIssue && <span className="status-badge tone-danger" style={{ fontSize: '0.65rem' }}>ISSUE</span>}
        {isActionableNode(node) && <span className="status-badge tone-warning" style={{ fontSize: '0.65rem' }}>CART</span>}
      </div>

      {hasIssue && !compact && (
        <div style={{ display: 'flex', gap: '8px', color: 'var(--red)', fontSize: '0.8rem', fontWeight: 900 }}>
          <ShieldAlert size={14} />
          <span>{node.primaryIssue?.summary}</span>
        </div>
      )}
    </div>
  );
}
