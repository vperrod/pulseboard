import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebBluetooth } from '../hooks/useWebBluetooth';
import { webPushMetric, setViewMode as apiSetViewMode, startSession, stopSession } from '../api';
import { UserCard } from './UserCard';
import { Leaderboard } from './Leaderboard';
import type { ViewMode } from '../types';

const VIEW_ICONS: Record<ViewMode, string> = {
  metrics: '▦',
  split: '◧',
  leaderboard: '🏆',
};

const VIEW_LABELS: Record<ViewMode, string> = {
  metrics: 'Metrics',
  split: 'Split',
  leaderboard: 'Board',
};

const VIEW_CYCLE: ViewMode[] = ['metrics', 'split', 'leaderboard'];

export function Dashboard() {
  const { metrics, leaderboard, activeSession, viewMode } = useWebSocket();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(localStorage.getItem('pulseboard_user_id'));
  }, []);

  const handleHR = useCallback(
    (hr: number, deviceName: string) => {
      if (userId) {
        webPushMetric(userId, hr, deviceName).catch(() => {});
      }
    },
    [userId],
  );

  const ble = useWebBluetooth(handleHR);

  function cycleViewMode() {
    const idx = VIEW_CYCLE.indexOf(viewMode);
    const next = VIEW_CYCLE[(idx + 1) % VIEW_CYCLE.length];
    apiSetViewMode(next).catch(() => {});
  }

  const myMetric = userId ? metrics.find((m) => m.user_id === userId) : null;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-accent">Pulse</span>Board
          </h1>
          <p className="text-text-dim text-sm mt-1">
            {activeSession ? (
              <>
                <span className="text-accent font-medium">{activeSession.session_name}</span>
                {activeSession.paused && <span className="text-amber-400 ml-1">(paused)</span>}
              </>
            ) : metrics.length > 0 ? (
              `${metrics.filter((m) => m.connected).length} active · ${metrics.length} total`
            ) : (
              'Waiting for devices…'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Web Bluetooth */}
          {userId && ble.supported && (
            <>
              {ble.connected ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                    <span className="text-red-400 animate-pulse">♥</span>
                    <span
                      className="font-mono text-sm font-bold tabular-nums text-red-400"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {ble.heartRate ?? '—'}
                    </span>
                  </div>
                  <button
                    onClick={ble.disconnect}
                    className="px-3 py-2 rounded-xl text-xs font-semibold border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors"
                    title={`Disconnect ${ble.deviceName}`}
                  >
                    ⏏ {ble.deviceName}
                  </button>
                </div>
              ) : (
                <button
                  onClick={ble.connect}
                  disabled={ble.connecting}
                  className="px-3 py-2 rounded-xl text-sm font-semibold border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                >
                  {ble.connecting ? '…' : '⦿ Connect'}
                </button>
              )}
            </>
          )}

          {/* View mode toggle */}
          <button
            onClick={cycleViewMode}
            className="px-3 py-2 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
            title={`View: ${VIEW_LABELS[viewMode]}`}
          >
            {VIEW_ICONS[viewMode]} {VIEW_LABELS[viewMode]}
          </button>

          {/* Quick session start/stop */}
          {activeSession ? (
            <button
              onClick={() => stopSession().catch(() => {})}
              className="px-3 py-2 rounded-xl text-sm font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop session"
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              onClick={() => startSession().catch(() => {})}
              className="px-3 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/80 transition-colors"
              title="Start a new session"
            >
              ▶ Start
            </button>
          )}

          <a
            href="/admin"
            className="px-3 py-2 rounded-xl text-sm font-semibold border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors"
          >
            Admin
          </a>
          <a
            href="/register"
            className="px-3 py-2 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
          >
            + Join
          </a>
        </div>
      </header>

      {/* BLE error */}
      {ble.error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {ble.error}
        </div>
      )}

      {/* Main content — varies by view mode */}
      {viewMode === 'split' ? (
        /* ─── Split View ─── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ minHeight: '70vh' }}>
          {/* Left: metrics grid */}
          <div>
            {metrics.length > 0 ? (
              <>
                {/* If user has a card, show it prominently first */}
                {myMetric && (
                  <div className="mb-4">
                    <UserCard metric={myMetric} index={0} />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {metrics
                    .filter((m) => m.user_id !== userId)
                    .sort((a, b) => a.user_name.localeCompare(b.user_name))
                    .map((m, i) => (
                      <UserCard key={m.user_id} metric={m} index={i + 1} />
                    ))}
                </div>
              </>
            ) : (
              <EmptyMetrics />
            )}
          </div>
          {/* Right: leaderboard */}
          <div className="bg-surface/50 rounded-2xl border border-border p-4 lg:p-5">
            <Leaderboard entries={leaderboard} session={activeSession} />
          </div>
        </div>
      ) : viewMode === 'leaderboard' ? (
        /* ─── Leaderboard Only ─── */
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface/50 rounded-2xl border border-border p-5">
            <Leaderboard entries={leaderboard} session={activeSession} />
          </div>
        </div>
      ) : (
        /* ─── Metrics Only (original grid) ─── */
        metrics.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {metrics
              .sort((a, b) => a.user_name.localeCompare(b.user_name))
              .map((m, i) => (
                <UserCard key={m.user_id} metric={m} index={i} />
              ))}
          </div>
        ) : (
          <EmptyMetrics />
        )
      )}
    </div>
  );
}

function EmptyMetrics() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <div className="text-6xl mb-4 opacity-20">📡</div>
      <h2
        className="text-xl font-semibold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        No active users
      </h2>
      <p className="text-text-dim text-sm max-w-sm">
        Turn on HR broadcast on your watch and{' '}
        <a href="/register" className="text-accent underline underline-offset-2">
          register
        </a>{' '}
        to appear here.
      </p>
    </div>
  );
}
