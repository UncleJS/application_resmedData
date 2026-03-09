#!/usr/bin/env python3
"""
aggregate_brp.py — Populate brp_samples_1s from brp_samples.

Reads 25 Hz raw BRP data (40 ms per sample) and aggregates it into
1-second buckets (min/max/mean for flow and pressure).  The result
is stored in brp_samples_1s which the dashboard uses for overview
waveform rendering without scanning 41 M+ rows.

Usage
-----
  python scripts/aggregate_brp.py --config config.ini [--session SESSION_ID]

Options
-------
  --config FILE        Path to config.ini  (default: config.ini)
  --session ID         Process only this session_id (default: all sessions)
  --force              Re-aggregate sessions that already have rows in brp_samples_1s
  --batch-size N       Rows fetched per DB round-trip (default: 50000)

Idempotency
-----------
  Sessions that already have rows in brp_samples_1s are skipped unless
  --force is passed.  Safe to re-run after new data is imported.
"""

import argparse
import configparser
import logging
import sys
from pathlib import Path

import pymysql

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_FILE = Path(__file__).parent.parent / "aggregate_brp.log"

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("aggregate_brp")
    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    fh = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    return logger

log = setup_logging()

# ---------------------------------------------------------------------------
# Config + DB
# ---------------------------------------------------------------------------

def load_config(path: str) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    if not cfg.read(path):
        log.critical("Config file not found: %s", path)
        sys.exit(1)
    return cfg


def connect(cfg: configparser.ConfigParser) -> pymysql.Connection:
    db = cfg["database"]
    try:
        conn = pymysql.connect(
            host=db["host"], port=int(db["port"]),
            user=db["user"], password=db["password"],
            database=db["database"],
            charset="utf8mb4", autocommit=False,
        )
        log.info("Connected to MariaDB %s@%s/%s", db["user"], db["host"], db["database"])
        return conn
    except pymysql.Error as exc:
        log.critical("Cannot connect: %s", exc)
        sys.exit(1)

# ---------------------------------------------------------------------------
# Core aggregation
# ---------------------------------------------------------------------------

