from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pyarrow as pa

from .config import grid_step_for
from .parquet_io import GRID_SCHEMA

LINEAR = ["pos_x", "pos_y", "pos_z", "speed_kmh", "throttle_pct", "brake_pct", "steering_pct", "rpm", "g_lat", "g_long"]
NEAREST = ["gear", "abs_active", "tc_active"]
EDGE_TOLERANCE_M = 60.0
MAX_HOLE_M = 80.0


@dataclass(frozen=True)
class GridResult:
    table: pa.Table
    lap_times_s: dict[int, float]


def grid_axis(track_length_m: float) -> np.ndarray:
    step = grid_step_for(track_length_m)
    return np.append(np.arange(0.0, track_length_m, step), track_length_m)


def _extended_lap(cols: dict[str, np.ndarray], lap_number: int, length: float) -> dict[str, np.ndarray] | None:
    """Frames of a lap plus the tail of the previous lap and head of the next one, on a single
    continuous distance axis. This is what lets us interpolate the exact line-crossing time."""
    lap = cols["lap_number"]
    own = lap == lap_number
    d_own = cols["lap_dist_m"][own]
    if d_own.size < 20 or d_own.min() > EDGE_TOLERANCE_M or d_own.max() < length - EDGE_TOLERANCE_M:
        return None
    if np.max(np.diff(np.sort(d_own))) > MAX_HOLE_M:
        return None

    prev = (lap == lap_number - 1) & (cols["lap_dist_m"] > length - EDGE_TOLERANCE_M * 2)
    nxt = (lap == lap_number + 1) & (cols["lap_dist_m"] < EDGE_TOLERANCE_M * 2)
    pick = prev | own | nxt
    d = cols["lap_dist_m"][pick].astype(np.float64)
    d[prev[pick]] -= length
    d[nxt[pick]] += length
    if d.min() > 0 or d.max() < length:
        return None

    order = np.argsort(cols["session_t_s"][pick], kind="stable")
    out = {k: v[pick][order] for k, v in cols.items()}
    d = np.maximum.accumulate(d[order])
    keep = np.concatenate(([True], np.diff(d) > 1e-3))
    out = {k: v[keep] for k, v in out.items()}
    out["d"] = d[keep]
    return out


def build_grid(raw: pa.Table, track_length_m: float) -> GridResult:
    s = grid_axis(track_length_m)
    cols = {name: raw.column(name).to_numpy(zero_copy_only=False) for name in raw.column_names}
    chunks: list[dict[str, np.ndarray]] = []
    lap_times: dict[int, float] = {}

    for lap_number in np.unique(cols["lap_number"]):
        ext = _extended_lap(cols, int(lap_number), track_length_m)
        if ext is None:
            continue
        d = ext["d"]
        t = np.interp(s, d, ext["session_t_s"].astype(np.float64))
        chunk = {"lap_number": np.full(s.size, lap_number, dtype=np.int16), "s": s, "t_lap": t - t[0]}
        for name in LINEAR:
            chunk[name] = np.interp(s, d, ext[name].astype(np.float64))
        idx = np.clip(np.searchsorted(d, s), 1, d.size - 1)
        nearest = np.where(s - d[idx - 1] < d[idx] - s, idx - 1, idx)
        for name in NEAREST:
            chunk[name] = ext[name][nearest]
        chunks.append(chunk)
        lap_times[int(lap_number)] = float(t[-1] - t[0])

    if not chunks:
        return GridResult(GRID_SCHEMA.empty_table(), {})
    table = pa.table(
        {f.name: pa.array(np.concatenate([c[f.name] for c in chunks]).astype(f.type.to_pandas_dtype()), type=f.type)
         for f in GRID_SCHEMA},
        schema=GRID_SCHEMA,
    )
    return GridResult(table, lap_times)
