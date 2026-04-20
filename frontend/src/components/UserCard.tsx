import type { LiveMetric } from '../types';

interface Props {
  metric: LiveMetric;
  index: number;
}

export function UserCard({ metric, index }: Props) {
  const {
    user_name,
    heart_rate,
    power,
    zone,
    zone_label,
    zone_color,
    connected,
  } = metric;

  // Pulse speed inversely proportional to HR (faster HR → faster glow)
  const pulseSpeed = heart_rate > 0 ? Math.max(0.3, 60 / heart_rate) : 1;

  const zoneBg = `${zone_color}18`; // ~10% opacity hex
  const zoneBorder = `${zone_color}40`; // ~25% opacity

  return (
    <div
      className={`
        relative rounded-2xl border p-5 transition-all duration-300
        animate-fade-up
        ${connected ? 'animate-pulse-glow' : 'animate-signal-lost opacity-60'}
      `}
      style={{
        animationDelay: `${index * 80}ms`,
        background: connected ? zoneBg : 'var(--color-surface)',
        borderColor: connected ? zoneBorder : 'var(--color-border)',
        '--glow-color': connected ? `${zone_color}40` : 'transparent',
        '--pulse-speed': `${pulseSpeed}s`,
      } as React.CSSProperties}
    >
      {/* Connection status dot */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <span
          className="block h-2.5 w-2.5 rounded-full"
          style={{ background: connected ? zone_color : '#555' }}
        />
        {!connected && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
            Signal lost
          </span>
        )}
      </div>

      {/* Name */}
      <h2
        className="font-display text-lg font-semibold mb-3 truncate pr-20"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {user_name}
      </h2>

      {/* HR big number */}
      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="font-mono text-5xl font-bold tabular-nums leading-none tracking-tight"
          style={{ color: zone_color, fontFamily: 'var(--font-mono)' }}
        >
          {heart_rate > 0 ? heart_rate : '—'}
        </span>
        <span className="text-sm text-text-dim font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
          bpm
        </span>
      </div>

      {/* Zone label */}
      <div className="mb-4">
        <span
          className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide"
          style={{
            background: `${zone_color}25`,
            color: zone_color,
          }}
        >
          {zone_label || 'No data'}
        </span>
      </div>

      {/* Zone bar */}
      <div className="h-1.5 rounded-full bg-white/5 mb-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: zone > 0 ? `${(zone / 5) * 100}%` : '0%',
            background: zone_color,
          }}
        />
      </div>

      {/* Power (if available) */}
      {power !== null && power > 0 && (
        <div className="flex items-baseline gap-1.5 mt-2">
          <span className="text-xl font-bold font-mono tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
            {power}
          </span>
          <span className="text-xs text-text-dim font-mono" style={{ fontFamily: 'var(--font-mono)' }}>W</span>
        </div>
      )}

      {/* Zone mini indicators */}
      <div className="flex gap-1 mt-3">
        {[1, 2, 3, 4, 5].map((z) => (
          <div
            key={z}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{
              background: z <= zone ? `var(--color-zone-${z})` : 'rgba(255,255,255,0.06)',
              opacity: z === zone ? 1 : 0.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}
