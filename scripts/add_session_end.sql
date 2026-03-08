-- add_session_end.sql
-- Adds session_end_utc DATETIME NULL to sleep_sessions and backfills from pld_samples.

ALTER TABLE sleep_sessions
  ADD COLUMN session_end_utc DATETIME NULL AFTER session_start_utc,
  ADD INDEX idx_sleep_sessions_end (session_end_utc);

-- Backfill: session_end = MAX(sample_time_utc) from pld_samples for each session
UPDATE sleep_sessions s
  JOIN (
    SELECT session_id, MAX(sample_time_utc) AS max_sample
    FROM   pld_samples
    WHERE  archived_at_utc IS NULL
    GROUP  BY session_id
  ) p ON p.session_id = s.id
SET s.session_end_utc = p.max_sample
WHERE s.archived_at_utc IS NULL;
