from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path


def _cmd_record(args: argparse.Namespace) -> None:
    from .recorder import record_forever
    record_forever()


def _cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn
    uvicorn.run("lmu_agent.api:app", host=args.host, port=args.port, reload=args.reload)


def _cmd_import(args: argparse.Namespace) -> None:
    from .legacy_import import import_legacy_json
    for path in args.files:
        session_id = import_legacy_json(Path(path), args.track, args.car, args.car_class)
        logging.info("Imported %s as session %d.", path, session_id)


def _cmd_rebuild(args: argparse.Namespace) -> None:
    from .ingest import rebuild_derived
    logging.info("Rebuilt grids for %d sessions.", rebuild_derived(args.corners))


def _cmd_recover(args: argparse.Namespace) -> None:
    from .recorder import recover_spools
    logging.info("Recovered %d sessions.", len(recover_spools()))


def _cmd_info(args: argparse.Namespace) -> None:
    from . import db
    from .recorder import format_lap_time
    with db.connection() as conn:
        rows = conn.execute(
            """SELECT s.id, s.started_at, t.name AS track, c.name AS car, s.session_type, s.quality_json,
                      COUNT(l.id) AS laps,
                      MIN(CASE WHEN l.valid = 1 AND l.in_grid = 1 THEN l.lap_time_ms END) AS best
               FROM session s JOIN track t ON t.id = s.track_id JOIN car c ON c.id = s.car_id
               LEFT JOIN lap l ON l.session_id = s.id GROUP BY s.id ORDER BY s.started_at DESC"""
        ).fetchall()
    if not rows:
        print("No sessions recorded yet.")
        return
    print(f"{'ID':>4}  {'Started':<19}  {'Track':<26}  {'Car':<24}  {'Type':<8}  {'Laps':>4}  {'Best':>9}  QC")
    for r in rows:
        warnings = len(json.loads(r["quality_json"] or '{"warnings": []}')["warnings"])
        print(f"{r['id']:>4}  {r['started_at'][:19]:<19}  {r['track'][:26]:<26}  {r['car'][:24]:<24}  "
              f"{(r['session_type'] or '')[:8]:<8}  {r['laps']:>4}  {format_lap_time(r['best']):>9}  "
              f"{'ok' if not warnings else f'{warnings} warn'}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="lmu", description="Le Mans Ultimate telemetry recorder and analysis.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("record", help="Record every session while the game runs.").set_defaults(func=_cmd_record)

    serve = sub.add_parser("serve", help="Start the analysis web app.")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=_cmd_serve)

    imp = sub.add_parser("import-legacy", help="Import first-generation JSON captures.")
    imp.add_argument("files", nargs="+")
    imp.add_argument("--track", required=True, help='Track name, e.g. "Spa-Francorchamps"')
    imp.add_argument("--car", required=True, help='Car name, e.g. "Porsche 911 GT3 R"')
    imp.add_argument("--car-class", default=None)
    imp.set_defaults(func=_cmd_import)

    rebuild = sub.add_parser("rebuild", help="Regenerate grids and track references from raw files.")
    rebuild.add_argument("--corners", action="store_true", help="Also detect the corner layout again.")
    rebuild.set_defaults(func=_cmd_rebuild)
    sub.add_parser("recover", help="Save sessions interrupted by a crash.").set_defaults(func=_cmd_recover)
    sub.add_parser("info", help="List recorded sessions.").set_defaults(func=_cmd_info)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    args.func(args)


if __name__ == "__main__":
    main()
