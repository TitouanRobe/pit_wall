"""Community pace references per circuit and class, and where the driver's own laps sit against them."""

from __future__ import annotations

import csv
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

import numpy as np

from .analysis import _clean, _timed

RACE_PACE_MIN_LAPS = 3

TIERS = [
    {"key": "alien", "label": "Alien", "max_pct": 100.0},
    {"key": "competitive", "label": "Competitive", "max_pct": 101.0},
    {"key": "good", "label": "Good", "max_pct": 103.0},
    {"key": "midpack", "label": "Midpack", "max_pct": 105.0},
    {"key": "tail", "label": "Tail-ender", "max_pct": 106.0},
    {"key": "offline", "label": "Offline", "max_pct": 107.0},
    {"key": "outside", "label": "Outside 107%", "max_pct": None},
]

BUNDLED_REFERENCES = Path(__file__).parent / "references" / "gt3_patch_1.4.csv"

CSV_COLUMNS = ["car_class", "track", "game_track", "patch", "hotlap_avg", "alien", "fastest_car", "fastest"]
REQUIRED_COLUMNS = ["car_class", "track", "patch", "hotlap_avg", "alien"]
_TIME = re.compile(r"^(\d+):([0-5]\d(?:\.\d{1,3})?)$")


class BenchmarkImportError(ValueError):
    pass


def parse_time(text: str) -> int:
    match = _TIME.match(text.strip())
    if not match:
        raise ValueError(f"'{text}' is not a lap time, expected m:ss.cc")
    return round((int(match[1]) * 60 + float(match[2])) * 1000)


def _row(line: int, raw: dict[str, str | None]) -> dict:
    get = lambda key: (raw.get(key) or "").strip()
    missing = [c for c in REQUIRED_COLUMNS if not get(c)]
    if missing:
        raise BenchmarkImportError(f"line {line}: missing {', '.join(missing)}")
    try:
        fastest = get("fastest")
        return {
            "car_class": get("car_class"),
            "track": get("track"),
            "game_track": get("game_track") or None,
            "patch": get("patch"),
            "hotlap_avg_ms": parse_time(get("hotlap_avg")),
            "alien_ms": parse_time(get("alien")),
            "fastest_car": get("fastest_car") or None,
            "fastest_ms": parse_time(fastest) if fastest else None,
        }
    except ValueError as exc:
        raise BenchmarkImportError(f"line {line}: {exc}") from exc


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        absent = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if absent:
            raise BenchmarkImportError(f"{path.name}: missing column(s) {', '.join(absent)}. Expected {', '.join(CSV_COLUMNS)}")
        rows = [_row(i, raw) for i, raw in enumerate(reader, start=2)]
    seen: set[tuple[str, str]] = set()
    for i, row in enumerate(rows, start=2):
        key = (row["car_class"].casefold(), row["track"].casefold())
        if key in seen:
            raise BenchmarkImportError(f"line {i}: duplicate circuit '{row['track']}' for {row['car_class']}")
        seen.add(key)
    if not rows:
        raise BenchmarkImportError(f"{path.name}: no rows")
    return rows


def import_rows(conn: sqlite3.Connection, rows: list[dict]) -> tuple[int, int]:
    """Insert or update by (car_class, track). A blank game_track keeps the name already set by hand."""
    added = updated = 0
    for row in rows:
        exists = conn.execute(
            "SELECT 1 FROM pace_reference WHERE car_class = ? AND track = ?", (row["car_class"], row["track"])
        ).fetchone()
        conn.execute(
            """INSERT INTO pace_reference (car_class, track, game_track, patch, hotlap_avg_ms, alien_ms, fastest_car, fastest_ms)
               VALUES (:car_class, :track, :game_track, :patch, :hotlap_avg_ms, :alien_ms, :fastest_car, :fastest_ms)
               ON CONFLICT (car_class, track) DO UPDATE SET
                   game_track = COALESCE(excluded.game_track, game_track), patch = excluded.patch,
                   hotlap_avg_ms = excluded.hotlap_avg_ms, alien_ms = excluded.alien_ms,
                   fastest_car = excluded.fastest_car, fastest_ms = excluded.fastest_ms""",
            row,
        )
        added, updated = added + (not exists), updated + bool(exists)
    return added, updated


def seed(conn: sqlite3.Connection) -> None:
    """Load the bundled references into an empty table. Rows edited by hand are never overwritten."""
    if conn.execute("SELECT 1 FROM pace_reference LIMIT 1").fetchone():
        return
    import_rows(conn, read_csv(BUNDLED_REFERENCES))


def tier_for(pct: float | None) -> str | None:
    if pct is None:
        return None
    return next(t["key"] for t in TIERS if t["max_pct"] is None or pct <= t["max_pct"])


def _placed(time_ms: int | None, alien_ms: int | None) -> dict:
    pct = time_ms / alien_ms * 100 if time_ms and alien_ms else None
    return {"time_ms": time_ms, "pct": pct, "tier": tier_for(pct)}


def _norm(name: str | None) -> str:
    return (name or "").strip().casefold()


def _match(refs: list[dict], track: sqlite3.Row, car_class: str, best_ms: int | None) -> dict | None:
    """A game circuit name can cover several layouts: the reference closest to the driver's pace wins."""
    keys = {_norm(track["name"]), _norm(track["slug"])}
    candidates = [r for r in refs if _norm(r["car_class"]) == _norm(car_class) and _norm(r["game_track"] or r["track"]) in keys]
    if not candidates:
        return None
    return min(candidates, key=lambda r: abs(r["alien_ms"] - best_ms) if best_ms else 0)


def overview(conn: sqlite3.Connection) -> dict:
    refs = [dict(r) for r in conn.execute("SELECT * FROM pace_reference ORDER BY car_class, track COLLATE NOCASE")]
    laps = conn.execute(
        "SELECT * FROM v_lap WHERE hidden = 0 AND class IS NOT NULL ORDER BY started_at, lap_number"
    ).fetchall()
    tracks = {r["slug"]: r for r in conn.execute("SELECT * FROM track")}

    by_session: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for lap in laps:
        by_session[lap["session_id"]].append(lap)

    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for session_laps in by_session.values():
        timed = _timed(session_laps)
        if not timed:
            continue
        clean = [l["lap_time_ms"] for l in _clean(timed)]
        head = session_laps[0]
        groups[(head["track"], head["class"])].append({
            "session_id": head["session_id"],
            "started_at": head["started_at"],
            "session_type": head["session_type"],
            "car_name": head["car_name"],
            "laps": len(clean),
            "best_ms": min(l["lap_time_ms"] for l in timed),
            "pace_ms": round(float(np.median(clean))) if len(clean) >= RACE_PACE_MIN_LAPS else None,
        })

    driven = []
    for (slug, car_class), sessions in groups.items():
        best = min(s["best_ms"] for s in sessions)
        ref = _match(refs, tracks[slug], car_class, best)
        alien = ref["alien_ms"] if ref else None
        paces = [s["pace_ms"] for s in sessions if s["pace_ms"]]
        driven.append({
            "track": slug,
            "track_name": tracks[slug]["name"],
            "car_class": car_class,
            "reference_id": ref["id"] if ref else None,
            "best": _placed(best, alien),
            "pace": _placed(min(paces) if paces else None, alien),
            "sessions": [
                {**s, "best": _placed(s.pop("best_ms"), alien), "pace": _placed(s.pop("pace_ms"), alien)} for s in sessions
            ],
        })
    driven.sort(key=lambda d: (d["reference_id"] is None, d["track_name"]))
    return {"tiers": TIERS, "references": refs, "driven": driven}
