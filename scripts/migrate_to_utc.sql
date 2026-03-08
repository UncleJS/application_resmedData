-- migrate_to_utc.sql
-- One-time migration: shift all EDF-derived DATETIME columns from
-- Africa/Johannesburg local time (UTC+2) to UTC.
-- Run ONCE:
--   mysql -h 192.168.10.51 -u resmed -p'PASSWORD' resmed_sleep < scripts/migrate_to_utc.sql

USE resmed_sleep;

START TRANSACTION;

UPDATE sleep_sessions SET session_start = DATE_SUB(session_start, INTERVAL 2 HOUR);
UPDATE events          SET event_time   = DATE_SUB(event_time,   INTERVAL 2 HOUR);
UPDATE pld_samples     SET sample_time  = DATE_SUB(sample_time,  INTERVAL 2 HOUR);
UPDATE brp_samples_1s  SET sample_time  = DATE_SUB(sample_time,  INTERVAL 2 HOUR);
UPDATE brp_samples     SET sample_time  = DATE_SUB(sample_time,  INTERVAL 2 HOUR);

COMMIT;