INSERT_SQL = """
INSERT INTO brp_samples_1s
    (session_id, sample_time_utc, offset_s,
     flow_min, flow_max, flow_mean,
     press_min, press_max, press_mean)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

BATCH_INSERT = 500   # rows per executemany


def aggregate_session(conn: pymysql.Connection, session_id: int, batch_size: int) -> int:
    """
    Stream brp_samples for one session, bucket into 1-second groups,
    and insert into brp_samples_1s.  Returns number of rows inserted.
    """
    # Use server-side cursor to avoid loading all 720k rows into RAM at once
    with conn.cursor(pymysql.cursors.SSCursor) as cur:
        cur.execute(
            """
            SELECT offset_ms, flow_l_s, pressure_cmh2o
            FROM   brp_samples
            WHERE  session_id = %s
               AND archived_at_utc IS NULL
            ORDER  BY offset_ms
            """,
            (session_id,),
        )

        buckets: dict[int, list] = {}   # offset_s → [flows, pressures]
        rows_fetched = 0

        while True:
            chunk = cur.fetchmany(batch_size)
            if not chunk:
                break
            rows_fetched += len(chunk)
            for offset_ms, flow, pressure in chunk:
                s = int(offset_ms) // 1000
                if s not in buckets:
                    buckets[s] = [[], []]
                if flow is not None:
                    buckets[s][0].append(flow)
                if pressure is not None:
                    buckets[s][1].append(pressure)

    if not buckets:
        return 0

    # Fetch session_start once for absolute sample_time
    with conn.cursor() as cur:
        cur.execute("SELECT session_start_utc FROM sleep_sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
        if not row:
            return 0
        session_start = row[0]

    import datetime
    out_rows = []
    for offset_s in sorted(buckets):
        flows, pressures = buckets[offset_s]
        sample_time = session_start + datetime.timedelta(seconds=offset_s)
        out_rows.append((
            session_id,
            sample_time,
            offset_s,
            round(min(flows),    4) if flows     else None,
            round(max(flows),    4) if flows     else None,
            round(sum(flows)/len(flows), 4) if flows else None,
            round(min(pressures),4) if pressures else None,
            round(max(pressures),4) if pressures else None,
            round(sum(pressures)/len(pressures), 4) if pressures else None,
        ))

    with conn.cursor() as cur:
        for i in range(0, len(out_rows), BATCH_INSERT):
            cur.executemany(INSERT_SQL, out_rows[i: i + BATCH_INSERT])
    conn.commit()
    return len(out_rows)


def sessions_needing_aggregation(conn: pymysql.Connection,
                                  only_session: int | None,
                                  force: bool) -> list[int]:
    """Return list of session_ids that need aggregation."""
    with conn.cursor() as cur:
        if only_session:
            if force:
                cur.execute("DELETE FROM brp_samples_1s WHERE session_id = %s", (only_session,))
                conn.commit()
            cur.execute(
                "SELECT DISTINCT session_id FROM brp_samples WHERE session_id = %s",
                (only_session,),
            )
        else:
            if force:
                cur.execute("TRUNCATE TABLE brp_samples_1s")
                conn.commit()
                cur.execute("SELECT DISTINCT session_id FROM brp_samples ORDER BY session_id")
            else:
                # Sessions not yet in brp_samples_1s.
                # Driven from sleep_sessions (small table) with an indexed
                # LEFT JOIN anti-join — avoids a full scan of brp_samples
                # (41 M+ rows).  This also serves as the resume marker: any
                # session whose aggregation was interrupted will have 0 rows
                # in brp_samples_1s (commit only happens after the full session
                # is written) and will be picked up automatically on restart.
                cur.execute(
                    """
                    SELECT s.id
                    FROM   sleep_sessions s
                    LEFT JOIN brp_samples_1s x ON x.session_id = s.id
                    WHERE  s.archived_at_utc IS NULL
                      AND  x.session_id IS NULL
                    ORDER  BY s.id
                    """
                )
        return [r[0] for r in cur.fetchall()]

# ---------------------------------------------------------------------------
# Public API — callable from import_resmed.py without argparse / sys.exit
# ---------------------------------------------------------------------------

def run(
    conn: pymysql.Connection,
    logger: logging.Logger,
    only_session: int | None = None,
    force: bool = False,
    batch_size: int = 50_000,
) -> dict:
    """
    Aggregate brp_samples → brp_samples_1s using an existing DB connection.

    Skips sessions that already have rows in brp_samples_1s (idempotent).
    If a previous run was interrupted mid-session the partial work was never
    committed, so that session has 0 rows and will be retried automatically.

    Returns {"sessions_processed": int, "rows_inserted": int, "errors": int}.

    Called by import_resmed.main() after import_datalog(); can also be invoked
    standalone via main() below.  Does NOT close conn.
    """
    sessions = sessions_needing_aggregation(conn, only_session, force)
    if not sessions:
        logger.info("BRP aggregation: nothing to do — all sessions already aggregated")
        return {"sessions_processed": 0, "rows_inserted": 0, "errors": 0}

    logger.info("BRP aggregation: %d session(s) to process", len(sessions))
    total_rows = 0
    errors = 0
    for idx, sid in enumerate(sessions, 1):
        logger.debug("[%d/%d] Aggregating session %d …", idx, len(sessions), sid)
        try:
            n = aggregate_session(conn, sid, batch_size)
            logger.debug("  → %d 1s-bucket rows inserted", n)
            total_rows += n
        except Exception as exc:
            conn.rollback()
            logger.error("  Session %d failed: %s", sid, exc, exc_info=True)
            errors += 1

    return {"sessions_processed": len(sessions), "rows_inserted": total_rows, "errors": errors}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Aggregate brp_samples → brp_samples_1s for dashboard use.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--config",     default="config.ini", metavar="FILE")
    parser.add_argument("--session",    type=int, default=None,
                        help="Aggregate only this session_id")
    parser.add_argument("--force",      action="store_true",
                        help="Re-aggregate even if brp_samples_1s already has rows")
    parser.add_argument("--batch-size", type=int, default=50000, dest="batch_size",
                        help="Rows fetched per round-trip (default: 50000)")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("BRP aggregation started")

    cfg  = load_config(args.config)
    conn = connect(cfg)

    try:
        result = run(conn, log, only_session=args.session, force=args.force,
                     batch_size=args.batch_size)
    finally:
        conn.close()

    if result["sessions_processed"] == 0:
        return  # "nothing to do" already logged by run()

    log.info("=" * 60)
    log.info("Aggregation complete — %d row(s) inserted across %d session(s)",
             result["rows_inserted"], result["sessions_processed"])
    if result["errors"]:
        log.warning("%d session(s) failed — check log for details", result["errors"])


if __name__ == "__main__":
    main()
