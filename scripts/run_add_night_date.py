#!/usr/bin/env python3
"""
run_add_night_date.py
Executes scripts/add_night_date.sql against the live DB, then backfills
night_date in Python.

The backfill uses import_resmed.compute_night_date() with the [display]
timezone from config.ini — the exact computation the importer applies to new
sessions — so backfilled rows always match freshly imported ones, including
in DST-aware timezones.
"""
import argparse
import sys
import zoneinfo
from pathlib import Path

from sql_runner import DEFAULT_CONFIG, REPO_ROOT, connect, load_config, run_sql_file

sys.path.insert(0, str(REPO_ROOT))
from import_resmed import compute_night_date  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--config", default=str(DEFAULT_CONFIG), metavar="FILE")
args = parser.parse_args()

cfg = load_config(args.config)
tz = zoneinfo.ZoneInfo(cfg.get("display", "timezone", fallback="UTC"))

conn = connect(cfg)
run_sql_file(conn, Path(__file__).parent / "add_night_date.sql")

# Backfill in Python (sentinel values left by the ALTER or older runs)
with conn.cursor() as cur:
    cur.execute(
        "SELECT id, session_start_utc FROM sleep_sessions "
        "WHERE night_date IN ('0000-00-00', '2000-01-01')"
    )
    rows = cur.fetchall()
    if rows:
        print(f"Backfilling night_date for {len(rows)} row(s) (timezone: {tz}) … ", end="", flush=True)
        updates = [
            (compute_night_date(start, tz).isoformat(), row_id)
            for row_id, start in rows
        ]
        cur.executemany("UPDATE sleep_sessions SET night_date = %s WHERE id = %s", updates)
        print("OK")
    else:
        print("Backfill: nothing to do")

conn.close()
print("\nDone.")
