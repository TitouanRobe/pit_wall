from __future__ import annotations

import json
import logging
import math
import shutil
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime

import pyarrow as pa

from .config import POLL_INTERVAL_S, SPOOL_DIR, SPOOL_EVERY_FRAMES
from .ingest import LapRecord, SessionMeta, persist_session
from .parquet_io import RAW_SCHEMA, read_parquet, write_parquet
from .sim import LMUScoringInfo, LMUVehicleScoring, LMUVehicleTelemetry, SimInfo

log = logging.getLogger(__name__)

G = 9.80665
MIN_FRAMES = 500
LAP_WRAP_WINDOW_S = 3.0
MAX_BACKWARD_CLAMP_M = 30.0
OFFICIAL_TOLERANCE_MS = 1000
IDLE_TIMEOUT_S = 30.0
SESSION_TYPES = {0: "test"} | {i: "practice" for i in range(1, 5)} | {i: "quali" for i in range(5, 9)} | {
    9: "warmup"} | {i: "race" for i in range(10, 14)}


def _text(raw: bytes) -> str:
    return bytes(raw).split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()


@dataclass
class Snapshot:
    """A consistent copy of the player's structs, taken in one go to limit torn reads."""
    tel: LMUVehicleTelemetry
    veh: LMUVehicleScoring
    info: LMUScoringInfo
    game_version: int

    @classmethod
    def read(cls, sim: SimInfo) -> Snapshot | None:
        data = sim.LMUData
        if not data.telemetry.playerHasVehicle:
            return None
        idx = data.telemetry.playerVehicleIdx
        return cls(
            tel=LMUVehicleTelemetry.from_buffer_copy(data.telemetry.telemInfo[idx]),
            veh=LMUVehicleScoring.from_buffer_copy(data.scoring.vehScoringInfo[idx]),
            info=LMUScoringInfo.from_buffer_copy(data.scoring.scoringInfo),
            game_version=int(data.generic.gameVersion),
        )

    @property
    def key(self) -> tuple:
        return _text(self.info.mTrackName), int(self.info.mSession), _text(self.veh.mVehicleName)


@dataclass
class LapState:
    number: int
    start_et: float
    started_in_pits: bool
    fuel_start: float
    invalidated: bool = False


