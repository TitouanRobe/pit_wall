from __future__ import annotations

import json
import logging
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

from . import db
from .config import DATA_DIR, SAMPLE_HZ
from .grid import build_grid
from .parquet_io import GRID_SCHEMA, RAW_SCHEMA, read_parquet, write_parquet
from .quality import check_session
from .track import build_reference, freeze_corners, save_reference

log = logging.getLogger(__name__)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "unknown"


@dataclass
class SessionMeta:
    started_at: datetime
    track_name: str
    track_length_m: float
    car_name: str
    car_class: str | None = None
    session_type: str | None = None
    air_temp: float | None = None
    track_temp: float | None = None
    wetness: float | None = None
    game_version: str | None = None
    sample_hz: float = SAMPLE_HZ
    source: str = "live"
    notes: str | None = None

    @property
    def track_slug(self) -> str:
        return slugify(self.track_name)

    @property
    def car_slug(self) -> str:
        return slugify(self.car_name)


@dataclass
class LapRecord:
    lap_number: int
    lap_time_ms: int | None = None
    s1_ms: int | None = None
    s2_ms: int | None = None
    s3_ms: int | None = None
    valid: bool = True
    is_out_lap: bool = False
    is_in_lap: bool = False
    fuel_used: float | None = None


def _relative_paths(meta: SessionMeta) -> tuple[str, str]:
    stem = meta.started_at.strftime("%Y-%m-%dT%H-%M-%S")
    partition = f"track={meta.track_slug}/car={meta.car_slug}"
    candidate, n = stem, 1
    while (DATA_DIR / "raw" / partition / f"{candidate}.parquet").exists():
        n += 1
        candidate = f"{stem}_{n}"
    return f"raw/{partition}/{candidate}.parquet", f"grid/{partition}/{candidate}.parquet"


def _sorted_raw(raw: pa.Table) -> pa.Table:
    return raw.select(RAW_SCHEMA.names).cast(RAW_SCHEMA).sort_by([("lap_number", "ascending"), ("session_t_s", "ascending")])


def _max_speed_by_lap(raw: pa.Table) -> dict[int, float]:
    grouped = raw.group_by("lap_number").aggregate([("speed_kmh", "max")])
    return dict(zip(grouped.column("lap_number").to_pylist(), grouped.column("speed_kmh_max").to_pylist()))


def persist_session(meta: SessionMeta, raw: pa.Table, laps: list[LapRecord]) -> int:
    """Write raw + grid Parquet and index the session in SQLite. Returns the session id."""
    raw = _sorted_raw(raw)
    rel_raw, rel_grid = _relative_paths(meta)
    write_parquet(raw, RAW_SCHEMA, DATA_DIR / rel_raw)

    grid = build_grid(raw, meta.track_length_m)
    if grid.table.num_rows:
        write_parquet(grid.table, GRID_SCHEMA, DATA_DIR / rel_grid)
    else:
        rel_grid = None

    by_number = {lap.lap_number: lap for lap in laps}
    for n in grid.lap_times_s:
        by_number.setdefault(n, LapRecord(lap_number=n))
    for lap in by_number.values():
        if lap.lap_time_ms is None and lap.lap_number in grid.lap_times_s:
            lap.lap_time_ms = round(grid.lap_times_s[lap.lap_number] * 1000)

    report = check_session(raw, meta.track_length_m, {n: l.lap_time_ms for n, l in by_number.items()},
                           grid.lap_times_s, meta.sample_hz)
    for w in report.warnings:
        log.warning("quality: %s", w["message"])

    max_speed = _max_speed_by_lap(raw)
    with db.connection() as conn:
        track_id = db.upsert_track(conn, meta.track_slug, meta.track_name, meta.track_length_m)
        car_id = db.upsert_car(conn, meta.car_slug, meta.car_name, meta.car_class)
        session_id = db.insert_row(conn, "session", {
            "started_at": meta.started_at.isoformat(timespec="seconds"),
            "track_id": track_id,
            "car_id": car_id,
            "session_type": meta.session_type,
            "air_temp": meta.air_temp,
            "track_temp": meta.track_temp,
            "wetness": meta.wetness,
            "game_version": meta.game_version,
            "raw_path": rel_raw,
            "grid_path": rel_grid,
            "sample_hz": report.sample_hz or meta.sample_hz,
            "source": meta.source,
            "quality_json": json.dumps(report.to_dict()),
            "notes": meta.notes,
        })
        for lap in sorted(by_number.values(), key=lambda l: l.lap_number):
            db.insert_row(conn, "lap", {
                "session_id": session_id,
                "lap_number": lap.lap_number,
                "lap_time_ms": lap.lap_time_ms,
                "s1_ms": lap.s1_ms,
                "s2_ms": lap.s2_ms,
                "s3_ms": lap.s3_ms,
                "valid": int(lap.valid),
                "is_out_lap": int(lap.is_out_lap),
                "is_in_lap": int(lap.is_in_lap),
                "in_grid": int(lap.lap_number in grid.lap_times_s),
                "fuel_used": lap.fuel_used,
                "max_speed": max_speed.get(lap.lap_number),
            })
        refresh_track_reference(conn, track_id)
    return session_id


