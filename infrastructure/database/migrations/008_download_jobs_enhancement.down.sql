-- Revert Migration 008: Download Jobs Enhancement
DROP INDEX IF EXISTS idx_download_jobs_cleanup;

ALTER TABLE download_jobs
    DROP COLUMN IF EXISTS media_ids,
    DROP COLUMN IF EXISTS requested_count,
    DROP COLUMN IF EXISTS processed_count,
    DROP COLUMN IF EXISTS progress,
    DROP COLUMN IF EXISTS error_message,
    DROP COLUMN IF EXISTS download_type;
