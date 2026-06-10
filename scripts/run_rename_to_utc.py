#!/usr/bin/env python3
"""
run_rename_to_utc.py
Executes scripts/rename_to_utc.sql against the live DB.
Each ALTER TABLE is run individually so a failure is easy to identify.
"""
import argparse
from pathlib import Path

from sql_runner import DEFAULT_CONFIG, connect, load_config, run_sql_file

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--config", default=str(DEFAULT_CONFIG), metavar="FILE")
args = parser.parse_args()

conn = connect(load_config(args.config))
# 1060 = duplicate column (already renamed), 1054 = unknown column
run_sql_file(conn, Path(__file__).parent / "rename_to_utc.sql", skip_codes=(1060, 1054))
conn.close()
print("\nDone.")
