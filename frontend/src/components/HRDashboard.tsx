import { useWebSocket } from '../hooks/useWebSocket';
import { UserCard } from './UserCard';
import { PulseLogoFull } from './PulseLogo';
import { useEffect, useRef } from 'react';

/**
 * /hrdashboard — Full-screen HR metrics grid for TV/projector display.
 * Auto-hides cursor after 3s of inactivity.
 */
export function HRDashboard() {
  const { metrics, activeSession } = useWebSocket();
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

  const sorted = [...metrics].sort((a, b) => a.user_name.localeCompare(b.user_name));

  return (
    <div ref={containerRef} className="min-h-[100dvh] flex flex-col bg-bg">
      {/* Minimal top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
        <PulseLogoFull height={28} />
        <div className="flex items-center gap-3">
          {activeSession && (
            <>
              <span
                className="text-accent font-medium text-sm"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {activeSession.session_name}
              </span>
              <span
                className="text-text-dim text-sm tabular-nums"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {formatTime(activeSession.elapsed_seconds)}
              </span>
              {activeSession.paused && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                  Paused
                </span>
              )}
            </>
          )}
          <span className="text-text-dim text-xs">
            {metrics.filter((m) => m.connected).length}/{metrics.length} active
          </span>
        </div>
      </header>

      {/* Responsive card grid */}
      {sorted.length > 0 ? (
        <div
          className="flex-1 p-4 md:p-6 lg:p-8 grid gap-4 content-start"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          }}
        >
          {sorted.map((m, i) => (
            <UserCard key={m.user_id} metric={m} index={i} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
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
            <p className="text-text-dim text-sm">No active users</p>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