class LiveSession:
    def __init__(self, snap: Snapshot, spool_pool: ThreadPoolExecutor):
        info, veh, tel = snap.info, snap.veh, snap.tel
        model = _text(tel.mVehicleModel)
        self.key = snap.key
        self.meta = SessionMeta(
            started_at=datetime.now().replace(microsecond=0),
            track_name=_text(info.mTrackName),
            track_length_m=float(info.mLapDist),
            car_name=model or _text(veh.mVehicleName),
            car_class=_text(veh.mVehicleClass) or None,
            session_type=SESSION_TYPES.get(int(info.mSession), "unknown"),
            air_temp=float(info.mAmbientTemp),
            track_temp=float(info.mTrackTemp),
            wetness=float(info.mAvgPathWetness),
            game_version=str(snap.game_version),
            notes=_text(veh.mVehicleName) if model else None,
        )
        self.spool_dir = SPOOL_DIR / self.meta.started_at.strftime("%Y-%m-%dT%H-%M-%S")
        self.spool_pool = spool_pool
        self.spool_count = 0
        self.frames: list[tuple] = []
        self.laps: list[LapRecord] = []
        self.awaiting_official: deque[LapRecord] = deque()
        self.official_times: deque[tuple[float, float, float]] = deque()
        self.lap =LapState(int(tel.mLapNumber), float(tel.mLapStartET), bool(veh.mInPits), float(tel.mFuel))
        self.total_laps = int(veh.mTotalLaps)
        self.scoring_et = -1.0
        self.anchor_dist = float(veh.mLapDist)
        self.anchor_et = float(info.mCurrentET)
        self.last_et = -1.0
        self.last_dist = 0.0
        self.frame_count = 0

    @property
    def length(self) -> float:
        return self.meta.track_length_m

    def _lap_dist(self, et: float, speed_ms: float, lap_start_et: float) -> float:
        """Scoring updates lap distance at ~5 Hz. Between updates we dead-reckon with speed so the
        50 Hz trace has a smooth, monotonic distance axis."""
        d = self.anchor_dist + speed_ms * max(0.0, et - self.anchor_et)
        if et - lap_start_et < LAP_WRAP_WINDOW_S and d > self.length / 2:
            d -= self.length
        d = max(d, 0.0)
        if 0 < self.last_dist - d < MAX_BACKWARD_CLAMP_M:
            d = self.last_dist
        return d

    def _close_lap(self, tel: LMUVehicleTelemetry, veh: LMUVehicleScoring) -> None:
        lap = self.lap
        record = LapRecord(
            lap_number=lap.number,
            lap_time_ms=round((float(tel.mLapStartET) - lap.start_et) * 1000),
            valid=not lap.invalidated,
            is_out_lap=lap.started_in_pits,
            is_in_lap=bool(veh.mInPits),
            fuel_used=round(lap.fuel_start - float(tel.mFuel), 3),
        )
        self.laps.append(record)
        self.awaiting_official.append(record)
        log.info("Lap %d  %s%s", record.lap_number, format_lap_time(record.lap_time_ms),
                 "" if record.valid else "  (invalid)")
        self.lap = LapState(int(tel.mLapNumber), float(tel.mLapStartET), bool(veh.mInPits), float(tel.mFuel))
        self.last_dist = 0.0

    def _pair_official_timing(self) -> None:
        """Telemetry closes a lap and scoring publishes its official times, in either order and a few
        frames apart. Both events come once per lap and in lap order, so they are paired from two queues."""
        while self.awaiting_official and self.official_times:
            record = self.awaiting_official.popleft()
            lap_s, s1, s2 = self.official_times.popleft()
            if lap_s <= 0 or record.lap_time_ms is None or abs(lap_s * 1000 - record.lap_time_ms) > OFFICIAL_TOLERANCE_MS:
                continue
            record.lap_time_ms = round(lap_s * 1000)
            if s1 > 0 and s2 > s1:
                record.s1_ms, record.s2_ms, record.s3_ms = round(s1 * 1000), round((s2 - s1) * 1000), round((lap_s - s2) * 1000)

    def add(self, snap: Snapshot) -> None:
        tel, veh, info = snap.tel, snap.veh, snap.info
        et = float(tel.mElapsedTime)

        if float(info.mCurrentET) != self.scoring_et:
            self.scoring_et = float(info.mCurrentET)
            self.anchor_dist, self.anchor_et = float(veh.mLapDist), self.scoring_et
            if int(veh.mTotalLaps) == self.total_laps + 1:
                self.official_times.append((float(veh.mLastLapTime), float(veh.mLastSector1), float(veh.mLastSector2)))
                self._pair_official_timing()
            self.total_laps = int(veh.mTotalLaps)

        if int(tel.mLapNumber) != self.lap.number:
            self._close_lap(tel, veh)
            self._pair_official_timing()

        in_pits = bool(veh.mInPits)
        self.lap.invalidated |= bool(tel.mLapInvalidated)

        vel, acc, fwd = tel.mLocalVel, tel.mLocalAccel, tel.mOri[2]
        speed_ms = math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
        dist = self._lap_dist(et, speed_ms, float(tel.mLapStartET))
        self.last_dist = dist
        self.last_et = et

        # rF2 local frame: +x left, +z rearward. Exported as g_long > 0 accelerating, g_lat > 0 turning right.
        self.frames.append((
            et, self.lap.number, dist,
            tel.mPos.x, tel.mPos.y, tel.mPos.z, math.atan2(fwd.x, fwd.z),
            speed_ms * 3.6,
            tel.mUnfilteredThrottle * 100.0, tel.mUnfilteredBrake * 100.0, tel.mUnfilteredSteering * 100.0,
            tel.mGear, tel.mEngineRPM,
            -acc.x / G, -acc.z / G,
            bool(tel.mABSActive), bool(tel.mTCActive), in_pits,
        ))
        self.frame_count += 1
        if len(self.frames) >= SPOOL_EVERY_FRAMES:
            self._spool()

    def _frames_table(self, frames: list[tuple]) -> pa.Table:
        columns = list(zip(*frames)) if frames else [[] for _ in RAW_SCHEMA]
        return pa.table({f.name: pa.array(col, type=f.type) for f, col in zip(RAW_SCHEMA, columns)}, schema=RAW_SCHEMA)

    def _spool(self) -> None:
        """Endurance safety net: move buffered frames to disk off the sampling thread."""
        frames, self.frames = self.frames, []
        path = self.spool_dir / f"chunk_{self.spool_count:04d}.parquet"
        self.spool_count += 1
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        state = {"meta": asdict(self.meta) | {"started_at": self.meta.started_at.isoformat()},
                 "laps": [asdict(l) for l in self.laps]}
        (self.spool_dir / "state.json").write_text(json.dumps(state))
        self.spool_pool.submit(write_parquet, self._frames_table(frames), RAW_SCHEMA, path)

    def finish(self) -> int | None:
        self.spool_pool.submit(lambda: None).result()
        if self.frame_count < MIN_FRAMES:
            log.info("Session too short, discarded (%d frames).", self.frame_count)
            shutil.rmtree(self.spool_dir, ignore_errors=True)
            return None
        chunks = [read_parquet(p) for p in sorted(self.spool_dir.glob("chunk_*.parquet"))]
        raw = pa.concat_tables(chunks + [self._frames_table(self.frames)])
        session_id = persist_session(self.meta, raw, self.laps)
        shutil.rmtree(self.spool_dir, ignore_errors=True)
        log.info("Saved session %d: %d laps, %d frames.", session_id, len(self.laps), raw.num_rows)
        return session_id


