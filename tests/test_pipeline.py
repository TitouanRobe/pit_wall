from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from lmu_agent import db
from lmu_agent.api import app
from lmu_agent.config import DATA_DIR
from lmu_agent.recorder import LiveSession, Snapshot
from lmu_agent.sim import LMUScoringInfo, LMUVehicleScoring, LMUVehicleTelemetry
from lmu_agent.track import detect_corners, freeze_corners

RADIUS = 300.0
LENGTH = 2 * math.pi * RADIUS
DT = 0.02
SCORING_EVERY = 10


def speed_at(s: float, pace: float) -> float:
    """Four corners per lap: speed dips to ~20 m/s and peaks near 60 m/s."""
    return pace * (40.0 + 20.0 * math.cos(4 * 2 * math.pi * s / LENGTH))


def simulate(laps: int, paces: list[float], track: bytes = b"Test Ring") -> tuple[LiveSession, list[float]]:
    tel, veh, info = LMUVehicleTelemetry(), LMUVehicleScoring(), LMUScoringInfo()
    info.mTrackName = track
    info.mLapDist = LENGTH
    info.mSession = 1
    veh.mVehicleName = b"Test Car"
    veh.mVehicleClass = b"GT3"
    veh.mDriverName = b"Test Driver"
    tel.mVehicleModel = b"Test Model"
    tel.mFuel = 80.0

    s, t, lap, lap_start = 0.0, 0.0, 0, 0.0
    true_times: list[float] = []
    session = None
    pool = ThreadPoolExecutor(max_workers=1)
    frame = 0
    while lap < laps:
        v = speed_at(s, paces[lap])
        s_next = s + v * DT
        if s_next >= LENGTH:
            crossing = t + (LENGTH - s) / v
            true_times.append(crossing - lap_start)
            lap, lap_start, s_next = lap + 1, crossing, s_next - LENGTH
        s, t = s_next, t + DT
        angle = s / RADIUS
        tel.mElapsedTime, tel.mLapNumber, tel.mLapStartET = t, lap, lap_start
        tel.mPos.x, tel.mPos.z = RADIUS * math.sin(angle), RADIUS * math.cos(angle)
        tel.mLocalVel.z = -speed_at(s, paces[min(lap, laps - 1)])
        tel.mUnfilteredThrottle = 1.0 if v > 45 else 0.3
        tel.mUnfilteredBrake = 0.8 if 25 < v < 35 and math.sin(8 * math.pi * s / LENGTH) > 0 else 0.0
        tel.mGear = 4
        if frame % SCORING_EVERY == 0:
            info.mCurrentET = t
            veh.mLapDist = s
            if veh.mTotalLaps != lap:
                veh.mLastLapTime = true_times[-1]
            veh.mTotalLaps = lap
        snap = Snapshot(LMUVehicleTelemetry.from_buffer_copy(tel), LMUVehicleScoring.from_buffer_copy(veh),
                        LMUScoringInfo.from_buffer_copy(info), 1)
        session = session or LiveSession(snap, pool)
        session.add(snap)
        frame += 1
    return session, true_times


@pytest.fixture(scope="module")
def recorded():
    session, true_times = simulate(4, [1.0, 1.0, 0.97, 1.0])
    session_id = session.finish()
    return session_id, true_times


def test_lap_times_match_ground_truth(recorded):
    session_id, true_times = recorded
    with db.connection() as conn:
        laps = conn.execute("SELECT lap_number, lap_time_ms, in_grid FROM lap WHERE session_id = ? ORDER BY lap_number",
                            (session_id,)).fetchall()
    timed = {l["lap_number"]: l["lap_time_ms"] for l in laps}
    for n in (1, 2, 3):
        assert timed[n] == pytest.approx(true_times[n] * 1000, abs=2)
    assert {l["lap_number"] for l in laps if l["in_grid"]} == {1, 2, 3}


