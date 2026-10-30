export function lapTime(ms: number | null | undefined): string {
  if (ms == null) return "-:--.---";
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function sectorTime(ms: number | null | undefined): string {
  if (ms == null) return "--.---";
  return ms >= 60000 ? lapTime(ms) : (ms / 1000).toFixed(3);
}

export function signed(value: number, digits = 3): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return `±${fixed}`;
  return `${value > 0 ? "+" : "−"}${fixed}`;
}

export function seconds(s: number): string {
  return `${s.toFixed(3)} s`;
}

export function distance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function sessionType(type: string | null): string {
  const names: Record<string, string> = {
    test: "Test day",
    practice: "Practice",
    quali: "Qualifying",
    warmup: "Warm-up",
    race: "Race",
  };
  return type ? (names[type] ?? type) : "Session";
}

export function wetness(value: number | null): string {
  if (value == null) return "-";
  if (value < 0.05) return "Dry";
  if (value < 0.3) return "Damp";
  return `Wet ${Math.round(value * 100)}%`;
}
