import { startTransition, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { JobRecord, NodeRecord, OverviewPayload, RealtimeInitPayload } from '@/types';

interface UseRealtimeOptions {
  enabled: boolean;
  onInit?: (payload: RealtimeInitPayload) => void;
  onNodeUpdate?: (node: NodeRecord) => void;
  onJobUpdate?: (job: JobRecord) => void;
  onOverviewUpdate?: (overview: OverviewPayload) => void;
}

export function useRealtime(options: UseRealtimeOptions) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(options);

  handlersRef.current = options;

  useEffect(() => {
    if (!options.enabled) {
      setConnected(false);
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
      return;
    }

    const nextSocket = io({
      transports: ['polling']
    });

    const handleInit = (payload: RealtimeInitPayload) => {
      startTransition(() => {
        handlersRef.current.onInit?.(payload);
      });
    };

    const handleNodeUpdate = (node: NodeRecord) => {
      startTransition(() => {
        handlersRef.current.onNodeUpdate?.(node);
      });
    };

    const handleJobUpdate = (job: JobRecord) => {
      startTransition(() => {
        handlersRef.current.onJobUpdate?.(job);
      });
    };

    const handleOverviewUpdate = (overview: OverviewPayload) => {
      startTransition(() => {
        handlersRef.current.onOverviewUpdate?.(overview);
      });
    };

    nextSocket.on('connect', () => setConnected(true));
    nextSocket.on('disconnect', () => setConnected(false));
    nextSocket.on('init', handleInit);
    nextSocket.on('node:update', handleNodeUpdate);
    nextSocket.on('job:update', handleJobUpdate);
    nextSocket.on('overview:update', handleOverviewUpdate);

    setSocket(nextSocket);

    return () => {
      nextSocket.off('init', handleInit);
      nextSocket.off('node:update', handleNodeUpdate);
      nextSocket.off('job:update', handleJobUpdate);
      nextSocket.off('overview:update', handleOverviewUpdate);
      nextSocket.disconnect();
      setConnected(false);
      setSocket(null);
    };
  }, [options.enabled]);

  return { socket, connected };
}