def test_raw_distance_is_smooth_and_monotonic(recorded):
    session_id, _ = recorded
    with db.connection() as conn:
        raw_path = conn.execute("SELECT raw_path FROM session WHERE id = ?", (session_id,)).fetchone()[0]
    raw = pq.read_table(DATA_DIR / raw_path)
    lap = raw.column("lap_number").to_numpy()
    dist = raw.column("lap_dist_m").to_numpy()
    step = np.diff(dist)[lap[1:] == lap[:-1]]
    assert step.min() >= 0
    assert step.max() < 60.0 * DT * 1.5


def test_grid_end_time_equals_lap_time(recorded):
    session_id, true_times = recorded
    with db.connection() as conn:
        grid_path = conn.execute("SELECT grid_path FROM session WHERE id = ?", (session_id,)).fetchone()[0]
    grid = pq.read_table(DATA_DIR / grid_path)
    lap, s, t = (grid.column(c).to_numpy() for c in ("lap_number", "s", "t_lap"))
    for n in np.unique(lap):
        own = lap == n
        assert t[own][0] == pytest.approx(0.0, abs=1e-3)
        assert t[own][-1] == pytest.approx(true_times[n], abs=0.01)
        assert s[own][-1] == pytest.approx(LENGTH, abs=0.5)


def test_compare_deltas_add_up(recorded):
    _, true_times = recorded
    client = TestClient(app)
    laps = client.get("/api/tracks/test_ring/laps").json()
    by_number = {l["lap_number"]: l["id"] for l in laps}
    result = client.get(f"/api/compare?ref={by_number[1]}&cmp={by_number[2]}").json()
    assert len(result["corners"]) == 4
    assert sum(c["delta_s"] for c in result["corners"]) == pytest.approx(result["delta_s"][-1], abs=2e-3)
    assert result["delta_s"][-1] == pytest.approx(true_times[2] - true_times[1], abs=0.01)


def test_session_detail_has_ideal_lap(recorded):
    session_id, _ = recorded
    detail = TestClient(app).get(f"/api/sessions/{session_id}").json()
    ideal = detail["stats"]["ideal"]
    assert ideal is not None
    assert ideal["time_ms"] <= detail["stats"]["best_ms"]


def test_detect_corners_tiles_the_lap():
    s = np.arange(0, 4000, 5.0)
    speed = 200 - 80 * np.exp(-((s - 800) / 60) ** 2) - 120 * np.exp(-((s - 2500) / 80) ** 2)
    corners = detect_corners(s, speed)
    assert [round(c.s_apex) for c in corners] == [800, 2500]
    assert corners[0].s_start == 0 and corners[-1].s_end == s[-1]
    assert corners[0].s_end == corners[1].s_start


def reference_with_minima(apexes: list[float]) -> pa.Table:
    s = np.arange(0, 4000, 5.0)
    speed = np.full_like(s, 200.0)
    for apex in apexes:
        speed -= 110 * np.exp(-((s - apex) / 70) ** 2)
    return pa.table({"s": s, "ref_speed_kmh": speed})


def test_corner_layout_survives_a_new_reference_line():
    with db.connection() as conn:
        track_id = db.upsert_track(conn, "frozen_ring", "Frozen Ring", 4000.0)
        freeze_corners(conn, track_id, reference_with_minima([800, 2500]))
        first = conn.execute("SELECT idx, s_apex FROM corner WHERE track_id = ? ORDER BY idx", (track_id,)).fetchall()
        freeze_corners(conn, track_id, reference_with_minima([600, 1500, 3000]))
        again = conn.execute("SELECT idx, s_apex FROM corner WHERE track_id = ? ORDER BY idx", (track_id,)).fetchall()
    assert [round(r["s_apex"]) for r in first] == [800, 2500]
    assert [tuple(r) for r in again] == [tuple(r) for r in first]


@pytest.fixture(scope="module")
def two_weeks():
    for pace, start in ((1.0, datetime(2026, 8, 1, 20, 0)), (1.04, datetime(2026, 8, 22, 20, 0))):
        session, _ = simulate(4, [pace] * 4, track=b"Progress Ring")
        session.meta.started_at = start
        session.finish()


