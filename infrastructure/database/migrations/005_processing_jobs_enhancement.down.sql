-- Migration 005 Down: Processing Jobs Enhancement Rollback

DROP INDEX IF EXISTS idx_processing_jobs_job_id;
DROP INDEX IF EXISTS idx_processing_jobs_status;
DROP INDEX IF EXISTS idx_processing_jobs_media_id;

ALTER TABLE processing_jobs
    DROP COLUMN IF EXISTS job_id,
    DROP COLUMN IF EXISTS completed_at,
    DROP COLUMN IF EXISTS last_attempt_at,
    DROP COLUMN IF EXISTS attempts;
