#!/usr/bin/env python3
"""
import_resmed.py — ResMed SD-card sleep data → MariaDB importer.

Supported file types
--------------------
  STR.edf          Master daily summary (one record per calendar day)
  DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_CSL.edf  Session-level summary (EDF+D)
  DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_EVE.edf  Scored events (EDF+D annotations)
  DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_PLD.edf  2-second poly-somnographic metrics
  DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_SAD.edf  1-second oximetry (SpO2 / Pulse)
  DATALOG/YYYYMMDD/YYYYMMDD_HHMMSS_BRP.edf  25 Hz flow + pressure waveforms

Usage
-----
  python import_resmed.py --config config.ini
"""

import argparse
import configparser
import datetime
import logging
import logging.handlers
import os
import re
import struct
import sys
import zoneinfo
from collections import defaultdict
from pathlib import Path

import pymysql
import pyedflib

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EPOCH = datetime.date(1970, 1, 1)
BATCH_SIZE = 1000          # rows per executemany() call
LOG_FILE   = Path(__file__).with_suffix(".log")

# EDF+D TAL delimiters
TAL_SEP_ONSET    = b"\x14"   # separates onset / duration / annotation
TAL_SEP_RECORD   = b"\x00"   # separates records within a data-record
TAL_NEG_ONSET    = b"\x15"   # marks a negative onset value

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("resmed_import")
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File handler — full detail, append across runs
    fh = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    # Console handler — INFO and above only
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    return logger


log = setup_logging()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_config(path: str) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    if not cfg.read(path):
        log.critical("Config file not found: %s", path)
        sys.exit(1)

    required = {
        "database": ["host", "port", "user", "password", "database"],
        "paths":    ["datalog_root"],
    }
    for section, keys in required.items():
        if not cfg.has_section(section):
            log.critical("Config missing section [%s]", section)
            sys.exit(1)
        for key in keys:
            if not cfg.has_option(section, key):
                log.critical("Config [%s] missing key: %s", section, key)
                sys.exit(1)

    root = Path(cfg["paths"]["datalog_root"])
    if not root.is_dir():
        log.critical("datalog_root does not exist: %s", root)
        sys.exit(1)

    # Validate optional date limits
    for key in ("date_from", "date_to"):
        val = cfg.get("import", key, fallback="").strip()
        if val:
            try:
                datetime.date.fromisoformat(val)
            except ValueError:
                log.critical("Config [import] %s is not a valid YYYY-MM-DD date: %r", key, val)
                sys.exit(1)

    # Validate [display] timezone — must be a valid IANA name
    tz_name = cfg.get("display", "timezone", fallback="UTC").strip()
    try:
        zoneinfo.ZoneInfo(tz_name)
    except zoneinfo.ZoneInfoNotFoundError:
        log.critical("Config [display] timezone is not a valid IANA name: %r", tz_name)
        sys.exit(1)

    log.info("Config loaded from %s (timezone: %s)", path, tz_name)
    return cfg


def get_date_limits(cfg: configparser.ConfigParser) -> tuple[datetime.date | None, datetime.date | None]:
    """Return (date_from, date_to) from [import] section, or (None, None) if not set."""
    date_from = date_to = None
    val_from = cfg.get("import", "date_from", fallback="").strip()
    val_to   = cfg.get("import", "date_to",   fallback="").strip()
    if val_from:
        date_from = datetime.date.fromisoformat(val_from)
    if val_to:
        date_to = datetime.date.fromisoformat(val_to)
    return date_from, date_to


# ---------------------------------------------------------------------------
# Database connection and schema
# ---------------------------------------------------------------------------

def connect(cfg: configparser.ConfigParser) -> pymysql.Connection:
    db = cfg["database"]
    try:
        conn = pymysql.connect(
            host=db["host"],
            port=int(db["port"]),
            user=db["user"],
            password=db["password"],
            database=db["database"],
            charset="utf8mb4",
            autocommit=False,
        )
        log.info("Connected to MariaDB %s@%s/%s", db["user"], db["host"], db["database"])
        return conn
    except pymysql.Error as exc:
        log.critical("Cannot connect to database: %s", exc)
        sys.exit(1)


