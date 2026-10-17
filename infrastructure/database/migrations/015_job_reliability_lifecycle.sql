-- Migration 015: Job Reliability Lifecycle & Distributed Worker Lease Management
-- Studio Lumina — Phase 29: Background Job Reliability, Retries & Failure Recovery

-- 1. Extend processing_jobs status check constraint to support complete lifecycle
ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_status_check 
    CHECK (status IN ('pending', 'queued', 'processing', 'retry_wait', 'completed', 'succeeded', 'failed', 'cancelled'));

-- 2. Add reliability, lease, and retry tracking columns
ALTER TABLE processing_jobs
    ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS worker_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

-- 3. Composite indexes for high-throughput lease recovery, overdue retry dispatch, and idempotency lookup
CREATE INDEX IF NOT EXISTS idx_processing_jobs_lease_recovery ON processing_jobs (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_next_retry ON processing_jobs (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_idempotency_key ON processing_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_event_status ON processing_jobs (event_id, status);
