const STOPS = ["#131c33", "#3b3a2e", "#6b5d27", "#a8862a", "#f2c230"];

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function ramp(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(scaled));
  const mix = scaled - i;
  const [a, b] = [channels(STOPS[i]), channels(STOPS[i + 1])];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * mix)).join(",")})`;
}

export function rampLegend(): string {
  return `linear-gradient(90deg, ${STOPS.join(", ")})`;
}
