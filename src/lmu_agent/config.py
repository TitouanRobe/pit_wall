from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("LMU_DATA_DIR", PROJECT_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
GRID_DIR = DATA_DIR / "grid"
TRACKS_DIR = DATA_DIR / "tracks"
SPOOL_DIR = DATA_DIR / ".spool"
SQLITE_PATH = DATA_DIR / "index.sqlite"
WEB_DIST = PROJECT_ROOT / "web" / "dist"

SAMPLE_HZ = 50.0
POLL_INTERVAL_S = 0.004
SPOOL_EVERY_FRAMES = 30_000

PARQUET_COMPRESSION = "zstd"
PARQUET_COMPRESSION_LEVEL = 3
PARQUET_ROW_GROUP_SIZE = 100_000

SHORT_TRACK_MAX_M = 4_000.0


def grid_step_for(track_length_m: float) -> float:
    """Distance step of the resampling grid. Fixed per track so every lap shares the same `s` index."""
    return 2.0 if track_length_m <= SHORT_TRACK_MAX_M else 5.0
