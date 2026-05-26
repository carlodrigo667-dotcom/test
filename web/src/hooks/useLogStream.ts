import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { LogEntry, LogSnapshot } from '@/types';

const EMPTY_SNAPSHOT: LogSnapshot = {
  nodeId: 0,
  seq: 0,
  cursor: 0,
  updatedAt: null,
  lines: []
};

function mergeEntries(left: LogEntry[], right: LogEntry[]) {
  const bySeq = new Map<number, LogEntry>();
  left.forEach((entry) => bySeq.set(entry.seq, entry));
  right.forEach((entry) => bySeq.set(entry.seq, entry));
  return Array.from(bySeq.values())
    .sort((a, b) => a.seq - b.seq)
    .slice(-1800);
}

interface UseLogStreamOptions {
  socket: Socket | null;
  nodeId: number | null;
  enabled: boolean;
  seed?: LogSnapshot | null;
}

export function useLogStream({ socket, nodeId, enabled, seed }: UseLogStreamOptions) {
  const [snapshot, setSnapshot] = useState<LogSnapshot>(seed || EMPTY_SNAPSHOT);
  const [meta, setMeta] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    setSnapshot(seed || {
      ...EMPTY_SNAPSHOT,
      nodeId: nodeId || 0
    });
    setMeta(null);
    setError(null);
  }, [nodeId, seed?.seq, seed?.cursor]);

  useEffect(() => {
    seqRef.current = snapshot.seq || 0;
  }, [snapshot.seq]);

  useEffect(() => {
    if (!socket || !nodeId || !enabled) return;

    const subscribe = () => {
      socket.emit('logs:subscribe', {
        nodeId,
        afterSeq: seqRef.current
      });
    };

    const handleSnapshot = (next: LogSnapshot) => {
      if (!next || next.nodeId !== nodeId) return;
      setSnapshot((current) => ({
        nodeId,
        seq: Math.max(current.seq || 0, next.seq || 0),
        cursor: next.cursor ?? current.cursor,
        updatedAt: next.updatedAt || current.updatedAt,
        lines: mergeEntries(current.lines || [], next.lines || [])
      }));
    };

    const handleChunk = (chunk: { nodeId: number; seqEnd: number; cursor?: number; updatedAt?: string; lines: string[] }) => {
      if (!chunk || chunk.nodeId !== nodeId) return;
      setSnapshot((current) => {
        const baseSeq = chunk.seqEnd - (chunk.lines?.length || 0) + 1;
        const nextLines = (chunk.lines || []).map((line, index) => ({
          seq: baseSeq + index,
          line,
          ts: chunk.updatedAt
        }));

        return {
          nodeId,
          seq: Math.max(current.seq || 0, chunk.seqEnd || 0),
          cursor: chunk.cursor ?? current.cursor,
          updatedAt: chunk.updatedAt || current.updatedAt,
          lines: mergeEntries(current.lines || [], nextLines)
        };
      });
    };

    const handleMeta = (payload: { nodeId: number; error?: string; meta?: Record<string, any> }) => {
      if (!payload || payload.nodeId !== nodeId) return;
      setMeta(payload.meta || null);
      setError(payload.error || null);
    };

    socket.on('connect', subscribe);
    socket.on('logs:snapshot', handleSnapshot);
    socket.on('logs:chunk', handleChunk);
    socket.on('logs:data', handleMeta);
    subscribe();

    return () => {
      socket.emit('logs:unsubscribe', { nodeId });
      socket.off('connect', subscribe);
      socket.off('logs:snapshot', handleSnapshot);
      socket.off('logs:chunk', handleChunk);
      socket.off('logs:data', handleMeta);
    };
  }, [socket, nodeId, enabled]);

  return { snapshot, meta, error };
}
