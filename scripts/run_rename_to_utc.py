#!/usr/bin/env python3
"""
run_rename_to_utc.py
Executes scripts/rename_to_utc.sql against the live DB.
Each ALTER TABLE is run individually so a failure is easy to identify.
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

sql_file = Path(__file__).parent / "rename_to_utc.sql"
raw = sql_file.read_text()

# Split on semicolons, drop comments and blanks
statements = []
for stmt in raw.split(";"):
    clean = re.sub(r"--[^\n]*", "", stmt).strip()
    if clean:
        statements.append(clean)

print(f"Running {len(statements)} ALTER TABLE statements …\n")

with conn.cursor() as cur:
    for i, stmt in enumerate(statements, 1):
        # Extract table name for display
        m = re.search(r"ALTER TABLE\s+(\w+)", stmt, re.IGNORECASE)
        table = m.group(1) if m else "?"
        print(f"  [{i:2d}/{len(statements)}] {table} … ", end="", flush=True)
        try:
            cur.execute(stmt)
            print("OK")
        except pymysql.err.OperationalError as e:
            # 1060 = duplicate column (already renamed), 1054 = unknown column
            if e.args[0] in (1060, 1054):
                print(f"SKIPPED ({e.args[1]})")
            else:
                print(f"ERROR: {e}")
                raise

conn.close()
print("\nDone.")
