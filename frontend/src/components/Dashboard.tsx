import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebBluetooth } from '../hooks/useWebBluetooth';
import { webPushMetric } from '../api';
import { UserCard } from './UserCard';

export function Dashboard() {
  const metrics = useWebSocket();
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

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-accent">Pulse</span>Board
          </h1>
          <p className="text-text-dim text-sm mt-1">
            {metrics.length > 0
              ? `${metrics.filter((m) => m.connected).length} active · ${metrics.length} total`
              : 'Waiting for devices…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Web Bluetooth — only show for registered users */}
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
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                >
                  {ble.connecting ? 'Connecting…' : '⦿ Connect Watch'}
                </button>
              )}
            </>
          )}
          <a
            href="/admin"
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors"
          >
            Admin
          </a>
          <a
            href="/register"
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
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

      {/* Cards grid — responsive: 1 col phone, 2 tablet, 3–4 desktop, 5–6 TV */}
      {metrics.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {metrics
            .sort((a, b) => a.user_name.localeCompare(b.user_name))
            .map((m, i) => (
              <UserCard key={m.user_id} metric={m} index={i} />
            ))}
        </div>
      ) : (
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
      )}
    </div>
  );
}
