function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function ramp(stops: string[], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - i;
  const [a, b] = [channels(stops[i]), channels(stops[i + 1])];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * mix)).join(",")})`;
}

export function rampLegend(stops: string[]): string {
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
