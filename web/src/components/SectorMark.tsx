export function SectorMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="4" width="5" height="14" rx="1" fill="var(--color-signal)" opacity="0.4" />
      <rect x="8.5" y="4" width="5" height="14" rx="1" fill="var(--color-signal)" opacity="0.7" />
      <rect x="16" y="4" width="5" height="14" rx="1" fill="var(--color-signal)" />
    </svg>
  );
}
