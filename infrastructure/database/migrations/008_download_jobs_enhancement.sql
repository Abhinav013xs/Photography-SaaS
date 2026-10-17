-- Migration 008: Download Jobs Enhancement & Temporary Archive Lifecycle
-- Adds requested media array, counters, progress, error message, and cleanup index to download_jobs.

ALTER TABLE download_jobs
    ADD COLUMN IF NOT EXISTS media_ids UUID[],
    ADD COLUMN IF NOT EXISTS requested_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processed_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS download_type VARCHAR(50) NOT NULL DEFAULT 'zip';

-- Bounded index for temporary archive retention cleanup
CREATE INDEX IF NOT EXISTS idx_download_jobs_cleanup
    ON download_jobs (expires_at ASC)
    WHERE status = 'completed' OR storage_key IS NOT NULL;
