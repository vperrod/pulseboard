import { useRef, useEffect } from 'react';
import type { LeaderboardEntry, ActiveSession } from '../types';

interface Props {
  entries: LeaderboardEntry[];
  session: ActiveSession | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MEDALS = ['🥇', '🥈', '🥉'];

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
    <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5 w-full">
      {zones.map((z) => {
        const pct = (zone_seconds[z.key] || 0) / total * 100;
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

export function Leaderboard({ entries, session }: Props) {
  const prevRanks = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.user_id, e.rank);
    }
    prevRanks.current = map;
  }, [entries]);

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4">
        <div className="text-5xl mb-4 opacity-20">🏆</div>
        <h2
          className="text-xl font-semibold mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          No active session
        </h2>
        <p className="text-text-dim text-sm max-w-xs">
          The leaderboard will appear here when a session starts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {session.session_name || 'Session'}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="text-sm tabular-nums text-text-dim"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {formatTime(session.elapsed_seconds)}
            </span>
            {session.paused && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                Paused
              </span>
            )}
          </div>
        </div>
        <div className="text-3xl opacity-30">🏆</div>
      </div>

      {/* Leaderboard entries */}
      {entries.length === 0 ? (
        <div className="text-center py-8 text-text-dim text-sm">
          Waiting for participants…
        </div>
      ) : (
        <div className="space-y-2 flex-1 overflow-y-auto">
          {entries.map((entry, i) => {
            const isTop3 = entry.rank <= 3;

            return (
              <div
                key={entry.user_id}
                className={`
                  relative rounded-xl border p-3 transition-all duration-500 ease-out
                  animate-fade-up
                  ${isTop3
                    ? 'bg-accent/5 border-accent/20'
                    : 'bg-surface border-border/50'
                  }
                `}
                style={{
                  animationDelay: `${i * 40}ms`,
                  order: entry.rank,
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <div className="w-8 text-center flex-shrink-0">
                    {entry.rank <= 3 ? (
                      <span className="text-xl">{MEDALS[entry.rank - 1]}</span>
                    ) : (
                      <span
                        className="text-sm font-bold text-text-dim tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        #{entry.rank}
                      </span>
                    )}
                  </div>

                  {/* Name + zone */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-semibold truncate"
                        style={{ fontFamily: 'var(--font-display)' }}
                      >
                        {entry.user_name}
                      </span>
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ background: entry.zone_color || '#555' }}
                      />
                    </div>
                    {/* Zone time breakdown bar */}
                    <div className="mt-1.5">
                      <ZoneBar zone_seconds={entry.zone_seconds} />
                    </div>
                  </div>

                  {/* Live HR */}
                  <div className="text-right flex-shrink-0 w-16">
                    {entry.heart_rate > 0 && (
                      <div className="flex items-baseline justify-end gap-0.5">
                        <span
                          className="text-lg font-bold tabular-nums"
                          style={{ fontFamily: 'var(--font-mono)', color: entry.zone_color }}
                        >
                          {entry.heart_rate}
                        </span>
                        <span className="text-[10px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                          bpm
                        </span>
                      </div>
                    )}
                    {entry.power != null && entry.power > 0 && (
                      <div className="flex items-baseline justify-end gap-0.5">
                        <span
                          className="text-xs font-bold tabular-nums text-text-dim"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          {entry.power}
                        </span>
                        <span className="text-[9px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>W</span>
                      </div>
                    )}
                  </div>

                  {/* Score */}
                  <div className="text-right flex-shrink-0 w-20">
                    <span
                      className={`text-xl font-bold tabular-nums ${isTop3 ? 'text-accent' : 'text-text'}`}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {Math.round(entry.score).toLocaleString()}
                    </span>
                    <div className="text-[9px] text-text-dim uppercase tracking-wider">pts</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
