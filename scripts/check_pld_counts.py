#!/usr/bin/env python3
"""
Check PLD row counts per session to assess Crc16 truncation damage.
Sessions with 152 rows were truncated by the Crc16 bug.
Sessions with > 152 rows are OK.
"""
import argparse

import pymysql

from sql_runner import DEFAULT_CONFIG, connect, load_config

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--config", default=str(DEFAULT_CONFIG), metavar="FILE")
args = parser.parse_args()

conn = connect(load_config(args.config), cursorclass=pymysql.cursors.DictCursor)

with conn.cursor() as cur:
    cur.execute("""
        SELECT
            s.id            AS session_id,
            s.file_prefix,
            s.session_start_utc,
            COUNT(p.id)     AS pld_rows
        FROM sleep_sessions s
        LEFT JOIN pld_samples p ON p.session_id = s.id
        GROUP BY s.id, s.file_prefix, s.session_start_utc
        ORDER BY s.session_start_utc
    """)
    rows = cur.fetchall()

truncated = [r for r in rows if r["pld_rows"] == 152]
ok        = [r for r in rows if r["pld_rows"] > 152]
empty     = [r for r in rows if r["pld_rows"] == 0]

print(f"Total sessions : {len(rows)}")
print(f"OK (>152 rows) : {len(ok)}")
print(f"Truncated (152): {len(truncated)}")
print(f"Empty (0 rows) : {len(empty)}")

if truncated:
    print("\nTruncated sessions:")
    for r in truncated:
        print(f"  session {r['session_id']:4d}  {r['file_prefix']}  {r['session_start_utc']}  rows={r['pld_rows']}")

if ok:
    print("\nOK sessions:")
    for r in ok:
        print(f"  session {r['session_id']:4d}  {r['file_prefix']}  {r['session_start_utc']}  rows={r['pld_rows']}")

conn.close()
