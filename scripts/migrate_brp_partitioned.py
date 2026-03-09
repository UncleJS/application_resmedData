#!/usr/bin/env python3
"""
migrate_brp_partitioned.py — Batch-copy brp_samples → brp_samples_new (partitioned)

Usage:
    python scripts/migrate_brp_partitioned.py --config config.ini [options]

    --config FILE        Path to config.ini (default: config.ini)
    --batch-size N       Rows per batch (default: 100000)
    --create-only        Create brp_samples_new + migration_state, then exit
    --copy-only          Skip create step; resume/start copy only
    --status             Print progress summary and exit

Default (no flags): create tables if needed, then run copy loop.

Resume behaviour
----------------
Progress is stored in migration_state.last_copied_id (survives DB restarts).
On restart the copy loop picks up from WHERE id > last_copied_id automatically.

After the copy is complete, use scripts/cutover_brp_partitioned.sql to do
the atomic RENAME TABLE (≈1 s downtime).
"""

import argparse
import configparser
import logging
import sys
import time

import pymysql

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

DDL_BRP_SAMPLES_NEW = """
CREATE TABLE IF NOT EXISTS brp_samples_new (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id          BIGINT UNSIGNED NOT NULL,
    file_prefix         VARCHAR(15)     NOT NULL,
    sample_time_utc     DATETIME(3)     NOT NULL,
    offset_ms           INT             NOT NULL,
    flow_l_s            FLOAT,
    pressure_cmh2o      FLOAT,
    created_at_utc      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at_utc     DATETIME        NULL     DEFAULT NULL,
    PRIMARY KEY (id, sample_time_utc),
    UNIQUE KEY uq_brp (session_id, sample_time_utc),
    KEY idx_brp_time (sample_time_utc),
    KEY idx_brp_session_time (session_id, sample_time_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  PARTITION BY RANGE (TO_DAYS(sample_time_utc)) (
    PARTITION p2023h1 VALUES LESS THAN (TO_DAYS('2023-07-01')),
    PARTITION p2023h2 VALUES LESS THAN (TO_DAYS('2024-01-01')),
    PARTITION p2024h1 VALUES LESS THAN (TO_DAYS('2024-07-01')),
    PARTITION p2024h2 VALUES LESS THAN (TO_DAYS('2025-01-01')),
    PARTITION p2025h1 VALUES LESS THAN (TO_DAYS('2025-07-01')),
    PARTITION p2025h2 VALUES LESS THAN (TO_DAYS('2026-01-01')),
    PARTITION p2026h1 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p2026h2 VALUES LESS THAN (TO_DAYS('2027-01-01')),
    PARTITION p2027h1 VALUES LESS THAN (TO_DAYS('2027-07-01')),
    PARTITION p2027h2 VALUES LESS THAN (TO_DAYS('2028-01-01')),
    PARTITION p2028h1 VALUES LESS THAN (TO_DAYS('2028-07-01')),
    PARTITION p2028h2 VALUES LESS THAN (TO_DAYS('2029-01-01')),
    PARTITION p2029h1 VALUES LESS THAN (TO_DAYS('2029-07-01')),
    PARTITION p2029h2 VALUES LESS THAN (TO_DAYS('2030-01-01')),
    PARTITION p2030h1 VALUES LESS THAN (TO_DAYS('2030-07-01')),
    PARTITION p2030h2 VALUES LESS THAN (TO_DAYS('2031-01-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
)
"""

