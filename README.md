# Pit Wall · LMU Telemetry

Record Le Mans Ultimate telemetry while you drive, then find out exactly where you lose time.

- **Recorder** reads the game's native shared memory at the physics rate (50 Hz), detects laps, sectors, invalidations and pit laps, and writes one Parquet file per run when you return to the garage.
- **Analysis** resamples every lap on a fixed distance grid, builds a reference line per circuit, splits the lap into corners and compares any two laps: time delta, speed, inputs, braking points, minimum speeds, ideal lap.
- **Web app** (FastAPI + React) with a synchronised track map and traces, per-corner breakdown and plain-language coaching notes.
- **Progression** over weeks: lap time per session, a corner by session heat map of the time lost against your own best, and the corners to work on first.

## Quick start

Requirements: Windows, [uv](https://docs.astral.sh/uv/), Node.js 20+ (only to build the web app).

```bash
uv sync
cd web && npm install && npm run build && cd ..
```

In Le Mans Ultimate, enable *Settings > Gameplay > Enable Plugins*, then:

```bash
uv run lmu record      # leave it running, every run is saved when you return to the garage
uv run lmu serve       # open http://127.0.0.1:8765
```

Other commands:

| Command | Purpose |
| --- | --- |
| `lmu info` | List recorded sessions with best lap and data quality status |
| `lmu import-legacy FILE... --track NAME --car NAME` | Import first-generation JSON captures |
| `lmu rebuild` | Regenerate every grid and track reference from the raw files (add `--corners` to detect the corner layout again) |
| `lmu recover` | Save sessions interrupted by a crash (also runs automatically on `record`) |

## How it works

```
LMU shared memory (LMU_Data)
   │  50 Hz telemetry, ~5 Hz scoring
   ▼
recorder ── RAM buffer, lap state, spool every ~10 min (endurance safety net)
   │  end of run
   ├─► data/raw/track=…/car=…/<start>.parquet    immutable, one file per run
   ├─► data/grid/track=…/car=…/<start>.parquet   derived, regenerable
   ├─► data/index.sqlite                         sessions, laps, quality report
   └─► data/tracks/<track>.parquet               reference line from the fastest clean lap

analysis (DuckDB over Parquet, SQLite for metadata) ─► FastAPI ─► React app
```

Key decisions:

- **Distance is the analysis axis.** `lap_dist_m` comes from the scoring block, which only updates at about 5 Hz. Between updates the recorder dead-reckons with the car's speed and re-anchors on each scoring update, so the 50 Hz trace has a smooth, monotonic distance.
- **Sampling follows the game clock.** The recorder polls every 4 ms and stores a frame only when `mElapsedTime` changes, so each physics frame is captured exactly once.
- **Exact line crossing.** Each lap is resampled together with the tail of the previous lap and the head of the next one. `t_lap` is therefore 0 at `s = 0` and equals the lap time at `s = length`, and the delta at the line is the true lap time difference.
- **Corner layout is frozen per circuit.** It is detected once, from the first reference lap, and stored in SQLite. A faster reference lap later never moves the boundaries, so a corner stays comparable from one week to the next.
- **Corners tile the lap.** Corners are speed minima of the reference lap (chicanes merge). Segment boundaries sit at the speed peak between corners, so per-corner deltas add up to the total delta and straight-line losses are charged to the corner exit that caused them.
- **Raw is never rewritten.** Grids and track references can be deleted and rebuilt with `lmu rebuild`.

Canonical raw columns: `session_t_s, lap_number, lap_dist_m, pos_x, pos_y, pos_z, heading, speed_kmh, throttle_pct, brake_pct, steering_pct, gear, rpm, g_lat, g_long, abs_active, tc_active, in_pits`. Floats are float32, ZSTD level 3 with byte stream split encoding. `g_long > 0` means accelerating, `g_lat > 0` means turning right.

## Querying with DuckDB

```sql
-- Speed and delta between two laps of the same circuit
WITH ref AS (SELECT s, t_lap, speed_kmh FROM 'data/grid/track=x/car=y/A.parquet' WHERE lap_number = 7),
     cmp AS (SELECT s, t_lap, speed_kmh FROM 'data/grid/track=x/car=y/B.parquet' WHERE lap_number = 12)
SELECT ref.s, cmp.t_lap - ref.t_lap AS delta_t, cmp.speed_kmh - ref.speed_kmh AS delta_v
FROM ref JOIN cmp USING (s) ORDER BY ref.s;

-- Minimum speed per 50 m zone across all sessions
SELECT track, FLOOR(lap_dist_m / 50) * 50 AS zone, MIN(speed_kmh) AS vmin
FROM read_parquet('data/raw/*/*/*.parquet', hive_partitioning = true)
GROUP BY ALL ORDER BY ALL;
```

The SQLite view `v_lap` joins laps with their session, track and car.

## Development

```bash
uv run lmu serve --reload          # API on :8765
cd web && npm run dev              # Vite on :5173, proxies /api
uv run python -m pytest            # simulated 50 Hz session with 5 Hz scoring, end to end
```

Planned features are listed in [docs/ROADMAP.md](docs/ROADMAP.md).

`src/lmu_agent/sim/lmu_data.py` is the ctypes mapping of the LMU shared memory interface (MIT, see `sim/LICENSE.txt`).
