-- ---------------------------------------------------------------------------
-- Migration: add night_date to sleep_sessions
--
-- night_date = the sleep-night date (noon-to-noon) in Africa/Johannesburg (UTC+2).
-- Formula: DATE( CONVERT_TZ(session_start_utc, '+00:00', '+02:00')
--                - INTERVAL 12 HOUR )
--
-- Named timezone 'Africa/Johannesburg' requires the mysql.time_zone tables to be
-- loaded; we use the fixed offset '+02:00' instead (SAST has no DST, so this is
-- always correct).
--
-- A session starting at 01:00 SAST (23:00 UTC prev day) gets the previous
-- calendar date, matching the human concept of "last night's sleep".
-- ---------------------------------------------------------------------------

ALTER TABLE sleep_sessions
  ADD COLUMN night_date DATE NOT NULL
    COMMENT 'Sleep night date (noon-to-noon boundary, Africa/Johannesburg)'
    AFTER day_dir,
  ADD INDEX idx_sleep_sessions_night (night_date),
  ALGORITHM=INPLACE, LOCK=NONE;

-- Backfill all existing rows
UPDATE sleep_sessions
SET    night_date = DATE(
         CONVERT_TZ(session_start_utc, '+00:00', '+02:00')
         - INTERVAL 12 HOUR
       )
WHERE  night_date = '0000-00-00'
    OR night_date IS NULL;