DDL_MIGRATION_STATE = """
CREATE TABLE IF NOT EXISTS migration_state (
    migration           VARCHAR(64)      NOT NULL,
    last_copied_id      BIGINT UNSIGNED  NOT NULL DEFAULT 0,
    total_source_rows   BIGINT UNSIGNED  NULL,
    started_at_utc      DATETIME         NULL,
    updated_at_utc      DATETIME         NULL,
    completed_at_utc    DATETIME         NULL,
    PRIMARY KEY (migration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

MIGRATION_KEY = "brp_samples_partition"

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def connect(cfg: configparser.ConfigParser) -> pymysql.connections.Connection:
    """Open a new DB connection from config.ini [database] section."""
    db = cfg["database"]
    return pymysql.connect(
        host=db.get("host", "127.0.0.1"),
        port=int(db.get("port", 3306)),
        user=db["user"],
        password=db["password"],
        database=db["database"],
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=10,
        read_timeout=300,
        write_timeout=300,
    )


def connect_with_retry(cfg: configparser.ConfigParser, max_wait: int = 300) -> pymysql.connections.Connection:
    """Connect with exponential back-off — useful after a DB restart."""
    wait = 5
    total = 0
    while True:
        try:
            conn = connect(cfg)
            log.debug("DB connected")
            return conn
        except pymysql.Error as exc:
            if total >= max_wait:
                log.error("Could not reconnect to DB after %ds: %s", total, exc)
                raise
            log.warning("DB unavailable (%s), retrying in %ds…", exc, wait)
            time.sleep(wait)
            total += wait
            wait = min(wait * 2, 60)


# ---------------------------------------------------------------------------
# Create phase
# ---------------------------------------------------------------------------

def create_tables(conn: pymysql.connections.Connection) -> None:
    """Create brp_samples_new and migration_state if they don't exist."""
    with conn.cursor() as cur:
        log.info("Creating brp_samples_new (if not exists)…")
        cur.execute(DDL_BRP_SAMPLES_NEW)
        log.info("Creating migration_state (if not exists)…")
        cur.execute(DDL_MIGRATION_STATE)

        # Seed a state row if this is the first run
        cur.execute(
            """
            INSERT IGNORE INTO migration_state
                (migration, last_copied_id, started_at_utc, updated_at_utc)
            VALUES (%s, 0, NOW(), NOW())
            """,
            (MIGRATION_KEY,),
        )
        conn.commit()
    log.info("Tables ready.")


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def get_source_auto_increment(conn: pymysql.connections.Connection) -> int:
    """Return AUTO_INCREMENT of brp_samples as a proxy for max id."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT AUTO_INCREMENT
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'brp_samples'
            """
        )
        row = cur.fetchone()
        return int(row[0]) if row and row[0] else 0


def get_source_row_estimate(conn: pymysql.connections.Connection) -> int:
    """Return TABLE_ROWS estimate for brp_samples from information_schema."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT TABLE_ROWS
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'brp_samples'
            """
        )
        row = cur.fetchone()
        return int(row[0]) if row and row[0] else 0


def get_state(conn: pymysql.connections.Connection) -> dict | None:
    """Return the migration_state row as a dict, or None if not seeded."""
    with conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(
            "SELECT * FROM migration_state WHERE migration = %s",
            (MIGRATION_KEY,),
        )
        return cur.fetchone()


def print_status(conn: pymysql.connections.Connection) -> None:
    """Print a human-readable progress summary."""
    state = get_state(conn)
    if state is None:
        print("migration_state table not found or not seeded.")
        print("Run with no flags (or --create-only) to initialise.")
        return

    last_id      = int(state["last_copied_id"] or 0)
    auto_inc     = get_source_auto_increment(conn)
    row_estimate = get_source_row_estimate(conn)
    completed    = state["completed_at_utc"]

    # AUTO_INCREMENT is 1 past the highest assigned id
    max_id_in_source = max(auto_inc - 1, 0)

    print()
    print("=" * 60)
    print(f"  Migration : {MIGRATION_KEY}")
    print(f"  Started   : {state['started_at_utc'] or 'not started'}")
    print(f"  Updated   : {state['updated_at_utc'] or 'n/a'}")
    print(f"  Completed : {completed or 'not yet'}")
    print("-" * 60)
    print(f"  Source rows (estimate) : {row_estimate:>15,}")
    print(f"  Source AUTO_INCREMENT  : {auto_inc:>15,}  (≈ max id + 1)")
    print(f"  Last copied id         : {last_id:>15,}")

    if max_id_in_source > 0:
        pct = min(last_id / max_id_in_source * 100, 100.0)
        remaining_ids = max(max_id_in_source - last_id, 0)
        print(f"  Progress (by id range) : {pct:>14.2f}%")
        print(f"  IDs remaining          : {remaining_ids:>15,}")
    else:
        print("  Progress               : unknown (source table empty?)")

    if completed:
        print()
        print("  *** COPY COMPLETE — ready for cutover ***")
        print("  Run scripts/cutover_brp_partitioned.sql to rename tables.")
    elif last_id == 0:
        print()
        print("  Copy has not started yet.")
    print("=" * 60)
    print()


# ---------------------------------------------------------------------------
# Copy loop
# ---------------------------------------------------------------------------

def get_last_copied_id(conn: pymysql.connections.Connection) -> int:
    state = get_state(conn)
    if state is None:
        raise RuntimeError(
            "migration_state not seeded — run without --copy-only first "
            "to create tables, or use --create-only."
        )
    return int(state["last_copied_id"] or 0)


