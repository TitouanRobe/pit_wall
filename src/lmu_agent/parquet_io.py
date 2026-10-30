from __future__ import annotations

import os
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .config import PARQUET_COMPRESSION, PARQUET_COMPRESSION_LEVEL, PARQUET_ROW_GROUP_SIZE

RAW_SCHEMA = pa.schema([
    ("session_t_s", pa.float32()),
    ("lap_number", pa.int16()),
    ("lap_dist_m", pa.float32()),
    ("pos_x", pa.float32()),
    ("pos_y", pa.float32()),
    ("pos_z", pa.float32()),
    ("heading", pa.float32()),
    ("speed_kmh", pa.float32()),
    ("throttle_pct", pa.float32()),
    ("brake_pct", pa.float32()),
    ("steering_pct", pa.float32()),
    ("gear", pa.int8()),
    ("rpm", pa.float32()),
    ("g_lat", pa.float32()),
    ("g_long", pa.float32()),
    ("abs_active", pa.bool_()),
    ("tc_active", pa.bool_()),
    ("in_pits", pa.bool_()),
])

GRID_SCHEMA = pa.schema([
    ("lap_number", pa.int16()),
    ("s", pa.float32()),
    ("t_lap", pa.float32()),
    ("pos_x", pa.float32()),
    ("pos_y", pa.float32()),
    ("pos_z", pa.float32()),
    ("speed_kmh", pa.float32()),
    ("throttle_pct", pa.float32()),
    ("brake_pct", pa.float32()),
    ("steering_pct", pa.float32()),
    ("gear", pa.int8()),
    ("rpm", pa.float32()),
    ("g_lat", pa.float32()),
    ("g_long", pa.float32()),
    ("abs_active", pa.bool_()),
    ("tc_active", pa.bool_()),
])

TRACK_SCHEMA = pa.schema([
    ("s", pa.float32()),
    ("x", pa.float32()),
    ("y", pa.float32()),
    ("z", pa.float32()),
    ("heading", pa.float32()),
    ("curvature", pa.float32()),
    ("ref_speed_kmh", pa.float32()),
])


def _float_columns(schema: pa.Schema) -> list[str]:
    return [f.name for f in schema if pa.types.is_floating(f.type)]


def write_parquet(table: pa.Table, schema: pa.Schema, path: Path) -> None:
    """Write atomically (temp file + rename) so a crash never leaves a truncated Parquet behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    floats = _float_columns(schema)
    pq.write_table(
        table.select(schema.names).cast(schema),
        tmp,
        compression=PARQUET_COMPRESSION,
        compression_level=PARQUET_COMPRESSION_LEVEL,
        row_group_size=PARQUET_ROW_GROUP_SIZE,
        data_page_version="2.0",
        use_dictionary=[n for n in schema.names if n not in floats],
        use_byte_stream_split=floats,
        write_statistics=True,
    )
    os.replace(tmp, path)


def read_parquet(path: Path) -> pa.Table:
    return pq.read_table(path)
