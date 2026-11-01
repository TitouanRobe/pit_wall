from __future__ import annotations

import json
import sqlite3
from datetime import datetime

import duckdb
import numpy as np

from .config import DATA_DIR
from .track import corners_for, load_reference

TRACE_COLUMNS = ["s", "t_lap", "pos_x", "pos_z", "speed_kmh", "throttle_pct", "brake_pct", "steering_pct", "gear",
                 "rpm", "g_lat", "g_long", "abs_active", "tc_active"]
BRAKE_ON_PCT = 5.0
THROTTLE_FULL_PCT = 95.0
CLEAN_LAP_FACTOR = 1.07


class NotFound(LookupError):
    pass


def _lap_row(conn: sqlite3.Connection, lap_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM v_lap WHERE id = ?", (lap_id,)).fetchone()
    if row is None or not row["in_grid"]:
        raise NotFound(f"Lap {lap_id} has no resampled trace.")
    return row


def lap_trace(lap: sqlite3.Row) -> dict[str, np.ndarray]:
    cols = ", ".join(TRACE_COLUMNS)
    rel = duckdb.sql(
        f"SELECT {cols} FROM read_parquet($path) WHERE lap_number = $lap ORDER BY s",
        params={"path": str(DATA_DIR / lap["grid_path"]), "lap": lap["lap_number"]},
    )
    return {name: arr for name, arr in rel.fetchnumpy().items()}


def _first_index(mask: np.ndarray) -> int | None:
    hits = np.flatnonzero(mask)
    return int(hits[0]) if hits.size else None


def _corner_metrics(trace: dict[str, np.ndarray], corner: dict) -> dict:
    s = trace["s"]
    seg = (s >= corner["s_start"]) & (s <= corner["s_end"])
    approach = seg & (s <= corner["s_apex"])
    exit_ = seg & (s >= corner["s_apex"])
    t = trace["t_lap"]
    speed = trace["speed_kmh"]

    brake_idx = _first_index(approach & (trace["brake_pct"] > BRAKE_ON_PCT))
    seg_idx = np.flatnonzero(seg)
    min_idx = seg_idx[np.argmin(speed[seg])]
    throttle_idx = _first_index(exit_ & (s >= s[min_idx]) & (trace["throttle_pct"] >= THROTTLE_FULL_PCT))
    return {
        "time_s": float(np.interp(corner["s_end"], s, t) - np.interp(corner["s_start"], s, t)),
        "min_speed_kmh": float(speed[min_idx]),
        "min_speed_s": float(s[min_idx]),
        "brake_s": float(s[brake_idx]) if brake_idx is not None else None,
        "peak_brake_pct": float(trace["brake_pct"][seg].max()),
        "full_throttle_s": float(s[throttle_idx]) if throttle_idx is not None else None,
        "exit_speed_kmh": float(np.interp(corner["s_end"], s, speed)),
        "abs_s": float(trace["abs_active"][seg].sum() * np.median(np.diff(s))),
    }


def _insight(name: str, delta: float, ref: dict, cmp: dict) -> str:
    """One-line coaching note, written from the compared lap's point of view."""
    parts = []
    if ref["brake_s"] is not None and cmp["brake_s"] is not None:
        diff = cmp["brake_s"] - ref["brake_s"]
        if abs(diff) >= 5:
            parts.append(f"braked {abs(diff):.0f} m {'later' if diff > 0 else 'earlier'}")
    v_diff = cmp["min_speed_kmh"] - ref["min_speed_kmh"]
    if abs(v_diff) >= 2:
        parts.append(f"minimum speed {abs(v_diff):.0f} km/h {'higher' if v_diff > 0 else 'lower'}")
    if ref["full_throttle_s"] is not None and cmp["full_throttle_s"] is not None:
        diff = cmp["full_throttle_s"] - ref["full_throttle_s"]
        if abs(diff) >= 8:
            parts.append(f"full throttle {abs(diff):.0f} m {'later' if diff > 0 else 'earlier'}")
    e_diff = cmp["exit_speed_kmh"] - ref["exit_speed_kmh"]
    if abs(e_diff) >= 3:
        parts.append(f"exit {abs(e_diff):.0f} km/h {'faster' if e_diff > 0 else 'slower'}")
    verdict = f"{'Lost' if delta > 0 else 'Gained'} {abs(delta):.3f} s in {name}"
    return f"{verdict}: {', '.join(parts)}." if parts else f"{verdict}."


def _round(values: np.ndarray, digits: int) -> list:
    if values.dtype == bool:
        return values.astype(int).tolist()
    return np.round(values.astype(np.float64), digits).tolist()


def _serialize_trace(trace: dict[str, np.ndarray]) -> dict[str, list]:
    digits = {"t_lap": 3, "g_lat": 2, "g_long": 2, "pos_x": 1, "pos_z": 1, "rpm": 0}
    return {k: _round(v, digits.get(k, 1)) for k, v in trace.items()}


def lap_summary(row: sqlite3.Row) -> dict:
    keys = ["id", "session_id", "lap_number", "lap_time_ms", "s1_ms", "s2_ms", "s3_ms", "valid", "is_out_lap",
            "is_in_lap", "in_grid", "fuel_used", "max_speed", "track", "track_name", "car", "car_name", "class",
            "started_at", "session_type", "driver"]
    return {k: row[k] for k in keys}


def compare_laps(conn: sqlite3.Connection, ref_id: int, cmp_id: int) -> dict:
    ref_row, cmp_row = _lap_row(conn, ref_id), _lap_row(conn, cmp_id)
    if ref_row["track"] != cmp_row["track"]:
        raise ValueError("Both laps must be on the same track.")
    ref, cmp = lap_trace(ref_row), lap_trace(cmp_row)
    n = min(ref["s"].size, cmp["s"].size)
    ref, cmp = {k: v[:n] for k, v in ref.items()}, {k: v[:n] for k, v in cmp.items()}

    corners = []
    for corner in corners_for(conn, ref_row["track"]):
        rm, cm = _corner_metrics(ref, corner), _corner_metrics(cmp, corner)
        delta = cm["time_s"] - rm["time_s"]
        corners.append(corner | {"ref": rm, "cmp": cm, "delta_s": delta, "insight": _insight(corner["name"], delta, rm, cm)})

    return {
        "track": ref_row["track"],
        "ref": lap_summary(ref_row) | {"trace": _serialize_trace(ref)},
        "cmp": lap_summary(cmp_row) | {"trace": _serialize_trace(cmp)},
        "delta_s": _round(cmp["t_lap"] - ref["t_lap"], 3),
        "corners": corners,
        "insights": [c["insight"] for c in sorted(corners, key=lambda c: -abs(c["delta_s"]))[:3]],
    }


def track_map(conn: sqlite3.Connection, slug: str) -> dict | None:
    ref = load_reference(slug)
    if ref is None:
        return None
    return {
        "s": _round(ref.column("s").to_numpy(), 1),
        "x": _round(ref.column("x").to_numpy(), 1),
        "z": _round(ref.column("z").to_numpy(), 1),
        "corners": corners_for(conn, slug),
    }


def _segment_times(trace: dict[str, np.ndarray], corners: list[dict]) -> list[float]:
    s, t = trace["s"], trace["t_lap"]
    return [float(np.interp(c["s_end"], s, t) - np.interp(c["s_start"], s, t)) for c in corners]


def _timed(laps: list[sqlite3.Row]) -> list[sqlite3.Row]:
    return [l for l in laps if l["valid"] and l["lap_time_ms"] and l["in_grid"] and not (l["is_out_lap"] or l["is_in_lap"])]


def _clean(timed: list[sqlite3.Row]) -> list[sqlite3.Row]:
    best = min((l["lap_time_ms"] for l in timed), default=None)
    return [l for l in timed if l["lap_time_ms"] <= best * CLEAN_LAP_FACTOR] if best else []


def session_detail(conn: sqlite3.Connection, session_id: int) -> dict:
    session = conn.execute(
        """SELECT s.*, t.slug AS track, t.name AS track_name, t.length_m, c.slug AS car, c.name AS car_name, c.class
           FROM session s JOIN track t ON t.id = s.track_id JOIN car c ON c.id = s.car_id WHERE s.id = ?""",
        (session_id,),
    ).fetchone()
    if session is None:
        raise NotFound(f"Session {session_id} not found.")
    laps = conn.execute("SELECT * FROM v_lap WHERE session_id = ? ORDER BY lap_number", (session_id,)).fetchall()

    timed = _timed(laps)
    best = min((l["lap_time_ms"] for l in timed), default=None)
    clean = [l["lap_time_ms"] for l in _clean(timed)]

    corners = corners_for(conn, session["track"])
    ideal = None
    if corners and timed:
        segments = np.array([_segment_times(lap_trace(l), corners) for l in timed])
        best_segments = segments.min(axis=0)
        ideal = {
            "time_ms": round(float(best_segments.sum()) * 1000),
            "segments": [
                {"name": c["name"], "time_s": float(best_segments[i]),
                 "lap_number": int(timed[int(np.argmin(segments[:, i]))]["lap_number"])}
                for i, c in enumerate(corners)
            ],
        }

    data = dict(session)
    data["quality"] = json.loads(data.pop("quality_json") or "null")
    return {
        "session": data,
        "laps": [lap_summary(l) for l in laps],
        "stats": {
            "best_ms": best,
            "clean_laps": len(clean),
            "mean_ms": round(float(np.mean(clean))) if clean else None,
            "stdev_ms": round(float(np.std(clean, ddof=1))) if len(clean) > 1 else None,
            "ideal": ideal,
        },
    }


def _spread(values: np.ndarray) -> dict:
    return {
        "best_s": float(values.min()),
        "median_s": float(np.median(values)),
        "stdev_s": float(values.std(ddof=1)) if values.size > 1 else None,
    }


def _lap_corner_times(grid_path: str, lap_numbers: list[int], corners: list[dict]) -> np.ndarray:
    data = duckdb.sql(
        "SELECT lap_number, s, t_lap FROM read_parquet($path) ORDER BY lap_number, s",
        params={"path": str(DATA_DIR / grid_path)},
    ).fetchnumpy()
    lap, s, t = data["lap_number"], data["s"], data["t_lap"]
    rows = []
    for number in lap_numbers:
        own = lap == number
        rows.append(_segment_times({"s": s[own], "t_lap": t[own]}, corners))
    return np.array(rows)


def track_progression(conn: sqlite3.Connection, slug: str, car: str | None = None) -> dict:
    """Session by session evolution of lap time and of every corner, for one car on one track."""
    track = conn.execute("SELECT * FROM track WHERE slug = ?", (slug,)).fetchone()
    corners = corners_for(conn, slug) if track else []
    if not corners:
        raise NotFound(f"No corner map for {slug} yet. Record a clean lap first.")
    cars = conn.execute(
        """SELECT c.slug, c.name, COUNT(*) AS sessions
           FROM session s JOIN car c ON c.id = s.car_id
           WHERE s.track_id = ? AND s.hidden = 0 AND s.grid_path IS NOT NULL GROUP BY c.id ORDER BY sessions DESC, c.name""",
        (track["id"],),
    ).fetchall()
    if not cars:
        raise NotFound(f"No analysed session on {slug} yet.")
    selected = car or cars[0]["slug"]

    sessions = conn.execute(
        """SELECT s.id, s.started_at, s.session_type, s.grid_path, s.track_temp, c.name AS car_name
           FROM session s JOIN car c ON c.id = s.car_id
           WHERE s.track_id = ? AND c.slug = ? AND s.hidden = 0 AND s.grid_path IS NOT NULL ORDER BY s.started_at""",
        (track["id"], selected),
    ).fetchall()

    entries = []
    for session in sessions:
        laps = conn.execute("SELECT * FROM v_lap WHERE session_id = ? ORDER BY lap_number", (session["id"],)).fetchall()
        timed = _timed(laps)
        clean = _clean(timed)
        if not clean:
            continue
        times = np.array([l["lap_time_ms"] for l in clean], dtype=np.float64)
        per_corner = _lap_corner_times(session["grid_path"], [l["lap_number"] for l in clean], corners)
        entries.append({
            "session_id": session["id"],
            "started_at": session["started_at"],
            "session_type": session["session_type"],
            "track_temp": session["track_temp"],
            "car_name": session["car_name"],
            "laps": len(clean),
            "best_ms": min(l["lap_time_ms"] for l in timed),
            "median_ms": round(float(np.median(times))),
            "stdev_ms": round(float(times.std(ddof=1))) if times.size > 1 else None,
            "corners": [_spread(per_corner[:, i]) for i in range(len(corners))],
        })

    best_ever = [min(e["corners"][i]["best_s"] for e in entries) for i in range(len(corners))] if entries else []
    latest, first = (entries[-1], entries[0]) if entries else (None, None)
    focus = [
        {
            "index": c["index"],
            "name": c["name"],
            "gap_s": latest["corners"][i]["median_s"] - best_ever[i],
            "spread_s": latest["corners"][i]["stdev_s"],
            "trend_s": latest["corners"][i]["median_s"] - first["corners"][i]["median_s"] if latest is not first else None,
        }
        for i, c in enumerate(corners)
    ] if entries else []

    span_days = (datetime.fromisoformat(latest["started_at"]) - datetime.fromisoformat(first["started_at"])).days if entries else 0
    return {
        "track": track["slug"],
        "track_name": track["name"],
        "length_m": track["length_m"],
        "cars": [dict(c) for c in cars],
        "car": selected,
        "corners": corners,
        "sessions": entries,
        "best_ever_s": best_ever,
        "focus": focus,
        "summary": {
            "sessions": len(entries),
            "span_days": span_days,
            "first_best_ms": first["best_ms"] if entries else None,
            "latest_best_ms": latest["best_ms"] if entries else None,
            "best_ms": min((e["best_ms"] for e in entries), default=None),
        },
    }