def test_progression_tracks_gain_per_session_and_per_corner(two_weeks):
    data = TestClient(app).get("/api/tracks/progress_ring/progression").json()
    first, latest = data["sessions"]
    assert [s["started_at"][:10] for s in data["sessions"]] == ["2026-08-01", "2026-08-22"]
    assert data["summary"]["span_days"] == 21
    assert data["summary"]["latest_best_ms"] < data["summary"]["first_best_ms"]
    assert latest["median_ms"] < first["median_ms"]
    assert len(data["corners"]) == len(data["best_ever_s"]) == len(data["focus"]) == 4
    for before, after in zip(first["corners"], latest["corners"], strict=True):
        assert after["median_s"] < before["median_s"]
    assert all(f["gap_s"] >= 0 and f["trend_s"] < 0 for f in data["focus"])


def test_progression_unknown_track_is_a_404():
    assert TestClient(app).get("/api/tracks/nowhere/progression").status_code == 404


def test_official_lap_time_goes_to_the_lap_it_belongs_to():
    paces = [1.0, 1.004, 0.997, 1.002, 0.999, 1.006, 0.994, 1.001]
    session, true_times = simulate(len(paces), paces)
    assert len(session.laps) == len(true_times)
    for record in session.laps:
        assert record.lap_time_ms == pytest.approx(true_times[record.lap_number] * 1000, abs=2)


def test_driver_name_is_recorded_and_listed(recorded):
    session_id, _ = recorded
    listed = {s["id"]: s for s in TestClient(app).get("/api/sessions").json()}
    assert listed[session_id]["driver"] == "Test Driver"
    assert listed[session_id]["hidden"] is False


def test_hidden_session_leaves_progression_and_lap_library_but_stays_listed(two_weeks):
    client = TestClient(app)
    ids = [s["id"] for s in client.get("/api/sessions").json() if s["track"] == "progress_ring"]
    newest = max(ids)
    assert client.patch(f"/api/sessions/{newest}", json={"hidden": True}).status_code == 204
    try:
        progression = client.get("/api/tracks/progress_ring/progression").json()
        assert [s["session_id"] for s in progression["sessions"]] == [min(ids)]
        assert {lap["session_id"] for lap in client.get("/api/tracks/progress_ring/laps").json()} == {min(ids)}
        listed = {s["id"]: s for s in client.get("/api/sessions").json()}
        assert listed[newest]["hidden"] is True
    finally:
        client.patch(f"/api/sessions/{newest}", json={"hidden": False})
    assert len(client.get("/api/tracks/progress_ring/progression").json()["sessions"]) == 2


def test_hiding_an_unknown_session_is_a_404():
    assert TestClient(app).patch("/api/sessions/999999", json={"hidden": True}).status_code == 404


def test_schema_migration_adds_columns_to_an_existing_database(tmp_path):
    import sqlite3

    path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(path)
    conn.executescript(
        """CREATE TABLE track (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, layout TEXT, length_m REAL, ref_lap_id INTEGER);
           CREATE TABLE car (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, class TEXT);
           CREATE TABLE session (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, track_id INTEGER NOT NULL,
               car_id INTEGER NOT NULL, session_type TEXT, air_temp REAL, track_temp REAL, wetness REAL,
               game_version TEXT, raw_path TEXT NOT NULL, grid_path TEXT, sample_hz REAL NOT NULL DEFAULT 50,
               source TEXT NOT NULL DEFAULT 'live', quality_json TEXT, notes TEXT);
           INSERT INTO session (started_at, track_id, car_id, raw_path) VALUES ('2026-01-01T00:00:00', 1, 1, 'x');"""
    )
    conn.commit()
    conn.close()
    db.init_db(path)
    with db.connection(path) as conn:
        row = conn.execute("SELECT driver, hidden FROM session").fetchone()
        assert row["driver"] is None and row["hidden"] == 0
        conn.execute("SELECT driver, hidden FROM v_lap").fetchall()