def format_lap_time(ms: int | None) -> str:
    if ms is None:
        return "-:--.---"
    return f"{ms // 60000}:{(ms % 60000) / 1000:06.3f}"


def recover_spools() -> list[int]:
    """Persist sessions left in the spool by a crash or a killed process."""
    recovered = []
    for directory in sorted(SPOOL_DIR.glob("*")) if SPOOL_DIR.exists() else []:
        state_file = directory / "state.json"
        chunks = sorted(directory.glob("chunk_*.parquet"))
        if not state_file.exists() or not chunks:
            shutil.rmtree(directory, ignore_errors=True)
            continue
        state = json.loads(state_file.read_text())
        meta = SessionMeta(**(state["meta"] | {"started_at": datetime.fromisoformat(state["meta"]["started_at"])}))
        laps = [LapRecord(**l) for l in state["laps"]]
        recovered.append(persist_session(meta, pa.concat_tables([read_parquet(p) for p in chunks]), laps))
        shutil.rmtree(directory)
    return recovered


def _connect() -> SimInfo:
    waiting = False
    while True:
        try:
            return SimInfo()
        except Exception:
            if not waiting:
                log.info("Waiting for Le Mans Ultimate (enable plugins in Settings > Gameplay)...")
                waiting = True
            time.sleep(2.0)


def record_forever() -> None:
    for session_id in recover_spools():
        log.info("Recovered interrupted session %d.", session_id)

    sim = _connect()
    log.info("Connected to LMU shared memory. Drive, sessions are saved when you return to the garage.")
    pool = ThreadPoolExecutor(max_workers=1)
    session: LiveSession | None = None
    last_et, last_change = -1.0, time.monotonic()

    def close() -> None:
        nonlocal session
        if session:
            session.finish()
            session = None

    try:
        while True:
            time.sleep(POLL_INTERVAL_S)
            snap = Snapshot.read(sim)
            if snap is None or snap.veh.mInGarageStall or snap.info.mLapDist <= 0:
                close()
                time.sleep(0.25)
                continue

            et = float(snap.tel.mElapsedTime)
            if et == last_et:
                if time.monotonic() - last_change > IDLE_TIMEOUT_S:
                    close()
                continue
            last_et, last_change = et, time.monotonic()

            if session and (snap.key != session.key or et < session.last_et - 1.0):
                close()
            if session is None:
                session = LiveSession(snap, pool)
                log.info("Recording %s, %s (%s).", session.meta.track_name, session.meta.car_name,
                         session.meta.session_type)
            session.add(snap)
    except KeyboardInterrupt:
        log.info("Stopping.")
    finally:
        close()
        pool.shutdown()
        sim.close()
