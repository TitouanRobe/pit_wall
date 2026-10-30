from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pyarrow as pa

GAP_S = 0.040
PAUSE_S = 1.0
BACKWARD_TOLERANCE_M = 1.0
LENGTH_TOLERANCE = 0.03
LAP_TIME_TOLERANCE_MS = 60
ESSENTIAL = ["session_t_s", "lap_number", "lap_dist_m", "speed_kmh", "throttle_pct", "brake_pct"]


@dataclass
class QualityReport:
    frames: int
    sample_hz: float
    dt_jitter_ms: float
    gaps: int
    max_gap_ms: float
    pauses: int
    backward_points: int
    laps_checked: int
    warnings: list[dict] = field(default_factory=list)

    def warn(self, code: str, message: str) -> None:
        self.warnings.append({"code": code, "message": message})

    def to_dict(self) -> dict:
        return asdict(self)


def check_session(raw: pa.Table, track_length_m: float, lap_times_ms: dict[int, int | None],
                  grid_lap_times_s: dict[int, float], expected_hz: float) -> QualityReport:
    gap_s = max(GAP_S, 2.0 / expected_hz)
    t = raw.column("session_t_s").to_numpy().astype(np.float64)
    lap = raw.column("lap_number").to_numpy()
    dist = raw.column("lap_dist_m").to_numpy()

    dt = np.diff(t)
    running = dt[(dt > 0) & (dt < PAUSE_S)]
    hz = float(1.0 / running.mean()) if running.size else 0.0
    report = QualityReport(
        frames=int(t.size),
        sample_hz=round(hz, 2),
        dt_jitter_ms=round(float(running.std() * 1000), 2) if running.size else 0.0,
        gaps=int(np.sum(running > gap_s)),
        max_gap_ms=round(float(running.max() * 1000), 1) if running.size else 0.0,
        pauses=int(np.sum(dt >= PAUSE_S)),
        backward_points=0,
        laps_checked=len(grid_lap_times_s),
    )

    if hz and hz < expected_hz * 0.9:
        report.warn("low_rate", f"Effective sample rate is {hz:.1f} Hz, expected {expected_hz:.0f} Hz.")
    if report.gaps:
        report.warn("gaps", f"{report.gaps} gaps over {gap_s * 1000:.0f} ms (longest {report.max_gap_ms:.0f} ms).")
    if np.any(dt < 0):
        report.warn("time_backwards", "Session time goes backwards. The session was probably restarted.")

    if dist.size and float(np.ptp(dist)) < 1.0:
        report.warn("no_distance", "Lap distance never changes. The distance channel is not wired.")
        return report

    same_lap = lap[1:] == lap[:-1]
    report.backward_points = int(np.sum((np.diff(dist) < -BACKWARD_TOLERANCE_M) & same_lap))
    if report.backward_points:
        report.warn("non_monotonic", f"Lap distance goes backwards at {report.backward_points} points.")

    for name in ESSENTIAL:
        column = raw.column(name)
        bad = column.null_count
        if pa.types.is_floating(column.type):
            bad += int(np.isnan(column.to_numpy(zero_copy_only=False)).sum())
        if bad:
            report.warn("missing", f"{bad} missing values in {name}.")

    for n, grid_s in grid_lap_times_s.items():
        own = dist[lap == n]
        if own.size and abs(float(own.max()) - track_length_m) > track_length_m * LENGTH_TOLERANCE:
            report.warn("lap_length", f"Lap {n} covers {own.max():.0f} m, track is {track_length_m:.0f} m.")
        official = lap_times_ms.get(n)
        if official and abs(official - grid_s * 1000) > LAP_TIME_TOLERANCE_MS:
            report.warn("lap_time", f"Lap {n}: timing says {official / 1000:.3f} s, trace says {grid_s:.3f} s.")

    return report
