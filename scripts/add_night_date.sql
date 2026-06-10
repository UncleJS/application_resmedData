-- ---------------------------------------------------------------------------
-- Migration: add night_date to sleep_sessions
--
-- night_date = the sleep-night date (noon-to-noon boundary) in the timezone
-- configured under [display] in config.ini.
--
-- This file only adds the column + index.  The backfill is done in Python by
-- scripts/run_add_night_date.py using import_resmed.compute_night_date(), so
-- backfilled values always match freshly imported rows — including DST-aware
-- timezones, which a fixed CONVERT_TZ offset cannot handle.
--
-- A session starting at 01:00 local time (e.g. 23:00 UTC the previous day in
-- SAST) gets the previous calendar date, matching the human concept of
-- "last night's sleep".
-- ---------------------------------------------------------------------------

ALTER TABLE sleep_sessions
  ADD COLUMN night_date DATE NOT NULL
    COMMENT 'Sleep night date (noon-to-noon boundary, display timezone)'
    AFTER day_dir,
  ADD INDEX idx_sleep_sessions_night (night_date),
  ALGORITHM=INPLACE, LOCK=NONE;