DDL_STATEMENTS = [
    # ------------------------------------------------------------------
    # import_log — idempotency tracker
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS import_log (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        file_path     VARCHAR(1024)   NOT NULL,
        file_size     BIGINT UNSIGNED NOT NULL,
        file_mtime    DOUBLE          NOT NULL,
        imported_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_import_log_path (file_path(768))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # daily_summary — one row per calendar day (from STR.edf)
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS daily_summary (
        id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        summary_date        DATE            NOT NULL,
        -- Session timing
        duration_min        FLOAT           COMMENT 'Total therapy duration (minutes)',
        on_duration_min     FLOAT           COMMENT 'Time mask was on (minutes)',
        patient_hours       FLOAT           COMMENT 'Cumulative patient hours',
        mask_events         INT             COMMENT 'Number of mask-on/off events',
        -- Apnea-Hypopnea Index breakdown
        ahi                 FLOAT           COMMENT 'Apnea-Hypopnea Index (events/hr)',
        ai                  FLOAT           COMMENT 'Apnea Index (events/hr)',
        hi                  FLOAT           COMMENT 'Hypopnea Index (events/hr)',
        oai                 FLOAT           COMMENT 'Obstructive Apnea Index (events/hr)',
        cai                 FLOAT           COMMENT 'Central Apnea Index (events/hr)',
        uai                 FLOAT           COMMENT 'Unclassified Apnea Index (events/hr)',
        csr                 FLOAT           COMMENT 'Cheyne-Stokes Respiration (minutes)',
        -- Pressure (cmH2O)
        mask_press_50       FLOAT           COMMENT 'Mask pressure 50th percentile',
        mask_press_95       FLOAT           COMMENT 'Mask pressure 95th percentile',
        mask_press_max      FLOAT           COMMENT 'Mask pressure maximum',
        tgt_ipap_50         FLOAT           COMMENT 'Target IPAP 50th percentile',
        tgt_ipap_95         FLOAT           COMMENT 'Target IPAP 95th percentile',
        tgt_ipap_max        FLOAT           COMMENT 'Target IPAP maximum',
        tgt_epap_50         FLOAT           COMMENT 'Target EPAP 50th percentile',
        tgt_epap_95         FLOAT           COMMENT 'Target EPAP 95th percentile',
        tgt_epap_max        FLOAT           COMMENT 'Target EPAP maximum',
        blow_press_95       FLOAT           COMMENT 'Blower pressure 95th percentile',
        blow_press_5        FLOAT           COMMENT 'Blower pressure 5th percentile',
        -- Flow (L/s)
        flow_95             FLOAT           COMMENT 'Flow 95th percentile (L/s)',
        flow_5              FLOAT           COMMENT 'Flow 5th percentile (L/s)',
        blow_flow_50        FLOAT           COMMENT 'Blower flow median (L/min)',
        -- Leak (L/s)
        leak_50             FLOAT           COMMENT 'Leak 50th percentile (L/s)',
        leak_70             FLOAT           COMMENT 'Leak 70th percentile (L/s)',
        leak_95             FLOAT           COMMENT 'Leak 95th percentile (L/s)',
        leak_max            FLOAT           COMMENT 'Leak maximum (L/s)',
        -- Ventilation
        min_vent_50         FLOAT           COMMENT 'Minute ventilation median (L/min)',
        min_vent_95         FLOAT           COMMENT 'Minute ventilation 95th percentile (L/min)',
        min_vent_max        FLOAT           COMMENT 'Minute ventilation maximum (L/min)',
        resp_rate_50        FLOAT           COMMENT 'Respiratory rate median (bpm)',
        resp_rate_95        FLOAT           COMMENT 'Respiratory rate 95th percentile (bpm)',
        resp_rate_max       FLOAT           COMMENT 'Respiratory rate maximum (bpm)',
        tid_vol_50          FLOAT           COMMENT 'Tidal volume median (L)',
        tid_vol_95          FLOAT           COMMENT 'Tidal volume 95th percentile (L)',
        tid_vol_max         FLOAT           COMMENT 'Tidal volume maximum (L)',
        -- Oximetry
        spo2_50             FLOAT           COMMENT 'SpO2 median (%)',
        spo2_95             FLOAT           COMMENT 'SpO2 95th percentile (%)',
        spo2_max            FLOAT           COMMENT 'SpO2 maximum (%)',
        spo2_thresh_min     FLOAT           COMMENT 'Time SpO2 below threshold (minutes)',
        -- Humidifier / climate
        amb_humidity_50     FLOAT           COMMENT 'Ambient humidity median (mg/L)',
        hum_temp_50         FLOAT           COMMENT 'Humidifier temperature median (°C)',
        htube_temp_50       FLOAT           COMMENT 'Heated tube temperature median (°C)',
        htube_pow_50        FLOAT           COMMENT 'Heated tube power median (%)',
        hum_pow_50          FLOAT           COMMENT 'Humidifier power median (%)',
        -- Device settings snapshot
        mode                INT             COMMENT 'Therapy mode code',
        s_ramp_enable       INT,
        s_ramp_time_min     FLOAT,
        s_c_start_press     FLOAT,
        s_c_press           FLOAT,
        s_epr_clin_enable   INT,
        s_epr_enable        INT,
        s_epr_level         FLOAT,
        s_epr_type          INT,
        s_as_comfort        INT,
        s_as_start_press    FLOAT,
        s_as_max_press      FLOAT,
        s_as_min_press      FLOAT,
        s_smart_start       INT,
        s_pt_access         INT,
        s_ab_filter         INT,
        s_mask              INT,
        s_tube              INT,
        s_climate_control   INT,
        s_hum_enable        INT,
        s_hum_level         FLOAT,
        s_temp_enable       INT,
        s_temp              FLOAT,
        heated_tube         INT,
        humidifier          INT,
        -- Fault flags
        fault_device        INT,
        fault_alarm         INT,
        fault_humidifier    INT,
        fault_heated_tube   INT,
        -- Metadata
        created_at_utc      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        archived_at_utc     DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_daily_summary_date (summary_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # sleep_sessions — one row per CSL file (therapy session)
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS sleep_sessions (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_start_utc  DATETIME        NOT NULL COMMENT 'Session start timestamp (UTC)',
        session_end_utc    DATETIME        NULL     COMMENT 'Session end timestamp (UTC), derived from last BRP sample',
        day_dir            DATE            NOT NULL COMMENT 'DATALOG directory date (UTC calendar date of session start)',
        night_date         DATE            NOT NULL COMMENT 'Sleep night date (noon-to-noon boundary, UTC+2/SAST)',
        file_prefix        VARCHAR(15)     NOT NULL COMMENT 'YYYYMMDD_HHMMSS prefix',
        created_at_utc     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc    DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_sleep_sessions_prefix (file_prefix),
        KEY idx_sleep_sessions_start (session_start_utc),
        KEY idx_sleep_sessions_night (night_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # events — scored respiratory events from EVE files
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS events (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id      BIGINT UNSIGNED NOT NULL,
        file_prefix     VARCHAR(15)     NOT NULL COMMENT 'Session YYYYMMDD_HHMMSS',
        event_time_utc  DATETIME        NOT NULL COMMENT 'Absolute UTC timestamp of event onset',
        offset_s        FLOAT           NOT NULL COMMENT 'Seconds from session start',
        duration_s      FLOAT           NOT NULL DEFAULT 0 COMMENT 'Event duration in seconds',
        event_type      VARCHAR(64)     NOT NULL COMMENT 'e.g. Hypopnea, Obstructive Apnea, Central Apnea',
        created_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_events_session   (session_id),
        KEY idx_events_type      (event_type),
        KEY idx_events_time      (event_time_utc),
        CONSTRAINT fk_events_session FOREIGN KEY (session_id)
            REFERENCES sleep_sessions (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # pld_samples — 2-second poly-somnographic metrics (PLD files)
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS pld_samples (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id      BIGINT UNSIGNED NOT NULL,
        file_prefix     VARCHAR(15)     NOT NULL,
        sample_time_utc     DATETIME(3)     NOT NULL COMMENT 'Absolute timestamp (2s resolution, UTC)',
        offset_s        FLOAT           NOT NULL COMMENT 'Seconds from session start',
        mask_press_cmh2o    FLOAT       COMMENT 'Mask pressure (cmH2O)',
        press_cmh2o         FLOAT       COMMENT 'Device pressure (cmH2O)',
        epr_press_cmh2o     FLOAT       COMMENT 'EPR pressure (cmH2O)',
        leak_l_s            FLOAT       COMMENT 'Leak rate (L/s)',
        resp_rate_bpm       FLOAT       COMMENT 'Respiratory rate (bpm)',
        tid_vol_l           FLOAT       COMMENT 'Tidal volume (L)',
        min_vent_l_min      FLOAT       COMMENT 'Minute ventilation (L/min)',
        snore               FLOAT       COMMENT 'Snore index (dimensionless)',
        flow_lim            FLOAT       COMMENT 'Flow limitation index (dimensionless)',
        created_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_pld_session  (session_id),
        KEY idx_pld_time     (sample_time_utc),
        CONSTRAINT fk_pld_session FOREIGN KEY (session_id)
            REFERENCES sleep_sessions (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # sad_samples — 1-second oximetry (SAD files)
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS sad_samples (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id      BIGINT UNSIGNED NOT NULL,
        file_prefix     VARCHAR(15)     NOT NULL,
        sample_time_utc DATETIME(3)     NOT NULL COMMENT 'Absolute timestamp (1s resolution, UTC)',
        offset_s        INT             NOT NULL COMMENT 'Seconds from session start',
        spo2_pct        FLOAT           COMMENT 'SpO2 (%)',
        pulse_bpm       FLOAT           COMMENT 'Pulse rate (bpm)',
        created_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_sad_session  (session_id),
        KEY idx_sad_time     (sample_time_utc),
        CONSTRAINT fk_sad_session FOREIGN KEY (session_id)
            REFERENCES sleep_sessions (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # brp_samples — 40 ms (25 Hz) flow + pressure waveforms (BRP files)
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS brp_samples (
        id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id          BIGINT UNSIGNED NOT NULL,
        file_prefix         VARCHAR(15)     NOT NULL,
        sample_time_utc     DATETIME(3)     NOT NULL COMMENT 'Absolute timestamp (40ms resolution, UTC)',
        offset_ms           INT             NOT NULL COMMENT 'Milliseconds from session start',
        flow_l_s            FLOAT           COMMENT 'Flow rate (L/s)',
        pressure_cmh2o      FLOAT           COMMENT 'Pressure (cmH2O)',
        created_at_utc      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc     DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_brp_session  (session_id),
        KEY idx_brp_time     (sample_time_utc),
        CONSTRAINT fk_brp_session FOREIGN KEY (session_id)
            REFERENCES sleep_sessions (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # brp_samples_1s — 1-second aggregated BRP (dashboard overview)
    # Populated by scripts/aggregate_brp.py, not the import script.
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS brp_samples_1s (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id      BIGINT UNSIGNED NOT NULL,
        sample_time_utc DATETIME(3)     NOT NULL COMMENT 'Bucket start (1s resolution, UTC)',
        offset_s        INT             NOT NULL COMMENT 'Seconds from session start',
        flow_min        FLOAT           COMMENT 'Flow min in bucket (L/s)',
        flow_max        FLOAT           COMMENT 'Flow max in bucket (L/s)',
        flow_mean       FLOAT           COMMENT 'Flow mean in bucket (L/s)',
        press_min       FLOAT           COMMENT 'Pressure min in bucket (cmH2O)',
        press_max       FLOAT           COMMENT 'Pressure max in bucket (cmH2O)',
        press_mean      FLOAT           COMMENT 'Pressure mean in bucket (cmH2O)',
        created_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_brp1s_session_time (session_id, sample_time_utc),
        CONSTRAINT fk_brp1s_session FOREIGN KEY (session_id)
            REFERENCES sleep_sessions (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,

    # ------------------------------------------------------------------
    # users — dashboard auth accounts
    # ------------------------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS users (
        id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        username        VARCHAR(64)     NOT NULL,
        password_hash   VARCHAR(255)    NOT NULL COMMENT 'bcrypt hash',
        display_name    VARCHAR(128)    NULL,
        created_at_utc  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at_utc DATETIME        NULL     DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """,
]

# ---------------------------------------------------------------------------
# Index migration — idempotent, safe to re-run on every startup.
# Adds composite covering indexes needed by the dashboard; drops the
# narrower single-column indexes they supersede.
# ---------------------------------------------------------------------------

# Each entry: (table, new_index_name, columns, old_index_to_drop_or_None)
INDEX_MIGRATIONS = [
    # pld_samples: composite (session_id, sample_time_utc) covering all metric cols
    # replaces narrower idx_pld_session
    ("pld_samples",  "idx_pld_session_time",
     "(session_id, sample_time_utc)",
     "idx_pld_session"),

    # sad_samples: composite (session_id, sample_time_utc)
    # replaces narrower idx_sad_session
    ("sad_samples",  "idx_sad_session_time",
     "(session_id, sample_time_utc)",
     "idx_sad_session"),

    # brp_samples: composite (session_id, sample_time_utc) — critical for 41M-row table
    # replaces narrower idx_brp_session
    ("brp_samples",  "idx_brp_session_time",
     "(session_id, sample_time_utc)",
     "idx_brp_session"),

    # events: composite covers session detail overlay + event breakdown queries
    # replaces narrower idx_events_session
    ("events",       "idx_events_session_time_type",
     "(session_id, event_time_utc, event_type, duration_s, offset_s)",
     "idx_events_session"),

    # sleep_sessions: day_dir index for sessions-list JOIN to daily_summary
    ("sleep_sessions", "idx_sleep_sessions_day_dir",
     "(day_dir)",
     None),

    # sleep_sessions: night_date index (noon-to-noon boundary, UTC+2)
    # Also ensures the column exists on pre-existing installs via ADD COLUMN guard
    ("sleep_sessions", "idx_sleep_sessions_night",
     "(night_date)",
     None),

    # daily_summary: (archived_at_utc, summary_date) for soft-delete + range scans
    ("daily_summary", "idx_daily_summary_archived_date",
     "(archived_at_utc, summary_date)",
     None),
]


def _column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "  AND TABLE_NAME = %s AND COLUMN_NAME = %s LIMIT 1",
        (table, column),
    )
    return cur.fetchone() is not None


def _ensure_column(
    cur,
    conn: pymysql.Connection,
    table: str,
    column: str,
    definition: str,
    backfill: str | None = None,
) -> None:
    """Add *column* to *table* if it does not already exist, then run *backfill*."""
    if _column_exists(cur, table, column):
        log.debug("Column %s.%s already exists — skipping", table, column)
        return
    log.info("Adding column %s.%s", table, column)
    cur.execute(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")
    conn.commit()
    if backfill:
        log.info("Backfilling %s.%s …", table, column)
        cur.execute(backfill)
        conn.commit()
        log.info("Backfill complete (%d rows)", cur.rowcount)


def _index_exists(cur, table: str, index_name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "  AND TABLE_NAME = %s AND INDEX_NAME = %s LIMIT 1",
        (table, index_name),
    )
    return cur.fetchone() is not None


def migrate_indexes(conn: pymysql.Connection) -> None:
    """Add dashboard indexes and drop their superseded predecessors.
    Every operation is guarded so the function is safe to re-run."""
    with conn.cursor() as cur:
        # ── column additions required before indexes can be created ────────
        _ensure_column(
            cur, conn,
            table="sleep_sessions",
            column="night_date",
            definition=(
                "DATE NOT NULL DEFAULT '2000-01-01' "
                "COMMENT 'Sleep night date (noon-to-noon boundary, UTC+2/SAST)' "
                "AFTER day_dir"
            ),
            backfill=(
                "UPDATE sleep_sessions "
                "SET night_date = DATE("
                "  CONVERT_TZ(session_start_utc, '+00:00', '+02:00') "
                "  - INTERVAL 12 HOUR) "
                "WHERE night_date = '2000-01-01'"
            ),
        )

        _ensure_column(
            cur, conn,
            table="sleep_sessions",
            column="session_end_utc",
            definition=(
                "DATETIME NULL "
                "COMMENT 'Session end timestamp (UTC), derived from last BRP sample' "
                "AFTER session_start_utc"
            ),
            backfill=(
                "UPDATE sleep_sessions s "
                "JOIN (SELECT session_id, MAX(sample_time_utc) AS max_sample "
                "      FROM brp_samples WHERE archived_at_utc IS NULL "
                "      GROUP BY session_id) b ON b.session_id = s.id "
                "SET s.session_end_utc = b.max_sample "
                "WHERE s.session_end_utc IS NULL AND s.archived_at_utc IS NULL"
            ),
        )

        for table, new_idx, columns, old_idx in INDEX_MIGRATIONS:
            # Add new index if missing
            if not _index_exists(cur, table, new_idx):
                log.info("Adding index %s.%s %s", table, new_idx, columns)
                cur.execute(f"ALTER TABLE `{table}` ADD INDEX `{new_idx}` {columns}")
                conn.commit()
            else:
                log.debug("Index %s.%s already exists — skipping", table, new_idx)

            # Drop superseded index if it still exists
            if old_idx and _index_exists(cur, table, old_idx):
                log.info("Dropping superseded index %s.%s", table, old_idx)
                cur.execute(f"ALTER TABLE `{table}` DROP INDEX `{old_idx}`")
                conn.commit()

    log.info("Index migration complete")


def create_tables(conn: pymysql.Connection) -> None:
    with conn.cursor() as cur:
        for ddl in DDL_STATEMENTS:
            cur.execute(ddl)
    conn.commit()
    migrate_indexes(conn)
    log.info("Database tables verified / created")


# ---------------------------------------------------------------------------
# Import-log helpers
# ---------------------------------------------------------------------------

def file_key(path: Path) -> tuple:
    """Return (path_str, size, mtime) tuple for a file."""
    st = path.stat()
    return (str(path), st.st_size, st.st_mtime)


def is_imported(cur, path: Path) -> bool:
    cur.execute(
        "SELECT 1 FROM import_log WHERE file_path = %s LIMIT 1",
        (str(path),),
    )
    return cur.fetchone() is not None


def mark_imported(cur, path: Path) -> None:
    st = path.stat()
    cur.execute(
        """
        INSERT IGNORE INTO import_log (file_path, file_size, file_mtime)
        VALUES (%s, %s, %s)
        """,
        (str(path), st.st_size, st.st_mtime),
    )


# ---------------------------------------------------------------------------
# EDF raw-header reader (used for STR.edf and EDF+D files)
# ---------------------------------------------------------------------------

class EdfHeader:
    """Minimal EDF header parser that works even on non-compliant files."""

    def __init__(self, path: Path):
        self.path = path
        with open(path, "rb") as fh:
            raw = fh.read(256)
            self.version        = raw[0:8].strip()
            self.patient        = raw[8:88].strip()
            self.recording      = raw[88:168].strip()
            self.startdate_str  = raw[168:176].decode("latin-1").strip()
            self.starttime_str  = raw[176:184].decode("latin-1").strip()
            self.header_bytes   = int(raw[184:192])
            self.reserved       = raw[192:236].strip()
            self.num_records    = int(raw[236:244])
            self.record_duration = float(raw[244:252])
            self.num_signals    = int(raw[252:256])
            sh = fh.read(self.num_signals * 256)

        self.labels  = [sh[i*16:(i+1)*16].decode("latin-1").strip() for i in range(self.num_signals)]
        self.dims    = [sh[96*self.num_signals+i*8:96*self.num_signals+(i+1)*8].decode("latin-1").strip() for i in range(self.num_signals)]
        self.pmin    = [float(sh[104*self.num_signals+i*8:104*self.num_signals+(i+1)*8]) for i in range(self.num_signals)]
        self.pmax    = [float(sh[112*self.num_signals+i*8:112*self.num_signals+(i+1)*8]) for i in range(self.num_signals)]
        self.dmin    = [int(sh[120*self.num_signals+i*8:120*self.num_signals+(i+1)*8]) for i in range(self.num_signals)]
        self.dmax    = [int(sh[128*self.num_signals+i*8:128*self.num_signals+(i+1)*8]) for i in range(self.num_signals)]
        self.ns_rec  = [int(sh[216*self.num_signals+i*8:216*self.num_signals+(i+1)*8]) for i in range(self.num_signals)]

    def scale_raw(self, sig_idx: int, raw_val: int) -> float:
        dm_range = self.dmax[sig_idx] - self.dmin[sig_idx]
        if dm_range == 0:
            return float(raw_val)
        return (raw_val - self.dmin[sig_idx]) / dm_range * (self.pmax[sig_idx] - self.pmin[sig_idx]) + self.pmin[sig_idx]

    def read_all_records(self) -> list[list[list[float]]]:
        """Return list[record_idx][signal_idx] = list[float]."""
        total_ns = sum(self.ns_rec)
        records = []
        with open(self.path, "rb") as fh:
            fh.seek(self.header_bytes)
            for _ in range(self.num_records):
                raw_rec = fh.read(total_ns * 2)
                offset = 0
                signals = []
                for i in range(self.num_signals):
                    n = self.ns_rec[i]
                    raw_vals = struct.unpack(f"<{n}h", raw_rec[offset:offset + n * 2])
                    signals.append([self.scale_raw(i, rv) for rv in raw_vals])
                    offset += n * 2
                records.append(signals)
        return records

    @property
    def start_datetime(self) -> datetime.datetime:
        """Parse the EDF start datetime from the header strings."""
        d = self.startdate_str  # DD.MM.YY
        t = self.starttime_str  # HH.MM.SS
        try:
            dd, mm, yy = d.split(".")
            hh, mi, ss = t.split(".")
            year = int(yy)
            year += 2000 if year < 85 else 1900
            return datetime.datetime(year, int(mm), int(dd), int(hh), int(mi), int(ss))
        except Exception:
            return datetime.datetime(1970, 1, 1)


# ---------------------------------------------------------------------------
# EDF+D annotation parser (EVE / CSL files)
# ---------------------------------------------------------------------------

def parse_edfplus_annotations(path: Path) -> list[dict]:
    """
    Read an EDF+D file and return a list of annotation dicts:
      { 'onset_s': float, 'duration_s': float, 'annotation': str }

    The TAL (Time-stamped Annotation List) format per data-record is:
      +<onset>\x15<duration>\x14<text>\x14\x00  (onset block)
      followed by zero or more:
      +<onset>\x15<duration>\x14<text>\x14\x00
    """
    hdr = EdfHeader(path)
    total_ns = sum(hdr.ns_rec)

    # Find the EDF Annotations signal index
    ann_idx = None
    for i, label in enumerate(hdr.labels):
        if "annotation" in label.lower():
            ann_idx = i
            break
    if ann_idx is None:
        return []

    offset_to_ann = sum(hdr.ns_rec[:ann_idx]) * 2
    ann_bytes_per_record = hdr.ns_rec[ann_idx] * 2

    annotations = []

    with open(path, "rb") as fh:
        fh.seek(hdr.header_bytes)
        for _ in range(hdr.num_records):
            raw_rec = fh.read(total_ns * 2)
            tal_bytes = raw_rec[offset_to_ann: offset_to_ann + ann_bytes_per_record]

            # Each TAL block is null-terminated. Within a block:
            #   +<onset>\x15<duration>\x14<annotation_text>\x14\x00
            # where \x15 (TAL_NEG_ONSET) separates onset from duration,
            # and \x14 (TAL_SEP_ONSET) separates duration from annotation text.
            blocks = tal_bytes.split(b"\x00")
            for block in blocks:
                if not block:
                    continue

                # Split on \x14 to get [onset\x15duration, annotation, ...]
                parts = block.split(TAL_SEP_ONSET)  # \x14
                if len(parts) < 2:
                    continue

                # First part: +onset[\x15duration]
                onset_dur_raw = parts[0]
                if TAL_NEG_ONSET in onset_dur_raw:           # \x15
                    onset_bytes, dur_bytes = onset_dur_raw.split(TAL_NEG_ONSET, 1)
                    try:
                        duration_s = float(dur_bytes.decode("latin-1", errors="replace"))
                    except ValueError:
                        duration_s = 0.0
                else:
                    dur_bytes  = None
                    duration_s = 0.0

                onset_str = onset_dur_raw if dur_bytes is None else onset_bytes
                try:
                    onset_s = float(onset_str.decode("latin-1", errors="replace").lstrip("+"))
                except ValueError:
                    continue

                # Annotation text is the second \x14-delimited field
                annotation = parts[1].decode("latin-1", errors="replace").strip()

                if annotation and annotation != "Recording starts":
                    annotations.append({
                        "onset_s":    onset_s,
                        "duration_s": duration_s,
                        "annotation": annotation,
                    })

    return annotations


# ---------------------------------------------------------------------------
# STR.edf importer
# ---------------------------------------------------------------------------

# Mapping from STR.edf signal label → daily_summary column name
STR_COLUMN_MAP = {
    "Date":             None,           # decoded separately as summary_date
    "Duration":         "duration_min",
    "OnDuration":       "on_duration_min",
    "PatientHours":     "patient_hours",
    "MaskEvents":       "mask_events",
    "AHI":              "ahi",
    "AI":               "ai",
    "HI":               "hi",
    "OAI":              "oai",
    "CAI":              "cai",
    "UAI":              "uai",
    "CSR":              "csr",
    "MaskPress.50":     "mask_press_50",
    "MaskPress.95":     "mask_press_95",
    "MaskPress.Max":    "mask_press_max",
    "TgtIPAP.50":       "tgt_ipap_50",
    "TgtIPAP.95":       "tgt_ipap_95",
    "TgtIPAP.Max":      "tgt_ipap_max",
    "TgtEPAP.50":       "tgt_epap_50",
    "TgtEPAP.95":       "tgt_epap_95",
    "TgtEPAP.Max":      "tgt_epap_max",
    "BlowPress.95":     "blow_press_95",
    "BlowPress.5":      "blow_press_5",
    "Flow.95":          "flow_95",
    "Flow.5":           "flow_5",
    "BlowFlow.50":      "blow_flow_50",
    "Leak.50":          "leak_50",
    "Leak.70":          "leak_70",
    "Leak.95":          "leak_95",
    "Leak.Max":         "leak_max",
    "MinVent.50":       "min_vent_50",
    "MinVent.95":       "min_vent_95",
    "MinVent.Max":      "min_vent_max",
    "RespRate.50":      "resp_rate_50",
    "RespRate.95":      "resp_rate_95",
    "RespRate.Max":     "resp_rate_max",
    "TidVol.50":        "tid_vol_50",
    "TidVol.95":        "tid_vol_95",
    "TidVol.Max":       "tid_vol_max",
    "SpO2.50":          "spo2_50",
    "SpO2.95":          "spo2_95",
    "SpO2.Max":         "spo2_max",
    "SpO2Thresh":       "spo2_thresh_min",
    "AmbHumidity.50":   "amb_humidity_50",
    "HumTemp.50":       "hum_temp_50",
    "HTubeTemp.50":     "htube_temp_50",
    "HTubePow.50":      "htube_pow_50",
    "HumPow.50":        "hum_pow_50",
    "Mode":             "mode",
    "S.RampEnable":     "s_ramp_enable",
    "S.RampTime":       "s_ramp_time_min",
    "S.C.StartPress":   "s_c_start_press",
    "S.C.Press":        "s_c_press",
    "S.EPR.ClinEnable": "s_epr_clin_enable",
    "S.EPR.EPREnable":  "s_epr_enable",
    "S.EPR.Level":      "s_epr_level",
    "S.EPR.EPRType":    "s_epr_type",
    "S.AS.Comfort":     "s_as_comfort",
    "S.AS.StartPress":  "s_as_start_press",
    "S.AS.MaxPress":    "s_as_max_press",
    "S.AS.MinPress":    "s_as_min_press",
    "S.SmartStart":     "s_smart_start",
    "S.PtAccess":       "s_pt_access",
    "S.ABFilter":       "s_ab_filter",
    "S.Mask":           "s_mask",
    "S.Tube":           "s_tube",
    "S.ClimateControl": "s_climate_control",
    "S.HumEnable":      "s_hum_enable",
    "S.HumLevel":       "s_hum_level",
    "S.TempEnable":     "s_temp_enable",
    "S.Temp":           "s_temp",
    "HeatedTube":       "heated_tube",
    "Humidifier":       "humidifier",
    "Fault.Device":     "fault_device",
    "Fault.Alarm":      "fault_alarm",
    "Fault.Humidifier": "fault_humidifier",
    "Fault.HeatedTube": "fault_heated_tube",
}

# Sentinel values that represent "no data" in the EDF signals
SENTINEL_NEGATIVE = -1.0   # SpO2/Pulse when no oximeter
SENTINEL_ZERO_DATE = 0.0   # Date=0 means no data for that record


def import_str_edf(
    conn: pymysql.Connection,
    root: Path,
    date_from: datetime.date | None = None,
    date_to:   datetime.date | None = None,
) -> int:
    """Parse STR.edf and upsert rows into daily_summary. Returns count inserted/updated."""
    str_path = root / "STR.edf"
    if not str_path.exists():
        log.warning("STR.edf not found in %s — skipping daily summary import", root)
        return 0

    with conn.cursor() as cur:
        if is_imported(cur, str_path):
            log.info("STR.edf already imported — skipping")
            return 0

    if date_from or date_to:
        log.info(
            "Parsing STR.edf (%s) … (date filter: %s → %s)",
            str_path,
            date_from or "any",
            date_to   or "any",
        )
    else:
        log.info("Parsing STR.edf (%s) …", str_path)

    try:
        hdr = EdfHeader(str_path)
        records = hdr.read_all_records()
    except Exception as exc:
        log.error("Failed to read STR.edf: %s", exc, exc_info=True)
        return 0

    date_idx = hdr.labels.index("Date") if "Date" in hdr.labels else None
    if date_idx is None:
        log.error("STR.edf has no Date signal — skipping")
        return 0

    # Build label → signal-index lookup for all mapped columns
    label_to_idx = {label: hdr.labels.index(label) for label in STR_COLUMN_MAP if label in hdr.labels}

    rows_upserted = 0

    with conn.cursor() as cur:
        for rec_data in records:
            date_val = rec_data[date_idx][0]
            if date_val <= 0:
                continue  # empty record

            summary_date = EPOCH + datetime.timedelta(days=int(date_val))

            # Apply date limits
            if date_from and summary_date < date_from:
                continue
            if date_to   and summary_date > date_to:
                continue

            row = {"summary_date": summary_date.isoformat()}
            for label, col in STR_COLUMN_MAP.items():
                if col is None or label not in label_to_idx:
                    continue
                val = rec_data[label_to_idx[label]][0]
                # Treat -1 sentinels (e.g. SpO2 when no sensor) as NULL
                row[col] = None if val == SENTINEL_NEGATIVE else round(val, 4)

            cols   = ", ".join(row.keys())
            ph     = ", ".join(["%s"] * len(row))
            update = ", ".join(f"{k}=VALUES({k})" for k in row if k != "summary_date")

            cur.execute(
                f"INSERT INTO daily_summary ({cols}) VALUES ({ph}) "
                f"ON DUPLICATE KEY UPDATE {update}",
                list(row.values()),
            )
            rows_upserted += 1

        conn.commit()
        mark_imported(cur, str_path)
        conn.commit()

    log.info("daily_summary: %d rows upserted from STR.edf", rows_upserted)
    return rows_upserted


# ---------------------------------------------------------------------------
# DATALOG session walker
# ---------------------------------------------------------------------------

def parse_session_prefix(filename: str) -> str | None:
    """Extract 'YYYYMMDD_HHMMSS' prefix from an EDF filename."""
    m = re.match(r"^(\d{8}_\d{6})_\w+\.edf$", filename, re.IGNORECASE)
    return m.group(1) if m else None


def parse_prefix_datetime(prefix: str, tz: zoneinfo.ZoneInfo) -> datetime.datetime:
    """Convert 'YYYYMMDD_HHMMSS' local wall-clock time to a naive UTC datetime."""
    naive_local = datetime.datetime.strptime(prefix, "%Y%m%d_%H%M%S")
    local_aware = naive_local.replace(tzinfo=tz)
    utc_aware   = local_aware.astimezone(datetime.timezone.utc)
    return utc_aware.replace(tzinfo=None)  # naive UTC — pymysql writes it correctly


def group_sessions(day_path: Path, tz: zoneinfo.ZoneInfo) -> dict[str, dict[str, Path]]:
    """
    Build a session map keyed by **session prefix** (always the CSL/EVE timestamp when
    present, or the BRP/PLD/SAD timestamp when there is no matching CSL).

    ResMed writes CSL/EVE a few seconds *before* BRP/PLD/SAD for the same therapy
    session (CSL = mask-detect event; BRP = blower start, typically 3-8 s later).
    BRP/PLD/SAD groups that appear more than 60 seconds after the nearest CSL are
    treated as independent mask-continuation segments (extra mask-on periods within
    the same night) and are given their own session entry.

    Returns: { session_prefix: { 'CSL': Path, 'EVE': Path, 'BRP': Path,
                                  'PLD': Path, 'SAD': Path } }
    Only .edf files are included; .crc files are ignored.
    """
    # Collect all EDF files grouped by their raw filename prefix
    raw: dict[str, dict[str, Path]] = defaultdict(dict)
    for fpath in day_path.iterdir():
        if fpath.suffix.lower() != ".edf":
            continue
        m = re.match(r"^(\d{8}_\d{6})_(CSL|EVE|BRP|PLD|SAD)\.edf$", fpath.name, re.IGNORECASE)
        if m:
            prefix   = m.group(1)
            filetype = m.group(2).upper()
            raw[prefix][filetype] = fpath

    # Separate CSL-bearing prefixes from waveform-only prefixes
    csl_prefixes = sorted(p for p, f in raw.items() if "CSL" in f)
    wav_prefixes = sorted(p for p, f in raw.items() if "CSL" not in f)

    sessions: dict[str, dict[str, Path]] = {}

    # Seed sessions from CSL prefixes
    for cp in csl_prefixes:
        sessions[cp] = dict(raw[cp])   # contains CSL and/or EVE

    # Match waveform-only prefixes to the nearest CSL within 60 seconds
    csl_dts = [(cp, parse_prefix_datetime(cp, tz)) for cp in csl_prefixes]

    unmatched_wav: list[str] = []
    for wp in wav_prefixes:
        wp_dt = parse_prefix_datetime(wp, tz)
        matched = None
        for cp, cp_dt in csl_dts:
            delta = (wp_dt - cp_dt).total_seconds()
            if 0 <= delta <= 60:    # BRP starts 0-60s after CSL
                matched = cp
                break

        if matched:
            # Merge waveform files into the matched CSL session
            sessions[matched].update(raw[wp])
        else:
            unmatched_wav.append(wp)

    # Merge waveform-only groups that are within 5 seconds of each other
    # (e.g. BRP and PLD/SAD with timestamps 1 second apart due to device quirk)
    if unmatched_wav:
        groups: list[tuple[str, dict[str, Path]]] = []   # (anchor_prefix, merged_files)
        for wp in sorted(unmatched_wav):
            wp_dt = parse_prefix_datetime(wp, tz)
            merged = False
            for anchor_prefix, group_files in groups:
                anchor_dt = parse_prefix_datetime(anchor_prefix, tz)
                if abs((wp_dt - anchor_dt).total_seconds()) <= 5:
                    group_files.update(raw[wp])
                    merged = True
                    break
            if not merged:
                groups.append((wp, dict(raw[wp])))
        for anchor_prefix, group_files in groups:
            sessions[anchor_prefix] = group_files

    return sessions


# ---------------------------------------------------------------------------
# Per-file parsers
# ---------------------------------------------------------------------------

def import_csl(cur, prefix: str, csl_path: Path, tz: zoneinfo.ZoneInfo) -> int | None:
    """
    Insert a row into sleep_sessions for this session.
    Returns the new session_id, or existing session_id if already present.
    """
    cur.execute("SELECT id FROM sleep_sessions WHERE file_prefix = %s", (prefix,))
    row = cur.fetchone()
    if row:
        return row[0]

    session_start = parse_prefix_datetime(prefix, tz)
    day_dir       = datetime.date(session_start.year, session_start.month, session_start.day)

    # night_date = sleep-night date using a noon-to-noon boundary in the display
    # timezone.  Convert naive UTC → aware local, subtract 12 h, take the date.
    # This means a session starting at 01:00 SAST belongs to the *previous* night.
    aware_utc   = session_start.replace(tzinfo=datetime.timezone.utc)
    aware_local = aware_utc.astimezone(tz)
    night_date  = (aware_local - datetime.timedelta(hours=12)).date()

    cur.execute(
        "INSERT INTO sleep_sessions (session_start_utc, day_dir, night_date, file_prefix) VALUES (%s, %s, %s, %s)",
        (session_start, day_dir.isoformat(), night_date.isoformat(), prefix),
    )
    return cur.lastrowid


def import_eve(cur, session_id: int, prefix: str, eve_path: Path, tz: zoneinfo.ZoneInfo) -> int:
    """Parse EVE EDF+D and insert rows into events. Returns count inserted."""
    try:
        annotations = parse_edfplus_annotations(eve_path)
    except Exception as exc:
        log.error("EVE parse error %s: %s", eve_path, exc, exc_info=True)
        return 0

    if not annotations:
        log.debug("EVE %s: no annotations found", eve_path.name)
        return 0

    session_start = parse_prefix_datetime(prefix, tz)
    rows = []
    for ann in annotations:
        event_time = session_start + datetime.timedelta(seconds=ann["onset_s"])
        rows.append((
            session_id,
            prefix,
            event_time,
            ann["onset_s"],
            ann["duration_s"],
            ann["annotation"],
        ))

    for i in range(0, len(rows), BATCH_SIZE):
        cur.executemany(
            """
            INSERT IGNORE INTO events
                (session_id, file_prefix, event_time_utc, offset_s, duration_s, event_type)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            rows[i: i + BATCH_SIZE],
        )
    return len(rows)


def import_pld(cur, session_id: int, prefix: str, pld_path: Path, tz: zoneinfo.ZoneInfo) -> int:
    """Parse PLD EDF and insert rows into pld_samples. Returns count inserted."""
    try:
        reader = pyedflib.EdfReader(
            str(pld_path),
            annotations_mode=pyedflib.DO_NOT_READ_ANNOTATIONS,
        )
    except OSError as exc:
        log.error("PLD open error %s: %s", pld_path, exc)
        return 0

    try:
        labels      = reader.getSignalLabels()
        session_start = parse_prefix_datetime(prefix, tz)

        # Read all signals into a dict by label (strip trailing suffix like '.2s')
        # Skip Crc16 — it has far fewer samples than the real signals and would
        # truncate n_samples via min(lengths) if included.
        signals: dict[str, list] = {}
        for i, label in enumerate(labels):
            clean = label.split(".")[0]
            if clean == "Crc16":
                continue
            try:
                signals[clean] = reader.readSignal(i).tolist()
            except Exception as exc:
                log.warning("PLD signal read error %s [%s]: %s", pld_path.name, label, exc)
    finally:
        reader.close()

    # All 2-second signals should have the same length
    lengths = [len(v) for v in signals.values()]
    if not lengths:
        return 0
    n_samples = min(lengths)

    rows = []
    interval_s = 2.0
    for idx in range(n_samples):
        offset_s   = idx * interval_s
        sample_time = session_start + datetime.timedelta(seconds=offset_s)
        rows.append((
            session_id,
            prefix,
            sample_time,
            offset_s,
            signals.get("MaskPress", [None] * n_samples)[idx],
            signals.get("Press",     [None] * n_samples)[idx],
            signals.get("EprPress",  [None] * n_samples)[idx],
            signals.get("Leak",      [None] * n_samples)[idx],
            signals.get("RespRate",  [None] * n_samples)[idx],
            signals.get("TidVol",    [None] * n_samples)[idx],
            signals.get("MinVent",   [None] * n_samples)[idx],
            signals.get("Snore",     [None] * n_samples)[idx],
            signals.get("FlowLim",   [None] * n_samples)[idx],
        ))

    for i in range(0, len(rows), BATCH_SIZE):
        cur.executemany(
            """
            INSERT IGNORE INTO pld_samples
                (session_id, file_prefix, sample_time_utc, offset_s,
                 mask_press_cmh2o, press_cmh2o, epr_press_cmh2o, leak_l_s,
                 resp_rate_bpm, tid_vol_l, min_vent_l_min, snore, flow_lim)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            rows[i: i + BATCH_SIZE],
        )
    return len(rows)


def import_sad(cur, session_id: int, prefix: str, sad_path: Path, tz: zoneinfo.ZoneInfo) -> int:
    """
    Parse SAD EDF and insert rows into sad_samples.
    Skips if all SpO2 values are -1 (no oximeter attached).
    Returns count inserted (0 if skipped).
    """
    try:
        reader = pyedflib.EdfReader(
            str(sad_path),
            annotations_mode=pyedflib.DO_NOT_READ_ANNOTATIONS,
        )
    except OSError as exc:
        log.error("SAD open error %s: %s", sad_path, exc)
        return 0

    try:
        labels = reader.getSignalLabels()
        pulse_sig = spo2_sig = None
        for i, label in enumerate(labels):
            clean = label.split(".")[0]
            if clean == "Pulse":
                try:
                    pulse_sig = reader.readSignal(i).tolist()
                except Exception as exc:
                    log.warning("SAD Pulse read error %s: %s", sad_path.name, exc)
            elif clean == "SpO2":
                try:
                    spo2_sig = reader.readSignal(i).tolist()
                except Exception as exc:
                    log.warning("SAD SpO2 read error %s: %s", sad_path.name, exc)
    finally:
        reader.close()

    if spo2_sig is None and pulse_sig is None:
        log.debug("SAD %s: no recognisable signals, skipping", sad_path.name)
        return 0

    # Skip if all SpO2 values are the sentinel -1 (no oximeter)
    if spo2_sig and all(v <= SENTINEL_NEGATIVE for v in spo2_sig):
        log.debug("SAD %s: SpO2 all -1, no oximeter attached — skipping", sad_path.name)
        return 0

    n_samples     = max(len(spo2_sig or []), len(pulse_sig or []))
    session_start = parse_prefix_datetime(prefix, tz)

    rows = []
    for idx in range(n_samples):
        spo2  = spo2_sig[idx]  if spo2_sig  and idx < len(spo2_sig)  else None
        pulse = pulse_sig[idx] if pulse_sig and idx < len(pulse_sig) else None
        # Convert -1 sentinel to NULL
        if spo2  is not None and spo2  <= SENTINEL_NEGATIVE: spo2  = None
        if pulse is not None and pulse <= SENTINEL_NEGATIVE: pulse = None

        sample_time = session_start + datetime.timedelta(seconds=idx)
        rows.append((session_id, prefix, sample_time, idx, spo2, pulse))

    for i in range(0, len(rows), BATCH_SIZE):
        cur.executemany(
            """
            INSERT IGNORE INTO sad_samples
                (session_id, file_prefix, sample_time_utc, offset_s, spo2_pct, pulse_bpm)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            rows[i: i + BATCH_SIZE],
        )
    return len(rows)


def import_brp(cur, session_id: int, prefix: str, brp_path: Path, tz: zoneinfo.ZoneInfo) -> int:
    """Parse BRP EDF (25 Hz) and insert rows into brp_samples. Returns count inserted."""
    try:
        reader = pyedflib.EdfReader(
            str(brp_path),
            annotations_mode=pyedflib.DO_NOT_READ_ANNOTATIONS,
        )
    except OSError as exc:
        log.error("BRP open error %s: %s", brp_path, exc)
        return 0

    try:
        labels        = reader.getSignalLabels()
        session_start = parse_prefix_datetime(prefix, tz)

        flow_sig = press_sig = None
        for i, label in enumerate(labels):
            clean = label.split(".")[0]
            if clean == "Flow":
                try:
                    flow_sig = reader.readSignal(i).tolist()
                except Exception as exc:
                    log.warning("BRP Flow read error %s: %s", brp_path.name, exc)
            elif clean == "Press":
                try:
                    press_sig = reader.readSignal(i).tolist()
                except Exception as exc:
                    log.warning("BRP Press read error %s: %s", brp_path.name, exc)
    finally:
        reader.close()

    if flow_sig is None and press_sig is None:
        log.warning("BRP %s: no Flow or Press signals found, skipping", brp_path.name)
        return 0

    n_samples  = max(len(flow_sig or []), len(press_sig or []))
    interval_ms = 40  # 25 Hz = 40ms per sample

    rows = []
    for idx in range(n_samples):
        offset_ms   = idx * interval_ms
        sample_time = session_start + datetime.timedelta(milliseconds=offset_ms)
        flow  = flow_sig[idx]  if flow_sig  and idx < len(flow_sig)  else None
        press = press_sig[idx] if press_sig and idx < len(press_sig) else None
        rows.append((session_id, prefix, sample_time, offset_ms, flow, press))

    for i in range(0, len(rows), BATCH_SIZE):
        cur.executemany(
            """
            INSERT IGNORE INTO brp_samples
                (session_id, file_prefix, sample_time_utc, offset_ms, flow_l_s, pressure_cmh2o)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            rows[i: i + BATCH_SIZE],
        )
    return len(rows)


# ---------------------------------------------------------------------------
# Main DATALOG import loop
# ---------------------------------------------------------------------------

def import_datalog(
    conn: pymysql.Connection,
    root: Path,
    tz: zoneinfo.ZoneInfo,
    date_from: datetime.date | None = None,
    date_to:   datetime.date | None = None,
) -> dict:
    datalog = root / "DATALOG"
    if not datalog.is_dir():
        log.warning("No DATALOG directory found at %s", datalog)
        return {}

    all_day_dirs = sorted(p for p in datalog.iterdir() if p.is_dir())

    # Filter day directories by date limits.
    # Directory names are YYYYMMDD; a session that starts before midnight can
    # spill into the next calendar folder, so we use the folder date for filtering.
    def dir_date(p: Path) -> datetime.date | None:
        try:
            return datetime.date(int(p.name[:4]), int(p.name[4:6]), int(p.name[6:8]))
        except (ValueError, IndexError):
            return None

    day_dirs = []
    for p in all_day_dirs:
        d = dir_date(p)
        if d is None:
            continue
        if date_from and d < date_from:
            continue
        if date_to   and d > date_to:
            continue
        day_dirs.append(p)

    if date_from or date_to:
        log.info(
            "Scanning %d day directories (filtered %s → %s, skipped %d)",
            len(day_dirs),
            date_from or "any",
            date_to   or "any",
            len(all_day_dirs) - len(day_dirs),
        )
    else:
        log.info("Found %d day directories in DATALOG", len(day_dirs))

    stats = {
        "days_processed": 0,
        "sessions_imported": 0,
        "sessions_skipped": 0,
        "events_inserted": 0,
        "pld_rows": 0,
        "sad_rows": 0,
        "brp_rows": 0,
        "errors": 0,
    }

    for day_path in day_dirs:
        sessions = group_sessions(day_path, tz)
        if not sessions:
            log.debug("Day %s: no EDF sessions found", day_path.name)
            continue

        stats["days_processed"] += 1

        for prefix, files in sorted(sessions.items()):
            # Check if all files in this session group are already imported
            with conn.cursor() as cur:
                all_done = all(is_imported(cur, p) for p in files.values())

            if all_done:
                log.debug("Session %s: already imported, skipping", prefix)
                stats["sessions_skipped"] += 1
                continue

            log.debug("Importing session %s (%s)", prefix, ", ".join(files.keys()))

            try:
                with conn.cursor() as cur:
                    # 1. CSL — create / fetch the session record
                    if "CSL" in files:
                        session_id = import_csl(cur, prefix, files["CSL"], tz)
                    else:
                        # BRP/PLD/SAD without a matching CSL — still create the session
                        session_id = import_csl(cur, prefix, next(iter(files.values())), tz)

                    if session_id is None:
                        log.error("Session %s: could not create sleep_sessions row", prefix)
                        stats["errors"] += 1
                        continue

                    # 2. EVE — scored events
                    if "EVE" in files:
                        n = import_eve(cur, session_id, prefix, files["EVE"], tz)
                        stats["events_inserted"] += n

                    # 3. PLD — 2-second metrics
                    if "PLD" in files:
                        n = import_pld(cur, session_id, prefix, files["PLD"], tz)
                        stats["pld_rows"] += n

                    # 4. SAD — oximetry
                    if "SAD" in files:
                        n = import_sad(cur, session_id, prefix, files["SAD"], tz)
                        stats["sad_rows"] += n

                    # 5. BRP — 25 Hz waveforms
                    if "BRP" in files:
                        n = import_brp(cur, session_id, prefix, files["BRP"], tz)
                        stats["brp_rows"] += n
                        # Update session_end_utc from the last BRP sample (more accurate
                        # than PLD which terminates early; BRP tracks actual therapy end)
                        if n > 0:
                            cur.execute(
                                "UPDATE sleep_sessions "
                                "SET session_end_utc = ("
                                "  SELECT MAX(sample_time_utc) FROM brp_samples "
                                "  WHERE session_id = %s AND archived_at_utc IS NULL"
                                ") WHERE id = %s",
                                (session_id, session_id),
                            )

                    # 6. Mark all files as imported
                    for fpath in files.values():
                        mark_imported(cur, fpath)

                conn.commit()
                stats["sessions_imported"] += 1

            except Exception as exc:
                conn.rollback()
                log.error(
                    "Session %s: unexpected error, rolled back: %s",
                    prefix, exc, exc_info=True,
                )
                stats["errors"] += 1

    return stats


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import ResMed SD-card sleep data into MariaDB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--config",
        default="config.ini",
        metavar="FILE",
        help="Path to the configuration file (default: config.ini)",
    )
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("ResMed import started")
    log.info("Log file: %s", LOG_FILE)

    cfg  = load_config(args.config)
    root = Path(cfg["paths"]["datalog_root"])
    tz   = zoneinfo.ZoneInfo(cfg.get("display", "timezone", fallback="UTC"))
    conn = connect(cfg)

    date_from, date_to = get_date_limits(cfg)
    if date_from or date_to:
        log.info(
            "Date limits active: %s → %s",
            date_from or "any",
            date_to   or "any",
        )

    try:
        create_tables(conn)

        # --- STR.edf (daily summaries) ---
        str_rows = import_str_edf(conn, root, date_from=date_from, date_to=date_to)

        # --- DATALOG sessions ---
        stats = import_datalog(conn, root, tz, date_from=date_from, date_to=date_to)

        # --- Final report ---
        log.info("=" * 60)
        log.info("Import complete")
        log.info("  daily_summary rows upserted : %d", str_rows)
        log.info("  Days processed              : %d", stats["days_processed"])
        log.info("  Sessions imported           : %d", stats["sessions_imported"])
        log.info("  Sessions skipped (done)     : %d", stats["sessions_skipped"])
        log.info("  Events inserted             : %d", stats["events_inserted"])
        log.info("  PLD rows inserted           : %d", stats["pld_rows"])
        log.info("  SAD rows inserted           : %d", stats["sad_rows"])
        log.info("  BRP rows inserted           : %d", stats["brp_rows"])
        log.info("  Errors logged               : %d", stats["errors"])
        log.info("=" * 60)

        if stats["errors"]:
            log.warning("%d error(s) occurred — check %s for details", stats["errors"], LOG_FILE)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
