-- Migration 010: Durable Event Deletion Jobs (Phase: Secure Event Deletion & Complete Data Cleanup)
-- Records durable event deletion state across server/worker restarts and partial failure recovery.

CREATE TABLE IF NOT EXISTS event_deletion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    owner_id INT NOT NULL REFERENCES photographer(id) ON DELETE CASCADE,
    event_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    stage VARCHAR(50) NOT NULL DEFAULT 'initialized' CHECK (stage IN ('initialized', 'access_blocked', 'jobs_cancelled', 'r2_purged', 'database_purged', 'verified', 'completed', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    r2_objects_deleted INT NOT NULL DEFAULT 0,
    error_code VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_deletion_jobs_event_id ON event_deletion_jobs(event_id);
CREATE INDEX IF NOT EXISTS idx_event_deletion_jobs_status ON event_deletion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_event_deletion_jobs_owner_id ON event_deletion_jobs(owner_id);