def read_lap_grid(grid_path: str, lap_number: int) -> pa.Table:
    table = read_parquet(DATA_DIR / grid_path)
    return table.filter(pc.equal(table.column("lap_number"), lap_number))


def refresh_track_reference(conn: sqlite3.Connection, track_id: int) -> None:
    """Rebuild the track reference line from the fastest clean lap when it changes."""
    best = conn.execute(
        """SELECT l.id, l.lap_number, s.grid_path, t.slug, t.ref_lap_id
           FROM lap l JOIN session s ON s.id = l.session_id JOIN track t ON t.id = s.track_id
           WHERE s.track_id = ? AND l.in_grid = 1 AND l.valid = 1 AND l.is_out_lap = 0 AND l.is_in_lap = 0
           ORDER BY l.lap_time_ms LIMIT 1""",
        (track_id,),
    ).fetchone()
    if best is None or best["id"] == best["ref_lap_id"]:
        return
    reference = build_reference(read_lap_grid(best["grid_path"], best["lap_number"]))
    save_reference(best["slug"], reference)
    freeze_corners(conn, track_id, reference)
    conn.execute("UPDATE track SET ref_lap_id = ? WHERE id = ?", (best["id"], track_id))


def rebuild_derived(redetect_corners: bool = False) -> int:
    """Regenerate every grid and track reference from the immutable raw files.

    Corner layouts are kept by default so progression stays comparable over time."""
    with db.connection() as conn:
        if redetect_corners:
            conn.execute("DELETE FROM corner")
        sessions = conn.execute(
            "SELECT s.id, s.raw_path, s.grid_path, t.length_m, t.slug FROM session s JOIN track t ON t.id = s.track_id"
        ).fetchall()
        conn.execute("UPDATE track SET ref_lap_id = NULL")
        for row in sessions:
            raw = read_parquet(DATA_DIR / row["raw_path"])
            grid = build_grid(raw, row["length_m"])
            rel_grid = row["grid_path"] or row["raw_path"].replace("raw/", "grid/", 1)
            if grid.table.num_rows:
                write_parquet(grid.table, GRID_SCHEMA, DATA_DIR / rel_grid)
            conn.execute("UPDATE session SET grid_path = ? WHERE id = ?", (rel_grid if grid.table.num_rows else None, row["id"]))
            conn.execute("UPDATE lap SET in_grid = 0 WHERE session_id = ?", (row["id"],))
            for n in grid.lap_times_s:
                conn.execute("UPDATE lap SET in_grid = 1 WHERE session_id = ? AND lap_number = ?", (row["id"], n))
        for (track_id,) in conn.execute("SELECT id FROM track").fetchall():
            refresh_track_reference(conn, track_id)
    return len(sessions)


def delete_session(session_id: int) -> None:
    with db.connection() as conn:
        row = conn.execute("SELECT raw_path, grid_path, track_id FROM session WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return
        conn.execute("DELETE FROM session WHERE id = ?", (session_id,))
        refresh_track_reference(conn, row["track_id"])
    for rel in (row["raw_path"], row["grid_path"]):
        if rel:
            Path(DATA_DIR / rel).unlink(missing_ok=True)
