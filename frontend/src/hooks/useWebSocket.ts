import { useEffect, useRef, useCallback, useState } from 'react';
import type { LiveMetric } from '../types';

export function useWebSocket() {
  const [metrics, setMetrics] = useState<Map<string, LiveMetric>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data: LiveMetric = JSON.parse(event.data);
      setMetrics((prev) => {
        const next = new Map(prev);
        next.set(data.user_id, data);
        return next;
      });
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return Array.from(metrics.values());
}
