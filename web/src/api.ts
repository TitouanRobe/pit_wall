export type SessionListItem = {
  id: number;
  started_at: string;
  session_type: string | null;
  source: string;
  driver: string | null;
  hidden: boolean;
  track_temp: number | null;
  air_temp: number | null;
  wetness: number | null;
  track: string;
  track_name: string;
  length_m: number;
  car: string;
  car_name: string;
  class: string | null;
  laps: number;
  best_ms: number | null;
  warnings: number;
};

export type Lap = {
  id: number;
  session_id: number;
  lap_number: number;
  lap_time_ms: number | null;
  s1_ms: number | null;
  s2_ms: number | null;
  s3_ms: number | null;
  valid: number;
  is_out_lap: number;
  is_in_lap: number;
  in_grid: number;
  fuel_used: number | null;
  max_speed: number | null;
  track: string;
  track_name: string;
  car: string;
  car_name: string;
  class: string | null;
  started_at: string;
  session_type: string | null;
  driver: string | null;
};

export type QualityReport = {
  frames: number;
  sample_hz: number;
  dt_jitter_ms: number;
  gaps: number;
  max_gap_ms: number;
  pauses: number;
  backward_points: number;
  laps_checked: number;
  warnings: { code: string; message: string }[];
};

export type SessionDetail = {
  session: {
    id: number;
    started_at: string;
    session_type: string | null;
    air_temp: number | null;
    track_temp: number | null;
    wetness: number | null;
    source: string;
    notes: string | null;
    driver: string | null;
    hidden: number;
    sample_hz: number;
    track: string;
    track_name: string;
    length_m: number;
    car: string;
    car_name: string;
    class: string | null;
    quality: QualityReport | null;
  };
  laps: Lap[];
  stats: {
    best_ms: number | null;
    clean_laps: number;
    mean_ms: number | null;
    stdev_ms: number | null;
    ideal: { time_ms: number; segments: { name: string; time_s: number; lap_number: number }[] } | null;
  };
};

export type Corner = {
  index: number;
  name: string;
  s_start: number;
  s_apex: number;
  s_end: number;
  v_apex_kmh: number;
};

export type TrackMap = { s: number[]; x: number[]; z: number[]; corners: Corner[] };

export type Trace = {
  s: number[];
  t_lap: number[];
  pos_x: number[];
  pos_z: number[];
  speed_kmh: number[];
  throttle_pct: number[];
  brake_pct: number[];
  steering_pct: number[];
  gear: number[];
  rpm: number[];
  g_lat: number[];
  g_long: number[];
  abs_active: number[];
  tc_active: number[];
};

export type CornerMetrics = {
  time_s: number;
  min_speed_kmh: number;
  min_speed_s: number;
  brake_s: number | null;
  peak_brake_pct: number;
  full_throttle_s: number | null;
  exit_speed_kmh: number;
  abs_s: number;
};

export type CornerComparison = Corner & { ref: CornerMetrics; cmp: CornerMetrics; delta_s: number; insight: string };

export type Comparison = {
  track: string;
  ref: Lap & { trace: Trace };
  cmp: Lap & { trace: Trace };
  delta_s: number[];
  corners: CornerComparison[];
  insights: string[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type CornerSpread = { best_s: number; median_s: number; stdev_s: number | null };

export type ProgressionSession = {
  session_id: number;
  started_at: string;
  session_type: string | null;
  track_temp: number | null;
  car_name: string;
  laps: number;
  best_ms: number;
  median_ms: number;
  stdev_ms: number | null;
  corners: CornerSpread[];
};

export type CornerFocus = {
  index: number;
  name: string;
  gap_s: number;
  spread_s: number | null;
  trend_s: number | null;
};

export type Progression = {
  track: string;
  track_name: string;
  length_m: number;
  cars: { slug: string; name: string; sessions: number }[];
  car: string;
  corners: Corner[];
  sessions: ProgressionSession[];
  best_ever_s: number[];
  focus: CornerFocus[];
  summary: {
    sessions: number;
    span_days: number;
    first_best_ms: number | null;
    latest_best_ms: number | null;
    best_ms: number | null;
  };
};

export const setSessionHidden = (id: number, hidden: boolean) =>
  apiFetch<void>(`/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });

export const deleteSession = (id: number) => apiFetch<void>(`/sessions/${id}`, { method: "DELETE" });
