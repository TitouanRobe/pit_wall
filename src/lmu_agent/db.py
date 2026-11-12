from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from . import benchmarks
from .config import SQLITE_PATH

SCHEMA_VERSION = 4

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS corner (
    track_id    INTEGER NOT NULL REFERENCES track(id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL,
    name        TEXT NOT NULL,
    s_start     REAL NOT NULL,
    s_apex      REAL NOT NULL,
    s_end       REAL NOT NULL,
    v_apex_kmh  REAL NOT NULL,
    PRIMARY KEY (track_id, idx)
);

CREATE TABLE IF NOT EXISTS track (
    id          INTEGER PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    layout      TEXT,
    length_m    REAL NOT NULL,
    ref_lap_id  INTEGER REFERENCES lap(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS car (
    id     INTEGER PRIMARY KEY,
    slug   TEXT UNIQUE NOT NULL,
    name   TEXT NOT NULL,
    class  TEXT
);

CREATE TABLE IF NOT EXISTS session (
    id            INTEGER PRIMARY KEY,
    started_at    TEXT NOT NULL,
    track_id      INTEGER NOT NULL REFERENCES track(id),
    car_id        INTEGER NOT NULL REFERENCES car(id),
    session_type  TEXT,
    air_temp      REAL,
    track_temp    REAL,
    wetness       REAL,
    game_version  TEXT,
    raw_path      TEXT NOT NULL,
    grid_path     TEXT,
    sample_hz     REAL NOT NULL DEFAULT 50,
    source        TEXT NOT NULL DEFAULT 'live',
    quality_json  TEXT,
    notes         TEXT,
    driver        TEXT,
    hidden        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lap (
    id           INTEGER PRIMARY KEY,
    session_id   INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    lap_number   INTEGER NOT NULL,
    lap_time_ms  INTEGER,
    s1_ms        INTEGER,
    s2_ms        INTEGER,
    s3_ms        INTEGER,
    valid        INTEGER NOT NULL DEFAULT 1,
    is_out_lap   INTEGER NOT NULL DEFAULT 0,
    is_in_lap    INTEGER NOT NULL DEFAULT 0,
    in_grid      INTEGER NOT NULL DEFAULT 0,
    fuel_used    REAL,
    max_speed    REAL,
    UNIQUE (session_id, lap_number)
);

CREATE TABLE IF NOT EXISTS pace_reference (
    id             INTEGER PRIMARY KEY,
    car_class      TEXT NOT NULL,
    track          TEXT NOT NULL,
    game_track     TEXT,
    patch          TEXT NOT NULL,
    hotlap_avg_ms  INTEGER NOT NULL,
    alien_ms       INTEGER NOT NULL,
    fastest_car    TEXT,
    fastest_ms     INTEGER,
    UNIQUE (car_class, track)
);

CREATE INDEX IF NOT EXISTS idx_lap_time ON lap(lap_time_ms) WHERE valid = 1;

DROP VIEW IF EXISTS v_lap;

CREATE VIEW v_lap AS
SELECT l.*, t.slug AS track, t.name AS track_name, c.slug AS car, c.name AS car_name, c.class,
       s.started_at, s.session_type, s.air_temp, s.track_temp, s.wetness, s.raw_path, s.grid_path,
       s.driver, s.hidden
FROM lap l
JOIN session s ON s.id = l.session_id
JOIN track   t ON t.id = s.track_id
JOIN car     c ON c.id = s.car_id;
"""


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


SESSION_COLUMNS_ADDED_IN_V3 = {
    "driver": "TEXT",
    "hidden": "INTEGER NOT NULL DEFAULT 0",
}


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(session)")}
    if not existing:
        return
    for name, definition in SESSION_COLUMNS_ADDED_IN_V3.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE session ADD COLUMN {name} {definition}")


def init_db(db_path: Path = SQLITE_PATH) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = _open(db_path)
    try:
        _migrate(conn)
        conn.executescript(_SCHEMA_SQL)
        benchmarks.seed(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


@contextmanager
def connection(db_path: Path = SQLITE_PATH) -> Iterator[sqlite3.Connection]:
    """One transaction per `with` block: commit on success, rollback on error."""
    init_db(db_path)
    conn = _open(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_track(conn: sqlite3.Connection, slug: str, name: str, length_m: float) -> int:
    row = conn.execute("SELECT id FROM track WHERE slug = ?", (slug,)).fetchone()
    if row:
        return row["id"]
    return conn.execute(
        "INSERT INTO track (slug, name, length_m) VALUES (?, ?, ?)", (slug, name, length_m)
    ).lastrowid


def upsert_car(conn: sqlite3.Connection, slug: str, name: str, car_class: str | None) -> int:
    row = conn.execute("SELECT id FROM car WHERE slug = ?", (slug,)).fetchone()
    if row:
        return row["id"]
    return conn.execute(
        "INSERT INTO car (slug, name, class) VALUES (?, ?, ?)", (slug, name, car_class)
    ).lastrowid


def insert_row(conn: sqlite3.Connection, table: str, values: dict) -> int:
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    return conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values.values())).lastrowid
