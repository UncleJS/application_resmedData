-- =============================================================================
-- cutover_brp_partitioned.sql
--
-- Atomic cutover: swap brp_samples_new (partitioned) into place.
--
-- Prerequisites
-- -------------
--   1. migrate_brp_partitioned.py --status shows "COPY COMPLETE"
--   2. The importer (import_resmed.py) is stopped / no new rows are being
--      written to brp_samples during the rename window.
--   3. You are connected to the correct database (resmed_sleep).
--
-- Estimated downtime: ~1 second (RENAME TABLE is atomic in MariaDB/InnoDB).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1: Pre-flight checks
-- Run this SELECT and verify both tables have the expected row counts before
-- proceeding.  TABLE_ROWS is an estimate from the InnoDB statistics.
-- ---------------------------------------------------------------------------

SELECT
    TABLE_NAME,
    TABLE_ROWS,
    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1073741824, 2) AS size_gb,
    CREATE_TIME,
    UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('brp_samples', 'brp_samples_new', 'brp_samples_old')
ORDER BY TABLE_NAME;


-- ---------------------------------------------------------------------------
-- STEP 2: Confirm copy is marked complete in migration_state
-- ---------------------------------------------------------------------------

SELECT migration, last_copied_id, started_at_utc, updated_at_utc, completed_at_utc
FROM migration_state
WHERE migration = 'brp_samples_partition';


-- ---------------------------------------------------------------------------
-- STEP 3: Atomic rename  *** POINT OF NO EASY RETURN ***
--
-- Stop the importer BEFORE running this statement.
-- Takes ~1 second.  After this line brp_samples IS the partitioned table.
-- ---------------------------------------------------------------------------

RENAME TABLE brp_samples     TO brp_samples_old,
             brp_samples_new TO brp_samples;


-- ---------------------------------------------------------------------------
-- STEP 4 (optional): Re-add the foreign key on the live table
--
-- The FK was intentionally omitted from brp_samples_new during the copy to
-- avoid FK overhead.  Re-add it here if you want referential integrity
-- enforced at the DB level.  Safe to skip — the importer enforces it in code.
-- ---------------------------------------------------------------------------

-- ALTER TABLE brp_samples
--   ADD CONSTRAINT fk_brp_session
--       FOREIGN KEY (session_id)
--       REFERENCES sleep_sessions (id)
--       ON DELETE RESTRICT;


-- ---------------------------------------------------------------------------
-- STEP 5: Post-cutover sanity check
-- Verify the live table is now partitioned and has data.
-- ---------------------------------------------------------------------------

SELECT
    PARTITION_NAME,
    PARTITION_ORDINAL_POSITION,
    TABLE_ROWS
FROM information_schema.PARTITIONS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'brp_samples'
ORDER BY PARTITION_ORDINAL_POSITION;


-- ---------------------------------------------------------------------------
-- STEP 6: Restart the importer
-- Confirm a few new rows land in the correct partition before continuing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- STEP 7 (deferred — do NOT rush): Drop the old unpartitioned table
--
-- Keep brp_samples_old around for at least 24–48 hours as a safety net.
-- When you are confident the live table is correct, run:
-- ---------------------------------------------------------------------------

-- DROP TABLE brp_samples_old;