def test_benchmarks_are_seeded_once_and_keep_manual_edits():
    from lmu_agent import benchmarks

    with db.connection() as conn:
        conn.execute("UPDATE pace_reference SET game_track = 'Renamed' WHERE track = 'Barcelona'")
    with db.connection() as conn:
        benchmarks.seed(conn)
        rows = conn.execute("SELECT track, game_track FROM pace_reference WHERE car_class = 'GT3'").fetchall()
        conn.execute("UPDATE pace_reference SET game_track = NULL WHERE track = 'Barcelona'")
    assert len(rows) == len(benchmarks.read_csv(benchmarks.BUNDLED_REFERENCES))
    assert dict(rows)["Barcelona"] == "Renamed"


def test_benchmarks_place_laps_against_the_closest_layout(two_weeks):
    client = TestClient(app)
    best = min(s["best_ms"] for s in client.get("/api/sessions").json() if s["track"] == "progress_ring")
    with db.connection() as conn:
        conn.executemany(
            "INSERT INTO pace_reference (car_class, track, game_track, patch, hotlap_avg_ms, alien_ms) VALUES ('GT3', ?, 'Progress Ring', 'test', ?, ?)",
            [("Ring (long)", best * 2, best * 2), ("Ring", best, round(best / 1.02))],
        )
    try:
        driven = {d["track"]: d for d in client.get("/api/benchmarks").json()["driven"]}["progress_ring"]
        references = {r["id"]: r for r in client.get("/api/benchmarks").json()["references"]}
        assert references[driven["reference_id"]]["track"] == "Ring"
        assert driven["best"]["pct"] == pytest.approx(102.0, abs=0.01)
        assert driven["best"]["tier"] == "good"
        assert len(driven["sessions"]) == 2
        assert driven["pace"]["time_ms"] >= driven["best"]["time_ms"]
    finally:
        with db.connection() as conn:
            conn.execute("DELETE FROM pace_reference WHERE patch = 'test'")


def test_tiers_use_the_column_as_the_time_to_beat():
    from lmu_agent.benchmarks import tier_for

    assert [tier_for(p) for p in (99.2, 100.0, 100.4, 102.9, 104.0, 105.5, 106.8, 112.0)] == [
        "alien", "alien", "competitive", "good", "midpack", "tail", "offline", "outside"
    ]


def test_benchmark_csv_import_upserts_and_keeps_game_track(tmp_path):
    from lmu_agent import benchmarks
    from lmu_agent.cli import main

    file = tmp_path / "ref.csv"
    file.write_text(
        "car_class,track,game_track,patch,hotlap_avg,alien,fastest_car,fastest\n"
        "GT3,Imola,,1.5,1:41.00,1:41.50,Test Car,1:41.40\n"
        "LMP2,Spa,Spa-Francorchamps,1.5,2:00.00,2:01.25,,\n"
    )
    main(["benchmarks", "import", str(file)])
    with db.connection() as conn:
        imola = conn.execute("SELECT * FROM pace_reference WHERE car_class = 'GT3' AND track = 'Imola'").fetchone()
        spa = conn.execute("SELECT * FROM pace_reference WHERE car_class = 'LMP2'").fetchone()
        conn.execute("DELETE FROM pace_reference WHERE car_class = 'LMP2'")
    assert imola["alien_ms"] == 101500 and imola["patch"] == "1.5"
    assert imola["game_track"] == "Autodromo Enzo e Dino Ferrari"
    assert spa["alien_ms"] == 121250 and spa["fastest_ms"] is None


@pytest.mark.parametrize(
    "body, message",
    [
        ("GT3,Imola,,1.5,1:41.00,101.5,,\n", "line 2: '101.5' is not a lap time"),
        ("GT3,Imola,,1.5,,1:41.50,,\n", "line 2: missing hotlap_avg"),
        ("GT3,Imola,,1.5,1:41.00,1:41.50,,\nGT3,imola,,1.5,1:41.00,1:41.50,,\n", "line 3: duplicate"),
    ],
)
def test_benchmark_csv_rejects_bad_rows(tmp_path, body, message):
    from lmu_agent import benchmarks

    file = tmp_path / "bad.csv"
    file.write_text("car_class,track,game_track,patch,hotlap_avg,alien,fastest_car,fastest\n" + body)
    with pytest.raises(benchmarks.BenchmarkImportError, match=message):
        benchmarks.read_csv(file)
