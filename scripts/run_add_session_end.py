#!/usr/bin/env python3
"""
run_add_session_end.py
Adds session_end_utc DATETIME column to sleep_sessions and backfills it from
MAX(sample_time_utc) in pld_samples.

Safe to re-run: skips ALTER if the column already exists.
"""
import argparse
from pathlib import Path

from sql_runner import DEFAULT_CONFIG, connect, load_config, run_sql_file

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--config", default=str(DEFAULT_CONFIG), metavar="FILE")
args = parser.parse_args()

conn = connect(load_config(args.config))
run_sql_file(conn, Path(__file__).parent / "add_session_end.sql")
conn.close()
print("\nDone.")
