from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__, analysis, benchmarks, db
from .config import WEB_DIST
from .ingest import delete_session, set_hidden

app = FastAPI(title="LMU Telemetry", version=__version__)


def get_conn() -> Iterator[sqlite3.Connection]:
    with db.connection() as conn:
        yield conn


Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


SESSION_LIST_SQL = """
SELECT s.id, s.started_at, s.session_type, s.source, s.driver, s.hidden, s.track_temp, s.air_temp, s.wetness, s.quality_json,
       t.slug AS track, t.name AS track_name, t.length_m, c.slug AS car, c.name AS car_name, c.class,
       COUNT(l.id) AS laps,
       MIN(CASE WHEN l.valid = 1 AND l.in_grid = 1 AND l.is_out_lap = 0 AND l.is_in_lap = 0 THEN l.lap_time_ms END) AS best_ms
FROM session s
JOIN track t ON t.id = s.track_id
JOIN car c ON c.id = s.car_id
LEFT JOIN lap l ON l.session_id = s.id
GROUP BY s.id
ORDER BY s.started_at DESC
"""


@app.get("/api/sessions")
def list_sessions(conn: Conn) -> list[dict]:
    rows = []
    for row in conn.execute(SESSION_LIST_SQL).fetchall():
        item = dict(row)
        quality = json.loads(item.pop("quality_json") or "null")
        item["warnings"] = len(quality["warnings"]) if quality else 0
        item["hidden"] = bool(item["hidden"])
        rows.append(item)
    return rows


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, conn: Conn) -> dict:
    try:
        return analysis.session_detail(conn, session_id)
    except analysis.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


class SessionPatch(BaseModel):
    hidden: bool


@app.patch("/api/sessions/{session_id}", status_code=204)
def patch_session(session_id: int, patch: SessionPatch) -> None:
    if not set_hidden(session_id, patch.hidden):
        raise HTTPException(404, f"Session {session_id} not found.")


@app.delete("/api/sessions/{session_id}", status_code=204)
def remove_session(session_id: int) -> None:
    delete_session(session_id)


@app.get("/api/tracks/{slug}/map")
def get_track_map(slug: str, conn: Conn) -> dict:
    data = analysis.track_map(conn, slug)
    if data is None:
        raise HTTPException(404, f"No reference line for {slug} yet.")
    return data


@app.get("/api/tracks/{slug}/progression")
def track_progression(slug: str, conn: Conn, car: str | None = None) -> dict:
    try:
        return analysis.track_progression(conn, slug, car)
    except analysis.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/tracks/{slug}/laps")
def track_laps(slug: str, conn: Conn) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM v_lap WHERE track = ? AND hidden = 0 AND in_grid = 1 ORDER BY valid DESC, lap_time_ms", (slug,)
    ).fetchall()
    return [analysis.lap_summary(r) for r in rows]


@app.get("/api/benchmarks")
def get_benchmarks(conn: Conn) -> dict:
    return benchmarks.overview(conn)


@app.get("/api/compare")
def compare(ref: int, cmp: int, conn: Conn) -> dict:
    try:
        return analysis.compare_laps(conn, ref, cmp)
    except analysis.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        target = WEB_DIST / path
        return FileResponse(target if path and target.is_file() else WEB_DIST / "index.html")
