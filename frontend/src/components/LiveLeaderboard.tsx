import { useWebSocket } from '../hooks/useWebSocket';
import { PulseLogoFull } from './PulseLogo';
import { useEffect, useRef } from 'react';

/**
 * /liveleaderboard — Full-screen live leaderboard for TV/projector display.
 * Larger typography for readability at distance. Auto-hides cursor.
 */
export function LiveLeaderboard() {
  const { leaderboard, activeSession } = useWebSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-hide cursor on inactivity
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function showCursor() {
      el!.style.cursor = 'default';
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        el!.style.cursor = 'none';
      }, 3000);
    }

    el.addEventListener('mousemove', showCursor);
    timerRef.current = setTimeout(() => {
      el.style.cursor = 'none';
    }, 3000);

    return () => {
      el.removeEventListener('mousemove', showCursor);
      clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
        <PulseLogoFull height={32} />
        {activeSession && (
          <div className="flex items-center gap-4">
            <span
              className="text-accent font-semibold text-lg"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {activeSession.session_name}
            </span>
            <span
              className="text-text-dim text-lg tabular-nums"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {formatTime(activeSession.elapsed_seconds)}
            </span>
            {activeSession.paused && (
              <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-amber-500/20 text-amber-400 font-semibold">
                Paused
              </span>
            )}
          </div>
        )}
      </header>

      {/* Leaderboard content */}
      <div className="flex-1 flex flex-col px-4 md:px-8 lg:px-12 py-6 overflow-y-auto">
        {!activeSession ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-7xl mb-4 opacity-10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="80" height="80" fill="none" className="inline-block">
                  <polyline
                    points="4,26 14,26 18,26 21,34 27,10 31,38 35,20 38,26 44,26"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-text-dim"
                  />
                </svg>
              </div>
              <h2
                className="text-2xl font-semibold mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                No active session
              </h2>
              <p className="text-text-dim">The leaderboard will appear when a session starts.</p>
            </div>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-text-dim text-lg">Waiting for participants...</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-5xl mx-auto w-full">
            {leaderboard.map((entry, i) => {
              const isTop3 = entry.rank <= 3;
              return (
                <div
                  key={entry.user_id}
                  className={`
                    rounded-2xl border p-4 md:p-5 transition-all duration-500 ease-out
                    animate-fade-up
                    ${isTop3
                      ? 'bg-accent/5 border-accent/20'
                      : 'bg-surface border-border/50'
                    }
                  `}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="flex items-center gap-4 md:gap-6">
                    {/* Rank */}
                    <div className="w-12 text-center flex-shrink-0">
                      {entry.rank <= 3 ? (
                        <span className="text-3xl">{MEDALS[entry.rank - 1]}</span>
                      ) : (
                        <span
                          className="text-xl font-bold text-text-dim tabular-nums"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          #{entry.rank}
                        </span>
                      )}
                    </div>

                    {/* Name + zone */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className="text-xl md:text-2xl font-semibold truncate"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {entry.user_name}
                        </span>
                        <span
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ background: entry.zone_color || '#555' }}
                        />
                      </div>
                      {/* Zone time bar */}
                      <div className="mt-2">
                        <ZoneBar zone_seconds={entry.zone_seconds} />
                      </div>
                    </div>

                    {/* Live HR */}
                    <div className="text-right flex-shrink-0">
                      {entry.heart_rate > 0 && (
                        <div className="flex items-baseline justify-end gap-1">
                          <span
                            className="text-2xl md:text-3xl font-bold tabular-nums"
                            style={{ fontFamily: 'var(--font-mono)', color: entry.zone_color }}
                          >
                            {entry.heart_rate}
                          </span>
                          <span className="text-xs text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                            bpm
                          </span>
                        </div>
                      )}
                      {entry.power != null && entry.power > 0 && (
                        <div className="flex items-baseline justify-end gap-1 mt-0.5">
                          <span
                            className="text-sm font-bold tabular-nums text-text-dim"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {entry.power}
                          </span>
                          <span className="text-[10px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>W</span>
                        </div>
                      )}
                    </div>

                    {/* Score */}
                    <div className="text-right flex-shrink-0 w-28">
                      <span
                        className={`text-2xl md:text-3xl font-bold tabular-nums ${isTop3 ? 'text-accent' : 'text-text'}`}
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {Math.round(entry.score).toLocaleString()}
                      </span>
                      <div className="text-[10px] text-text-dim uppercase tracking-wider">pts</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ZoneBar({ zone_seconds }: { zone_seconds: Record<string, number> }) {
  const total = Object.values(zone_seconds).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const zones = [
    { key: '1', color: 'var(--color-zone-1)' },
    { key: '2', color: 'var(--color-zone-2)' },
    { key: '3', color: 'var(--color-zone-3)' },
    { key: '4', color: 'var(--color-zone-4)' },
    { key: '5', color: 'var(--color-zone-5)' },
  ];

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-white/5 w-full">
      {zones.map((z) => {
        const pct = ((zone_seconds[z.key] || 0) / total) * 100;
        return pct > 0 ? (
          <div
            key={z.key}
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, background: z.color }}
          />
        ) : null;
      })}
    </div>
  );
}
