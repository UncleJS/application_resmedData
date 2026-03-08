-- ---------------------------------------------------------------------------
-- rename_to_utc.sql
-- Renames all DATETIME/TIMESTAMP columns to carry a _utc suffix for clarity.
-- Calendar-date columns (summary_date, day_dir) are NOT renamed.
-- Run once against the live DB.  Safe to check with SHOW COLUMNS if unsure.
-- ---------------------------------------------------------------------------
-- Uses ALGORITHM=INPLACE, LOCK=NONE where possible so large tables
-- (brp_samples ~41M rows) avoid a full table rebuild.
-- ---------------------------------------------------------------------------

-- import_log
ALTER TABLE import_log
    CHANGE COLUMN imported_at  imported_at_utc  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALGORITHM=INPLACE, LOCK=NONE;

-- daily_summary
ALTER TABLE daily_summary
    CHANGE COLUMN created_at   created_at_utc   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN updated_at   updated_at_utc   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at  archived_at_utc  DATETIME NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- sleep_sessions
ALTER TABLE sleep_sessions
    CHANGE COLUMN session_start  session_start_utc  DATETIME NOT NULL COMMENT 'Session start timestamp (UTC)',
    CHANGE COLUMN created_at     created_at_utc     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at    archived_at_utc    DATETIME NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- events
ALTER TABLE events
    CHANGE COLUMN event_time   event_time_utc   DATETIME NOT NULL COMMENT 'Absolute UTC timestamp of event onset',
    CHANGE COLUMN created_at   created_at_utc   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at  archived_at_utc  DATETIME NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- pld_samples
ALTER TABLE pld_samples
    CHANGE COLUMN sample_time   sample_time_utc   DATETIME(3) NOT NULL COMMENT 'Absolute timestamp (2s resolution, UTC)',
    CHANGE COLUMN created_at    created_at_utc    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at   archived_at_utc   DATETIME    NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- sad_samples
ALTER TABLE sad_samples
    CHANGE COLUMN sample_time   sample_time_utc   DATETIME(3) NOT NULL COMMENT 'Absolute timestamp (1s resolution, UTC)',
    CHANGE COLUMN created_at    created_at_utc    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at   archived_at_utc   DATETIME    NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- brp_samples  (large table ~41M rows — INPLACE avoids rebuild)
ALTER TABLE brp_samples
    CHANGE COLUMN sample_time   sample_time_utc   DATETIME(3) NOT NULL COMMENT 'Absolute timestamp (40ms resolution, UTC)',
    CHANGE COLUMN created_at    created_at_utc    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at   archived_at_utc   DATETIME    NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- brp_samples_1s  (large table ~1.6M rows)
ALTER TABLE brp_samples_1s
    CHANGE COLUMN sample_time   sample_time_utc   DATETIME(3) NOT NULL COMMENT 'Bucket start (1s resolution, UTC)',
    CHANGE COLUMN created_at    created_at_utc    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at   archived_at_utc   DATETIME    NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;

-- users
ALTER TABLE users
    CHANGE COLUMN created_at   created_at_utc   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHANGE COLUMN archived_at  archived_at_utc  DATETIME NULL     DEFAULT NULL,
    ALGORITHM=INPLACE, LOCK=NONE;