def copy_batch(
    conn: pymysql.connections.Connection,
    last_id: int,
    batch_size: int,
) -> tuple[int, int]:
    """
    Copy one batch of rows from brp_samples → brp_samples_new.

    Returns (new_last_id, rows_inserted).
    new_last_id == last_id means nothing was copied (end of table).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, file_prefix, sample_time_utc,
                   offset_ms, flow_l_s, pressure_cmh2o,
                   created_at_utc, archived_at_utc
            FROM brp_samples
            WHERE id > %s
            ORDER BY id
            LIMIT %s
            """,
            (last_id, batch_size),
        )
        rows = cur.fetchall()

    if not rows:
        return last_id, 0

    new_last_id = rows[-1][0]  # id is column 0

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT IGNORE INTO brp_samples_new
                (id, session_id, file_prefix, sample_time_utc,
                 offset_ms, flow_l_s, pressure_cmh2o,
                 created_at_utc, archived_at_utc)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )
        inserted = cur.rowcount

        cur.execute(
            """
            UPDATE migration_state
               SET last_copied_id = %s,
                   updated_at_utc = NOW()
             WHERE migration = %s
            """,
            (new_last_id, MIGRATION_KEY),
        )

    conn.commit()
    return new_last_id, inserted


def run_copy(cfg: configparser.ConfigParser, batch_size: int) -> None:
    """Main copy loop with reconnect-on-failure and progress logging."""
    conn = connect_with_retry(cfg)

    try:
        last_id = get_last_copied_id(conn)
    except RuntimeError as exc:
        log.error("%s", exc)
        conn.close()
        sys.exit(1)

    auto_inc = get_source_auto_increment(conn)
    max_id   = max(auto_inc - 1, 0)

    if max_id == 0:
        log.warning("brp_samples appears empty — nothing to copy.")
        conn.close()
        return

    if last_id >= max_id:
        log.info("Copy already complete (last_copied_id=%d, max_id=%d).", last_id, max_id)
        _mark_complete(conn)
        conn.close()
        return

    log.info(
        "Starting copy: last_copied_id=%d, estimated max_id=%d, batch_size=%d",
        last_id, max_id, batch_size,
    )

    total_inserted = 0
    batch_num = 0
    report_every = 10  # log a progress line every N batches

    while True:
        try:
            new_last_id, inserted = copy_batch(conn, last_id, batch_size)
        except pymysql.OperationalError as exc:
            log.warning("DB error (%s) — reconnecting in 10s…", exc)
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(10)
            conn = connect_with_retry(cfg)
            # Re-read last_id from DB in case partial commit happened
            last_id = get_last_copied_id(conn)
            log.info("Resumed from last_copied_id=%d", last_id)
            continue

        if new_last_id == last_id:
            # No more rows
            log.info("No more rows found — copy complete.")
            _mark_complete(conn)
            break

        last_id = new_last_id
        total_inserted += inserted
        batch_num += 1

        if batch_num % report_every == 0:
            pct = min(last_id / max_id * 100, 100.0) if max_id else 0
            log.info(
                "Batch %d: last_id=%d  inserted_this_session=%d  progress=%.1f%%",
                batch_num, last_id, total_inserted, pct,
            )

    log.info(
        "Copy finished. Total inserted this session: %d. last_copied_id=%d",
        total_inserted, last_id,
    )
    conn.close()


def _mark_complete(conn: pymysql.connections.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE migration_state
               SET completed_at_utc = IFNULL(completed_at_utc, NOW()),
                   updated_at_utc   = NOW()
             WHERE migration = %s
            """,
            (MIGRATION_KEY,),
        )
    conn.commit()
    log.info("migration_state marked complete.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Batch-copy brp_samples → brp_samples_new (partitioned).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--config",      default="config.ini", metavar="FILE",
                   help="Path to config.ini (default: config.ini)")
    p.add_argument("--batch-size",  default=100_000, type=int, metavar="N",
                   help="Rows per batch (default: 100000)")
    p.add_argument("--create-only", action="store_true",
                   help="Create tables only, do not copy")
    p.add_argument("--copy-only",   action="store_true",
                   help="Skip create step; resume/start copy only")
    p.add_argument("--status",      action="store_true",
                   help="Print progress summary and exit")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    cfg = configparser.ConfigParser()
    if not cfg.read(args.config):
        log.error("Cannot read config file: %s", args.config)
        sys.exit(1)

    if "database" not in cfg:
        log.error("config.ini missing [database] section.")
        sys.exit(1)

    conn = connect_with_retry(cfg)

    if args.status:
        print_status(conn)
        conn.close()
        return

    if not args.copy_only:
        create_tables(conn)

    conn.close()

    if args.create_only:
        log.info("--create-only: tables created. Run without --create-only to start copying.")
        return

    # Default or --copy-only: run the copy loop
    run_copy(cfg, args.batch_size)


if __name__ == "__main__":
    main()
