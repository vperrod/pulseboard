import { useWebSocket } from '../hooks/useWebSocket';
import { UserCard } from './UserCard';

export function Dashboard() {
  const metrics = useWebSocket();

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
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
        <a
          href="/register"
          className="px-4 py-2 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
        >
          + Join
        </a>
      </header>

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
