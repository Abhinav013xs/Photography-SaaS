-- Migration 005: Processing Jobs Enhancement & Outbox Ledger
-- Adds attempt tracking, completion timestamps, external queue job IDs, and lookup indexes.

ALTER TABLE processing_jobs
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS job_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_media_id ON processing_jobs(media_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_job_id ON processing_jobs(job_id) WHERE job_id IS NOT NULL;
