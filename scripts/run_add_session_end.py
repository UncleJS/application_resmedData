#!/usr/bin/env python3
"""
run_add_session_end.py
Adds session_end_utc DATETIME column to sleep_sessions and backfills it from
MAX(sample_time_utc) in pld_samples.

Safe to re-run: skips ALTER if the column already exists.
"""
import configparser
import re
from pathlib import Path
import pymysql

cfg = configparser.ConfigParser()
cfg.read(Path(__file__).parent.parent / "config.ini")

conn = pymysql.connect(
    host=cfg["database"]["host"],
    port=int(cfg["database"]["port"]),
    user=cfg["database"]["user"],
    password=cfg["database"]["password"],
    database=cfg["database"]["database"],
    autocommit=True,
)

sql_file = Path(__file__).parent / "add_session_end.sql"
raw = sql_file.read_text()

# Split on semicolons, strip comment lines and blank statements
statements = []
for stmt in raw.split(";"):
    clean = re.sub(r"--[^\n]*", "", stmt).strip()
    if clean:
        statements.append(clean)

print(f"Running {len(statements)} statement(s) …\n")

with conn.cursor() as cur:
    for i, stmt in enumerate(statements, 1):
        m = re.search(r"(ALTER TABLE|UPDATE)\s+(\w+)", stmt, re.IGNORECASE)
        label = f"{m.group(1)} {m.group(2)}" if m else stmt[:60]
        print(f"  [{i}/{len(statements)}] {label} … ", end="", flush=True)
        try:
            cur.execute(stmt)
            affected = cur.rowcount
            print(f"OK  (rows affected: {affected})")
        except pymysql.err.OperationalError as e:
            # 1060 = Duplicate column name (already exists — safe to skip)
            if e.args[0] == 1060:
                print("SKIPPED (column already exists)")
            else:
                print(f"ERROR: {e}")
                raise

conn.close()
print("\nDone.")
