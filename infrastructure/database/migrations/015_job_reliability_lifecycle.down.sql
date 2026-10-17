-- Down Migration 015: Rollback Job Reliability Lifecycle
-- Studio Lumina — Phase 29: Background Job Reliability, Retries & Failure Recovery

DROP INDEX IF EXISTS idx_processing_jobs_event_status;
DROP INDEX IF EXISTS idx_processing_jobs_idempotency_key;
DROP INDEX IF EXISTS idx_processing_jobs_next_retry;
DROP INDEX IF EXISTS idx_processing_jobs_lease_recovery;

ALTER TABLE processing_jobs
    DROP COLUMN IF EXISTS correlation_id,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS worker_id,
    DROP COLUMN IF EXISTS error_code,
    DROP COLUMN IF EXISTS started_at,
    DROP COLUMN IF EXISTS next_retry_at,
    DROP COLUMN IF EXISTS max_attempts;

ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
