"""Import of the first-generation JSON captures (one file, French field names, no distance or time)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pyarrow as pa

from . import db
from .ingest import SessionMeta, persist_session, slugify
from .parquet_io import RAW_SCHEMA
from .track import load_reference

FIELDS = {
    "pos_x": "pos_x",
    "pos_z": "pos_z",
    "speed_kmh": "vitesse_kmh",
    "throttle_pct": "accelerateur_pct",
    "brake_pct": "frein_pct",
    "steering_pct": "volant_pct",
    "gear": "rapport",
    "g_lat": "g_lateral",
    "g_long": "g_longitudinal",
}
GATE_WIDTH_M = 25.0
MIN_LAP_M = 1500.0
MOVING_KMH = 40.0


def _effective_dt(step_m: np.ndarray, speed_kmh: np.ndarray, nominal_dt: float) -> float:
    """The old capture loop slept a fixed 50 ms, so the real rate was lower than declared.
    Distance travelled against reported speed gives the true mean sample period."""
    moving = speed_kmh[1:] > MOVING_KMH
    if moving.sum() < 100:
        return nominal_dt
    return float(step_m[moving].sum() / (speed_kmh[1:][moving] / 3.6).sum())


def _known_length(slug: str) -> float | None:
    with db.connection() as conn:
        row = conn.execute("SELECT length_m FROM track WHERE slug = ?", (slug,)).fetchone()
    return row["length_m"] if row else None


def _gate(slug: str, x: np.ndarray, z: np.ndarray, arc: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Reuse the start of an existing track reference so every import shares the same s = 0.
    Without one, place the gate on track at mid-recording."""
    ref = load_reference(slug)
    if ref is not None:
        rx, rz = ref.column("x").to_numpy(), ref.column("z").to_numpy()
        return np.array([rx[0], rz[0]]), np.array([rx[1] - rx[0], rz[1] - rz[0]])
    i0 = int(np.searchsorted(arc, arc[-1] * 0.5))
    return np.array([x[i0], z[i0]]), np.array([x[i0 + 5] - x[i0 - 5], z[i0 + 5] - z[i0 - 5]])


def _gate_crossings(x: np.ndarray, z: np.ndarray, arc: np.ndarray, point: np.ndarray, direction: np.ndarray) -> np.ndarray:
    """Fractional indices where the car crosses the gate."""
    direction = direction / np.linalg.norm(direction)
    rel = np.stack([x - point[0], z - point[1]], axis=1)
    along = rel @ direction
    lateral = np.abs(rel @ np.array([-direction[1], direction[0]]))

    crossings: list[float] = []
    for i in np.flatnonzero((along[:-1] < 0) & (along[1:] >= 0) & (lateral[:-1] < GATE_WIDTH_M)):
        frac = i + along[i] / (along[i] - along[i + 1])
        if not crossings or np.interp(frac, np.arange(arc.size), arc) - np.interp(crossings[-1], np.arange(arc.size), arc) > MIN_LAP_M:
            crossings.append(frac)
    return np.array(crossings)


def import_legacy_json(path: Path, track_name: str, car_name: str, car_class: str | None = None) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    meta_in, points = payload["metadata"], payload["telemetrie"]
    cols = {k: np.array([p[src] for p in points], dtype=np.float64) for k, src in FIELDS.items()}
    x, z, speed = cols["pos_x"], cols["pos_z"], cols["speed_kmh"]

    step = np.hypot(np.diff(x), np.diff(z))
    arc = np.concatenate(([0.0], np.cumsum(step)))
    dt = _effective_dt(step, speed, 1.0 / float(meta_in.get("frequence_hz", 20)))
    t = np.arange(x.size) * dt

    slug = slugify(track_name)
    crossings = _gate_crossings(x, z, arc, *_gate(slug, x, z, arc))
    if crossings.size < 2:
        raise ValueError(f"{path.name}: fewer than two passes through the same point, cannot rebuild laps.")
    idx = np.arange(arc.size)
    arc_at = np.interp(crossings, idx, arc)
    length = _known_length(slug) or round(float(np.median(np.diff(arc_at))), 1)

    lap_number = np.searchsorted(crossings, idx, side="right").astype(np.int16)
    lap_dist = np.empty_like(arc)
    for n in range(crossings.size + 1):
        own = lap_number == n
        if n == 0:
            lap_dist[own] = length - (arc_at[0] - arc[own])
        elif n < crossings.size:
            scale = length / (arc_at[n] - arc_at[n - 1])
            lap_dist[own] = (arc[own] - arc_at[n - 1]) * scale
        else:
            lap_dist[own] = arc[own] - arc_at[n - 1]
    lap_dist = np.clip(lap_dist, 0.0, None)

    heading = np.arctan2(np.gradient(x), np.gradient(z))
    n = x.size
    raw = pa.table({
        "session_t_s": t,
        "lap_number": lap_number,
        "lap_dist_m": lap_dist,
        "pos_x": x,
        "pos_y": np.zeros(n),
        "pos_z": z,
        "heading": heading,
        "speed_kmh": speed,
        "throttle_pct": cols["throttle_pct"],
        "brake_pct": cols["brake_pct"],
        "steering_pct": cols["steering_pct"],
        "gear": cols["gear"].astype(np.int8),
        "rpm": np.zeros(n),
        "g_lat": -cols["g_lat"],
        "g_long": -cols["g_long"],
        "abs_active": np.zeros(n, dtype=bool),
        "tc_active": np.zeros(n, dtype=bool),
        "in_pits": np.zeros(n, dtype=bool),
    }).cast(RAW_SCHEMA)

    started = datetime.strptime(meta_in["date"], "%Y%m%d_%H%M%S") if "date" in meta_in else datetime.now()
    meta = SessionMeta(
        started_at=started,
        track_name=track_name,
        track_length_m=length,
        car_name=car_name,
        car_class=car_class,
        session_type="practice",
        sample_hz=round(1.0 / dt, 2),
        source="legacy_json",
        notes=f"Imported from {path.name}. Distance, laps and timing rebuilt from positions "
              f"(effective rate {1.0 / dt:.1f} Hz, lap gate inferred).",
    )
    return persist_session(meta, raw, [])
