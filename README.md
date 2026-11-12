<div align="center">

<img src="web/public/favicon.svg" alt="Pit Wall" width="104">

<h1>Pit Wall · LMU Telemetry</h1>

<p><strong>Record Le Mans Ultimate telemetry while you drive, then find out exactly where you lose time.</strong></p>

<p>
50 Hz recorder&nbsp; · &nbsp;corner by corner lap comparison&nbsp; · &nbsp;progression over weeks&nbsp; · &nbsp;pace benchmarks
</p>

<p>
  <img src="https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.12+">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/DuckDB-FFF000?style=for-the-badge&logo=duckdb&logoColor=black" alt="DuckDB">
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Parquet-50ABF1?style=for-the-badge&logo=apache&logoColor=white" alt="Apache Parquet">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 8">
</p>

<p>
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Mantine-339AF0?style=flat-square&logo=mantine&logoColor=white" alt="Mantine">
  <img src="https://img.shields.io/badge/Framer%20Motion-0055FF?style=flat-square&logo=framer&logoColor=white" alt="Framer Motion">
  <img src="https://img.shields.io/badge/charts-Nivo-E8613C?style=flat-square" alt="Nivo charts">
  <img src="https://img.shields.io/badge/NumPy-013243?style=flat-square&logo=numpy&logoColor=white" alt="NumPy">
  <img src="https://img.shields.io/badge/runs-100%25%20locally-0A7EA4?style=flat-square" alt="Runs locally">
  <img src="https://img.shields.io/badge/recorder-Windows-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Platform: Windows">
</p>

<p>
  <a href="#what-it-does"><b>Features</b></a>&nbsp; · &nbsp;
  <a href="#quick-start"><b>Quick start</b></a>&nbsp; · &nbsp;
  <a href="#how-it-works"><b>How it works</b></a>&nbsp; · &nbsp;
  <a href="#pace-benchmarks"><b>Benchmarks</b></a>&nbsp; · &nbsp;
  <a href="#querying-with-duckdb"><b>DuckDB</b></a>&nbsp; · &nbsp;
  <a href="#development"><b>Development</b></a>
</p>

</div>

---

## What it does

- **Recorder** reads the game's native shared memory at the physics rate (50 Hz), detects laps, sectors, invalidations and pit laps, and writes one Parquet file per run when you return to the garage.
- **Analysis** resamples every lap on a fixed distance grid, builds a reference line per circuit, splits the lap into corners and compares any two laps: time delta, speed, inputs, braking points, minimum speeds, ideal lap.
- **Web app** (FastAPI + React) with a synchronised track map and traces, per-corner breakdown and plain-language coaching notes.
- **Progression** over weeks: lap time per session, a corner by session heat map of the time lost against your own best, and the corners to work on first.
- **Pace benchmarks** place your best lap and race pace against community reference times, from Alien down to Offline, with the gap to the next tier.

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
| `lmu benchmarks import FILE.csv` | Add or update pace reference times (see below) |

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

## Pace benchmarks

The Benchmarks tab places your laps against community reference times (`pace_reference` table). The GT3 patch 1.4 set in `src/lmu_agent/references/gt3_patch_1.4.csv` is loaded the first time the database is created. To add another class or a newer patch, write a CSV with the same columns and run `lmu benchmarks import FILE.csv`:

```csv
car_class,track,game_track,patch,hotlap_avg,alien,fastest_car,fastest
GT3,Imola,Autodromo Enzo e Dino Ferrari,1.4+,1:41.87,1:42.38,Corvette Z06 (v1.42),1:41.77
```

Rows are matched on `car_class` and `track`, so re-importing updates them. Times are `m:ss.cc`. `game_track` is the circuit name as the game reports it; leave it blank to keep the value already set. `car_class` must equal the class of your cars in the sessions list. The 101% to 107% columns are computed from `alien`.

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
