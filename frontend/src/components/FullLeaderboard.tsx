import { useState, useEffect } from 'react';
import { getDailyLeaderboard, getWeeklyLeaderboard, getMonthlyLeaderboard } from '../api';
import { PulseLogoFull } from './PulseLogo';

type Period = 'daily' | 'weekly' | 'monthly';

interface RankedUser {
  user_name: string;
  total_score: number;
  sessions_count: number;
  zone_seconds: Record<string, number>;
  peak_hr: number;
}

/**
 * /fullleaderboard — Historical aggregated leaderboard browser.
 * Fetches from REST API. Period toggle (daily/weekly/monthly) + date picker.
 */
export function FullLeaderboard() {
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rankings, setRankings] = useState<RankedUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        let data: { combined?: RankedUser[] };
        if (period === 'daily') {
          data = await getDailyLeaderboard(date);
        } else if (period === 'weekly') {
          data = await getWeeklyLeaderboard(date);
        } else {
          const d = new Date(date);
          data = await getMonthlyLeaderboard(d.getFullYear(), d.getMonth() + 1);
        }
        if (!cancelled) {
          setRankings(data.combined ?? []);
        }
      } catch {
        if (!cancelled) setRankings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [period, date]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
        <PulseLogoFull height={28} />
        <a
          href="/"
          className="text-sm text-text-dim hover:text-accent transition-colors no-underline"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Back to dashboard
        </a>
      </header>

      {/* Filters */}
      <div className="px-6 py-4 border-b border-border/30 flex items-center gap-4 flex-wrap">
        {/* Period toggle */}
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`
                px-4 py-2 text-sm font-semibold capitalize transition-colors
                ${period === p
                  ? 'bg-accent text-white'
                  : 'text-text-dim hover:text-text'
                }
              `}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Date picker */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 rounded-xl border border-border bg-surface text-text text-sm"
          style={{ fontFamily: 'var(--font-mono)', colorScheme: 'dark' }}
        />

        {/* Period label */}
        <span className="text-text-dim text-sm ml-auto" style={{ fontFamily: 'var(--font-body)' }}>
          {period === 'daily' && `Showing ${formatDisplayDate(date)}`}
          {period === 'weekly' && `Week of ${formatDisplayDate(date)}`}
          {period === 'monthly' && `${new Date(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
        </span>
      </div>

      {/* Rankings table */}
      <div className="flex-1 px-4 md:px-8 lg:px-12 py-6 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-text-dim text-sm">Loading...</div>
          </div>
        ) : rankings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-6xl mb-4 opacity-10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="64" height="64" fill="none" className="inline-block">
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
              className="text-xl font-semibold mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              No data
            </h2>
            <p className="text-text-dim text-sm max-w-sm">
              No sessions recorded for this {period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month'}.
            </p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto w-full">
            {/* Table header */}
            <div
              className="grid items-center gap-4 px-5 py-3 text-xs uppercase tracking-wider text-text-dim font-semibold border-b border-border/30"
              style={{
                gridTemplateColumns: '3rem 1fr 6rem 5rem 1fr 5rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>Rank</span>
              <span>Name</span>
              <span className="text-right">Score</span>
              <span className="text-right">Sessions</span>
              <span>Zones</span>
              <span className="text-right">Peak HR</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/20">
              {rankings.map((user, i) => {
                const rank = i + 1;
                const isTop3 = rank <= 3;
                return (
                  <div
                    key={user.user_name}
                    className={`
                      grid items-center gap-4 px-5 py-4 transition-colors
                      animate-fade-up
                      ${isTop3 ? 'bg-accent/[0.03]' : ''}
                    `}
                    style={{
                      gridTemplateColumns: '3rem 1fr 6rem 5rem 1fr 5rem',
                      animationDelay: `${i * 30}ms`,
                    }}
                  >
                    {/* Rank */}
                    <div className="text-center">
                      {rank <= 3 ? (
                        <span className="text-xl">{MEDALS[rank - 1]}</span>
                      ) : (
                        <span
                          className="text-sm font-bold text-text-dim tabular-nums"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          #{rank}
                        </span>
                      )}
                    </div>

                    {/* Name */}
                    <span
                      className="font-semibold truncate"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {user.user_name}
                    </span>

                    {/* Score */}
                    <span
                      className={`text-right text-lg font-bold tabular-nums ${isTop3 ? 'text-accent' : 'text-text'}`}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {Math.round(user.total_score).toLocaleString()}
                    </span>

                    {/* Sessions */}
                    <span
                      className="text-right text-sm tabular-nums text-text-dim"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {user.sessions_count}
                    </span>

                    {/* Zone bar */}
                    <div className="px-1">
                      <ZoneBar zone_seconds={user.zone_seconds} />
                    </div>

                    {/* Peak HR */}
                    <span
                      className="text-right text-sm font-bold tabular-nums text-text-dim"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {user.peak_hr > 0 ? user.peak_hr : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function formatDisplayDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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
