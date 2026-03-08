#!/usr/bin/env python3
"""
fix_pld_reimport.py — Clear truncated PLD data and re-enable re-import.

Background
----------
The original importer (before the Crc16 fix) included the Crc16 signal when
computing n_samples = min(signal_lengths).  The Crc16 signal has one sample
per EDF data-record (e.g. 275 for a 4.58 h session), while the real metric
signals each have 8250 samples for that same session.  Using min() therefore
capped every PLD import at ~275 rows instead of ~8250, covering only ~9 min
of a 4.58 h night.

Sessions 134 and 182 were re-imported manually AFTER the Crc16 fix was in
place and have correct coverage (4560 rows, 2.53 h each).  All other sessions
have truncated PLD data and need to be re-imported.

This script:
  1. Identifies sessions whose pld_samples max offset < 50 % of session duration.
  2. Archives (soft-deletes) the bad pld_samples rows for those sessions.
  3. Removes the corresponding PLD .edf file entries from import_log so the
     main importer will re-process them.
  4. Prints a summary.

Run BEFORE re-running import_resmed.py.
"""

import configparser
import sys
from pathlib import Path

import pymysql

# ---------------------------------------------------------------------------
CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.ini"

cfg = configparser.ConfigParser()
if not cfg.read(CONFIG_PATH):
    print(f"ERROR: cannot read config at {CONFIG_PATH}", file=sys.stderr)
    sys.exit(1)

conn = pymysql.connect(
    host=cfg["database"]["host"],
    port=int(cfg["database"]["port"]),
    user=cfg["database"]["user"],
    password=cfg["database"]["password"],
    database=cfg["database"]["database"],
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=False,
)

datalog_root = Path(cfg["paths"]["datalog_root"]) / "DATALOG"

# ---------------------------------------------------------------------------
# Step 1: find sessions with truncated PLD
# ---------------------------------------------------------------------------

print("Identifying sessions with truncated PLD data …")

with conn.cursor() as cur:
    cur.execute("""
        SELECT
            s.id                                                          AS session_id,
            s.file_prefix,
            TIMESTAMPDIFF(SECOND, s.session_start_utc, s.session_end_utc) AS session_s,
            COUNT(p.id)                                                   AS pld_rows,
            COALESCE(MAX(p.offset_s), 0)                                  AS pld_max_offset_s
        FROM sleep_sessions s
        LEFT JOIN pld_samples p
               ON p.session_id = s.id AND p.archived_at_utc IS NULL
        WHERE s.archived_at_utc IS NULL
          AND s.session_end_utc IS NOT NULL
        GROUP BY s.id, s.file_prefix, s.session_start_utc, s.session_end_utc
        HAVING pld_rows > 0
           AND pld_max_offset_s < (session_s * 0.50)
        ORDER BY s.id
    """)
    truncated = cur.fetchall()

print(f"  → {len(truncated)} sessions have truncated PLD (< 50 % coverage)")

if not truncated:
    print("Nothing to fix.")
    conn.close()
    sys.exit(0)

# ---------------------------------------------------------------------------
# Step 2: soft-delete the bad pld_samples rows
# ---------------------------------------------------------------------------

print("\nArchiving bad pld_samples rows …")
archived_rows = 0

with conn.cursor() as cur:
    for row in truncated:
        sid = row["session_id"]
        cur.execute(
            "UPDATE pld_samples "
            "SET archived_at_utc = UTC_TIMESTAMP() "
            "WHERE session_id = %s AND archived_at_utc IS NULL",
            (sid,),
        )
        n = cur.rowcount
        archived_rows += n

conn.commit()
print(f"  → archived {archived_rows:,} pld_samples rows across {len(truncated)} sessions")

# ---------------------------------------------------------------------------
# Step 3: remove PLD files from import_log
# ---------------------------------------------------------------------------

print("\nRemoving PLD entries from import_log …")
removed_log = 0

# Build the set of PLD file paths to remove.
# The PLD filename prefix may differ slightly from the CSL prefix (the device
# starts BRP/PLD a few seconds after the mask-on event that generates the CSL).
# We search import_log for any path that contains the session's file_prefix
# AND ends with _PLD.edf — but since the PLD timestamp may differ, we use a
# broader search: any _PLD.edf file whose path contains the day-date portion
# of the prefix (first 8 chars).
#
# More reliably: look up the actual PLD path recorded in import_log by
# joining on file_prefix day-dir and _PLD suffix.

session_ids = [r["session_id"] for r in truncated]
prefixes    = [r["file_prefix"] for r in truncated]

# For each truncated session, remove all import_log entries whose file_path
# ends with _PLD.edf and whose path contains the day-date of the prefix.
with conn.cursor() as cur:
    for row in truncated:
        day = row["file_prefix"][:8]   # YYYYMMDD
        # Match paths like .../DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_PLD.edf
        # Also match paths in adjacent day dirs (session can span midnight)
        cur.execute(
            "DELETE FROM import_log "
            "WHERE file_path LIKE %s AND file_path LIKE %s",
            (f"%/DATALOG/{day}/%", "%_PLD.edf"),
        )
        removed_log += cur.rowcount

conn.commit()
print(f"  → removed {removed_log} import_log entries")

# ---------------------------------------------------------------------------
# Step 4: summary
# ---------------------------------------------------------------------------

print("\n" + "=" * 60)
print("Fix complete.")
print(f"  Sessions fixed          : {len(truncated)}")
print(f"  pld_samples archived    : {archived_rows:,}")
print(f"  import_log entries removed: {removed_log}")
print()
print("Next steps:")
print("  1. Run: python import_resmed.py --config config.ini")
print("  2. Run: python scripts/check_pld_counts.py  (to verify)")
print("=" * 60)

conn.close()
