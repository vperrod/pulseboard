import { useEffect, useRef, useCallback, useState } from 'react';
import type { LiveMetric, LeaderboardEntry, ActiveSession, ViewMode } from '../types';

export interface WebSocketState {
  metrics: LiveMetric[];
  leaderboard: LeaderboardEntry[];
  activeSession: ActiveSession | null;
  viewMode: ViewMode;
}

export function useWebSocket(): WebSocketState {
  const [metrics, setMetrics] = useState<Map<string, LiveMetric>>(new Map());
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const type: string = data.type || 'metric';

      switch (type) {
        case 'metric':
          setMetrics((prev) => {
            const next = new Map(prev);
            next.set(data.user_id, data as LiveMetric);
            return next;
          });
          break;

        case 'leaderboard':
          setLeaderboard(data.entries as LeaderboardEntry[]);
          setActiveSession((prev) => prev ? {
            ...prev,
            elapsed_seconds: data.elapsed_seconds,
            paused: data.paused ?? false,
          } : prev);
          break;

        case 'session_start':
          setActiveSession({
            session_id: data.session_id,
            session_name: data.session_name,
            elapsed_seconds: data.elapsed_seconds ?? 0,
            paused: data.paused ?? false,
          });
          setLeaderboard([]);
          break;

        case 'session_end':
          setActiveSession(null);
          setLeaderboard([]);
          break;

        case 'session_pause':
          setActiveSession((prev) => prev ? { ...prev, paused: data.paused } : null);
          break;

        case 'view_mode':
          setViewMode(data.mode as ViewMode);
          break;

        case 'user_removed':
          setMetrics((prev) => {
            const next = new Map(prev);
            next.delete(data.user_id);
            return next;
          });
          break;

        case 'clear':
          setMetrics(new Map());
          setLeaderboard([]);
          break;
      }
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

  return {
    metrics: Array.from(metrics.values()),
    leaderboard,
    activeSession,
    viewMode,
  };
}
