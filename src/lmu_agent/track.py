from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow as pa

from .config import TRACKS_DIR
from .parquet_io import TRACK_SCHEMA, read_parquet, write_parquet

SMOOTH_M = 25.0
MIN_SEARCH_M = 150.0
MIN_PROMINENCE_KMH = 12.0


@dataclass(frozen=True)
class Corner:
    index: int
    name: str
    s_start: float
    s_apex: float
    s_end: float
    v_apex_kmh: float


def track_path(slug: str) -> Path:
    return TRACKS_DIR / f"{slug}.parquet"


def _smooth(values: np.ndarray, window: int, circular: bool = True) -> np.ndarray:
    if window <= 1:
        return values.astype(np.float64)
    kernel = np.ones(window) / window
    pad = window // 2
    mode = "wrap" if circular else "edge"
    return np.convolve(np.pad(values.astype(np.float64), pad, mode=mode), kernel, mode="same")[pad:-pad]


def build_reference(lap_grid: pa.Table) -> pa.Table:
    """Track reference line from one clean lap resampled on the distance grid."""
    s = lap_grid.column("s").to_numpy().astype(np.float64)
    x = lap_grid.column("pos_x").to_numpy().astype(np.float64)
    y = lap_grid.column("pos_y").to_numpy().astype(np.float64)
    z = lap_grid.column("pos_z").to_numpy().astype(np.float64)
    step = float(np.median(np.diff(s)))
    window = max(1, int(round(SMOOTH_M / step)))

    xs, zs = _smooth(x, window), _smooth(z, window)
    heading = np.unwrap(np.arctan2(np.gradient(xs, s), np.gradient(zs, s)))
    curvature = _smooth(np.gradient(heading, s), window)
    speed = lap_grid.column("speed_kmh").to_numpy()

    return pa.table(
        {"s": s, "x": x, "y": y, "z": z, "heading": np.mod(heading, 2 * np.pi), "curvature": curvature,
         "ref_speed_kmh": speed},
        schema=TRACK_SCHEMA,
    )


def save_reference(slug: str, reference: pa.Table) -> Path:
    path = track_path(slug)
    write_parquet(reference, TRACK_SCHEMA, path)
    return path


def load_reference(slug: str) -> pa.Table | None:
    path = track_path(slug)
    return read_parquet(path) if path.exists() else None


def detect_corners(s: np.ndarray, speed_kmh: np.ndarray) -> list[Corner]:
    """Split the lap into one segment per corner.

    Corners are speed minima of the reference lap with enough prominence (chicanes merge into
    one corner). Segment boundaries sit at the speed peak between two corners, so segments
    tile the whole lap and per-corner deltas add up to the total lap delta.
    """
    step = float(np.median(np.diff(s)))
    v = _smooth(speed_kmh, max(1, int(round(SMOOTH_M / step))), circular=False)
    half = max(1, int(round(MIN_SEARCH_M / step)))
    padded = np.pad(v, half, mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * half + 1)
    minima = list(np.flatnonzero(v <= windows.min(axis=1) + 1e-9))
    minima = [m for i, m in enumerate(minima) if i == 0 or m - minima[i - 1] > 1]

    def peaks_between(mins: list[int]) -> list[int]:
        return [a + int(np.argmax(v[a:b + 1])) for a, b in zip(mins[:-1], mins[1:])]

    changed = True
    while changed and len(minima) > 1:
        changed = False
        peaks = peaks_between(minima)
        left = [v[: minima[0] + 1].max()] + [v[p] for p in peaks]
        right = [v[p] for p in peaks] + [v[minima[-1]:].max()]
        prominence = [min(lp, rp) - v[m] for m, lp, rp in zip(minima, left, right)]
        weakest = int(np.argmin(prominence))
        if prominence[weakest] < MIN_PROMINENCE_KMH:
            minima.pop(weakest)
            changed = True

    peaks = peaks_between(minima)
    bounds = [0] + peaks + [len(s) - 1]
    return [
        Corner(
            index=i,
            name=f"T{i + 1}",
            s_start=float(s[bounds[i]]),
            s_apex=float(s[m]),
            s_end=float(s[bounds[i + 1]]),
            v_apex_kmh=float(speed_kmh[m]),
        )
        for i, m in enumerate(minima)
    ]


def freeze_corners(conn: sqlite3.Connection, track_id: int, reference: pa.Table) -> None:
    """Persist the corner layout the first time a track gets a reference line.

    Corners are detected from the speed profile of the reference lap, which changes whenever a
    faster lap becomes the reference. Freezing them keeps a corner comparable across weeks."""
    if conn.execute("SELECT 1 FROM corner WHERE track_id = ? LIMIT 1", (track_id,)).fetchone():
        return
    corners = detect_corners(reference.column("s").to_numpy(), reference.column("ref_speed_kmh").to_numpy())
    conn.executemany(
        "INSERT INTO corner (track_id, idx, name, s_start, s_apex, s_end, v_apex_kmh) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(track_id, c.index, c.name, c.s_start, c.s_apex, c.s_end, c.v_apex_kmh) for c in corners],
    )


def corners_for(conn: sqlite3.Connection, slug: str) -> list[dict]:
    track = conn.execute("SELECT id FROM track WHERE slug = ?", (slug,)).fetchone()
    if track is None:
        return []
    reference = load_reference(slug)
    if reference is not None:
        freeze_corners(conn, track["id"], reference)
    rows = conn.execute(
        """SELECT idx AS "index", name, s_start, s_apex, s_end, v_apex_kmh
           FROM corner WHERE track_id = ? ORDER BY idx""",
        (track["id"],),
    ).fetchall()
    return [dict(r) for r in rows]
