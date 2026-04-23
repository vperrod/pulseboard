/** Inline ECG pulse logo mark — renders as SVG, scales with className. */
export function PulseLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <polyline
        points="4,26 14,26 18,26 21,34 27,10 31,38 35,20 38,26 44,26"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full logo with text — for header bars. */
export function PulseLogoFull({ height = 32, className = '' }: { height?: number; className?: string }) {
  return (
    <a href="/" className={`flex items-center gap-2 no-underline ${className}`}>
      <PulseLogo size={height} className="text-accent" />
      <span
        className="font-bold tracking-tight"
        style={{ fontFamily: 'var(--font-display)', fontSize: height * 0.75 }}
      >
        <span className="text-accent">Pulse</span>
        <span className="text-text">Board</span>
      </span>
    </a>
  );
}
